/**
 * 018 批一：proto:3 会话级星成员——协议帧/broker 聚合/聚合器 attach 与活性。
 * 夹具用真实平台形状：win 带杠 MachineGuid、linux 32-hex（F0 归一互认）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { type RawData, WebSocketServer } from 'ws';
import { Broker, type BrokerDeps } from '../src/serve/broker.js';
import {
  CAP_SESSION_MEMBERS,
  encodeFrame,
  parseFrame,
  type ConnectFrame,
  type Frame,
  type SessionsFrame,
} from '../src/serve/protocol.js';
import { loadBrokerFile, registryFileOf, type NodeEntry } from '../src/serve/registry.js';
import { seedBroker } from './helpers/broker-seed.js';
import { attachPipePath, NodeClient, type BrokerEntry } from '../src/serve/node.js';
import { FileInbox } from '../src/serve/file-channel.js';
import type { SendDeps } from '../src/commands/send.js';
import type { MemberProvider } from '../src/application/members/index.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-serve-sessions-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// 真实平台形态：Windows MachineGuid 带杠 UUID / Linux /etc/machine-id 32-hex
const WIN_MID = '8f2a1b3c-4d5e-4f70-8a9b-0c1d2e3f4a5b';
const LINUX_MID = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const CODEX_THREAD = '01a05bb8-bf35-7980-bf4d-6b48e1380d77';

const key = (c: string) => c.repeat(64);
const slowHeartbeat = { heartbeatMs: 10_000, pongTimeoutMs: 20_000, connectTimeoutMs: 5_000 };

const brokers: Broker[] = [];
const clients: { close(): void }[] = [];
const nodeClients: NodeClient[] = [];
afterEach(async () => {
  for (const c of clients) c.close();
  clients.length = 0;
  for (const n of nodeClients) await n.stop();
  nodeClients.length = 0;
  for (const b of brokers) await b.stop();
  brokers.length = 0;
});

interface Harness {
  url: string;
  registryFile: string;
  broker: Broker;
  logs: string[];
}

async function startBroker(overrides: Partial<BrokerDeps> = {}): Promise<Harness> {
  const dir = mkdtempSync(join(root, 'case-'));
  const registryFile = registryFileOf(dir);
  const logs: string[] = [];
  const broker = new Broker({
    registryFile,
    statusFile: join(dir, 'status-broker.json'),
    version: '1.6.0-test',
    machineId: () => 'BROKER-MID',
    hostname: () => 'broker-host',
    now: () => Date.now(),
    log: (line) => {
      logs.push(line);
      if (process.env.CC_DBG === '1') console.error(`[bk] ${line}`);
    },
    deliverLocal: async () => ({ op: 'error', code: 'NOT_READY', message: 'nope' }),
    port: 0,
    ...slowHeartbeat,
    ...overrides,
  });
  brokers.push(broker);
  const port = await broker.start();
  return { url: `ws://127.0.0.1:${port}`, registryFile, broker, logs };
}

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
      if (process.env.CC_DBG === '1') {
        console.error(`[cli] <- ${frame.op}${'id' in frame ? ` ${String((frame as { id?: string }).id)}` : ''}${frame.op === 'error' ? ` ${(frame as { code?: string }).code}` : ''}`);
      }
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

  closed(timeoutMs = 5_000): Promise<number | undefined> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === WebSocket.CLOSED) return resolve(this.ws.closeCode);
      const timer = setTimeout(() => reject(new Error('close timeout')), timeoutMs);
      this.ws.once('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
  }

  close(): void {
    this.ws.close();
  }
}

/** node 角色握手（proto:3 客户端默认带 caps；old=true 模拟老节点）。 */
async function nodeOn(url: string, auth: string, machineId: string, opts: { name?: string; old?: boolean } = {}): Promise<TestClient> {
  const client = new TestClient(url);
  await client.opened();
  await client.waitFor((f) => f.op === 'info');
  client.send({
    op: 'connect',
    proto: 1,
    role: 'node',
    machineId,
    auth,
    ...(opts.name === undefined ? {} : { name: opts.name }),
    ...(opts.old === true ? {} : { caps: [CAP_SESSION_MEMBERS, 'multi-star'] }),
  });
  if (opts.old === true) return client; // 032 非兼容：无 caps 连不上，connected 永不来，直接返回让调用方收 error
  await client.waitFor((f) => f.op === 'connected');
  return client;
}

async function senderOn(url: string, auth: string): Promise<TestClient> {
  const client = new TestClient(url);
  await client.opened();
  await client.waitFor((f) => f.op === 'info');
  client.send({ op: 'connect', proto: 1, role: 'sender', auth, caps: ['multi-star'] });
  await client.waitFor((f) => f.op === 'connected');
  return client;
}

function sessionsFrame(sessions: SessionsFrame['sessions']): SessionsFrame {
  return { op: 'sessions', sessions };
}

