// C14-W08 read-only probe: which OS process serves a local named pipe, and how
// does that process relate to this shell's ancestry and to the logical Desktop
// owner? The pipe is opened for its server PID only — no tool request, no
// subscribe, no turn. Product state is never read or written.
// Usage: node W08-probe.mjs [--pipe <name>] [--owner] [--no-table] [--out <new.json>]
/* global process */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readProcessTable, traceAncestry } from '../../../../scripts/codex-caller-source-probe.mjs';

export const PROBE_LIMITS = { connectTimeoutMs: 3000, psTimeoutMs: 20_000, tableTimeoutMs: 10_000 };
export const DEFAULT_PIPE = 'codex-ipc';

const digest = (value, length) => createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, length);
const brief = (row) => (row ? { pid: row.pid, name: row.name, shape: row.shape, createdAt: row.createdAt, exeDigest: row.exeDigest } : null);
const pipePathOf = (name) => `${String.fromCharCode(92, 92, 46, 92)}pipe${String.fromCharCode(92)}${name}`;

/** 'C:\...\\.\pipe\codex-ipc' and 'codex-ipc' both name the same pipe. */
export function pipeNameOf(value) {
  const parts = String(value ?? '').trim().split(/[\\/]+/).filter(Boolean);
  return parts.length === 0 ? '' : parts[parts.length - 1];
}

/** A pid alone does not pin an instance: the same pid can be reused later. */
export function sameInstance(left, right) {
  if (!left || !right || !Number.isInteger(left.pid) || !Number.isInteger(right.pid)) return { same: false, reason: 'missing-metadata' };
  if (left.pid !== right.pid) return { same: false, reason: 'different-pid' };
  if (!left.createdAt || !right.createdAt) return { same: false, reason: 'missing-creation-time' };
  return left.createdAt === right.createdAt ? { same: true, reason: 'pid-and-creation-time' } : { same: false, reason: 'pid-reused' };
}

/**
 * Relate a pipe server pid to this process using one process-table snapshot.
 * A pid present in the live ancestor chain is the same live process: two live
 * processes cannot share a pid, and a named-pipe server dies with its process.
 * A shared ancestor is a common origin only — never the same instance.
 */
export function compareAnchors({ serverPid, selfPid, table }) {
  if (!Number.isInteger(serverPid) || serverPid <= 0) return { relation: 'unverifiable', reasons: ['no-server-pid'] };
  const self = traceAncestry(selfPid, table);
  const server = table.get(serverPid);
  const detail = { serverPid, server: brief(server), selfChain: self.chain.map(brief), selfStopReason: self.stopReason };
  if (server === undefined) return { relation: 'unverifiable', reasons: ['server-pid-not-in-process-table'], ...detail };
  if (serverPid === selfPid) return { relation: 'same-process', reasons: [], ...detail };
  const depth = self.chain.findIndex((row) => row.pid === serverPid);
  if (depth >= 0) return { relation: 'server-is-ancestor', depth, reasons: [], ...detail };
  const serverChain = traceAncestry(serverPid, table);
  const shared = self.chain.find((row) => serverChain.chain.some((other) => other.pid === row.pid));
  if (shared !== undefined) {
    return { relation: 'shared-ancestor-only', sharedAncestor: brief(shared), serverChain: serverChain.chain.map(brief), reasons: ['common-ancestor-is-not-same-instance'], ...detail };
  }
  return { relation: 'unrelated', reasons: [], serverChain: serverChain.chain.map(brief), ...detail };
}

