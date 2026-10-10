import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { type RawData } from 'ws';
import { Broker, type BrokerDeps } from '../src/serve/broker.js';
import { encodeFrame, parseFrame, type Frame } from '../src/serve/protocol.js';
import { registryFileOf, writeRegistry, type NodeEntry } from '../src/serve/registry.js';
import { NodeClient, readNodeConfig, NOT_JOINED_MESSAGE } from '../src/serve/node.js';
import { FileInbox } from '../src/serve/file-channel.js';
import type { SendDeps } from '../src/commands/send.js';
import { MultichatError } from '../src/errors.js';
import { runServe, type ServeDeps } from '../src/commands/serve.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-serve-node-'));
afterEach(() => {
  for (const c of clients) c.close();
  clients.length = 0;
});
const clients: { close(): void }[] = [];

const key = (c: string) => c.repeat(64);
const slowHeartbeat = { heartbeatMs: 10_000, pongTimeoutMs: 20_000, connectTimeoutMs: 5_000 };

interface Harness {
  url: string;
  registryFile: string;
  broker: Broker;
  logs: string[];
  stop(): Promise<void>;
}

const brokers: Broker[] = [];

async function startBroker(overrides: Partial<BrokerDeps> = {}): Promise<Harness> {
  const dir = mkdtempSync(join(root, 'case-'));
  const registryFile = registryFileOf(dir);
  const logs: string[] = [];
  const deliverLocal = overrides.deliverLocal ?? (async () => ({ op: 'error' as const, code: 'NOT_READY', message: 'nope' }));
  const broker = new Broker({
    registryFile,
    statusFile: join(dir, 'status-broker.json'),
    version: 'test',
    machineId: () => 'BROKER-MID',
    hostname: () => 'broker-host',
    now: () => Date.now(),
    log: (line) => logs.push(line),
    deliverLocal,
    port: 0,
    ...slowHeartbeat,
    ...overrides,
  });
  brokers.push(broker);
  const port = await broker.start();
  return { url: `ws://127.0.0.1:${port}`, registryFile, broker, logs, stop: () => broker.stop() };
}

function seed(file: string, nodes: Partial<NodeEntry>[]): void {
  writeRegistry(file, {
    nodes: nodes.map((n, i) => ({
      label: n.label ?? `node-${i + 1}`,
      key: n.key ?? key(`${i + 1}`),
      machineId: n.machineId,
      machineName: n.machineName,
      addedAt: '2026-01-01T00:00:00.000Z',
    })),
  });
}

class TestClient {
  readonly ws: WebSocket;
  private readonly frames: Frame[] = [];
  private readonly waiters: { pred: (f: Frame) => boolean; resolve: (f: Frame) => void; timer: ReturnType<typeof setTimeout> }[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    clients.push(this);
    this.ws.on('message', (data: RawData) => {
      const frame = parseFrame(data.toString());
      if (frame === undefined) return;
      this.frames.push(frame);
      for (let i = 0; i < this.waiters.length; i++) {
        const w = this.waiters[i]!;
        if (w.pred(frame)) {
          clearTimeout(w.timer);
          this.waiters.splice(i, 1);
          w.resolve(frame);
          return;
        }
      }
    });
  }

  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === WebSocket.OPEN) return resolve();
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
  }

  waitFor(pred: (f: Frame) => boolean, timeoutMs = 5_000): Promise<Frame> {
    const existing = this.frames.find(pred);
    if (existing !== undefined) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('waitFor timeout')), timeoutMs);
      this.waiters.push({ pred, resolve, timer });
    });
  }

  send(frame: Frame): void {
    this.ws.send(encodeFrame(frame));
  }

  close(): void {
    this.ws.close();
  }
}

/** 发送方角色握手（via-tcp 的 SenderConn 等价物）。 */
async function senderOn(url: string, auth: string): Promise<TestClient> {
  const client = new TestClient(url);
  await client.opened();
  await client.waitFor((f) => f.op === 'info');
  client.send({ op: 'connect', proto: 1, role: 'sender', auth });
  await client.waitFor((f) => f.op === 'connected');
  return client;
}

interface FakeSendCapture {
  deps: SendDeps;
  delivered: string[];
  sessionNames: Map<string, string>;
}

