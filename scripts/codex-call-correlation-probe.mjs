// Read-only research probe for C14-W05: can a native PreToolUse `tool_use_id`
// be matched, byte for byte, to the `CODEX_TOOL_CALL_ID` of the ordinary shell
// that ran the same tool call — and to which executing process do the records bind?
// Not wired into any product path; see docs/research/c14-codex-call-correlation-20261029.md.
/* global process */
import { createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { open, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const CORRELATION_LIMITS = {
  maxHookBytes: 256 * 1024,
  maxHookRecords: 32,
  maxLineBytes: 64 * 1024,
  maxSampleBytes: 64 * 1024,
  ancestryDepth: 4,
  ancestryTimeoutMs: 10_000,
  maxModelRequests: 8,
  runTimeoutMs: 180_000,
};

const digest = (value, length = 12) => createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, length);

// Full native ids are compared in memory; only this shape reaches evidence.
export function redact(value) {
  if (typeof value !== 'string' || value.length === 0) return { present: false };
  return { present: true, length: value.length, sha256: digest(value) };
}

const brief = (row) => (row ? { pid: row.pid, name: row.name, createdAt: row.createdAt, exeDigest: row.exeDigest } : null);

// One bounded lookup per hop: a full process-table read is not needed and would
// blow the hook's time budget.
const PROCESS_QUERY = (pid) => [
  `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"`,
  'if ($p) {',
  '  $c = 0',
  '  try { $c = $p.CreationDate.ToFileTimeUtc() } catch {}',
  '  "$($p.ProcessId)`t$($p.ParentProcessId)`t$c`t$($p.Name)`t$($p.ExecutablePath)"',
  '}',
].join('\n');

function readProcessRow(pid, timeoutMs) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PROCESS_QUERY(pid)],
      { timeout: timeoutMs, maxBuffer: 64 * 1024, windowsHide: true, encoding: 'utf8' },
      (error, stdout) => {
        if (error) return resolve(null);
        const cols = String(stdout).trim().split('\t');
        if (cols.length < 5) return resolve(null);
        const rowPid = Number(cols[0]);
        if (!Number.isInteger(rowPid) || rowPid <= 0) return resolve(null);
        const created = Number(cols[2]);
        resolve({
          pid: rowPid,
          ppid: Number(cols[1]) || 0,
          createdAt: Number.isFinite(created) && created > 0 ? created : 0,
          name: cols[3] || '',
          exeDigest: cols[4] ? digest(cols[4], 12) : '',
        });
      });
  });
}

// Walks outward from `startPid`. A pid alone cannot pin an instance, so each row
// keeps its creation time; rows without one stay visible but never count as an anchor.
export async function readAncestry(startPid, { depth = CORRELATION_LIMITS.ancestryDepth, timeoutMs = CORRELATION_LIMITS.ancestryTimeoutMs } = {}) {
  const chain = [];
  let pid = startPid;
  for (let hop = 0; hop < depth; hop += 1) {
    const row = await readProcessRow(pid, timeoutMs);
    if (!row) break;
    chain.push(row);
    if (!row.ppid) break;
    pid = row.ppid;
  }
  return chain;
}

// The nearest process two records share, keyed by pid *and* creation time: a
// reused pid is a different process, so it must not anchor a match.
export function sharedExecutor(left = [], right = []) {
  for (const row of left) {
    if (!row.createdAt) continue;
    const other = right.find((candidate) => candidate.pid === row.pid && candidate.createdAt === row.createdAt);
    if (other) return brief(row);
  }
  return null;
}

const HOOK_REQUIRED = ['session_id', 'tool_use_id', 'tool_name', 'tool_input'];

