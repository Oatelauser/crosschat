import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { Broker, defaultDeliverLocal } from '../src/serve/broker.js';
import { SenderConn, requestAdminOp } from '../src/serve/via-tcp.js';
import { seedBroker } from './helpers/broker-seed.js';

const directories: string[] = [];
const releases: Array<() => Promise<void>> = [];
afterEach(async () => { for (const release of releases.splice(0).reverse()) await release(); for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'crosschat-star-snapshot-wire-')); directories.push(root);
  const file = join(root, 'broker.json'); const status = join(root, 'status.json'); const logs: string[] = [];
  const mid = '12345678aaaaaaaaaaaaaaaaaaaaaaaa'; const other = '12345678bbbbbbbbbbbbbbbbbbbbbbbb';
  const nodeKey = 'snapshot-member-key'; const adminKey = 'snapshot-admin-key';
  seedBroker(file, { stars: [{ starId: 'snapshot-star', name: 'visible', nodes: [
    { label: 'node-a', key: nodeKey, machineId: mid, addedAt: '2026-01-01' },
    { label: 'node-b', key: 'second-node-key', machineId: other, addedAt: '2026-01-01' },
    { label: 'unused', key: 'unused-node-key', addedAt: '2026-01-01' },
    { label: 'admin-a', adminKey, addedAt: '2026-01-01' },
  ], roster: [{ sessionId: 'full-native', machine: mid, tool: 'future-provider' }] }, { starId: 'hidden-star', name: 'hidden', nodes: [] }] });
  const broker = new Broker({ registryFile: file, statusFile: status, version: 'test', machineId: () => mid, hostname: () => 'fixture', now: Date.now, log: (line) => logs.push(line), deliverLocal: defaultDeliverLocal, port: 0, heartbeatMs: 60_000, authFailDelayMs: 1 });
  const port = await broker.start(); releases.push(() => broker.stop());
  return { root, file, status, logs, mid, other, nodeKey, adminKey, url: `ws://127.0.0.1:${port}` };
}
async function ipc(pipe: string, request: object): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(pipe, () => socket.write(JSON.stringify(request) + '\n'));
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Fixture IPC timed out')); }, 2000);
    let text = '';
    socket.on('data', (chunk) => {
      text += chunk.toString(); if (!text.includes('\n')) return;
      clearTimeout(timer); socket.destroy(); resolve(JSON.parse(text));
    });
    socket.on('error', (error) => { clearTimeout(timer); socket.destroy(); reject(error); });
  });
}

describe('read-only star snapshot transport', () => {
  it('returns complete machine identities for this star to members and challenge admins without secrets or read audit', async () => {
    const f = await fixture(); const before = await readFile(f.file, 'utf8');
    const member = await SenderConn.open(f.url, f.nodeKey, undefined, 2000); releases.push(async () => member.close());
    const admin = await SenderConn.openAdmin(f.url, f.adminKey, 2000); releases.push(async () => admin.close());
    const logStart = f.logs.length;
    for (const [connection, role] of [[member, 'member'], [admin, 'star-admin']] as const) {
      const reply = await requestAdminOp(connection, 'star-snapshot', {}, 2000);
      expect(reply).toMatchObject({ ok: true, snapshot: { starId: 'snapshot-star', role, live: true } });
      expect(reply.snapshot?.machines.map((machine) => machine.machineId)).toEqual([f.mid, f.other]);
      expect(reply.snapshot?.nodes).toHaveLength(4); expect(reply.snapshot?.members).toHaveLength(1);
      const text = JSON.stringify(reply);
      for (const secret of [f.nodeKey, f.adminKey, 'second-node-key', 'unused-node-key', 'hidden-star']) expect(text).not.toContain(secret);
    }
    expect(f.logs.slice(logStart).some((line) => line.includes('audit admin-op'))).toBe(false);
    expect(await readFile(f.file, 'utf8')).toBe(before);
    await requestAdminOp(member, 'list-nodes', {}, 2000);
    expect(f.logs.some((line) => line.includes('audit admin-op list-nodes'))).toBe(true);
  });

  it('uses the same snapshot for the local pipe and refuses corrupt state without backup or repair', async () => {
    const f = await fixture(); const before = await readFile(f.file, 'utf8');
    const status = JSON.parse(await readFile(f.status, 'utf8')) as { adminPipe: string };
    const result = await ipc(status.adminPipe, { op: 'star-snapshot', starId: 'snapshot-star' });
    expect(result).toMatchObject({ ok: true, snapshot: { starId: 'snapshot-star', role: 'broker-owner' } });
    const connection = await SenderConn.open(f.url, f.nodeKey, undefined, 2000); releases.push(async () => connection.close());
    try {
      await writeFile(f.file, '{broken-private-state');
      expect(await requestAdminOp(connection, 'star-snapshot', {}, 2000)).toMatchObject({ ok: false });
      expect(await readFile(f.file, 'utf8')).toBe('{broken-private-state');
      await expect(access(f.file + '.bak')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await writeFile(f.file, before); }
  });
});
