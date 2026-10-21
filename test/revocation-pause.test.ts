import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { connectAttachPipe, ensureAggregator, queryAttachStatus, StarJoiner, type StarJoinDeps } from '../src/commands/session-star.js';
import { runStatus } from '../src/commands/status.js';
import type { SendDeps } from '../src/application/send/types.js';
import { FileInbox } from '../src/serve/file-channel.js';
import { attachPipePath, NodeClient, type NodeClientDeps } from '../src/serve/node.js';
import type { BrokerEntry } from '../src/serve/node-config.js';
import { writeNodeRevocation } from '../src/serve/revocation.js';

const FIXTURE_ID = randomUUID().slice(0, 8);
const NAME_A = 'revoked-' + FIXTURE_ID + '-alpha';
const NAME_B = 'revoked-' + FIXTURE_ID + '-beta';
const STAR_A = 'aaaabbbbcccc';
const NODE_KEY = 'a'.repeat(64);
const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const dispose of cleanup.reverse()) await dispose();
  cleanup.length = 0;
});

function temporaryHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'crosschat-revocation-'));
  cleanup.push(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, 'tcp'));
  return home;
}

/** Controlled broker boundary: no real credentials, providers or native children. */
async function controlledBroker(rejectNodes = false, options: { starId?: string; name?: string; revokeBeforeConnected?: boolean } = {}) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('missing fixture port');
  const nodes: WebSocket[] = [];
  server.on('connection', (socket) => {
    socket.send(JSON.stringify({ op: 'info', proto: 1, server: 'test', caps: ['multi-star', 'session-members'] }));
    socket.on('message', (data) => {
      const raw: unknown = JSON.parse(String(data));
      if (raw === null || typeof raw !== 'object' || !('op' in raw) || raw.op !== 'connect') return;
      if ('role' in raw && raw.role === 'node') {
        nodes.push(socket);
        if (rejectNodes) {
          socket.send(JSON.stringify({ op: 'error', code: 'BAD_AUTH', message: 'fixture refuses authentication' }));
          socket.close(1008, 'bad auth');
          return;
        }
        if (options.revokeBeforeConnected) {
          revoke(socket, options.starId ?? STAR_A);
          return;
        }
      }
      socket.send(JSON.stringify({ op: 'connected', starId: options.starId ?? STAR_A, name: options.name ?? NAME_A }));
    });
  });
  cleanup.push(async () => {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { port: address.port, nodes };
}

function fakeSendDeps(home: string): SendDeps {
  return {
    env: {},
    listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
    listCodexThreads: async () => [],
    deliverClaude: async () => { throw new Error('native delivery must not run'); },
    deliverCodex: async () => { throw new Error('native delivery must not run'); },
    sendLogFile: join(home, 'send-log.jsonl'),
    outboxDir: join(home, 'outbox'),
    now: Date.now,
    hostname: () => 'fixture-node',
    machineId: () => 'fixture-mid',
  };
}

function nodeClient(home: string, entry: BrokerEntry, logs: string[] = [], extra: Partial<NodeClientDeps> = {}): NodeClient {
  const client = new NodeClient({
    config: { entries: [{ ...entry }] },
    configFile: join(home, 'tcp', 'node.json'),
    statusFile: join(home, 'tcp', `status-node-${entry.name}.json`),
    machineId: () => 'fixture-mid',
    fileInbox: new FileInbox({ inboxDir: join(home, 'inbox'), partsDir: join(home, 'parts') }),
    makeSendDeps: () => fakeSendDeps(home),
    codexHome: join(home, 'codex'),
    backoffBaseMs: 20,
    memberCheckMs: 60_000,
    now: Date.now,
    log: (line) => logs.push(line),
    ...extra,
  });
  cleanup.push(() => client.stop());
  return client;
}

function launcherDeps(home: string, spawned: string[]): StarJoinDeps {
  return {
    tcpBaseDir: home,
    stdout: () => {},
    stderr: () => {},
    log: () => {},
    listClaudeSessions: () => ({ sessions: [] }),
    listCodexThreads: async () => [],
    spawnServeDetach: (selector) => { spawned.push(selector); },
    machineName: 'fixture-node',
    aggregatorTimeoutMs: 50,
  };
}

function revoke(socket: WebSocket, starId = STAR_A): void {
  socket.send(JSON.stringify({
    op: 'credential-revoked', starId, kind: 'node', reason: 'node-removed',
    message: 'Node credential revoked; replace the key and explicitly reconnect.',
  }));
}

describe('explicit credential revocation pauses this star', () => {
  it.each([0, 120_000])('does not report a new key as revoked from a %ims old snapshot', async (ageMs) => {
    const home = temporaryHome();
    const entry = { host: 'fixture', port: 9, name: NAME_A, starId: STAR_A, key: NODE_KEY };
    const configFile = join(home, 'tcp', 'node.json');
    writeNodeRevocation(configFile, entry, STAR_A, Date.now() - ageMs);
    writeFileSync(configFile, JSON.stringify({ brokers: [{ ...entry, key: 'b'.repeat(64) }] }));
    writeFileSync(join(home, 'tcp', 'status-node.json'), JSON.stringify({
      state: 'revoked', brokerAlias: NAME_A, since: new Date(Date.now() - ageMs).toISOString(),
      lastUpdated: new Date(Date.now() - ageMs).toISOString(),
    }));
    const deps = { tcpDir: join(home, 'tcp'), listClaudeSessions: () => ({ sessions: [], malformed: 0 }), listCodexThreads: async () => [] };

    const summary = await runStatus(deps, false);
    const detail = await runStatus(deps, false, false, { section: 'claude' });

    expect(summary).not.toContain('凭证已撤销');
    expect(detail).not.toContain('凭证已撤销');
    expect(summary).toContain('暂停状态待核实');
    expect(detail).toContain('暂停状态待核实');
    expect(JSON.parse(await runStatus(deps, true))).toMatchObject({
      tcp: { node: { state: 'revoked', pause: { state: 'unknown' } } },
    });

    writeFileSync(configFile, JSON.stringify({ brokers: [entry] }));
    expect(await runStatus(deps, false)).toContain('凭证已撤销，自动重连已暂停');
    expect(JSON.parse(await runStatus(deps, true))).toMatchObject({
      tcp: { node: { state: 'revoked', pause: { state: 'revoked' } } },
    });
    const marker = readdirSync(join(home, 'tcp')).find((name) => name.startsWith('revoked-'));
    writeFileSync(join(home, 'tcp', marker!), '{broken');
    const unreadable = await runStatus(deps, false, false, { section: 'claude' });
    expect(unreadable).toContain('记录不可读，连接状态 unknown');
    expect(unreadable).not.toContain('凭证已撤销');
  });

  it('settles an attach request when immediate revocation closes IPC before the reply', async () => {
    const home = temporaryHome();
    const path = attachPipePath({ host: 'fixture', port: 9, key: NODE_KEY, name: `${NAME_A}-close` }, join(home, 'tcp'));
    const server = createServer((socket) => socket.once('data', () => socket.destroy()));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(path, resolve);
    });
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const pipe = await connectAttachPipe(path);
    cleanup.push(() => pipe.close());
    const bounded = <T>(pending: Promise<T>): Promise<T | { timeout: true }> => Promise.race([
      pending,
      new Promise<{ timeout: true }>((resolve) => setTimeout(() => resolve({ timeout: true }), 120)),
    ]);

    const reply = await bounded(pipe.send({ op: 'attach', sessionId: 'fixture-native' }));

    expect(reply).toMatchObject({ ok: false, error: expect.any(String) });
    await pipe.waitClose();
    expect(await bounded(pipe.send({ op: 'detach', sessionId: 'fixture-native' })))
      .toMatchObject({ ok: false, error: expect.any(String) });
  });

  it('ends the node leg and blocks launcher auto-start while preserving node.json', async () => {
    const home = temporaryHome();
    const broker = await controlledBroker();
    const entry = { host: '127.0.0.1', port: broker.port, name: NAME_A, starId: STAR_A, key: NODE_KEY };
    const configFile = join(home, 'tcp', 'node.json');
    const config = `${JSON.stringify({ brokers: [entry] }, null, 2)}\n`;
    writeFileSync(configFile, config);
    const client = nodeClient(home, entry);
    let finished = false;
    const running = client.run().then(() => { finished = true; });
    await client.waitForState('online');

    revoke(broker.nodes[0]!);

    await expect.poll(() => finished, { timeout: 800 }).toBe(true);
    await running;
    const status: unknown = JSON.parse(readFileSync(join(home, 'tcp', `status-node-${entry.name}.json`), 'utf8'));
    expect(status).toMatchObject({ state: 'revoked' });
    expect(readFileSync(configFile, 'utf8')).toBe(config);
    const spawned: string[] = [];
    await expect(ensureAggregator(launcherDeps(home, spawned), entry, 'alpha'))
      .rejects.toMatchObject({ code: 'CREDENTIAL_REVOKED' });
    expect(spawned).toEqual([]);
    expect(broker.nodes).toHaveLength(1);
  });

  it('ordinary disconnect still reconnects with the existing backoff', async () => {
    const home = temporaryHome();
    const broker = await controlledBroker();
    const entry = { host: '127.0.0.1', port: broker.port, name: NAME_A, starId: STAR_A, key: NODE_KEY };
    writeFileSync(join(home, 'tcp', 'node.json'), JSON.stringify({ brokers: [entry] }));
    const client = nodeClient(home, entry);
    void client.run();
    await client.waitForState('online');

    broker.nodes[0]!.close(1001, 'fixture network loss');

    await expect.poll(() => broker.nodes.length, { timeout: 1_000 }).toBe(2);
    await client.waitForState('online');
    expect(readdirSync(join(home, 'tcp')).filter((name) => name.startsWith('revoked-'))).toEqual([]);
  });

  it('BAD_AUTH retries and does not manufacture an explicit revocation pause', async () => {
    const home = temporaryHome();
    const broker = await controlledBroker(true);
    const entry = { host: '127.0.0.1', port: broker.port, name: NAME_A, starId: STAR_A, key: NODE_KEY };
    writeFileSync(join(home, 'tcp', 'node.json'), JSON.stringify({ brokers: [entry] }));
    const logs: string[] = [];
    const client = nodeClient(home, entry, logs);
    void client.run();

    await expect.poll(() => broker.nodes.length, { timeout: 1_000 }).toBeGreaterThanOrEqual(2);

    expect(logs.some((line) => line.includes('BAD_AUTH'))).toBe(true);
    expect(readdirSync(join(home, 'tcp')).filter((name) => name.startsWith('revoked-'))).toEqual([]);
  });

  it('persists a handshake-time revocation even before starId was filled into config', async () => {
    const home = temporaryHome();
    const broker = await controlledBroker(false, { revokeBeforeConnected: true });
    const entry = { host: '127.0.0.1', port: broker.port, name: NAME_A, key: NODE_KEY };
    const config = JSON.stringify({ brokers: [entry] });
    writeFileSync(join(home, 'tcp', 'node.json'), config);
    const client = nodeClient(home, entry);

    await client.run();

    expect(readFileSync(join(home, 'tcp', 'node.json'), 'utf8')).toBe(config);
    const spawned: string[] = [];
    await expect(ensureAggregator(launcherDeps(home, spawned), entry, 'alpha'))
      .rejects.toMatchObject({ code: 'CREDENTIAL_REVOKED' });
    expect(spawned).toEqual([]);
    const markers = readdirSync(join(home, 'tcp')).filter((name) => name.startsWith('revoked-'));
    expect(markers).toHaveLength(1);
    expect(markers[0]).not.toContain(NODE_KEY);
    const evidence = readFileSync(join(home, 'tcp', markers[0]!), 'utf8');
    expect(evidence).not.toContain(NODE_KEY);
    expect(JSON.parse(evidence)).toMatchObject({ starId: STAR_A, reason: 'node-removed' });
  });

  it('retains the old pause while a new key can explicitly connect', async () => {
    const home = temporaryHome();
    const broker = await controlledBroker();
    const entry = { host: '127.0.0.1', port: broker.port, name: NAME_A, starId: STAR_A, key: NODE_KEY };
    writeFileSync(join(home, 'tcp', 'node.json'), JSON.stringify({ brokers: [entry] }));
    const original = nodeClient(home, entry);
    const running = original.run();
    await original.waitForState('online');
    revoke(broker.nodes[0]!);
    await running;
    const oldRestart = nodeClient(home, entry);
    await oldRestart.run();
    expect(broker.nodes).toHaveLength(1);

    const replacement = { ...entry, key: 'b'.repeat(64) };
    writeFileSync(join(home, 'tcp', 'node.json'), JSON.stringify({ brokers: [replacement] }));
    const reconnected = nodeClient(home, replacement);
    void reconnected.run();
    await reconnected.waitForState('online');

    const pipe = await ensureAggregator(launcherDeps(home, []), replacement, 'alpha');
    cleanup.push(() => pipe.close());
    expect((await queryAttachStatus(pipe))?.online).toBe(true);
    expect(broker.nodes).toHaveLength(2);
    expect(readdirSync(join(home, 'tcp')).filter((name) => name.startsWith('revoked-'))).toHaveLength(1);
  });

  it('ignores a different star, an admin revocation and a malformed revocation', async () => {
    const home = temporaryHome();
    const broker = await controlledBroker();
    const entry = { host: '127.0.0.1', port: broker.port, name: NAME_A, starId: STAR_A, key: NODE_KEY };
    writeFileSync(join(home, 'tcp', 'node.json'), JSON.stringify({ brokers: [entry] }));
    const client = nodeClient(home, entry);
    void client.run();
    await client.waitForState('online');
    const socket = broker.nodes[0]!;
    revoke(socket, 'dddd11112222');
    socket.send(JSON.stringify({ op: 'credential-revoked', starId: STAR_A, kind: 'admin', reason: 'admin-key-revoked', message: 'admin only' }));
    socket.send(JSON.stringify({ op: 'credential-revoked', starId: STAR_A, kind: 'node', reason: 'admin-key-revoked', message: 'wrong shape' }));
    socket.send(JSON.stringify({ op: 'credential-revoked', starId: STAR_A, kind: 'node', reason: 'node-removed' }));
    const pipe = await connectAttachPipe(attachPipePath(entry, join(home, 'tcp')), 5, 10);
    cleanup.push(() => pipe.close());

    expect((await queryAttachStatus(pipe))?.online).toBe(true);
    expect(readdirSync(join(home, 'tcp')).filter((name) => name.startsWith('revoked-'))).toEqual([]);
    expect(broker.nodes).toHaveLength(1);
  });

  it('a corrupt pause record blocks automatic starts instead of silently resuming', async () => {
    const home = temporaryHome();
    const broker = await controlledBroker();
    const entry = { host: '127.0.0.1', port: broker.port, name: NAME_A, starId: STAR_A, key: NODE_KEY };
    writeFileSync(join(home, 'tcp', 'node.json'), JSON.stringify({ brokers: [entry] }));
    const client = nodeClient(home, entry);
    const running = client.run();
    await client.waitForState('online');
    revoke(broker.nodes[0]!);
    await running;
    const marker = readdirSync(join(home, 'tcp')).find((name) => name.startsWith('revoked-'));
    expect(marker).toBeDefined();
    writeFileSync(join(home, 'tcp', marker!), '{broken');
    const spawned: string[] = [];

    await expect(ensureAggregator(launcherDeps(home, spawned), entry, 'alpha'))
      .rejects.toMatchObject({ code: 'REVOCATION_STATE_UNREADABLE' });
    await expect(nodeClient(home, entry).run()).rejects.toMatchObject({ code: 'REVOCATION_STATE_UNREADABLE' });
    expect(spawned).toEqual([]);
    expect(broker.nodes).toHaveLength(1);
  });

  it('stops one launcher supervisor without restarting it or disrupting another star', async () => {
    const home = temporaryHome();
    const alpha = await controlledBroker();
    const beta = await controlledBroker(false, { starId: 'dddd11112222', name: NAME_B });
    // Deliberately use the same credential value: star identity still isolates pause evidence.
    const entryA = { host: '127.0.0.1', port: alpha.port, name: NAME_A, starId: STAR_A, key: NODE_KEY };
    const entryB = { host: '127.0.0.1', port: beta.port, name: NAME_B, starId: 'dddd11112222', key: NODE_KEY };
    writeFileSync(join(home, 'tcp', 'node.json'), JSON.stringify({ brokers: [entryA, entryB] }));
    const nodeA = nodeClient(home, entryA);
    const nodeB = nodeClient(home, entryB);
    const runningA = nodeA.run();
    void nodeB.run();
    await Promise.all([nodeA.waitForState('online'), nodeB.waitForState('online')]);
    const spawned: string[] = [];
    const logs: string[] = [];
    const errors: string[] = [];
    let freshSession = false;
    const deps = launcherDeps(home, spawned);
    deps.log = (line) => logs.push(line);
    deps.stderr = (line) => errors.push(line);
    deps.listClaudeSessions = () => ({ sessions: freshSession ? [{ sessionId: 'fixture-session', name: 'native-session' }] : [] });
    const joiner = new StarJoiner({ deps, side: 'claude', connects: [NAME_A, NAME_B] });
    cleanup.push(() => joiner.stop());
    await joiner.begin();
    freshSession = true;
    await expect.poll(() => logs.filter((line) => line.startsWith('已入星')).length).toBe(2);

    revoke(alpha.nodes[0]!);
    await runningA;

    await expect.poll(() => errors.some((line) => line.includes('凭证已撤销'))).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(spawned).toEqual([]);
    expect(alpha.nodes).toHaveLength(1);
    expect(beta.nodes).toHaveLength(1);
    const pipe = await ensureAggregator(deps, entryB, 'beta');
    cleanup.push(() => pipe.close());
    expect(await queryAttachStatus(pipe)).toMatchObject({ online: true, members: [{ sessionId: 'fixture-session' }] });
  });

  it('ignores a delayed revocation from a socket that has already been replaced', async () => {
    const home = temporaryHome();
    const entry = { host: 'fixture', port: 9, name: NAME_A, starId: STAR_A, key: NODE_KEY };
    writeFileSync(join(home, 'tcp', 'node.json'), JSON.stringify({ brokers: [entry] }));
    class BufferedSocket extends EventEmitter {
      readyState: number = WebSocket.CONNECTING;
      constructor() {
        super();
        queueMicrotask(() => {
          this.readyState = WebSocket.OPEN;
          this.emit('open');
          this.emit('message', JSON.stringify({ op: 'info', proto: 1, server: 'test', caps: ['multi-star', 'session-members'] }));
        });
      }
      send(data: string): void {
        const raw: unknown = JSON.parse(data);
        if (raw !== null && typeof raw === 'object' && 'op' in raw && raw.op === 'connect') {
          queueMicrotask(() => this.emit('message', JSON.stringify({ op: 'connected', starId: STAR_A, name: NAME_A })));
        }
      }
      close(): void {
        this.readyState = WebSocket.CLOSED;
        this.emit('close');
      }
    }
    const sockets: BufferedSocket[] = [];
    const client = nodeClient(home, entry, [], {
      makeSocket: () => {
        const socket = new BufferedSocket();
        sockets.push(socket);
        return socket;
      },
    });
    void client.run();
    await client.waitForState('online');
    sockets[0]!.close();
    await expect.poll(() => sockets.length).toBe(2);
    await client.waitForState('online');

    sockets[0]!.emit('message', JSON.stringify({ op: 'credential-revoked', starId: STAR_A, kind: 'node', reason: 'node-removed', message: 'stale notification' }));

    const pipe = await connectAttachPipe(attachPipePath(entry, join(home, 'tcp')), 5, 10);
    cleanup.push(() => pipe.close());
    expect((await queryAttachStatus(pipe))?.online).toBe(true);
    expect(readdirSync(join(home, 'tcp')).filter((name) => name.startsWith('revoked-'))).toEqual([]);
  });

  it('keeps a paused IPC owner if the pause evidence cannot be persisted', async () => {
    const home = temporaryHome();
    const broker = await controlledBroker();
    const entry = { host: '127.0.0.1', port: broker.port, name: NAME_A, starId: STAR_A, key: NODE_KEY };
    writeFileSync(join(home, 'tcp', 'node.json'), JSON.stringify({ brokers: [entry] }));
    const client = nodeClient(home, entry);
    let finished = false;
    void client.run().then(() => { finished = true; });
    await client.waitForState('online');
    const pipe = await connectAttachPipe(attachPipePath(entry, join(home, 'tcp')), 5, 10);
    cleanup.push(() => pipe.close());
    const originalRename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
      if (String(target).includes('revoked-')) throw new Error('fixture persistence failure');
      originalRename(source, target);
    });
    syncBuiltinESMExports();

    revoke(broker.nodes[0]!);

    await client.waitForState('revoked');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(finished).toBe(false);
    expect(await pipe.send({ op: 'attach', sessionId: 'native-session' }))
      .toMatchObject({ ok: false, error: expect.stringContaining('凭证已撤销') });
    const spawned: string[] = [];
    const secondPipe = await ensureAggregator(launcherDeps(home, spawned), entry, 'alpha');
    cleanup.push(() => secondPipe.close());
    expect(await secondPipe.send({ op: 'attach', sessionId: 'another-native-session' }))
      .toMatchObject({ ok: false, error: expect.stringContaining('凭证已撤销') });
    expect(spawned).toEqual([]);
    expect(broker.nodes).toHaveLength(1);
  });
});
