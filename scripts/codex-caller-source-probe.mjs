// Read-only research probe for C14-W01: which Codex entry (CLI or Desktop)
// actually spawned the shell that runs this process. Emits redacted JSON only.
// Not wired into any product path; see docs/research/c14-codex-source-feasibility-20261029.md.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readdir, readFile, readlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const PROBE_LIMITS = { maxDepth: 12, tableTimeoutMs: 10_000, maxTableBytes: 4 * 1024 * 1024 };

const digest = (value, length) => createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, length);

// Codex's default shell_environment_policy excludes these name patterns.
const DEFAULT_EXCLUDE = /KEY|SECRET|TOKEN/i;

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
      defaultExcluded: DEFAULT_EXCLUDE.test(name),
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
    table.set(pid, {
      pid,
      ppid,
      createdAt: Number(cols[2]) || 0,
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
const brief = (row) => (row ? { pid: row.pid, name: row.name, shape: row.shape, createdAt: row.createdAt, exeDigest: row.exeDigest } : null);

export function classifyEntry(chain) {
  const index = chain.findIndex((row, i) => i > 0 && isExecutor(row));
  if (index < 0) return { entry: 'unknown', basis: 'no-codex-ancestor' };
  const executor = chain[index];
  // Codex may interpose its own command runner between the executor and the shell.
  const parent = chain.slice(index + 1).find((row) => !isWrapper(row));
  const detail = { executor: brief(executor), parent: brief(parent) };
  if (executor.shape === 'desktop-bundle') {
    return parent?.shape === 'app'
      ? { entry: 'desktop', basis: 'desktop-bundle-under-app', ...detail }
      : { entry: 'unknown', basis: 'desktop-bundle-without-app-parent', ...detail };
  }
  return parent?.shape === 'node'
    ? { entry: 'cli', basis: 'npm-executor-under-node-launcher', ...detail }
    : { entry: 'unknown', basis: 'npm-executor-without-node-parent', ...detail };
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

async function posixTable() {
  const table = new Map();
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    let stat;
    try {
      stat = await readFile(`/proc/${entry}/stat`, 'utf8');
    } catch {
      continue;
    }
    const close = stat.lastIndexOf(')');
    if (close < 0) continue;
    const fields = stat.slice(close + 2).split(' ');
    let exe = '';
    try {
      exe = await readlink(`/proc/${entry}/exe`);
    } catch {
      // kernel threads and other users' processes are unreadable
    }
    table.set(Number(entry), {
      pid: Number(entry),
      ppid: Number(fields[1]) || 0,
      createdAt: Number(fields[19]) || 0,
      name: stat.slice(stat.indexOf('(') + 1, close),
      shape: pathShape(exe),
      exeDigest: exe ? digest(exe, 12) : '',
    });
  }
  return table;
}

export async function readProcessTable({ run = defaultRun, timeoutMs = PROBE_LIMITS.tableTimeoutMs, platform = process.platform } = {}) {
  if (platform === 'linux') {
    try {
      return { ok: true, table: await posixTable() };
    } catch (error) {
      return { ok: false, reason: 'table-unreadable', detail: String(error?.message ?? error) };
    }
  }
  if (platform !== 'win32') return { ok: false, reason: 'platform-unsupported' };
  try {
    const text = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_QUERY], timeoutMs);
    return { ok: true, table: parseProcessTable(text) };
  } catch (error) {
    const reason = error?.killed || error?.code === 'ETIMEDOUT' ? 'table-timeout' : 'table-unreadable';
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
  await main();
}
