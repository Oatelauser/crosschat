import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import WebSocket, { type RawData } from 'ws';
import {
  Broker,
  defaultDeliverLocal,
  type BrokerDeps,
} from '../src/serve/broker.js';
import { encodeFrame, parseFrame, type Frame } from '../src/serve/protocol.js';
import { loadBrokerFile, registryFileOf, writeBrokerFile, type NodeEntry } from '../src/serve/registry.js';
import { seedBroker } from './helpers/broker-seed.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-serve-broker-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
afterEach(async () => {
  for (const c of clients) c.ws.close();
  clients.length = 0;
  for (const b of brokers) await b.stop();
  brokers.length = 0;
});

// 心跳踢死之外的全部测试用长周期，避免拖慢
const slowHeartbeat = { heartbeatMs: 10_000, pongTimeoutMs: 20_000, connectTimeoutMs: 5_000 };

const brokers: Broker[] = [];
const clients: TestClient[] = [];
const key = (c: string) => c.repeat(64);

function seed(file: string, nodes: Partial<NodeEntry>[]): void {
  seedBroker(file, {
    stars: [{
      nodes: nodes.map((n, i) => ({
        label: n.label ?? `node-${i + 1}`,
        key: n.key ?? key(`${i + 1}`),
        machineId: n.machineId,
        machineName: n.machineName,
        addedAt: '2026-01-01T00:00:00.000Z',
      })),
    }],
  });
}

async function startBroker(overrides: Partial<BrokerDeps> = {}): Promise<{
  broker: Broker;
  url: string;
  registryFile: string;
  statusFile: string;
  logs: string[];
}> {
  const dir = mkdtempSync(join(root, 'case-'));
  const registryFile = registryFileOf(dir);
  const statusFile = join(dir, 'status-broker.json');
  const logs: string[] = [];
  const broker = new Broker({
    registryFile,
    statusFile,
    version: '1.4.0-test',
    machineId: () => 'BROKER-MID',
    hostname: () => 'broker-host',
    now: () => Date.now(),
    log: (line) => logs.push(line),
    deliverLocal: defaultDeliverLocal,
    port: 0,
    ...slowHeartbeat,
    ...overrides,
  });
  brokers.push(broker);
  const port = await broker.start();
  return { broker, url: `ws://127.0.0.1:${port}`, registryFile, statusFile, logs };
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

  waitFor(pred: (f: Frame) => boolean, timeoutMs = 4_000): Promise<Frame> {
    const existing = this.frames.find(pred);
    if (existing !== undefined) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('waitFor timeout')), timeoutMs);
      this.waiters.push({ pred, resolve, timer });
    });
  }

  closed(timeoutMs = 4_000): Promise<number | undefined> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === WebSocket.CLOSED) return resolve(this.ws.closeCode);
      const timer = setTimeout(() => reject(new Error('close timeout')), timeoutMs);
      this.ws.once('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
  }

  send(frame: Frame): void {
    this.ws.send(encodeFrame(frame));
  }
}

async function handshake(url: string, auth: string, machineId?: string, proto = 1, name?: string): Promise<TestClient> {
  const client = new TestClient(url);
  await client.opened();
  const info = await client.waitFor((f) => f.op === 'info');
  expect(info.op === 'info' && info.proto).toBe(1);
  client.send({
    op: 'connect',
    proto,
    role: machineId === undefined ? 'sender' : 'node',
    machineId,
    auth,
    ...(name === undefined ? {} : { name }),
    caps: ['multi-star'],
  });
  return client;
}

