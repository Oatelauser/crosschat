import type { ChildProcess, ForkOptions } from 'node:child_process';
import { isServiceStopResult } from './background.js';
import { OwnedServiceProcessError, runOwnedServiceProcess } from './owned-process.js';
import type { ServiceStopEvent, ServiceStopRequest, ServiceStopResult } from './local.js';

export interface OwnedStopOptions {
  baseDir: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  createProcess?(entry: URL, options: ForkOptions): ChildProcess;
}
function failed(message: string): ServiceStopResult { return { state: 'failed', events: [], error: message }; }
function cleanEvent(event: ServiceStopEvent): ServiceStopEvent {
  switch (event.kind) {
    case 'none': return { kind: event.kind, target: event.target };
    case 'selector-missing': return { kind: event.kind, selector: event.selector };
    case 'ghost-reset': return { kind: event.kind, target: event.target, files: [...event.files] };
    case 'terminated': return { kind: event.kind, target: event.target, pid: event.pid,
      ...(event.selector === undefined ? {} : { selector: event.selector }), ...(event.port === undefined ? {} : { port: event.port }) };
    case 'terminate-failed': return { kind: event.kind, target: event.target, pid: event.pid };
    case 'unconfirmed': return { kind: event.kind, pid: event.pid, port: event.port };
  }
}

/**
 * TUI stop requests own their helper and synchronous scanner descendants. Cancelling
 * the helper cannot undo a signal already sent to an external service process.
 * The original noncancellable background API remains available to its other callers.
 */
export async function stopServicesOwned(request: ServiceStopRequest, options: OwnedStopOptions): Promise<ServiceStopResult> {
  try {
    const result = await runOwnedServiceProcess({ baseDir: options.baseDir, request }, {
      entry: new URL('./stop-process.js', import.meta.url), signal: options.signal, timeoutMs: options.timeoutMs ?? 30_000, createProcess: options.createProcess,
    });
    if (!isServiceStopResult(result) || Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024 || result.events.length > 10_000
      || result.events.some((event) => 'pid' in event && (!Number.isSafeInteger(event.pid) || event.pid <= 0))) {
      return failed('停止作业返回无效回执；已发出的操作未撤销，结果待核实。');
    }
    return { state: result.state, events: result.events.map(cleanEvent),
      ...(result.error === undefined ? {} : { error: '所选服务停止未取得有效完成回执；可能尚未发送停止信号，也可能已有部分操作，请核实目标。' }) };
  } catch (error) {
    const code = error instanceof OwnedServiceProcessError ? error.code : undefined;
    return failed(code === 'cancelled' ? '停止作业已停止等待并释放辅助进程；已发出的外部停止信号未撤销，结果待核实。'
      : code === 'timeout' ? '停止作业超时，已释放辅助进程；已发出的外部停止信号未撤销，结果待核实。'
      : code === 'cleanup' ? '停止作业辅助进程树未能完整释放；结果待核实，请检查本机进程。'
      : '停止作业未取得有效回执；已发出的操作未撤销，结果待核实。');
  }
}
