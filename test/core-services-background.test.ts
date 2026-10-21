import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { stopServicesInBackground } from '../src/application/services/background.js';

const roots: string[] = [];
const workers: Worker[] = [];

function fixture(source: string): { root: string; workerFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'crosschat-service-worker-'));
  roots.push(root);
  const workerFile = join(root, 'fixture.mjs');
  writeFileSync(workerFile, `import { parentPort, workerData } from 'node:worker_threads';\n${source}`);
  return { root, workerFile };
}

afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.terminate()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('owned background service stop', () => {
  it('keeps the calling event loop responsive and releases the worker before completing', async () => {
    const { root, workerFile } = fixture(`
      const end = Date.now() + 100;
      while (Date.now() < end) {}
      parentPort.postMessage({ state: 'ready', events: [{ kind: 'none', target: workerData.request.target }] });
      setInterval(() => {}, 1000);
    `);
    let exited = false;
    let job: unknown;
    const done = stopServicesInBackground({ target: 'node' }, {
      baseDir: root,
      createWorker: (_url, options) => {
        job = options.workerData;
        const worker = new Worker(workerFile, options);
        workers.push(worker);
        worker.once('exit', () => { exited = true; });
        return worker;
      },
    });
    const tick = new Promise<string>((resolve) => setImmediate(() => resolve('responsive')));
    expect(await Promise.race([done.then(() => 'completed'), tick])).toBe('responsive');
    expect(await done).toEqual({ state: 'ready', events: [{ kind: 'none', target: 'node' }] });
    expect(job).toEqual({ baseDir: root, request: { target: 'node' } });
    expect(exited).toBe(true);
  });

  it.each([
    'throw new Error("fixture probe failed");',
    'parentPort.close();',
    'parentPort.postMessage({ state: "ready", events: [{ kind: "terminated" }] });',
  ])('returns failed and releases ownership when the worker cannot provide a valid result', async (source) => {
    const { root, workerFile } = fixture(source);
    let exited = false;
    const result = await stopServicesInBackground({ target: 'broker' }, {
      baseDir: root,
      createWorker: (_url, options) => {
        const worker = new Worker(workerFile, options);
        workers.push(worker);
        worker.once('exit', () => { exited = true; });
        return worker;
      },
    });
    expect(result).toMatchObject({ state: 'failed', events: [], error: expect.any(String) });
    expect(exited).toBe(true);
  });
});
