import { execFile, fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';
import type { Worker } from 'node:worker_threads';
import { diagnosticCheck, summarizeDiagnosticChecks } from './model.js';
import type { DiagnosticCode, DiagnosticGroup, DiagnosticInput, DiagnosticResult } from './model.js';

export interface DiagnosticQueryOptions {
  signal?: AbortSignal;
  home?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** Thread-only test seam. Tasks that spawn subprocesses use createProcess. */
  createWorker?(): Worker;
  /** Query-owned process; on POSIX it must own a detached process group. */
  createProcess?(options: { env: NodeJS.ProcessEnv }): ChildProcess;
}

type FieldType = 'text' | 'number' | 'boolean' | 'strings' | 'side' | 'nullable-number';
const schemas: Record<DiagnosticCode, Record<string, FieldType>> = {
  'node-supported': { version: 'text' }, 'node-unsupported': { version: 'text' },
  'claude-ready': { executable: 'text', count: 'number' }, 'claude-empty': { executable: 'text' }, 'claude-missing': {}, 'claude-registry-malformed': { count: 'number' },
  'codex-missing': {}, 'codex-unparsed': { firstLine: 'text', status: 'nullable-number' }, 'codex-cli-old': { version: 'text' }, 'codex-cli-ready': { version: 'text' },
  'codex-daemon-missing': {}, 'codex-daemon-old': { version: 'text' }, 'codex-daemon-ready': { version: 'text' },
  'skill-missing': { side: 'side', path: 'text' }, 'skill-installed': { side: 'side' }, 'skill-match': { side: 'side' }, 'skill-mismatch': { side: 'side', paths: 'strings' },
  'identity-conflict': {}, 'identity-clear': {}, 'node-config-invalid': { path: 'text' }, 'node-config-ready': {}, 'node-star-id-missing': { label: 'text' },
  'node-star-id-duplicate': { first: 'text', label: 'text', starId: 'text' }, 'broker-reachable': { host: 'text', port: 'number' }, 'broker-unreachable': { host: 'text', port: 'number' },
  'broker-empty': {}, 'broker-ready': { stars: 'number', nodes: 'number' }, 'broker-port-custom': { port: 'number', defaultPort: 'number', path: 'text' }, 'broker-invalid': {},
  'status-stale': { file: 'text' }, 'status-process-unavailable': { file: 'text' },
  'resident-version-mismatch': { label: 'text', version: 'text', cliVersion: 'text', restartCommand: 'text' },
  'outbox-empty': {}, 'outbox-parked': { threadId: 'text', count: 'number', watchdogRunning: 'boolean', mailboxFile: 'text' },
};
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function invalid(): never { throw new Error('Diagnostic result is malformed.'); }
function field(value: unknown, type: FieldType): unknown {
  if (type === 'text' && typeof value === 'string' && value.length <= 65_536) return value;
  if ((type === 'number' || type === 'nullable-number') && typeof value === 'number' && Number.isFinite(value)) return value;
  if (type === 'nullable-number' && value === null) return value;
  if (type === 'boolean' && typeof value === 'boolean') return value;
  if (type === 'side' && (value === 'claude' || value === 'codex')) return value;
  if (type === 'strings' && Array.isArray(value) && value.length <= 2000 && value.every((item) => typeof item === 'string' && item.length <= 65_536)) return [...value];
  return invalid();
}

/** IPC is an unknown boundary. Copy only known facts and retain authoritative severities. */
export function parseDiagnosticResult(input: unknown): DiagnosticResult {
  if (!record(input) || !Array.isArray(input.groups) || input.groups.length > 2000 || Buffer.byteLength(JSON.stringify(input)) > 2 * 1024 * 1024) invalid();
  let count = 0;
  const groups = input.groups.map((group) => {
    if (!record(group) || !record(group.context) || !Array.isArray(group.checks)) invalid();
    let context: DiagnosticGroup;
    if (group.context.kind === 'environment' || group.context.kind === 'other') context = { kind: group.context.kind };
    else if (group.context.kind === 'tcp') {
      if (group.context.star !== undefined) field(group.context.star, 'text');
      context = { kind: 'tcp', ...(typeof group.context.star === 'string' ? { star: group.context.star } : {}) };
    } else return invalid();
    const checks = group.checks.map((check) => {
      if (++count > 10_000 || !record(check) || typeof check.code !== 'string' || !Object.hasOwn(schemas, check.code) || !record(check.data)) invalid();
      const code = check.code as DiagnosticCode;
      const data: Record<string, unknown> = {};
      for (const [name, type] of Object.entries(schemas[code])) data[name] = field(check.data[name], type);
      if (code === 'status-process-unavailable' && check.data.pid !== undefined) data.pid = field(check.data.pid, 'number');
      if (code === 'outbox-parked' && check.data.ageMinutes !== undefined) data.ageMinutes = field(check.data.ageMinutes, 'number');
      // Every discriminant and schema field was checked above; this restores the correlated union.
      const validated = diagnosticCheck({ code, data } as DiagnosticInput);
      if (check.level !== validated.level) invalid();
      return validated;
    });
    return { context, checks };
  });
  const summary = summarizeDiagnosticChecks(groups);
  const provided = input.summary;
  if (!record(provided) || Object.entries(summary).some(([key, value]) => provided[key] !== value)) invalid();
  return { groups, summary };
}

function environment(options: DiagnosticQueryOptions): NodeJS.ProcessEnv {
  const env = { ...process.env, ...options.env };
  if (options.home === undefined) return env;
  for (const key of Object.keys(env)) if (['HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'CODEX_HOME', 'CODEX_SQLITE_HOME', 'CLAUDE_CONFIG_DIR'].includes(key.toUpperCase())) delete env[key];
  return { ...env, HOME: options.home, USERPROFILE: options.home, CODEX_HOME: join(options.home, '.codex'), CLAUDE_CONFIG_DIR: join(options.home, '.claude'), CROSSCHAT_DIAGNOSTIC_HOME: options.home };
}

function abortError(): Error {
  const error = new Error('Diagnostic query cancelled');
  error.name = 'AbortError';
  return error;
}

/**
 * Run blocking probes in an owned process tree. Thread termination cannot abort
 * a running spawnSync, so production uses a process even though tests may inject
 * a thread-only task. The built isolated.js module lives beside this module.
 */
export async function queryDoctorDiagnostics(options: DiagnosticQueryOptions = {}): Promise<DiagnosticResult> {
  const { signal } = options;
  if (signal?.aborted) throw abortError();
  const thread = options.createWorker?.();
  const env = environment(options);
  const child = thread === undefined
    ? options.createProcess?.({ env }) ?? fork(new URL('./isolated.js', import.meta.url), {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      detached: process.platform !== 'win32',
      windowsHide: true,
      env,
    })
    : undefined;
  const task = thread ?? child!;
  let detach = (): void => {};
  let result: DiagnosticResult;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    result = await new Promise<DiagnosticResult>((resolve, reject) => {
      const onAbort = (): void => { reject(abortError()); };
      const onMessage = (input: unknown): void => {
        if (signal?.aborted) reject(abortError());
        else { try { resolve(parseDiagnosticResult(input)); } catch { reject(new Error('Diagnostic result is malformed.')); } }
      };
      const onError = (error: Error): void => { reject(error); };
      const onExit = (): void => { reject(new Error('Diagnostic isolated task exited without a diagnostic result')); };
      detach = () => {
        signal?.removeEventListener('abort', onAbort);
        task.off('message', onMessage);
        task.off('error', onError);
        task.off('exit', onExit);
      };
      task.on('message', onMessage);
      task.on('error', onError);
      task.on('exit', onExit);
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => reject(Object.assign(new Error('Diagnostic query timed out.'), { name: 'TimeoutError' })), options.timeoutMs ?? 30_000);
      if (signal?.aborted) onAbort();
    });
  } finally {
    clearTimeout(timer);
    detach();
    if (thread !== undefined) await thread.terminate();
    else await terminateProcessTree(child!);
  }
  if (signal?.aborted) throw abortError();
  return result;
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  if (process.platform === 'win32') {
    const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
    await new Promise<void>((resolve, reject) => {
      execFile(taskkill, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, (error) => {
        if (error === null || child.exitCode !== null || child.signalCode !== null) resolve();
        else reject(error);
      });
    });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) {
      if (child.exitCode === null && child.signalCode === null) throw error;
    }
  }
  await exited;
}
