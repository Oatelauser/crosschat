/**
 * 票012（E1）：远程会话枚举 status --via tcp:<机器>。
 * - broker 路由：转发在线节点（pending id 回程）/ownMid 本地应答/离线 PEER_OFFLINE/超时回 error
 * - 守护应答：payload 分段、codex unavailable 部分应答（扫描注入）
 * - CLI：目标解析（名字/mid8/多星限定器）、空目标 USAGE、渲染分段、过滤套用、--json 结构
 * - 版本偏差：旧 broker 对未知 op 静默无行为 → 请求方超时教学
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { type RawData, WebSocketServer } from 'ws';
import { Broker, type BrokerDeps } from '../src/serve/broker.js';
import { registryFileOf, writeRegistry, type NodeEntry } from '../src/serve/registry.js';
import { NodeClient } from '../src/serve/node.js';
import { FileInbox } from '../src/serve/file-channel.js';
import { runViaTcpStatus } from '../src/serve/via-tcp.js';
import { encodeFrame, parseFrame, type Frame, type StatusPayload } from '../src/serve/protocol.js';
import { parseStatusArgs } from '../src/cli.js';
import { runStatus } from '../src/commands/status.js';
import { MultichatError } from '../src/errors.js';
import type { SendDeps } from '../src/commands/send.js';
import type { CodexThreadWithMeta } from '../src/codex/discovery.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-status-remote-'));
const key = (c: string) => c.repeat(64);
const NODE_MID = `a1b2c3d4${'f'.repeat(56)}`;
const GHOST_MID = `deadbeef${'0'.repeat(56)}`;

const brokers: Broker[] = [];
const wsses: WebSocketServer[] = [];
const sockets: WebSocket[] = [];
const nodes: NodeClient[] = [];
afterEach(async () => {
  for (const n of nodes.splice(0)) await n.stop();
  for (const b of brokers.splice(0)) await b.stop();
  for (const s of sockets.splice(0)) s.close();
  for (const w of wsses.splice(0)) await new Promise<void>((r) => w.close(() => r()));
});

/** 可控扫描源：claude 行数组 + codex 行数组或抛错。 */
interface ScanFake {
  claude: ReturnType<SendDeps['listClaudeSessions']>['sessions'];
  codex: CodexThreadWithMeta[] | Error;
}
function scanDeps(fake: ScanFake): SendDeps {
  return {
    env: {},
    listClaudeSessions: () => ({ sessions: fake.claude, malformed: 0 }),
    listCodexThreads: async () => {
      if (fake.codex instanceof Error) throw fake.codex;
      return fake.codex;
    },
    deliverClaude: async () => ({ status: 'delivered' }),
    deliverCodex: async () => ({ status: 'accepted', turnId: 't' }),
    rateDir: mkdtempSync(join(root, 'rate-')),
    outboxDir: mkdtempSync(join(root, 'outbox-')),
    now: () => Date.now(),
  };
}

const fakeClaudeRow = (name: string | undefined, kind = 'interactive', status = 'idle') => ({
  pid: 4242,
  sessionId: `sess-${name ?? 'x'}`,
  kind,
  status,
  ...(name === undefined ? {} : { name }),
  cwd: 'D:\\ws\\proj',
  messagingSocketPath: 'x',
});
const fakeCodexRow = (name: string | null): CodexThreadWithMeta => ({
  id: `${'ab'.repeat(16)}`,
  name,
  status: 'idle',
  ...(name === null ? {} : { meta: { cwd: '/home/x/proj', createdAt: '2026-10-01T10:00:00.000Z', originator: 'codex cli' } }),
});

