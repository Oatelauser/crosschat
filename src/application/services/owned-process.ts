import { execFile, fork } from 'node:child_process';
import type { ChildProcess, ForkOptions } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';

export type OwnedServiceFailure = 'cancelled' | 'timeout' | 'start' | 'exit' | 'cleanup';
const messages: Record<OwnedServiceFailure, string> = { cancelled: '服务隔离任务等待已取消。', timeout: '服务隔离任务超时。',
  start: '服务隔离任务无法执行。', exit: '服务隔离任务未返回回执。', cleanup: '服务隔离任务进程树未能完整释放。' };
export class OwnedServiceProcessError extends Error {
  constructor(readonly code: OwnedServiceFailure) {
    super(messages[code]);
    this.name = code === 'cancelled' ? 'AbortError' : code === 'timeout' ? 'TimeoutError' : 'OwnedServiceProcessError';
  }
}
export interface OwnedServiceProcessOptions {
  entry: URL;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** The injected process must have IPC and own a detached process group on POSIX. */
  createProcess?(url: URL, options: ForkOptions): ChildProcess;
}

/**
 * Own a helper and its probe descendants through IPC, cancellation and finally.
 * The helper must keep its IPC owner alive until disposal. Results stay unknown;
 * callers validate their business DTO. Killing a helper cannot roll back writes.
 */
export async function runOwnedServiceProcess(payload: object, options: OwnedServiceProcessOptions): Promise<unknown> {
  if (options.signal?.aborted) throw new OwnedServiceProcessError('cancelled');
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('服务隔离任务超时配置无效。');
  let child: ChildProcess;
  try {
    const settings: ForkOptions = { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], detached: process.platform !== 'win32', windowsHide: true };
    child = options.createProcess?.(options.entry, settings) ?? fork(options.entry, settings);
  } catch { throw new OwnedServiceProcessError('start'); }
  let detach = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: unknown;
  try {
    result = await new Promise<unknown>((resolve, reject) => {
      const onAbort = () => reject(new OwnedServiceProcessError('cancelled'));
      const onMessage = (value: unknown) => { if (options.signal?.aborted) onAbort(); else resolve(value); };
      const onError = () => reject(new OwnedServiceProcessError('start'));
      const onExit = () => reject(new OwnedServiceProcessError('exit'));
      detach = () => { options.signal?.removeEventListener('abort', onAbort); child.off('message', onMessage); child.off('error', onError); child.off('exit', onExit); };
      child.on('message', onMessage); child.on('error', onError); child.on('exit', onExit);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => reject(new OwnedServiceProcessError('timeout')), timeoutMs);
      if (options.signal?.aborted) onAbort();
      else {
        try { child.send(payload, (error) => { if (error) onError(); }); }
        catch { onError(); }
      }
    });
  } finally { clearTimeout(timer); detach(); await terminateOwnedTree(child); }
  if (options.signal?.aborted) throw new OwnedServiceProcessError('cancelled');
  return result;
}

async function terminateOwnedTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  if (process.platform === 'win32') {
    const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
    await new Promise<void>((resolve, reject) => {
      execFile(taskkill, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, (error) => {
        if (error === null || child.exitCode !== null || child.signalCode !== null) resolve();
        else reject(new OwnedServiceProcessError('cleanup'));
      });
    });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch { if (child.exitCode === null && child.signalCode === null) throw new OwnedServiceProcessError('cleanup'); }
  }
  await exited;
}
