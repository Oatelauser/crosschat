import { createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { Broker, defaultDeliverLocal } from '../src/serve/broker.js';
import { CAP_MULTI_STAR, CAP_SESSION_MEMBERS } from '../src/serve/protocol.js';
import type { SocketLike } from '../src/serve/protocol.js';
import { loadBrokerFile, mutateBrokerFile, registryFileOf } from '../src/serve/registry.js';
import { seedBroker } from './helpers/broker-seed.js';

type Packet = Record<string, unknown> & { op: string };
const STAR_A = 'aaaabbbbcccc';
const STAR_B = 'ddddeeeeffff';
const KEY_A = 'a'.repeat(64);
const KEY_KEEP = 'b'.repeat(64);
const KEY_B = 'c'.repeat(64);
const ADMIN_A = 'd'.repeat(64);
const ADMIN_KEEP = 'e'.repeat(64);
const ADMIN_B = 'f'.repeat(64);
const MID_A = '1111111122222222';
const MID_KEEP = '3333333344444444';
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
});

function packet(text: string): Packet {
  const value: unknown = JSON.parse(text);
  if (typeof value !== 'object' || value === null || !('op' in value) || typeof value.op !== 'string') {
    throw new Error('invalid broker packet');
  }
  return value;
}

class Client {
  readonly ws: WebSocket;
  readonly frames: Packet[] = [];
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (data) => this.frames.push(packet(String(data))));
  }
  send(frame: Packet): void {
    this.ws.send(JSON.stringify(frame));
  }
  async wait(op: string, id?: string): Promise<Packet> {
    await expect.poll(() => this.frames.find((f) => f.op === op && (id === undefined || f.id === id)), { timeout: 1_000 }).toBeDefined();
    return this.frames.find((f) => f.op === op && (id === undefined || f.id === id))!;
  }
  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    const done = new Promise<void>((resolve) => this.ws.once('close', () => resolve()));
    this.ws.close();
    await done;
  }
}

/** close deliberately defers its event, like an already queued network frame. */
class DeferredCloseSocket extends EventEmitter implements SocketLike {
  readyState: number = WebSocket.OPEN;
  readonly frames: Packet[] = [];
  closes = 0;
  send(text: string): void { this.frames.push(packet(text)); }
  receive(frame: Packet): void { this.emit('message', JSON.stringify(frame)); }
  close(): void { this.closes++; }
  finish(): void {
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  }
}

async function fixture(): Promise<{
  broker: Broker;
  file: string;
  statusFile: string;
  logs: string[];
  connect: (auth: string, machineId?: string) => Promise<Client>;
  admin: (adminKey: string) => Promise<Client>;
  beginAdmin: () => Promise<Client>;
  local: (request: Packet) => Promise<Record<string, unknown>>;
  controlled: (auth: string, machineId?: string) => DeferredCloseSocket;
}> {
  const dir = mkdtempSync(join(tmpdir(), 'crosschat-revocation-'));
  const file = registryFileOf(dir);
  const statusFile = join(dir, 'status-broker.json');
  const node = (label: string, key: string, machineId?: string) => ({ label, key, machineId, addedAt: '2026-10-21T00:00:00.000Z' });
  const admin = (label: string, adminKey: string) => ({ label, adminKey, addedAt: '2026-10-21T00:00:00.000Z' });
  seedBroker(file, { stars: [
    { starId: STAR_A, name: 'alpha', nodes: [node('victim', KEY_A, MID_A), node('keep', KEY_KEEP, MID_KEEP), admin('admin-victim', ADMIN_A), admin('admin-keep', ADMIN_KEEP)] },
    { starId: STAR_B, name: 'beta', nodes: [node('victim', KEY_B, MID_A), admin('admin-victim', ADMIN_B)] },
  ] });
  const logs: string[] = [];
  const broker = new Broker({
    registryFile: file, statusFile, version: 'test', machineId: () => '9999999900000000', hostname: () => 'broker',
    now: () => Date.now(), log: (line) => logs.push(line), deliverLocal: defaultDeliverLocal,
    port: 0, heartbeatMs: 60_000, connectTimeoutMs: 5_000, authFailDelayMs: 1, resultTimeoutMs: 2_000,
  });
  const port = await broker.start();
  const clients: Client[] = [];
  const controlled: DeferredCloseSocket[] = [];
  cleanups.push(async () => {
    for (const socket of controlled) socket.finish();
    await Promise.all(clients.map((client) => client.close()));
    await broker.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const client = async (): Promise<Client> => {
    const c = new Client(`ws://127.0.0.1:${port}`);
    clients.push(c);
    await c.wait('info');
    return c;
  };
  const beginAdmin = async (): Promise<Client> => {
    const c = await client();
    c.send({ op: 'connect', proto: 1, role: 'sender', admin: true, caps: [CAP_MULTI_STAR] });
    await c.wait('auth-challenge');
    return c;
  };
  return {
    broker, file, statusFile, logs, beginAdmin,
    connect: async (auth, machineId) => {
      const c = await client();
      c.send({ op: 'connect', proto: 1, role: machineId === undefined ? 'sender' : 'node', auth, machineId, caps: [CAP_MULTI_STAR, CAP_SESSION_MEMBERS] });
      await c.wait('connected');
      return c;
    },
    admin: async (adminKey) => {
      const c = await beginAdmin();
      const challenge = await c.wait('auth-challenge');
      c.send({ op: 'auth-proof', proof: createHmac('sha256', adminKey).update(String(challenge.nonce)).digest('hex') });
      await c.wait('connected');
      return c;
    },
    local: async (request) => {
      const status: unknown = JSON.parse(readFileSync(statusFile, 'utf8'));
      if (typeof status !== 'object' || status === null || !('adminPipe' in status) || typeof status.adminPipe !== 'string') throw new Error('missing admin pipe');
      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        const socket = net.createConnection(status.adminPipe, () => socket.end(`${JSON.stringify(request)}\n`));
        let data = '';
        socket.on('data', (chunk) => { data += String(chunk); });
        socket.on('error', reject);
        socket.on('end', () => {
          const value: unknown = JSON.parse(data);
          if (typeof value !== 'object' || value === null) return reject(new Error('invalid admin reply'));
          resolve(value as Record<string, unknown>);
        });
      });
    },
    controlled: (auth, machineId) => {
      const socket = new DeferredCloseSocket();
      controlled.push(socket);
      broker.admitLocal(socket, STAR_A);
      socket.receive({ op: 'connect', proto: 1, role: machineId === undefined ? 'sender' : 'node', machineId, auth, caps: [CAP_MULTI_STAR, CAP_SESSION_MEMBERS] });
      expect(socket.frames).toContainEqual(expect.objectContaining({ op: 'connected' }));
      return socket;
    },
  };
}

