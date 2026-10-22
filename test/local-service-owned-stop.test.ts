import { execFile, fork } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import type { ChildProcess, ForkOptions } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stopServicesOwned } from '../src/application/services/owned-stop.js';
import * as ownedStop from '../src/application/services/owned-stop.js';
import * as background from '../src/application/services/background.js';
import { createLocalServices } from '../src/application/services/managed.js';

const roots: string[] = [];
const children: ChildProcess[] = [];
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
async function release(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => execFile(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve()));
  } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Fixture may already have exited. */ } }
}
async function fixture() {
  const baseDir = await mkdtemp(join(tmpdir(), 'crosschat-owned-stop-')); roots.push(baseDir);
  const marker = join(baseDir, 'scanner.json');
  const scan = join(baseDir, 'blocked-scanner.mjs');
  const job = join(baseDir, 'stop-job.mjs');
  await writeFile(scan, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, JSON.stringify({pid:process.pid,parentPid:process.ppid}));setInterval(()=>{},1000);`);
  await writeFile(job, `import { execFileSync } from 'node:child_process';\nprocess.on('message',()=>{execFileSync(process.execPath,[${JSON.stringify(scan)}],{stdio:'ignore'});process.send({state:'ready',events:[]});});`);
  const createProcess = (_entry: URL, options: ForkOptions) => { const child = fork(job, [], options); children.push(child); return child; };
  async function started() {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) { try { return JSON.parse(await readFile(marker, 'utf8')) as { pid: number; parentPid: number }; } catch { await delay(10); } }
    throw new Error('Controlled stop scanner never started.');
  }
  return { baseDir, createProcess, started };
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(children.splice(0).map(release)); await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('TUI owned service stop process trees', () => {
  it('releases a hung OS scanner and its helper before completing cancellation without claiming the external stop was undone', async () => {
    const f = await fixture(); const owner = new AbortController();
    const stopping = stopServicesOwned({ selector: 'fixture', expectedPids: [1234] }, { baseDir: f.baseDir, createProcess: f.createProcess, signal: owner.signal, timeoutMs: 5000 });
    const scan = await f.started(); expect(alive(scan.pid)).toBe(true); owner.abort();
    expect(await stopping).toMatchObject({ state: 'failed', events: [], error: expect.stringMatching(/待核实|未撤销/) });
    expect(alive(scan.pid)).toBe(false); expect(alive(scan.parentPid)).toBe(false);
  }, 10_000);

  it('bounds a nonresponding stop job and reclaims its full scanner tree on timeout', async () => {
    const f = await fixture();
    const stopping = stopServicesOwned({ selector: 'fixture', expectedPids: [1234] }, { baseDir: f.baseDir, createProcess: f.createProcess, timeoutMs: 1000 });
    const scan = await f.started();
    expect(await stopping).toMatchObject({ state: 'failed', error: expect.stringMatching(/超时|待核实/) });
    expect(alive(scan.pid)).toBe(false); expect(alive(scan.parentPid)).toBe(false);
  }, 10_000);

  it('does not create a stop job for an already cancelled request', async () => {
    const f = await fixture(); const owner = new AbortController(); owner.abort();
    const createProcess = vi.fn(f.createProcess);
    expect(await stopServicesOwned({ selector: 'fixture' }, { baseDir: f.baseDir, signal: owner.signal, createProcess })).toMatchObject({ state: 'failed' });
    expect(createProcess).not.toHaveBeenCalled();
  });

  it('uses the owned stop default from the managed task and waits for tree cleanup before returning an uncertain issued result', async () => {
    const f = await fixture();
    await mkdir(join(f.baseDir, 'tcp')); await writeFile(join(f.baseDir, 'tcp', 'node.json'), JSON.stringify({ brokers: [{ host: 'fixture.invalid', port: 7260, name: 'fixture', starId: 'full-star-fixture', key: 'fixture-secret' }] }));
    const original = ownedStop.stopServicesOwned;
    const runner = vi.spyOn(ownedStop, 'stopServicesOwned').mockImplementation((request, options) => original(request, { ...options, createProcess: f.createProcess }));
    const oldRunner = vi.spyOn(background, 'stopServicesInBackground').mockImplementation(() => new Promise(() => {}));
    const service = createLocalServices({ baseDir: f.baseDir, env: {}, entryPath: '/isolated/dist/cli.js',
      readStatuses: async () => ({ items: [], completeness: 'complete', observedAt: 100, errors: [] }), inspect: async () => ({ state: 'ready', processes: [{ kind: 'node', pid: 1234, selector: 'fixture' }], confirmedBrokerPids: [] }) });
    const item = (await service.read({ contextId: 'local' })).items.find((item) => item.kind === 'node')!;
    const owner = new AbortController();
    const operation = service.execute({ contextId: 'local', id: item.id, revision: item.revision, operation: 'stop', signal: owner.signal });
    const scan = await f.started(); owner.abort();
    expect(await operation).toMatchObject({ state: 'unconfirmed', message: expect.stringMatching(/待核实|未撤销/) });
    expect(runner).toHaveBeenCalledWith({ selector: 'fixture', expectedPids: [1234] }, expect.objectContaining({ signal: owner.signal }));
    expect(oldRunner).not.toHaveBeenCalled(); expect(alive(scan.pid)).toBe(false); expect(alive(scan.parentPid)).toBe(false);
  }, 10_000);
});