interface Harness {
  port: number;
  registryFile: string;
}
async function startBroker(overrides: Partial<BrokerDeps> = {}): Promise<Harness> {
  const dir = mkdtempSync(join(root, 'case-'));
  const registryFile = registryFileOf(dir);
  const seedNodes: Partial<NodeEntry>[] = [
    { label: 'self', key: key('k'), machineId: 'BROKER-MID', machineName: 'broker-host' },
    { label: 'node-1', key: key('n'), machineId: NODE_MID, machineName: 'node-host' },
    { label: 'ghost', key: key('g'), machineId: GHOST_MID, machineName: 'ghost-host' },
  ];
  writeRegistry(registryFile, {
    nodes: seedNodes.map((n, i) => ({
      label: n.label ?? `node-${i}`,
      key: n.key ?? key(`${i}`),
      machineId: n.machineId,
      machineName: n.machineName,
      addedAt: '2026-01-01T00:00:00.000Z',
    })),
  });
  const broker = new Broker({
    registryFile,
    statusFile: join(dir, 'status-broker.json'),
    version: 'test',
    machineId: () => 'BROKER-MID',
    hostname: () => 'broker-host',
    now: () => Date.now(),
    log: () => {},
    deliverLocal: async () => ({ op: 'error', code: 'NOT_READY', message: 'nope' }),
    port: 0,
    heartbeatMs: 10_000,
    pongTimeoutMs: 20_000,
    connectTimeoutMs: 5_000,
    ...overrides,
  });
  brokers.push(broker);
  const port = await broker.start();
  return { port, registryFile };
}

