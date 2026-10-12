import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
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
import { decodeRef } from '../src/ref.js';

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
  const port = Number(new URL(harness.url).port);
  const configFile = join(dir, 'node.json');
  writeFileSync(configFile, JSON.stringify({ broker: { host: '127.0.0.1', port, alias: 'broker-alias' }, key: key('n') }, null, 2));
  return new NodeClient({
    config: { entries: [{ host: '127.0.0.1', port, alias: 'broker-alias', key: key('n') }] },
    configFile,
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
      // B1 零回归锚点：无星连接（注册表无 starId）签发的 ref 不带 starId
      expect(decodeRef(receipt.replyRef ?? '').starId).toBeUndefined();
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
      config: { entries: [{ host: '127.0.0.1', port, alias: 'broker-alias', key: key('n') }] },
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

  // B0：node.json 双形状归一化
  it('normalizes the legacy shape into a single entry (top-level starId ignored)', () => {
    const dir = mkdtempSync(join(root, 'case-'));
    const file = join(dir, 'node.json');
    writeFileSync(file, JSON.stringify({ broker: { host: 'h1', port: 1, alias: 'a', starId: 'in-broker' }, key: 'k', name: 'n', starId: 'top-level' }));
    expect(readNodeConfig(file)).toEqual({
      name: 'n',
      entries: [{ host: 'h1', port: 1, alias: 'a', starId: 'in-broker', key: 'k' }],
    });
  });

  it('normalizes the brokers-array shape as-is with name carried', () => {
    const dir = mkdtempSync(join(root, 'case-'));
    const file = join(dir, 'node.json');
    writeFileSync(file, JSON.stringify({ brokers: [{ host: 'h1', port: 1, key: 'k1' }, { host: 'h2', port: 2, alias: 'b', starId: 's2', key: 'k2' }], name: 'm' }));
    expect(readNodeConfig(file)).toEqual({
      name: 'm',
      entries: [{ host: 'h1', port: 1, key: 'k1' }, { host: 'h2', port: 2, alias: 'b', starId: 's2', key: 'k2' }],
    });
  });

  it('rejects an empty brokers array and entries missing key/host/integer port', () => {
    const dir = mkdtempSync(join(root, 'case-'));
    const tryRead = (content: string): unknown => {
      const file = join(dir, 'node.json');
      writeFileSync(file, content);
      try {
        readNodeConfig(file);
        return undefined;
      } catch (e: unknown) {
        return e;
      }
    };
    for (const bad of ['{"brokers": []}', '{"brokers": [{"host": "h", "port": 1}]}', '{"brokers": [{"port": 1, "key": "k"}]}', '{"brokers": [{"host": "h", "key": "k", "port": 1.5}]}']) {
      const err = tryRead(bad);
      expect(err).toBeInstanceOf(MultichatError);
      expect((err as MultichatError).message).toContain('损坏');
    }
  });
});

