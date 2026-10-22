import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const workers: Worker[] = [];
async function fixture(source: 'inspect-worker' | 'stop-worker') {
  const baseDir = await mkdtemp(join(tmpdir(), 'crosschat-service-boundary-')); roots.push(baseDir);
  await mkdir(join(baseDir, 'tcp'));
  const original = await readFile(new URL(`../src/application/services/${source}.ts`, import.meta.url), 'utf8');
  const built = ts.transpileModule(original, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const modules = ['../../errors.js', '../../serve/broker.js', '../../serve/registry.js', './guard.js', './processes.js', './local.js'];
  let isolated = built;
  for (const module of modules) isolated = isolated.replaceAll(`'${module}'`, "'./isolated-deps.mjs'");
  await writeFile(join(baseDir, 'isolated-deps.mjs'), `import { join } from 'node:path';
    export class MultichatError extends Error {};
    export const DEFAULT_PORT = 7260;
    export const tcpDir = (base) => join(base, 'tcp');
    export const guardSameStarDaemon = () => {};
    export const listServeProcesses = () => [{ pid: 1234, cmdline: 'node /fixture/dist/cli.js serve --connect fixture' }, { pid: 9999, cmdline: 'node /fixture/dist/cli.js serve' }];
    export const connectValueOf = (value) => value.includes('--connect') ? 'fixture' : undefined;
    export const pidsOnPort = () => new Set([9999]);
    export const stopServices = (request) => ({ state: 'ready', events: [{ kind: 'terminated', target: 'node', pid: request.expectedPids?.[0] ?? 7777 }] });`);
  const path = join(baseDir, 'worker.mjs'); await writeFile(path, isolated);
  return { baseDir, path };
}
async function run(path: string, workerData: unknown): Promise<unknown> {
  const worker = new Worker(path, { workerData }); workers.push(worker);
  try { return await new Promise<unknown>((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); }); }
  finally { await worker.terminate(); }
}
afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.terminate()));
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('actual service worker boundaries with isolated system dependencies', () => {
  it('bounds broker metadata reads independently of known process evidence', async () => {
    const f = await fixture('inspect-worker');
    await writeFile(join(f.baseDir, 'tcp', 'broker.json'), JSON.stringify({ stars: [], padding: 'x'.repeat(2 * 1024 * 1024) }));
    expect(await run(f.path, { baseDir: f.baseDir, request: { kind: 'inspect' } })).toMatchObject({ state: 'ready', processes: expect.arrayContaining([{ kind: 'node', pid: 1234, selector: 'fixture' }]), confirmedBrokerPids: [] });
  });
  it('retains known node processes when broker port metadata is malformed without rebuilding the registry', async () => {
    const f = await fixture('inspect-worker');
    const file = join(f.baseDir, 'tcp', 'broker.json');
    await writeFile(file, '{broken-fixture');
    expect(await run(f.path, { baseDir: f.baseDir, request: { kind: 'inspect' } })).toMatchObject({ state: 'ready', processes: [{ kind: 'node', pid: 1234 }, { kind: 'broker', pid: 9999 }], confirmedBrokerPids: [] });
    expect(await readFile(file, 'utf8')).toBe('{broken-fixture');
    expect(await readdir(join(f.baseDir, 'tcp'))).toEqual(['broker.json']);
  });

  it.each([{ expectedPids: ['1234'] }, { expectedPids: [-1] }, { expectedPids: [1.2] }, { expectedPids: [1234, 1234] }, { expectedPids: [] }])('rejects invalid fixed process targets $expectedPids before calling the stop operation', async ({ expectedPids }) => {
    const f = await fixture('stop-worker');
    expect(await run(f.path, { baseDir: f.baseDir, request: { selector: 'fixture', expectedPids } })).toMatchObject({ state: 'failed', events: [] });
  });

  it('passes a valid fixed process target through the actual stop worker', async () => {
    const f = await fixture('stop-worker');
    expect(await run(f.path, { baseDir: f.baseDir, request: { selector: 'fixture', expectedPids: [1234] } })).toMatchObject({ state: 'ready', events: [{ pid: 1234 }] });
  });
});