/** 可控 SendDeps：named claude 会话直接投递成功，投递内容被捕获。 */
function fakeSendDeps(withSession = true): FakeSendCapture {
  const delivered: string[] = [];
  const capture: FakeSendCapture = {
    delivered,
    sessionNames: new Map(withSession ? [['sess-boss', 'boss']] : []),
    deps: {
      env: {},
      listClaudeSessions: () =>
        withSession
          ? {
              sessions: [{ pid: 1, sessionId: 'sess-boss', kind: 'interactive', name: 'boss', status: 'idle', messagingSocketPath: 'x' }],
              malformed: 0,
            }
          : { sessions: [], malformed: 0 },
      listCodexThreads: async () => [],
      deliverClaude: async (_t, content) => {
        delivered.push(content);
        return { status: 'delivered' };
      },
      deliverCodex: async () => ({ status: 'accepted', turnId: 't' }),
      rateDir: mkdtempSync(join(root, 'rate-')),
      outboxDir: mkdtempSync(join(root, 'outbox-')),
      now: () => Date.now(),
      hostname: () => 'node-host',
      machineId: () => 'NODE-MID',
    },
  };
  return capture;
}

function makeNodeClient(harness: Harness, dir: string, overrides: Partial<ConstructorParameters<typeof NodeClient>[0]> = {}): NodeClient {
  const inbox = mkdtempSync(join(root, 'node-'));
  return new NodeClient({
    config: { broker: { host: '127.0.0.1', port: Number(new URL(harness.url).port), alias: 'broker-alias' }, key: key('n') },
    machineId: () => 'NODE-MID',
    statusFile: join(dir, 'status-node.json'),
    fileInbox: new FileInbox({ inboxDir: join(inbox, 'inbox'), partsDir: join(inbox, 'parts') }),
    makeSendDeps: () => fakeSendDeps().deps,
    now: () => Date.now(),
    log: () => {},
    backoffBaseMs: 50,
    ...overrides,
  });
}

describe('node client lifecycle', () => {
  it('connects, goes online and writes the status file with brokerAlias', async () => {
    const harness = await startBroker();
    seed(harness.registryFile, [{ key: key('n'), machineName: 'node-host' }]);
    const dir = mkdtempSync(join(root, 'st-'));
    const logs: string[] = [];
    const client = makeNodeClient(harness, dir, { log: (l) => logs.push(l) });
    const runPromise = client.run();
    await client.waitForState('online');
    const status = JSON.parse(readFileSync(join(dir, 'status-node.json'), 'utf8')) as { state: string; brokerAlias: string };
    expect(status.state).toBe('online');
    expect(status.brokerAlias).toBe('broker-alias');
    expect(logs.some((l) => l.includes('online'))).toBe(true);
    await client.stop();
    expect(await runPromise.then(() => 'done')).toBe('done');
  }, 10_000);

  it('maps a deliver frame to runSend and returns a structured result through the broker', async () => {
    const harness = await startBroker();
    seed(harness.registryFile, [{ key: key('n'), machineId: 'NODE-MID', machineName: 'node-host' }]);
    const dir = mkdtempSync(join(root, 'st-'));
    const capture = fakeSendDeps(true);
    const client = makeNodeClient(harness, dir, { makeSendDeps: () => capture.deps });
    void client.run();
    await client.waitForState('online');
    const sender = await senderOn(harness.url, key('n'));
    sender.send({ op: 'send', id: 's1', targetMachine: 'node-host', to: 'boss', body: 'hello via tcp', origin: undefined });
    const receipt = await sender.waitFor((f) => f.op === 'receipt' && f.id === 's1');
    expect(receipt).toMatchObject({ op: 'receipt', id: 's1', status: 'delivered' });
    if (receipt.op === 'receipt') {
      expect(receipt.replyRef).toMatch(/^mc[12]_/);
      const output = JSON.parse(receipt.output ?? '') as { status: string; to: string };
      expect(output).toMatchObject({ status: 'delivered', to: 'boss' });
    }
    // 正文与 to 到达了本机 runSend（与 ssh 远端 CLI 同权）
    expect(capture.delivered.length).toBe(1);
    expect(capture.delivered[0]).toContain('hello via tcp');
    await client.stop();
  }, 10_000);

  it('maps a MultichatError from runSend to a same-code error frame at the sender', async () => {
    const harness = await startBroker();
    seed(harness.registryFile, [{ key: key('n'), machineId: 'NODE-MID', machineName: 'node-host' }]);
    const dir = mkdtempSync(join(root, 'st-'));
    const capture = fakeSendDeps(false); // 无会话 → runSend 抛 TARGET_NOT_FOUND
    const client = makeNodeClient(harness, dir, { makeSendDeps: () => capture.deps });
    void client.run();
    await client.waitForState('online');
    const sender = await senderOn(harness.url, key('n'));
    sender.send({ op: 'send', id: 's2', targetMachine: 'node-host', to: 'nobody', body: 'x' });
    const err = await sender.waitFor((f) => f.op === 'error' && f.id === 's2');
    expect(err).toMatchObject({ op: 'error', id: 's2', code: 'NAME_NOT_FOUND' });
    await client.stop();
  }, 10_000);

  it('never gives up on auth failure: cycles connecting→reconnect-wait→connecting', async () => {
    const harness = await startBroker({ authFailDelayMs: 20 });
    seed(harness.registryFile, [{ key: key('a'), machineName: 'node-host' }]); // 客户端持 key('n') → 恒 BAD_AUTH
    const dir = mkdtempSync(join(root, 'st-'));
    const logs: string[] = [];
    const client = makeNodeClient(harness, dir, { log: (l) => logs.push(l), backoffBaseMs: 30 });
    void client.run();
    await client.waitForState('reconnect-wait');
    await client.waitForState('connecting'); // 第二轮尝试
    expect(logs.some((l) => l.includes('BAD_AUTH'))).toBe(true);
    const status = JSON.parse(readFileSync(join(dir, 'status-node.json'), 'utf8')) as { state: string; nextAttemptAt?: string };
    expect(status.state).toBe('connecting');
    await client.stop();
  }, 10_000);

  it('reconnects after the broker restarts on the same port', async () => {
    const harness = await startBroker();
    seed(harness.registryFile, [{ key: key('n'), machineId: 'NODE-MID', machineName: 'node-host' }]);
    const port = Number(new URL(harness.url).port);
    const dir = mkdtempSync(join(root, 'st-'));
    const client = makeNodeClient(harness, dir, {
      config: { broker: { host: '127.0.0.1', port, alias: 'broker-alias' }, key: key('n') },
      backoffBaseMs: 60,
    });
    void client.run();
    await client.waitForState('online');
    await harness.stop();
    await client.waitForState('reconnect-wait');
    // 同端口拉起新 broker——客户端应自行回到 online
    const registryFile = harness.registryFile;
    const logs2: string[] = [];
    const broker2 = new Broker({
      registryFile,
      statusFile: join(root, 'status-broker2.json'),
      version: 'test',
      machineId: () => 'BROKER-MID',
      hostname: () => 'broker-host',
      now: () => Date.now(),
      log: (l) => logs2.push(l),
      deliverLocal: async () => ({ op: 'error', code: 'NOT_READY', message: 'x' }),
      port,
      ...slowHeartbeat,
    });
    brokers.push(broker2);
    await broker2.start();
    await client.waitForState('online', 8_000);
    await client.stop();
  }, 15_000);
});

