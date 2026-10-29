import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLegacyMemberProviders, readMemberSnapshot } from '../src/application/members/index.js';
import { runAdopt, StarJoiner } from '../src/commands/session-star.js';
import type { StarJoinDeps } from '../src/commands/session-star.js';
import { attachPipePath } from '../src/serve/node.js';
import { MultichatError } from '../src/errors.js';
import type { OpenCodeThread } from '../src/opencode/client.js';

vi.mock('../src/serve/via-tcp.js', async (original) => ({
  ...await original<typeof import('../src/serve/via-tcp.js')>(),
  fetchBrokerCaps: async () => ['session-members'],
}));

const thread: OpenCodeThread = {
  id: 'ses_opaque/native@雪', name: 'Worker', cwd: '/isolated/workspace',
  rawStatus: { type: 'idle' }, attributes: {},
};
const dirs: string[] = [];
const pipes: Server[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const pipe of pipes.splice(0)) await new Promise<void>((resolve) => pipe.close(() => resolve()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function memberDeps(listOpenCodeThreads: () => Promise<OpenCodeThread[]>) {
  return {
    listClaudeSessions: () => ({ sessions: [], malformed: 0 }), listCodexThreads: async () => [], listOpenCodeThreads,
    lookupRolloutMetas: () => new Map(), codexHome: 'unused-fixture-home', now: () => 100,
  };
}

describe('OpenCode member liveness', () => {
  it('uses a single native OpenCode snapshot for opaque ids and names without Codex rollouts', async () => {
    const list = vi.fn(async () => [thread]);
    const providers = createLegacyMemberProviders(memberDeps(list), [thread.id, 'ses_absent']);
    const snapshot = await readMemberSnapshot(providers, { contextId: 'local', nativeIds: [thread.id, 'ses_absent'] });
    expect(snapshot.get(thread.id)?.providerId).toBe('opencode');
    expect(await snapshot.get(thread.id)?.readName()).toBe('Worker');
    expect(snapshot.has('ses_absent')).toBe(false);
    expect(list).toHaveBeenCalledOnce();
  });

  it('keeps unreachable OpenCode presence unknown so reconciliation cannot declare sessions dead', async () => {
    const providers = createLegacyMemberProviders(memberDeps(async () => {
      throw new MultichatError('OPENCODE_UNAVAILABLE', 'Service unavailable.');
    }), [thread.id]);
    await expect(readMemberSnapshot(providers, { contextId: 'local', nativeIds: [thread.id] })).rejects.toThrow(/unknown/);
  });

  it('treats a missing OpenCode installation as absent while retaining legacy provider behavior', async () => {
    const providers = createLegacyMemberProviders(memberDeps(async () => {
      throw new MultichatError('OPENCODE_NOT_CONFIGURED', 'No OpenCode registration.');
    }), [thread.id]);
    expect((await readMemberSnapshot(providers, { contextId: 'local', nativeIds: [thread.id] })).size).toBe(0);
  });
});

interface AttachRequest { op: string; sessionId?: string; tool?: string; endpointType?: string; name?: string }

async function starFixture(): Promise<{ deps: StarJoinDeps; requests: AttachRequest[]; setThreads(threads: OpenCodeThread[]): void }> {
  const dir = mkdtempSync(join(tmpdir(), 'crosschat-opencode-members-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'tcp'));
  const entry = { host: '127.0.0.1', port: 1, name: `fixture-${dir.slice(-6)}`, key: 'a'.repeat(64) };
  writeFileSync(join(dir, 'tcp', 'node.json'), JSON.stringify({ brokers: [entry] }));
  const requests: AttachRequest[] = [];
  const pipe = createServer((socket) => {
    sockets.push(socket);
    socket.on('error', (error: NodeJS.ErrnoException) => {
      // Launcher stop closes its pipe while the fixture may finish its reply.
      if (error.code !== 'EPIPE' && error.code !== 'ECONNRESET') throw error;
    });
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const end = buffer.indexOf('\n');
        if (end === -1) break;
        const raw: unknown = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (raw === null || typeof raw !== 'object' || !('op' in raw) || typeof raw.op !== 'string') continue;
        const request: AttachRequest = { op: raw.op };
        if ('sessionId' in raw && typeof raw.sessionId === 'string') request.sessionId = raw.sessionId;
        if ('tool' in raw && typeof raw.tool === 'string') request.tool = raw.tool;
        if ('endpointType' in raw && typeof raw.endpointType === 'string') request.endpointType = raw.endpointType;
        if ('name' in raw && typeof raw.name === 'string') request.name = raw.name;
        requests.push(request);
        socket.write(JSON.stringify(request.op === 'status' ? { ok: true, online: true, brokerCap: true, members: [] } : { ok: true }) + '\n');
      }
    });
  });
  pipes.push(pipe);
  await new Promise<void>((resolve, reject) => { pipe.once('error', reject); pipe.listen(attachPipePath(entry, join(dir, 'tcp')), resolve); });
  let threads: OpenCodeThread[] = [];
  const deps: StarJoinDeps = {
    tcpBaseDir: dir, stdout: () => {}, stderr: () => {}, log: () => {},
    listClaudeSessions: () => ({ sessions: [] }), listCodexThreads: async () => [], listOpenCodeThreads: async () => threads,
    spawnServeDetach: () => { throw new Error('Fixture aggregator must already be available.'); },
    machineName: 'fixture-machine', now: Date.now,
  };
  return { deps, requests, setThreads: (value) => { threads = value; } };
}

describe('OpenCode star entry', () => {
  it('retains exact legacy adoption when a configured OpenCode source is unavailable', async () => {
    const fixture = await starFixture();
    fixture.deps.listClaudeSessions = () => ({ sessions: [{ sessionId: 'claude-native', name: 'Legacy' }] });
    fixture.deps.listOpenCodeThreads = async () => { throw new MultichatError('OPENCODE_UNAVAILABLE', 'Service unavailable.'); };
    expect(await runAdopt({ connect: '', adopt: 'Legacy' }, fixture.deps)).toBe(0);
    expect(fixture.requests).toContainEqual({ op: 'attach', sessionId: 'claude-native', tool: 'claude', endpointType: 'cli', name: 'Legacy' });
  });

  it('reports native discovery failure when adopting an explicit OpenCode target', async () => {
    const fixture = await starFixture();
    const errors: string[] = [];
    fixture.deps.stderr = (message) => errors.push(message);
    fixture.deps.listOpenCodeThreads = async () => { throw new MultichatError('OPENCODE_UNAVAILABLE', 'Service unavailable.'); };
    expect(await runAdopt({ connect: '', adopt: 'opencode/Worker' }, fixture.deps)).toBe(1);
    expect(errors).toEqual(['adopt: Service unavailable.']);
    expect(fixture.requests).not.toContainEqual(expect.objectContaining({ op: 'attach' }));
  });

  it('adopts an existing OpenCode session with its complete native id and provider', async () => {
    const fixture = await starFixture();
    fixture.setThreads([thread]);
    expect(await runAdopt({ connect: '', adopt: 'opencode/Worker' }, fixture.deps)).toBe(0);
    expect(fixture.requests).toContainEqual({ op: 'attach', sessionId: thread.id, tool: 'opencode', endpointType: 'shared', name: 'Worker' });
  });

  it('discovers a newly started OpenCode session and detaches it after the launcher exits', async () => {
    const fixture = await starFixture();
    fixture.setThreads([{ ...thread, id: 'ses_existing', name: 'Existing' }]);
    const joiner = new StarJoiner({ deps: fixture.deps, side: 'opencode', connects: [''] });
    try {
      await joiner.begin();
      fixture.setThreads([thread, { ...thread, id: 'ses_existing', name: 'Existing' }]);
      await vi.waitFor(() => expect(fixture.requests).toContainEqual({ op: 'attach', sessionId: thread.id, tool: 'opencode', endpointType: 'shared', name: 'Worker' }), { timeout: 3000, interval: 20 });
    } finally { await joiner.stop(); }
    expect(fixture.requests).toContainEqual({ op: 'detach', sessionId: thread.id, tool: 'opencode', endpointType: 'shared' });
  });
});