describe('018 broker：caps 协商与会话成员聚合', () => {
  it('info 广播 session-members 能力；032 非兼容：无 caps 的老节点（proto:1）被拒并教升级', async () => {
    const { url, registryFile } = await startBroker();
    seed(registryFile, [{ key: key('n'), machineId: WIN_MID, machineName: 'win-box' }]);
    const client = new TestClient(url);
    await client.opened();
    const info = await client.waitFor((f) => f.op === 'info');
    expect(info.op === 'info' && info.caps).toContain(CAP_SESSION_MEMBERS);
    // 老节点：connect 不带 caps——032 用户拍板非兼容升级，BAD_PROTO 拒 + 升级教学
    const oldNode = await nodeOn(url, key('n'), WIN_MID, { name: 'win-box', old: true });
    const err = await oldNode.waitFor((f) => f.op === 'error');
    expect(err.op === 'error' && err.code).toBe('BAD_PROTO');
    expect(err.op === 'error' && err.message).toContain('版本过旧');
    expect(err.op === 'error' && err.message).toContain('npm i -g @oatelauser/crosschat@latest');
    expect(await oldNode.closed()).toBeDefined();
  });

  it('成员声明→三段寻址命中：deliver 注入 sessionId（win 带杠 mid 形态）', async () => {
    const { url, registryFile } = await startBroker();
    seed(registryFile, [
      { key: key('s'), machineName: 'sender-host' },
      { key: key('n'), machineId: WIN_MID, machineName: 'win-box' },
    ]);
    const node = await nodeOn(url, key('n'), WIN_MID, { name: 'win-box' });
    node.send(sessionsFrame([{ sessionId: 'sess-boss', name: 'boss' }]));
    const sender = await senderOn(url, key('s'));
    sender.send({ op: 'send', id: 's1', targetMachine: 'win-box:boss', body: 'hi session' });
    const deliver = await node.waitFor((f) => f.op === 'deliver');
    expect(deliver).toMatchObject({ op: 'deliver', id: 's1', sessionId: 'sess-boss', payload: 'hi session' });
    node.send({ op: 'result', id: 's1', status: 'delivered', turn: '1' });
    const receipt = await sender.waitFor((f) => f.op === 'receipt' && f.id === 's1');
    expect(receipt).toMatchObject({ op: 'receipt', id: 's1', status: 'delivered' });
  });

  it('非成员会话名→SESSION_NOT_MEMBER，教学指向启动器入星', async () => {
    const { url, registryFile } = await startBroker();
    seed(registryFile, [
      { key: key('s'), machineName: 'sender-host' },
      { key: key('n'), machineId: WIN_MID, machineName: 'win-box' },
    ]);
    const node = await nodeOn(url, key('n'), WIN_MID, { name: 'win-box' });
    node.send(sessionsFrame([{ sessionId: 'sess-boss', name: 'boss' }]));
    const sender = await senderOn(url, key('s'));
    sender.send({ op: 'send', id: 's2', targetMachine: 'win-box:ghost', body: 'x' });
    const err = await sender.waitFor((f) => f.op === 'error' && f.id === 's2');
    expect(err).toMatchObject({ op: 'error', id: 's2', code: 'SESSION_NOT_MEMBER' });
    expect(err.op === 'error' && err.message).toContain('--connect');
  });

  it('028 空数组重播=该机在册条目转下线（SESSION_OFFLINE 教学）；同 id 再声明=复活直达', async () => {
    const { url, registryFile } = await startBroker();
    seed(registryFile, [
      { key: key('s'), machineName: 'sender-host' },
      { key: key('n'), machineId: WIN_MID, machineName: 'win-box' },
    ]);
    const node = await nodeOn(url, key('n'), WIN_MID, { name: 'win-box' });
    node.send(sessionsFrame([{ sessionId: 'sess-boss', name: 'boss' }]));
    node.send(sessionsFrame([]));
    const sender = await senderOn(url, key('s'));
    sender.send({ op: 'send', id: 's3', targetMachine: 'win-box:boss', body: 'x' });
    const err = await sender.waitFor((f) => f.op === 'error' && f.id === 's3');
    expect(err).toMatchObject({ code: 'SESSION_OFFLINE' });
    expect(err.op === 'error' && err.message).toContain('--extend-session');
    // 同 id 再声明=复活上线（册位一直在，无需重新入星）
    node.send(sessionsFrame([{ sessionId: 'sess-boss', name: 'boss' }]));
    sender.send({ op: 'send', id: 's3b', targetMachine: 'win-box:boss', body: 'x' });
    const deliver = await node.waitFor((f) => f.op === 'deliver' && f.id === 's3b');
    expect(deliver).toMatchObject({ op: 'deliver', sessionId: 'sess-boss' });
  });

  it('alive-wins：旧名活会话在则正常投递，extends 休眠', async () => {
    const { url, registryFile } = await startBroker();
    seed(registryFile, [
      { key: key('s'), machineName: 'sender-host' },
      { key: key('n'), machineId: WIN_MID, machineName: 'win-box' },
    ]);
    const node = await nodeOn(url, key('n'), WIN_MID, { name: 'win-box' });
    node.send(sessionsFrame([
      { sessionId: 'sess-boss', name: 'boss' },
      { sessionId: 'sess-new', name: 'boss2', extends: 'boss' },
    ]));
    const sender = await senderOn(url, key('s'));
    sender.send({ op: 'send', id: 's4', targetMachine: 'win-box:boss', body: 'x' });
    const deliver = await node.waitFor((f) => f.op === 'deliver');
    // 旧名仍是活成员——投给 sess-boss 本尊，extends 不生效
    expect(deliver).toMatchObject({ op: 'deliver', id: 's4', sessionId: 'sess-boss' });
  });

  it('死名→extends 指路：SESSION_SUPERSEDED 报"已由 <机器:会话> 接续"', async () => {
    const { url, registryFile } = await startBroker();
    seed(registryFile, [
      { key: key('s'), machineName: 'sender-host' },
      { key: key('n'), machineId: WIN_MID, machineName: 'win-box' },
    ]);
    const node = await nodeOn(url, key('n'), WIN_MID, { name: 'win-box' });
    node.send(sessionsFrame([{ sessionId: 'sess-new', name: 'boss2', extends: 'boss' }]));
    const sender = await senderOn(url, key('s'));
    sender.send({ op: 'send', id: 's5', targetMachine: 'win-box:boss', body: 'x' });
    const err = await sender.waitFor((f) => f.op === 'error' && f.id === 's5');
    expect(err).toMatchObject({ code: 'SESSION_SUPERSEDED' });
    expect(err.op === 'error' && err.message).toContain('win-box:boss2');
    expect(err.op === 'error' && err.message).toContain('tcp:<星>:win-box:boss2');
  });

  it('同旧名先声明先得：后声明者收 EXTENDS_CONFLICT，映射指路先得者（linux 32-hex 形态）', async () => {
    const { url, registryFile } = await startBroker();
    seed(registryFile, [
      { key: key('s'), machineName: 'sender-host' },
      { key: key('w'), machineId: WIN_MID, machineName: 'win-box' },
      { key: key('l'), machineId: LINUX_MID, machineName: 'lin-box' },
    ]);
    const win = await nodeOn(url, key('w'), WIN_MID, { name: 'win-box' });
    win.send(sessionsFrame([{ sessionId: 'sess-a1', name: 'succ-a', extends: 'worker' }]));
    const lin = await nodeOn(url, key('l'), LINUX_MID, { name: 'lin-box' });
    lin.send(sessionsFrame([{ sessionId: 'sess-b1', name: 'succ-b', extends: { machine: 'win-box', name: 'worker' } }]));
    const conflict = await lin.waitFor((f) => f.op === 'error' && f.code === 'EXTENDS_CONFLICT');
    expect(conflict.op === 'error' && conflict.message).toContain('worker');
    expect(conflict.op === 'error' && conflict.message).toContain('win-box');
    const sender = await senderOn(url, key('s'));
    sender.send({ op: 'send', id: 's6', targetMachine: 'lin-box:worker', body: 'x' });
    const err = await sender.waitFor((f) => f.op === 'error' && f.id === 's6');
    // 星内映射指路先得者——跨机指到 win-box 的接任者
    expect(err).toMatchObject({ code: 'SESSION_SUPERSEDED' });
    expect(err.op === 'error' && err.message).toContain('win-box:succ-a');
  });

  it('028 顶替连接空声明→旧成员转下线（册位保留）；同 id 复活直达', async () => {
    const { url, registryFile } = await startBroker();
    seed(registryFile, [
      { key: key('s'), machineName: 'sender-host' },
      { key: key('n'), machineId: WIN_MID, machineName: 'win-box' },
    ]);
    const first = await nodeOn(url, key('n'), WIN_MID, { name: 'win-box' });
    first.send(sessionsFrame([{ sessionId: 'sess-boss', name: 'boss' }]));
    // 同机新连接顶掉旧连接（F0 顶换语义）——新连接空声明（对账重播形态）
    const second = await nodeOn(url, key('n'), WIN_MID, { name: 'win-box' });
    await first.closed(5_000);
    second.send(sessionsFrame([]));
    const sender = await senderOn(url, key('s'));
    sender.send({ op: 'send', id: 's7', targetMachine: 'win-box:boss', body: 'x' });
    const err = await sender.waitFor((f) => f.op === 'error' && f.id === 's7');
    expect(err).toMatchObject({ code: 'SESSION_OFFLINE' }); // 不再除名——死亡上报下线
    second.send(sessionsFrame([{ sessionId: 'sess-boss', name: 'boss' }]));
    sender.send({ op: 'send', id: 's7b', targetMachine: 'win-box:boss', body: 'x' });
    const deliver = await second.waitFor((f) => f.op === 'deliver' && f.id === 's7b');
    expect(deliver).toMatchObject({ sessionId: 'sess-boss' });
  });

  it('mid 前缀+会话三段（F0 归一：前缀寻址 linux 32-hex 机器）', async () => {
    const { url, registryFile } = await startBroker();
    seed(registryFile, [
      { key: key('s'), machineName: 'sender-host' },
      { key: key('l'), machineId: LINUX_MID, machineName: 'lin-box' },
    ]);
    const lin = await nodeOn(url, key('l'), LINUX_MID, { name: 'lin-box' });
    lin.send(sessionsFrame([{ sessionId: 'lin-sess-1', name: 'boss' }]));
    const sender = await senderOn(url, key('s'));
    sender.send({ op: 'send', id: 's8', targetMachine: `${LINUX_MID.slice(0, 8)}:boss`, body: 'x' });
    const deliver = await lin.waitFor((f) => f.op === 'deliver');
    expect(deliver).toMatchObject({ op: 'deliver', id: 's8', sessionId: 'lin-sess-1' });
  });

  it('未声明成员的节点：机器级投递 deliver 帧无 sessionId、形状照旧', async () => {
    const { url, registryFile } = await startBroker();
    seed(registryFile, [
      { key: key('s'), machineName: 'sender-host' },
      { key: key('n'), machineId: WIN_MID, machineName: 'win-box' },
    ]);
    // 新节点但从不发 sessions 帧（032 后老节点被拒，机器级帧形状用此形态钉死）
    const node = await nodeOn(url, key('n'), WIN_MID, { name: 'win-box' });
    const sender = await senderOn(url, key('s'));
    sender.send({ op: 'send', id: 'm1', targetMachine: 'win-box', to: 'boss', body: 'machine level', origin: 'origin-x' });
    const deliver = await node.waitFor((f) => f.op === 'deliver');
    expect(deliver).toMatchObject({ op: 'deliver', id: 'm1', fromMachine: 'sender-host', payload: 'machine level', to: 'boss', origin: 'origin-x' });
    expect('sessionId' in deliver).toBe(false);
  });
});

