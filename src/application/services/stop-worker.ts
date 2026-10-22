import { parentPort, workerData } from 'node:worker_threads';
import { stopServices } from './local.js';
import type { ServiceStopRequest } from './local.js';

function request(value: unknown): ServiceStopRequest {
  if (value !== null && typeof value === 'object') {
    let expectedPids: number[] | undefined;
    if ('expectedPids' in value) {
      if (!Array.isArray(value.expectedPids) || !value.expectedPids.length || !value.expectedPids.every((pid: unknown) => typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0)
        || new Set(value.expectedPids).size !== value.expectedPids.length) throw new Error('后台服务停机目标 PID 无效');
      expectedPids = value.expectedPids;
    }
    const fixed = expectedPids === undefined ? {} : { expectedPids };
    if ('target' in value && (value.target === 'broker' || value.target === 'node' || value.target === 'both')) return { target: value.target, ...fixed };
    if ('selector' in value && typeof value.selector === 'string') return { selector: value.selector, ...fixed };
  }
  throw new Error('后台服务停机请求形状异常');
}

if (parentPort === null) throw new Error('服务停机任务须由专属 worker 启动');
try {
  const input: unknown = workerData;
  if (input === null || typeof input !== 'object' || !('baseDir' in input) || typeof input.baseDir !== 'string' || !('request' in input)) {
    throw new Error('后台服务停机任务缺少配置目录或请求');
  }
  parentPort.postMessage(stopServices(request(input.request), { baseDir: input.baseDir }));
} catch (error) {
  parentPort.postMessage({ state: 'failed', events: [], error: error instanceof Error ? error.message : String(error) });
} finally {
  parentPort.close();
}
