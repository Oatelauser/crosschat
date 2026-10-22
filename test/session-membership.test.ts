import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscoveryService } from '../src/application/discovery/service.js';
import type { DiscoveryEndpoint, DiscoverySession } from '../src/application/discovery/model.js';
import type { SessionRef } from '../src/application/sessions/model.js';
import type { SessionMembershipOptions } from '../src/application/session-membership/index.js';
import { Broker } from '../src/serve/broker.js';
import { attachPipePath, NodeClient } from '../src/serve/node.js';
import { connectAttachPipe } from '../src/commands/session-star.js';
import { FileInbox } from '../src/serve/file-channel.js';
import { loadBrokerFile, writeBrokerFile } from '../src/serve/registry.js';
import type { RosterEntry } from '../src/serve/registry.js';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const machine = '11111111222233334444555555555555';
const otherMachine = '66666666777788889999aaaaaaaaaaaa';
const key = 'a'.repeat(64);
const adminKey = 'b'.repeat(64);
const capabilities = { discovery: true, delivery: true, launch: false, diagnostics: false };
const ref: SessionRef = { contextId: 'local', providerId: 'claude', nativeId: 'native/full-session-id', referenceKind: 'native' };
function member(overrides: Partial<RosterEntry> = {}): RosterEntry {
  return { sessionId: ref.nativeId, name: 'shared', machine, tool: 'claude', ...overrides };
}
function session(overrides: Partial<DiscoverySession> = {}): DiscoverySession {
  return { ref: { ...ref }, name: null, rawStatus: 'idle', capabilities, attributes: {}, ...overrides };
}
async function base() {
  const dir = await mkdtemp(join(tmpdir(), 'crosschat-membership-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function service(options: SessionMembershipOptions) {
  const { createSessionMembershipService } = await import('../src/application/session-membership/index.js');
  return createSessionMembershipService(options);
}
async function fixture(roster: RosterEntry[] = [], initial = session()) {
  const baseDir = await base();
  const name = `fixture-${randomUUID().slice(0, 8)}`;
  const registryFile = join(baseDir, 'broker.json');
  writeBrokerFile(registryFile, { stars: [{ starId: 'star-a-full', name, nodes: [{ label: 'member', key, addedAt: '2026-01-01' }], roster }] });
  const broker = new Broker({ registryFile, statusFile: join(baseDir, 'broker-status.json'), port: 0, version: 'fixture',
    machineId: () => otherMachine, hostname: () => 'fixture', now: Date.now, log: () => undefined,
    deliverLocal: async (frame) => ({ op: 'result', id: frame.id, status: 'delivered' }), heartbeatMs: 60_000 });
  const port = await broker.start();
  cleanups.push(() => broker.stop());
  const entry = { host: '127.0.0.1', port, key, adminKey, name, starId: 'star-a-full' };
  const configFile = join(baseDir, 'tcp', 'node.json');
  await mkdir(join(baseDir, 'tcp'));
  await writeFile(configFile, JSON.stringify({ brokers: [entry] }));
  const state: { item: DiscoverySession | null } = { item: initial };
  const execute = vi.fn<DiscoveryEndpoint['execute']>(async (request) => {
    if (request.op !== 'detail') throw new Error('membership must not scan native sources');
    return { op: 'detail', providers: [{ providerId: request.providerId, capabilities }],
      detail: { item: state.item, completeness: 'complete', errors: [], observedAt: 42 } };
  });
  const spawned: string[] = [];
  const options: SessionMembershipOptions = { baseDir, discovery: { execute }, machineId: () => machine, timeoutMs: 300,
    spawnServeDetach: (selector) => spawned.push(selector), aggregatorTimeoutMs: 1000 };
  const startNode = async () => {
    const node = new NodeClient({ config: { entries: [entry] }, configFile, machineId: () => machine, now: Date.now, log: () => undefined,
      fileInbox: new FileInbox({ inboxDir: join(baseDir, 'inbox'), partsDir: join(baseDir, 'parts') }), codexHome: join(baseDir, 'empty-codex'), memberCheckMs: 60_000,
      makeSendDeps: () => ({ env: {},
        listClaudeSessions: () => ({ sessions: state.item === null ? [] : [{ pid: 123, sessionId: state.item.ref.nativeId, kind: 'interactive', status: 'idle', messagingSocketPath: 'fixture' }], malformed: 0 }),
        listCodexThreads: async () => [], deliverClaude: async () => ({ status: 'delivered' }), deliverCodex: async () => ({ status: 'accepted', turnId: 'unused' }),
        sendLogFile: join(baseDir, 'send-log.jsonl'), outboxDir: join(baseDir, 'outbox'), now: Date.now }),
    });
    cleanups.push(() => node.stop());
    void node.run().catch(() => undefined);
    await node.waitForState('online');
    return node;
  };
  return { baseDir, registryFile, entry, configFile, options, execute, state, spawned, startNode, broker };
}
const remove = { op: 'remove' as const, ref, starId: 'star-a-full' };
const adopt = { ...remove, op: 'adopt' as const };

async function attachServer(f: Awaited<ReturnType<typeof fixture>>, status: Record<string, unknown>, onAttach?: () => void) {
  const writes: unknown[] = [];
  const sockets = new Set<import('node:net').Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.once('close', () => sockets.delete(socket));
    let buffer = '';
    socket.on('data', (data) => {
      buffer += data.toString('utf8');
      for (;;) {
        const end = buffer.indexOf('\n');
        if (end < 0) break;
        const input: unknown = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (typeof input === 'object' && input !== null && 'op' in input && input.op === 'status') {
          socket.write(`${JSON.stringify({ ok: true, online: true, brokerCap: true, members: [], ...status })}\n`);
        } else {
          writes.push(input);
          onAttach?.();
          socket.write('{"ok":true}\n');
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(attachPipePath(f.entry, join(f.baseDir, 'tcp')), resolve); });
  cleanups.push(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  return { writes, sockets };
}

describe('session membership application boundary', () => {
  it('lists only configured stars without a connection, native scan, configuration repair or credentials', async () => {
    const baseDir = await base();
    const execute = vi.fn(new DiscoveryService([]).execute);
    const spawn = vi.fn();
    const app = await service({ baseDir, discovery: { execute }, spawnServeDetach: spawn, machineId: () => { throw new Error('must not probe machine for list'); } });
    expect(await app.listTargets({ contextId: 'local' })).toMatchObject({ stars: [], completeness: 'complete', errors: [] });
    expect(await readdir(baseDir)).toEqual([]);
    await mkdir(join(baseDir, 'tcp'));
    await writeFile(join(baseDir, 'tcp', 'node.json'), JSON.stringify({ brokers: [
      { host: 'unreachable.invalid', port: 1, key, adminKey, starId: 'exact-star', name: 'same' },
      { host: 'other.invalid', port: 2, key, starId: 'exact-star', name: 'same' },
      { host: 'third.invalid', port: 3, key, name: 'missing-id' },
    ] }));
    const targets = await app.listTargets({ contextId: 'local' });
    expect(targets.stars.length).toBeGreaterThan(0);
    expect(targets.stars.every((star) => !star.eligible && star.reason)).toBe(true);
    expect(JSON.stringify(targets)).not.toContain(key);
    expect(JSON.stringify(targets)).not.toContain(adminKey);
    expect(execute).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('reports malformed and cancelled sources safely without overwriting them or waiting for an uncooperative read', async () => {
    const baseDir = await base();
    await mkdir(join(baseDir, 'tcp'));
    const configFile = join(baseDir, 'tcp', 'node.json');
    const original = `broken ${key}`;
    await writeFile(configFile, original);
    const app = await service({ baseDir, discovery: new DiscoveryService([]) });
    const targets = await app.listTargets({ contextId: 'local' });
    expect(targets).toMatchObject({ stars: [], completeness: 'unavailable', errors: [{ kind: 'malformed', source: { path: configFile }, nextStep: expect.any(String) }] });
    expect(JSON.stringify(targets)).not.toContain(key);
    expect(await readFile(configFile, 'utf8')).toBe(original);
    const controller = new AbortController();
    const slow = await service({ baseDir, discovery: new DiscoveryService([]), readText: () => new Promise(() => undefined) });
    const pending = slow.listTargets({ contextId: 'local', signal: controller.signal });
    controller.abort();
    expect(await pending).toMatchObject({ completeness: 'cancelled', errors: [{ kind: 'cancelled' }] });
  });

  it('removes an offline exact member without requiring a still-live native session', async () => {
    const f = await fixture([member(), member({ sessionId: 'neighbor', tool: 'codex' })]);
    f.state.item = null;
    const app = await service(f.options);
    expect(await app.check(remove)).toMatchObject({ allowed: true, impact: expect.any(Array) });
    expect(await app.apply(remove)).toMatchObject({ kind: 'applied' });
    expect(loadBrokerFile(f.registryFile).stars[0].roster.map((entry) => entry.sessionId)).toEqual(['neighbor']);
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.spawned).toEqual([]);
  });

  it('returns uncertain when the broker changed memory but could not persist exact removal', async () => {
    const f = await fixture([member()]);
    const app = await service(f.options);
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (String(destination) === f.registryFile) throw new Error('controlled persistence failure');
      return rename(source, destination);
    });
    syncBuiltinESMExports();
    expect(await app.apply(remove)).toMatchObject({ kind: 'uncertain' });
    expect(loadBrokerFile(f.registryFile).stars[0].roster).toHaveLength(1);
  });

  it('rejects unverified Provider, different machine, same-ID cross-Provider conflict and changed targets', async () => {
    for (const roster of [[member({ tool: undefined })], [member({ machine: otherMachine })], [member({ tool: 'codex' })]]) {
      const f = await fixture(roster);
      const app = await service(f.options);
      expect(await app.check(remove)).toMatchObject({ allowed: false, reason: expect.any(String) });
      expect(await app.apply(remove)).toMatchObject({ kind: 'rejected' });
      expect(loadBrokerFile(f.registryFile).stars[0].roster).toHaveLength(1);
    }
    const f = await fixture([]);
    const app = await service(f.options);
    expect(await app.apply(remove)).toMatchObject({ kind: 'rejected' });
  });

  it('binds actual broker star identity and rejects unsupported reference or local identity before writing', async () => {
    const f = await fixture([member()]);
    const app = await service(f.options);
    for (const request of [
      { ...remove, ref: { ...ref, referenceKind: 'process' as const } },
      { ...remove, ref: { ...ref, contextId: 'ssh:elsewhere' } },
      { ...remove, starId: 'star-a' },
    ]) expect(await app.apply(request)).toMatchObject({ kind: 'rejected' });
    const noIdentity = await service({ ...f.options, machineId: () => machine.slice(0, 8) });
    expect(await noIdentity.check(remove)).toMatchObject({ allowed: false });
    await writeFile(f.configFile, JSON.stringify({ brokers: [{ ...f.entry, starId: 'misbound-star' }] }));
    expect(await app.apply({ ...remove, starId: 'misbound-star' })).toMatchObject({ kind: 'rejected' });
    expect(loadBrokerFile(f.registryFile).stars[0].roster).toHaveLength(1);
  });

  it('checks fresh native details and keeps not-loaded, unknown, missing or changed identities out of adoption', async () => {
    const f = await fixture();
    const app = await service(f.options);
    expect(await app.check(adopt)).toMatchObject({ allowed: true, impact: expect.arrayContaining([expect.stringMatching(/聚合器/)]) });
    expect(f.spawned).toEqual([]);
    for (const status of ['not_loaded', 'unknown', { type: 'notLoaded' }, { type: 'future-state' }]) {
      f.state.item = session({ ref: { ...ref, providerId: 'codex' }, rawStatus: status });
      expect(await app.check({ ...adopt, ref: f.state.item.ref })).toMatchObject({ allowed: false });
    }
    f.state.item = session({ ref: { ...ref, nativeId: 'different-session' } });
    expect(await app.apply(adopt)).toMatchObject({ kind: 'rejected' });
    f.state.item = null;
    expect(await app.apply(adopt)).toMatchObject({ kind: 'rejected' });
    expect(f.spawned).toEqual([]);
  });

  it('rejects a native ID shared by another discovered Provider rather than collapsing its identity to the wire session key', async () => {
    const f = await fixture();
    const discovery: DiscoveryEndpoint = { execute: async (request) => {
      if (request.op !== 'detail') throw new Error('unexpected list');
      return { op: 'detail', providers: ['claude', 'codex'].map((providerId) => ({ providerId, capabilities })),
        detail: { item: session({ ref: { ...ref, providerId: request.providerId } }), completeness: 'complete', errors: [], observedAt: 42 } };
    } };
    const app = await service({ ...f.options, discovery });
    expect(await app.check(adopt)).toMatchObject({ allowed: false, reason: expect.any(String) });
    expect(await app.apply(adopt)).toMatchObject({ kind: 'rejected' });
    expect(f.spawned).toEqual([]);
  });

  it('accepts an exact main Provider result within partial pages but requires complete absence from other Providers', async () => {
    const f = await fixture();
    let completeness: 'complete' | 'partial' | 'unavailable' | 'cancelled' = 'complete';
    const discovery: DiscoveryEndpoint = { execute: async (request) => {
      if (request.op !== 'detail') throw new Error('unexpected list');
      const main = request.providerId === ref.providerId;
      return { op: 'detail', providers: ['claude', 'codex'].map((providerId) => ({ providerId, capabilities })),
        detail: { item: main ? session() : null, completeness: main ? 'partial' : completeness, errors: [], observedAt: 42 } };
    } };
    const app = await service({ ...f.options, discovery });
    expect(await app.check(adopt)).toMatchObject({ allowed: true });
    for (completeness of ['partial', 'unavailable', 'cancelled']) {
      expect(await app.check(adopt)).toMatchObject({ allowed: false, reason: expect.any(String) });
      expect(await app.apply(adopt)).toMatchObject({ kind: 'rejected' });
    }
    expect(f.spawned).toEqual([]);
  });

  it('aborts the owned native source on timeout without cancelling the parent or repeating the check', async () => {
    const f = await fixture();
    const controller = new AbortController();
    let ownedSignal: AbortSignal | undefined;
    const execute = vi.fn<DiscoveryEndpoint['execute']>(async (_request, options) => {
      ownedSignal = options?.signal;
      return new Promise(() => undefined);
    });
    const app = await service({ ...f.options, discovery: { execute }, timeoutMs: 20 });
    expect(await app.check({ ...adopt, signal: controller.signal })).toMatchObject({ allowed: false });
    expect(ownedSignal?.aborted).toBe(true);
    expect(controller.signal.aborted).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(f.spawned).toEqual([]);
  });

  it('refuses a full star selector shadowed by another configured name before starting an aggregator', async () => {
    const f = await fixture();
    await writeFile(f.configFile, JSON.stringify({ brokers: [f.entry, { ...f.entry, starId: 'different-full-star', name: f.entry.starId }] }));
    f.options.spawnServeDetach = (selector) => { f.spawned.push(selector); throw new Error('controlled spawn must not happen'); };
    const app = await service(f.options);
    expect(await app.apply(adopt)).toMatchObject({ kind: 'rejected' });
    expect(f.spawned).toEqual([]);
    expect(await app.check(adopt)).toMatchObject({ allowed: false });
  });

  it('adopts an anonymous full native ref through the shared aggregator and verifies broker roster authority', async () => {
    const f = await fixture([member({ sessionId: 'same-name-neighbor', name: 'shared' })]);
    f.options.spawnServeDetach = (selector) => { f.spawned.push(selector); void f.startNode().catch(() => undefined); };
    const app = await service(f.options);
    expect(await app.apply(adopt)).toMatchObject({ kind: 'applied' });
    expect(f.spawned).toEqual(['star-a-full']);
    const roster = loadBrokerFile(f.registryFile).stars[0].roster;
    expect(roster.find((entry) => entry.sessionId === ref.nativeId)).toMatchObject({ tool: 'claude', machine });
    expect(roster.find((entry) => entry.sessionId === 'same-name-neighbor')).toMatchObject({ name: 'shared' });
    f.state.item = session({ ref: { ...ref, nativeId: 'other-complete-id' }, name: 'shared' });
    expect(await app.apply({ ...adopt, ref: f.state.item.ref })).toMatchObject({ kind: 'applied' });
    expect(loadBrokerFile(f.registryFile).stars[0].roster.map((entry) => entry.sessionId)).toEqual(expect.arrayContaining([ref.nativeId, 'other-complete-id']));
  });

  it('gets authenticated aggregator identity from status and clears it when its broker connection closes', async () => {
    const f = await fixture();
    const node = await f.startNode();
    const pipe = await connectAttachPipe(attachPipePath(f.entry, join(f.baseDir, 'tcp')));
    cleanups.push(() => pipe.close());
    expect(await pipe.send({ op: 'status' })).toMatchObject({ ok: true, online: true, starId: f.entry.starId, machine });
    await f.broker.stop();
    await node.waitForState('reconnect-wait');
    const reply = await pipe.send({ op: 'status' });
    expect(reply).toMatchObject({ ok: true, online: false });
    expect(reply).not.toHaveProperty('starId');
    expect(reply).not.toHaveProperty('machine');
  });

  it('refuses offline, missing, wrong-star or wrong-machine IPC owners without sending attach', async () => {
    for (const status of [
      { starId: 'other-star', machine }, { starId: 'star-a-full', machine: otherMachine },
      { starId: 'star-a-full', machine, online: false }, {},
      { starId: 'star-a-full', machine, members: [{ sessionId: ref.nativeId, tool: 'codex' }] },
    ]) {
      const f = await fixture();
      const ipc = await attachServer(f, status);
      const app = await service(f.options);
      expect(await app.apply(adopt)).toMatchObject({ kind: 'rejected' });
      expect(ipc.writes).toEqual([]);
    }
  });

  it('treats cancellation after attach as uncertain, releases IPC and never repeats the write', async () => {
    const f = await fixture();
    const controller = new AbortController();
    const ipc = await attachServer(f, { starId: f.entry.starId, machine }, () => controller.abort());
    const app = await service(f.options);
    expect(await app.apply({ ...adopt, signal: controller.signal })).toMatchObject({ kind: 'uncertain' });
    expect(ipc.writes).toHaveLength(1);
    expect(ipc.writes[0]).toMatchObject({ op: 'attach', sessionId: ref.nativeId, tool: 'claude' });
    await vi.waitFor(() => expect(ipc.sockets.size).toBe(0));
    expect(loadBrokerFile(f.registryFile).stars[0].roster).toEqual([]);
  });
});
