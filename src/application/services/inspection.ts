import { Worker } from 'node:worker_threads';
import type { WorkerOptions } from 'node:worker_threads';

export interface ServiceProcess { kind: 'broker' | 'node'; pid: number; selector?: string }
export interface ServiceInspection {
  state: 'ready' | 'failed';
  processes: ServiceProcess[];
  confirmedBrokerPids: number[];
  message?: string;
}
export interface ServiceGuard { allowed: boolean; reason?: string }
export interface ServiceInspectionOptions {
  baseDir: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  createWorker?(url: URL, options: WorkerOptions): Worker;
}
type WorkRequest = { kind: 'inspect' } | { kind: 'guard'; selector: string };
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function pid(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function inspection(value: unknown): value is ServiceInspection {
  return record(value) && (value.state === 'ready' || value.state === 'failed') && Array.isArray(value.processes)
    && value.processes.every((item: unknown) => record(item) && (item.kind === 'broker' || item.kind === 'node') && pid(item.pid) && (item.selector === undefined || typeof item.selector === 'string'))
    && Array.isArray(value.confirmedBrokerPids) && value.confirmedBrokerPids.every(pid) && (value.message === undefined || typeof value.message === 'string');
}
function guard(value: unknown): value is ServiceGuard { return record(value) && typeof value.allowed === 'boolean' && (value.reason === undefined || typeof value.reason === 'string'); }

/** Only the inspector worker is cancelled; it owns no service-start or stop request. */
async function work(request: WorkRequest, options: ServiceInspectionOptions): Promise<unknown> {
  if (options.signal?.aborted) throw new Error('服务核验已取消');
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('服务核验超时配置无效');
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  try {
    worker = (options.createWorker ?? ((url, settings) => new Worker(url, settings)))(new URL('./inspect-worker.js', import.meta.url), { workerData: { baseDir: options.baseDir, request } });
    const owned = worker;
    return await new Promise<unknown>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort); owned.off('message', onMessage); owned.off('error', onError); owned.off('exit', onExit); };
      const onMessage = (value: unknown) => { cleanup(); resolve(value); };
      const onError = () => { cleanup(); reject(new Error('无法核验本机服务进程')); };
      const onExit = () => { cleanup(); reject(new Error('服务核验任务未返回回执')); };
      onAbort = () => { cleanup(); reject(new Error('服务核验已取消')); };
      owned.once('message', onMessage); owned.once('error', onError); owned.once('exit', onExit);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => { cleanup(); reject(new Error('服务核验超时')); }, timeoutMs);
      if (options.signal?.aborted) onAbort();
    });
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort); await worker?.terminate(); }
}

export async function inspectServiceProcesses(options: ServiceInspectionOptions): Promise<ServiceInspection> {
  try {
    const result = await work({ kind: 'inspect' }, options);
    if (!inspection(result)) throw new Error('服务核验回执形状无效');
    return { state: result.state, processes: result.processes.map(({ kind, pid, selector }) => ({ kind, pid, ...(selector === undefined ? {} : { selector }) })), confirmedBrokerPids: [...result.confirmedBrokerPids], ...(result.message === undefined ? {} : { message: result.message }) };
  } catch (error) { return { state: 'failed', processes: [], confirmedBrokerPids: [], message: error instanceof Error ? error.message : '无法核验服务进程' }; }
}

export async function checkServiceGuard(selector: string, options: ServiceInspectionOptions): Promise<ServiceGuard> {
  try {
    const result = await work({ kind: 'guard', selector }, options);
    if (!guard(result)) throw new Error('服务启动核验回执形状无效');
    return { allowed: result.allowed, ...(result.reason === undefined ? {} : { reason: result.reason }) };
  } catch { return { allowed: false, reason: options.signal?.aborted ? '服务启动核验已取消' : '无法核验同星服务占用，请检查本机进程后重试' }; }
}
