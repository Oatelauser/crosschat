import { createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { Broker, defaultDeliverLocal } from '../src/serve/broker.js';
import type { BrokerDeps } from '../src/serve/broker.js';
import { CAP_MULTI_STAR, encodeFrame, parseFrame } from '../src/serve/protocol.js';
import type { DiscoverQueryFrame, Frame, SocketLike } from '../src/serve/protocol.js';
import type { DiscoveryEndpoint, DiscoveryResponse } from '../src/application/discovery/index.js';
import { registryFileOf } from '../src/serve/registry.js';
import { seedBroker } from './helpers/broker-seed.js';

const STAR = 'aaaabbbbcccc';
const OTHER_STAR = 'ddddeeeeffff';
const OWN_MID = '9999999900000000';
const TARGET_MID = '1111111122222222';
const OTHER_MID = '3333333344444444';
const SOURCE_KEY = 'a'.repeat(64);
const TARGET_KEY = 'b'.repeat(64);
const OTHER_KEY = 'c'.repeat(64);
const SELF_KEY = 'd'.repeat(64);
const ADMIN_KEY = 'e'.repeat(64);
const cleanups: Array<() => Promise<void>> = [];
type DiscoveryDeps = BrokerDeps & { discover?: DiscoveryEndpoint['execute'] };

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
});

const capabilities = { discovery: true, delivery: false, launch: false, diagnostics: true };
function response(nativeId = 'opaque/full/native-id'): Extract<DiscoveryResponse, { op: 'list' }> {
  return {
    op: 'list', providers: [{ providerId: 'future-provider', capabilities }],
    page: { items: [{ ref: { contextId: 'local', providerId: 'future-provider', nativeId }, name: null, rawStatus: { type: 'notLoaded' }, attributes: { cwd: '/fixture' }, capabilities }], nextCursor: null, completeness: 'complete', errors: [], observedAt: 123 },
  };
}

class Socket extends EventEmitter implements SocketLike {
  readyState: number = WebSocket.OPEN;
  readonly frames: Frame[] = [];
  send(text: string): void {
    const frame = parseFrame(text);
    if (frame === undefined) throw new Error('broker sent invalid frame');
    this.frames.push(frame);
    this.emit('sent', frame);
  }
  receive(frame: Frame): void { this.emit('message', encodeFrame(frame)); }
  close(): void {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  }
  async wait(op: Frame['op'], id?: string): Promise<Frame> {
    const matching = () => this.frames.find((frame) => frame.op === op && (id === undefined || ('id' in frame && frame.id === id)));
    await expect.poll(matching, { timeout: 800 }).toBeDefined();
    return matching()!;
  }
  query(id: string, targetMachine = TARGET_MID): void {
    this.receive({ op: 'discover-query', id, targetMachine, request: { op: 'list', limit: 21 } });
  }
}

async function fixture(overrides: Partial<DiscoveryDeps> = {}): Promise<{
  broker: Broker; file: string;
  member: (key?: string, machineId?: string) => Socket;
  admin: () => Socket;
}> {
  const directory = mkdtempSync(join(tmpdir(), 'crosschat-broker-discovery-'));
  const file = registryFileOf(directory);
  const addedAt = '2026-10-21T00:00:00.000Z';
  seedBroker(file, { stars: [
    { starId: STAR, name: 'alpha', nodes: [
      { label: 'source', key: SOURCE_KEY, addedAt },
      { label: 'target', key: TARGET_KEY, machineId: TARGET_MID, addedAt },
      { label: 'self', key: SELF_KEY, machineId: OWN_MID, addedAt },
      { label: 'admin', adminKey: ADMIN_KEY, addedAt },
    ] },
    { starId: OTHER_STAR, name: 'beta', nodes: [{ label: 'target', key: OTHER_KEY, machineId: OTHER_MID, addedAt }] },
  ] });
  const broker = new Broker({
    registryFile: file, statusFile: join(directory, 'status.json'), version: 'test', machineId: () => OWN_MID,
    hostname: () => 'broker', now: () => Date.now(), log: () => {}, deliverLocal: defaultDeliverLocal,
    port: 0, heartbeatMs: 60_000, connectTimeoutMs: 5_000, resultTimeoutMs: 2_000, authFailDelayMs: 1,
    ...overrides,
  });
  await broker.start();
  const sockets: Socket[] = [];
  cleanups.push(async () => {
    for (const socket of sockets) socket.close();
    await broker.stop();
    rmSync(directory, { recursive: true, force: true });
  });
  const socket = (): Socket => {
    const value = new Socket();
    sockets.push(value);
    broker.admitLocal(value, STAR);
    return value;
  };
  return {
    broker, file,
    member: (key = SOURCE_KEY, machineId) => {
      const value = socket();
      value.receive({ op: 'connect', proto: 1, role: machineId === undefined ? 'sender' : 'node', auth: key, machineId, caps: [CAP_MULTI_STAR] });
      expect(value.frames.some((frame) => frame.op === 'connected')).toBe(true);
      return value;
    },
    admin: () => {
      const value = socket();
      value.receive({ op: 'connect', proto: 1, role: 'sender', admin: true, caps: [CAP_MULTI_STAR] });
      const challenge = value.frames.find((frame) => frame.op === 'auth-challenge');
      if (challenge?.op !== 'auth-challenge') throw new Error('missing admin challenge');
      value.receive({ op: 'auth-proof', proof: createHmac('sha256', ADMIN_KEY).update(challenge.nonce).digest('hex') });
      expect(value.frames.some((frame) => frame.op === 'connected')).toBe(true);
      return value;
    },
  };
}

