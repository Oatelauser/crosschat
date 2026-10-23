import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLegacyMemberProviders, readMemberSnapshot } from '../src/application/members/index.js';
import { defaultMembershipProviders } from '../src/application/session-membership/providers.js';
import { runAdopt } from '../src/commands/session-star.js';
import type { StarJoinDeps } from '../src/commands/session-star.js';
import { runServe } from '../src/commands/serve.js';
import { attachPipePath } from '../src/serve/node.js';
import { MultichatError } from '../src/errors.js';
import type { DshThread } from '../src/dsh/client.js';

vi.mock('../src/serve/via-tcp.js', async (original) => ({ ...await original<typeof import('../src/serve/via-tcp.js')>(), fetchBrokerCaps: async () => ['session-members'] }));
const thread: DshThread = { id: 'harness-native-session', name: 'Worker', cwd: '/isolated/work', rawStatus: { type: 'idle' }, attributes: {} };
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

function memberDeps(listDshThreads: () => Promise<DshThread[]>) {
  return { listClaudeSessions: () => ({ sessions: [], malformed: 0 }), listCodexThreads: async () => [], listDshThreads,
    lookupRolloutMetas: () => new Map(), codexHome: 'unused-fixture-home', now: () => 100 };
}

describe('DeepSeek Harness member liveness', () => {
  it('uses one live snapshot for full native IDs, absence and names', async () => {
    const list = vi.fn(async () => [thread]);
    const snapshot = await readMemberSnapshot(createLegacyMemberProviders(memberDeps(list), [thread.id, 'absent']), { contextId: 'local', nativeIds: [thread.id, 'absent'] });
    expect(snapshot.get(thread.id)?.providerId).toBe('dsh');
    expect(await snapshot.get(thread.id)?.readName()).toBe('Worker');
    expect(snapshot.has('absent')).toBe(false);
    expect(list).toHaveBeenCalledOnce();
  });

  it('keeps configured bridge failure unknown so reconciliation cannot declare members dead', async () => {
    const deps = memberDeps(async () => { throw new MultichatError('DSH_UNAVAILABLE', 'Bridge unavailable.'); });
    await expect(readMemberSnapshot(createLegacyMemberProviders(deps, [thread.id]), { contextId: 'local', nativeIds: [thread.id] })).rejects.toThrow(/unknown/);
  });

  it('treats an unconfigured optional bridge as absent', async () => {
    const deps = memberDeps(async () => { throw new MultichatError('DSH_NOT_CONFIGURED', 'No bridge registered.'); });
    expect((await readMemberSnapshot(createLegacyMemberProviders(deps, [thread.id]), { contextId: 'local', nativeIds: [thread.id] })).size).toBe(0);
  });

  it('rejects cross-tool native-ID collisions instead of assigning Harness over an existing tool', async () => {
    const deps = { ...memberDeps(async () => [thread]), listClaudeSessions: () => ({ sessions: [{ pid: 5, sessionId: thread.id, kind: 'interactive' as const, messagingSocketPath: 'fixture' }], malformed: 0 }) };
    await expect(readMemberSnapshot(createLegacyMemberProviders(deps, [thread.id]), { contextId: 'local', nativeIds: [thread.id] })).rejects.toThrow(/unknown|ambiguous/);
  });

  it('keeps a verified existing Claude source usable during an unrelated Harness outage', async () => {
    const deps = { ...memberDeps(async () => { throw new MultichatError('DSH_UNAVAILABLE', 'Bridge unavailable.'); }), listClaudeSessions: () => ({ sessions: [{ pid: 5, sessionId: 'old-claude', kind: 'interactive' as const, messagingSocketPath: 'fixture' }], malformed: 0 }) };
    const snapshot = await readMemberSnapshot(createLegacyMemberProviders(deps, ['old-claude']), { contextId: 'local', nativeIds: ['old-claude'] });
    expect(snapshot.get('old-claude')?.providerId).toBe('claude');
  });

  it('declares adoption only for verified live Harness delivery capability', () => {
    const provider = defaultMembershipProviders.find((item) => item.providerId === 'dsh');
    expect(provider).toBeDefined();
    const session = { ref: { contextId: 'local', providerId: 'dsh', nativeId: thread.id }, name: thread.name, rawStatus: thread.rawStatus, attributes: {}, capabilities: { discovery: true, delivery: true, deliveryModes: ['queue', 'steer'] as const, launch: false, diagnostics: false } };
    expect(provider?.canAdopt(session).allowed).toBe(true);
    expect(provider?.canAdopt({ ...session, capabilities: { ...session.capabilities, delivery: false } }).allowed).toBe(false);
    expect(provider?.canAdopt({ ...session, rawStatus: { type: 'cold' } }).allowed).toBe(false);
  });
});

