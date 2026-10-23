import * as fs from 'node:fs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Broker, defaultDeliverLocal } from '../src/serve/broker.js';
import { NodeClient } from '../src/serve/node.js';
import { FileInbox } from '../src/serve/file-channel.js';
import { SenderConn, requestAdminOp } from '../src/serve/via-tcp.js';
import { loadBrokerFile, mutateBrokerFile } from '../src/serve/registry.js';
import { credentialRevision, machineCredentialRevision } from '../src/serve/management-state.js';
import { readNodeConfig } from '../src/serve/node-config.js';
import { seedBroker } from './helpers/broker-seed.js';
import { createTcpApplication } from '../src/application/tcp/index.js';
import { createTcpManagement } from '../src/application/tcp/management.js';
import { tcpContextId } from '../src/application/tcp/reading.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});
const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { vi.mocked(fs.renameSync).mockImplementation(actualFs.renameSync); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const machineId = 'a'.repeat(32); const brokerId = 'b'.repeat(32);
const firstKey = 'only-fixture-first-key'; const secondKey = 'only-fixture-second-key';
const otherKey = 'only-fixture-other-star-key'; const adminKey = 'only-fixture-admin-key';
const addedAt = '2026-10-23T00:00:00Z';
async function fixture() {
  const root = mkdtempSync(join(process.platform === 'darwin' ? realpathSync('/tmp') : tmpdir(), 'cc-peer-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'broker.json'); const logs: string[] = [];
  seedBroker(file, { stars: [
    { starId: 'star-a', name: 'alpha', nodes: [
      { label: 'first', key: firstKey, machineId, machineName: 'old-alpha', addedAt },
      { label: 'second', key: secondKey, machineId, machineName: 'stale-other-key', addedAt },
      { label: 'unused', key: 'only-fixture-unused', addedAt },
      { label: 'operator', adminKey, addedAt },
    ], roster: [{ sessionId: 'permanent-session', machine: machineId, tool: 'futuretool', machineName: 'old-alpha' }] },
    { starId: 'star-b', name: 'beta', nodes: [{ label: 'same-machine', key: otherKey, machineId, machineName: 'old-beta', addedAt }], roster: [] },
  ] });
  const broker = new Broker({ registryFile: file, statusFile: join(root, 'status.json'), version: 'fixture', machineId: () => brokerId,
    hostname: () => 'controlled-broker', now: Date.now, log: (line) => logs.push(line), deliverLocal: defaultDeliverLocal, port: 0, heartbeatMs: 60000, resultTimeoutMs: 500 });
  const port = await broker.start(); cleanups.push(() => broker.stop()); const url = `ws://127.0.0.1:${port}`;
  const nodeFile = join(root, 'node.json');
  const entries = [
    { host: '127.0.0.1', port, starId: 'star-a', name: 'alpha', key: firstKey, showName: 'old-alpha', retained: { keep: true } },
    { host: '127.0.0.1', port, starId: 'star-b', name: 'beta', key: otherKey, showName: 'old-beta' },
  ];
  writeFileSync(nodeFile, JSON.stringify({ brokers: entries, showName: 'global-default', retainedTop: { keep: true } }));
  let generation = 0;
  function node(starId: string) {
    const config = readNodeConfig(nodeFile); const entry = config.entries.find((entry) => entry.starId === starId);
    if (!entry) throw new Error('Fixture entry missing');
    const client = new NodeClient({ config: { ...config, entries: [entry] }, configFile: nodeFile, machineId: () => machineId,
      fileInbox: new FileInbox({ inboxDir: join(root, 'inbox'), partsDir: join(root, 'parts') }),
      makeSendDeps: () => { throw new Error('Naming must not invoke native messaging'); }, now: Date.now, log: (line) => logs.push(line),
      memberProviders: () => [], codexHome: join(root, 'codex'), memberCheckMs: 60000, attachLabel: `${root.split(/[\\/]/).at(-1)}-${++generation}`,
    });
    const running = client.run(); cleanups.push(async () => { await client.stop(); await running; });
    return client;
  }
  const admin = await SenderConn.openAdmin(url, adminKey, 2000); cleanups.push(() => admin.close());
  async function member(key: string) { const connection = await SenderConn.open(url, key, undefined, 2000); cleanups.push(() => connection.close()); return connection; }
  const snapshot = () => requestAdminOp(admin, 'star-snapshot', {}, 2000);
  function ipc(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    const status: unknown = JSON.parse(readFileSync(join(root, 'status.json'), 'utf8'));
    if (!status || typeof status !== 'object' || !('adminPipe' in status) || typeof status.adminPipe !== 'string') throw new Error('Fixture management socket missing');
    return new Promise((resolve, reject) => {
      const socket = createConnection(status.adminPipe, () => socket.write(`${JSON.stringify(request)}\n`));
      let text = ''; let settled = false;
      const finish = (error?: Error, value?: Record<string, unknown>) => {
        if (settled) return; settled = true; clearTimeout(timer); socket.destroy();
        if (error) reject(error); else resolve(value ?? {});
      };
      const timer = setTimeout(() => finish(new Error('Fixture management timeout')), 2000);
      socket.on('error', (error) => finish(error)); socket.on('close', () => finish(new Error('Fixture management closed')));
      socket.on('data', (chunk) => {
        text += chunk.toString(); if (!text.includes('\n')) return;
        try { finish(undefined, JSON.parse(text.slice(0, text.indexOf('\n')))); } catch { finish(new Error('Fixture management invalid JSON')); }
      });
    });
  }
  return { root, file, nodeFile, entries, logs, node, admin, member, snapshot, ipc };
}

describe('controlled real peer management transport', () => {
  it('restores the actual per-star name for every bound key and member after reconnect, including explicit clearing', async () => {
    const f = await fixture(); const saved = JSON.parse(readFileSync(f.nodeFile, 'utf8'));
    saved.brokers[0].showName = 'alpha-restored'; writeFileSync(f.nodeFile, JSON.stringify(saved));
    const alpha = f.node('star-a'); const beta = f.node('star-b'); await Promise.all([alpha.waitForState('online'), beta.waitForState('online')]);
    const first = (await f.snapshot()).snapshot!;
    expect(first.nodes.filter((item) => item.machineId === machineId).map((item) => item.machineName)).toEqual(['alpha-restored', 'alpha-restored']);
    expect(first.members[0].machineName).toBe('alpha-restored');
    await alpha.stop();
    const cleared = JSON.parse(readFileSync(f.nodeFile, 'utf8')); delete cleared.showName; delete cleared.brokers[0].showName; writeFileSync(f.nodeFile, JSON.stringify(cleared));
    const reconnect = f.node('star-a'); await reconnect.waitForState('online');
    const after = (await f.snapshot()).snapshot!;
    expect(after.machines[0].name).toBeUndefined();
    expect(after.nodes.filter((item) => item.machineId === machineId).every((item) => item.machineName === undefined)).toBe(true);
    expect(after.members[0].machineName).toBeUndefined(); expect(loadBrokerFile(f.file).stars[1].nodes[0].machineName).toBe('old-beta');
    expect(beta.state).toBe('online');
  });
  it('saves and applies only the online current-star peer name, including its bound keys and persistent member names', async () => {
    const f = await fixture(); const alpha = f.node('star-a'); const beta = f.node('star-b');
    await Promise.all([alpha.waitForState('online'), beta.waitForState('online')]);
    expect(await requestAdminOp(f.admin, 'rename-node', { machineId, name: 'alpha-new' }, 2000)).toMatchObject({ ok: true, renamed: true, saved: true, applied: true, starId: 'star-a', machineId, showName: 'alpha-new', name: 'alpha-new' });
    const saved = JSON.parse(readFileSync(f.nodeFile, 'utf8'));
    expect(saved).toMatchObject({ showName: 'global-default', retainedTop: { keep: true }, brokers: [{ starId: 'star-a', showName: 'alpha-new', retained: { keep: true } }, { starId: 'star-b', showName: 'old-beta' }] });
    const snapshot = (await f.snapshot()).snapshot!;
    expect(snapshot.machines).toContainEqual(expect.objectContaining({ machineId, name: 'alpha-new', online: true }));
    expect(snapshot.nodes.filter((node) => node.machineId === machineId).map((node) => node.machineName)).toEqual(['alpha-new', 'alpha-new']);
    expect(snapshot.members).toContainEqual(expect.objectContaining({ sessionId: 'permanent-session', machineName: 'alpha-new' }));
    expect(loadBrokerFile(f.file).stars[1].nodes[0].machineName).toBe('old-beta');
    expect(await f.ipc({ op: 'rename-node', starId: 'star-a', machineId, name: 'owner-renamed' })).toMatchObject({ ok: true, renamed: true, saved: true, applied: true, starId: 'star-a', machineId, name: 'owner-renamed' });
    expect(JSON.parse(readFileSync(f.nodeFile, 'utf8')).brokers[0].showName).toBe('owner-renamed');
    expect(await requestAdminOp(f.admin, 'rename-node', { machineId, name: '' }, 2000)).toMatchObject({ ok: true, showName: '', name: 'global-default' });
    expect(JSON.parse(readFileSync(f.nodeFile, 'utf8')).brokers[0].showName).toBeUndefined();
    expect(alpha.state).toBe('online'); expect(beta.state).toBe('online');
    const text = JSON.stringify(f.logs); for (const secret of [firstKey, secondKey, otherKey, adminKey]) expect(text).not.toContain(secret);
  });

  it('rejects an offline target and ordinary-member naming without writing any configuration', async () => {
    const f = await fixture(); const before = readFileSync(f.nodeFile, 'utf8');
    expect(await requestAdminOp(f.admin, 'rename-node', { machineId, name: 'offline' }, 2000)).toMatchObject({ ok: false });
    const member = await f.member(firstKey);
    await expect(requestAdminOp(member, 'rename-node', { machineId, name: 'forbidden' }, 2000)).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
    await expect(requestAdminOp(member, 'remove-machine', { machineId, expected: { machineRevision: 'a'.repeat(64) } }, 2000)).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
    const invalid = await requestAdminOp(f.admin, 'remove-machine', { machineId, expected: { machineRevision: 'invalid-version' } }, 2000);
    expect(invalid).toMatchObject({ ok: false }); expect(invalid.uncertain).not.toBe(true);
    expect(readFileSync(f.nodeFile, 'utf8')).toBe(before);
  });

  it('does not report success when the peer configuration cannot be committed', async () => {
    const f = await fixture(); const node = f.node('star-a'); await node.waitForState('online');
    const before = readFileSync(f.nodeFile, 'utf8');
    vi.mocked(fs.renameSync).mockImplementation((source, destination) => {
      if (String(destination) === f.nodeFile) throw new Error('controlled peer persistence failure');
      actualFs.renameSync(source, destination);
    });
    expect(await requestAdminOp(f.admin, 'rename-node', { machineId, name: 'cannot-save' }, 2000)).toMatchObject({ ok: false });
    expect(readFileSync(f.nodeFile, 'utf8')).toBe(before);
    expect((await f.snapshot()).snapshot!.nodes.find((item) => item.label === 'first')?.machineName).toBe('old-alpha');
  });

  it('keeps a damaged broker registry untouched if the peer saved but the broker cannot confirm its name projection', async () => {
    const f = await fixture(); const node = f.node('star-a'); await node.waitForState('online');
    vi.mocked(fs.renameSync).mockImplementation((source, destination) => {
      if (String(destination) === f.nodeFile) writeFileSync(f.file, '{broken');
      actualFs.renameSync(source, destination);
    });
    expect(await requestAdminOp(f.admin, 'rename-node', { machineId, name: 'peer-saved' }, 2000)).toMatchObject({ ok: false, uncertain: true });
    expect(JSON.parse(readFileSync(f.nodeFile, 'utf8')).brokers[0].showName).toBe('peer-saved');
    expect(readFileSync(f.file, 'utf8')).toBe('{broken'); expect(existsSync(`${f.file}.bak`)).toBe(false);
  });

  it('uses the default remote application transport for a complete rename followed by atomic machine removal', async () => {
    const f = await fixture(); const node = f.node('star-a'); await node.waitForState('online');
    const baseDir = join(f.root, 'operator'); mkdirSync(join(baseDir, 'tcp'), { recursive: true });
    const entry = { ...f.entries[0], adminKey }; writeFileSync(join(baseDir, 'tcp', 'node.json'), JSON.stringify({ brokers: [entry] }));
    const contextId = tcpContextId(entry); const catalog = createTcpApplication({ baseDir });
    const before = await catalog.readStar({ contextId, starId: 'star-a' }); const target = before.machines.find((item) => item.machineId === machineId);
    if (!target) throw new Error('Fixture target missing');
    const management = createTcpManagement({ baseDir, catalog });
    const rename = { contextId, starId: 'star-a', targetId: target.id, action: 'rename-node' as const, values: { name: 'from-application' } };
    const preview = await management.preview(rename); expect(preview.enabled).toBe(true);
    expect(await management.apply({ ...rename, expectedPreviewRevision: preview.revision })).toMatchObject({ kind: 'applied', mode: 'hot' });
    const refreshed = await catalog.readStar({ contextId, starId: 'star-a' });
    expect(refreshed.members[0].machineName).toBe('from-application'); expect(refreshed.machines[0].name).toBe('from-application');
    const remove = { contextId, starId: 'star-a', targetId: target.id, action: 'remove-node' as const, values: {} };
    const confirmed = await management.preview(remove); expect(confirmed.enabled).toBe(true);
    expect(await management.apply({ ...remove, expectedPreviewRevision: confirmed.revision })).toMatchObject({ kind: 'applied', mode: 'hot' });
    const removed = await catalog.readStar({ contextId, starId: 'star-a' });
    expect(removed.machines).toEqual([]); expect(removed.members).toContainEqual(expect.objectContaining({ nativeId: 'permanent-session' }));
  });

  it.each(['ws', 'ipc'])('atomically removes the full key set over %s, revokes every matching sender and keeps adjacent-star connections and member records', async (transport) => {
    const f = await fixture(); const first = await f.member(firstKey); const second = await f.member(secondKey); const adjacent = await f.member(otherKey);
    const star = loadBrokerFile(f.file).stars[0];
    const machineRevision = machineCredentialRevision(machineId, star.nodes.filter((node) => node.key && node.machineId === machineId).map((node) => ({ label: node.label, revision: credentialRevision(node) })));
    mutateBrokerFile(f.file, (doc) => { doc.stars[0].nodes.push({ label: 'late-bound', key: 'only-fixture-late-bound', machineId, addedAt }); });
    expect(await requestAdminOp(f.admin, 'remove-machine', { machineId, expected: { machineRevision } }, 2000)).toMatchObject({ ok: false });
    expect(loadBrokerFile(f.file).stars[0].nodes).toHaveLength(5); expect(first.ws.readyState).toBe(1); expect(second.ws.readyState).toBe(1);
    const latest = loadBrokerFile(f.file).stars[0].nodes.filter((node) => node.key && node.machineId === machineId);
    const confirmed = machineCredentialRevision(machineId, latest.map((node) => ({ label: node.label, revision: credentialRevision(node) })));
    const removed = transport === 'ws' ? await requestAdminOp(f.admin, 'remove-machine', { machineId, expected: { machineRevision: confirmed } }, 2000)
      : await f.ipc({ op: 'remove-machine', starId: 'star-a', machineId, expected: { machineRevision: confirmed } });
    expect(removed).toMatchObject({ ok: true, removed: true, machineId, removedLabels: ['first', 'second', 'late-bound'] });
    await vi.waitFor(() => { expect(first.ws.readyState).toBe(3); expect(second.ws.readyState).toBe(3); });
    expect(adjacent.ws.readyState).toBe(1);
    expect(loadBrokerFile(f.file).stars[0]).toMatchObject({ nodes: [{ label: 'unused' }, { label: 'operator' }], roster: [{ sessionId: 'permanent-session' }] });
  });
});