/** 握手完成的裸客户端（sender/node 角色皆可；frames 进缓冲）。 */
class TestClient {
  readonly ws: WebSocket;
  private readonly frames: Frame[] = [];
  private readonly waiters: { pred: (f: Frame) => boolean; resolve: (f: Frame) => void; timer: ReturnType<typeof setTimeout> }[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    sockets.push(this.ws);
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
}

async function senderOn(port: number, auth = key('k')): Promise<TestClient> {
  const client = new TestClient(`ws://127.0.0.1:${port}`);
  await client.opened();
  await client.waitFor((f) => f.op === 'info');
  client.send({ op: 'connect', proto: 1, role: 'sender', auth });
  await client.waitFor((f) => f.op === 'connected');
  return client;
}

/** 上线一个 NodeClient（扫描源注入可控）。 */
async function nodeOnline(port: number, fake: ScanFake): Promise<NodeClient> {
  const dir = mkdtempSync(join(root, 'nodehome-'));
  const client = new NodeClient({
    config: { entries: [{ host: '127.0.0.1', port, key: key('n') }] },
    configFile: join(dir, 'node.json'),
    machineId: () => NODE_MID,
    statusFile: join(dir, 'status-node.json'),
    fileInbox: new FileInbox({ inboxDir: join(dir, 'inbox'), partsDir: join(dir, 'parts') }),
    makeSendDeps: () => scanDeps(fake),
    now: () => Date.now(),
    log: () => {},
    backoffBaseMs: 50,
  });
  nodes.push(client);
  void client.run();
  await client.waitForState('online');
  return client;
}

/** node.json fixture → runViaTcpStatus deps（env 可调超时）。 */
function tcpFixture(port: number, env: Record<string, string | undefined> = {}) {
  const baseDir = mkdtempSync(join(root, 'home-'));
  mkdirSync(join(baseDir, 'tcp'), { recursive: true });
  writeFileSync(join(baseDir, 'tcp', 'node.json'), JSON.stringify({ broker: { host: '127.0.0.1', port } , key: key('k') }));
  return { env, tcpBaseDir: baseDir };
}

async function expectCode(p: Promise<unknown>, code: string): Promise<MultichatError> {
  try {
    await p;
    expect.unreachable(`should have thrown ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(MultichatError);
    expect((err as MultichatError).code).toBe(code);
    return err as MultichatError;
  }
}

describe('broker：status-query 路由', () => {
  it('转发给在线节点，pending id 匹配 status-result 回程（载荷分段）', async () => {
    const h = await startBroker();
    await nodeOnline(h.port, { claude: [fakeClaudeRow('worker')], codex: [fakeCodexRow('helper')] });
    const sender = await senderOn(h.port);
    sender.send({ op: 'status-query', id: 'q1', targetMachine: 'node-host' });
    const frame = await sender.waitFor((f) => f.op === 'status-result' && f.id === 'q1');
    expect(frame.ok).toBe(true);
    const payload = frame.payload!;
    expect(payload.claude).toHaveLength(1);
    expect(payload.claude[0]).toMatchObject({ name: 'worker', kind: 'interactive', status: 'idle', pid: 4242, cwd: 'D:\\ws\\proj' });
    expect(payload.codex).toHaveLength(1);
    expect(payload.codex).toEqual([expect.objectContaining({ name: 'helper', id: 'abababab' })]);
  }, 10_000);

  it('ownMid 目标：broker 本机扫描直接应答（不过节点）', async () => {
    const payload: StatusPayload = { claude: [], codex: { unavailable: 'CODEX_DAEMON_DOWN: nope' } };
    const h = await startBroker({ scanStatus: async () => payload });
    const sender = await senderOn(h.port);
    sender.send({ op: 'status-query', id: 'q2', targetMachine: 'broker-host' });
    const frame = await sender.waitFor((f) => f.op === 'status-result' && f.id === 'q2');
    expect(frame.ok).toBe(true);
    expect(frame.payload).toEqual(payload);
  }, 10_000);

  it('不在线目标回 PEER_OFFLINE 教学（id 随 error 帧带回）', async () => {
    const h = await startBroker();
    const sender = await senderOn(h.port);
    sender.send({ op: 'status-query', id: 'q3', targetMachine: 'ghost-host' });
    const frame = await sender.waitFor((f) => f.op === 'error' && f.id === 'q3');
    expect(frame.code).toBe('PEER_OFFLINE');
    expect(frame.message).toContain('已注册但当前不在线');
  }, 10_000);

  it('节点在线但不应答 → resultTimeoutMs 超时回 error', async () => {
    const h = await startBroker({ resultTimeoutMs: 250 });
    // 哑节点：握手后对 status-query 静默（模拟旧版守护）
    const dumb = new TestClient(`ws://127.0.0.1:${h.port}`);
    await dumb.opened();
    await dumb.waitFor((f) => f.op === 'info');
    dumb.send({ op: 'connect', proto: 1, role: 'node', machineId: NODE_MID, auth: key('n') });
    await dumb.waitFor((f) => f.op === 'connected');
    const sender = await senderOn(h.port);
    sender.send({ op: 'status-query', id: 'q4', targetMachine: 'node-host' });
    const frame = await sender.waitFor((f) => f.op === 'error' && f.id === 'q4');
    expect(frame.code).toBe('PEER_OFFLINE');
    expect(frame.message).toContain('status-result');
  }, 10_000);

  it('codex 扫描挂掉 → payload.codex 降级 unavailable 段（部分应答）', async () => {
    const h = await startBroker();
    await nodeOnline(h.port, {
      claude: [fakeClaudeRow('worker')],
      codex: new MultichatError('CODEX_DAEMON_DOWN', 'daemon 未跑'),
    });
    const sender = await senderOn(h.port);
    sender.send({ op: 'status-query', id: 'q5', targetMachine: 'node-host' });
    const frame = await sender.waitFor((f) => f.op === 'status-result' && f.id === 'q5');
    expect(frame.ok).toBe(true);
    expect(frame.payload!.claude).toHaveLength(1);
    expect(frame.payload!.codex).toEqual({ unavailable: 'CODEX_DAEMON_DOWN: daemon 未跑' });
  }, 10_000);
});

