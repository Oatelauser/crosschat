import { Worker } from 'node:worker_threads';
import type { WorkerOptions } from 'node:worker_threads';
import type { ServiceStopEvent, ServiceStopRequest, ServiceStopResult } from './local.js';

export interface BackgroundStopDeps {
  baseDir: string;
  createWorker?(url: URL, options: WorkerOptions): Worker;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isStopEvent(value: unknown): value is ServiceStopEvent {
  if (!isRecord(value)) return false;
  const target = value.target === 'broker' || value.target === 'node';
  switch (value.kind) {
    case 'none': return target;
    case 'selector-missing': return typeof value.selector === 'string';
    case 'ghost-reset': return target && Array.isArray(value.files) && value.files.every((file: unknown) => typeof file === 'string');
    case 'terminated': return target && typeof value.pid === 'number' &&
      (value.selector === undefined || typeof value.selector === 'string') &&
      (value.port === undefined || typeof value.port === 'number');
    case 'terminate-failed': return target && typeof value.pid === 'number';
    case 'unconfirmed': return typeof value.pid === 'number' && typeof value.port === 'number';
    default: return false;
  }
}

function isStopResult(value: unknown): value is ServiceStopResult {
  return isRecord(value) && (value.state === 'ready' || value.state === 'failed') &&
    Array.isArray(value.events) && value.events.every(isStopEvent) &&
    (value.error === undefined || typeof value.error === 'string');
}

function failure(error: unknown): ServiceStopResult {
  return { state: 'failed', events: [], error: error instanceof Error ? error.message : String(error) };
}

/**
 * The worker owns the entire stop operation, including blocking OS probes. There is no
 * cancellation: callers may discard a late result; the operation still finishes and releases its worker.
 */
export async function stopServicesInBackground(request: ServiceStopRequest, deps: BackgroundStopDeps): Promise<ServiceStopResult> {
  let worker: Worker | undefined;
  let result: ServiceStopResult;
  try {
    const createWorker = deps.createWorker ?? ((url, options) => new Worker(url, options));
    worker = createWorker(new URL('./stop-worker.js', import.meta.url), { workerData: { baseDir: deps.baseDir, request } });
    const ownedWorker = worker;
    result = await new Promise<ServiceStopResult>((resolve) => {
      ownedWorker.once('message', (value: unknown) => resolve(isStopResult(value) ? value : failure('后台服务停机回执形状异常')));
      ownedWorker.once('error', (error) => resolve(failure(error)));
      ownedWorker.once('exit', (code) => resolve(failure(`后台服务停机任务未返回回执（退出码 ${code}）`)));
    });
  } catch (error) {
    result = failure(error);
  }
  try {
    await worker?.terminate();
  } catch (error) {
    result = failure(error);
  }
  return result;
}
