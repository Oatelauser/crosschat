/**
 * 022 多星 WS 复用（方向 2A 完全体 + 自挂 in-process）：
 * - 一进程一端口托管多星：info 无星标识/caps multi-star、connected 回填星籍、
 *   钥匙反查星域、星间册与注册表隔离、同机入两星双连接不互撞
 * - NodeClient 多星延迟核星（connected 帧）与单星 info 预检字节回归
 * - 本进程自挂：虚拟会话对（admitLocal + makeSocket）走真实握手/成员/投递路径
 * - 注册表双形状读写、--add-star 迁移、--star 星域管理教学、013 延伸防护
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection, type Socket } from 'node:net';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import WebSocket, { type RawData } from 'ws';
import { Broker, rosterFileForStar, rosterFileOf } from '../src/serve/broker.js';
import {
  readMultiRegistry,
  registryFileOf,
  writeMultiRegistry,
  writeRegistry,
  type NodeEntry,
  type StarReg,
} from '../src/serve/registry.js';
import { encodeFrame, parseFrame, CAP_MULTI_STAR, CAP_SESSION_MEMBERS, type Frame, type InfoFrame, type ConnectedFrame } from '../src/serve/protocol.js';
import { NodeClient, attachPipePath, type BrokerEntry } from '../src/serve/node.js';
import { VirtualSocket } from '../src/serve/virtual-socket.js';
import { FileInbox } from '../src/serve/file-channel.js';
import { runServe, type ServeDeps } from '../src/commands/serve.js';
import { MultichatError } from '../src/errors.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-multistar-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const slowHeartbeat = { heartbeatMs: 10_000, pongTimeoutMs: 20_000, connectTimeoutMs: 5_000 };
const key = (c: string) => c.repeat(64);
const STAR_A = 'aaaabbbbcccc';
const STAR_B = 'bbbbaaaacccc';

const brokers: Broker[] = [];
const clients: { close(): void }[] = [];
const nodeClients: NodeClient[] = [];
afterEach(async () => {
  for (const c of clients) c.close();
  clients.length = 0;
  for (const c of nodeClients) await c.stop().catch(() => {});
  nodeClients.length = 0;
  for (const b of brokers) await b.stop();
  brokers.length = 0;
});

function entry(partial: Partial<NodeEntry>): NodeEntry {
  return { label: partial.label ?? 'node-1', key: partial.key ?? key('1'), addedAt: '2026-01-01T00:00:00.000Z', ...partial };
}

async function startMultiBroker(): Promise<{
  broker: Broker;
  url: string;
  registryFile: string;
  logs: string[];
}> {
  const dir = mkdtempSync(join(root, 'case-'));
  const registryFile = registryFileOf(dir);
  const stars: StarReg[] = [
    {
      starId: STAR_A,
      name: 'alpha',
      nodes: [
        entry({ label: 'a1', key: key('a'), machineId: 'aaaa1111aaaa', machineName: 'a-host' }),
        entry({ label: 'a-self', key: key('as'), machineId: 'bbbb1111aaaa', machineName: 'broker-host' }),
      ],
    },
    {
      starId: STAR_B,
      name: 'beta',
      nodes: [
        entry({ label: 'b1', key: key('b'), machineId: 'bbbb2222bbbb', machineName: 'b-host' }),
        entry({ label: 'b2', key: key('b2') }), // 未绑机器——同机入两星用
      ],
    },
  ];
  writeMultiRegistry(registryFile, { stars, multi: true });
  const logs: string[] = [];
  const broker = new Broker({
    registryFile,
    statusFile: join(dir, 'status-broker.json'),
    version: 'test',
    machineId: () => 'bbbb1111aaaa',
    hostname: () => 'broker-host',
    now: () => Date.now(),
    log: (line) => logs.push(line),
    deliverLocal: async () => ({ op: 'error', code: 'NOT_READY', message: 'not wired' }),
    port: 0,
    ...slowHeartbeat,
  });
  brokers.push(broker);
  const port = await broker.start();
  return { broker, url: `ws://127.0.0.1:${port}`, registryFile, logs };
}

class TestClient {
  readonly ws: WebSocket;
  private readonly frames: Frame[] = [];
  private readonly waiters: { pred: (f: Frame) => boolean; resolve: (f: Frame) => void; timer: ReturnType<typeof setTimeout> }[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    clients.push({ close: () => this.ws.close() });
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

  send(frame: Frame): void {
    this.ws.send(encodeFrame(frame));
  }

  waitFor(pred: (f: Frame) => boolean, timeoutMs = 5_000): Promise<Frame> {
    const seen = this.frames.find(pred);
    if (seen !== undefined) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const waiter = {
        pred,
        resolve,
        timer: setTimeout(() => {
          const i = this.waiters.indexOf(waiter);
          if (i >= 0) this.waiters.splice(i, 1);
          reject(new Error('frame timeout'));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }
}

/** 角色连接捷径：握手到 connected，返回 connected 帧（多星含星籍）。 */
async function handshake(url: string, auth: string, machineId?: string, name?: string): Promise<ConnectedFrame> {
  const c = new TestClient(url);
  await c.opened();
  const info = (await c.waitFor((f) => f.op === 'info')) as InfoFrame;
  expect(info.proto).toBe(1);
  c.send({
    op: 'connect',
    proto: 1,
    role: 'node',
    ...(machineId === undefined ? {} : { machineId }),
    auth,
    ...(name === undefined ? {} : { name }),
  });
  const verdict = await c.waitFor((f) => f.op === 'connected' || f.op === 'error');
  expect(verdict.op).toBe('connected');
  return verdict as ConnectedFrame;
}

