// Read-only research probe for C14-W01: which Codex entry (CLI or Desktop)
// actually spawned the shell that runs this process. Emits redacted JSON only.
// Not wired into any product path; see docs/research/c14-codex-source-feasibility-20261029.md.
/* global process */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const PROBE_LIMITS = { maxDepth: 12, tableTimeoutMs: 10_000, maxTableBytes: 4 * 1024 * 1024 };

const digest = (value, length) => createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, length);

// Codex can filter these names, but only when ignore_default_excludes is false;
// the setting defaults to true, so a match here is not an exclusion verdict.
const DEFAULT_EXCLUDE_PATTERN = /KEY|SECRET|TOKEN/i;

export function pathShape(path) {
  const p = String(path ?? '').replace(/\\/g, '/').toLowerCase();
  if (!p) return 'unknown';
  if (/\/openai\/codex\/bin\/[^/]+\/codex\.exe$/.test(p)) return 'desktop-bundle';
  if (/@openai\/codex-win32-x64\/vendor\/.*\/bin\/codex\.exe$/.test(p)) return 'npm-native';
  if (/\/@openai\/codex\/bin\/codex\.js$/.test(p)) return 'npm-launcher';
  if (/\/codex-resources\/codex-command-runner\.exe$/.test(p)) return 'command-runner';
  if (/\/codex-resources\/codex-windows-sandbox-setup\.exe$/.test(p)) return 'sandbox-setup';
  const base = p.slice(p.lastIndexOf('/') + 1);
  if (base === 'node' || base === 'node.exe') return 'node';
  if (base === 'chatgpt.exe') return 'app';
  if (/^(pwsh|powershell|cmd|bash|zsh|fish|sh)(\.exe)?$/.test(base)) return 'shell';
  return 'other';
}

export function redactEnv(env = process.env) {
  return Object.keys(env)
    .filter((name) => /^(CODEX_|CROSSCHAT_)/i.test(name))
    .sort()
    .map((name) => ({
      name,
      length: String(env[name] ?? '').length,
      digest: digest(env[name], 8),
      matchesDefaultExcludePattern: DEFAULT_EXCLUDE_PATTERN.test(name),
    }));
}

export function parseProcessTable(text) {
  const table = new Map();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const cols = line.split('\t');
    if (cols.length < 4) continue;
    const pid = Number(cols[0]);
    const ppid = Number(cols[1]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (!Number.isInteger(ppid) || ppid < 0) continue;
    const exe = cols[4] ?? '';
    const created = Number(cols[2]);
    table.set(pid, {
      pid,
      ppid,
      createdAt: Number.isFinite(created) && created > 0 ? created : 0,
      name: cols[3] || '',
      shape: pathShape(exe),
      exeDigest: exe ? digest(exe, 12) : '',
    });
  }
  return table;
}

export function traceAncestry(startPid, table, limit = PROBE_LIMITS.maxDepth) {
  const chain = [];
  const seen = new Set();
  let pid = startPid;
  for (;;) {
    if (chain.length >= limit) return { chain, stopReason: 'depth-limit' };
    if (seen.has(pid)) return { chain, stopReason: 'cycle' };
    seen.add(pid);
    const row = table.get(pid);
    if (!row) return { chain, stopReason: chain.length === 0 ? 'self-missing' : 'missing-parent' };
    chain.push(row);
    if (!row.ppid) return { chain, stopReason: 'root' };
    const parent = table.get(row.ppid);
    if (!parent) return { chain, stopReason: 'missing-parent' };
    // A parent cannot be created after its child: same pid here means reuse.
    if (parent.createdAt && row.createdAt && parent.createdAt > row.createdAt) {
      return { chain, stopReason: 'creation-order' };
    }
    pid = row.ppid;
  }
}

