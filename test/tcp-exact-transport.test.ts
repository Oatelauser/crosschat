import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Broker, defaultDeliverLocal } from '../src/serve/broker.js';
import { SenderConn, requestAdminOp } from '../src/serve/via-tcp.js';
import { loadBrokerFile, mutateBrokerFile } from '../src/serve/registry.js';
import { seedBroker } from './helpers/broker-seed.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  // Keep intentional linked-parent rejection separate from macOS's temp alias.
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'crosschat-exact-wire-'))); cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'broker.json'); const status = join(dir, 'status.json'); const logs: string[] = [];
  seedBroker(file, { stars: [{ starId: 'full-star', name: 'fixture', nodes: [
    { label: 'node-1', key: 'fixture-node-key', machineId: 'a'.repeat(32), addedAt: '2026-01-01' },
    { label: 'admin-long', adminKey: 'fixture-admin-key', addedAt: '2026-01-01' },
  ] }, { starId: 'other-star', name: 'other', nodes: [{ label: 'other-node', key: 'other-fixture-key', addedAt: '2026-01-01' }] }] });
  const broker = new Broker({ registryFile: file, statusFile: status, version: 'test', machineId: () => 'b'.repeat(32), hostname: () => 'fixture', now: Date.now, log: (line) => logs.push(line), deliverLocal: defaultDeliverLocal, port: 0, heartbeatMs: 60_000, authFailDelayMs: 1 });
  const port = await broker.start(); cleanups.push(() => broker.stop());
  const url = `ws://127.0.0.1:${port}`;
  async function member(key: string) { const conn = await SenderConn.open(url, key, undefined, 2000); cleanups.push(async () => conn.close()); return conn; }
  const admin = await SenderConn.openAdmin(url, 'fixture-admin-key', 2000); cleanups.push(async () => admin.close());
  async function ipc(request: object): Promise<Record<string, unknown>> {
    const { adminPipe } = JSON.parse(await readFile(status, 'utf8')) as { adminPipe: string };
    return new Promise((resolve, reject) => {
      const socket = createConnection(adminPipe, () => socket.write(JSON.stringify(request) + '\n'));
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('Controlled IPC timed out')); }, 2000);
      let data = '';
      socket.on('data', (chunk) => { data += chunk.toString(); if (!data.includes('\n')) return; clearTimeout(timer); socket.destroy(); resolve(JSON.parse(data)); });
      socket.on('error', (error) => { clearTimeout(timer); socket.destroy(); reject(error); });
    });
  }
  return { file, logs, admin, member, ipc };
}
describe('expected management transport', () => {
  it('refuses a replaced credential before deleting and immediately revokes the exact current credential on success', async () => {
    const f = await fixture();
    const before = (await requestAdminOp(f.admin, 'star-snapshot', {}, 2000)).snapshot!;
    const old = before.nodes.find((node) => node.label === 'node-1')!;
    mutateBrokerFile(f.file, (doc) => { doc.stars[0].nodes[0].key = 'new-fixture-node-key'; });
    const selected = await f.member('new-fixture-node-key'); const adjacent = await f.member('other-fixture-key');
    const stale = await requestAdminOp(f.admin, 'remove-node', { label: old.label, expected: { credentialRevision: old.revision, machineId: old.machineId! } }, 2000);
    expect(stale).toMatchObject({ ok: false }); expect(loadBrokerFile(f.file).stars[0].nodes).toHaveLength(2);
    expect(selected.ws.readyState).toBe(1);
    const fresh = (await requestAdminOp(f.admin, 'star-snapshot', {}, 2000)).snapshot!.nodes.find((node) => node.label === 'node-1')!;
    expect(await requestAdminOp(f.admin, 'remove-node', { label: fresh.label, expected: { credentialRevision: fresh.revision, machineId: fresh.machineId! } }, 2000)).toMatchObject({ ok: true, removed: true });
    await vi.waitFor(() => expect(selected.ws.readyState).toBe(3));
    expect(adjacent.ws.readyState).toBe(1);
    expect(f.logs.some((line) => line.includes('audit admin-op remove-node') && line.includes('starIds=["full-star"]'))).toBe(true);
  });

  it('refuses stale star impact then deletes the freshly confirmed star while retaining the adjacent star', async () => {
    const f = await fixture(); const adjacent = await f.member('other-fixture-key');
    const before = (await requestAdminOp(f.admin, 'star-snapshot', {}, 2000)).snapshot!;
    mutateBrokerFile(f.file, (doc) => doc.stars[0].nodes.push({ label: 'new-node', key: 'new-unused-key', addedAt: '2026-01-01' }));
    expect(await f.ipc({ op: 'remove-star', starId: 'full-star', expected: { starRevision: before.revision } })).toMatchObject({ ok: false });
    expect(loadBrokerFile(f.file).stars).toHaveLength(2);
    const fresh = (await requestAdminOp(f.admin, 'star-snapshot', {}, 2000)).snapshot!;
    expect(await f.ipc({ op: 'remove-star', starId: 'full-star', expected: { starRevision: fresh.revision } })).toMatchObject({ ok: true });
    expect(loadBrokerFile(f.file).stars.map((star) => star.starId)).toEqual(['other-star']);
    expect(adjacent.ws.readyState).toBe(1);
  });

  it('never falls back to an admin label prefix, and revokes the confirmed admin connection on exact success', async () => {
    const f = await fixture();
    const credential = (await requestAdminOp(f.admin, 'star-snapshot', {}, 2000)).snapshot!.nodes.find((node) => node.kind === 'admin')!;
    const expected = { credentialRevision: credential.revision, machineId: null };
    expect(await f.ipc({ op: 'remove-admin-key', starId: 'full-star', label: 'admin', expected })).toMatchObject({ ok: false });
    expect(f.admin.ws.readyState).toBe(1);
    expect(await f.ipc({ op: 'remove-admin-key', starId: 'full-star', label: credential.label, expected })).toMatchObject({ ok: true, removed: credential.label });
    await vi.waitFor(() => expect(f.admin.ws.readyState).toBe(3));
  });
});