describe('022 多星握手与星域隔离', () => {
  it('多星 info 不带星标识、caps 含 multi-star；connected 回填属星星籍', async () => {
    const { url } = await startMultiBroker();
    const a = new TestClient(url);
    await a.opened();
    const info = (await a.waitFor((f) => f.op === 'info')) as InfoFrame;
    expect(info.starId).toBeUndefined();
    expect(info.name).toBeUndefined();
    expect(info.caps).toContain(CAP_MULTI_STAR);
    expect(info.caps).toContain(CAP_SESSION_MEMBERS);
    a.send({ op: 'connect', proto: 1, role: 'node', machineId: 'aaaa1111aaaa', auth: key('a'), name: 'a-host' });
    const conn = (await a.waitFor((f) => f.op === 'connected')) as ConnectedFrame;
    expect(conn.starId).toBe(STAR_A);
    expect(conn.name).toBe('alpha');

    const b = new TestClient(url);
    await b.opened();
    await b.waitFor((f) => f.op === 'info');
    b.send({ op: 'connect', proto: 1, role: 'node', machineId: 'bbbb2222bbbb', auth: key('b'), name: 'b-host' });
    const connB = (await b.waitFor((f) => f.op === 'connected')) as ConnectedFrame;
    expect(connB.starId).toBe(STAR_B);
    expect(connB.name).toBe('beta');
  }, 10_000);

  it('钥匙不属任何星 → BAD_AUTH（跨星错钥匙不放行）', async () => {
    const { url } = await startMultiBroker();
    const c = new TestClient(url);
    await c.opened();
    await c.waitFor((f) => f.op === 'info');
    c.send({ op: 'connect', proto: 1, role: 'node', machineId: 'cccc3333cccc', auth: key('z') });
    const err = await c.waitFor((f) => f.op === 'error');
    expect((err as { code: string }).code).toBe('BAD_AUTH');
  }, 10_000);

  it('单星旧形状字节回归：info 带星标识、connected 无星籍字段', async () => {
    const dir = mkdtempSync(join(root, 'sole-'));
    const registryFile = registryFileOf(dir);
    writeRegistry(registryFile, { starId: STAR_A, name: 'alpha', nodes: [entry({ key: key('a'), machineId: 'aaaa1111aaaa' })] });
    const broker = new Broker({
      registryFile,
      statusFile: join(dir, 'status-broker.json'),
      version: 'test',
      machineId: () => 'bbbb1111aaaa',
      hostname: () => 'h',
      now: () => Date.now(),
      log: () => {},
      deliverLocal: async () => ({ op: 'error', code: 'NOT_READY', message: '' }),
      port: 0,
      ...slowHeartbeat,
    });
    brokers.push(broker);
    const port = await broker.start();
    const c = new TestClient(`ws://127.0.0.1:${port}`);
    await c.opened();
    const info = (await c.waitFor((f) => f.op === 'info')) as InfoFrame;
    expect(info.starId).toBe(STAR_A);
    expect(info.name).toBe('alpha');
    expect(info.caps).toEqual([CAP_SESSION_MEMBERS]); // 不含 multi-star
    c.send({ op: 'connect', proto: 1, role: 'node', machineId: 'aaaa1111aaaa', auth: key('a') });
    const conn = (await c.waitFor((f) => f.op === 'connected')) as ConnectedFrame;
    expect(conn.starId).toBeUndefined();
    expect(conn.name).toBeUndefined();
  }, 10_000);

  it('星域隔离：A 星连接的 roster 只见 A 星机器；投 B 星机器名报 UNKNOWN_MACHINE', async () => {
    const { url } = await startMultiBroker();
    const a = new TestClient(url);
    await a.opened();
    await a.waitFor((f) => f.op === 'info');
    a.send({ op: 'connect', proto: 1, role: 'node', machineId: 'aaaa1111aaaa', auth: key('a'), name: 'a-host' });
    await a.waitFor((f) => f.op === 'connected');
    a.send({ op: 'roster' });
    const roster = await a.waitFor((f) => f.op === 'roster-result');
    const machines = (roster as { machines: Array<{ name?: string }> }).machines;
    expect(machines.map((m) => m.name)).toContain('a-host');
    expect(machines.map((m) => m.name)).not.toContain('b-host');
    // B 星机器名对 A 星连接不可见
    a.send({ op: 'send', id: 'x1', targetMachine: 'b-host', body: 'cross-star?' });
    const err = await a.waitFor((f) => f.op === 'error' && (f as { id?: string }).id === 'x1');
    expect((err as { code: string }).code).toBe('UNKNOWN_MACHINE');
  }, 10_000);

  it('同机入两星：同 machineId 双连接分属两星，互不顶换', async () => {
    const { url, logs } = await startMultiBroker();
    await handshake(url, key('a'), 'aaaa1111aaaa', 'a-host');
    await handshake(url, key('b2'), 'aaaa1111aaaa', 'a-host'); // beta 未绑钥匙，同机可入
    expect(logs.some((l) => l.includes('replace'))).toBe(false);
    expect(logs.filter((l) => l.includes('node-up')).length).toBe(2);
  }, 10_000);

  it('每星独立册：sessions 声明各落各的 roster.<星名>.json', async () => {
    const { url, registryFile } = await startMultiBroker();
    const a = new TestClient(url);
    await a.opened();
    await a.waitFor((f) => f.op === 'info');
    a.send({ op: 'connect', proto: 1, role: 'node', machineId: 'aaaa1111aaaa', auth: key('a'), name: 'a-host', caps: [CAP_SESSION_MEMBERS] });
    await a.waitFor((f) => f.op === 'connected');
    a.send({ op: 'sessions', sessions: [{ sessionId: 'sess-a1', name: 'worker-a', tool: 'claude' }] });
    await new Promise((r) => setTimeout(r, 200));
    const rosterA = JSON.parse(readFileSync(rosterFileForStar(registryFile, { starId: STAR_A, name: 'alpha' }, true), 'utf8')) as { entries: Array<{ sessionId: string }> };
    expect(rosterA.entries.map((e) => e.sessionId)).toEqual(['sess-a1']);
    expect(existsSync(rosterFileForStar(registryFile, { starId: STAR_B, name: 'beta' }, true))).toBe(false);
    // 单星旧形状仍写 roster.json（零回归路径）
    expect(rosterFileForStar(registryFile, {}, false)).toBe(rosterFileOf(registryFile));
  }, 10_000);
});