describe('CLI：runViaTcpStatus 传输腿', () => {
  it('端到端：名字/mid8 目标与多星限定器都可寻址', async () => {
    const h = await startBroker();
    await nodeOnline(h.port, { claude: [fakeClaudeRow('worker')], codex: [] });
    const deps = tcpFixture(h.port);
    const byName = await runViaTcpStatus('tcp:node-host', deps);
    expect(byName.target).toBe('node-host');
    expect(byName.payload.claude[0]).toMatchObject({ name: 'worker' });
    const byMid = await runViaTcpStatus(`tcp:${NODE_MID.slice(0, 8)}`, deps);
    expect(byMid.payload.claude).toHaveLength(1);
    // 多星限定器：第一条死端口 + live 命中真 broker
    writeFileSync(
      join(deps.tcpBaseDir!, 'tcp', 'node.json'),
      JSON.stringify({
        brokers: [
          { host: '127.0.0.1', port: 1, name: 'dead', starId: 'dddd00000000', key: key('d') },
          { host: '127.0.0.1', port: h.port, name: 'live', starId: 'aaaa11112222', key: key('k') },
        ],
        showName: 'multi-star',
      }),
    );
    const bySelector = await runViaTcpStatus('tcp:live:node-host', deps);
    expect(bySelector.payload.claude[0]).toMatchObject({ name: 'worker' });
    // 多条目裸 tcp 仍教选择器
    const err = await expectCode(runViaTcpStatus('tcp:node-host', { ...deps, env: {} }), 'USAGE');
    expect(err.message).toContain('--via tcp:dead:');
  }, 10_000);

  it('空目标 → USAGE 教学（同 send 词表）', async () => {
    const err = await expectCode(runViaTcpStatus('tcp:', tcpFixture(1)), 'USAGE');
    expect(err.message).toContain('机器名不能为空');
    expect(err.message).toContain('serve --list');
  });

  it('未知机器 → UNKNOWN_MACHINE + serve --list 提示', async () => {
    const h = await startBroker();
    const err = await expectCode(runViaTcpStatus('tcp:no-such', tcpFixture(h.port)), 'UNKNOWN_MACHINE');
    expect(err.message).toContain('[via tcp:no-such]');
    expect(err.message).toContain('serve --list');
  }, 10_000);

  it('版本偏差：旧 broker 对 status-query 无行为 → 超时教学', async () => {
    // 哑 broker：只完成握手（info/connected），对 status-query 静默——旧版行为
    const wss = new WebSocketServer({ port: 0 });
    wsses.push(wss);
    await new Promise<void>((r) => wss.once('listening', r));
    wss.on('connection', (ws) => {
      ws.send(encodeFrame({ op: 'info', proto: 1, server: 'crosschat/old', caps: [] }));
      ws.on('message', (data: RawData) => {
        const frame = parseFrame(data.toString());
        if (frame?.op === 'connect') ws.send(encodeFrame({ op: 'connected' }));
      });
    });
    const port = (wss.address() as { port: number }).port;
    const err = await expectCode(
      runViaTcpStatus('tcp:anywhere', tcpFixture(port, { CROSSCHAT_TCP_TIMEOUT_MS: '400' })),
      'TCP_TRANSPORT_FAILED',
    );
    expect(err.message).toContain('对端未应答');
    expect(err.message).toContain('节点客户端在跑吗');
    expect(err.message).toContain('升级');
  }, 10_000);
});

