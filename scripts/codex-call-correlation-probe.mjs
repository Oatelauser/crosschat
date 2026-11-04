// Read-only research probe for C14-W05: can a native PreToolUse `tool_use_id`
// be matched, byte for byte, to the `CODEX_TOOL_CALL_ID` of the ordinary shell
// that ran the same tool call — and to which executing process do the records bind?
// Not wired into any product path; see docs/research/c14-codex-call-correlation-20261029.md.
/* global process, Buffer, setTimeout, clearTimeout */
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { open, access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const CORRELATION_LIMITS = {
  maxHookBytes: 256 * 1024,
  maxHookRecords: 32,
  maxLineBytes: 64 * 1024,
  maxSampleBytes: 64 * 1024,
  ancestryDepth: 4,
  ancestryTimeoutMs: 10_000,
  maxModelRequests: 8,
  maxModelBodyBytes: 1024 * 1024,
  maxOutputBytes: 64 * 1024,
  runTimeoutMs: 180_000,
  closeTimeoutMs: 5_000,
  killTimeoutMs: 5_000,
  requestTimeoutMs: 10_000,
  hookStdinBytes: 64 * 1024,
  hookStdinMs: 5_000,
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

// A row only identifies a process if every anchor field has its declared type.
// Malformed data is dropped, never coerced into a plausible identity.
export function isProcessRow(row) {
  return Boolean(row)
    && Number.isInteger(row.pid) && row.pid > 0
    && Number.isInteger(row.ppid) && row.ppid >= 0
    && typeof row.createdAt === 'number' && Number.isFinite(row.createdAt) && row.createdAt > 0
    && typeof row.name === 'string' && row.name.length > 0
    && typeof row.exeDigest === 'string';
}

// A chain is only usable up to the first row that is malformed, that does not
// point at the row before it, that was born after its own child, or that repeats
// a pid. Rows past that point are unrelated, so they are dropped rather than
// handed to the executor check as if the chain were connected.
export function normalizeAncestry(chain, { expectPid = null } = {}) {
  const rows = [];
  const seen = new Set();
  let malformed = 0;
  let broken = false;
  for (const row of Array.isArray(chain) ? chain : []) {
    if (!isProcessRow(row)) { malformed += 1; broken = true; break; }
    const previous = rows[rows.length - 1];
    // A parent is never younger than its child; a repeated pid is a cycle or a
    // reused pid, not the original parent.
    if (previous && (previous.ppid !== row.pid || row.createdAt > previous.createdAt)) { broken = true; break; }
    if (seen.has(row.pid)) { broken = true; break; }
    seen.add(row.pid);
    rows.push(row);
  }
  if (rows.length > 0 && Number.isInteger(expectPid) && rows[0].pid !== expectPid) {
    return { rows: [], malformed, broken: true };
  }
  return { rows, malformed, broken };
}

// Processes Codex spawns under its own name are helpers, not the executing instance.
const CODEX_HELPER = /^codex-(command-runner|windows-sandbox-setup|code-mode-host)(\.exe)?$/i;

// The nearest Codex process in one chain, counted from the record's own process
// outward. Name matching only picks the hop to compare; it proves no provenance.
export function nearestCodexExecutor(chain = []) {
  for (const row of chain) {
    if (!isProcessRow(row)) return null;
    if (!/^codex([-_.]|$)/i.test(row.name) || CODEX_HELPER.test(row.name)) continue;
    return row;
  }
  return null;
}

// The nearest process two chains share. This may be a launcher, so it is reported
// as a common ancestor only — never as "the same executor".
export function sharedAncestor(left = [], right = []) {
  for (const row of left) {
    if (!isProcessRow(row)) continue;
    const other = right.find((candidate) => candidate.pid === row.pid && candidate.createdAt === row.createdAt);
    if (other) return brief(row);
  }
  return null;
}

// Same executing instance requires both sides' *nearest* Codex process to agree on
// pid, creation time and executable path digest. Anything less is unverified: a
// shared launcher further up the chain says nothing about the executor below it.
export function sameExecutor(leftChain = [], rightChain = []) {
  const left = nearestCodexExecutor(leftChain);
  const right = nearestCodexExecutor(rightChain);
  const detail = { left: brief(left), right: brief(right) };
  if (!left || !right) return { verdict: 'unverified', reason: left || right ? 'executor-on-one-side' : 'executor-missing', ...detail };
  if (left.pid !== right.pid || left.createdAt !== right.createdAt) return { verdict: 'different', reason: 'distinct-executor', ...detail };
  if (!left.exeDigest || !right.exeDigest) return { verdict: 'unverified', reason: 'path-digest-missing', ...detail };
  if (left.exeDigest !== right.exeDigest) return { verdict: 'unverified', reason: 'path-digest-mismatch', ...detail };
  return { verdict: 'same', reason: null, ...detail };
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The tag is matched as a whole token: `call_w05_1` must not match `call_w05_10`,
// and a command carrying two planned tags binds to neither.
export function commandHasTag(command, tag) {
  if (typeof command !== 'string' || typeof tag !== 'string' || !tag) return false;
  return new RegExp(`(?:^|[\\s"'])${escapeRegExp(tag)}(?=$|[\\s"'])`).test(command);
}

const HOOK_REQUIRED = ['session_id', 'tool_use_id', 'tool_name', 'tool_input'];
const isId = (value) => typeof value === 'string' && value.length > 0;

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
    if (value?.error) { rejected.push('hook-error'); continue; }
    const event = value?.event ?? value;
    if (event?.hook_event_name !== 'PreToolUse') { rejected.push('not-pre-tool-use'); continue; }
    if (HOOK_REQUIRED.some((key) => event[key] === undefined || event[key] === null || event[key] === '')) { rejected.push('incomplete'); continue; }
    // A numeric id is not a string id: coercing it would manufacture an equality
    // that the runtime never produced.
    if (!isId(event.session_id) || !isId(event.tool_use_id) || !isId(event.tool_name)) { rejected.push('invalid-id'); continue; }
    if (event.turn_id !== undefined && event.turn_id !== null && !isId(event.turn_id)) { rejected.push('invalid-id'); continue; }
    const command = event.tool_input?.command;
    if (typeof command !== 'string' || !command) { rejected.push('missing-command'); continue; }
    records.push({
      sessionId: event.session_id,
      turnId: isId(event.turn_id) ? event.turn_id : null,
      toolUseId: event.tool_use_id,
      toolName: event.tool_name,
      command,
      pid: Number(value.pid) || 0,
      ppid: Number(value.ppid) || 0,
      ancestry: Array.isArray(value.ancestry) ? value.ancestry : [],
    });
  }
  return { records, rejected };
}

export function parseShellSamples(text, { maxRecords = CORRELATION_LIMITS.maxHookRecords } = {}) {
  const records = [];
  const rejected = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (records.length >= maxRecords) { rejected.push('record-limit'); break; }
    if (Buffer.byteLength(line) > CORRELATION_LIMITS.maxLineBytes) { rejected.push('line-too-large'); continue; }
    let value;
    try { value = JSON.parse(line); } catch { rejected.push('unparseable'); continue; }
    if (!value || typeof value !== 'object') { rejected.push('not-object'); continue; }
    if (typeof value.tag !== 'string' || !value.tag) { rejected.push('missing-tag'); continue; }
    // Present-but-wrong-type ids are rejected; absent ones stay null and make the
    // call unverifiable instead of unequal.
    const ids = ['threadId', 'sessionId', 'toolCallId'];
    if (ids.some((key) => value[key] !== undefined && value[key] !== null && !isId(value[key]))) { rejected.push('invalid-id'); continue; }
    records.push({
      tag: value.tag,
      threadId: isId(value.threadId) ? value.threadId : null,
      sessionId: isId(value.sessionId) ? value.sessionId : null,
      toolCallId: isId(value.toolCallId) ? value.toolCallId : null,
      codexVersion: value.codexVersion ?? null,
      pid: Number(value.pid) || 0,
      ppid: Number(value.ppid) || 0,
      ancestry: Array.isArray(value.ancestry) ? value.ancestry : [],
    });
  }
  return { records, rejected };
}