interface AttachRequest { op: string; sessionId?: string; tool?: string; name?: string }
async function starFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'crosschat-dsh-members-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'tcp'));
  const entry = { host: '127.0.0.1', port: 1, name: `fixture-${dir.slice(-6)}`, key: 'a'.repeat(64) };
  writeFileSync(join(dir, 'tcp', 'node.json'), JSON.stringify({ brokers: [entry] }));
  const requests: AttachRequest[] = [];
  let members: Array<{ sessionId: string; tool: string }> = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.once('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const end = buffer.indexOf('\n');
        if (end < 0) break;
        const value: unknown = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        if (value === null || typeof value !== 'object' || !('op' in value) || typeof value.op !== 'string') continue;
        const request: AttachRequest = { op: value.op };
        if ('sessionId' in value && typeof value.sessionId === 'string') request.sessionId = value.sessionId;
        if ('tool' in value && typeof value.tool === 'string') request.tool = value.tool;
        if ('name' in value && typeof value.name === 'string') request.name = value.name;
        requests.push(request);
        socket.write(`${JSON.stringify(request.op === 'status' ? { ok: true, online: true, brokerCap: true, members } : { ok: true })}\n`);
      }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(attachPipePath(entry, join(dir, 'tcp')), resolve); });
  cleanup.push(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const errors: string[] = [];
  const deps: StarJoinDeps = { tcpBaseDir: dir, stdout: () => {}, stderr: (message) => errors.push(message), log: () => {},
    listClaudeSessions: () => ({ sessions: [] }), listCodexThreads: async () => [], listDshThreads: async () => [thread],
    spawnServeDetach: () => { throw new Error('Fixture aggregator must be available.'); }, machineName: 'fixture-machine', now: Date.now };
  return { dir, deps, requests, errors, setMembers: (value: typeof members) => { members = value; } };
}

describe('DeepSeek Harness existing-session adoption', () => {
  it('adopts the exact existing native session with dsh tool identity without launching a replacement', async () => {
    const fixture = await starFixture();
    expect(await runAdopt({ connect: '', adopt: `dsh/${thread.id}` }, fixture.deps)).toBe(0);
    expect(fixture.requests).toContainEqual({ op: 'attach', sessionId: thread.id, tool: 'dsh', name: thread.name });
  });

  it('refuses a native ID also live in another tool before attaching', async () => {
    const fixture = await starFixture();
    fixture.deps.listClaudeSessions = () => ({ sessions: [{ sessionId: thread.id, name: 'Old tool' }] });
    expect(await runAdopt({ connect: '', adopt: `dsh/${thread.id}` }, fixture.deps)).toBe(1);
    expect(fixture.requests.some((request) => request.op === 'attach')).toBe(false);
  });

  it('does not report an existing other-tool roster entry as an idempotent Harness adoption', async () => {
    const fixture = await starFixture(); fixture.setMembers([{ sessionId: thread.id, tool: 'claude' }]);
    expect(await runAdopt({ connect: '', adopt: `dsh/${thread.id}` }, fixture.deps)).toBe(1);
    expect(fixture.requests.some((request) => request.op === 'attach')).toBe(false);
  });

  it('preserves exact legacy adoption during a Harness outage and surfaces explicit Harness faults', async () => {
    const fixture = await starFixture();
    fixture.deps.listClaudeSessions = () => ({ sessions: [{ sessionId: 'claude-native', name: 'Legacy' }] });
    fixture.deps.listDshThreads = async () => { throw new MultichatError('DSH_UNAVAILABLE', 'Bridge unavailable.'); };
    expect(await runAdopt({ connect: '', adopt: 'Legacy' }, fixture.deps)).toBe(0);
    expect(await runAdopt({ connect: '', adopt: 'dsh/Worker' }, fixture.deps)).toBe(1);
    expect(fixture.errors).toContain('adopt: Bridge unavailable.');
  });

  it.each(['opencode/legacy-open', 'Leg'])('preserves an existing qualified or prefix selector during an unrelated Harness outage (%s)', async (query) => {
    const fixture = await starFixture();
    fixture.deps.listClaudeSessions = () => ({ sessions: [{ sessionId: 'claude-native', name: 'Legacy' }] });
    fixture.deps.listOpenCodeThreads = async () => [{ id: 'legacy-open', name: 'Open Worker', cwd: '', rawStatus: { type: 'idle' }, attributes: {} }];
    fixture.deps.listDshThreads = async () => { throw new MultichatError('DSH_UNAVAILABLE', 'Bridge unavailable.'); };
    expect(await runAdopt({ connect: '', adopt: query }, fixture.deps)).toBe(0);
    expect(fixture.requests).toContainEqual(expect.objectContaining({ op: 'attach', sessionId: query.startsWith('opencode/') ? 'legacy-open' : 'claude-native' }));
  });

  it('passes the Harness native source through the public serve adoption command', async () => {
    const fixture = await starFixture();
    expect(await runServe({ connect: '', adopt: 'dsh/Worker' }, { baseDir: fixture.dir, stdout: () => {}, stderr: () => {}, env: {}, version: 'fixture',
      machineId: () => 'machine', hostname: () => 'fixture', networkInterfaces: () => ({}), now: Date.now, onSignal: () => {},
      makeSendDeps: () => ({ env: {}, listClaudeSessions: () => ({ sessions: [], malformed: 0 }), listCodexThreads: async () => [], listDshThreads: fixture.deps.listDshThreads,
        deliverClaude: async () => ({ status: 'delivered' }), deliverCodex: async () => ({ status: 'accepted', turnId: 'unused' }),
        sendLogFile: join(fixture.dir, 'send-log.jsonl'), outboxDir: join(fixture.dir, 'outbox'), now: Date.now }),
    })).toBe(0);
    expect(fixture.requests).toContainEqual({ op: 'attach', sessionId: thread.id, tool: 'dsh', name: thread.name });
  });
});