describe('B0 starId handshake', () => {
  const STAR = 'aaaabbbbcccc';

  function seedWithStar(harness: Harness): void {
    writeRegistry(harness.registryFile, {
      starId: STAR,
      nodes: [{ label: 'node-1', key: key('n'), addedAt: '2026-01-01T00:00:00.000Z' }],
    });
  }

  function starClient(harness: Harness, dir: string, entry: { starId?: string }, log: (l: string) => void): NodeClient {
    const inbox = mkdtempSync(join(root, 'node-'));
    return new NodeClient({
      config: { entries: [{ host: '127.0.0.1', port: Number(new URL(harness.url).port), key: key('n'), ...entry }] },
      configFile: join(dir, 'node.json'),
      machineId: () => 'NODE-MID',
      statusFile: join(dir, 'status-node.json'),
      fileInbox: new FileInbox({ inboxDir: join(inbox, 'inbox'), partsDir: join(inbox, 'parts') }),
      makeSendDeps: () => fakeSendDeps().deps,
      now: () => Date.now(),
      log,
      backoffBaseMs: 50,
    });
  }

  it('STAR_ID_MISMATCH aborts before connect and permanently stops (B2: no retry)', async () => {
    const harness = await startBroker();
    seedWithStar(harness);
    const dir = mkdtempSync(join(root, 'st-'));
    const logs: string[] = [];
    const client = starClient(harness, dir, { starId: 'dddd00001111' }, (l) => logs.push(l));
    // B2：星标识不符是配置错——客户端不再退避重试，run() 自行结束
    const done = client.run().then(() => 'done');
    expect(await done).toBe('done');
    expect(logs.some((l) => l.includes('STAR_ID_MISMATCH') && l.includes('向管理员重新索取 node.json'))).toBe(true);
    expect(logs.some((l) => l.includes('星标识不符已停机') && l.includes('重启 crosschat serve --connect'))).toBe(true);
    expect(logs.some((l) => l.includes('reconnect-wait'))).toBe(false); // 停机不重试
    // 钥匙本是匹配的——若 connect 已发，客户端会上线且 broker 记 node-up
    expect(logs.some((l) => l.includes('online（'))).toBe(false);
    expect(harness.logs.some((l) => l.includes('node-up'))).toBe(false);
  }, 10_000);

  it('goes online when both sides carry the same starId', async () => {
    const harness = await startBroker();
    seedWithStar(harness);
    const dir = mkdtempSync(join(root, 'st-'));
    const client = starClient(harness, dir, { starId: STAR }, () => {});
    void client.run();
    await client.waitForState('online');
    await client.stop();
  }, 10_000);

  it('backfills starId into the legacy node.json broker object when locally missing', async () => {
    const harness = await startBroker();
    seedWithStar(harness);
    const dir = mkdtempSync(join(root, 'st-'));
    const configFile = join(dir, 'node.json');
    writeFileSync(configFile, JSON.stringify({ broker: { host: '127.0.0.1', port: Number(new URL(harness.url).port), alias: 'broker-alias' }, key: key('n'), name: 'node-host' }, null, 2));
    const client = starClient(harness, dir, {}, () => {});
    void client.run();
    await client.waitForState('online');
    const backfilled = JSON.parse(readFileSync(configFile, 'utf8')) as { broker: { host: string; port: number; alias: string; starId?: string }; key: string; name: string };
    expect(backfilled.broker.starId).toBe(STAR);
    expect(backfilled.key).toBe(key('n'));
    expect(backfilled.name).toBe('node-host');
    await client.stop();
  }, 10_000);

  it('backfills starId into a matching brokers[] entry (new shape)', async () => {
    const harness = await startBroker();
    seedWithStar(harness);
    const dir = mkdtempSync(join(root, 'st-'));
    const configFile = join(dir, 'node.json');
    const port = Number(new URL(harness.url).port);
    writeFileSync(configFile, JSON.stringify({ brokers: [{ host: '127.0.0.1', port, key: key('n') }, { host: 'other', port: 9, key: 'other-key' }], name: 'node-host' }, null, 2));
    const client = starClient(harness, dir, {}, () => {});
    void client.run();
    await client.waitForState('online');
    const backfilled = JSON.parse(readFileSync(configFile, 'utf8')) as { brokers: Array<{ host: string; port: number; key: string; starId?: string }> };
    expect(backfilled.brokers[0]?.starId).toBe(STAR);
    expect(backfilled.brokers[1]?.starId).toBeUndefined();
    await client.stop();
  }, 10_000);

  it('does not rewrite node.json when starId already present and matching', async () => {
    const harness = await startBroker();
    seedWithStar(harness);
    const dir = mkdtempSync(join(root, 'st-'));
    const configFile = join(dir, 'node.json');
    const original = `${JSON.stringify({ broker: { host: '127.0.0.1', port: Number(new URL(harness.url).port), alias: 'broker-alias', starId: STAR }, key: key('n'), name: 'node-host' }, null, 2)}\n`;
    writeFileSync(configFile, original);
    const client = starClient(harness, dir, { starId: STAR }, () => {});
    void client.run();
    await client.waitForState('online');
    expect(readFileSync(configFile, 'utf8')).toBe(original);
    await client.stop();
  }, 10_000);

  it('passes when the local entry has starId but the broker info omits it', async () => {
    const harness = await startBroker();
    seed(harness.registryFile, [{ key: key('n'), machineName: 'node-host' }]); // 注册表无 starId → info 不带
    const dir = mkdtempSync(join(root, 'st-'));
    const client = starClient(harness, dir, { starId: STAR }, () => {});
    void client.run();
    await client.waitForState('online');
    await client.stop();
  }, 10_000);
});

