import { Worker } from 'node:worker_threads';
import { isAbsolute } from 'node:path';
import { defaultInstallSkillsDeps } from './skills.js';
import { isMaintenanceOperationId, MAINTENANCE_OPERATIONS, parseMaintenancePreview, parseMaintenanceResult } from './model.js';
import type { LocalMaintenance, MaintenanceOperationId } from './model.js';

export type { LocalMaintenance, MaintenanceOperation, MaintenanceOperationId, MaintenancePreview, MaintenanceResult } from './model.js';
export interface MaintenanceTask {
  kind: 'preview' | 'execute';
  operationId: MaintenanceOperationId;
  home: string;
  sourceDir: string;
  env: { LOCALAPPDATA?: string };
  expectedFingerprint?: string;
  observedAt: number;
}
interface MaintenanceOptions {
  home: string;
  env?: NodeJS.ProcessEnv;
  sourceDir?: string;
  now?: () => number;
  timeoutMs?: number;
  /** Worker-only tasks do no subprocess work. The caller owns the returned worker. */
  createWorker?(request: MaintenanceTask): Worker;
}
function cancelled(): Error { return Object.assign(new Error('维护等待已取消；已提交的写入结果需重新核实。'), { name: 'AbortError' }); }
function parseTask(value: unknown): MaintenanceTask {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !('kind' in value) || (value.kind !== 'preview' && value.kind !== 'execute')
    || !('operationId' in value) || !isMaintenanceOperationId(value.operationId) || !('home' in value) || typeof value.home !== 'string' || !isAbsolute(value.home)
    || !('sourceDir' in value) || typeof value.sourceDir !== 'string' || !isAbsolute(value.sourceDir)
    || !('observedAt' in value) || typeof value.observedAt !== 'number' || !Number.isFinite(value.observedAt)
    || !('env' in value) || typeof value.env !== 'object' || value.env === null || Array.isArray(value.env)) throw new Error('Invalid maintenance task');
  const local = 'LOCALAPPDATA' in value.env ? value.env.LOCALAPPDATA : undefined;
  if (local !== undefined && (typeof local !== 'string' || (local !== '' && !isAbsolute(local)))) throw new Error('Invalid maintenance environment');
  const expected = 'expectedFingerprint' in value ? value.expectedFingerprint : undefined;
  if (value.kind === 'execute' && (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))) throw new Error('Invalid maintenance confirmation');
  return { kind: value.kind, operationId: value.operationId, home: value.home, sourceDir: value.sourceDir, observedAt: value.observedAt,
    env: { ...(local === undefined ? {} : { LOCALAPPDATA: local }) }, ...(typeof expected === 'string' ? { expectedFingerprint: expected } : {}) };
}
export { parseTask as parseMaintenanceTask };

/** Keeps blocking filesystem operations, worker lifetime and unknown IPC behind one interface. */
export function createLocalMaintenance(options: MaintenanceOptions): LocalMaintenance {
  const run = async (kind: MaintenanceTask['kind'], operationId: MaintenanceOperationId, signal?: AbortSignal, expectedFingerprint?: string): Promise<unknown> => {
    if (signal?.aborted) throw cancelled();
    const task = parseTask({ kind, operationId, home: options.home, sourceDir: options.sourceDir ?? defaultInstallSkillsDeps().sourceDir(),
      env: { LOCALAPPDATA: options.env?.LOCALAPPDATA }, observedAt: (options.now ?? Date.now)(), expectedFingerprint });
    const worker = options.createWorker?.(task) ?? new Worker(new URL('./isolated.js', import.meta.url), { workerData: task });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let detach = () => {};
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const onAbort = () => reject(cancelled());
        const onMessage = (message: unknown) => {
          if (signal?.aborted) { onAbort(); return; }
          try {
            const result = kind === 'preview' ? parseMaintenancePreview(message) : parseMaintenanceResult(message);
            if (result.operationId !== operationId) throw new Error('Wrong maintenance task');
            resolve(result);
          } catch { reject(new Error('维护任务返回的数据无效；不能据此判断执行完成，请重新预览并核实。')); }
        };
        const onError = () => reject(new Error(kind === 'preview' ? '维护范围无法预览；检查本机来源与权限。' : '维护执行异常，结果待核实；请查看目标路径后重新预览。'));
        const onExit = () => reject(new Error(kind === 'preview' ? '维护预览未返回结果。' : '维护执行未返回结果，可能已有部分写入；请重新核实。'));
        detach = () => { signal?.removeEventListener('abort', onAbort); worker.off('message', onMessage); worker.off('error', onError); worker.off('exit', onExit); };
        worker.on('message', onMessage); worker.on('error', onError); worker.on('exit', onExit);
        signal?.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => reject(Object.assign(new Error(kind === 'preview' ? '维护预览超时；未提交维护操作。' : '维护执行超时，结果待核实；可能已有部分写入。'), { name: 'TimeoutError' })), options.timeoutMs ?? 120_000);
        if (signal?.aborted) onAbort();
      });
    } finally { clearTimeout(timer); detach(); await worker.terminate(); }
  };
  return {
    list: () => MAINTENANCE_OPERATIONS.map((item) => ({ ...item })),
    async preview(request) { return parseMaintenancePreview(await run('preview', request.operationId, request.signal)); },
    async execute(request) { return parseMaintenanceResult(await run('execute', request.operationId, request.signal, request.expectedFingerprint)); },
  };
}
