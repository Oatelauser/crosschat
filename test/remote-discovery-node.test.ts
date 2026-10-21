import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { DiscoveryEndpoint, DiscoveryResponse } from '../src/application/discovery/model.js';
import { FileInbox } from '../src/serve/file-channel.js';
import { NodeClient } from '../src/serve/node.js';
import { parseFrame, PROTOCOL_VERSION } from '../src/serve/protocol.js';
import type { Frame } from '../src/serve/protocol.js';

const STAR_ID = 'aaaabbbbcccc';
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function response(): DiscoveryResponse {
  const capabilities = { discovery: true, delivery: false, launch: false, diagnostics: false };
  return { op: 'list', providers: [{ providerId: 'future-provider', capabilities }], page: {
    items: [{ ref: { contextId: 'local', providerId: 'future-provider', nativeId: 'full/native/id/longer-than-eight' }, name: null, rawStatus: { type: 'notLoaded' }, capabilities, attributes: { hint: 17, apiToken: 'hidden-token' } }],
    nextCursor: null, completeness: 'complete', errors: [], observedAt: 1,
  } };
}

class ControlledSocket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING;
  readonly sent: Frame[] = [];
  constructor(private readonly authenticate: boolean) {
    super();
    queueMicrotask(() => {
      this.readyState = WebSocket.OPEN;
      this.emit('open');
      this.receive({ op: 'info', proto: PROTOCOL_VERSION, server: 'fixture', caps: ['multi-star', 'session-members'] });
    });
  }
  receive(frame: unknown): void { this.emit('message', JSON.stringify(frame)); }
  send(data: string): void {
    const frame = parseFrame(data);
    if (frame === undefined) throw new Error('Fixture received invalid frame');
    this.sent.push(frame);
    if (frame.op === 'connect' && this.authenticate) queueMicrotask(() => this.receive({ op: 'connected', starId: STAR_ID, name: 'fixture' }));
    if (frame.op === 'members-query') queueMicrotask(() => this.receive({ op: 'members-result', members: [] }));
  }
  close(): void {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  }
}

async function fixture(discover?: DiscoveryEndpoint['execute'], authenticate = true) {
  const home = mkdtempSync(join(tmpdir(), 'crosschat-node-discovery-'));
  cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, 'tcp'));
  const entry = { host: 'fixture', port: 9, name: 'fixture', starId: STAR_ID, key: 'a'.repeat(64) };
  const configFile = join(home, 'tcp', 'node.json');
  writeFileSync(configFile, JSON.stringify({ brokers: [entry] }));
  const sockets: ControlledSocket[] = [];
  const makeSendDeps = vi.fn(() => { throw new Error('Native/status read must not run'); });
  const client = new NodeClient({
    config: { entries: [entry] }, configFile, machineId: () => 'fixture-node-mid',
    fileInbox: new FileInbox({ inboxDir: join(home, 'inbox'), partsDir: join(home, 'parts') }),
    makeSendDeps, memberProviders: () => [], codexHome: join(home, 'codex'), memberCheckMs: 60000,
    attachLabel: home.split(/[\\/]/).at(-1), backoffBaseMs: 1, now: Date.now, log: () => undefined,
    discover, makeSocket: () => { const socket = new ControlledSocket(authenticate); sockets.push(socket); return socket; },
  });
  const running = client.run();
  cleanups.push(async () => { await client.stop(); await running; });
  if (authenticate) await client.waitForState('online');
  else await vi.waitFor(() => expect(sockets[0]?.sent.some((frame) => frame.op === 'connect')).toBe(true));
  return { client, sockets, makeSendDeps };
}

const query = (id: string, request: unknown = { op: 'list', limit: 100 }) => ({ op: 'discover-query', id, targetMachine: 'fixture-node-mid', request });
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function result(socket: ControlledSocket, id: string) { return socket.sent.find((frame) => frame.op === 'discover-result' && frame.id === id); }