/** 可控 SendDeps：按需给出 claude 扫描行/codex 线程行，投递内容被捕获。 */
interface FakeCapture {
  deps: SendDeps;
  delivered: string[];
}

function fakeDeps(opts: { claude?: Array<{ sessionId: string; name?: string }>; codex?: Array<{ id: string; name: string }> } = {}): FakeCapture {
  const delivered: string[] = [];
  const capture: FakeCapture = {
    delivered,
    deps: {
      env: {},
      listClaudeSessions: () => ({
        sessions: (opts.claude ?? []).map((s) => ({
          pid: 1,
          sessionId: s.sessionId,
          kind: 'interactive',
          ...(s.name === undefined ? {} : { name: s.name }),
          status: 'idle',
          messagingSocketPath: 'x',
        })),
        malformed: 0,
      }),
      listCodexThreads: async () => (opts.codex ?? []).map((t) => ({ id: t.id, name: t.name, status: 'idle' as const })),
      deliverClaude: async (_t, content) => {
        delivered.push(content);
        return { status: 'delivered' };
      },
      deliverCodex: async () => ({ status: 'accepted', turnId: 't' }),
      sendLogFile: join(mkdtempSync(join(root, 'ratelog-')), 'send-log.jsonl'),
      outboxDir: mkdtempSync(join(root, 'outbox-')),
      now: () => Date.now(),
      hostname: () => 'node-host',
      machineId: () => 'NODE-MID',
    },
  };
  return capture;
}

interface AttachConn {
  send(req: unknown): Promise<{ ok: boolean; error?: string }>;
  close(): void;
}

/** attach 管道客户端：换行 JSON 请求/回执；管道未就绪时重试连接。 */
function attachTalk(pipePath: string): Promise<AttachConn> {
  return new Promise((resolve, reject) => {
    const tryConnect = (left: number): void => {
      const socket: Socket = createConnection({ path: pipePath });
      const giveUp = (err: Error): void => {
        socket.destroy();
        if (left <= 0) return reject(err);
        setTimeout(() => tryConnect(left - 1), 100);
      };
      socket.once('error', giveUp);
      socket.once('connect', () => {
        socket.removeListener('error', giveUp);
        let buf = '';
        const waiters: ((r: { ok: boolean; error?: string }) => void)[] = [];
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
        socket.on('error', () => socket.destroy());
        clients.push({ close: () => socket.destroy() });
        resolve({
          send: (req) =>
            new Promise((res) => {
              waiters.push(res);
              socket.write(`${JSON.stringify(req)}\n`);
            }),
          close: () => socket.destroy(),
        });
      });
    };
    tryConnect(30);
  });
}

