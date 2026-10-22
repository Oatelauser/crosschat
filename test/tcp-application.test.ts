import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryRequest, DiscoveryResponse } from '../src/application/discovery/model.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const midA = '12345678000000000000000000000001';
const midB = '12345678000000000000000000000002';
const midC = '33333333000000000000000000000003';
const entry = { host: 'fixture.example', port: 7260, starId: 'star-a', name: 'alpha', key: 'PRIVATE-MEMBER', adminKey: 'PRIVATE-ADMIN' };
const digest = 'a'.repeat(64);
const capabilities = { discovery: true, delivery: false, launch: false, diagnostics: false };
async function fixture() {
  const baseDir = await mkdtemp(join(tmpdir(), 'crosschat-tcp-read-')); roots.push(baseDir);
  await mkdir(join(baseDir, 'tcp'));
  await writeFile(join(baseDir, 'tcp', 'node.json'), JSON.stringify({ brokers: [entry] }));
  return { baseDir };
}
function snapshot() {
  return { starId: 'star-a', name: 'alpha', revision: digest, role: 'star-admin', live: true,
    nodes: [{ label: 'one', kind: 'node', revision: digest, machineId: midA, machineName: 'same-name', addedAt: '2026-01-01' },
      { label: 'two', kind: 'node', revision: digest, machineId: midB, machineName: 'same-name', addedAt: '2026-01-01' },
      { label: 'unused', kind: 'node', revision: digest, addedAt: '2026-01-01' }, { label: 'operator', kind: 'admin', revision: digest, addedAt: '2026-01-01' }],
    machines: [{ machineId: midA, name: 'same-name', online: true }, { machineId: midB, name: 'same-name', online: false }],
    members: [{ sessionId: 'opaque/full/native', tool: 'third', name: 'member', machine: midA, machineName: 'same-name', online: true },
      { sessionId: 'old/full/native', name: 'old', machine: midB, online: false, extendsName: 'earlier', extendsMachine: midA, temporary: true }],
    key: 'PRIVATE-SNAPSHOT', adminPipe: 'PRIVATE-PIPE',
  };
}
function response(contextId: string, ids: string[], nextCursor: string | null = null): DiscoveryResponse {
  return { op: 'list', providers: [{ providerId: 'third', capabilities }], page: { items: ids.map((nativeId) => ({
    ref: { contextId, providerId: 'third', nativeId }, name: null, rawStatus: { type: 'pondering' }, capabilities, attributes: { cwd: '/controlled/source', token: 'PRIVATE-ATTRIBUTE' },
  })), nextCursor, completeness: nextCursor ? 'partial' : 'complete', observedAt: 42, errors: [] } };
}