const isExecutor = (row) => row.shape === 'desktop-bundle' || row.shape === 'npm-native';
const isWrapper = (row) => row.shape === 'command-runner' || row.shape === 'sandbox-setup';
const isCodexLike = (row) => /^codex([-_.]|$)/i.test(row.name ?? '');
const brief = (row) => (row ? { pid: row.pid, name: row.name, shape: row.shape, createdAt: row.createdAt, exeDigest: row.exeDigest } : null);
// A pid+path digest only says what was observed; it does not authenticate the file.
const completeInstance = (executor, parent) => Boolean(executor.createdAt && executor.exeDigest && parent?.createdAt && parent?.exeDigest);

function classifyExecutor(chain, index) {
  const executor = chain[index];
  // Codex may interpose its own command runner between the executor and the shell.
  const parent = chain.slice(index + 1).find((row) => !isWrapper(row));
  const detail = { executor: brief(executor), parent: brief(parent) };
  const [entry, basis] = executor.shape === 'desktop-bundle'
    ? parent?.shape === 'app'
      ? ['desktop', 'desktop-bundle-under-app']
      : ['unknown', 'desktop-bundle-without-app-parent']
    : parent?.shape === 'node'
      ? ['cli', 'npm-executor-under-node-launcher']
      : ['unknown', 'npm-executor-without-node-parent'];
  // A shape-only match is a candidate: without pid+creation time it cannot pin the instance.
  if (entry !== 'unknown' && !completeInstance(executor, parent)) {
    return { entry: 'unknown', basis: 'incomplete-instance-metadata', ...detail };
  }
  return { entry, basis, ...detail };
}

export function classifyEntry(chain) {
  // Walk outward from the shell. The nearest codex process decides: a known
  // executor is classified, an unrecognized one stops the walk, so a nearer
  // unknown executor is never skipped in favour of a farther known ancestor.
  for (let index = 1; index < chain.length; index += 1) {
    const row = chain[index];
    if (isWrapper(row)) continue;
    if (isExecutor(row)) return classifyExecutor(chain, index);
    if (isCodexLike(row)) return { entry: 'unknown', basis: 'unrecognized-codex-executor', candidate: brief(row) };
  }
  return { entry: 'unknown', basis: 'no-codex-ancestor' };
}

const WINDOWS_QUERY = [
  'Get-CimInstance Win32_Process | ForEach-Object {',
  '  $c = 0',
  '  try { $c = $_.CreationDate.ToFileTimeUtc() } catch {}',
  '  "$($_.ProcessId)`t$($_.ParentProcessId)`t$c`t$($_.Name)`t$($_.ExecutablePath)"',
  '}',
].join('\n');

function defaultRun(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, maxBuffer: PROBE_LIMITS.maxTableBytes, windowsHide: true, encoding: 'utf8' },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

// Windows-only research probe. Linux/macOS are reported unsupported rather than
// scanned; this does not change product platform support.
export async function readProcessTable({ run = defaultRun, timeoutMs = PROBE_LIMITS.tableTimeoutMs, platform = process.platform } = {}) {
  if (platform !== 'win32') return { ok: false, reason: 'platform-unsupported' };
  try {
    const text = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_QUERY], timeoutMs);
    return { ok: true, table: parseProcessTable(text) };
  } catch (error) {
    const reason = error?.killed || error?.code === 'ETIMEDOUT'
      ? 'table-timeout'
      : error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
        ? 'table-too-large'
        : 'table-unreadable';
    return { ok: false, reason, detail: String(error?.message ?? error) };
  }
}

export function collectReport({ env = process.env, table, startPid = process.pid, stopReason } = {}) {
  const traced = traceAncestry(startPid, table);
  return {
    probe: 'codex-caller-source',
    version: 1,
    platform: process.platform,
    env: redactEnv(env),
    ancestry: traced.chain,
    stopReason: stopReason ?? traced.stopReason,
    verdict: classifyEntry(traced.chain),
    limits: PROBE_LIMITS,
  };
}

export async function main() {
  const read = await readProcessTable();
  const report = read.ok
    ? collectReport({ table: read.table })
    : { probe: 'codex-caller-source', version: 1, platform: process.platform, env: redactEnv(), unavailable: read };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await main();
  // Exit 0 means a table was read; unavailable is a diagnostic result, not success.
  if (report.unavailable) process.exitCode = 2;
}