describe('018 NodeClient 聚合器：attach IPC / 重播 / 双活性', () => {
  interface NodeHarness {
    harness: Harness;
    client: NodeClient;
    capture: FakeCapture;
    attach: AttachConn;
    entry: BrokerEntry;
    dir: string;
  }

  async function startNodeStar(
    label: string,
    depsOpts: { claude?: Array<{ sessionId: string; name?: string }>; codex?: Array<{ id: string; name: string }> },
    overrides: Partial<ConstructorParameters<typeof NodeClient>[0]> = {},
  ): Promise<NodeHarness> {
    const harness = await startBroker();
    seed(harness.registryFile, [
      { key: key('s'), machineName: 'sender-host' },
      { key: key('n'), machineId: 'NODE-MID', machineName: 'node-host' },
    ]);
    const dir = mkdtempSync(join(root, `nd-${label}-`));
    const inbox = mkdtempSync(join(root, 'node-'));
    const entry: BrokerEntry = { host: '127.0.0.1', port: Number(new URL(harness.url).port), name: 'broker-alias', key: key('n') };
    const capture = fakeDeps(depsOpts);
    const client = new NodeClient({
      config: { entries: [entry] },
      configFile: join(dir, 'node.json'),
      machineId: () => 'NODE-MID',
      statusFile: join(dir, 'status-node.json'),
      fileInbox: new FileInbox({ inboxDir: join(inbox, 'inbox'), partsDir: join(inbox, 'parts') }),
      makeSendDeps: () => capture.deps,
      now: () => Date.now(),
      log: () => {},
      backoffBaseMs: 50,
      attachLabel: label,
      memberCheckMs: 60_000,
      ...overrides,
    });
    nodeClients.push(client);
    void client.run();
    await client.waitForState('online');
    const attach = await attachTalk(attachPipePath(entry, dir, label));
    return { harness, client, capture, attach, entry, dir };
  }

  it('attach→sessions 帧上行→三段直达按 sessionId 注入投递', async () => {
    const { harness, capture, attach } = await startNodeStar('t1', { claude: [{ sessionId: 'sess-boss', name: 'boss' }] });
    const reply = await attach.send({ op: 'attach', sessionId: 'sess-boss', name: 'boss' });
    expect(reply).toEqual({ ok: true });
    const sender = await senderOn(harness.url, key('s'));
    sender.send({ op: 'send', id: 'n1', targetMachine: 'node-host:boss', body: 'hello member' });
    const receipt = await sender.waitFor((f) => f.op === 'receipt' && f.id === 'n1');
    expect(receipt).toMatchObject({ op: 'receipt', id: 'n1', status: 'delivered' });
    expect(capture.delivered).toHaveLength(1);
    expect(capture.delivered[0]).toContain('hello member');
  });

  it('attach 校验：冒号会话名拒收并教学；坏形状报错；detach 幂等', async () => {
    const { attach } = await startNodeStar('t2', { claude: [{ sessionId: 'sess-boss' }] });
    const bad = await attach.send({ op: 'attach', sessionId: 'sess-x', name: 'a:b' });
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('冒号');
    const noId = await attach.send({ op: 'attach' });
    expect(noId.ok).toBe(false);
    const detach = await attach.send({ op: 'detach', sessionId: 'never-there' });
    expect(detach).toEqual({ ok: true });
  });

  it('028 成员表变化即重播：detach（无 erase）后三段报 SESSION_OFFLINE（册位保留）', async () => {
    const { harness, attach } = await startNodeStar('t3', { claude: [{ sessionId: 'sess-boss', name: 'boss' }] });
    await attach.send({ op: 'attach', sessionId: 'sess-boss', name: 'boss' });
    await attach.send({ op: 'detach', sessionId: 'sess-boss' });
    const sender = await senderOn(harness.url, key('s'));
    sender.send({ op: 'send', id: 'n2', targetMachine: 'node-host:boss', body: 'x' });
    const err = await sender.waitFor((f) => f.op === 'error' && f.id === 'n2');
    expect(err).toMatchObject({ code: 'SESSION_OFFLINE' });
  });

  it('重连全量重播：broker 重启后无需重新 attach 即恢复会话寻址', async () => {
    const { harness, client, attach } = await startNodeStar('t4', { claude: [{ sessionId: 'sess-boss', name: 'boss' }] });
    await attach.send({ op: 'attach', sessionId: 'sess-boss', name: 'boss' });
    const port = Number(new URL(harness.url).port);
    await harness.broker.stop();
    // 慢机先例（同 /rename 跟随用例 60s 注释）：负载下 broker 关停→状态翻转可拖过
    // 默认 5s——窗口放宽，实现侧重播仍是上线即发（connectOnce 同步 sendSessions）
    await client.waitForState('reconnect-wait', 8_000);
    // 同端口同注册表拉起新 broker——客户端自行回线上并重播成员表
    const broker2 = new Broker({
      registryFile: harness.registryFile,
      statusFile: join(root, 'status-broker2.json'),
      version: 'test',
      machineId: () => 'BROKER-MID',
      hostname: () => 'broker-host',
      now: () => Date.now(),
      log: () => {},
      deliverLocal: async () => ({ op: 'error', code: 'NOT_READY', message: 'x' }),
      port,
      ...slowHeartbeat,
    });
    brokers.push(broker2);
    await broker2.start();
    await client.waitForState('online', 8_000);
    const sender = await senderOn(`ws://127.0.0.1:${port}`, key('s'));
    sender.send({ op: 'send', id: 'n3', targetMachine: 'node-host:boss', body: 'after restart' });
    // 同上慢机窗口：重连退避档（50ms×2^n）在负载下可把恢复链顶到默认 5s 踩线
    const receipt = await sender.waitFor((f) => f.op === 'receipt' && f.id === 'n3', 10_000);
    expect(receipt).toMatchObject({ status: 'delivered' });
  }, 25_000);

  it('028 claude 活性：扫描核验——死 claude 成员转下线（教学）、活成员续投', async () => {
    const { harness, attach } = await startNodeStar(
      't5',
      { claude: [{ sessionId: 'sess-boss', name: 'boss' }] },
      { memberCheckMs: 100 },
    );
    await attach.send({ op: 'attach', sessionId: 'sess-boss', name: 'boss' });
    await attach.send({ op: 'attach', sessionId: 'sess-gone', name: 'gone' });
    await new Promise((resolve) => setTimeout(resolve, 500)); // 等对账循环至少一轮
    const sender = await senderOn(harness.url, key('s'));
    sender.send({ op: 'send', id: 'n6', targetMachine: 'node-host:gone', body: 'x' });
    const err = await sender.waitFor((f) => f.op === 'error' && f.id === 'n6');
    expect(err).toMatchObject({ code: 'SESSION_OFFLINE' }); // 死=下线（册位保留，不再除名）
    expect(err.op === 'error' && err.message).toContain('resume');
    sender.send({ op: 'send', id: 'n7', targetMachine: 'node-host:boss', body: 'still here' });
    const receipt = await sender.waitFor((f) => f.op === 'receipt' && f.id === 'n7');
    expect(receipt).toMatchObject({ status: 'delivered' });
  }, 10_000);

  it('028 双活性（9a）：codex 线程存在（rollout 落盘）永不下线；两侧皆无的死名转下线', async () => {
    const codexHome = mkdtempSync(join(root, 'codexhome-'));
    const dir = join(codexHome, 'sessions', '2026', '10', '15');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `rollout-2026-10-15T00-00-00-${CODEX_THREAD}.jsonl`),
      `${JSON.stringify({ type: 'session_meta', payload: { session_id: CODEX_THREAD, cwd: '/tmp', originator: 'codex-tui', timestamp: '2026-10-15T00:00:00.000Z' } })}\n`,
    );
    const { harness, attach } = await startNodeStar(
      't6',
      { codex: [{ id: CODEX_THREAD, name: 'cname' }] },
      { memberCheckMs: 100, codexHome },
    );
    await attach.send({ op: 'attach', sessionId: CODEX_THREAD, name: 'cname' });
    await attach.send({ op: 'attach', sessionId: 'sess-dead', name: 'deadname' });
    await new Promise((resolve) => setTimeout(resolve, 500)); // 等对账循环至少一轮
    const sender = await senderOn(harness.url, key('s'));
    sender.send({ op: 'send', id: 'n4', targetMachine: 'node-host:cname', body: 'to codex' });
    const receipt = await sender.waitFor((f) => f.op === 'receipt' && f.id === 'n4');
    expect(receipt).toMatchObject({ status: 'delivered' }); // codex 成员经 rollout 核验存活
    sender.send({ op: 'send', id: 'n5', targetMachine: 'node-host:deadname', body: 'x' });
    const err = await sender.waitFor((f) => f.op === 'error' && f.id === 'n5');
    expect(err).toMatchObject({ code: 'SESSION_OFFLINE' }); // 无 rollout 的死名转下线（册位保留）
  }, 10_000);

  it('029 临时成员异常死亡：对账验死报 member-remove 清册零痕迹（不留下线态）', async () => {
    const { harness, attach } = await startNodeStar(
      't9',
      { claude: [{ sessionId: 'sess-boss', name: 'boss' }] },
      { memberCheckMs: 100 },
    );
    await attach.send({ op: 'attach', sessionId: 'sess-boss', name: 'boss' });
    // 临时成员声明入册（--rm 形态：temporary 位随 attach），随后异常死亡（不在本地扫描里）
    await attach.send({ op: 'attach', sessionId: 'sess-tmp', name: 'tmpname', temporary: true });
    await new Promise((resolve) => setTimeout(resolve, 700)); // 等对账循环验死+member-remove 到册
    const sender = await senderOn(harness.url, key('s'));
    sender.send({ op: 'send', id: 'n8', targetMachine: 'node-host:tmpname', body: 'x' });
    const err = await sender.waitFor((f) => f.op === 'error' && f.id === 'n8');
    expect(err).toMatchObject({ code: 'SESSION_NOT_MEMBER' }); // 删册=从未入册同码（零痕迹）
    // 永久成员不受牵连
    sender.send({ op: 'send', id: 'n9', targetMachine: 'node-host:boss', body: 'still here' });
    const receipt = await sender.waitFor((f) => f.op === 'receipt' && f.id === 'n9');
    expect(receipt).toMatchObject({ status: 'delivered' });
  }, 10_000);

  it('delegates revival tool and name following to a third provider capability', async () => {
    const probe = vi.fn(async ({ nativeId }: { nativeId: string }) => ({ nativeId, presence: 'present' as const, name: null, completeness: 'complete' as const, errors: [], observedAt: 1 }));
    const source: MemberProvider = { providerId: 'thirdtool', liveness: { probe }, readName: vi.fn(async () => 'provider-renamed') };
    const { harness, attach } = await startNodeStar('provider-third', {}, { memberCheckMs: 50, memberProviders: () => [source] });
    await attach.send({ op: 'attach', sessionId: 'opaque-third-id', name: 'old-name' });
    await attach.send({ op: 'detach', sessionId: 'opaque-third-id' });
    await vi.waitFor(() => expect(probe).toHaveBeenCalled(), { timeout: 2_000 });
    await vi.waitFor(() => expect(loadBrokerFile(harness.registryFile).stars[0]?.roster).toEqual([expect.objectContaining({ sessionId: 'opaque-third-id', name: 'provider-renamed', tool: 'thirdtool' })]), { timeout: 2_000 });
  });

  it('leaves temporary members declared when provider liveness is unknown', async () => {
    const probe = vi.fn(async ({ nativeId }: { nativeId: string }) => ({ nativeId, presence: 'unknown' as const, name: null, completeness: 'unavailable' as const, errors: [], observedAt: 1 }));
    const source: MemberProvider = { providerId: 'thirdtool', liveness: { probe }, readName: vi.fn(async () => undefined) };
    const { harness, attach } = await startNodeStar('provider-unknown', {}, { memberCheckMs: 50, memberProviders: () => [source] });
    await attach.send({ op: 'attach', sessionId: 'unknown-id', name: 'keep-me', temporary: true });
    await vi.waitFor(() => expect(probe).toHaveBeenCalled(), { timeout: 2_000 });
    expect(await attach.send({ op: 'status' })).toMatchObject({ members: [expect.objectContaining({ sessionId: 'unknown-id', name: 'keep-me', temporary: true })] });
    expect(loadBrokerFile(harness.registryFile).stars[0]?.roster).toEqual([expect.objectContaining({ sessionId: 'unknown-id', temporary: true })]);
  });
});