describe('broker credential revocation', () => {
  it('local remove-node immediately revokes every node/sender using that credential and retains offline permanent members in its star', async () => {
    const f = await fixture();
    const victim = await f.connect(KEY_A, MID_A);
    const sender1 = await f.connect(KEY_A);
    const sender2 = await f.connect(KEY_A);
    const keep = await f.connect(KEY_KEEP, MID_KEEP);
    const neighbor = await f.connect(KEY_B, MID_A);
    victim.send({ op: 'sessions', sessions: [{ sessionId: 'permanent-alpha', name: 'alpha-member', tool: 'claude' }] });
    neighbor.send({ op: 'sessions', sessions: [{ sessionId: 'permanent-beta', name: 'beta-member', tool: 'codex' }] });
    await expect.poll(() => loadBrokerFile(f.file).stars.every((s) => s.roster.length === 1)).toBe(true);
    expect(await f.local({ op: 'remove-node', starId: STAR_A, label: 'victim' })).toMatchObject({ ok: true, removed: true });
    for (const c of [victim, sender1, sender2]) {
      expect(await c.wait('credential-revoked')).toMatchObject({ starId: STAR_A, kind: 'node', reason: 'node-removed' });
      await expect.poll(() => c.ws.readyState).toBe(WebSocket.CLOSED);
    }
    const doc = loadBrokerFile(f.file);
    expect(doc.stars[0]!.roster).toContainEqual(expect.objectContaining({ sessionId: 'permanent-alpha' }));
    expect(doc.stars[1]!.roster).toContainEqual(expect.objectContaining({ sessionId: 'permanent-beta' }));
    keep.send({ op: 'admin-op', id: 'alpha-members', action: 'list-members' });
    neighbor.send({ op: 'admin-op', id: 'beta-members', action: 'list-members' });
    expect((await keep.wait('admin-op-result', 'alpha-members')).members).not.toContainEqual(expect.objectContaining({ sessionId: 'permanent-alpha', online: true }));
    expect((await neighbor.wait('admin-op-result', 'beta-members')).members).toContainEqual(expect.objectContaining({ sessionId: 'permanent-beta', online: true }));
    keep.send({ op: 'roster' });
    neighbor.send({ op: 'roster' });
    expect(await keep.wait('roster-result')).toMatchObject({ machines: [expect.objectContaining({ mid8: MID_KEEP.slice(0, 8), online: true })] });
    expect(await neighbor.wait('roster-result')).toMatchObject({ machines: [expect.objectContaining({ mid8: MID_A.slice(0, 8), online: true })] });
    for (const secret of [KEY_A, KEY_KEEP, KEY_B, ADMIN_A]) {
      expect(JSON.stringify(victim.frames.filter((p) => p.op === 'credential-revoked'))).not.toContain(secret);
      expect(f.logs.join('\n')).not.toContain(secret);
    }
  });

  it('remote remove-node has the same immediate effect while members and star admins retain their three-layer limits', async () => {
    const f = await fixture();
    const victim = await f.connect(KEY_A);
    const member = await f.connect(KEY_KEEP);
    const admin = await f.admin(ADMIN_KEEP);
    member.send({ op: 'admin-op', id: 'member-remove', action: 'remove-node', label: 'victim' });
    expect(await member.wait('error', 'member-remove')).toMatchObject({ code: 'ADMIN_REQUIRED' });
    admin.send({ op: 'admin-op', id: 'admin-remove-admin', action: 'remove-admin-key', label: 'admin-victim' });
    expect(await admin.wait('error', 'admin-remove-admin')).toMatchObject({ code: 'ADMIN_REQUIRED' });
    admin.send({ op: 'admin-op', id: 'node-remove-admin', action: 'remove-node', label: 'admin-victim' });
    expect(await admin.wait('error', 'node-remove-admin')).toMatchObject({ code: 'ADMIN_REQUIRED' });
    admin.send({ op: 'admin-op', id: 'remote-remove', action: 'remove-node', label: 'victim' });
    expect(await admin.wait('admin-op-result', 'remote-remove')).toMatchObject({ ok: true, removed: true });
    expect(await victim.wait('credential-revoked')).toMatchObject({ starId: STAR_A, kind: 'node' });
  });

  it('local remove-admin-key closes only authenticated sessions of the removed credential, including unique-prefix selection', async () => {
    const f = await fixture();
    const victims = [await f.admin(ADMIN_A), await f.admin(ADMIN_A)];
    const keep = await f.admin(ADMIN_KEEP);
    const neighbor = await f.admin(ADMIN_B);
    const member = await f.connect(KEY_A);
    expect(await f.local({ op: 'remove-admin-key', starId: STAR_A, label: 'admin-v' })).toMatchObject({ ok: true, removed: 'admin-victim' });
    for (const c of victims) expect(await c.wait('credential-revoked')).toMatchObject({ starId: STAR_A, kind: 'admin', reason: 'admin-key-revoked' });
    for (const c of [keep, neighbor, member]) {
      c.send({ op: 'admin-op', id: 'still-authorized', action: 'list-nodes' });
      expect(await c.wait('admin-op-result', 'still-authorized')).toMatchObject({ ok: true });
    }
  });

  it('does not authenticate an old challenge proof after its admin key was revoked', async () => {
    const f = await fixture();
    const c = await f.beginAdmin();
    const challenge = await c.wait('auth-challenge');
    expect(await f.local({ op: 'remove-admin-key', starId: STAR_A, label: 'admin-victim' })).toMatchObject({ ok: true });
    c.send({ op: 'auth-proof', proof: createHmac('sha256', ADMIN_A).update(String(challenge.nonce)).digest('hex') });
    expect(await c.wait('error')).toMatchObject({ code: 'BAD_AUTH' });
    expect(c.frames.some((p) => p.op === 'connected')).toBe(false);
  });

  it('marks a revoked session unusable before close completes without affecting another credential', async () => {
    const f = await fixture();
    const victim = f.controlled(KEY_A, MID_A);
    const keepSender = await f.connect(KEY_KEEP);
    const replacement = f.controlled(KEY_KEEP, MID_KEEP);
    victim.receive({ op: 'sessions', sessions: [{ sessionId: 'before-revoke', name: 'permanent' }] });
    expect(await f.local({ op: 'remove-node', starId: STAR_A, label: 'victim' })).toMatchObject({ removed: true });
    victim.receive({ op: 'sessions', sessions: [{ sessionId: 'after-revoke', name: 'must-not-register' }] });
    victim.receive({ op: 'admin-op', id: 'after-revoke-read', action: 'list-nodes' });
    victim.receive({ op: 'member-remove', target: 'before-revoke' });
    victim.receive({ op: 'send', id: 'after-revoke-send', targetMachine: MID_KEEP, body: 'must-not-forward' });
    expect(victim.frames).toContainEqual(expect.objectContaining({ op: 'credential-revoked' }));
    expect(victim.frames.some((p) => p.id === 'after-revoke-read')).toBe(false);
    expect(replacement.frames.some((p) => p.id === 'after-revoke-send')).toBe(false);
    expect(loadBrokerFile(f.file).stars[0]!.roster).toEqual([expect.objectContaining({ sessionId: 'before-revoke' })]);
    keepSender.send({ op: 'admin-op', id: 'offline-member', action: 'list-members' });
    expect((await keepSender.wait('admin-op-result', 'offline-member')).members).not.toContainEqual(expect.objectContaining({ sessionId: 'before-revoke', online: true }));
    keepSender.send({ op: 'roster' });
    expect(await keepSender.wait('roster-result')).toMatchObject({ machines: [expect.objectContaining({ mid8: MID_KEEP.slice(0, 8), online: true })] });
  });

  it('does not revoke a replacement connection of the same machine authenticated with a different key', async () => {
    const f = await fixture();
    mutateBrokerFile(f.file, (doc) => { doc.stars[0]!.nodes.find((n) => n.label === 'keep')!.machineId = MID_A; });
    const victim = f.controlled(KEY_A, MID_A);
    const replacement = f.controlled(KEY_KEEP, MID_A);
    expect(await f.local({ op: 'remove-node', starId: STAR_A, label: 'victim' })).toMatchObject({ removed: true });
    expect(victim.frames).toContainEqual(expect.objectContaining({ op: 'credential-revoked' }));
    expect(replacement.frames.some((p) => p.op === 'credential-revoked')).toBe(false);
    replacement.receive({ op: 'roster' });
    expect(replacement.frames.find((p) => p.op === 'roster-result')).toMatchObject({ machines: [expect.objectContaining({ mid8: MID_A.slice(0, 8), online: true })] });
  });

  it('finishes target pending work and file routes on revocation before the close callback, ignoring late target results', async () => {
    const f = await fixture();
    const target = f.controlled(KEY_A, MID_A);
    const sender = await f.connect(KEY_KEEP);
    sender.send({ op: 'send', id: 'pending-message', targetMachine: MID_A, body: 'already-forwarded' });
    sender.send({ op: 'file-begin', id: 'pending-file', targetMachine: MID_A, sha256: '0'.repeat(64), name: 'test.txt', size: 1 });
    await expect.poll(() => target.frames.filter((p) => p.op === 'deliver' || p.op === 'file-begin').length).toBe(2);
    expect(await f.local({ op: 'remove-node', starId: STAR_A, label: 'victim' })).toMatchObject({ removed: true });
    target.receive({ op: 'result', id: 'pending-message', status: 'delivered' });
    target.receive({ op: 'file-result', id: 'pending-file', ok: true, path: 'must-not-report' });
    expect(await sender.wait('error', 'pending-message')).toMatchObject({ code: 'CREDENTIAL_REVOKED' });
    expect(await sender.wait('file-result', 'pending-file')).toMatchObject({ ok: false });
    expect(sender.frames.some((p) => p.op === 'receipt' && p.id === 'pending-message')).toBe(false);
    expect(sender.frames.some((p) => p.path === 'must-not-report')).toBe(false);
    sender.send({ op: 'file-chunk', id: 'pending-file', seq: 0, bytes: 'YQ==' });
    sender.send({ op: 'roster' });
    await sender.wait('roster-result');
    expect(target.frames.some((p) => p.op === 'file-chunk')).toBe(false);
  });

  it('drops pending work owned by a revoked sender and does not accept later file chunks from it', async () => {
    const f = await fixture();
    const sender = f.controlled(KEY_A);
    const target = f.controlled(KEY_KEEP, MID_KEEP);
    sender.receive({ op: 'send', id: 'sender-pending', targetMachine: MID_KEEP, body: 'already-forwarded' });
    sender.receive({ op: 'file-begin', id: 'sender-file', targetMachine: MID_KEEP, sha256: '0'.repeat(64), name: 'test.txt', size: 1 });
    expect(target.frames).toContainEqual(expect.objectContaining({ op: 'deliver', id: 'sender-pending' }));
    expect(await f.local({ op: 'remove-node', starId: STAR_A, label: 'victim' })).toMatchObject({ removed: true });
    target.receive({ op: 'result', id: 'sender-pending', status: 'delivered' });
    target.receive({ op: 'file-result', id: 'sender-file', ok: true });
    sender.receive({ op: 'file-chunk', id: 'sender-file', seq: 0, bytes: 'YQ==' });
    await Promise.resolve();
    expect(sender.frames.some((p) => p.op === 'receipt' || p.op === 'file-result')).toBe(false);
    expect(target.frames.some((p) => p.op === 'file-chunk')).toBe(false);
  });
});