describe('broker handshake and auth', () => {
  it('completes info→connect→connected and backfills machineId + self-reported name to registry', async () => {
    const { url, registryFile, statusFile } = await startBroker();
    seed(registryFile, [{ key: key('a') }]);
    const client = await handshake(url, key('a'), 'm-1111', 1, 'node-host');
    const connected = await client.waitFor((f) => f.op === 'connected');
    expect(connected.op === 'connected' && connected.machineName).toBe('node-host');
    const doc = loadBrokerFile(registryFile);
    expect(doc.stars[0]!.nodes[0]?.machineId).toBe('m-1111');
    expect(doc.stars[0]!.nodes[0]?.machineName).toBe('node-host');
    const status = JSON.parse(readFileSync(statusFile, 'utf8')) as { state: string; onlineNodes: string[]; version?: string };
    expect(status.state).toBe('running');
    expect(status.onlineNodes).toEqual(['node-host']);
    expect(status.version).toBe('1.4.0-test'); // F1：doctor 版本对账的数据源
  });

  it('B2.1: connect without a name leaves machineName undefined (broker-hostname backfill deleted)', async () => {
    const { url, registryFile } = await startBroker();
    seed(registryFile, [{ key: key('a') }]);
    const client = await handshake(url, key('a'), 'm-2222');
    await client.waitFor((f) => f.op === 'connected');
    const doc = loadBrokerFile(registryFile);
    expect(doc.stars[0]!.nodes[0]?.machineId).toBe('m-2222');
    expect(doc.stars[0]!.nodes[0]?.machineName).toBeUndefined();
  });

  it('rejects a wrong key with BAD_AUTH after a constant delay', async () => {
    const t0 = Date.now();
    const { url, registryFile } = await startBroker({ authFailDelayMs: 60 });
    seed(registryFile, [{ key: key('a') }]);
    const client = await handshake(url, key('b'));
    const err = await client.waitFor((f) => f.op === 'error');
    expect(err.op === 'error' && err.code).toBe('BAD_AUTH');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(55);
    expect(await client.closed()).toBeDefined();
  });

  it('rejects protocol mismatch with BAD_PROTO naming the supported version', async () => {
    const { url, registryFile } = await startBroker();
    seed(registryFile, [{ key: key('a') }]);
    const client = await handshake(url, key('a'), 'm-1', 99);
    const err = await client.waitFor((f) => f.op === 'error');
    expect(err.op === 'error' && err.code).toBe('BAD_PROTO');
    expect(err.op === 'error' && err.message).toContain('1');
    expect(await client.closed()).toBeDefined();
  });

  it('rejects a machineId that differs from the registered one', async () => {
    const { url, registryFile } = await startBroker({ authFailDelayMs: 20 });
    seed(registryFile, [{ key: key('a'), machineId: 'm-registered' }]);
    const client = await handshake(url, key('a'), 'm-other');
    const err = await client.waitFor((f) => f.op === 'error');
    expect(err.op === 'error' && err.code).toBe('BAD_AUTH');
  });

  it('replaces an existing connection with the same machineId (old closes 1000)', async () => {
    const { url, registryFile } = await startBroker();
    seed(registryFile, [{ key: key('a'), machineId: 'm-same', machineName: 'box' }]);
    const first = await handshake(url, key('a'), 'm-same');
    await first.waitFor((f) => f.op === 'connected');
    const second = await handshake(url, key('a'), 'm-same');
    await second.waitFor((f) => f.op === 'connected');
    expect(await first.closed()).toBe(1000);
  });

  // B0：info 帧按注册表现发 starId（缺省不发——additive）
  it('carries the registry starId in the info frame, and omits the field without one', async () => {
    const withStar = await startBroker();
    seedBroker(withStar.registryFile, {
      stars: [{ starId: 'a1b2c3d4e5f6', nodes: [{ label: 'node-1', key: key('a'), addedAt: '2026-01-01T00:00:00.000Z' }] }],
    });
    const c1 = new TestClient(withStar.url);
    await c1.opened();
    const info1 = await c1.waitFor((f) => f.op === 'info');
    expect(info1.op === 'info' && info1.starId).toBe('a1b2c3d4e5f6');

    // 032：无 starId 的星（手编形状）——info 照旧省略该字段（additive）
    const withoutStar = await startBroker();
    writeBrokerFile(withoutStar.registryFile, { stars: [{ nodes: [{ label: 'node-1', key: key('a'), addedAt: '2026-01-01T00:00:00.000Z' }] }] });
    const c2 = new TestClient(withoutStar.url);
    await c2.opened();
    const info2 = await c2.waitFor((f) => f.op === 'info');
    expect(info2.op === 'info' && 'starId' in info2).toBe(false);
  });
});

