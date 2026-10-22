import process from 'node:process';
import { Worker } from 'node:worker_threads';

if (process.send === undefined) throw new Error('Service stop requires its owner IPC channel');
// The parent owns this process tree, including any OS scanner started by the worker.
process.on('disconnect', () => process.exit(0));
let started = false;
process.on('message', (payload: unknown) => {
  if (started) return;
  started = true;
  let reported = false;
  const report = (value: unknown) => {
    if (reported) return;
    reported = true;
    const result = value !== null && typeof value === 'object' ? value
      : { state: 'failed', events: [], error: '服务停止回执形状无效' };
    process.send?.(result, () => {});
  };
  try {
    // Reuse the existing validated stop task and its exact selector/PID safeguards.
    const worker = new Worker(new URL('./stop-worker.js', import.meta.url), { workerData: payload });
    worker.once('message', report);
    worker.once('error', () => report({ state: 'failed', events: [], error: '服务停止任务失败，结果待核实' }));
    worker.once('exit', () => report({ state: 'failed', events: [], error: '服务停止任务未返回回执，结果待核实' }));
  } catch { report({ state: 'failed', events: [], error: '服务停止任务无法启动' }); }
});