// Parses the hook's own JSONL log. Anything that is not a well-formed PreToolUse
// record is rejected rather than guessed at: a missing record must never look
// like a match.
export function parseHookLog(text, { maxRecords = CORRELATION_LIMITS.maxHookRecords } = {}) {
  const records = [];
  const rejected = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (records.length >= maxRecords) { rejected.push('record-limit'); break; }
    if (Buffer.byteLength(line) > CORRELATION_LIMITS.maxLineBytes) { rejected.push('line-too-large'); continue; }
    let value;
    try { value = JSON.parse(line); } catch { rejected.push('unparseable'); continue; }
    const event = value?.event ?? value;
    if (event?.hook_event_name !== 'PreToolUse') { rejected.push('not-pre-tool-use'); continue; }
    if (HOOK_REQUIRED.some((key) => event[key] === undefined || event[key] === null || event[key] === '')) { rejected.push('incomplete'); continue; }
    const command = event.tool_input?.command;
    if (typeof command !== 'string' || !command) { rejected.push('missing-command'); continue; }
    records.push({
      sessionId: String(event.session_id),
      turnId: event.turn_id ? String(event.turn_id) : null,
      toolUseId: String(event.tool_use_id),
      toolName: String(event.tool_name),
      command,
      pid: Number(value.pid) || 0,
      ppid: Number(value.ppid) || 0,
      ancestry: Array.isArray(value.ancestry) ? value.ancestry : [],
    });
  }
  return { records, rejected };
}

export function parseShellSamples(text) {
  const records = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (!value || typeof value.tag !== 'string' || !value.tag) continue;
      records.push({
        tag: value.tag,
        threadId: value.threadId ?? null,
        sessionId: value.sessionId ?? null,
        toolCallId: value.toolCallId ?? null,
        codexVersion: value.codexVersion ?? null,
        pid: Number(value.pid) || 0,
        ppid: Number(value.ppid) || 0,
        ancestry: Array.isArray(value.ancestry) ? value.ancestry : [],
      });
    } catch { /* a truncated sample is dropped, not repaired */ }
  }
  return records;
}

// Binds one hook record to one shell sample by the unique tag embedded in the
// command, then compares the two native call identifiers as whole values. A
// missing or duplicated record is a failed correlation, never a pass.
export function correlateCalls({ hookRecords = [], shellRecords = [] } = {}) {
  const calls = [];
  const usedHooks = new Set();
  for (const shell of shellRecords) {
    const candidates = hookRecords.filter((hook) => hook.command.includes(shell.tag));
    for (const hook of candidates) usedHooks.add(hook);
    const base = {
      // The tag is the fixture's own call id: evidence keeps its digest, never the value.
      tagDigest: digest(shell.tag),
      shell: {
        threadId: redact(shell.threadId),
        sessionId: redact(shell.sessionId),
        toolCallId: redact(shell.toolCallId),
        codexVersion: shell.codexVersion,
        pid: shell.pid,
        ppid: shell.ppid,
        ancestry: shell.ancestry.map(brief),
      },
    };
    if (candidates.length === 0) { calls.push({ ...base, verdict: 'hook-missing', hook: null }); continue; }
    if (candidates.length > 1) { calls.push({ ...base, verdict: 'ambiguous', hook: null, candidates: candidates.length }); continue; }
    const [hook] = candidates;
    const toolCallIdEqual = Boolean(shell.toolCallId) && hook.toolUseId === shell.toolCallId;
    const threadIdEqual = Boolean(shell.threadId) && hook.sessionId === shell.threadId;
    const sessionIdEqual = Boolean(shell.sessionId) && hook.sessionId === shell.sessionId;
    const executor = sharedExecutor(hook.ancestry, shell.ancestry);
    calls.push({
      ...base,
      verdict: toolCallIdEqual && threadIdEqual ? 'correlated' : 'mismatch',
      toolCallIdEqual,
      threadIdEqual,
      sessionIdEqual,
      hook: {
        sessionId: redact(hook.sessionId),
        turnId: redact(hook.turnId),
        toolUseId: redact(hook.toolUseId),
        toolName: hook.toolName,
        pid: hook.pid,
        ppid: hook.ppid,
        ancestry: hook.ancestry.map(brief),
      },
      sharedExecutor: executor,
      sameExecutorInstance: Boolean(executor),
    });
  }
  const orphanHooks = hookRecords.filter((hook) => !usedHooks.has(hook)).map((hook) => ({
    commandDigest: digest(hook.command), toolUseId: redact(hook.toolUseId), verdict: 'shell-missing',
  }));
  return { calls, orphanHooks };
}