describe('B1 multi-star: delivery pipeline stamps starId into issued refs', () => {
  const STAR = 'aaaabbbbcccc';

  it('node daemon deliver: the receipt ref carries the connected entry starId', async () => {
    const harness = await startBroker();
    writeRegistry(harness.registryFile, {
      starId: STAR,
      nodes: [{ label: 'node-1', key: key('n'), machineId: 'NODE-MID', machineName: 'node-host', addedAt: '2026-01-01T00:00:00.000Z' }],
    });
    const dir = mkdtempSync(join(root, 'b1-'));
    const inbox = mkdtempSync(join(root, 'node-'));
    const client = new NodeClient({
      config: { entries: [{ host: '127.0.0.1', port: Number(new URL(harness.url).port), key: key('n'), starId: STAR }] },
      configFile: join(dir, 'node.json'),
      machineId: () => 'NODE-MID',
      statusFile: join(dir, 'status-node.json'),
      fileInbox: new FileInbox({ inboxDir: join(inbox, 'inbox'), partsDir: join(inbox, 'parts') }),
      makeSendDeps: () => fakeSendDeps(true).deps,
      now: () => Date.now(),
      log: () => {},
      backoffBaseMs: 50,
    });
    void client.run();
    await client.waitForState('online');
    const sender = await senderOn(harness.url, key('n'));
    sender.send({ op: 'send', id: 'b1', targetMachine: 'node-host', to: 'boss', body: 'star hello' });
    const receipt = await sender.waitFor((f) => f.op === 'receipt' && f.id === 'b1');
    if (receipt.op !== 'receipt') throw new Error('expected receipt');
    expect(decodeRef(receipt.replyRef ?? '').starId).toBe(STAR);
    await client.stop();
  }, 10_000);

  it('broker self-delivery: the receipt ref carries the registry starId', async () => {
    const dir = mkdtempSync(join(root, 'b1self-'));
    const registryFile = registryFileOf(dir);
    // 预留一个空闲端口写进注册表（runServe 裸跑读注册表端口）
    const reserve = createServer();
    await new Promise<void>((resolve) => reserve.listen(0, '127.0.0.1', () => resolve()));
    const port = (reserve.address() as { port: number }).port;
    await new Promise<void>((resolve) => reserve.close(() => resolve()));
    writeRegistry(registryFile, {
      starId: STAR,
      port,
      nodes: [{ label: 'self', key: key('s'), machineId: 'BROKER-MID', machineName: 'broker-host', addedAt: '2026-01-01T00:00:00.000Z' }],
    });
    let stop: (() => void) | undefined;
    const deps: ServeDeps = {
      baseDir: dir,
      stdout: () => {},
      env: {},
      version: 'test',
      machineId: () => 'BROKER-MID',
      hostname: () => 'broker-host',
      networkInterfaces: () => ({}),
      now: () => Date.now(),
      onSignal: (_sig, cb) => {
        stop = cb;
      },
      makeSendDeps: () => fakeSendDeps(true).deps,
    };
    const servePromise = runServe({}, deps);
    // broker 起监听前 sender 可能被拒——小步重试握手
    let sender: TestClient | undefined;
    for (let i = 0; i < 50 && sender === undefined; i++) {
      try {
        sender = await senderOn(`ws://127.0.0.1:${port}`, key('s'));
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    expect(sender).toBeDefined();
    sender!.send({ op: 'send', id: 's1', targetMachine: 'broker-host', to: 'boss', body: 'self hello' });
    const receipt = await sender!.waitFor((f) => f.op === 'receipt' && f.id === 's1');
    if (receipt.op !== 'receipt') throw new Error('expected receipt');
    expect(decodeRef(receipt.replyRef ?? '').starId).toBe(STAR);
    expect(stop).toBeDefined();
    stop!();
    expect(await servePromise).toBe(0);
  }, 15_000);
});

describe('B2 --connect 选择器与独立 status/log 文件', () => {
  function nodeDeps(dir: string): { deps: ServeDeps; stop(): void } {
    let stop: () => void = () => {};
    const deps: ServeDeps = {
      baseDir: dir,
      stdout: () => {},
      env: {},
      version: 'test',
      machineId: () => 'NODE-MID',
      hostname: () => 'node-host',
      networkInterfaces: () => ({}),
      now: () => Date.now(),
      onSignal: (_sig, cb) => {
        stop = cb;
      },
    };
    return { deps, stop: () => stop() };
  }

  async function waitStatusOnline(file: string): Promise<void> {
    for (let i = 0; i < 100; i++) {
      try {
        const st = JSON.parse(readFileSync(file, 'utf8')) as { state: string };
        if (st.state === 'online') return;
      } catch {
        // 文件未出现/未上线——继续轮询
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`status file never went online: ${file}`);
  }

  it('named selector daemon connects only that entry and writes status-node-<选择器>.json', async () => {
    const harness = await startBroker();
    seed(harness.registryFile, [{ key: key('n'), machineName: 'node-host' }]);
    const port = Number(new URL(harness.url).port);
    const dir = mkdtempSync(join(root, 'named-'));
    mkdirSync(join(dir, 'tcp'), { recursive: true });
    writeFileSync(
      join(dir, 'tcp', 'node.json'),
      JSON.stringify({
        brokers: [
          { host: '127.0.0.1', port, alias: 'br1', key: key('n') },
          { host: '10.255.255.1', port: 9, alias: 'br2', key: 'other-key' }, // 不可达——守护只连选中条目则永不碰它
        ],
        name: 'node-host',
      }),
    );
    const { deps, stop } = nodeDeps(dir);
    const servePromise = runServe({ connect: 'br1' }, deps);
    await waitStatusOnline(join(dir, 'tcp', 'status-node-br1.json'));
    expect(existsSync(join(dir, 'tcp', 'status-node.json'))).toBe(false);
    stop();
    expect(await servePromise).toBe(0);
  }, 15_000);

  it('default daemon (no selector) keeps writing status-node.json unchanged', async () => {
    const harness = await startBroker();
    seed(harness.registryFile, [{ key: key('n'), machineName: 'node-host' }]);
    const port = Number(new URL(harness.url).port);
    const dir = mkdtempSync(join(root, 'default-'));
    mkdirSync(join(dir, 'tcp'), { recursive: true });
    writeFileSync(join(dir, 'tcp', 'node.json'), JSON.stringify({ broker: { host: '127.0.0.1', port, alias: 'br1' }, key: key('n') }));
    const { deps, stop } = nodeDeps(dir);
    const servePromise = runServe({ connect: '' }, deps);
    await waitStatusOnline(join(dir, 'tcp', 'status-node.json'));
    expect(existsSync(join(dir, 'tcp', 'status-node-br1.json'))).toBe(false);
    stop();
    expect(await servePromise).toBe(0);
  }, 15_000);
});
