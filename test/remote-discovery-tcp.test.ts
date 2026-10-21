import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { createTcpDiscoveryClient } from '../src/application/remote-discovery/tcp.js';
import { Broker } from '../src/serve/broker.js';
import { writeBrokerFile } from '../src/serve/registry.js';
import { PROTOCOL_VERSION } from '../src/serve/protocol.js';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const key = 'a'.repeat(64);
const response = (nextCursor: string | null = null) => ({
  op: 'list' as const,
  providers: [{ providerId: 'future-tool', capabilities: { discovery: true, delivery: false, launch: false, diagnostics: false } }],
  page: { items: [{ ref: { contextId: 'local', providerId: 'future-tool', nativeId: 'full-native-id-not-eight-characters' }, name: null,
    rawStatus: { type: 'idle' }, capabilities: { discovery: true, delivery: false, launch: false, diagnostics: false }, attributes: { extra: true } }],
  nextCursor, completeness: nextCursor === null ? 'complete' as const : 'partial' as const, errors: [], observedAt: 1 },
});

async function fixture(discover: (...args: any[]) => Promise<any>) {
  const dir = mkdtempSync(join(tmpdir(), 'crosschat-discover-tcp-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const registryFile = join(dir, 'broker.json');
  writeBrokerFile(registryFile, { version: 1, stars: [{ starId: 'star-a', name: 'alpha', nodes: [{ label: 'node', key, addedAt: '2026-01-01' }] }] });
  const broker = new Broker({ registryFile, statusFile: join(dir, 'status.json'), machineId: 'broker-full-id', hostname: 'broker-host',
    version: 'test', now: Date.now, log: () => undefined, deliverLocal: async (f) => ({ op: 'result', id: f.id, status: 'delivered' }),
    discover, port: 0, heartbeatMs: 60_000 });
  const port = await broker.start();
  cleanups.push(() => broker.stop());
  return { url: `ws://127.0.0.1:${port}`, broker };
}

function client(url: string, targetMachine = 'broker-host') {
  return createTcpDiscoveryClient({ broker: { host: '127.0.0.1', port: Number(new URL(url).port), key, starId: 'star-a' }, targetMachine, timeoutMs: 500 });
}

describe('TCP complete read-only discovery', () => {
  it('uses a dedicated endpoint, preserves full anonymous references and future Provider attributes', async () => {
    const discover = vi.fn(async () => response());
    const { url } = await fixture(discover);
    const result = await client(url).execute({ op: 'list', limit: 100 }, { contextId: 'tcp:alpha:broker' });
    expect(result).toMatchObject({ op: 'list', page: { completeness: 'complete', items: [{ name: null,
      ref: { contextId: 'tcp:alpha:broker', providerId: 'future-tool', nativeId: 'full-native-id-not-eight-characters' }, attributes: { extra: true } }] } });
    expect(discover).toHaveBeenCalledWith({ op: 'list', limit: 100 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('binds cursors to target/context/filter and sends only the native cursor back to the same machine', async () => {
    const discover = vi.fn().mockResolvedValueOnce(response('native-cursor')).mockResolvedValue(response());
    const { url } = await fixture(discover);
    const first = await client(url).execute({ op: 'list', limit: 21 }, { contextId: 'tcp:alpha:broker' });
    if (first.op !== 'list' || first.page.nextCursor === null) throw new Error('cursor required');
    const wrong = await client(url, 'another-node').execute({ op: 'list', limit: 21, cursor: first.page.nextCursor }, { contextId: 'tcp:alpha:broker' });
    expect(wrong).toMatchObject({ page: { completeness: 'unavailable', errors: [expect.objectContaining({ kind: 'invalid-cursor' })] } });
    expect(discover).toHaveBeenCalledOnce();
    await client(url).execute({ op: 'list', limit: 21, cursor: first.page.nextCursor }, { contextId: 'tcp:alpha:broker' });
    expect(discover.mock.calls[1]?.[0]).toEqual({ op: 'list', limit: 21, cursor: 'native-cursor' });
  });

  it('cancels the broker-owned local read and discards late results', async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    let signal: AbortSignal | undefined;
    const { url } = await fixture(async (_request, options) => {
      signal = options.signal;
      started();
      await new Promise<void>((resolve) => options.signal.addEventListener('abort', () => resolve(), { once: true }));
      return response();
    });
    const controller = new AbortController();
    const pending = client(url).execute({ op: 'list' }, { signal: controller.signal });
    await ready;
    controller.abort();
    expect(await pending).toMatchObject({ page: { completeness: 'cancelled', items: [] } });
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  });

  it('disposes a socket cancelled before the broker sends handshake information', async () => {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('address required');
    const accepted = new Promise<WebSocket>((resolve) => server.once('connection', resolve));
    const controller = new AbortController();
    const pending = client(`ws://127.0.0.1:${address.port}`).execute({ op: 'list' }, { signal: controller.signal });
    const socket = await accepted;
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    controller.abort();
    expect(await pending).toMatchObject({ page: { completeness: 'cancelled' } });
    await closed;
    expect(server.clients.size).toBe(0);
  });

  it('keeps explicit revocation separate from ordinary unreachable source errors', async () => {
    const { url } = await fixture(async () => response());
    const wrong = createTcpDiscoveryClient({ broker: { host: '127.0.0.1', port: Number(new URL(url).port), key: 'b'.repeat(64) }, targetMachine: 'broker-host', timeoutMs: 100 });
    expect(await wrong.execute({ op: 'list' })).toMatchObject({ page: { completeness: 'unavailable' } });
  });
});
