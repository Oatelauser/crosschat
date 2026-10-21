import { execFile, fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';
import type { Worker } from 'node:worker_threads';
import type { DiagnosticResult } from './model.js';

export interface DiagnosticQueryOptions {
  signal?: AbortSignal;
  /** Thread-only test seam. Tasks that spawn subprocesses use createProcess. */
  createWorker?(): Worker;
  /** Query-owned process; on POSIX it must own a detached process group. */
  createProcess?(): ChildProcess;
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
  const child = thread === undefined
    ? options.createProcess?.() ?? fork(new URL('./isolated.js', import.meta.url), {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    })
    : undefined;
  const task = thread ?? child!;
  let detach = (): void => {};
  try {
    return await new Promise<DiagnosticResult>((resolve, reject) => {
      const onAbort = (): void => { reject(abortError()); };
      const onMessage = (result: DiagnosticResult): void => {
        if (signal?.aborted) reject(abortError());
        else resolve(result);
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
      if (signal?.aborted) onAbort();
    });
  } finally {
    detach();
    if (thread !== undefined) await thread.terminate();
    else await terminateProcessTree(child!);
  }
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