describe('020 broker：会话段工具限定词与收命中集', () => {
  async function star(up: { url: string; registryFile: string }) {
    seed(up.registryFile, [
      { key: key('s'), machineName: 'sender-host' },
      { key: key('n'), machineId: WIN_MID, machineName: 'win-box' },
    ]);
    const node = await nodeOn(up.url, key('n'), WIN_MID, { name: 'win-box' });
    const sender = await senderOn(up.url, key('s'));
    return { node, sender };
  }
  const deliver = async (sender: TestClient, node: TestClient, id: string, target: string): Promise<Frame> => {
    sender.send({ op: 'send', id, targetMachine: target, body: 'x' });
    // 成功路径：node 收 deliver 即回 result；返回 node 侧 deliver 帧（断言 sessionId 注入）
    const nodeSaw = node
      .waitFor((f) => f.op === 'deliver' && f.id === id, 1_500)
      .then((f) => {
        node.send({ op: 'result', id, status: 'delivered', turn: '1' });
        return f;
      })
      .catch(() => undefined);
    const back = await sender.waitFor((fr) => (fr.op === 'receipt' || fr.op === 'error') && fr.id === id);
    if (back.op === 'error') return back; // 错误路径：node 不会有 deliver，立即返回（不等探针超时）
    const nd = await nodeSaw;
    return nd !== undefined ? nd : back;
  };

  it('撞名双成员：裸名 NAME_COLLISION 列两个限定地址；限定地址各达各的；裸名唯一照投（全量 id 亦达）', async () => {
    const up = await startBroker();
    const { node, sender } = await star(up);
    node.send(sessionsFrame([
      { sessionId: 'sess-c-boss', name: 'boss', tool: 'claude' },
      { sessionId: '01a05bb8-bf35-7980-bf4d-6b48e1380d77', name: 'boss', tool: 'codex' },
    ]));
    const col = await deliver(sender, node, 'q1', 'win-box:boss');
    expect(col).toMatchObject({ op: 'error', code: 'NAME_COLLISION' });
    expect(col.op === 'error' && col.message).toContain('win-box:claude/boss');
    expect(col.op === 'error' && col.message).toContain('win-box:codex/boss');
    expect(col.op === 'error' && col.message).toContain('改投限定地址');
    const toClaude = await deliver(sender, node, 'q2', 'win-box:claude/boss');
    expect(toClaude).toMatchObject({ op: 'deliver', sessionId: 'sess-c-boss' });
    const toCodex = await deliver(sender, node, 'q3', 'win-box:codex/boss');
    expect(toCodex).toMatchObject({ op: 'deliver', sessionId: '01a05bb8-bf35-7980-bf4d-6b48e1380d77' });
    // 裸名唯一（退掉一个成员后）照投——1.6.1 已发布地址零破坏
    node.send(sessionsFrame([{ sessionId: 'sess-c-boss', name: 'boss', tool: 'claude' }]));
    const bare = await deliver(sender, node, 'q4', 'win-box:boss');
    expect(bare).toMatchObject({ op: 'deliver', sessionId: 'sess-c-boss' });
    // 全量 id 寻址照旧
    const byId = await deliver(sender, node, 'q5', 'win-box:sess-c-boss');
    expect(byId).toMatchObject({ op: 'deliver', sessionId: 'sess-c-boss' });
  });

  it('同工具同名：限定地址相同→列 id8 两行教 id 前缀；id8 前缀直达', async () => {
    const up = await startBroker();
    const { node, sender } = await star(up);
    node.send(sessionsFrame([
      { sessionId: '9f8e7d6c-0000-0000-0000-000000000001', name: 'boss', tool: 'claude' },
      { sessionId: '1a2b3c4d-0000-0000-0000-000000000002', name: 'boss', tool: 'claude' },
    ]));
    const col = await deliver(sender, node, 'q6', 'win-box:boss');
    expect(col).toMatchObject({ code: 'NAME_COLLISION' });
    const msg = col.op === 'error' ? col.message : '';
    expect(msg).toContain('claude/boss(9f8e7d6c)');
    expect(msg).toContain('claude/boss(1a2b3c4d)');
    expect(msg).toContain('id 前 8 位');
    const qualifiedCol = await deliver(sender, node, 'q7', 'win-box:claude/boss');
    expect(qualifiedCol).toMatchObject({ code: 'NAME_COLLISION' }); // 限定词救不了同工具同名
    const byId8 = await deliver(sender, node, 'q8', 'win-box:9f8e7d6c');
    expect(byId8).toMatchObject({ op: 'deliver', sessionId: '9f8e7d6c-0000-0000-0000-000000000001' });
  });

  it('全串名含斜杠自伤边角：成员真叫 codex/notes 时全串精确优先（不拆限定词）', async () => {
    const up = await startBroker();
    const { node, sender } = await star(up);
    node.send(sessionsFrame([
      { sessionId: 'sess-slash', name: 'codex/notes', tool: 'claude' },
      { sessionId: 'sess-notes', name: 'notes', tool: 'codex' },
    ]));
    const f = await deliver(sender, node, 'q9', 'win-box:codex/notes');
    expect(f).toMatchObject({ op: 'deliver', sessionId: 'sess-slash' }); // 名为 codex/notes 的成员本尊
    // 真限定词照常：codex/notes 拆解仅在无全串命中时生效——这里全串已命中，不拆
  });

  it('extends 跨工具同名血统：共存登记；死名裸名碰撞列两接任者；限定旧名指路对应血统', async () => {
    const up = await startBroker();
    const { node, sender } = await star(up);
    node.send(sessionsFrame([
      { sessionId: 'succ-c', name: 'boss-claude2', tool: 'claude', extends: 'boss' },
      { sessionId: 'succ-x', name: 'boss-codex2', tool: 'codex', extends: 'boss' },
    ]));
    // 跨工具血统共存——不再 EXTENDS_CONFLICT（同工具才会）
    const col = await deliver(sender, node, 'r1', 'win-box:boss');
    expect(col).toMatchObject({ code: 'NAME_COLLISION' });
    expect(col.op === 'error' && col.message).toContain('win-box:claude/boss-claude2');
    expect(col.op === 'error' && col.message).toContain('win-box:codex/boss-codex2');
    const sup = await deliver(sender, node, 'r2', 'win-box:claude/boss');
    expect(sup).toMatchObject({ code: 'SESSION_SUPERSEDED' });
    expect(sup.op === 'error' && sup.message).toContain('win-box:claude/boss-claude2');
    expect(sup.op === 'error' && sup.message).toContain('tcp:<星>:win-box:claude/boss-claude2');
  });

  it('老聚合器无 tool 降级：同名双成员无 tool → 碰撞列 id8 + 升级教学（限定词不可用不瞎拆）', async () => {
    const up = await startBroker();
    const { node, sender } = await star(up);
    node.send(sessionsFrame([
      { sessionId: 'old-aaa-0001', name: 'boss' },
      { sessionId: 'old-bbb-0002', name: 'boss' },
    ]));
    const col = await deliver(sender, node, 's1', 'win-box:boss');
    expect(col).toMatchObject({ code: 'NAME_COLLISION' });
    const msg = col.op === 'error' ? col.message : '';
    expect(msg).toContain('boss(');
    expect(msg).toContain('未声明 tool');
    // 无声明 tool 集 → claude/boss 不当限定词（整体按名解析 → 非成员）
    const q = await deliver(sender, node, 's2', 'win-box:claude/boss');
    expect(q).toMatchObject({ code: 'SESSION_NOT_MEMBER' });
  });
});

