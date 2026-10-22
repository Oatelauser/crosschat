import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { checkServiceGuard, inspectServiceProcesses } from '../src/application/services/inspection.js';

const roots: string[] = [];
const workers: Worker[] = [];
async function fixture(source: string) {
  const baseDir = await mkdtemp(join(tmpdir(), 'crosschat-service-inspect-')); roots.push(baseDir);
  const path = join(baseDir, 'inspect-fixture.mjs');
  await writeFile(path, `import { parentPort, workerData } from 'node:worker_threads';\n${source}`);
  return { baseDir, createWorker: (_url: URL, options: ConstructorParameters<typeof Worker>[1]) => {
    const worker = new Worker(path, options); workers.push(worker); return worker;
  } };
}
afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.terminate()));
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('owned service inspection and guard workers', () => {
  it('keeps blocking inspection outside the input event loop and terminates its worker before returning', async () => {
    const options = await fixture(`const until = Date.now() + 100; while (Date.now() < until) {};
      parentPort.postMessage({ state: 'ready', processes: [{ kind: 'node', pid: 1234, selector: 'fixture' }], confirmedBrokerPids: [] }); setInterval(() => {}, 1000);`);
    let exited = false;
    const create = options.createWorker;
    options.createWorker = (url, config) => { const worker = create(url, config); worker.once('exit', () => { exited = true; }); return worker; };
    const reading = inspectServiceProcesses(options);
    expect(await Promise.race([reading.then(() => 'done'), new Promise<string>((resolve) => setImmediate(() => resolve('responsive')))])).toBe('responsive');
    expect(await reading).toEqual({ state: 'ready', processes: [{ kind: 'node', pid: 1234, selector: 'fixture' }], confirmedBrokerPids: [] });
    expect(exited).toBe(true);
  });

  it('releases a cancelled or timed-out inspector without any process stop operation', async () => {
    const options = await fixture('setInterval(() => {}, 1000);');
    const owner = new AbortController();
    const read = inspectServiceProcesses({ ...options, signal: owner.signal }); owner.abort();
    expect(await read).toMatchObject({ state: 'failed', message: expect.stringMatching(/取消/) });
    expect(await inspectServiceProcesses({ ...options, timeoutMs: 20 })).toMatchObject({ state: 'failed', message: expect.stringMatching(/超时/) });
  });

  it('checks the node guard in an owned worker and validates the received shape instead of trusting worker payload', async () => {
    const options = await fixture(`parentPort.postMessage(workerData.request.kind === 'guard'
      ? { allowed: false, reason: '已有同星节点守护' } : { state: 'ready', processes: [{ pid: 'not-a-pid', kind: 'node' }], confirmedBrokerPids: [] });`);
    expect(await checkServiceGuard('fixture', options)).toEqual({ allowed: false, reason: '已有同星节点守护' });
    expect(await inspectServiceProcesses(options)).toMatchObject({ state: 'failed', processes: [], message: expect.any(String) });
  });
});