describe('broker send routing', () => {
  async function senderOn(url: string, registryFile: string): Promise<TestClient> {
    seed(registryFile, [{ key: key('s'), label: 'sender-key', machineName: 'sender-host' }]);
    const sender = new TestClient(url);
    await sender.opened();
    await sender.waitFor((f) => f.op === 'info');
    sender.send({ op: 'connect', proto: 1, role: 'sender', auth: key('s'), caps: ['multi-star'] });
    await sender.waitFor((f) => f.op === 'connected');
    return sender;
  }

  it('answers UNKNOWN_MACHINE for an unregistered name', async () => {
    const { url, registryFile } = await startBroker();
    const sender = await senderOn(url, registryFile);
    sender.send({ op: 'send', id: 's1', targetMachine: 'nope', body: 'hi' });
    const err = await sender.waitFor((f) => f.op === 'error');
    expect(err.op === 'error' && err.code).toBe('UNKNOWN_MACHINE');
    expect(err.op === 'error' && err.id).toBe('s1');
  });

  it('answers PEER_OFFLINE for a registered but disconnected machine', async () => {
    const { url, registryFile } = await startBroker();
    const sender = await senderOn(url, registryFile);
    seed(registryFile, [{ key: key('z'), machineId: 'm-gone', machineName: 'gone-host' }]);
    sender.send({ op: 'send', id: 's2', targetMachine: 'gone-host', body: 'hi' });
    const err = await sender.waitFor((f) => f.op === 'error');
    expect(err.op === 'error' && err.code).toBe('PEER_OFFLINE');
  });

  it('answers MACHINE_NAME_COLLISION listing both online short ids', async () => {
    const { url, registryFile } = await startBroker();
    const sender = await senderOn(url, registryFile);
    seed(registryFile, [
      { key: key('c'), machineId: 'aaaa1111-x', machineName: 'dup-host' },
      { key: key('d'), machineId: 'bbbb2222-x', machineName: 'dup-host' },
    ]);
    const dupA = await handshake(url, key('c'), 'aaaa1111-x');
    await dupA.waitFor((f) => f.op === 'connected');
    const dupB = await handshake(url, key('d'), 'bbbb2222-x');
    await dupB.waitFor((f) => f.op === 'connected');
    sender.send({ op: 'send', id: 's3', targetMachine: 'dup-host', body: 'hi' });
    const err = await sender.waitFor((f) => f.op === 'error');
    expect(err.op === 'error' && err.code).toBe('MACHINE_NAME_COLLISION');
    const message = err.op === 'error' ? err.message : '';
    expect(message).toContain('aaaa1111');
    expect(message).toContain('bbbb2222');
  });

  it('forwards deliver to the online node and maps its result back as receipt', async () => {
    const { url, registryFile } = await startBroker();
    const sender = await senderOn(url, registryFile);
    seed(registryFile, [{ key: key('n'), machineId: 'm-node', machineName: 'node-host' }]);
    const node = await handshake(url, key('n'), 'm-node');
    await node.waitFor((f) => f.op === 'connected');
    sender.send({ op: 'send', id: 's4', targetMachine: 'node-host', body: 'hello', origin: 'origin-host' });
    const deliver = await node.waitFor((f) => f.op === 'deliver');
    // F1：fromMachine 只取 roster 真名（sender 注册条目 machineName），不落 origin 编码/占位
    expect(deliver).toMatchObject({ op: 'deliver', id: 's4', fromMachine: 'sender-host', payload: 'hello' });
    node.send({ op: 'result', id: 's4', status: 'delivered', turn: '1/3' });
    const receipt = await sender.waitFor((f) => f.op === 'receipt');
    expect(receipt).toMatchObject({ op: 'receipt', id: 's4', status: 'delivered', turn: '1/3' });
  });

  it('routes a send targeting the broker machine to deliverLocal (NOT_READY in B1)', async () => {
    const { url, registryFile } = await startBroker();
    const sender = await senderOn(url, registryFile);
    seed(registryFile, [{ key: key('b'), machineId: 'BROKER-MID', machineName: 'self-host' }]);
    sender.send({ op: 'send', id: 's5', targetMachine: 'self-host', body: 'hi' });
    const err = await sender.waitFor((f) => f.op === 'error');
    expect(err.op === 'error' && err.code).toBe('NOT_READY');
  });

  it('resolves an in-flight route as PEER_OFFLINE when the target connection drops', async () => {
    const { url, registryFile } = await startBroker({ resultTimeoutMs: 5_000 });
    const sender = await senderOn(url, registryFile);
    seed(registryFile, [{ key: key('n'), machineId: 'm-node2', machineName: 'node2-host' }]);
    const node = await handshake(url, key('n'), 'm-node2');
    await node.waitFor((f) => f.op === 'connected');
    sender.send({ op: 'send', id: 's6', targetMachine: 'node2-host', body: 'hi' });
    await node.waitFor((f) => f.op === 'deliver');
    node.ws.close();
    const err = await sender.waitFor((f) => f.op === 'error');
    expect(err.op === 'error' && err.code).toBe('PEER_OFFLINE');
  });
});