describe('022 NodeClient 多星延迟核星', () => {
  function fakeSendDeps(): { delivered: string[]; deps: Parameters<NonNullable<ConstructorParameters<typeof NodeClient>[0]['makeSendDeps']>>[0] } {
    const delivered: string[] = [];
    return {
      delivered,
      deps: {
        env: {},
        listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
        listCodexThreads: async () => [],
        deliverClaude: async (_t, content) => {
          delivered.push(content);
          return { status: 'delivered' };
        },
        deliverCodex: async () => ({ status: 'accepted', turnId: 't' }),
        sendLogFile: join(mkdtempSync(join(root, 'log-')), 'send-log.jsonl'),
        outboxDir: mkdtempSync(join(root, 'outbox-')),
        now: () => Date.now(),
        hostname: () => 'broker-host',
        machineId: () => 'bbbb1111aaaa',
      },
    };
  }

  function aggregatorClient(url: string, dir: string, entryCfg: BrokerEntry, log: (l: string) => void, extra: Partial<ConstructorParameters<typeof NodeClient>[0]> = {}): NodeClient {
    const inbox = mkdtempSync(join(root, 'inbox-'));
    const client = new NodeClient({
      config: { entries: [entryCfg] },
      configFile: join(dir, 'node.json'),
      machineId: () => 'bbbb1111aaaa',
      statusFile: join(dir, 'status-node.json'),
      fileInbox: new FileInbox({ inboxDir: join(inbox, 'inbox'), partsDir: join(inbox, 'parts') }),
      makeSendDeps: () => fakeSendDeps().deps,
      now: () => Date.now(),
      log,
      backoffBaseMs: 50,
      memberCheckMs: 60_000,
      ...extra,
    });
    nodeClients.push(client);
    return client;
  }

  it('条目 starId 与钥匙实属星不符 → connected 后 STAR_ID_MISMATCH 永久停机', async () => {
    const { url } = await startMultiBroker();
    const dir = mkdtempSync(join(root, 'st-'));
    const logs: string[] = [];
    // key('as')=alpha 的 self 条目（绑 broker 机 mid，与 aggregatorClient 的 machineId 一致）
    const client = aggregatorClient(url, dir, { host: '127.0.0.1', port: Number(new URL(url).port), starId: 'dddd00001111', key: key('as'), name: 'alpha' }, (l) => logs.push(l));
    const done = client.run().then(() => 'done');
    expect(await done).toBe('done');
    expect(logs.some((l) => l.includes('STAR_ID_MISMATCH'))).toBe(true);
    expect(logs.some((l) => l.includes('online（'))).toBe(false);
  }, 10_000);

  it('条目缺 starId → connected 帧回填 node.json 并同步星名', async () => {
    const { url } = await startMultiBroker();
    const dir = mkdtempSync(join(root, 'bf-'));
    const cfg: BrokerEntry = { host: '127.0.0.1', port: Number(new URL(url).port), key: key('as'), name: '旧名' };
    writeFileSync(join(dir, 'node.json'), JSON.stringify({ brokers: [{ ...cfg }], showName: 'broker-host' }, null, 2));
    const logs: string[] = [];
    const client = aggregatorClient(url, dir, cfg, (l) => logs.push(l));
    void client.run();
    await client.waitForState('online');
    const parsed = JSON.parse(readFileSync(join(dir, 'node.json'), 'utf8')) as { brokers: Array<{ starId?: string; name?: string }> };
    expect(parsed.brokers[0]!.starId).toBe(STAR_A); // connected 帧回填
    expect(parsed.brokers[0]!.name).toBe('alpha'); // 星名 broker 权威覆盖
  }, 10_000);
});