const side = (record) => {
  const chain = normalizeAncestry(record.ancestry, { expectPid: record.pid });
  return {
    pid: record.pid,
    ppid: record.ppid,
    ancestry: chain.rows.map(brief),
    malformedAncestryRows: chain.malformed,
    ancestryBroken: chain.broken,
  };
};

// Binds each planned call to exactly one shell sample and exactly one hook record
// by exact tag match, consumes each record at most once, then compares the two
// native call identifiers as whole values. Missing, duplicated, overlapping or
// unplanned records make the run incomplete — never a pass.
export function correlateCalls({ hookRecords = [], shellRecords = [], plannedTags } = {}) {
  if (!Array.isArray(plannedTags) || plannedTags.length === 0) throw new Error('correlateCalls requires the planned call tags');

  const problems = [];
  const planned = new Set();
  for (const tag of plannedTags) {
    if (typeof tag !== 'string' || !tag) { problems.push('plan-invalid-tag'); continue; }
    if (planned.has(tag)) problems.push(`plan-duplicate-tag:${digest(tag)}`);
    planned.add(tag);
  }

  const shellsByTag = new Map();
  for (const shell of shellRecords) {
    if (!planned.has(shell.tag)) { problems.push(`unplanned-shell:${digest(shell.tag)}`); continue; }
    const list = shellsByTag.get(shell.tag) ?? [];
    list.push(shell);
    shellsByTag.set(shell.tag, list);
  }
  for (const [tag, list] of shellsByTag) {
    if (list.length > 1) problems.push(`duplicate-shell:${digest(tag)}:${list.length}`);
  }

  const hooksByTag = new Map();
  for (const hook of hookRecords) {
    const tags = [...planned].filter((tag) => commandHasTag(hook.command, tag));
    if (tags.length === 0) { problems.push(`unplanned-hook:${digest(hook.command)}`); continue; }
    if (tags.length > 1) { problems.push(`overlapping-hook:${digest(hook.command)}`); continue; }
    const list = hooksByTag.get(tags[0]) ?? [];
    list.push(hook);
    hooksByTag.set(tags[0], list);
  }
  for (const [tag, list] of hooksByTag) {
    if (list.length > 1) problems.push(`duplicate-hook:${digest(tag)}:${list.length}`);
  }

  const calls = [];
  const boundHooks = new Set();
  for (const tag of plannedTags) {
    if (typeof tag !== 'string' || !tag) continue;
    const shells = shellsByTag.get(tag) ?? [];
    const hooks = hooksByTag.get(tag) ?? [];
    const base = { tagDigest: digest(tag), shell: shells.length === 1 ? side(shells[0]) : null };

    if (shells.length !== 1) {
      calls.push({ ...base, verdict: shells.length === 0 ? 'shell-missing' : 'ambiguous-shell', shellCount: shells.length, hook: null });
      continue;
    }
    const [shell] = shells;
    const shellSide = {
      ...base.shell,
      threadId: redact(shell.threadId),
      sessionId: redact(shell.sessionId),
      toolCallId: redact(shell.toolCallId),
      codexVersion: typeof shell.codexVersion === 'string' ? shell.codexVersion : null,
    };

    if (hooks.length !== 1) {
      calls.push({ ...base, shell: shellSide, verdict: hooks.length === 0 ? 'hook-missing' : 'ambiguous', hook: null, candidates: hooks.length });
      continue;
    }
    const [hook] = hooks;
    boundHooks.add(hook);
    // null means "cannot compare", which is not the same as "different": a missing
    // required id outranks any other field, so an uncomparable call never becomes
    // a negative conclusion.
    const toolCallIdEqual = shell.toolCallId && hook.toolUseId ? shell.toolCallId === hook.toolUseId : null;
    const threadIdEqual = shell.threadId && hook.sessionId ? shell.threadId === hook.sessionId : null;
    const sessionIdEqual = shell.sessionId && hook.sessionId ? shell.sessionId === hook.sessionId : null;
    const verdict = toolCallIdEqual === null || threadIdEqual === null
      ? 'unverifiable'
      : (toolCallIdEqual && threadIdEqual ? 'correlated' : 'mismatch');
    const hookChain = normalizeAncestry(hook.ancestry, { expectPid: hook.pid }).rows;
    const shellChain = normalizeAncestry(shell.ancestry, { expectPid: shell.pid }).rows;
    const executor = sameExecutor(hookChain, shellChain);
    calls.push({
      ...base,
      shell: shellSide,
      verdict,
      unverifiableReason: verdict === 'unverifiable' ? (toolCallIdEqual === null ? 'call-id-missing' : 'thread-id-missing') : null,
      toolCallIdEqual,
      threadIdEqual,
      sessionIdEqual,
      hook: {
        ...side(hook),
        sessionId: redact(hook.sessionId),
        turnId: redact(hook.turnId),
        toolUseId: redact(hook.toolUseId),
        toolName: hook.toolName,
      },
      executorVerdict: executor.verdict,
      executorReason: executor.reason,
      sameExecutorInstance: executor.verdict === 'same',
      sharedAncestor: sharedAncestor(hookChain, shellChain),
    });
  }

  const orphanHooks = hookRecords.filter((hook) => !boundHooks.has(hook)).map((hook) => ({
    commandDigest: digest(hook.command), toolUseId: redact(hook.toolUseId), verdict: 'shell-missing',
  }));
  const unusedShells = shellRecords.filter((shell) => !(shellsByTag.get(shell.tag)?.length === 1 && planned.has(shell.tag))).map((shell) => ({
    tagDigest: digest(shell.tag), verdict: 'unbound',
  }));

  // A call whose two records were never bound has no verdict to report, so the
  // run is incomplete even when every record that did arrive looks fine.
  const conclusive = calls.every((call) => call.verdict === 'correlated' || call.verdict === 'mismatch');
  return { status: problems.length === 0 && conclusive ? 'complete' : 'incomplete', problems, calls, orphanHooks, unusedShells };
}

