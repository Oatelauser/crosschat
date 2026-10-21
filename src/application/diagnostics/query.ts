import { Worker } from 'node:worker_threads';
import type { DiagnosticResult } from './model.js';

export interface DiagnosticQueryOptions {
  signal?: AbortSignal;
  /** Isolated execution seam; the query owns and terminates the returned worker. */
  createWorker?(): Worker;
}

function abortError(): Error {
  const error = new Error('Diagnostic query cancelled');
  error.name = 'AbortError';
  return error;
}

/**
 * Run existing blocking probes off the caller loop. Each query owns one worker;
 * success, failure and cancellation all detach listeners and await termination.
 * This path targets the built package, where worker.js is beside this module.
 */
export async function queryDoctorDiagnostics(options: DiagnosticQueryOptions = {}): Promise<DiagnosticResult> {
  const { signal } = options;
  if (signal?.aborted) throw abortError();
  const worker = options.createWorker?.() ?? new Worker(new URL('./worker.js', import.meta.url));
  let detach = (): void => {};
  try {
    return await new Promise<DiagnosticResult>((resolve, reject) => {
      const onAbort = (): void => { reject(abortError()); };
      const onMessage = (result: DiagnosticResult): void => {
        if (signal?.aborted) reject(abortError());
        else resolve(result);
      };
      const onError = (error: Error): void => { reject(error); };
      const onExit = (): void => { reject(new Error('Diagnostic worker exited without a diagnostic result')); };
      detach = () => {
        signal?.removeEventListener('abort', onAbort);
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);
      };
      worker.on('message', onMessage);
      worker.on('error', onError);
      worker.on('exit', onExit);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  } finally {
    detach();
    await worker.terminate();
  }
}