describe('022 本进程自挂（虚拟会话对）', () => {
  it('admitLocal+makeSocket：真实握手上线、attach 入成员、三段直达投递不经回环 WS', async () => {
    const dir = mkdtempSync(join(root, 'local-'));
    const registryFile = registryFileOf(dir);
    writeMultiRegistry(registryFile, {
      stars: [{ starId: STAR_A, name: 'alpha', nodes: [
        entry({ label: 'self', key: key('as'), machineId: 'bbbb1111aaaa', machineName: 'broker-host' }),
        entry({ label: 'snd', key: key('x') }),
      ] }],
      multi: true,
    });
    const logs: string[] = [];
    const delivered: string[] = [];
    const broker = new Broker({
      registryFile,
      statusFile: join(dir, 'status-broker.json'),
      version: 'test',
      machineId: () => 'bbbb1111aaaa',
      hostname: () => 'broker-host',
      now: () => Date.now(),
      log: (line) => logs.push(line),
      deliverLocal: async () => ({ op: 'error', code: 'NOT_READY', message: 'not wired' }),
      port: 0,
      ...slowHeartbeat,
    });
    brokers.push(broker);
    const port = await broker.start();
    const url = `ws://127.0.0.1:${port}`;
    const selfEntry: BrokerEntry = { host: '127.0.0.1', port, name: 'alpha', starId: STAR_A, key: key('as') };
    writeFileSync(join(dir, 'node.json'), JSON.stringify({ brokers: [selfEntry], showName: 'broker-host' }, null, 2));
    const inbox = mkdtempSync(join(root, 'inbox-'));
    const client = new NodeClient({
      config: { entries: [selfEntry] },
      configFile: join(dir, 'node.json'),
      machineId: () => 'bbbb1111aaaa',
      statusFile: join(dir, 'status-node.json'),
      fileInbox: new FileInbox({ inboxDir: join(inbox, 'inbox'), partsDir: join(inbox, 'parts') }),
      makeSendDeps: () => ({
        env: {},
        listClaudeSessions: () => ({ sessions: [{ pid: 1, sessionId: 'sess-boss', kind: 'interactive', name: 'boss', status: 'idle', messagingSocketPath: 'x' }], malformed: 0 }),
        listCodexThreads: async () => [],
        deliverClaude: async (_t, content) => {
          delivered.push(content);
          return { status: 'delivered' };
        },
        deliverCodex: async () => ({ status: 'accepted', turnId: 't' }),
        sendLogFile: join(mkdtempSync(join(root, 'log-')), 'send-log.jsonl'),
        outboxDir: mkdtempSync(join(root, 'outbox-')),
        now: () => Date.now(),
        hostname: () => 'broker-host',
        machineId: () => 'bbbb1111aaaa',
      }),
      now: () => Date.now(),
      log: (l) => logs.push(l),
      memberCheckMs: 60_000,
      attachLabel: 'ms-local',
      makeSocket: () => {
        const [a, b] = VirtualSocket.pair();
        broker.admitLocal(b, STAR_A);
        return a;
      },
    });
    nodeClients.push(client);
    void client.run();
    await client.waitForState('online');
    expect(logs.some((l) => l.includes('online（broker'))).toBe(true);

    // attach 管道在 broker 进程内常驻：成员入册
    const attach = await attachTalk(attachPipePath(selfEntry, dir, 'ms-local'));
    const reply = await attach.send({ op: 'attach', sessionId: 'sess-boss', name: 'boss', tool: 'claude' });
    expect(reply).toEqual({ ok: true });

    // 三段寻址到 broker 机会话：虚拟会话承接 deliver（无回环 WS）
    const sender = new TestClient(url);
    await sender.opened();
    await sender.waitFor((f) => f.op === 'info');
    sender.send({ op: 'connect', proto: 1, role: 'sender', auth: key('x') });
    await sender.waitFor((f) => f.op === 'connected');
    sender.send({ op: 'send', id: 'n1', targetMachine: 'broker-host:boss', body: 'hello local' });
    const receipt = await sender.waitFor((f) => f.op === 'receipt' && (f as { id?: string }).id === 'n1');
    expect((receipt as { status: string }).status).toBe('delivered');
    expect(delivered[0]).toContain('hello local');
  }, 15_000);
});

