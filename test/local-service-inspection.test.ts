import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
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
async function builtOwner() {
  const baseDir = await mkdtemp(join(tmpdir(), 'crosschat-service-tree-')); roots.push(baseDir);
  await writeFile(join(baseDir, 'package.json'), '{"type":"module"}');
  for (const name of ['inspection', 'owned-process', 'inspect-process']) {
    const source = await readFile(new URL(`../src/application/services/${name}.ts`, import.meta.url), 'utf8');
    await writeFile(join(baseDir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText);
  }
  return { baseDir, isolated: await import(pathToFileURL(join(baseDir, 'inspection.js')).href) };
}
afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.terminate()));
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('owned service inspection and guard workers', () => {
  it('reclaims an inspector blocked in spawnSync, including its owned probe child, before cancellation returns', async () => {
    const { baseDir, isolated } = await builtOwner();
    const marker = join(baseDir, 'probe-pid');
    const childCode = `require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);`;
    const blocked = `import process from 'node:process';import {spawnSync} from 'node:child_process';process.on('disconnect',()=>process.exit(0));spawnSync(process.execPath,['-e',${JSON.stringify(childCode)}]);`;
    // The old thread owner and the new process owner run the identical controlled
    // blocking probe. Neither file performs a real OS scan or touches user data.
    await writeFile(join(baseDir, 'inspect-worker.js'), blocked);
    await writeFile(join(baseDir, 'inspect-process.js'), blocked);
    const owner = new AbortController();
    const pending = isolated.inspectServiceProcesses({ baseDir, signal: owner.signal });
    let childPid: number | undefined;
    try {
      const deadline = Date.now() + 3000;
      while (childPid === undefined && Date.now() < deadline) {
        try { childPid = Number(await readFile(marker, 'utf8')); }
        catch { await new Promise<void>((resolve) => setTimeout(resolve, 10)); }
      }
      expect(childPid).toBeGreaterThan(0);
      owner.abort();
      // Tree cleanup uses the OS taskkill operation on Windows; preserve a
      // bounded wait without confusing normal OS scheduling with a leaked tree.
      const outcome = await Promise.race([pending.then(() => 'released'), new Promise<string>((resolve) => setTimeout(() => resolve('still-blocked-after-owner-budget'), 1500))]);
      expect(outcome).toBe('released');
      expect(() => process.kill(childPid!, 0)).toThrow();
      expect(await pending).toMatchObject({ state: 'failed', message: expect.stringContaining('取消') });
    } finally {
      owner.abort();
      if (childPid !== undefined) { try { process.kill(childPid, 'SIGKILL'); } catch { /* Already reaped by the owner. */ } }
      await pending;
    }
  });

  it('uses the real process wrapper for successful inspection/guard IPC and releases it before returning', async () => {
    const { baseDir, isolated } = await builtOwner();
    await writeFile(join(baseDir, 'inspect-worker.js'), `import {parentPort,workerData} from 'node:worker_threads';parentPort.postMessage(workerData.request.kind==='guard'
      ? {allowed:false,reason:'已有受控同星守护'} : {state:'ready',processes:[{kind:'node',pid:1234,selector:'fixture'}],confirmedBrokerPids:[]});setInterval(()=>{},1000);`);
    const children: ChildProcess[] = [];
    const createProcess = (url: URL, options: Parameters<typeof fork>[1]) => { const child = fork(url, options); children.push(child); return child; };
    try {
      expect(await isolated.inspectServiceProcesses({ baseDir, createProcess })).toEqual({ state: 'ready', processes: [{ kind: 'node', pid: 1234, selector: 'fixture' }], confirmedBrokerPids: [] });
      expect(await isolated.checkServiceGuard('fixture', { baseDir, createProcess })).toEqual({ allowed: false, reason: '已有受控同星守护' });
      for (const child of children) expect(() => process.kill(child.pid!, 0)).toThrow();
    } finally { for (const child of children) { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); } }
  });

  it('reclaims a real wrapper and its controlled blocked probe when its read timeout expires', async () => {
    const { baseDir, isolated } = await builtOwner();
    const marker = join(baseDir, 'probe-pid');
    const childCode = `require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);`;
    await writeFile(join(baseDir, 'inspect-worker.js'), `import {spawnSync} from 'node:child_process';spawnSync(process.execPath,['-e',${JSON.stringify(childCode)}]);`);
    let childPid: number | undefined;
    const pending = isolated.inspectServiceProcesses({ baseDir, timeoutMs: 1500 });
    try {
      const deadline = Date.now() + 1200;
      while (childPid === undefined && Date.now() < deadline) {
        try { childPid = Number(await readFile(marker, 'utf8')); }
        catch { await new Promise<void>((resolve) => setTimeout(resolve, 10)); }
      }
      expect(childPid).toBeGreaterThan(0);
      expect(await pending).toMatchObject({ state: 'failed', message: expect.stringContaining('超时') });
      expect(() => process.kill(childPid!, 0)).toThrow();
    } finally { if (childPid !== undefined) { try { process.kill(childPid, 'SIGKILL'); } catch { /* Already owned and reaped. */ } } await pending; }
  });

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