export async function readBounded(path, maxBytes) {
  let handle;
  try {
    handle = await open(path, 'r');
  } catch (error) {
    return { ok: false, text: '', truncated: false, error: error?.code ?? 'open-failed' };
  }
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes + 1, 0);
    return {
      ok: true,
      text: buffer.subarray(0, Math.min(bytesRead, maxBytes)).toString('utf8'),
      truncated: bytesRead > maxBytes,
      error: null,
    };
  } catch (error) {
    return { ok: false, text: '', truncated: false, error: error?.code ?? 'read-failed' };
  } finally {
    await handle.close().catch(() => {});
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

// Kills the tree under a pid this process started. Never by image name: a user's
// own Codex, daemon or helper must never be a target.
export async function killOwnedTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'],
        { windowsHide: true, timeout: CORRELATION_LIMITS.killTimeoutMs },
        (error) => resolve(!error));
    });
  }
  try { process.kill(-pid, 'SIGKILL'); return true; } catch {
    try { process.kill(pid, 'SIGKILL'); return true; } catch { return false; }
  }
}

const isAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};

// Runs one owned child to completion, a timeout, an abort or a spawn error. A
// killed run waits for `close` and re-checks the pid it launched; deeper
// descendants are never attributed, so `descendantsVerified` stays false.
export async function runProcess({
  command,
  args = [],
  cwd,
  env,
  timeoutMs = CORRELATION_LIMITS.runTimeoutMs,
  maxOutputBytes = CORRELATION_LIMITS.maxOutputBytes,
  killTimeoutMs = CORRELATION_LIMITS.killTimeoutMs,
  signal = null,
  spawnProcess = spawn,
  killTree = killOwnedTree,
}) {
  const state = {
    pid: 0, exitCode: null, signal: null, closed: false, timedOut: false, cancelled: false,
    killedTree: false, leaked: false, launcherGone: null, descendantsVerified: false,
    spawnError: null, output: '', outputTruncated: false,
  };
  let child;
  try {
    child = spawnProcess(command, args, {
      cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
  } catch (error) {
    state.spawnError = error?.code ?? 'spawn-failed';
    return state;
  }
  state.pid = child.pid ?? 0;

  let bytes = 0;
  const capture = (chunk) => {
    if (bytes >= maxOutputBytes) { state.outputTruncated = true; return; }
    const room = maxOutputBytes - bytes;
    if (chunk.length > room) {
      state.output += chunk.subarray(0, room).toString();
      bytes = maxOutputBytes;
      state.outputTruncated = true;
      return;
    }
    state.output += chunk.toString();
    bytes += chunk.length;
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);

  let finish;
  const closed = new Promise((done) => { finish = done; });
  const onError = (error) => {
    state.spawnError = state.spawnError ?? error?.code ?? 'spawn-failed';
    finish('error');
  };
  const onClose = (code, sig) => {
    state.exitCode = code;
    state.signal = sig;
    state.closed = true;
    finish('close');
  };
  child.once('error', onError);
  child.once('close', onClose);

  let resolveAbort;
  const aborted = new Promise((done) => { resolveAbort = done; });
  const onAbort = () => { state.cancelled = true; resolveAbort('abort'); };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  let timer = null;
  const deadline = new Promise((done) => {
    timer = setTimeout(() => { state.timedOut = true; done('timeout'); }, timeoutMs);
  });
  const first = await Promise.race([closed, deadline, aborted]);

  let killTimer = null;
  if (first === 'timeout' || first === 'abort') {
    state.killedTree = await killTree(state.pid).catch(() => false);
    const settled = await Promise.race([
      closed,
      new Promise((done) => { killTimer = setTimeout(() => done('still-open'), killTimeoutMs); }),
    ]);
    if (settled === 'still-open') state.leaked = true;
    state.launcherGone = !isAlive(state.pid);
  }

  clearTimeout(timer);
  if (killTimer) clearTimeout(killTimer);
  if (signal) signal.removeEventListener('abort', onAbort);
  child.stdout?.removeListener('data', capture);
  child.stderr?.removeListener('data', capture);
  return state;
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

// The only fields this probe consumes are `input` and `tools`; anything else is
// ignored. A malformed shape is a capture fault, not an exception.
export function parseModelRequest(text) {
  let value;
  try { value = JSON.parse(text); } catch { return { ok: false, reason: 'unparseable-request' }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'invalid-request' };
  if (value.input !== undefined && !Array.isArray(value.input)) return { ok: false, reason: 'invalid-input' };
  if (Array.isArray(value.input) && value.input.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) return { ok: false, reason: 'invalid-input' };
  if (value.tools !== undefined && !Array.isArray(value.tools)) return { ok: false, reason: 'invalid-tools' };
  if (Array.isArray(value.tools) && value.tools.some((tool) => !tool || typeof tool !== 'object' || Array.isArray(tool))) return { ok: false, reason: 'invalid-tools' };
  return { ok: true, input: value.input ?? [], tools: value.tools ?? null };
}

// One loopback Responses endpoint. It answers with the next planned
// `exec_command` call, or the final message once every call has run. Listen
// errors, malformed requests, oversized bodies, stalled requests and request
// overruns are recorded, and no callback is allowed to throw out of the server.
export async function startMockModel(plan, {
  port = 0,
  maxRequests = CORRELATION_LIMITS.maxModelRequests,
  maxBodyBytes = CORRELATION_LIMITS.maxModelBodyBytes,
  requestTimeoutMs = CORRELATION_LIMITS.requestTimeoutMs,
  closeTimeoutMs = CORRELATION_LIMITS.closeTimeoutMs,
} = {}) {
  const state = { requests: 0, toolNames: [], toolCalls: [], bodyOverflow: 0, overLimit: false, failures: [] };
  const server = createServer((request, response) => {
    if (request.method !== 'POST') { response.writeHead(405).end(); return; }
    let body = '';
    let bytes = 0;
    let overflow = false;
    let settled = false;
    let timer = null;
    // Every exit releases this request's own timer and listeners; a request that
    // never ends fails on the deadline instead of holding the run open.
    const release = () => {
      if (timer) clearTimeout(timer);
      request.removeAllListeners('data');
      request.removeAllListeners('end');
      request.removeAllListeners('error');
      request.removeAllListeners('close');
    };
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      state.failures.push('request-timeout');
      release();
      try { response.writeHead(408).end(); } catch { /* socket already gone */ }
    }, requestTimeoutMs);
    request.on('error', () => {
      if (settled) return;
      settled = true;
      state.failures.push('request-error');
      release();
    });
    request.on('close', () => {
      if (settled) return;
      settled = true;
      state.failures.push('request-aborted');
      release();
    });
    request.on('data', (chunk) => {
      if (overflow) return;
      bytes += chunk.length;
      if (bytes > maxBodyBytes) { overflow = true; state.bodyOverflow += 1; return; }
      body += chunk.toString();
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      release();
      try {
        if (overflow) { response.writeHead(413).end(); return; }
        state.requests += 1;
        if (state.requests > maxRequests) { state.overLimit = true; response.writeHead(429).end(); return; }
        const parsed = parseModelRequest(body);
        if (!parsed.ok) { state.failures.push(parsed.reason); response.writeHead(400).end(); return; }
        if (state.toolNames.length === 0 && parsed.tools) {
          state.toolNames = parsed.tools.map((tool) => (typeof tool.name === 'string' ? tool.name : String(tool.type ?? 'unknown')));
        }
        const completed = parsed.input.filter((item) => item.type === 'function_call_output').length;
        const call = plan[completed];
        if (call) state.toolCalls.push('exec_command');
        const frames = MODEL_RESPONSE(call);
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(frames.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''));
      } catch {
        state.failures.push('handler-error');
        try { response.writeHead(500).end(); } catch { /* socket already gone */ }
      }
    });
  });

  await new Promise((done, fail) => {
    server.once('error', (error) => fail(new Error(`loopback-listen-failed:${error?.code ?? 'unknown'}`)));
    server.listen(port, '127.0.0.1', () => done());
  });

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    state,
    // Bounded close: drop keep-alive sockets, then give the server a deadline. The
    // deadline timer is released as soon as the close settles either way.
    close: async () => {
      server.closeAllConnections?.();
      let timer = null;
      try {
        const closed = new Promise((done) => server.close(() => done('closed')));
        const deadline = new Promise((done) => { timer = setTimeout(() => done('timeout'), closeTimeoutMs); });
        return (await Promise.race([closed, deadline])) === 'closed';
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
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

// Global flags must precede `exec`; `exec` rejects `-a`, so approval is a config override.
const CLI_ARGS = [
  '--dangerously-bypass-hook-trust', '--no-daemon', 'exec',
  '--skip-git-repo-check', '-s', 'danger-full-access', '-c', 'approval_policy="never"', '--json',
];

async function resolveCodexCli() {
  const appData = process.env.APPDATA;
  if (!appData) throw new Error('codex-cli-not-found');
  const root = join(appData, 'npm', 'node_modules', '@openai', 'codex');
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  return { command: process.execPath, args: [join(root, 'bin', 'codex.js')], version: packageJson.version };
}

const ROOT_OWNER = 'c14-w05-correlation-probe';

// The run root must be ours before a single profile byte is written: create it
// exclusively, or adopt an empty directory, then claim it. A non-empty directory
// is refused untouched.
export async function prepareOwnedRoot(root) {
  const target = resolve(root);
  let created = false;
  try {
    await mkdir(target);
    created = true;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  if (!created) {
    const entries = await readdir(target);
    if (entries.length > 0) throw new Error(`root-not-exclusive:${target}`);
  }
  // The exclusive marker write *is* the claim: a concurrent second claimant loses
  // here and therefore gets no deletion rights over the winner's directory. The
  // marker names the directory it claims, so copied bytes do not travel with it.
  const runId = randomUUID();
  const ownership = { owner: ROOT_OWNER, runId, root: target, createdAt: new Date().toISOString(), pid: process.pid };
  const markerBytes = `${JSON.stringify(ownership)}\n`;
  try {
    await writeFile(join(target, 'ownership.json'), markerBytes, { flag: 'wx' });
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`root-not-exclusive:${target}`);
    throw error;
  }
  return { root: target, runId, ownership, markerBytes };
}

// Deletes only the directory this run claimed, and only while the marker is still
// the exact bytes this run wrote. A different path, a copied marker or any changed
// field leaves the directory untouched.
export async function removeOwnedRoot(root, claim) {
  const target = resolve(root);
  if (!claim?.runId || typeof claim.markerBytes !== 'string') throw new Error(`root-not-claimed:${target}`);
  if (claim.root !== target) throw new Error(`root-not-owned:root-mismatch:${target}`);
  let text;
  try {
    text = await readFile(join(target, 'ownership.json'), 'utf8');
  } catch (error) {
    throw new Error(`root-not-owned:marker-unreadable:${error?.code ?? 'error'}:${target}`);
  }
  if (text !== claim.markerBytes) throw new Error(`root-not-owned:marker-changed:${target}`);
  const marker = JSON.parse(text);
  if (marker?.owner !== ROOT_OWNER || marker.runId !== claim.runId || marker.root !== target
    || marker.pid !== claim.ownership?.pid || marker.createdAt !== claim.ownership?.createdAt) {
    throw new Error(`root-not-owned:marker-changed:${target}`);
  }
  await rm(target, { recursive: true, force: true });
}

// A root is only deleted after the processes it held are known to have closed.
// Without positive evidence that every descendant exited, the root is kept.
async function settleRoot(claim, settled) {
  if (!settled) return { status: 'retained', reason: 'processes-unverified', path: claim.root };
  try {
    await removeOwnedRoot(claim.root, claim);
    return { status: 'removed', path: claim.root };
  } catch (error) {
    const reason = String(error?.message ?? error?.code ?? 'remove-failed').split(':').slice(0, 2).join(':');
    return { status: 'failed', reason, path: claim.root };
  }
}

async function assertEvidenceAbsent(path) {
  try {
    await access(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`evidence-exists:${path}`);
}

const describeRead = (read) => ({ ok: read.ok, truncated: read.truncated, error: read.error });

// Runs the whole native experiment inside `root`, stopping every process it
// started and closing the server on every path. The caller owns the root and the
// evidence file; this function refuses to overwrite either.
export async function runCorrelation({
  root,
  repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..'),
  evidencePath = null,
  calls = ['call_w05_1', 'call_w05_2'],
  cli = null,
  limits = CORRELATION_LIMITS,
  deps = {},
}) {
  // An existing evidence file is refused before any CLI is started, so a refused
  // run cannot overwrite the record it was told to keep.
  if (evidencePath) await assertEvidenceAbsent(evidencePath);
  const owned = await prepareOwnedRoot(root);
  const paths = {
    profile: join(owned.root, 'profile'),
    codexHome: join(owned.root, 'profile', '.codex'),
    workspace: join(owned.root, 'workspace'),
    tmp: join(owned.root, 'tmp'),
    hookLog: join(owned.root, 'hook.jsonl'),
    sample: join(owned.root, 'shell-sample.mjs'),
  };
  const reasons = [];
  const reads = {};
  let live = null;
  let run = null;
  let runtime = null;
  let cleanup = null;

  try {
    try {
      await Promise.all([paths.codexHome, paths.workspace, paths.tmp].map((path) => mkdir(path, { recursive: true })));
      const helper = join(repoRoot, 'test', 'helpers', 'codex-call-correlation-hook.mjs');
      await writeFile(paths.sample, SHELL_SAMPLE_SOURCE(pathToFileURL(helper).href));

      live = await startMockModel(buildPlan({ workspace: paths.workspace, outDir: owned.root, calls }), limits);
      await writeFile(join(paths.codexHome, 'config.toml'), configToml(live.baseUrl));
      await writeFile(join(paths.codexHome, 'hooks.json'), hooksJson(helper, paths.hookLog));

      const target = cli ?? await resolveCodexCli();
      runtime = { cliPackage: target.version ?? null, cliEntry: cli ? 'injected test cli' : 'npm @openai/codex/bin/codex.js' };
      run = await runProcess({
        command: target.command,
        args: target.appendPromptArgs === false ? [...target.args] : [...target.args, ...CLI_ARGS, 'run the correlation samples'],
        cwd: paths.workspace,
        env: isolatedEnv(paths.profile, paths.codexHome, paths.tmp),
        timeoutMs: limits.runTimeoutMs,
        maxOutputBytes: limits.maxOutputBytes,
        killTimeoutMs: limits.killTimeoutMs,
        signal: deps.signal ?? null,
        spawnProcess: deps.spawnProcess,
        killTree: deps.killTree,
      });
    } catch (error) {
      reasons.push(`init-failure:${error?.code ?? error?.message ?? 'unknown'}`);
    } finally {
      if (live) {
        const closed = await live.close().catch(() => false);
        if (!closed) reasons.push('server-close-timeout');
      }
    }

    if (!run) reasons.push('cli-not-run');
    else {
      if (run.spawnError) reasons.push(`spawn-error:${run.spawnError}`);
      if (run.timedOut) reasons.push('cli-timeout');
      if (run.cancelled) reasons.push('cli-cancelled');
      if (run.leaked) reasons.push('cli-descendant-still-running');
      if (run.outputTruncated) reasons.push('cli-output-truncated');
      if (run.exitCode !== 0) reasons.push(`cli-exit:${run.exitCode}`);
    }
    if (live) {
      if (live.state.overLimit) reasons.push('model-request-limit');
      if (live.state.bodyOverflow) reasons.push('model-body-overflow');
      for (const failure of live.state.failures) reasons.push(`model-${failure}`);
    }

    const hookRead = await readBounded(paths.hookLog, limits.maxHookBytes);
    reads.hookLog = describeRead(hookRead);
    const shellReads = [];
    for (const [index] of calls.entries()) {
      const read = await readBounded(join(owned.root, `shell-${index + 1}.jsonl`), limits.maxSampleBytes);
      reads[`shell-${index + 1}`] = describeRead(read);
      if (read.ok) shellReads.push(read.text);
    }
    for (const [name, read] of Object.entries(reads)) {
      if (!read.ok) reasons.push(`read-failed:${name}:${read.error}`);
      else if (read.truncated) reasons.push(`read-truncated:${name}`);
    }

    const hookParse = parseHookLog(hookRead.text, { maxRecords: limits.maxHookRecords });
    const shellParse = parseShellSamples(shellReads.join('\n'), { maxRecords: limits.maxHookRecords });
    for (const rejected of hookParse.rejected) reasons.push(`hook-rejected:${rejected}`);
    for (const rejected of shellParse.rejected) reasons.push(`shell-rejected:${rejected}`);

    const correlation = correlateCalls({ hookRecords: hookParse.records, shellRecords: shellParse.records, plannedTags: calls });
    reasons.push(...correlation.problems);
    for (const call of correlation.calls) {
      if (call.verdict !== 'correlated' && call.verdict !== 'mismatch') reasons.push(`call-${call.tagDigest}:${call.verdict}`);
    }

    // A closed launcher is not proof that every descendant exited. Without positive
    // evidence — which this runner never has — the root is kept, even on a normal
    // exit, so a clean run reports `retained` and exits 3 as well.
    const settled = Boolean(run && run.closed && !run.leaked && !run.timedOut && !run.cancelled && !run.spawnError && run.descendantsVerified === true);
    cleanup = await settleRoot(owned, settled);
    if (cleanup.status !== 'removed') reasons.push(`cleanup-${cleanup.status}:${cleanup.reason ?? cleanup.path}`);

    const toolingFailure = !run || Boolean(run.spawnError) || run.timedOut || run.cancelled || run.exitCode !== 0;
    const status = reasons.length === 0 ? 'complete' : (toolingFailure ? 'tooling-failure' : 'incomplete');
    const verdicts = correlation.calls.map((call) => call.verdict);
    const outcome = status === 'complete'
      ? (verdicts.every((verdict) => verdict === 'correlated') ? 'correlated' : 'mismatch')
      : 'no-conclusion';

    const evidence = {
      record: 'codex-call-correlation',
      version: 2,
      collectedAt: new Date().toISOString(),
      platform: process.platform,
      node: process.version,
      runtime: runtime ?? { cliPackage: null, cliEntry: null },
      isolation: {
        root: 'owned exclusive temp dir, kept unless every descendant is known to have exited',
        codexHome: 'owned temp profile, empty at start',
        userConfigRead: false,
        userAuthRead: false,
        modelEndpoint: '127.0.0.1 loopback fixture',
      },
    plan: { calls: calls.map((tag) => digest(tag)), expectedCalls: calls.length, expectedHooks: calls.length },
    run: {
      status,
      reasons: [...new Set(reasons)],
      outcome,
      exitCode: run?.exitCode ?? null,
      signal: run?.signal ?? null,
      timedOut: Boolean(run?.timedOut),
      cancelled: Boolean(run?.cancelled),
      killedTree: Boolean(run?.killedTree),
      launcherGone: run?.launcherGone ?? null,
      descendantsVerified: Boolean(run?.descendantsVerified),
      spawnError: run?.spawnError ?? null,
      modelRequests: live?.state.requests ?? 0,
      offeredTools: live?.state.toolNames ?? [],
      usedTools: [...new Set(live?.state.toolCalls ?? [])],
      shellSamples: shellParse.records.length,
      hookRecords: hookParse.records.length,
      rejectedHookLines: hookParse.rejected,
      rejectedShellLines: shellParse.rejected,
      reads,
      cleanup,
    },
    calls: correlation.calls,
    orphanHooks: correlation.orphanHooks,
    unusedShells: correlation.unusedShells,
    limits: 'One Windows host, one isolated CODEX_HOME, one native CLI process tree, non-interactive exec with a loopback fixture model. No Desktop, no shared daemon, no IPC owner, no write_stdin, no second thread, no subagent.',
  };

  if (evidencePath) await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
  return evidence;
  } finally {
    // An unexpected throw leaves `cleanup` unset; the root is then kept, not guessed at.
    if (!cleanup) await settleRoot(owned, false);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const root = argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : null;
  const evidencePath = argv.includes('--evidence') ? argv[argv.indexOf('--evidence') + 1] : null;
  if (!root) {
    process.stderr.write('usage: node scripts/codex-call-correlation-probe.mjs --root <owned temp dir> [--evidence <json>]\n');
    return 1;
  }
  let evidence;
  try {
    evidence = await runCorrelation({ root, repoRoot: process.cwd(), evidencePath });
  } catch (error) {
    // No deletion here: only the run that successfully claimed the root may remove
    // it, and it does so before returning.
    process.stderr.write(`probe failed: ${error?.message ?? error}\n`);
    return 3;
  }
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  // 0 means the run produced a complete correlation verdict; anything less is 3
  // and must not be reported as "unsupported".
  return evidence.run.status === 'complete' ? 0 : 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
