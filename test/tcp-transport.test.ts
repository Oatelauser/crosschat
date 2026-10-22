import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { createTcpApplication } from '../src/application/tcp/index.js';
import { tcpContextId } from '../src/application/tcp/reading.js';
import { Broker } from '../src/serve/broker.js';
import { buildStarSnapshot } from '../src/serve/star-snapshot.js';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const mid = '11111111000000000000000000000001';
const key = 'a'.repeat(64);
const adminKey = 'b'.repeat(64);
const star = { starId: 'controlled-star', name: 'fixture', nodes: [
  { label: 'machine', key, machineId: mid, machineName: 'controlled', addedAt: '2026-01-01' },
  { label: 'operator', adminKey, addedAt: '2026-01-01' },
], roster: [] };
async function fixture() {
  const baseDir = await mkdtemp(join(tmpdir(), 'crosschat-tcp-transport-'));
  cleanups.push(() => rm(baseDir, { recursive: true, force: true }));
  await mkdir(join(baseDir, 'tcp'));
  await writeFile(join(baseDir, 'tcp', 'broker.json'), JSON.stringify({ stars: [star] }));
  return { baseDir };
}
async function localFixture(response?: unknown | 'oversized') {
  const f = await fixture();
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\crosschat-snapshot-${randomUUID()}` : join(f.baseDir, 'snapshot.sock');
  const sockets = new Set<Socket>();
  const requests: string[] = [];
  let accept!: (socket: Socket) => void;
  const accepted = new Promise<Socket>((resolve) => { accept = resolve; });
  const server = createServer((socket) => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket)); accept(socket);
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString();
      if (!data.includes('\n')) return;
      requests.push(data.trim());
      if (response === 'oversized') socket.write('PRIVATE-UNTRUSTED-OUTPUT'.repeat(120_000));
      else if (response !== undefined) socket.write(`${JSON.stringify({ ok: true, snapshot: response })}\n`);
    });
  });
  await new Promise<void>((resolve) => server.listen(pipe, resolve));
  cleanups.push(() => new Promise<void>((resolve) => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()); }));
  await writeFile(join(f.baseDir, 'tcp', 'status-broker.json'), JSON.stringify({ state: 'running', pid: process.pid, lastUpdated: new Date().toISOString(), adminPipe: pipe }));
  return { ...f, pipe, requests, accepted, sockets };
}

describe('controlled real TCP snapshot transports', () => {
  it('reads the new WS snapshot as member or challenge-authenticated administrator without list audit polling', async () => {
    const f = await fixture();
    const logs: string[] = [];
    const broker = new Broker({ registryFile: join(f.baseDir, 'tcp', 'broker.json'), statusFile: join(f.baseDir, 'tcp', 'broker-status.json'),
      machineId: () => mid, hostname: () => 'controlled', version: 'fixture', now: Date.now, log: (line) => logs.push(line), port: 0,
      deliverLocal: async (frame) => ({ op: 'result', id: frame.id, status: 'delivered' }),
    });
    const port = await broker.start(); cleanups.push(() => broker.stop());
    const entry = { host: '127.0.0.1', port, starId: star.starId, name: star.name, key };
    const file = join(f.baseDir, 'tcp', 'node.json');
    await writeFile(file, JSON.stringify({ brokers: [entry] }));
    const app = createTcpApplication({ ...f, timeoutMs: 1000 });
    expect(await app.readStar({ contextId: tcpContextId(entry) })).toMatchObject({ completeness: 'complete', star: { role: 'member', starId: star.starId }, machines: [{ machineId: mid }] });
    await writeFile(file, JSON.stringify({ brokers: [{ ...entry, adminKey }] }));
    const admin = await app.readStars({ contextId: tcpContextId(entry) });
    expect(admin).toMatchObject({ completeness: 'complete', role: 'star-admin', items: [{ starId: star.starId }] });
    expect(JSON.stringify(admin)).not.toContain(adminKey);
    expect(logs.some((line) => /audit admin-op (list-nodes|list-members|star-snapshot)/.test(line))).toBe(false);
  });

  it('reads the exact local star through the controlled management socket and keeps its path out of ordinary data', async () => {
    const snapshot = buildStarSnapshot(star, { role: 'broker-owner', onlineMachines: new Set([mid]) });
    const f = await localFixture(snapshot);
    const result = await createTcpApplication(f).readStar({ contextId: 'local', starId: star.starId });
    expect(result).toMatchObject({ completeness: 'complete', star: { role: 'broker-owner', starId: star.starId, onlineNodes: 1 } });
    expect(f.requests.map((request) => JSON.parse(request))).toEqual([{ op: 'star-snapshot', starId: star.starId }]);
    expect(JSON.stringify(result)).not.toContain(f.pipe);
  });

  it('does not treat a malformed broker status as authority to open an IPC capability', async () => {
    const snapshot = buildStarSnapshot(star, { role: 'broker-owner', onlineMachines: new Set([mid]) });
    const f = await localFixture(snapshot);
    await writeFile(join(f.baseDir, 'tcp', 'status-broker.json'), JSON.stringify({ state: 'running', adminPipe: f.pipe }));
    const result = await createTcpApplication(f).readStar({ contextId: 'local', starId: star.starId });
    expect(result.completeness).toBe('partial');
    expect(result.star?.health).toBe('unavailable');
    expect(f.requests).toEqual([]);
  });

  it('discards a cancelled local IPC read and closes its owned socket', async () => {
    const f = await localFixture();
    const owner = new AbortController();
    const pending = createTcpApplication(f).readStar({ contextId: 'local', starId: star.starId, signal: owner.signal });
    const socket = await f.accepted;
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    owner.abort();
    expect(await pending).toMatchObject({ completeness: 'cancelled', star: null, machines: [], members: [], credentials: [] });
    await closed;
    expect(f.sockets.size).toBe(0);
  });

  it('bounds untrusted local IPC output without exposing it or claiming live completeness', async () => {
    const f = await localFixture('oversized');
    const result = await createTcpApplication(f).readStar({ contextId: 'local', starId: star.starId });
    expect(result).toMatchObject({ completeness: 'partial', star: { health: 'unavailable', onlineNodes: null } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE-UNTRUSTED-OUTPUT');
  });

  it('cancels a WS handshake before broker info and leaves no owned connection behind', async () => {
    const f = await fixture();
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    cleanups.push(() => new Promise<void>((resolve) => { for (const socket of server.clients) socket.terminate(); server.close(() => resolve()); }));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Expected server port');
    const entry = { host: '127.0.0.1', port: address.port, key, starId: star.starId };
    await writeFile(join(f.baseDir, 'tcp', 'node.json'), JSON.stringify({ brokers: [entry] }));
    const accepted = new Promise<import('ws').WebSocket>((resolve) => server.once('connection', resolve));
    const owner = new AbortController();
    const pending = createTcpApplication(f).readStar({ contextId: tcpContextId(entry), signal: owner.signal });
    const socket = await accepted;
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    owner.abort();
    expect(await pending).toMatchObject({ completeness: 'cancelled', star: null });
    await closed;
    expect(server.clients.size).toBe(0);
  });

  it('identifies an invalid new snapshot as malformed metadata without accepting a mid8 as a full machine identity', async () => {
    const f = await fixture();
    const entry = { host: 'controlled.example', port: 7260, key, starId: star.starId };
    await writeFile(join(f.baseDir, 'tcp', 'node.json'), JSON.stringify({ brokers: [entry] }));
    const snapshot = buildStarSnapshot(star, { role: 'member', onlineMachines: new Set([mid]) });
    const app = createTcpApplication({ ...f, readSnapshot: async () => ({ ...snapshot, machines: [{ mid8: mid.slice(0, 8), online: true }], key: 'PRIVATE-INVALID' }) });
    const result = await app.readStar({ contextId: tcpContextId(entry) });
    expect(result.completeness).toBe('unavailable');
    expect(result.errors).toEqual([expect.objectContaining({ kind: 'malformed' })]);
    expect(JSON.stringify(result)).not.toContain('PRIVATE-INVALID');
  });
});