describe('028 册（roster）：落盘/跨机拒绝/extends 胜复活/member-remove', () => {
  it('roster 落盘形态：条目含 tool+会话 id+名+机器+在线态；tmp 已 rename 收尾', async () => {
    const { url, registryFile } = await startBroker();
    seed(registryFile, [
      { key: key('s'), machineName: 'sender-host' },
      { key: key('n'), machineId: WIN_MID, machineName: 'win-box' },
    ]);
    const node = await nodeOn(url, key('n'), WIN_MID, { name: 'win-box' });
    node.send(sessionsFrame([{ sessionId: 'sess-boss', name: 'boss', tool: 'claude' }]));
    await new Promise((resolve) => setTimeout(resolve, 200)); // 等 onSessions 落盘
    const roster = loadBrokerFile(registryFile).stars[0]!.roster;
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({
      sessionId: 'sess-boss',
      name: 'boss',
      tool: 'claude',
      machine: WIN_MID.replace(/-/g, ''), // 归一 mid（复活判定的机器锚）
      machineName: 'win-box',
    });
    // 033 台账静态化：roster.online 不落盘（活性归运行时；缺字段=默认离线）
    expect(roster[0]!.online).toBeUndefined();
    expect(readFileSync(registryFile, 'utf8')).not.toContain('"online"');
    expect(existsSync(`${registryFile}.tmp`)).toBe(false); // tmp+rename 收尾
  });

  it('028 下线成员随 roster 帧下发（offlineSessions 单列；sessions 保持活成员语义）', async () => {
    const { url, registryFile } = await startBroker();
    seed(registryFile, [
      { key: key('s'), machineName: 'sender-host' },
      { key: key('n'), machineId: WIN_MID, machineName: 'win-box' },
    ]);
    const node = await nodeOn(url, key('n'), WIN_MID, { name: 'win-box' });
    node.send(sessionsFrame([{ sessionId: 'sess-boss', name: 'boss', tool: 'claude' }]));
    await new Promise((resolve) => setTimeout(resolve, 200)); // 等 onSessions 落册
    node.send(sessionsFrame([])); // 全量重播空 = 下线（册位保留）
    await new Promise((resolve) => setTimeout(resolve, 200));
    const sender = await senderOn(url, key('s'));
    sender.send({ op: 'roster' });
    const res = await sender.waitFor((f) => f.op === 'roster-result');
    const win = (res.op === 'roster-result' ? res.machines : []).find((m) => m.name === 'win-box')!;
    expect(win.online).toBe(true); // 机器连接在——只是成员下线
    expect(win.sessions).toBeUndefined(); // 活成员语义不动（extends 校验共用）
    expect(win.offlineSessions).toEqual([{ sessionId: 'sess-boss', name: 'boss', tool: 'claude' }]);
  }, 10_000);

  it('029 临时位随声明入册落盘并随切片回带（temporary 端到端透传）', async () => {
    const { url, registryFile } = await startBroker();
    seed(registryFile, [
      { key: key('s'), machineName: 'sender-host' },
      { key: key('n'), machineId: WIN_MID, machineName: 'win-box' },
    ]);
    const node = await nodeOn(url, key('n'), WIN_MID, { name: 'win-box' });
    node.send(sessionsFrame([
      { sessionId: 'sess-perm', name: 'perm', tool: 'claude' },
      { sessionId: 'sess-tmp', name: 'tmp', tool: 'claude', temporary: true },
    ]));
    await new Promise((resolve) => setTimeout(resolve, 200)); // 等 onSessions 落盘
    const roster = loadBrokerFile(registryFile).stars[0]!.roster;
    expect(roster.find((e) => e.sessionId === 'sess-tmp')?.temporary).toBe(true); // 册落盘带临时位
    expect(roster.find((e) => e.sessionId === 'sess-perm')?.temporary).toBeUndefined(); // 永久位不带
    node.send({ op: 'members-query' }); // 切片回带（聚合器重启后仍知谁是临时）
    const slice = await node.waitFor((f) => f.op === 'members-result');
    const tmp = (slice.op === 'members-result' ? slice.members : []).find((m) => m.sessionId === 'sess-tmp');
    expect(tmp?.temporary).toBe(true);
  }, 10_000);

  it('边界1 跨机 resume：册在 M1、id 活在 M2 → MACHINE_BOUND 拒绝复活+教学（册位仍绑 M1）', async () => {
    const { url, registryFile } = await startBroker();
    seed(registryFile, [
      { key: key('s'), machineName: 'sender-host' },
      { key: key('w'), machineId: WIN_MID, machineName: 'win-box' },
      { key: key('l'), machineId: LINUX_MID, machineName: 'lin-box' },
    ]);
    const win = await nodeOn(url, key('w'), WIN_MID, { name: 'win-box' });
    win.send(sessionsFrame([{ sessionId: 'sess-x', name: 'boss', tool: 'claude' }]));
    // 同 id 异机声明（跨机 resume）——拒绝复活，教学指向显式迁移
    const lin = await nodeOn(url, key('l'), LINUX_MID, { name: 'lin-box' });
    lin.send(sessionsFrame([{ sessionId: 'sess-x', name: 'boss', tool: 'claude' }]));
    const err = await lin.waitFor((f) => f.op === 'error' && f.code === 'MACHINE_BOUND');
    expect(err.op === 'error' && err.message).toContain('win-box');
    expect(err.op === 'error' && err.message).toContain('--member-remove');
    // 册位仍绑 M1：lin 机器上无名（本机册切片为空），win 上照旧可达
    const sender = await senderOn(url, key('s'));
    sender.send({ op: 'send', id: 'mb1', targetMachine: 'lin-box:boss', body: 'x' });
    const notOnLin = await sender.waitFor((f) => f.op === 'error' && f.id === 'mb1');
    expect(notOnLin).toMatchObject({ code: 'SESSION_NOT_MEMBER' });
    sender.send({ op: 'send', id: 'mb2', targetMachine: 'win-box:boss', body: 'x' });
    const deliver = await win.waitFor((f) => f.op === 'deliver' && f.id === 'mb2');
    expect(deliver).toMatchObject({ sessionId: 'sess-x' });
  });

  it('extends 胜复活：接任后原会话同 id 回归不夺回（名字剥离教学；id8 点对点直达）', async () => {
    const { url, registryFile } = await startBroker();
    seed(registryFile, [
      { key: key('s'), machineName: 'sender-host' },
      { key: key('n'), machineId: WIN_MID, machineName: 'win-box' },
    ]);
    const node = await nodeOn(url, key('n'), WIN_MID, { name: 'win-box' });
    // 原会话 sess-old 持名 boss → 下线 → sess-new 接任（extends boss）
    node.send(sessionsFrame([{ sessionId: 'aaaabbbb1111', name: 'boss', tool: 'claude' }]));
    node.send(sessionsFrame([{ sessionId: 'sess-new', name: 'boss2', tool: 'claude', extends: 'boss' }]));
    // 原会话同 id 回归并索回名字——不夺回：名字剥离+教学
    node.send(sessionsFrame([
      { sessionId: 'aaaabbbb1111', name: 'boss', tool: 'claude' },
      { sessionId: 'sess-new', name: 'boss2', tool: 'claude', extends: 'boss' },
    ]));
    const err = await node.waitFor((f) => f.op === 'error' && f.code === 'EXTENDS_CONFLICT' && f.message.includes('夺回'));
    expect(err.op === 'error' && err.message).toContain('boss2');
    expect(err.op === 'error' && err.message).toContain('aaaabbbb'); // id8 寻址教学
    const sender = await senderOn(url, key('s'));
    // 旧名指路接任者（SUPERSEDED）；原会话按 id8 点对点直达
    sender.send({ op: 'send', id: 'ex1', targetMachine: 'win-box:boss', body: 'x' });
    const sup = await sender.waitFor((f) => f.op === 'error' && f.id === 'ex1');
    expect(sup).toMatchObject({ code: 'SESSION_SUPERSEDED' });
    sender.send({ op: 'send', id: 'ex2', targetMachine: 'win-box:aaaabbbb', body: 'direct' });
    const deliver = await node.waitFor((f) => f.op === 'deliver' && f.id === 'ex2');
    expect(deliver).toMatchObject({ sessionId: 'aaaabbbb1111' });
  });

  it('member-remove：按名删即册外无名；幂等零命中=成功注明；多名命中拒绝教 id8', async () => {
    const { url, registryFile } = await startBroker();
    seed(registryFile, [
      { key: key('s'), machineName: 'sender-host' },
      { key: key('n'), machineId: WIN_MID, machineName: 'win-box' },
    ]);
    const node = await nodeOn(url, key('n'), WIN_MID, { name: 'win-box' });
    node.send(sessionsFrame([
      { sessionId: 'ccccdddd1111', name: 'boss', tool: 'claude' },
      { sessionId: 'eeeeffff2222', name: 'boss', tool: 'codex' },
    ]));
    const sender = await senderOn(url, key('s'));
    // 多名命中（跨工具同名）：拒绝并列 id8 教精确删除
    sender.send({ op: 'member-remove', target: 'boss' });
    const amb = await sender.waitFor((f) => f.op === 'member-remove-result');
    expect(amb).toMatchObject({ op: 'member-remove-result', ok: false });
    expect(amb.op === 'member-remove-result' && amb.error).toContain('ccccdddd');
    // id8 精确删一条：归属机收清表推送（聚合器语义）后重播，册外无名
    sender.send({ op: 'member-remove', target: 'ccccdddd1111' });
    const del = await sender.waitFor((f) => f.op === 'member-remove-result' && f.ok === true);
    expect(del.op === 'member-remove-result' && del.removed).toEqual(['boss']);
    await node.waitFor((f) => f.op === 'member-remove' && f.target === 'ccccdddd1111');
    node.send(sessionsFrame([{ sessionId: 'eeeeffff2222', name: 'boss', tool: 'codex' }])); // 重播去掉被删成员
    sender.send({ op: 'send', id: 'mr2', targetMachine: 'win-box:claude/boss', body: 'x' });
    const gone = await sender.waitFor((f) => f.op === 'error' && f.id === 'mr2');
    expect(gone).toMatchObject({ code: 'SESSION_NOT_MEMBER' }); // 删除=零残留（非下线态）
    // 幂等：再删同名不存在条目——成功注明本不在册
    sender.send({ op: 'member-remove', target: 'ccccdddd1111' });
    const again = await sender.waitFor((f) => f.op === 'member-remove-result' && f.ok === true && f.removed.length === 0);
    expect(again.op === 'member-remove-result' && again.error).toContain('本不在册');
  });
});