describe('readNodeConfig and runServe --connect', () => {
  it('teaches the missing node.json with NOT_JOINED_MESSAGE', () => {
    try {
      readNodeConfig(join(root, 'missing-node.json'));
      expect.unreachable('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(MultichatError);
      expect((e as MultichatError).message).toContain(NOT_JOINED_MESSAGE.slice(0, 20));
    }
  });

  it('runServe --connect without node.json fails with the teaching error', async () => {
    const dir = mkdtempSync(join(root, 'case-'));
    const deps: ServeDeps = {
      baseDir: dir,
      stdout: () => {},
      env: {},
      version: 'test',
      machineId: () => 'MID',
      hostname: () => 'h',
      networkInterfaces: () => ({}),
      now: () => Date.now(),
      onSignal: () => {},
    };
    const err: unknown = await runServe({ connect: '' }, deps).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MultichatError);
    expect((err as MultichatError).message).toContain('本机未入网');
  });

  it('rejects a --connect alias that contradicts node.json', async () => {
    const dir = mkdtempSync(join(root, 'case-'));
    mkdirSync(join(dir, 'tcp'), { recursive: true });
    writeFileSync(join(dir, 'tcp', 'node.json'), JSON.stringify({ broker: { host: 'h', port: 1, alias: 'real-alias' }, key: 'k' }));
    const deps: ServeDeps = {
      baseDir: dir,
      stdout: () => {},
      env: {},
      version: 'test',
      machineId: () => 'MID',
      hostname: () => 'h',
      networkInterfaces: () => ({}),
      now: () => Date.now(),
      onSignal: () => {},
    };
    const err: unknown = await runServe({ connect: 'other' }, deps).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MultichatError);
    expect((err as MultichatError).message).toContain('real-alias');
  });
});
