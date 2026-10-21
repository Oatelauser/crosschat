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

  it('does not claim member or admin credentials for empty key strings', async () => {
    const { queryBroker } = await import('../src/application/queries/index.js');
    const { tcpDir } = await fixture();
    await writeFile(join(tcpDir, 'broker.json'), JSON.stringify({ stars: [{ starId: 'star', nodes: [
      { label: 'empty', key: '', adminKey: '' },
      { label: 'member', key: 'private-member', adminKey: '' },
      { label: 'admin', key: '', adminKey: 'private-admin' },
      { label: 'missing' },
    ] }] }));
    const result = await queryBroker({ tcpDir });
    expect(result.value?.stars[0].nodes.map((node) => node.credential)).toEqual(['unknown', 'member', 'admin', 'unknown']);
    expect(JSON.stringify(result)).not.toContain('private-');
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
    await writeFile(join(tcpDir, 'status-broker.json'), JSON.stringify({ state: 'running', pid: 1234, port: 7260, lastUpdated: new Date(now).toISOString(), adminPipe: 'private-capability', onlineNodes: ['one'], stars: [{ starId: 'star-full', name: 'cloud' }] }));
    await writeFile(join(tcpDir, 'status-node.json'), JSON.stringify({ state: 'online', brokerAlias: 'cloud', since: '2026-10-20', lastUpdated: new Date(now - 90_000).toISOString() }));
    await writeFile(join(tcpDir, 'status-node-bad.json'), '{"state":"online","lastUpdated":55}');
    const result = await queryServiceStatuses({ tcpDir, now: () => now, isProcessAlive: () => true });
    expect(result.completeness).toBe('partial');
    expect(result.items.find((item) => item.kind === 'broker')).toMatchObject({ freshness: 'fresh', readiness: 'ready', port: 7260 });
    expect(result.items.find((item) => item.file === 'status-node.json')).toMatchObject({ freshness: 'stale', readiness: 'unknown' });
    expect(result.errors).toEqual([expect.objectContaining({ kind: 'malformed', source: join(tcpDir, 'status-node-bad.json') })]);
    expect(JSON.stringify(result)).not.toContain('private-capability');
  });

  it('never labels fresh ghost or legacy snapshots as confirmed ready', async () => {
    const { queryServiceStatuses } = await import('../src/application/queries/index.js');
    const { tcpDir } = await fixture();
    const file = join(tcpDir, 'status-broker.json');
    await writeFile(file, JSON.stringify({ state: 'running', pid: 1234, lastUpdated: new Date(now).toISOString() }));
    const dead = await queryServiceStatuses({ tcpDir, now: () => now, isProcessAlive: () => false });
    expect(dead.items[0]).toMatchObject({ freshness: 'fresh', readiness: 'unknown', pid: 1234, processAlive: false });
    await writeFile(file, JSON.stringify({ state: 'running', lastUpdated: new Date(now).toISOString() }));
    expect((await queryServiceStatuses({ tcpDir, now: () => now })).items[0].readiness).toBe('unknown');
  });

  it('preserves unknown raw service states without claiming readiness even with a live PID', async () => {
    const { queryServiceStatuses } = await import('../src/application/queries/index.js');
    const { tcpDir } = await fixture();
    await writeFile(join(tcpDir, 'status-broker.json'), JSON.stringify({ state: 'future-broker', pid: 1234, lastUpdated: new Date(now).toISOString() }));
    await writeFile(join(tcpDir, 'status-node-next.json'), JSON.stringify({ state: 'future-node', pid: 1235, lastUpdated: new Date(now).toISOString() }));
    const result = await queryServiceStatuses({ tcpDir, now: () => now, isProcessAlive: () => true });
    expect(result.completeness).toBe('complete');
    expect(result.items.map(({ state, readiness }) => ({ state, readiness }))).toEqual([
      { state: 'future-broker', readiness: 'unknown' },
      { state: 'future-node', readiness: 'unknown' },
    ]);
    expect(result.errors).toEqual([]);
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

describe('composable star queries', () => {
  async function starsFixture(ids: string[]) {
    const { tcpDir } = await fixture();
    const file = join(tcpDir, 'broker.json');
    await writeFile(file, JSON.stringify({ stars: ids.map((starId) => ({
      starId, name: `name-${starId}`, nodes: [{ label: 'credential', key: 'private-key' }],
      roster: [{ sessionId: 'static-only', online: true }],
    })) }));
    return { tcpDir, file };
  }

  it('reads every star sequentially, preserves raw identities/tools and derives online counts only from the injected authority', async () => {
    const { queryStars } = await import('../src/application/queries/index.js');
    const { tcpDir, file } = await starsFixture(['full-star-a', 'full-star-b']);
    const before = await readFile(file, 'utf8');
    const seen: string[] = [];
    let active = 0;
    let peak = 0;
    const result = await queryStars({
      tcpDir, now: () => now,
      readRoster: async (star) => {
        expect(JSON.stringify(star)).not.toContain('private-key');
        active += 1;
        peak = Math.max(peak, active);
        seen.push(star.starId!);
        await Promise.resolve();
        active -= 1;
        return [
          { mid8: `opaque-${star.starId}`, name: 'machine', online: true, sessions: [{ sessionId: 'opaque/native:id', tool: 'future-tool', name: '' }], extraSecret: 'private-payload' },
          { mid8: 'offline', online: false, sessions: [], offlineSessions: [{ sessionId: 'offline/full/id', tool: 'third-tool' }] },
        ];
      },
    });
    expect(seen).toEqual(['full-star-a', 'full-star-b']);
    expect(peak).toBe(1);
    expect(result).toMatchObject({ completeness: 'complete', observedAt: now, errors: [] });
    expect(result.items.map(({ star, health, onlineNodes }) => ({ starId: star.starId, health, onlineNodes }))).toEqual([
      { starId: 'full-star-a', health: 'reachable', onlineNodes: 1 },
      { starId: 'full-star-b', health: 'reachable', onlineNodes: 1 },
    ]);
    expect(result.items[0].machines[0]).toEqual({ mid8: 'opaque-full-star-a', name: 'machine', online: true, sessions: [{ sessionId: 'opaque/native:id', tool: 'future-tool', name: '' }] });
    expect(result.items[0].machines[1].offlineSessions).toEqual([{ sessionId: 'offline/full/id', tool: 'third-tool' }]);
    expect(JSON.stringify(result)).not.toContain('private-');
    expect(await readFile(file, 'utf8')).toBe(before);
    expect(await readdir(tcpDir)).toEqual(['broker.json']);
  });

  it('reports unknown partial live data when no roster capability is supplied, while zero configured stars are complete', async () => {
    const { queryStars } = await import('../src/application/queries/index.js');
    const { tcpDir } = await starsFixture(['full-star-a', 'full-star-b']);
    const unknown = await queryStars({ tcpDir, now: () => now });
    expect(unknown.completeness).toBe('partial');
    expect(unknown.items.map(({ health, onlineNodes, machines }) => ({ health, onlineNodes, machines }))).toEqual([
      { health: 'unknown', onlineNodes: null, machines: [] },
      { health: 'unknown', onlineNodes: null, machines: [] },
    ]);
    expect(unknown.errors).toHaveLength(2);
    expect(unknown.errors[0]).toMatchObject({ kind: 'unavailable', source: expect.stringContaining('full-star-a') });
    const empty = await starsFixture([]);
    const readRoster = vi.fn(async () => []);
    expect(await queryStars({ tcpDir: empty.tcpDir, readRoster })).toMatchObject({ items: [], completeness: 'complete', errors: [] });
    expect(readRoster).not.toHaveBeenCalled();
  });

  it('keeps successful stars when another reader fails or returns malformed data and does not echo secret errors', async () => {
    const { queryStars } = await import('../src/application/queries/index.js');
    const { tcpDir } = await starsFixture(['offline', 'bad', 'good']);
    const result = await queryStars({ tcpDir, readRoster: async (star) => {
      if (star.starId === 'offline') throw new Error('private-key: connection denied');
      if (star.starId === 'bad') return [{ mid8: 'machine', online: true, sessions: [{ sessionId: 123, tool: 'third' }] }];
      return [];
    } });
    expect(result.completeness).toBe('partial');
    expect(result.items.map(({ star, health, onlineNodes }) => ({ starId: star.starId, health, onlineNodes }))).toEqual([
      { starId: 'offline', health: 'unavailable', onlineNodes: null },
      { starId: 'bad', health: 'unavailable', onlineNodes: null },
      { starId: 'good', health: 'reachable', onlineNodes: 0 },
    ]);
    expect(result.errors).toEqual([
      expect.objectContaining({ kind: 'unavailable', source: expect.stringContaining('offline') }),
      expect.objectContaining({ kind: 'malformed', source: expect.stringContaining('bad') }),
    ]);
    expect(JSON.stringify(result)).not.toContain('private-key');
  });

  it('keeps old machine-only roster results reachable while explicitly marking missing sessions as partial', async () => {
    const { queryStars } = await import('../src/application/queries/index.js');
    const { tcpDir } = await starsFixture(['legacy']);
    const result = await queryStars({ tcpDir, readRoster: async () => [{ mid8: 'legacy8', name: 'old machine', online: true }] });
    expect(result.completeness).toBe('partial');
    expect(result.items[0]).toMatchObject({ health: 'reachable', onlineNodes: 1, machines: [{ mid8: 'legacy8', online: true }] });
    expect(result.items[0].machines[0]).not.toHaveProperty('sessions');
    expect(result.errors).toEqual([expect.objectContaining({ kind: 'unavailable', source: expect.stringContaining('legacy'), message: expect.stringContaining('会话') })]);
  });

  it('validates roster boundaries instead of accepting arbitrary shape assertions', async () => {
    const { queryStars } = await import('../src/application/queries/index.js');
    const { tcpDir } = await starsFixture(['validate']);
    const malformed: unknown[] = [
      {}, [{ mid8: 8, online: true, sessions: [] }], [{ mid8: 'valid', online: 'yes', sessions: [] }],
      [{ mid8: 'valid', online: true, name: 8, sessions: [] }],
      [{ mid8: 'valid', online: true, sessions: {} }],
      [{ mid8: 'valid', online: true, sessions: [{ sessionId: 'full', name: 8 }] }],
      [{ mid8: 'valid', online: true, sessions: [{ sessionId: 'full', tool: 8 }] }],
    ];
    for (const raw of malformed) {
      const result = await queryStars({ tcpDir, readRoster: async () => raw });
      expect(result.items[0]).toMatchObject({ health: 'unavailable', onlineNodes: null, machines: [] });
      expect(result.errors).toEqual([expect.objectContaining({ kind: 'malformed' })]);
    }
    expect((await queryStars({ tcpDir, readRoster: async () => undefined })).errors).toEqual([expect.objectContaining({ kind: 'unavailable' })]);
  });

  it('forwards cancellation, releases its listener and discards late roster data without starting the next star', async () => {
    const { queryStars } = await import('../src/application/queries/index.js');
    const { tcpDir } = await starsFixture(['one', 'two']);
    const controller = new AbortController();
    let finish!: (value: unknown) => void;
    let began!: () => void;
    const started = new Promise<void>((resolve) => { began = resolve; });
    const readRoster = vi.fn((_star, signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal);
      began();
      return new Promise<unknown>((resolve) => { finish = resolve; });
    });
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = queryStars({ tcpDir, signal: controller.signal, readRoster });
    await started;
    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({ completeness: 'cancelled', items: [], errors: [expect.objectContaining({ kind: 'cancelled' })] });
    finish([{ mid8: 'late', online: true, sessions: [] }]);
    await Promise.resolve();
    expect(result.items).toEqual([]);
    expect(readRoster).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('performs no metadata or roster read when already cancelled and reports metadata failure without calling the network seam', async () => {
    const { queryStars } = await import('../src/application/queries/index.js');
    const controller = new AbortController();
    controller.abort();
    const readText = vi.fn(async () => '{"stars":[]}');
    const readRoster = vi.fn(async () => []);
    expect(await queryStars({ tcpDir: '/unused', signal: controller.signal, readText, readRoster })).toMatchObject({ completeness: 'cancelled', items: [] });
    expect(readText).not.toHaveBeenCalled();
    const { tcpDir } = await fixture();
    expect(await queryStars({ tcpDir, readRoster })).toMatchObject({ completeness: 'unavailable', items: [], errors: [expect.objectContaining({ kind: 'missing' })] });
    expect(readRoster).not.toHaveBeenCalled();
  });
});

describe('bounded log query', () => {
  it('retains a complete line when the bounded window starts exactly at its boundary', async () => {
    const { queryLogTail } = await import('../src/application/queries/index.js');
    const { tcpDir } = await fixture();
    const file = join(tcpDir, 'broker.log');
    await writeFile(file, 'head\nkeep\n');
    expect((await queryLogTail({ file, maxBytes: 5 })).lines).toEqual(['keep']);
  });
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
