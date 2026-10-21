import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { ensureAggregator, type StarJoinDeps } from '../src/commands/session-star.js';
import type { SendDeps } from '../src/application/send/types.js';
import { FileInbox } from '../src/serve/file-channel.js';
import { NodeClient } from '../src/serve/node.js';
import type { BrokerEntry } from '../src/serve/node-config.js';

const STAR_A = 'aaaabbbbcccc';
const NODE_KEY = 'a'.repeat(64);
const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
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
async function controlledBroker(rejectNodes = false) {
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
      }
      socket.send(JSON.stringify({ op: 'connected', starId: STAR_A, name: 'alpha' }));
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

function nodeClient(home: string, entry: BrokerEntry, logs: string[] = []): NodeClient {
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
  it('ends the node leg and blocks launcher auto-start while preserving node.json', async () => {
    const home = temporaryHome();
    const broker = await controlledBroker();
    const entry = { host: '127.0.0.1', port: broker.port, name: 'alpha', starId: STAR_A, key: NODE_KEY };
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
    const status: unknown = JSON.parse(readFileSync(join(home, 'tcp', 'status-node-alpha.json'), 'utf8'));
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
    const entry = { host: '127.0.0.1', port: broker.port, name: 'alpha', starId: STAR_A, key: NODE_KEY };
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
    const entry = { host: '127.0.0.1', port: broker.port, name: 'alpha', starId: STAR_A, key: NODE_KEY };
    writeFileSync(join(home, 'tcp', 'node.json'), JSON.stringify({ brokers: [entry] }));
    const logs: string[] = [];
    const client = nodeClient(home, entry, logs);
    void client.run();

    await expect.poll(() => broker.nodes.length, { timeout: 1_000 }).toBeGreaterThanOrEqual(2);

    expect(logs.some((line) => line.includes('BAD_AUTH'))).toBe(true);
    expect(readdirSync(join(home, 'tcp')).filter((name) => name.startsWith('revoked-'))).toEqual([]);
  });
});