/** attach 管道客户端（serve-sessions 同款：换行 JSON 一问一答）。 */
function attachTalk(pipePath: string): Promise<{ send(r: unknown): Promise<{ ok: boolean; error?: string }> }> {
  return new Promise((resolve, reject) => {
    const socket: Socket = createConnection({ path: pipePath });
    socket.once('error', reject);
    socket.once('connect', () => {
      const waiters: ((r: { ok: boolean; error?: string }) => void)[] = [];
      let buf = '';
      socket.on('data', (c) => {
        buf += c.toString('utf8');
        for (;;) {
          const i = buf.indexOf('\n');
          if (i < 0) break;
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (line.trim() === '') continue;
          const w = waiters.shift();
          if (w !== undefined) w(JSON.parse(line) as { ok: boolean; error?: string });
        }
      });
      clients.push({ close: () => socket.destroy() });
      resolve({
        send: (req: unknown) =>
          new Promise((res) => {
            waiters.push(res);
            socket.write(`${JSON.stringify(req)}\n`);
          }),
      });
    });
  });
}

describe('022 注册表双形状与 CLI', () => {
  function cliDeps(extra: Partial<ServeDeps> = {}): { deps: ServeDeps; lines: string[]; dir: string; registryFile: string } {
    const dir = mkdtempSync(join(root, 'cli-'));
    const lines: string[] = [];
    const deps: ServeDeps = {
      baseDir: dir,
      stdout: (line) => lines.push(line),
      env: {},
      version: 'test',
      machineId: () => 'MID-TEST',
      hostname: () => 'h',
      networkInterfaces: () => ({}),
      now: () => Date.now(),
      onSignal: () => {},
      listServeProcesses: () => [],
      ...extra,
    };
    return { deps, lines, dir, registryFile: registryFileOf(dir) };
  }

  it('readMultiRegistry 旧形状归一 stars[0] 且 multi:false；写回保持旧形状', () => {
    const { registryFile } = cliDeps();
    writeRegistry(registryFile, { port: 7260, starId: STAR_A, name: 'alpha', nodes: [entry({ key: key('a') })] });
    const reg = readMultiRegistry(registryFile);
    expect(reg.multi).toBe(false);
    expect(reg.port).toBe(7260);
    expect(reg.stars[0]!.starId).toBe(STAR_A);
    expect(reg.stars[0]!.nodes).toHaveLength(1);
    writeMultiRegistry(registryFile, reg);
    const raw = JSON.parse(readFileSync(registryFile, 'utf8')) as Record<string, unknown>;
    expect(raw.nodes).toBeDefined(); // 旧形状字段
    expect(raw.stars).toBeUndefined();
  });

  it('--add-star：拒在跑 broker、迁移星册、转 stars[] 形状、重名拒绝', async () => {
    // 在跑 broker → 拒
    const busy = cliDeps({ listServeProcesses: () => [{ pid: 77, cmdline: 'node dist/cli.js serve' }] });
    await expect(runServe({ addStarArg: 'beta' }, busy.deps)).rejects.toThrow(/先 crosschat serve --stop/);
    // 静机上：旧形状 + roster.json → 加星
    const { deps, lines, registryFile } = cliDeps();
    writeRegistry(registryFile, { starId: STAR_A, name: 'alpha', nodes: [entry({ key: key('a') })] });
    writeFileSync(rosterFileOf(registryFile), JSON.stringify({ entries: [{ sessionId: 'sess-a1', machine: 'm', online: true }] }));
    expect(await runServe({ addStarArg: 'beta' }, deps)).toBe(0);
    const reg = readMultiRegistry(registryFile);
    expect(reg.multi).toBe(true);
    expect(reg.stars).toHaveLength(2);
    expect(reg.stars[1]!.name).toBe('beta');
    expect(reg.stars[1]!.nodes).toHaveLength(0);
    expect(reg.stars[1]!.starId).toMatch(/^[0-9a-f]{12}$/);
    expect(existsSync(rosterFileOf(registryFile))).toBe(false); // 旧册已迁
    expect(existsSync(rosterFileForStar(registryFile, { starId: STAR_A, name: 'alpha' }, true))).toBe(true);
    expect(lines.some((l) => l.includes('托管 2 颗星'))).toBe(true);
    expect(lines.some((l) => l.includes('故障域合并'))).toBe(true);
    // 重名/与 starId 同名拒绝
    await expect(runServe({ addStarArg: 'beta' }, deps)).rejects.toThrow(/已用于/);
    await expect(runServe({ addStarArg: STAR_A }, deps)).rejects.toThrow(/已用于/);
  });

  it('多星下 --gen-key/--remove 裸用教学、--star 限定生效', async () => {
    const { deps, lines, registryFile } = cliDeps();
    writeMultiRegistry(registryFile, {
      stars: [
        { starId: STAR_A, name: 'alpha', nodes: [entry({ key: key('a') })] },
        { starId: STAR_B, name: 'beta', nodes: [] },
      ],
      multi: true,
    });
    await expect(runServe({ genKeyArg: '1' }, deps)).rejects.toThrow(/--gen-key 须 --star/);
    await expect(runServe({ remove: 'node-1' }, deps)).rejects.toThrow(/--remove 须 --star/);
    expect(await runServe({ genKeyArg: '1', starArg: 'beta' }, deps)).toBe(0);
    const reg = readMultiRegistry(registryFile);
    expect(reg.stars[0]!.nodes).toHaveLength(1); // alpha 未动
    expect(reg.stars[1]!.nodes).toHaveLength(1); // beta 得钥
    expect(lines.some((l) => l.includes('入星 beta'))).toBe(true);
    expect(await runServe({ remove: 'node-1', starArg: 'beta' }, deps)).toBe(0);
    expect(readMultiRegistry(registryFile).stars[1]!.nodes).toHaveLength(0);
    // --list 分组展示
    lines.length = 0;
    expect(await runServe({ list: true }, deps)).toBe(0);
    expect(lines.some((l) => l.includes('=== 星 alpha ==='))).toBe(true);
    expect(lines.some((l) => l.includes('=== 星 beta ==='))).toBe(true);
  });

  it('013 延伸：本机 broker 内挂星域后手动 --connect 被拒并教学', async () => {
    const { deps, dir } = cliDeps();
    const tcpDir = join(dir, 'tcp');
    mkdirSync(tcpDir, { recursive: true });
    writeFileSync(
      join(tcpDir, 'node.json'),
      JSON.stringify({ brokers: [{ host: 'h1', port: 1, name: 'alpha', starId: STAR_A, key: 'k1' }], showName: 't' }),
    );
    writeFileSync(
      join(tcpDir, 'status-broker.json'),
      JSON.stringify({ state: 'running', pid: process.pid, stars: [{ name: 'alpha', starId: STAR_A }] }),
    );
    const err: unknown = await runServe({ connect: 'alpha' }, deps).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MultichatError);
    expect((err as MultichatError).code).toBe('USAGE');
    expect((err as MultichatError).message).toContain('已内挂');
    expect((err as MultichatError).message).toContain('无需另起');
  });
});
