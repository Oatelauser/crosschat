import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalServices } from '../src/application/services/managed.js';
import type { LocalService, LocalServiceOperation, ServiceInspection } from '../src/application/services/managed.js';
import type { ServiceSnapshot } from '../src/application/queries/services.js';

const homes: string[] = [];
const signal = () => new AbortController().signal;
const entry = { host: 'fixture.invalid', port: 7260, starId: 'full-star-identity', name: 'fixture', key: 'fixture-secret-key' };
const inspected: ServiceInspection = { state: 'ready', processes: [], confirmedBrokerPids: [] };
async function fixture() {
  const baseDir = await mkdtemp(join(tmpdir(), 'crosschat-local-services-')); homes.push(baseDir);
  await mkdir(join(baseDir, 'tcp'));
  const config = join(baseDir, 'tcp', 'node.json');
  await writeFile(config, JSON.stringify({ brokers: [entry] }));
  await writeFile(join(baseDir, 'tcp', 'broker.json'), JSON.stringify({ port: 7260, stars: [] }));
  const statuses: ServiceSnapshot[] = [];
  const readStatuses = vi.fn(async () => ({ items: statuses, completeness: 'complete' as const, errors: [], observedAt: 100 }));
  const inspect = vi.fn(async () => inspected);
  const guard = vi.fn(async () => ({ allowed: true }));
  const launch = vi.fn(() => ({ state: 'starting' as const, target: 'node' as const, pid: 1234, logFile: '/isolated/node-fixture.log', statusFile: '/isolated/status-node-fixture.json', requestedAt: 100 }));
  const waitReady = vi.fn(async () => ({ state: 'ready' as const, target: 'node' as const, pid: 1234, logFile: '/isolated/node-fixture.log', statusFile: '/isolated/status-node-fixture.json', requestedAt: 100 }));
  const stop = vi.fn(async () => ({ state: 'ready' as const, events: [{ kind: 'terminated' as const, target: 'node' as const, pid: 1234, selector: 'full-star' }] }));
  const service = createLocalServices({ baseDir, env: { FIXTURE: 'true' }, entryPath: '/isolated/dist/cli.js', readStatuses, inspect, guard, launch, waitReady, stop, now: () => 100 });
  const rows = () => service.read({ contextId: 'local', signal: signal() });
  const request = (row: LocalService, operation: LocalServiceOperation) => ({ contextId: 'local', id: row.id, revision: row.revision, operation, signal: signal() });
  return { baseDir, config, statuses, service, rows, request, inspect, guard, launch, waitReady, stop };
}
afterEach(async () => { await Promise.all(homes.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('managed local service tasks', () => {
  it('lists an unstarted broker and configured nodes without launching, stopping or exposing credentials', async () => {
    const f = await fixture();
    const before = await readFile(f.config, 'utf8');
    const page = await f.rows();
    expect(page.completeness).toBe('complete');
    expect(page.items.map((item) => item.kind)).toEqual(['broker', 'node']);
    const node = page.items[1];
    expect(node).toMatchObject({ label: 'fixture', state: 'not-running', selector: 'fixture', sourceId: 'node:node-fixture.log', start: { allowed: true }, stop: { allowed: false } });
    expect(node.id).not.toContain(entry.key);
    expect(JSON.stringify(page)).not.toContain(entry.key);
    expect(f.launch).not.toHaveBeenCalled(); expect(f.guard).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    expect(await readFile(f.config, 'utf8')).toBe(before);
  });

  it('maps a live prefix-spelled node to the complete configured identity and stops only its literal selector', async () => {
    const f = await fixture();
    f.inspect.mockResolvedValue({ ...inspected, processes: [{ kind: 'node', pid: 1234, selector: 'full-star' }] });
    const node = (await f.rows()).items.find((item) => item.kind === 'node')!;
    expect(node).toMatchObject({ state: 'running', pid: 1234, start: { allowed: false }, stop: { allowed: true } });
    const checked = await f.service.check(f.request(node, 'stop'));
    expect(checked).toMatchObject({ allowed: true });
    expect(checked.impact.join('\n')).toContain('1234');
    expect(checked.impact.join('\n')).toContain('full-star');
    expect(await f.service.execute(f.request(node, 'stop'))).toMatchObject({ state: 'ready' });
    expect(f.stop).toHaveBeenCalledWith({ selector: 'full-star' });
    expect(f.launch).not.toHaveBeenCalled();
  });

  it('refuses stale confirmation targets after credential or process changes', async () => {
    const f = await fixture();
    const configured = (await f.rows()).items[1];
    await writeFile(f.config, JSON.stringify({ brokers: [{ ...entry, key: 'replacement-fixture-key' }] }));
    expect(await f.service.execute(f.request(configured, 'start'))).toMatchObject({ state: 'failed', message: expect.stringMatching(/变化|失效|重新/) });
    f.inspect.mockResolvedValue({ ...inspected, processes: [{ kind: 'node', pid: 1234, selector: 'fixture' }] });
    const running = (await f.rows()).items[1];
    f.inspect.mockResolvedValue({ ...inspected, processes: [{ kind: 'node', pid: 5678, selector: 'fixture' }] });
    expect(await f.service.execute(f.request(running, 'stop'))).toMatchObject({ state: 'failed' });
    expect(f.launch).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });

  it('does not describe a bare-selector daemon, ambiguous configuration or failed inspection as safely stoppable', async () => {
    const f = await fixture();
    f.inspect.mockResolvedValue({ ...inspected, processes: [{ kind: 'node', pid: 1234, selector: '' }] });
    expect((await f.rows()).items[1].stop).toMatchObject({ allowed: false, reason: expect.stringMatching(/全部|裸/) });
    await writeFile(f.config, JSON.stringify({ brokers: [entry, { ...entry, host: 'other.invalid', key: 'other-fixture-secret' }] }));
    expect((await f.rows()).items.filter((item) => item.kind === 'node').every((item) => !item.start.allowed)).toBe(true);
    f.inspect.mockResolvedValue({ state: 'failed', processes: [], confirmedBrokerPids: [], message: '进程来源不可用' });
    const page = await f.rows();
    expect(page.completeness).toBe('partial');
    expect(page.items.every((item) => !item.start.allowed && !item.stop.allowed)).toBe(true);
    expect(f.stop).not.toHaveBeenCalled();
  });

  it('reuses the same-star guard before launch and only reports ready after owned readiness evidence', async () => {
    const f = await fixture();
    const node = (await f.rows()).items[1];
    f.guard.mockResolvedValue({ allowed: false, reason: '本机 broker 已内挂此星聚合器' });
    expect(await f.service.execute(f.request(node, 'start'))).toMatchObject({ state: 'failed', message: expect.stringContaining('已内挂') });
    expect(f.launch).not.toHaveBeenCalled();
    f.guard.mockResolvedValue({ allowed: true });
    f.waitReady.mockResolvedValue({ state: 'failed', reason: 'readiness-timeout', error: '未确认就绪', pid: 1234 });
    expect(await f.service.execute(f.request(node, 'start'))).toMatchObject({ state: 'unconfirmed', pid: 1234, message: expect.stringMatching(/未确认|待核实/) });
    expect(f.launch).toHaveBeenCalledWith({ extraArgs: ['--connect', 'fixture'], logName: 'node-fixture.log' });
    expect(f.waitReady).toHaveBeenCalledOnce();
    f.waitReady.mockResolvedValue({ state: 'ready', target: 'node', pid: 1234, logFile: '/isolated/node-fixture.log', statusFile: '/isolated/status-node-fixture.json', requestedAt: 100 });
    expect(await f.service.execute(f.request(node, 'start'))).toMatchObject({ state: 'ready', pid: 1234 });
  });

  it('cancels before issuing a request and never claims an issued startup was rolled back', async () => {
    const f = await fixture();
    const node = (await f.rows()).items[1];
    const owner = new AbortController(); owner.abort();
    expect(await f.service.execute({ ...f.request(node, 'start'), signal: owner.signal })).toMatchObject({ state: 'cancelled' });
    expect(f.launch).not.toHaveBeenCalled();
    f.waitReady.mockResolvedValue({ state: 'failed', reason: 'cancelled', error: '启动请求未撤销', pid: 1234 });
    expect(await f.service.execute(f.request(node, 'start'))).toMatchObject({ state: 'unconfirmed', message: expect.stringContaining('未撤销') });
    expect(f.stop).not.toHaveBeenCalled();
    expect((await f.service.read({ contextId: 'ssh:other', signal: signal() })).completeness).toBe('unavailable');
  });

  it('rejects a configuration revision changed while an asynchronous guard was running', async () => {
    const f = await fixture();
    const node = (await f.rows()).items[1];
    let release = () => {};
    let entered = () => {};
    const guarded = new Promise<void>((resolve) => { entered = resolve; });
    f.guard.mockImplementation(async () => { entered(); await new Promise<void>((resolve) => { release = resolve; }); return { allowed: true }; });
    const action = f.service.execute(f.request(node, 'start')); await guarded;
    await writeFile(f.config, JSON.stringify({ brokers: [{ ...entry, name: 'renamed' }] }));
    await f.rows();
    release();
    expect(await action).toMatchObject({ state: 'failed' });
    expect(f.launch).not.toHaveBeenCalled();
  });

  it('routes running service logs to the actual matching snapshot filename after the configured name changes', async () => {
    const f = await fixture();
    f.inspect.mockResolvedValue({ ...inspected, processes: [{ kind: 'node', pid: 1234, selector: 'full-star' }] });
    f.statuses.push({ file: 'status-node-old-name.json', kind: 'node', selector: 'old-name', state: 'online', pid: 1234, processAlive: true, freshness: 'fresh', readiness: 'ready', lastUpdated: new Date(100).toISOString() });
    expect((await f.rows()).items[1].sourceId).toBe('node:node-old-name.log');
  });

  it('keeps duplicate configured targets from producing duplicate row identities', async () => {
    const f = await fixture();
    await writeFile(f.config, JSON.stringify({ brokers: [entry, entry] }));
    const page = await f.rows();
    expect(new Set(page.items.map((item) => item.id)).size).toBe(page.items.length);
    expect(page.items.filter((item) => item.kind === 'node').every((item) => !item.start.allowed)).toBe(true);
  });

  it('does not describe termination of a replacement PID as successful termination of the selected process', async () => {
    const f = await fixture();
    f.inspect.mockResolvedValue({ ...inspected, processes: [{ kind: 'node', pid: 1234, selector: 'full-star' }] });
    const node = (await f.rows()).items[1];
    f.stop.mockResolvedValue({ state: 'ready', events: [{ kind: 'terminated', target: 'node', pid: 5678, selector: 'full-star' }] });
    expect(await f.service.execute(f.request(node, 'stop'))).toMatchObject({ state: 'unconfirmed' });
  });
});