// Native Query: WaitNamedPipeW gives a bounded wait, then CreateFileW opens the
// pipe only to ask for the server pid. Built with [char]92 for the path so this
// script carries no escape sequences of its own.
const PIPE_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class W08Pipe {
  const uint GENERIC_READ = 0x80000000;
  const uint OPEN_EXISTING = 3;
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool WaitNamedPipeW(string name, uint timeout);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sa, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetNamedPipeServerProcessId(IntPtr handle, out uint pid);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CloseHandle(IntPtr handle);
  static string Kind(int error) {
    if (error == 2) return "absent";
    if (error == 5) return "access-denied";
    if (error == 121 || error == 1460) return "timeout";
    return "native";
  }
  static string Fail(string stage, string kind, int error) {
    return "{\\"ok\\":false,\\"stage\\":\\"" + stage + "\\",\\"errorKind\\":\\"" + kind + "\\",\\"nativeError\\":" + error + "}";
  }
  public static string Query(string fullPath, int timeoutMs) {
    if (!WaitNamedPipeW(fullPath, (uint)timeoutMs)) {
      int error = Marshal.GetLastWin32Error();
      return Fail("wait", Kind(error), error);
    }
    IntPtr handle = CreateFileW(fullPath, GENERIC_READ, 0, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
    if (handle == new IntPtr(-1)) {
      int error = Marshal.GetLastWin32Error();
      return Fail("open", Kind(error), error);
    }
    try {
      uint pid;
      if (!GetNamedPipeServerProcessId(handle, out pid)) {
        int error = Marshal.GetLastWin32Error();
        return Fail("query", "native", error);
      }
      return "{\\"ok\\":true,\\"stage\\":\\"query\\",\\"serverPid\\":" + pid.ToString() + "}";
    } finally {
      CloseHandle(handle);
    }
  }
}
'@
$full = [string]::Concat([char]92, [char]92, '.', [char]92, 'pipe', [char]92, $args[0])
[W08Pipe]::Query($full, [int]$args[1])
`;

function defaultRun(scriptPath, pipeName, connectTimeoutMs, timeoutMs) {
  return new Promise((resolve_, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, pipeName, String(connectTimeoutMs)],
      { timeout: timeoutMs, maxBuffer: 256 * 1024, windowsHide: true, encoding: 'utf8' },
      (error, stdout) => (error ? reject(error) : resolve_(stdout)),
    );
  });
}

/** Read the pid of the process that created the pipe server instance. */
export async function queryPipeServer({ pipeName, scriptPath, run = defaultRun, connectTimeoutMs = PROBE_LIMITS.connectTimeoutMs, timeoutMs = PROBE_LIMITS.psTimeoutMs }) {
  let stdout;
  try { stdout = await run(scriptPath, pipeName, connectTimeoutMs, timeoutMs); }
  catch (error) {
    const timedOut = error?.killed === true || error?.code === 'ETIMEDOUT';
    return { ok: false, stage: 'spawn', errorKind: timedOut ? 'probe-timeout' : 'probe-failed', detail: String(error?.message ?? error).slice(0, 200) };
  }
  try { return JSON.parse(stdout); }
  catch { return { ok: false, stage: 'parse', errorKind: 'unparsable-output', detail: String(stdout).slice(0, 200) }; }
}

/** Keep native error text from carrying absolute paths into the report. */
export function redactMessage(message) {
  return String(message ?? '').replace(/[A-Za-z]:[\\/][^\s"'<>]+/g, '<path>').slice(0, 200);
}

/** initialize + thread-owner-discovery only. Never snapshot, subscribe or turn. */
export async function readOwner({ pipeName, threadId, timeoutMs = PROBE_LIMITS.psTimeoutMs }) {
  if (typeof threadId !== 'string' || threadId.trim() === '') return { requested: true, known: false, reason: 'CODEX_THREAD_ID absent' };
  const module = await import(new URL('../../../../dist/codex/desktop-ipc.js', import.meta.url).href);
  let session;
  try {
    session = await module.openDesktopThread(threadId, { pipePath: pipePathOf(pipeName), timeoutMs });
  } catch (error) {
    return { requested: true, known: false, error: { name: error?.name, code: error?.code, message: redactMessage(error?.message) } };
  }
  if (session === null) return { requested: true, known: false, reason: 'Desktop IPC or thread owner positively absent' };
  try {
    // The logical owner is a client id, not an OS identity: same namespace never holds.
    return { requested: true, known: true, namespace: 'client-id', length: session.ownerId.length, digest: digest(session.ownerId, 12), osPidEquivalent: false };
  } finally { await session.close(); }
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => argv.includes(name);
  const option = (name) => { const at = argv.indexOf(name); return at === -1 ? undefined : argv[at + 1]; };
  const outPath = option('--out');
  if (flag('--out') && outPath === undefined) {
    return { report: { error: '--out requires a path', wrote: false }, code: 2 };
  }
  // Refuse an existing output before any temp root or pipe connection happens.
  if (outPath !== undefined && existsSync(outPath)) {
    return { report: { error: 'refusing to overwrite an existing output', out: outPath, wrote: false }, code: 3 };
  }

  const pipeName = pipeNameOf(option('--pipe') ?? DEFAULT_PIPE) || DEFAULT_PIPE;
  const report = { probe: 'c14-desktop-os-source-anchor', version: 1, generatedAt: new Date().toISOString(), node: process.version, platform: process.platform, self: { pid: process.pid }, pipes: [], limits: PROBE_LIMITS };
  const cleaner = { created: false, removed: false };
  let tempRoot;
  let code = 0;
  try {
    tempRoot = mkdtempSync(join(tmpdir(), 'w08-pipe-'));
    cleaner.created = true;
    const scriptPath = join(tempRoot, 'pipe-pid.ps1');
    writeFileSync(scriptPath, PIPE_SCRIPT, 'utf8');

    const query = await queryPipeServer({ pipeName, scriptPath });
    report.pipes.push({ label: 'codex-ipc', pipe: { name: pipeName }, query });

    if (flag('--owner')) report.owner = await readOwner({ pipeName, threadId: process.env.CODEX_THREAD_ID });

    if (!flag('--no-table')) {
      const read = await readProcessTable({ timeoutMs: PROBE_LIMITS.tableTimeoutMs });
      report.processTable = { ok: read.ok, ...(read.ok ? {} : { reason: read.reason }) };
      if (read.ok) {
        const anchor = compareAnchors({ serverPid: query.serverPid, selfPid: process.pid, table: read.table });
        report.self.chain = anchor.selfChain;
        report.self.stopReason = anchor.selfStopReason;
        report.pipes[0].anchor = anchor;
      }
    }

    const relation = report.pipes[0].anchor?.relation ?? 'unverified-without-process-table';
    report.conclusion = {
      osServerRelation: relation,
      logicalOwnerSeparateNamespace: report.owner?.known === true ? report.owner.osPidEquivalent === false : null,
      productStatusUnchanged: 'CODEX_SOURCE_ASSOCIATION_UNVERIFIED',
      note: 'The pipe server pid is independent OS evidence. When the pipe is a shared hub it does not identify the logical owner, and a tools-pipe path inherited through the environment does not prove this call used it.',
    };
  } catch (error) {
    report.error = { name: error?.name, message: redactMessage(error?.message) };
    code = 1;
  } finally {
    // Only this run's own root: verified parent and name prefix.
    if (tempRoot !== undefined && resolve(join(tempRoot, '..')) === resolve(tmpdir()) && /^w08-pipe-/.test(basename(tempRoot)) && existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true });
      cleaner.removed = !existsSync(tempRoot);
    }
  }

  report.cleanup = cleaner;
  if (outPath !== undefined) {
    try {
      writeFileSync(outPath, `${JSON.stringify({ ...report, wrote: true }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      report.wrote = true;
    } catch (error) { report.writeError = String(error?.code ?? error); code = 1; }
  }
  return { report, outPath, code };
}

// Importing this module must not touch any pipe: only a direct run probes.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outcome = await main();
  process.stdout.write(`${JSON.stringify(outcome.report, null, 2)}\n`);
  if (typeof outcome.code === 'number') process.exitCode = outcome.code;
}