describe('TCP readonly application', () => {
  it('caps explicit fan-out at the agreed three nodes before any IO', async () => {
    const { createTcpApplication } = await import('../src/application/tcp/index.js');
    const readSnapshot = vi.fn();
    for (const concurrency of [0, 4, 16]) expect(() => createTcpApplication({ baseDir: '/never-read-user-data', concurrency, readSnapshot })).toThrow();
    for (const concurrency of [1, 3]) expect(() => createTcpApplication({ baseDir: '/never-read-user-data', concurrency, readSnapshot })).not.toThrow();
    expect(readSnapshot).not.toHaveBeenCalled();
  });
  it('keeps an unconfigured local broker empty without creating data or guessing its first star', async () => {
    const { createTcpApplication } = await import('../src/application/tcp/index.js');
    const { baseDir } = await fixture();
    const readSnapshot = vi.fn();
    const app = createTcpApplication({ baseDir, readSnapshot });
    expect(await app.readStars({ contextId: 'local' })).toMatchObject({ configured: false, role: 'broker-owner', items: [], completeness: 'complete' });
    expect(await app.readStar({ contextId: 'local' })).toMatchObject({ star: null, completeness: 'unavailable' });
    expect(readSnapshot).not.toHaveBeenCalled();
    expect(await readdir(join(baseDir, 'tcp'))).toEqual(['node.json']);
  });

  it('rejects malformed local metadata without repairing it or opening a network source', async () => {
    const { createTcpApplication } = await import('../src/application/tcp/index.js');
    const { baseDir } = await fixture();
    const file = join(baseDir, 'tcp', 'broker.json');
    const raw = '{"stars":[{"starId":"star-a","nodes":[{"label":"bad"}],"roster":[]}]}';
    await writeFile(file, raw);
    const readSnapshot = vi.fn();
    const result = await createTcpApplication({ baseDir, readSnapshot }).readStars({ contextId: 'local' });
    expect(result.completeness).toBe('unavailable');
    expect(result.errors).toEqual([expect.objectContaining({ kind: 'malformed' })]);
    expect(readSnapshot).not.toHaveBeenCalled();
    expect(await readFile(file, 'utf8')).toBe(raw);
    expect(await readdir(join(baseDir, 'tcp'))).toEqual(['broker.json', 'node.json']);
  });

  it('separates machines, unbound node credentials and administrator credentials while preserving complete identities', async () => {
    const { createTcpApplication } = await import('../src/application/tcp/index.js');
    const { tcpContextId } = await import('../src/application/tcp/reading.js');
    const f = await fixture();
    const contextId = tcpContextId(entry);
    const readSnapshot = vi.fn(async () => snapshot());
    const app = createTcpApplication({ ...f, readSnapshot });
    const result = await app.readStar({ contextId });
    expect(result.completeness).toBe('complete');
    expect(result.star).toMatchObject({ starId: 'star-a', role: 'star-admin', health: 'reachable', onlineNodes: 1 });
    expect(result.machines.map((machine) => machine.machineId)).toEqual([midA, midB]);
    expect(result.machines[0].id).not.toBe(result.machines[1].id);
    expect(result.machines.map((machine) => machine.mid8)).toEqual(['12345678', '12345678']);
    expect(result.credentials.map((credential) => [credential.label, credential.kind, credential.machineId])).toEqual([
      ['one', 'node', midA], ['two', 'node', midB], ['unused', 'node', null], ['operator', 'admin', null],
    ]);
    expect(result.members[1]).toMatchObject({ nativeId: 'old/full/native', providerId: null, presence: 'offline', extendsName: 'earlier', extendsMachine: midA, temporary: true });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(readSnapshot).toHaveBeenCalledWith(expect.objectContaining({ contextId, entry: expect.objectContaining({ key: 'PRIVATE-MEMBER' }) }), expect.any(AbortSignal));
  });

  it('does not contact stale or ambiguous remote contexts and never falls back to local metadata', async () => {
    const { createTcpApplication } = await import('../src/application/tcp/index.js');
    const { tcpContextId } = await import('../src/application/tcp/reading.js');
    const f = await fixture();
    const readSnapshot = vi.fn(async () => snapshot());
    const app = createTcpApplication({ ...f, readSnapshot });
    expect(await app.readStars({ contextId: 'tcp:missing' })).toMatchObject({ items: [], completeness: 'unavailable' });
    await writeFile(join(f.baseDir, 'tcp', 'node.json'), JSON.stringify({ brokers: [entry, { ...entry, key: 'PRIVATE-DIFFERENT' }] }));
    expect(await app.readStar({ contextId: tcpContextId(entry) })).toMatchObject({ star: null, completeness: 'unavailable' });
    expect(readSnapshot).not.toHaveBeenCalled();
  });

  it('reads roster scope without native probing or invented native status', async () => {
    const { createTcpApplication } = await import('../src/application/tcp/index.js');
    const { tcpContextId } = await import('../src/application/tcp/reading.js');
    const f = await fixture();
    const discovery = vi.fn();
    const app = createTcpApplication({ ...f, readSnapshot: async () => snapshot(), discovery });
    const result = await app.readSessions({ contextId: tcpContextId(entry), scope: 'members' });
    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => [item.membership, item.presence, item.rawStatus, item.discovered])).toEqual([
      ['member', 'online', null, false], ['member', 'offline', null, false],
    ]);
    expect(result.items[1].ref).toBeNull();
    expect(result.items[1].address).toBeUndefined();
    expect(discovery).not.toHaveBeenCalled();
  });

  it('aggregates every discovery page with bounded node concurrency, preserves same-ID machine distinctions and reports offline sources', async () => {
    const { createTcpApplication } = await import('../src/application/tcp/index.js');
    const { tcpContextId } = await import('../src/application/tcp/reading.js');
    const f = await fixture();
    const state = snapshot();
    state.machines[1].online = true;
    state.machines.push({ machineId: midC, name: 'offline', online: false });
    state.nodes.push({ label: 'third', kind: 'node', revision: digest, machineId: midC, machineName: 'offline', addedAt: '2026-01-01' });
    let active = 0; let maximum = 0;
    const calls: Array<{ machineId: string; request: DiscoveryRequest }> = [];
    const app = createTcpApplication({ ...f, concurrency: 2, readSnapshot: async () => state, discovery: (_target, machineId) => ({ async execute(request, options) {
      calls.push({ machineId, request }); active++; maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => setImmediate(resolve)); active--;
      if (request.op !== 'list') throw new Error('Unexpected detail');
      return response(options!.contextId!, request.cursor ? ['anonymous/full/page-two'] : ['opaque/full/native'], request.cursor ? null : 'next');
    } }) });
    const result = await app.readSessions({ contextId: tcpContextId(entry), scope: 'discoverable' });
    expect(maximum).toBe(2);
    expect(result.completeness).toBe('partial');
    expect(result.items).toHaveLength(4);
    expect(new Set(result.items.map((item) => item.id)).size).toBe(4);
    expect(new Set(result.items.filter((item) => item.nativeId === 'opaque/full/native').map((item) => item.ref!.contextId)).size).toBe(2);
    expect(result.items.every((item) => item.name === null && item.machineId.length === 32)).toBe(true);
    expect(result.items[0].rawStatus).toEqual({ type: 'pondering' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(result.nodes).toContainEqual(expect.objectContaining({ machineId: midC, completeness: 'unavailable' }));
    expect(calls.filter((call) => call.machineId === midC)).toEqual([]);
    expect(calls.filter((call) => call.request.op === 'list' && call.request.cursor === 'next')).toHaveLength(2);
  });

  it('keeps healthy nodes when another source fails and refuses a repeated pagination cursor', async () => {
    const { createTcpApplication } = await import('../src/application/tcp/index.js');
    const { tcpContextId } = await import('../src/application/tcp/reading.js');
    const f = await fixture(); const state = snapshot(); state.machines[1].online = true;
    const app = createTcpApplication({ ...f, readSnapshot: async () => state, discovery: (_target, machineId) => ({ async execute(_request, options) {
      if (machineId === midB) throw new Error('PRIVATE transport detail');
      return response(options!.contextId!, ['opaque/full/native'], 'repeated');
    } }) });
    const result = await app.readSessions({ contextId: tcpContextId(entry), scope: 'discoverable' });
    expect(result.completeness).toBe('partial');
    expect(result.items).toHaveLength(1);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(result.errors)).not.toContain('PRIVATE');
  });

  it('cancels uncooperative discovery, discards late results and never starts the next pending node', async () => {
    const { createTcpApplication } = await import('../src/application/tcp/index.js');
    const { tcpContextId } = await import('../src/application/tcp/reading.js');
    const f = await fixture(); const state = snapshot(); state.machines[1].online = true;
    const owner = new AbortController();
    let entered!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; });
    let finish!: (result: DiscoveryResponse) => void;
    const execute = vi.fn((_request, options) => { entered(); expect(options.signal).toBeInstanceOf(AbortSignal); return new Promise<DiscoveryResponse>((resolve) => { finish = resolve; }); });
    const app = createTcpApplication({ ...f, concurrency: 1, readSnapshot: async () => state, discovery: () => ({ execute }) });
    const pending = app.readSessions({ contextId: tcpContextId(entry), scope: 'discoverable', signal: owner.signal });
    await started; owner.abort();
    expect(await pending).toMatchObject({ items: [], completeness: 'cancelled' });
    finish(response('late', ['late']));
    await Promise.resolve();
    expect(execute).toHaveBeenCalledOnce();
  });
});