export async function readBounded(path, maxBytes) {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return { text: buffer.subarray(0, bytesRead).toString('utf8'), truncated: bytesRead === maxBytes };
  } finally {
    await handle.close();
  }
}

const WINDOWS_ENV = /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|ProgramFiles.*|SYSTEMDRIVE|OS)$/i;

export function isolatedEnv(profile, codexHome, tmp) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => WINDOWS_ENV.test(key)));
  return {
    ...env,
    HOME: profile,
    USERPROFILE: profile,
    CODEX_HOME: codexHome,
    APPDATA: join(profile, 'appdata'),
    LOCALAPPDATA: join(profile, 'localappdata'),
    TEMP: tmp,
    TMP: tmp,
    NO_COLOR: '1',
    NO_PROXY: '127.0.0.1,localhost',
  };
}

const SHELL_SAMPLE_SOURCE = (helperURL) => `// Generated per run by scripts/codex-call-correlation-probe.mjs.
import { collectShellSample } from '${helperURL}';
await collectShellSample(process.argv[2], process.argv[3]);
`;

const MODEL_RESPONSE = (call) => {
  const message = { id: `msg_${call ?? 'final'}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'CORRELATION_PROBE_DONE', annotations: [] }] };
  const item = call
    ? { id: `fc_${call.callId}`, type: 'function_call', status: 'completed', call_id: call.callId, name: 'exec_command', arguments: JSON.stringify(call.arguments) }
    : message;
  const response = { id: `resp_${call?.callId ?? 'final'}`, object: 'response', status: 'completed', model: 'fixture', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  return [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress' } },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response },
  ];
};

// One loopback Responses endpoint. It answers with the next planned
// `exec_command` call, or the final message once every call has run.
export async function startMockModel(plan) {
  const state = { requests: 0, toolNames: [] };
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { if (body.length < 4 * 1024 * 1024) body += chunk; });
    request.on('end', () => {
      state.requests += 1;
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { parsed = null; }
      if (state.toolNames.length === 0 && Array.isArray(parsed?.tools)) {
        state.toolNames = parsed.tools.map((tool) => tool.name ?? tool.type);
      }
      const completed = (parsed?.input ?? []).filter((item) => item.type === 'function_call_output').length;
      const call = state.requests <= CORRELATION_LIMITS.maxModelRequests ? plan[completed] : undefined;
      const frames = MODEL_RESPONSE(call);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(frames.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''));
    });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    state,
    close: () => new Promise((done) => server.close(done)),
  };
}

export function buildPlan({ workspace, outDir, calls }) {
  return calls.map((callId, index) => ({
    callId,
    arguments: {
      cmd: `node "${join(outDir, 'shell-sample.mjs')}" "${join(outDir, `shell-${index + 1}.jsonl`)}" "${callId}"`,
      workdir: workspace,
    },
  }));
}

function configToml(baseUrl) {
  return [
    'model="fixture"',
    'model_provider="fixture"',
    '[model_providers.fixture]',
    'name="Fixture"',
    `base_url=${JSON.stringify(baseUrl)}`,
    'wire_api="responses"',
    'requires_openai_auth=false',
    'request_max_retries=0',
    'stream_max_retries=0',
    '[analytics]',
    'enabled=false',
    '',
  ].join('\n');
}

function hooksJson(hookHelper, hookLog) {
  return JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `node "${hookHelper}" "${hookLog}"` }] }] },
  }, null, 2);
}

async function runCli({ codexJs, env, workspace, prompt, timeoutMs }) {
  const child = spawn(process.execPath, [
    codexJs, '--dangerously-bypass-hook-trust', '--no-daemon', 'exec',
    '--skip-git-repo-check', '-s', 'danger-full-access', '-c', 'approval_policy="never"',
    '--json', prompt,
  ], { cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const capture = (chunk) => { if (output.length < 64 * 1024) output += chunk.toString(); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
  const exitCode = await new Promise((done) => child.once('exit', done));
  clearTimeout(timer);
  return { exitCode, timedOut, pid: child.pid, output };
}

// Runs the whole native experiment inside `root`. Processes are stopped and the
// server closed on every path; the caller owns deleting `root`.
export async function runCorrelation({ root, repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..'), evidencePath, calls = ['call_w05_1', 'call_w05_2'] }) {
  const profile = join(root, 'profile');
  const codexHome = join(profile, '.codex');
  const workspace = join(root, 'workspace');
  const tmp = join(root, 'tmp');
  await Promise.all([codexHome, workspace, tmp].map((path) => mkdir(path, { recursive: true })));

  const helperURL = pathToFileURL(join(repoRoot, 'test', 'helpers', 'codex-call-correlation-hook.mjs')).href;
  const hookLog = join(root, 'hook.jsonl');
  await writeFile(join(root, 'shell-sample.mjs'), SHELL_SAMPLE_SOURCE(helperURL));

  const plan = buildPlan({ workspace, outDir: root, calls });
  const live = await startMockModel(plan);
  try {
    await writeFile(join(codexHome, 'config.toml'), configToml(live.baseUrl));
    await writeFile(join(codexHome, 'hooks.json'), hooksJson(join(repoRoot, 'test', 'helpers', 'codex-call-correlation-hook.mjs'), hookLog));

    const env = isolatedEnv(profile, codexHome, tmp);
    const packageJson = JSON.parse(await readFile(join(process.env.APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'package.json'), 'utf8'));
    const codexJs = join(process.env.APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    const run = await runCli({ codexJs, env, workspace, prompt: 'run the correlation samples', timeoutMs: CORRELATION_LIMITS.runTimeoutMs });

    const hookRead = await readBounded(hookLog, CORRELATION_LIMITS.maxHookBytes).catch(() => ({ text: '', truncated: false }));
    const shellText = [];
    for (const [index] of calls.entries()) {
      const read = await readBounded(join(root, `shell-${index + 1}.jsonl`), CORRELATION_LIMITS.maxSampleBytes).catch(() => ({ text: '' }));
      shellText.push(read.text);
    }
    const parsedHooks = parseHookLog(hookRead.text);
    const correlation = correlateCalls({ hookRecords: parsedHooks.records, shellRecords: parseShellSamples(shellText.join('\n')) });

    const evidence = {
      record: 'codex-call-correlation',
      collectedAt: new Date().toISOString(),
      platform: process.platform,
      node: process.version,
      runtime: {
        cliPackage: packageJson.version,
        cliEntry: 'npm @openai/codex/bin/codex.js',
      },
      isolation: {
        codexHome: 'owned temp profile, empty at start',
        userConfigRead: false,
        userAuthRead: false,
        modelEndpoint: '127.0.0.1 loopback fixture',
      },
      run: {
        exitCode: run.exitCode,
        timedOut: run.timedOut,
        modelRequests: live.state.requests,
        offeredTools: live.state.toolNames,
        shellSamples: correlation.calls.length,
        hookRecords: parsedHooks.records.length,
        rejectedHookLines: parsedHooks.rejected,
        hookLogTruncated: hookRead.truncated,
      },
      calls: correlation.calls,
      orphanHooks: correlation.orphanHooks,
      limits: 'One Windows host, one isolated CODEX_HOME, one native CLI process tree, non-interactive exec with a loopback fixture model. No Desktop, no shared daemon, no IPC owner, no write_stdin, no second thread, no subagent.',
    };
    if (evidencePath) await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    return evidence;
  } finally {
    await live.close();
  }
}

export async function main(argv = process.argv.slice(2)) {
  const root = argv[argv.indexOf('--root') + 1];
  const evidencePath = argv.includes('--evidence') ? argv[argv.indexOf('--evidence') + 1] : null;
  if (!root || !argv.includes('--root')) {
    process.stderr.write('usage: node scripts/codex-call-correlation-probe.mjs --root <owned temp dir> [--evidence <json>]\n');
    return 1;
  }
  const evidence = await runCorrelation({ root, repoRoot: process.cwd(), evidencePath });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  // 0 means the run produced a correlation verdict; a tooling failure is 3 and
  // must not be reported as "unsupported".
  return evidence.run.exitCode === 0 && evidence.calls.length > 0 ? 0 : 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
