import process from 'node:process';
import { Worker } from 'node:worker_threads';

if (process.send === undefined) throw new Error('Service inspection requires its owner IPC channel');
// Keeping this owner alive ensures disposal can kill the entire synchronous probe tree.
process.on('disconnect', () => process.exit(0));
let started = false;
process.on('message', (payload: unknown) => {
  if (started) return;
  started = true;
  let reported = false;
  const report = (value: unknown) => {
    if (reported) return;
    reported = true;
    const message = value !== null && typeof value === 'object' ? value
      : { state: 'failed', processes: [], confirmedBrokerPids: [], message: '服务核验回执形状无效' };
    process.send?.(message, () => {});
  };
  try {
    const worker = new Worker(new URL('./inspect-worker.js', import.meta.url), { workerData: payload });
    worker.once('message', report);
    worker.once('error', () => report({ state: 'failed', processes: [], confirmedBrokerPids: [], message: '无法核验本机服务进程' }));
    worker.once('exit', () => report({ state: 'failed', processes: [], confirmedBrokerPids: [], message: '服务核验任务未返回回执' }));
  } catch { report({ state: 'failed', processes: [], confirmedBrokerPids: [], message: '服务核验任务无法启动' }); }
});
