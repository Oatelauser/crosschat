import { parentPort, workerData } from 'node:worker_threads';
import { parseMaintenanceTask } from './index.js';
import { executeMaintenance, previewMaintenance } from './operations.js';

if (parentPort === null) throw new Error('Maintenance task requires its owner worker');
const task = parseMaintenanceTask(workerData);
const options = { home: task.home, sourceDir: task.sourceDir, env: task.env, now: () => task.observedAt };
parentPort.postMessage(task.kind === 'preview' ? previewMaintenance(task.operationId, options)
  : executeMaintenance(task.operationId, task.expectedFingerprint!, options));