describe('node discovery forwarding lifecycle', () => {
  it('serves only the new injected read endpoint and validates/sanitizes metadata before replying to its original socket', async () => {
    const discover = vi.fn(async () => response());
    const { sockets, makeSendDeps } = await fixture(discover);
    sockets[0].receive(query('read-1'));
    await vi.waitFor(() => expect(result(sockets[0], 'read-1')).toMatchObject({ op: 'discover-result', ok: true, result: { page: { items: [{ name: null, ref: { nativeId: 'full/native/id/longer-than-eight' }, attributes: { hint: 17 } }] } } }));
    expect(JSON.stringify(result(sockets[0], 'read-1'))).not.toContain('hidden-token');
    expect(discover).toHaveBeenCalledWith({ op: 'list', limit: 100 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(makeSendDeps).not.toHaveBeenCalled();
  });

  it('rejects pre-authentication and malformed payloads without starting a read', async () => {
    const discover = vi.fn(async () => response());
    const { sockets, client } = await fixture(discover, false);
    sockets[0].receive(query('before-auth'));
    await tick();
    expect(discover).not.toHaveBeenCalled();
    expect(result(sockets[0], 'before-auth')).toMatchObject({ ok: false, error: 'NOT_AUTHENTICATED' });
    sockets[0].receive({ op: 'connected', starId: STAR_ID, name: 'fixture' });
    await client.waitForState('online');
    sockets[0].receive(query('malformed', { op: 'list', contextId: 'another-user' }));
    await tick();
    expect(result(sockets[0], 'malformed')).toMatchObject({ ok: false, error: 'INVALID_REQUEST' });
    expect(discover).not.toHaveBeenCalled();
  });

  it('returns NOT_READY when no endpoint was injected and never falls back to status', async () => {
    const { sockets, makeSendDeps } = await fixture();
    sockets[0].receive(query('missing-service'));
    await vi.waitFor(() => expect(result(sockets[0], 'missing-service')).toMatchObject({ ok: false, error: 'NOT_READY' }));
    expect(makeSendDeps).not.toHaveBeenCalled();
  });

  it('cancels the matching operation without a late response or deletion of a new owner reusing its ID', async () => {
    const signals: AbortSignal[] = [];
    const resolves: Array<(value: DiscoveryResponse) => void> = [];
    const discover: DiscoveryEndpoint['execute'] = async (_request, options) => {
      if (options?.signal === undefined) throw new Error('Cancellation signal required');
      signals.push(options.signal);
      return new Promise((resolve) => resolves.push(resolve));
    };
    const { sockets } = await fixture(discover);
    const socket = sockets[0];
    socket.receive(query('reused'));
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    socket.receive({ op: 'discover-cancel', id: 'reused' });
    expect(signals[0].aborted).toBe(true);
    socket.receive(query('reused'));
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    resolves[0](response());
    await tick();
    expect(result(socket, 'reused')).toBeUndefined();
    socket.receive({ op: 'discover-cancel', id: 'reused' });
    expect(signals[1].aborted).toBe(true);
    resolves[1](response());
    await tick();
    expect(result(socket, 'reused')).toBeUndefined();
  });

  it('aborts reads on disconnect and never sends the old result through a replacement connection', async () => {
    let signal: AbortSignal | undefined;
    let complete!: (value: DiscoveryResponse) => void;
    const { sockets, client } = await fixture(async (_request, options) => {
      signal = options?.signal;
      return new Promise((resolve) => { complete = resolve; });
    });
    const original = sockets[0];
    original.receive(query('old-connection'));
    await vi.waitFor(() => expect(signal).toBeDefined());
    original.close();
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    await client.waitForState('online');
    expect(signal?.aborted).toBe(true);
    complete(response());
    await tick();
    expect(result(original, 'old-connection')).toBeUndefined();
    expect(result(sockets[1], 'old-connection')).toBeUndefined();
  });

  it.each(['stop', 'revoke'] as const)('aborts an in-flight read when the node is told to %s', async (action) => {
    let signal: AbortSignal | undefined;
    const { sockets, client } = await fixture(async (_request, options) => {
      signal = options?.signal;
      return new Promise(() => undefined);
    });
    sockets[0].receive(query('pending'));
    await vi.waitFor(() => expect(signal).toBeDefined());
    if (action === 'stop') await client.stop();
    else sockets[0].receive({ op: 'credential-revoked', starId: STAR_ID, kind: 'node', reason: 'node-removed', message: 'fixture revokes' });
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    expect(result(sockets[0], 'pending')).toBeUndefined();
  });

  it('rejects duplicate IDs and more than eight pending reads without replacing the existing controllers', async () => {
    const signals: AbortSignal[] = [];
    const discover = vi.fn(async (_request, options) => {
      signals.push(options.signal);
      return new Promise<DiscoveryResponse>(() => undefined);
    });
    const { sockets } = await fixture(discover);
    const socket = sockets[0];
    for (let index = 0; index < 8; index++) socket.receive(query(`pending-${index}`));
    await vi.waitFor(() => expect(discover).toHaveBeenCalledTimes(8));
    socket.receive(query('pending-0'));
    socket.receive(query('overflow'));
    await tick();
    expect(result(socket, 'pending-0')).toMatchObject({ ok: false, error: 'DUPLICATE_REQUEST' });
    expect(result(socket, 'overflow')).toMatchObject({ ok: false, error: 'BUSY' });
    expect(discover).toHaveBeenCalledTimes(8);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
    socket.receive({ op: 'discover-cancel', id: 'pending-0' });
    expect(signals[0].aborted).toBe(true);
  });
});