async function forwarded(socket: Socket): Promise<DiscoverQueryFrame> {
  const frame = await socket.wait('discover-query');
  if (frame.op !== 'discover-query') throw new Error('expected discovery query');
  return frame;
}

describe('broker read-only discovery routing', () => {
  it('executes the local endpoint without status fallback or registry writes and validates metadata', async () => {
    const discover = vi.fn(async () => response());
    const scanStatus = vi.fn();
    const f = await fixture({ discover, scanStatus });
    const source = f.member();
    const before = readFileSync(f.file, 'utf8');
    source.query('local-list', OWN_MID);
    expect(await source.wait('discover-result', 'local-list')).toMatchObject({ ok: true, result: response() });
    expect(discover).toHaveBeenCalledWith({ op: 'list', limit: 21 }, { contextId: 'local', signal: expect.any(AbortSignal) });
    expect(scanStatus).not.toHaveBeenCalled();
    expect(readFileSync(f.file, 'utf8')).toBe(before);
  });

  it('routes only within the authenticated star with unique broker ids and rejects forged results', async () => {
    const f = await fixture();
    const source = f.member();
    const target = f.member(TARGET_KEY, TARGET_MID);
    const intruder = f.member();
    const neighbor = f.member(OTHER_KEY, OTHER_MID);
    source.query('original-id');
    const query = await forwarded(target);
    expect(query.id).not.toBe('original-id');
    expect(query.request).toEqual({ op: 'list', limit: 21 });
    intruder.receive({ op: 'discover-result', id: query.id, ok: true, result: response('forged-same-star') });
    neighbor.receive({ op: 'discover-result', id: query.id, ok: true, result: response('forged-other-star') });
    expect(source.frames.some((frame) => frame.op === 'discover-result')).toBe(false);
    target.receive({ op: 'discover-result', id: query.id, ok: true, result: response() });
    expect(await source.wait('discover-result', 'original-id')).toMatchObject({ ok: true, result: response() });
    source.query('cross-star', OTHER_MID);
    expect(await source.wait('error', 'cross-star')).toMatchObject({ code: 'UNKNOWN_MACHINE' });
    expect(neighbor.frames.some((frame) => frame.op === 'discover-query')).toBe(false);
  });

  it('keeps identical sender request ids independent and cancels only the owning sender read', async () => {
    const f = await fixture();
    const first = f.member();
    const second = f.member();
    const target = f.member(TARGET_KEY, TARGET_MID);
    first.query('same-id');
    second.query('same-id');
    await expect.poll(() => target.frames.filter((frame) => frame.op === 'discover-query').length).toBe(2);
    const queries = target.frames.filter((frame): frame is DiscoverQueryFrame => frame.op === 'discover-query');
    expect(queries[0]!.id).not.toBe(queries[1]!.id);
    first.receive({ op: 'discover-cancel', id: 'same-id' });
    expect(target.frames.filter((frame) => frame.op === 'discover-cancel')).toEqual([{ op: 'discover-cancel', id: queries[0]!.id }]);
    target.receive({ op: 'discover-result', id: queries[0]!.id, ok: true, result: response('late-cancelled') });
    target.receive({ op: 'discover-result', id: queries[1]!.id, ok: true, result: response('second-request') });
    expect(await second.wait('discover-result', 'same-id')).toMatchObject({ result: response('second-request') });
    expect(first.frames.some((frame) => frame.op === 'discover-result')).toBe(false);
  });

  it('aborts local cancellation and drops a late successful endpoint response', async () => {
    let signal: AbortSignal | undefined;
    let finish!: (value: DiscoveryResponse) => void;
    const f = await fixture({ discover: async (_request, options) => {
      signal = options?.signal;
      return await new Promise<DiscoveryResponse>((resolve) => { finish = resolve; });
    } });
    const source = f.member();
    source.query('local-cancel', OWN_MID);
    await expect.poll(() => signal).toBeDefined();
    source.receive({ op: 'discover-cancel', id: 'local-cancel' });
    expect(signal!.aborted).toBe(true);
    finish(response('late-local'));
    await Promise.resolve();
    expect(source.frames.some((frame) => frame.op === 'discover-result')).toBe(false);
  });

  it('caps each sender at eight reads and rejects duplicate active ids without replacing an existing read', async () => {
    const f = await fixture();
    const source = f.member();
    const target = f.member(TARGET_KEY, TARGET_MID);
    source.query('request-0');
    source.query('request-0');
    expect(await source.wait('error', 'request-0')).toMatchObject({ code: 'BAD_PROTO' });
    for (let i = 1; i <= 8; i++) source.query(`request-${i}`);
    expect(await source.wait('error', 'request-8')).toMatchObject({ code: 'BAD_PROTO' });
    expect(target.frames.filter((frame) => frame.op === 'discover-query')).toHaveLength(8);
    source.receive({ op: 'discover-cancel', id: 'request-0' });
    source.query('request-9');
    expect(target.frames.filter((frame) => frame.op === 'discover-query')).toHaveLength(9);
  });

  it.each(['source-close', 'target-close', 'source-revoked', 'target-revoked'])('cleans remote reads on %s and ignores late results', async (event) => {
    const f = await fixture();
    const source = f.member();
    const target = f.member(TARGET_KEY, TARGET_MID);
    const admin = f.admin();
    source.query('disconnected-read');
    const query = await forwarded(target);
    if (event === 'source-close') source.close();
    if (event === 'target-close') target.close();
    if (event.endsWith('revoked')) admin.receive({ op: 'admin-op', id: 'remove', action: 'remove-node', label: event.startsWith('source') ? 'source' : 'target' });
    if (event.startsWith('source')) {
      expect(target.frames).toContainEqual({ op: 'discover-cancel', id: query.id });
    } else {
      expect(await source.wait('error', 'disconnected-read')).toMatchObject({ code: event === 'target-revoked' ? 'CREDENTIAL_REVOKED' : 'PEER_OFFLINE' });
    }
    target.receive({ op: 'discover-result', id: query.id, ok: true, result: response('late') });
    expect(source.frames.some((frame) => frame.op === 'discover-result')).toBe(false);
  });

  it('aborts local reads on broker stop without forwarding late success', async () => {
    let signal: AbortSignal | undefined;
    let finish!: (value: DiscoveryResponse) => void;
    const f = await fixture({ discover: async (_request, options) => {
      signal = options?.signal;
      return await new Promise<DiscoveryResponse>((resolve) => { finish = resolve; });
    } });
    const source = f.member();
    source.query('stopping-read', OWN_MID);
    await expect.poll(() => signal).toBeDefined();
    await f.broker.stop();
    expect(signal!.aborted).toBe(true);
    finish(response());
    await Promise.resolve();
    expect(source.frames.some((frame) => frame.op === 'discover-result')).toBe(false);
  });

  it.each(['close', 'revoked'])('aborts a local read when its source is %s', async (event) => {
    let signal: AbortSignal | undefined;
    const discover = vi.fn<DiscoveryEndpoint['execute']>(async (_request, options) => {
      signal = options?.signal;
      return await new Promise<DiscoveryResponse>(() => {});
    });
    const f = await fixture({ discover });
    const source = f.member();
    const admin = f.admin();
    source.query('local-owner', OWN_MID);
    await expect.poll(() => signal).toBeDefined();
    if (event === 'close') source.close();
    else admin.receive({ op: 'admin-op', id: 'revoke-source', action: 'remove-node', label: 'source' });
    expect(signal!.aborted).toBe(true);
  });

  it('registers a remote read before forwarding so a synchronous virtual result is delivered', async () => {
    const f = await fixture();
    const source = f.member();
    const target = f.member(TARGET_KEY, TARGET_MID);
    target.on('sent', (frame: Frame) => {
      if (frame.op === 'discover-query') target.receive({ op: 'discover-result', id: frame.id, ok: true, result: response() });
    });
    source.query('synchronous-result');
    expect(await source.wait('discover-result', 'synchronous-result')).toMatchObject({ ok: true });
  });

  it('does not start new reads re-entered synchronously from cancellation while stopping', async () => {
    const discover = vi.fn<DiscoveryEndpoint['execute']>(async (_request, options) => {
      if (discover.mock.calls.length === 1) options?.signal?.addEventListener('abort', () => source.query('during-stop', OWN_MID), { once: true });
      return await new Promise<DiscoveryResponse>(() => {});
    });
    const f = await fixture({ discover });
    const source = f.member();
    source.query('before-stop', OWN_MID);
    expect(discover).toHaveBeenCalledTimes(1);
    await f.broker.stop();
    expect(discover).toHaveBeenCalledTimes(1);
    expect(source.frames).toContainEqual(expect.objectContaining({ op: 'error', id: 'during-stop', code: 'PEER_OFFLINE' }));
  });

  it('cancels a timed-out remote read and reports an explicit error without success', async () => {
    const f = await fixture({ resultTimeoutMs: 40 });
    const source = f.member();
    const target = f.member(TARGET_KEY, TARGET_MID);
    source.query('timeout');
    const query = await forwarded(target);
    expect(await source.wait('error', 'timeout')).toMatchObject({ code: 'PEER_OFFLINE' });
    expect(target.frames).toContainEqual({ op: 'discover-cancel', id: query.id });
    target.receive({ op: 'discover-result', id: query.id, ok: true, result: response() });
    expect(source.frames.some((frame) => frame.op === 'discover-result')).toBe(false);
  });

  it('does not call status when discovery is unavailable and rejects malformed discovery payloads', async () => {
    const scanStatus = vi.fn();
    const f = await fixture({ scanStatus });
    const source = f.member();
    source.query('missing-endpoint', OWN_MID);
    expect(await source.wait('error', 'missing-endpoint')).toMatchObject({ code: 'NOT_READY' });
    source.emit('message', JSON.stringify({ op: 'discover-query', id: 'invalid-payload', targetMachine: OWN_MID, request: { op: 'list', limit: 0 } }));
    expect(await source.wait('error', 'invalid-payload')).toMatchObject({ code: 'BAD_PROTO' });
    expect(scanStatus).not.toHaveBeenCalled();
  });

  it('rejects oversized or malformed endpoint results and suppresses sensitive exception text', async () => {
    const secret = 'private-key-must-not-leak';
    const discover = vi.fn<DiscoveryEndpoint['execute']>()
      .mockRejectedValueOnce(new Error(secret))
      .mockResolvedValueOnce(response())
      .mockImplementationOnce(async () => {
        const value = response();
        if (value.op === 'list') value.page.items[0]!.attributes = { huge: 'x'.repeat(2 * 1024 * 1024) };
        return value;
      });
    const f = await fixture({ discover });
    const source = f.member();
    source.query('throw', OWN_MID);
    expect(await source.wait('discover-result', 'throw')).toMatchObject({ ok: false });
    expect(JSON.stringify(source.frames)).not.toContain(secret);
    source.emit('message', JSON.stringify({ op: 'discover-query', id: 'malformed-result', targetMachine: OWN_MID, request: { op: 'detail', providerId: 'future-provider', nativeId: 'native' } }));
    expect(await source.wait('error', 'malformed-result')).toMatchObject({ code: 'BAD_PROTO' });
    source.query('oversized', OWN_MID);
    expect(await source.wait('error', 'oversized')).toMatchObject({ code: 'BAD_PROTO' });
  });
});
