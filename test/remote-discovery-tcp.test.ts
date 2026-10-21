import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { createTcpDiscoveryClient } from '../src/application/remote-discovery/tcp.js';
import { Broker } from '../src/serve/broker.js';
import { writeBrokerFile } from '../src/serve/registry.js';
import type { DiscoveryEndpoint } from '../src/application/discovery/model.js';
import { DiscoveryService } from '../src/application/discovery/service.js';
import { createClaudeSessionReader } from '../src/application/sessions/claude-reader.js';
import { NodeClient } from '../src/serve/node.js';
import { FileInbox } from '../src/serve/file-channel.js';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const key = 'a'.repeat(64);
const ownMid = '9999999900000000';
const response = (nextCursor: string | null = null) => ({
  op: 'list' as const,
  providers: [{ providerId: 'future-tool', capabilities: { discovery: true, delivery: false, launch: false, diagnostics: false } }],
  page: { items: [{ ref: { contextId: 'local', providerId: 'future-tool', nativeId: 'full-native-id-not-eight-characters' }, name: null,
    rawStatus: { type: 'idle' }, capabilities: { discovery: true, delivery: false, launch: false, diagnostics: false }, attributes: { extra: true } }],
  nextCursor, completeness: nextCursor === null ? 'complete' as const : 'partial' as const, errors: [], observedAt: 1 },
});

async function fixture(discover: DiscoveryEndpoint['execute']) {
  const dir = mkdtempSync(join(tmpdir(), 'crosschat-discover-tcp-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const registryFile = join(dir, 'broker.json');
  writeBrokerFile(registryFile, { stars: [{ starId: 'star-a', name: 'alpha', nodes: [
    { label: 'node', key, addedAt: '2026-01-01' },
    { label: 'broker-host', key: 'd'.repeat(64), machineId: ownMid, addedAt: '2026-01-01' },
    { label: 'remote-node', key: 'b'.repeat(64), machineId: '1111111122222222', addedAt: '2026-01-01' },
  ] }] });
  const broker = new Broker({ registryFile, statusFile: join(dir, 'status.json'), machineId: () => ownMid, hostname: () => 'broker-host',
    version: 'test', now: Date.now, log: () => undefined, deliverLocal: async (f) => ({ op: 'result', id: f.id, status: 'delivered' }),
    discover, port: 0, heartbeatMs: 60_000 });
  const port = await broker.start();
  cleanups.push(() => broker.stop());
  return { url: `ws://127.0.0.1:${port}`, broker, dir };
}

function client(url: string, targetMachine = 'broker-host') {
  return createTcpDiscoveryClient({ broker: { host: '127.0.0.1', port: Number(new URL(url).port), key, starId: 'star-a' }, targetMachine, timeoutMs: 500 });
}

describe('TCP complete read-only discovery', () => {
  it('reads 100 anonymous sessions across real broker/node WebSockets and resolves full-ID details', async () => {
    const { url, dir } = await fixture(async () => response());
    const directory = join(dir, 'registry');
    mkdirSync(directory);
    for (let index = 0; index < 100; index++) writeFileSync(join(directory, `${index}.json`), JSON.stringify({
      pid: 12345, sessionId: `anonymous-native-session-${index.toString().padStart(3, '0')}`, kind: 'interactive', status: 'idle',
      messagingSocketPath: 'never-expose-this-socket', cwd: '/fixture/project',
    }));
    const service = new DiscoveryService([createClaudeSessionReader({ directory, isProcessAlive: () => true })]);
    const entry = { host: '127.0.0.1', port: Number(new URL(url).port), key: 'b'.repeat(64), starId: 'star-a', name: 'alpha' };
    const node = new NodeClient({ config: { entries: [entry] }, configFile: join(dir, 'node.json'),
      machineId: () => '1111111122222222', fileInbox: new FileInbox({ inboxDir: join(dir, 'inbox'), partsDir: join(dir, 'parts') }),
      makeSendDeps: () => { throw new Error('Discovery must not use messaging dependencies.'); },
      memberProviders: () => [], codexHome: join(dir, 'codex'), attachLabel: dir.split(/[\\/]/).at(-1), memberCheckMs: 60000,
      now: Date.now, log: () => undefined, discover: (request, options) => service.execute(request, options),
    });
    const running = node.run();
    cleanups.push(async () => { await node.stop(); await running; });
    await node.waitForState('online');
    const remote = client(url, 'remote-node');
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await remote.execute({ op: 'list', limit: 21, ...(cursor === undefined ? {} : { cursor }) }, { contextId: 'tcp:alpha:remote-node' });
      if (result.op !== 'list') throw new Error('Expected list response.');
      expect(result.page.errors).toEqual([]);
      expect(JSON.stringify(result)).not.toContain('never-expose-this-socket');
      for (const item of result.page.items) {
        expect(item.name).toBeNull();
        expect(item.ref.contextId).toBe('tcp:alpha:remote-node');
        ids.push(item.ref.nativeId);
      }
      cursor = result.page.nextCursor ?? undefined;
      expect(result.page.completeness).toBe(cursor === undefined ? 'complete' : 'partial');
    } while (cursor !== undefined);
    expect(new Set(ids).size).toBe(100);
    const detail = await remote.execute({ op: 'detail', providerId: 'claude', nativeId: ids[99]! });
    expect(detail).toMatchObject({ op: 'detail', detail: { completeness: 'complete', item: { ref: { nativeId: ids[99] }, attributes: { cwd: '/fixture/project' } } } });
  });

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

  it('reports rejected authentication as an unavailable source', async () => {
    const { url } = await fixture(async () => response());
    const wrong = createTcpDiscoveryClient({ broker: { host: '127.0.0.1', port: Number(new URL(url).port), key: 'e'.repeat(64) }, targetMachine: 'broker-host', timeoutMs: 100 });
    expect(await wrong.execute({ op: 'list' })).toMatchObject({ page: { completeness: 'unavailable' } });
  });
});
