import process from 'node:process';
import { isRecord } from '../queries/reading.js';
import { isLocalManagementRequest, performLocalManagement } from './local-management.js';

if (process.send === undefined) throw new Error('TCP management requires its owner IPC channel');
process.on('disconnect', () => process.exit(0));
let started = false;
process.on('message', (payload: unknown) => {
  if (started) return;
  started = true;
  const report = (result: unknown) => { process.send?.(result, () => {}); };
  if (!isRecord(payload) || typeof payload.baseDir !== 'string' || !isLocalManagementRequest(payload.request)) {
    report({ kind: 'failed', error: '本机管理请求形状无效。' });
    return;
  }
  void performLocalManagement(payload.request, { baseDir: payload.baseDir }).then(report, () => report({ kind: 'failed', error: '本机管理未返回可核实的回执。' }));
});
