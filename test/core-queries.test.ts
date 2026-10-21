import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'crosschat-queries-'));
  roots.push(root);
  const tcpDir = join(root, 'tcp');
  await mkdir(tcpDir);
  return { root, tcpDir };
}
const now = Date.parse('2026-10-21T00:00:00Z');

describe('pure broker and node queries', () => {
  it('distinguishes missing, malformed, empty and unreadable without backups or repair', async () => {
    const { queryBroker } = await import('../src/application/queries/index.js');
    const { tcpDir } = await fixture();
    const options = { tcpDir, now: () => now };
    expect(await queryBroker(options)).toMatchObject({ state: 'missing', value: null });
    const file = join(tcpDir, 'broker.json');
    for (const raw of ['null', '{"stars":{}}', '{"stars":[{"nodes":"invalid"}]}', '{broken']) {
      await writeFile(file, raw);
      expect(await queryBroker(options)).toMatchObject({ state: 'malformed', value: null });
      expect(await readdir(tcpDir)).toEqual(['broker.json']);
      expect(await readFile(file, 'utf8')).toBe(raw);
    }
    await writeFile(file, '{"stars":[]}');
    expect(await queryBroker(options)).toMatchObject({ state: 'ready', value: { stars: [] }, observedAt: now, errors: [] });
    expect(await queryBroker({ ...options, readText: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } })).toMatchObject({ state: 'unreadable' });
  });

  it('returns full stable identifiers, strips static online and keeps secrets out of ordinary results', async () => {
    const { queryBroker, queryNodeConnections } = await import('../src/application/queries/index.js');
    const { tcpDir } = await fixture();
    await writeFile(join(tcpDir, 'broker.json'), JSON.stringify({ port: 7260, stars: [{ starId: 'star-full', name: 'cloud', nodes: [
      { label: 'machine', key: 'never-expose', machineId: 'full-machine-id', machineName: 'worker', addedAt: '2026-01-01' },
      { label: 'admin', adminKey: 'never-admin', addedAt: '2026-01-01' },
    ], roster: [{ sessionId: 'opaque/native:id', machine: 'full-machine-id', tool: 'future', online: true }] }] }));
    await writeFile(join(tcpDir, 'node.json'), JSON.stringify({ brokers: [{ host: 'host', port: 7260, name: 'cloud', key: 'never-expose', adminKey: 'never-admin' }] }));
    const broker = await queryBroker({ tcpDir });
    expect(broker.value?.stars[0]).toMatchObject({ starId: 'star-full', nodes: [{ machineId: 'full-machine-id', credential: 'member' }, { credential: 'admin' }], roster: [{ sessionId: 'opaque/native:id', tool: 'future' }] });
    expect(broker.value?.stars[0].roster[0]).not.toHaveProperty('online');
    const connections = await queryNodeConnections({ tcpDir });
    expect(connections.value?.entries[0]).toMatchObject({ host: 'host', hasMemberKey: true, hasAdminKey: true });
    expect(JSON.stringify([broker, connections])).not.toContain('never-');
  });

  it('does no IO when cancelled and drops a late file read result', async () => {
    const { queryBroker } = await import('../src/application/queries/index.js');
    const controller = new AbortController();
    controller.abort();
    const readText = vi.fn(async () => '{"stars":[]}');
    expect(await queryBroker({ tcpDir: '/unused', signal: controller.signal, readText })).toMatchObject({ state: 'cancelled' });
    expect(readText).not.toHaveBeenCalled();
    const next = new AbortController();
    let finish!: (value: string) => void;
    const pending = queryBroker({ tcpDir: '/unused', signal: next.signal, readText: () => new Promise((resolve) => { finish = resolve; }) });
    next.abort();
    expect(await pending).toMatchObject({ state: 'cancelled' });
    finish('{"stars":[]}');
  });
});

describe('service snapshots and managed files', () => {
  it('validates service fields and distinguishes stale/stopped from current readiness', async () => {
    const { queryServiceStatuses } = await import('../src/application/queries/index.js');
    const { tcpDir } = await fixture();
    await writeFile(join(tcpDir, 'status-broker.json'), JSON.stringify({ state: 'running', port: 7260, lastUpdated: new Date(now).toISOString(), adminPipe: 'private-capability', onlineNodes: ['one'], stars: [{ starId: 'star-full', name: 'cloud' }] }));
    await writeFile(join(tcpDir, 'status-node.json'), JSON.stringify({ state: 'online', brokerAlias: 'cloud', since: '2026-10-20', lastUpdated: new Date(now - 90_000).toISOString() }));
    await writeFile(join(tcpDir, 'status-node-bad.json'), '{"state":"online","lastUpdated":55}');
    const result = await queryServiceStatuses({ tcpDir, now: () => now });
    expect(result.completeness).toBe('partial');
    expect(result.items.find((item) => item.kind === 'broker')).toMatchObject({ freshness: 'fresh', readiness: 'ready', port: 7260 });
    expect(result.items.find((item) => item.file === 'status-node.json')).toMatchObject({ freshness: 'stale', readiness: 'unknown' });
    expect(result.errors).toEqual([expect.objectContaining({ kind: 'malformed', source: join(tcpDir, 'status-node-bad.json') })]);
    expect(JSON.stringify(result)).not.toContain('private-capability');
  });

  it('lists file metadata without reading secret content or creating missing directories', async () => {
    const { queryManagedFiles } = await import('../src/application/queries/index.js');
    const { root, tcpDir } = await fixture();
    await writeFile(join(tcpDir, 'node.json'), 'a-private-key');
    const before = await readdir(root);
    const result = await queryManagedFiles({ baseDir: root });
    expect(result.items.find((item) => item.file === join(tcpDir, 'node.json'))).toMatchObject({ bytes: 13, category: 'configuration' });
    expect(JSON.stringify(result)).not.toContain('a-private-key');
    expect(await readdir(root)).toEqual(before);
    expect(result.errors).toEqual([]);
  });
});

describe('bounded log query', () => {
  it('bounds bytes, drops incomplete edge lines, supports filtering and detects replacement/truncation', async () => {
    const { queryLogTail } = await import('../src/application/queries/index.js');
    const { tcpDir } = await fixture();
    const file = join(tcpDir, 'broker.log');
    await writeFile(file, `long-prefix-${'x'.repeat(1000)}\nfirst admin-op 加星\nordinary\nlast admin-op 改名\n`);
    const first = await queryLogTail({ file, maxBytes: 100, contains: 'admin-op' });
    expect(first.bytesRead).toBeLessThanOrEqual(100);
    expect(first.lines).toEqual(['first admin-op 加星', 'last admin-op 改名']);
    expect(first.truncated).toBe(true);
    expect(first.rotated).toBe(false);
    await rename(file, `${file}.old`);
    await writeFile(file, 'new admin-op 发钥\n');
    const second = await queryLogTail({ file, previous: first.cursor });
    expect(second.rotated).toBe(true);
    expect(second.lines).toEqual(['new admin-op 发钥']);
    await writeFile(file, 'short\n');
    expect((await queryLogTail({ file, previous: second.cursor })).rotated).toBe(true);
    expect((await queryLogTail({ file: `${file}.missing` })).state).toBe('missing');
  });
});