describe('broker heartbeat and lifecycle', () => {
  it('terminates a session that never pongs', async () => {
    const { url, registryFile } = await startBroker({
      heartbeatMs: 20,
      pongTimeoutMs: 60,
      ping: () => {}, // 不发真 ping → 永远没有 pong
    });
    seed(registryFile, [{ key: key('a'), machineId: 'm-1', machineName: 'box' }]);
    const client = await handshake(url, key('a'), 'm-1');
    await client.waitFor((f) => f.op === 'connected');
    expect(await client.closed(2_000)).toBeDefined();
  });

  it('writes stopped state on graceful stop', async () => {
    const { broker, statusFile } = await startBroker();
    await broker.stop();
    const status = JSON.parse(readFileSync(statusFile, 'utf8')) as { state: string; onlineNodes: string[] };
    expect(status.state).toBe('stopped');
    expect(status.onlineNodes).toEqual([]);
  });

  it('017: onlineNodes includes the broker itself with （本机） marker（注册表有本机条目才算，名字取注册表）', async () => {
    const { url, registryFile, statusFile } = await startBroker({ machineId: () => 'a1b2c3d40000' });
    seed(registryFile, [
      { label: 'self', key: key('s'), machineId: 'a1b2c3d40000', machineName: 'cloud' },
      { key: key('a'), machineId: 'aaaa00001111', machineName: 'alpha' },
    ]);
    const node = await handshake(url, key('a'), 'aaaa00001111');
    await node.waitFor((f) => f.op === 'connected');
    const status = JSON.parse(readFileSync(statusFile, 'utf8')) as { onlineNodes: string[] };
    // broker 自身恒在线且居首；改 showName 重启 serve 后本机 status 即见新名（不再自排除）
    expect(status.onlineNodes).toEqual(['cloud（本机）', 'alpha']);
  });

  it('refreshes lastUpdated on every heartbeat cycle', async () => {
    const { broker, statusFile } = await startBroker({ heartbeatMs: 15, ping: () => {} });
    const read = () =>
      (JSON.parse(readFileSync(statusFile, 'utf8')) as { lastUpdated: string }).lastUpdated;
    await delay(50);
    const first = read();
    await delay(50);
    expect(read()).not.toBe(first);
    await broker.stop();
  });
});