describe('018 9b：老 broker（proto:1）降级的协议侧', () => {
  it('connect 携带 caps；info.caps 无 session-members→不发 sessions 帧并留降级日志', async () => {
    // 假老 broker：info 带 caps:[]（老版本恒空数组），connect 一律回 connected
    const frames: Frame[] = [];
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => wss.once('listening', resolve));
    const port = (wss.address() as { port: number }).port;
    wss.on('connection', (ws) => {
      ws.on('message', (data: RawData) => {
        const f = parseFrame(data.toString());
        if (f === undefined) return;
        frames.push(f);
        if (f.op === 'connect') ws.send(encodeFrame({ op: 'connected', machineName: 'old-broker' }));
      });
      ws.send(encodeFrame({ op: 'info', proto: 1, server: 'crosschat/old', caps: [] }));
    });
    const dir = mkdtempSync(join(root, 'oldbk-'));
    const inbox = mkdtempSync(join(root, 'node-'));
    const entry: BrokerEntry = { host: '127.0.0.1', port, key: 'k' };
    const logs: string[] = [];
    const client = new NodeClient({
      config: { entries: [entry] },
      configFile: join(dir, 'node.json'),
      machineId: () => 'NODE-MID',
      statusFile: join(dir, 'status-node.json'),
      fileInbox: new FileInbox({ inboxDir: join(inbox, 'inbox'), partsDir: join(inbox, 'parts') }),
      makeSendDeps: () => fakeDeps().deps,
      now: () => Date.now(),
      log: (l) => logs.push(l),
      backoffBaseMs: 50,
      attachLabel: 't7',
      memberCheckMs: 60_000,
    });
    nodeClients.push(client);
    void client.run();
    await client.waitForState('online');
    const attach = await attachTalk(attachPipePath(entry, dir, 't7'));
    const reply = await attach.send({ op: 'attach', sessionId: 'sess-boss', name: 'boss' });
    expect(reply).toEqual({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const connect = frames.find((f) => f.op === 'connect') as ConnectFrame | undefined;
    expect(connect?.caps).toContain(CAP_SESSION_MEMBERS); // caps 收：connect 声明能力
    expect(frames.some((f) => f.op === 'sessions')).toBe(false); // 老 broker——成员帧不发（发了也被静默丢）
    expect(logs.some((l) => l.includes('已降级机器级'))).toBe(true); // 显性留痕（批二接命令面告警）
    await client.stop();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  }, 10_000);
});