describe('CLI：parseStatusArgs 与远程视图渲染', () => {
  it('--via tcp:<机器> 进 viaTarget；组合约束与 ssh: 拒绝', () => {
    expect(parseStatusArgs(['--via', 'tcp:cloud'])).toMatchObject({ viaTarget: 'tcp:cloud', conversations: false });
    expect(parseStatusArgs(['--via=tcp:cloud:win1'])).toMatchObject({ viaTarget: 'tcp:cloud:win1' });
    // 既有语义不动：裸 tcp/ssh 仍只与 --conversations 组合
    expect(parseStatusArgs(['--conversations', '--via', 'tcp'])).toMatchObject({ conversations: true, filters: { via: 'tcp' } });
    expect(() => parseStatusArgs(['--via', 'tcp'])).toThrowError(MultichatError);
    expect(() => parseStatusArgs(['--via', 'tcp:cloud', '--conversations'])).toThrowError(/不与 --conversations 组合/);
    expect(() => parseStatusArgs(['--via', 'ssh:peer'])).toThrowError(/ssh <对端> crosschat status/);
    expect(() => parseStatusArgs(['--via', 'wat'])).toThrowError(/只接受 tcp、ssh 或 tcp:<机器>/);
    // 远程枚举与过滤参数自然组合
    expect(parseStatusArgs(['--via', 'tcp:cloud', '--claude', '--name', 'w'])).toMatchObject({
      viaTarget: 'tcp:cloud',
      filters: { section: 'claude', name: 'w' },
    });
  });

  const payload: StatusPayload = {
    claude: [
      { name: 'worker', kind: 'interactive', status: 'idle', pid: 123, cwd: 'D:\\ws\\a' },
      { name: null, kind: 'headless', status: 'busy', pid: 456, cwd: null },
    ],
    codex: [
      { name: 'helper', status: 'idle', id: 'abcd1234', cwd: '/home/x', createdAt: '2026-10-01T10:00:00.000Z', originator: 'codex cli' },
      { name: null, status: 'idle', id: 'ffff0000', cwd: null, createdAt: null, originator: null },
    ],
  };
  const remoteDeps = (p: StatusPayload = payload) => ({
    listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
    listCodexThreads: async () => [],
    fetchRemoteStatus: async () => ({ target: 'cloud', payload: p }),
  });

  it('主视图渲染：<机器> 机会话: 标题 + 分段同构 + codex unavailable', async () => {
    const out = await runStatus(remoteDeps(), false, false, {}, 'tcp:cloud');
    expect(out.split('\n')[0]).toBe('cloud 机会话:');
    expect(out).toContain('claude:');
    const claudeLine = out.split('\n').find((l) => l.includes('worker'))!;
    expect(claudeLine.replace(/\s+/g, ' ').trim()).toBe('worker interactive idle pid 123 ws\\a');
    expect(out).toContain('codex:');
    expect(out).toContain('helper');
    expect(out).toContain('abcd1234');
    expect(out).not.toContain('(unnamed)'); // 未命名默认隐藏（含 claude 与 codex 两段）
    const down: StatusPayload = { claude: [], codex: { unavailable: 'CODEX_DAEMON_DOWN: daemon 未跑' } };
    const out2 = await runStatus(remoteDeps(down), false, false, {}, 'tcp:cloud');
    expect(out2).toContain('unavailable (CODEX_DAEMON_DOWN: daemon 未跑)');
    expect(out2).toContain('  (none)'); // claude 段空
  });

  it('过滤参数本地套用：--name 滤行、--claude 选段、--all 带出未命名', async () => {
    const byName = await runStatus(remoteDeps(), false, false, { name: 'work' }, 'tcp:cloud');
    expect(byName).toContain('worker');
    expect(byName).not.toContain('helper');
    const claudeOnly = await runStatus(remoteDeps(), false, false, { section: 'claude' }, 'tcp:cloud');
    expect(claudeOnly).not.toContain('codex:');
    const withAll = await runStatus(remoteDeps(), false, false, { all: true }, 'tcp:cloud');
    expect(withAll.match(/\(unnamed\)/g)).toHaveLength(2);
  });

  it('--json：{via, machine, claude, codex} 结构，选段省键、--name 滤行', async () => {
    const parsed = JSON.parse(await runStatus(remoteDeps(), true, false, {}, 'tcp:cloud')) as Record<string, unknown>;
    expect(parsed).toMatchObject({ via: 'tcp:cloud', machine: 'cloud' });
    expect(parsed.claude).toHaveLength(2); // json 契约：未命名行始终在场
    expect(parsed.codex).toHaveLength(2);
    const filtered = JSON.parse(await runStatus(remoteDeps(), true, false, { section: 'codex', name: 'help' }, 'tcp:cloud')) as Record<string, unknown>;
    expect(filtered.claude).toBeUndefined();
    expect(filtered.codex).toHaveLength(1);
    const down = JSON.parse(
      await runStatus(remoteDeps({ claude: [], codex: { unavailable: 'X: y' } }), true, false, {}, 'tcp:cloud'),
    ) as Record<string, unknown>;
    expect(down.codex).toEqual({ unavailable: 'X: y' });
  });

  it('fetchRemoteStatus 未接线 → 教学报错', async () => {
    const err = await expectCode(
      runStatus({ listClaudeSessions: () => ({ sessions: [], malformed: 0 }), listCodexThreads: async () => [] }, false, false, {}, 'tcp:cloud'),
      'USAGE',
    );
    expect(err.message).toContain('node.json');
  });
});
