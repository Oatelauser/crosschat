import { EventEmitter } from 'node:events';
import { spawn as spawnChild } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSshDiscoveryClient } from '../src/application/discovery/index.js';

class FakeSshChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => { queueMicrotask(() => this.emit('close', null)); return true; });
  input = '';
  constructor() {
    super();
    this.stdin.on('data', (chunk: Buffer) => { this.input += chunk.toString('utf8'); });
  }
  finish(response: unknown, code = 0): void {
    this.stdout.write(JSON.stringify(response));
    this.emit('close', code);
  }
}

const response = (nextCursor: string | null = null) => ({
  op: 'list', providers: [{ providerId: 'third-provider', capabilities: { discovery: true, delivery: false, launch: false, diagnostics: false } }],
  page: { items: [{ ref: { contextId: 'local', providerId: 'third-provider', nativeId: 'complete/native/id' }, name: null, rawStatus: { type: 'future' }, capabilities: { discovery: true, delivery: false, launch: false, diagnostics: false }, attributes: { hint: 17 } }],
    nextCursor, completeness: nextCursor === null ? 'complete' : 'partial', errors: [], observedAt: 3 },
});

afterEach(() => { vi.useRealTimers(); });

describe('read-only SSH discovery transport', () => {
  it('runs the fixed discover command and sends hostile opaque values only as stdin JSON', async () => {
    const child = new FakeSshChild();
    const spawn = vi.fn(() => child);
    const client = createSshDiscoveryClient({ host: 'fixture-host', spawn });
    const request = { op: 'list' as const, filter: { text: '"; $(touch ignored); & powershell' } };
    const pending = client.execute(request, { contextId: 'ssh:fixture-host' });
    child.finish(response());
    expect(await pending).toMatchObject({ op: 'list', page: { items: [{ ref: { contextId: 'ssh:fixture-host', nativeId: 'complete/native/id' } }] } });
    expect(spawn).toHaveBeenCalledWith('ssh', ['-T', '-o', 'BatchMode=yes', '--', 'fixture-host', 'crosschat', 'discover'], expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }));
    expect(JSON.parse(child.input)).toEqual(request);
    expect(JSON.stringify(spawn.mock.calls[0])).not.toContain('touch ignored');
  });

  it('binds paged cursors to the SSH target and restores the original cursor only on the same context', async () => {
    const children = [new FakeSshChild(), new FakeSshChild()];
    let index = 0;
    const spawn = vi.fn(() => children[index++]);
    const client = createSshDiscoveryClient({ host: 'fixture', spawn });
    const pending = client.execute({ op: 'list', limit: 21 }, { contextId: 'ssh:fixture' });
    children[0].finish(response('native-next'));
    const first = await pending;
    if (first.op !== 'list' || first.page.nextCursor === null) throw new Error('Expected a cursor');
    const wrong = await client.execute({ op: 'list', cursor: first.page.nextCursor, limit: 21 }, { contextId: 'ssh:other' });
    expect(wrong).toMatchObject({ page: { items: [], completeness: 'unavailable', errors: [expect.objectContaining({ kind: 'invalid-cursor' })] } });
    expect(spawn).toHaveBeenCalledOnce();
    const next = client.execute({ op: 'list', cursor: first.page.nextCursor, limit: 21 }, { contextId: 'ssh:fixture' });
    children[1].finish(response());
    await next;
    expect(JSON.parse(children[1].input).cursor).toBe('native-next');
  });

  it('kills the SSH child on cancellation, removes listeners and discards late output', async () => {
    const child = new FakeSshChild();
    const controller = new AbortController();
    const pending = createSshDiscoveryClient({ host: 'fixture', spawn: () => child }).execute({ op: 'list' }, { signal: controller.signal });
    controller.abort();
    const result = await pending;
    expect(child.kill).toHaveBeenCalled();
    expect(result).toMatchObject({ page: { items: [], completeness: 'cancelled', errors: [expect.objectContaining({ kind: 'cancelled' })] } });
    child.finish(response());
    expect(result).toMatchObject({ page: { items: [] } });
    expect(child.stdout.listenerCount('data')).toBe(0);
    expect(child.stderr.listenerCount('data')).toBe(0);
  });

  it('times out, kills the child and reports an unavailable source without stderr secrets', async () => {
    vi.useFakeTimers();
    const child = new FakeSshChild();
    const pending = createSshDiscoveryClient({ host: 'fixture', spawn: () => child, timeoutMs: 20 }).execute({ op: 'list' });
    child.stderr.write('hidden-admin-key');
    await vi.advanceTimersByTimeAsync(20);
    expect(await pending).toMatchObject({ page: { completeness: 'unavailable', items: [], errors: [expect.objectContaining({ kind: 'unavailable' })] } });
    expect(child.kill).toHaveBeenCalled();
    expect(JSON.stringify(await pending)).not.toContain('hidden-admin-key');
  });

  it('rejects unsafe hosts before spawning and cancelled requests start no process', async () => {
    const spawn = vi.fn(() => new FakeSshChild());
    for (const host of ['-oProxyCommand=bad', 'host;bad', 'host with space', '']) expect(() => createSshDiscoveryClient({ host, spawn })).toThrow();
    const controller = new AbortController();
    controller.abort();
    expect(await createSshDiscoveryClient({ host: 'fixture', spawn }).execute({ op: 'list' }, { signal: controller.signal })).toMatchObject({ page: { completeness: 'cancelled' } });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('rejects malformed or mismatched remote JSON without trying the old status command', async () => {
    const child = new FakeSshChild();
    const spawn = vi.fn(() => child);
    const pending = createSshDiscoveryClient({ host: 'fixture', spawn }).execute({ op: 'list' });
    child.finish({ op: 'detail', providers: [], detail: { item: null, completeness: 'complete', errors: [], observedAt: 1 } });
    expect(await pending).toMatchObject({ page: { completeness: 'unavailable', errors: [expect.objectContaining({ kind: 'malformed' })] } });
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('reaps an owned, controlled process when a live SSH read is cancelled', async () => {
    let child: ReturnType<typeof spawnChild> | undefined;
    let closed: Promise<number | null> | undefined;
    const controller = new AbortController();
    const client = createSshDiscoveryClient({ host: 'fixture', spawn: (_command, _args, options) => {
      const controlled = spawnChild(process.execPath, ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000);'], options);
      child = controlled;
      closed = new Promise((resolve) => controlled.once('close', resolve));
      return controlled;
    } });
    const pending = client.execute({ op: 'list' }, { signal: controller.signal });
    controller.abort();
    expect(await pending).toMatchObject({ page: { completeness: 'cancelled' } });
    await closed;
    expect(child?.killed).toBe(true);
  });
});
