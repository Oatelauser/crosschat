/**
 * 018 批二：命令面与链路——启动器旗标/自动拉聚合器/attach 重试/退出 detach、
 * extends 四级校验三分支、members-query 恢复（验活过滤死名）、adopt 全错误
 * 路径与幂等、status 星会话视图与诊断行、9b 命令面告警、改名跟随。
 * 夹具真实平台形状：win 带杠 MachineGuid、linux 32-hex（F0 归一互认）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import WebSocket, { type RawData, WebSocketServer } from 'ws';
import { Broker } from '../src/serve/broker.js';
import { CAP_SESSION_MEMBERS, encodeFrame, parseFrame, type Frame } from '../src/serve/protocol.js';
import { registryFileOf, writeRegistry, type NodeEntry } from '../src/serve/registry.js';
import { NodeClient, attachPipePath, type BrokerEntry } from '../src/serve/node.js';
import { FileInbox } from '../src/serve/file-channel.js';
import { fetchRosterFor } from '../src/serve/via-tcp.js';
import type { SendDeps } from '../src/commands/send.js';
import {
  checkExtendSession,
  connectAttachPipe,
  hasLocalNameHistory,
  runAdopt,
  StarJoiner,
  splitStarLauncherArgs,
  warnIfBrokerLacksSessionCaps,
  type StarJoinDeps,
} from '../src/commands/session-star.js';
import { parseServeArgs, parseStatusArgs } from '../src/cli.js';
import { runServe } from '../src/commands/serve.js';
import { runSend } from '../src/commands/send.js';
import { runStatus, type StatusDeps } from '../src/commands/status.js';
import { MultichatError } from '../src/errors.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-session-star-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// 真实平台形状：Windows MachineGuid 带杠 UUID / Linux /etc/machine-id 32-hex
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
}

async function startBroker(): Promise<Harness> {
  const dir = mkdtempSync(join(root, 'case-'));
  const registryFile = registryFileOf(dir);
  const broker = new Broker({
    registryFile,
    statusFile: join(dir, 'status-broker.json'),
    version: '1.6.0-test',
    machineId: () => 'BROKER-MID',
    hostname: () => 'broker-host',
    now: () => Date.now(),
    log: () => {},
    deliverLocal: async () => ({ op: 'error', code: 'NOT_READY', message: 'nope' }),
    port: 0,
    ...slowHeartbeat,
  });
  brokers.push(broker);
  const port = await broker.start();
  return { url: `ws://127.0.0.1:${port}`, registryFile, broker };
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

async function senderOn(url: string, auth: string): Promise<TestClient> {
  const client = new TestClient(url);
  await client.opened();
  await client.waitFor((f) => f.op === 'info');
  client.send({ op: 'connect', proto: 1, role: 'sender', auth });
  await client.waitFor((f) => f.op === 'connected');
  return client;
}

/** 可变扫描夹具：launcher/聚合器两侧共用一份数据，翻转即模拟 spawn//rename。 */
interface ScanState {
  claude: Array<{ sessionId: string; name?: string; updatedAt?: number }>;
  codex: Array<{ id: string; name: string | null }>;
  delivered: string[];
}

function scanDeps(state: ScanState): SendDeps {
  return {
    env: {},
    listClaudeSessions: () => ({
      sessions: state.claude.map((s, i) => ({
        pid: 100 + i,
        sessionId: s.sessionId,
        kind: 'interactive',
        ...(s.name === undefined ? {} : { name: s.name }),
        status: 'idle',
        messagingSocketPath: 'x',
        ...(s.updatedAt === undefined ? {} : { updatedAt: s.updatedAt }),
      })),
      malformed: 0,
    }),
    listCodexThreads: async () => state.codex.map((t) => ({ id: t.id, name: t.name, status: 'idle' as const })),
    deliverClaude: async (_t, content) => {
      state.delivered.push(content);
      return { status: 'delivered' };
    },
    deliverCodex: async () => ({ status: 'accepted', turnId: 't' }),
    sendLogFile: join(mkdtempSync(join(root, 'ratelog-')), 'send-log.jsonl'),
    outboxDir: mkdtempSync(join(root, 'outbox-')),
    now: () => Date.now(),
    hostname: () => 'node-host',
    machineId: () => 'NODE-MID',
  };
}

/** 一颗星的全套夹具：broker + 可按需拉起的聚合器（spawnServeDetach 里启动）。 */
interface StarHarness {
  harness: Harness;
  starName: string;
  baseDir: string;
  entry: BrokerEntry;
  state: ScanState;
  spawnedSelectors: string[];
  aggregator(): Promise<NodeClient>;
}

async function startStarStar(
  label: string,
  opts: { mid?: string; machineName?: string; memberCheckMs?: number; baseDir?: string } = {},
): Promise<StarHarness> {
  const harness = await startBroker();
  const mid = opts.mid ?? 'NODE-MID';
  seed(harness.registryFile, [
    { key: key('s'), machineName: 'sender-host' },
    { key: key('n'), machineId: mid, machineName: opts.machineName ?? 'node-host' },
  ]);
  const baseDir = opts.baseDir ?? mkdtempSync(join(root, `base-${label}-`));
  const entry: BrokerEntry = { host: '127.0.0.1', port: Number(new URL(harness.url).port), name: label, key: key('n') };
  mkdirSync(join(baseDir, 'tcp'), { recursive: true });
  writeFileSync(
    join(baseDir, 'tcp', 'node.json'),
    `${JSON.stringify({ brokers: [entry], showName: opts.machineName ?? 'node-host' }, null, 2)}\n`,
    'utf8',
  );
  const state: ScanState = { claude: [], codex: [], delivered: [] };
  // codex 活性夹具：CODEX_THREAD 的假 rollout（CI 无 ~/.codex，活性核验必须可离线命中——
  // 否则成员首轮 tick 即被除名，名字回填永不发生；与 serve-sessions.test.ts 9a 同款）
  const codexHome = mkdtempSync(join(root, `codexhome-${label}-`));
  const rolloutDir = join(codexHome, 'sessions', '2026', '09', '01');
  mkdirSync(rolloutDir, { recursive: true });
  writeFileSync(
    join(rolloutDir, `rollout-2026-09-01T14-47-09-${CODEX_THREAD}.jsonl`),
    `${JSON.stringify({ type: 'session_meta', payload: { session_id: CODEX_THREAD, cwd: '/tmp', originator: 'codex-tui', timestamp: '2026-09-01T14:47:09.000Z' } })}\n`,
    'utf8',
  );
  const sh: StarHarness = {
    harness,
    starName: label,
    baseDir,
    entry,
    state,
    spawnedSelectors: [],
    aggregator: () => Promise.reject(new Error('not wired')),
  };
  // 每次调用都起一个新聚合器实例（模拟重启换进程；旧实例由 afterEach 统一收）
  sh.aggregator = (): Promise<NodeClient> =>
    new Promise<NodeClient>((resolve, reject) => {
      const client = new NodeClient({
        config: { entries: [entry] },
        configFile: join(baseDir, 'tcp', 'node.json'),
        machineId: () => mid,
        statusFile: join(baseDir, 'tcp', `status-node-${label}.json`),
        fileInbox: new FileInbox({ inboxDir: join(baseDir, 'inbox'), partsDir: join(baseDir, 'parts') }),
        makeSendDeps: () => scanDeps(state),
        now: () => Date.now(),
        log: (l) => {
          if (process.env.CC_DBG === '1') console.error(`[agg ${label}] ${l}`);
        },
        backoffBaseMs: 50,
        memberCheckMs: opts.memberCheckMs ?? 60_000,
        codexHome,
      });
      nodeClients.push(client);
      void client.run().catch(() => {});
      void client.waitForState('online').then(() => resolve(client), reject);
    });
  return sh;
}

function starJoinDeps(sh: StarHarness, overrides: Partial<StarJoinDeps> = {}): StarJoinDeps {
  const deps: StarJoinDeps = {
    tcpBaseDir: sh.baseDir,
    stdout: () => {},
    stderr: () => {},
    log: () => {},
    listClaudeSessions: () => {
      const d = scanDeps(sh.state);
      return d.listClaudeSessions();
    },
    listCodexThreads: async () => sh.state.codex.map((t) => ({ id: t.id, name: t.name, createdAt: undefined })),
    spawnServeDetach: (selector) => {
      sh.spawnedSelectors.push(selector);
      void sh.aggregator();
    },
    machineName: 'node-host',
    now: () => Date.now(),
    aggregatorTimeoutMs: 8_000,
    ...overrides,
  };
  return deps;
}

// ---- 旗标解析 ---------------------------------------------------------------------

describe('018 批二：启动器旗标解析', () => {
  it('只认死自家旗标：--connect 可重复/--extend-session 剥离，-n 等 claude/codex 原生参数原样透传', () => {
    const flags = splitStarLauncherArgs([
      '-n', 'boss', '--connect', 'sl-a', '--model', 'sonnet', '--connect=sl-b', '--extend-session', 'old',
    ]);
    expect(flags.connects).toEqual(['sl-a', 'sl-b']);
    expect(flags.extendSession).toBe('old');
    expect(flags.passthrough).toEqual(['-n', 'boss', '--model', 'sonnet']);
  });

  it('裸 --connect=默认腿；-n 透传不受影响', () => {
    const flags = splitStarLauncherArgs(['-n', 'x', '--connect', '--extend-session', 'old']);
    expect(flags.connects).toEqual(['']);
    expect(flags.passthrough).toEqual(['-n', 'x']);
  });

  it('旧名禁冒号；--connect 缺值拒绝', () => {
    expect(() => splitStarLauncherArgs(['--extend-session', 'x:y'])).toThrow(MultichatError);
    expect(() => splitStarLauncherArgs(['--extend-session'])).toThrow(MultichatError);
    expect(() => splitStarLauncherArgs(['--connect'])).not.toThrow(); // 裸 --connect 合法
  });

  it('serve 解析：--adopt/--extend-session 值旗标；--adopt 无 --connect 即拒', async () => {
    const args = parseServeArgs(['--connect', 'sl-a', '--adopt', 'boss', '--extend-session', 'old']);
    expect(args.connect).toBe('sl-a');
    expect(args.adopt).toBe('boss');
    expect(args.extendSession).toBe('old');
    await expect(
      runServe({ adopt: 'boss' }, {
        baseDir: mkdtempSync(join(root, 'srv-')),
        stdout: () => {},
        env: {},
        version: 't',
        machineId: () => 'm',
        hostname: () => 'h',
        networkInterfaces: () => ({}),
        now: () => 0,
        onSignal: () => {},
      }),
    ).rejects.toThrow('--adopt 与 --connect');
  });
});

// ---- 启动器链路 ---------------------------------------------------------------------

describe('018 批二：启动器入星链路', () => {
  it(
    'spawn 会话→自动拉聚合器→attach→三段直达；退出即 detach',
    async () => {
      const sh = await startStarStar('sl-l1');
      sh.state.claude = [{ sessionId: 'sess-existing', name: 'old', updatedAt: 1 }];
      const out: string[] = [];
      const err: string[] = [];
      const logs: string[] = [];
      const joiner = new StarJoiner({
        deps: starJoinDeps(sh, { stdout: (l) => out.push(l), stderr: (l) => err.push(l), log: (l) => logs.push(l) }),
        side: 'claude',
        connects: ['sl-l1'],
        spawnName: 'boss',
      });
      await joiner.begin();
      // 021 时序：横幅在 begin()（=spawn 前）即打印——报地址不预支"已入星"
      expect(out).toEqual(['入星 sl-l1——会话地址 tcp:sl-l1:node-host:boss（attach 自动，异常见日志）']);
      // 模拟子进程 spawn 出新会话（快照差分命中 sess-child）
      sh.state.claude = [
        { sessionId: 'sess-existing', name: 'old', updatedAt: 1 },
        { sessionId: 'sess-child', name: 'boss', updatedAt: 99 },
      ];
      const sender = await senderOn(sh.harness.url, key('s'));
      const deliver = async (id: string, target: string): Promise<Frame> => {
        sender.send({ op: 'send', id, targetMachine: target, body: 'hi' });
        return sender.waitFor((f) => (f.op === 'receipt' || f.op === 'error') && f.id === id);
      };
      // attach 完成（自动拉起聚合器→管道→attach→重播）：三段直达命中
      for (let i = 0; i < 50; i++) {
        const r = await deliver(`w${i}`, 'node-host:boss');
        if (r.op === 'receipt' && r.status === 'delivered') break;
        if (i === 49) throw new Error('attach 未生效（三段直达一直失败）');
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      expect(sh.spawnedSelectors).toEqual(['sl-l1']); // 聚合器不在→自动 serve --connect --detach
      // 021：attach 确认落日志；spawn 后成功路径控制台零输出
      expect(logs.some((l) => l.includes('已入星 sl-l1') && l.includes('tcp:sl-l1:node-host:boss'))).toBe(true);
      expect(out).toHaveLength(1);
      expect(err).toHaveLength(0);
      expect(sh.state.delivered.length).toBeGreaterThan(0);
      // 子进程退出 → detach（无 erase）→ 册位保留转下线（028 默认=永久注册）
      await joiner.stop();
      let gone: Frame | undefined;
      for (let i = 0; i < 30; i++) {
        const r = await deliver(`wx${i}`, 'node-host:boss');
        if (r.op === 'error' && r.code === 'SESSION_OFFLINE') {
          gone = r;
          break;
        }
      }
      expect(gone).toMatchObject({ op: 'error', code: 'SESSION_OFFLINE' });
    },
    20_000,
  );

  it(
    '多星：--connect 可重复，两会话成员表各自 attach（win 带杠 mid 形态）',
    async () => {
      const shA = await startStarStar('sl-ma', { mid: WIN_MID, machineName: 'win-box' });
      const shB = await startStarStar('sl-mb', { mid: WIN_MID, machineName: 'win-box', baseDir: shA.baseDir });
      // 一份 node.json 两星条目（真实多星形态；两聚合器同源状态目录）
      writeFileSync(
        join(shA.baseDir, 'tcp', 'node.json'),
        `${JSON.stringify({ brokers: [shA.entry, shB.entry], showName: 'win-box' }, null, 2)}\n`,
        'utf8',
      );
      const deps: StarJoinDeps = {
        tcpBaseDir: shA.baseDir,
        stdout: () => {},
        stderr: () => {},
        log: () => {},
        listClaudeSessions: () => scanDeps(shA.state).listClaudeSessions(),
        listCodexThreads: async () => [],
        spawnServeDetach: (selector) => {
          (selector === 'sl-ma' ? shA : shB).spawnedSelectors.push(selector);
          void (selector === 'sl-ma' ? shA : shB).aggregator();
        },
        machineName: 'win-box',
        now: () => Date.now(),
        aggregatorTimeoutMs: 8_000,
      };
      // 基线=旧会话；spawn 后新会话 sess-multi 出现（夹具曾把两者写反，靠旗标强塞名侥幸过——现按差分语义修正）
      shA.state.claude = [{ sessionId: 'sess-base', name: 'x', updatedAt: 1 }];
      const joiner = new StarJoiner({ deps, side: 'claude', connects: ['sl-ma', 'sl-mb'] });
      await joiner.begin();
      shA.state.claude = [
        { sessionId: 'sess-base', name: 'x', updatedAt: 1 },
        { sessionId: 'sess-multi', name: 'boss', updatedAt: 99 },
      ];
      shB.state.claude = shA.state.claude; // 同一物理机的同一份扫描（两星夹具共享视图）
      const probe = async (sh: StarHarness, id: string): Promise<Frame> => {
        const sender = await senderOn(sh.harness.url, key('s'));
        sender.send({ op: 'send', id, targetMachine: 'win-box:boss', body: 'x' });
        return sender.waitFor((f) => (f.op === 'receipt' || f.op === 'error') && f.id === id);
      };
      let okA: Frame | undefined;
      let okB: Frame | undefined;
      for (let i = 0; i < 50; i++) {
        if (okA === undefined) {
          const r = await probe(shA, `ma${i}`);
          if (r.op === 'receipt' && r.status === 'delivered') okA = r;
        }
        if (okB === undefined) {
          const r = await probe(shB, `mb${i}`);
          if (r.op === 'receipt' && r.status === 'delivered') okB = r;
        }
        if (okA !== undefined && okB !== undefined) break;
        if (i === 49) throw new Error('双星 attach 未全部生效');
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      await joiner.stop();
    },
    25_000,
  );

  it(
    '021 断连静默：聚合器被杀→重连提示落日志、控制台零输出、成员籍自动恢复',
    async () => {
      const sh = await startStarStar('sl-q1');
      sh.state.claude = [{ sessionId: 'sess-base', name: 'old', updatedAt: 1 }];
      const agg = await sh.aggregator(); // 预起聚合器：ensureAggregator 直连管道，且握有可停实例
      const out: string[] = [];
      const err: string[] = [];
      const logs: string[] = [];
      const joiner = new StarJoiner({
        deps: starJoinDeps(sh, { stdout: (l) => out.push(l), stderr: (l) => err.push(l), log: (l) => logs.push(l) }),
        side: 'claude',
        connects: ['sl-q1'],
      });
      await joiner.begin();
      expect(out).toEqual(['入星 sl-q1（attach 自动，异常见日志）']); // 无 -n：spawn 前只打星名行
      sh.state.claude = [
        { sessionId: 'sess-base', name: 'old', updatedAt: 1 },
        { sessionId: 'sess-kid', name: 'boss', updatedAt: 99 },
      ];
      const sender = await senderOn(sh.harness.url, key('s'));
      const deliver = async (id: string): Promise<Frame> => {
        sender.send({ op: 'send', id, targetMachine: 'node-host:boss', body: 'x' });
        return sender.waitFor((f) => (f.op === 'receipt' || f.op === 'error') && f.id === id);
      };
      let attached = false;
      for (let i = 0; i < 50; i++) {
        const r = await deliver(`q${i}`);
        if (r.op === 'receipt' && r.status === 'delivered') {
          attached = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      expect(attached).toBe(true);
      expect(logs.some((l) => l.includes('已入星 sl-q1'))).toBe(true);
      const outLen = out.length;
      const errLen = err.length;
      const logsLen = logs.length;
      // 杀聚合器：管道断——提示落日志（控制台零输出），重连自动恢复成员籍
      await agg.stop();
      let reconnected = false;
      for (let i = 0; i < 80; i++) {
        const r = await deliver(`r${i}`);
        if (r.op === 'receipt' && r.status === 'delivered') {
          reconnected = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      expect(reconnected).toBe(true);
      expect(logs.slice(logsLen).some((l) => l.includes('聚合器连接断开，重连中'))).toBe(true);
      expect(out).toHaveLength(outLen); // 全程控制台零新增
      expect(err).toHaveLength(errLen);
      // 等启动器自身重声明落定（第二行"已入星"）再收线——stop() 与重连窗口撞车会让
      // waitClose 永等（既有潜伏竞态，021 不动收线逻辑，票外另修）
      for (let i = 0; i < 50; i++) {
        if (logs.slice(logsLen).some((l) => l.includes('已入星 sl-q1'))) break;
        if (i === 49) throw new Error('重连后未重新 attach');
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      await joiner.stop();
    },
    40_000,
  );

  it(
    '023 stop 落重连窗口：waitClose 与 stop 信号 race，限时返回不挂起',
    async () => {
      const sh = await startStarStar('sl-r2');
      sh.state.claude = [{ sessionId: 'sess-base', name: 'old', updatedAt: 1 }];
      const agg = await sh.aggregator(); // 预起聚合器：握有可停实例
      const joiner = new StarJoiner({
        deps: starJoinDeps(sh),
        side: 'claude',
        connects: ['sl-r2'],
      });
      await joiner.begin();
      sh.state.claude = [
        { sessionId: 'sess-base', name: 'old', updatedAt: 1 },
        { sessionId: 'sess-kid', name: 'boss', updatedAt: 99 },
      ];
      const sender = await senderOn(sh.harness.url, key('s'));
      const deliver = async (id: string): Promise<Frame> => {
        sender.send({ op: 'send', id, targetMachine: 'node-host:boss', body: 'x' });
        return sender.waitFor((f) => (f.op === 'receipt' || f.op === 'error') && f.id === id);
      };
      let attached = false;
      for (let i = 0; i < 50; i++) {
        const r = await deliver(`w${i}`);
        if (r.op === 'receipt' && r.status === 'delivered') {
          attached = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      expect(attached).toBe(true);
      // 杀聚合器 → superviseStar 进重连窗口；工装 spawnServeDetach 会拉回聚合器、
      // 修复前 stop() 此刻调用会在新健康管道的 waitClose 上永等（启动器退出挂起）
      await agg.stop();
      const stopped = joiner.stop();
      await Promise.race([
        stopped,
        new Promise((_, reject) => setTimeout(() => reject(new Error('stop() 在重连窗口挂起')), 5_000)),
      ]);
      await stopped;
    },
    30_000,
  );
});

// ---- extends 四级校验三分支 -----------------------------------------------------------

describe('018 批二：三段寻址命令面（send --via tcp:<星>:<机器>:<会话> 免 --to）', () => {
  it(
    'CLI 三段直达：入星成员按会话名投递成功；非成员名报 SESSION_NOT_MEMBER 教学',
    async () => {
      const sh = await startStarStar('sl-t3');
      sh.state.claude = [{ sessionId: 'sess-boss', name: 'boss' }];
      await sh.aggregator();
      const pipe = await connectAttachPipe(attachPipePath(sh.entry, join(sh.baseDir, 'tcp')), 30, 200);
      expect((await pipe.send({ op: 'attach', sessionId: 'sess-boss', name: 'boss' })).ok).toBe(true);
      // 等成员表上行后再走真实 CLI 命令面
      let out = '';
      for (let i = 0; i < 40; i++) {
        try {
          out = await runSend(
            { via: 'tcp:sl-t3:node-host:boss', bodyArg: '三段直达', json: true },
            { ...scanDeps(sh.state), tcpBaseDir: sh.baseDir, sshConfigText: () => undefined },
          );
          break;
        } catch (err) {
          if (i === 39) throw err;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
      expect(out).toContain('"status":"delivered"');
      expect(sh.state.delivered.some((c) => c.includes('三段直达'))).toBe(true);
      // 非成员名：三段报 SESSION_NOT_MEMBER（教学指向启动器入星）
      await expect(
        runSend(
          { via: 'tcp:sl-t3:node-host:ghost', bodyArg: 'x', json: true },
          { ...scanDeps(sh.state), tcpBaseDir: sh.baseDir, sshConfigText: () => undefined },
        ),
      ).rejects.toThrow('不是星成员');
      await pipe.close();
    },
    15_000,
  );
});

// ---- extends 四级校验三分支 -----------------------------------------------------------

describe('018 批二：extends 四级校验', () => {
  it(
    '分支一：旧名仍是星内活成员 → 拒绝并教学（不锁死：指明出路）',
    async () => {
      const sh = await startStarStar('sl-e1');
      await sh.aggregator();
      const conn = await connectAttachPipe(attachPipePath(sh.entry, join(sh.baseDir, 'tcp')), 30, 200);
      try {
        const reply = await conn.send({ op: 'attach', sessionId: 'sess-old', name: 'old' });
        expect(reply.ok).toBe(true);
        // 等成员表上行（attach→sessions 帧→broker 聚合进 roster）
        for (let i = 0; i < 40; i++) {
          const roster = await fetchRosterFor(sh.baseDir, sh.entry);
          if (roster?.some((m) => m.sessions?.some((s) => s.name === 'old'))) break;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        await expect(checkExtendSession({ tcpBaseDir: sh.baseDir }, 'old', sh.entry)).rejects.toThrow('活成员');
      } finally {
        conn.close();
      }
    },
    15_000,
  );

  it('分支二：本机对话分片有该名对话史（send-log 落盘证据）→ 放行并出声', async () => {
    const sh = await startStarStar('sl-e2');
    await sh.aggregator(); // 无 'old' 成员
    const sendLogFile = join(sh.baseDir, 'send-log.jsonl');
    writeFileSync(
      sendLogFile,
      [
        `${JSON.stringify({ ts: '2026-10-15T00:00:00.000Z', from: 'claude:x', to: 'old@node-host(a1b2c3d4)', target: 'via:tcp:node-host', status: 'delivered' })}\n`,
        `${JSON.stringify({ ts: '2026-10-15T00:00:01.000Z', from: 'claude:x', to: 'other@node-host', target: 'claude:y', status: 'delivered' })}\n`,
      ].join(''),
      'utf8',
    );
    const verdict = await checkExtendSession({ tcpBaseDir: sh.baseDir, sendLogFile }, 'old', sh.entry);
    expect(verdict).toBe('log');
    expect(hasLocalNameHistory('other', sendLogFile)).toBe(false); // 无跨星痕迹的名字不作证据
  });

  it('分支三：都无 → 静默放行（无人查询的名字）', async () => {
    const sh = await startStarStar('sl-e3');
    await sh.aggregator();
    const verdict = await checkExtendSession({ tcpBaseDir: sh.baseDir, sendLogFile: join(sh.baseDir, 'none.jsonl') }, 'ghost', sh.entry);
    expect(verdict).toBe('none');
  });
});

// ---- members-query 恢复链 -----------------------------------------------------------

describe('018/028 恢复链常态化（孤儿找回/死转下线/册落盘不丢）', () => {
  it(
    '聚合器重启：册切片对账→活的重入册复活、死的转下线册位保留（linux 32-hex 形态）',
    async () => {
      const sh = await startStarStar('sl-r1', { mid: LINUX_MID, machineName: 'lin-box' });
      sh.state.claude = [
        { sessionId: 'sess-boss', name: 'boss' },
        { sessionId: 'sess-gone', name: 'gone' },
      ];
      const aggA = await sh.aggregator();
      const pipe = await connectAttachPipe(attachPipePath(sh.entry, join(sh.baseDir, 'tcp')), 30, 200);
      expect((await pipe.send({ op: 'attach', sessionId: 'sess-boss', name: 'boss' })).ok).toBe(true);
      expect((await pipe.send({ op: 'attach', sessionId: 'sess-gone', name: 'gone' })).ok).toBe(true);
      const sender = await senderOn(sh.harness.url, key('s'));
      const send3 = async (id: string, target: string): Promise<Frame> => {
        sender.send({ op: 'send', id, targetMachine: target, body: 'x' });
        return sender.waitFor((f) => (f.op === 'receipt' || f.op === 'error') && f.id === id);
      };
      expect((await send3('r1', 'lin-box:boss')).op).toBe('receipt'); // 成员在册
      // 聚合器重启（启动器若在会自动重 attach；这里模拟无启动器=孤儿）
      await aggA.stop();
      await pipe.close();
      // 重启前 boss 的 claude 会话还活着；gone 的进程已死（扫描移除）
      sh.state.claude = [{ sessionId: 'sess-boss', name: 'boss' }];
      const aggB = await sh.aggregator();
      await aggB.waitForState('online');
      // 028 常驻对账：boss 验活复活（无需重新声明）；gone 死名转下线（册位保留）
      let bossOk = false;
      for (let i = 0; i < 40; i++) {
        const r = await send3(`rb${i}`, 'lin-box:boss');
        if (r.op === 'receipt' && r.status === 'delivered') {
          bossOk = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      expect(bossOk).toBe(true);
      const gone = await send3('r2', 'lin-box:gone');
      expect(gone).toMatchObject({ op: 'error', code: 'SESSION_OFFLINE' }); // 不再除名——下线等复活
    },
    20_000,
  );

  it(
    '028 broker 重启册不丢（roster 落盘）：成员自动复活；册外活会话走 adopt 收编',
    async () => {
      const sh = await startStarStar('sl-r2');
      sh.state.claude = [{ sessionId: 'sess-boss', name: 'boss' }];
      const aggA = await sh.aggregator();
      const pipe = await connectAttachPipe(attachPipePath(sh.entry, join(sh.baseDir, 'tcp')), 30, 200);
      expect((await pipe.send({ op: 'attach', sessionId: 'sess-boss', name: 'boss' })).ok).toBe(true);
      await aggA.stop();
      await pipe.close();
      // broker 重启——roster.json 落盘（018 双失忆边角由册根治）
      const port = Number(new URL(sh.harness.url).port);
      await sh.harness.broker.stop();
      const broker2 = new Broker({
        registryFile: sh.harness.registryFile,
        statusFile: join(root, 'status-broker2.json'),
        version: 't',
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
      // 新聚合器对账：boss 本地活 → 册内条目自动复活（无需 adopt/重新声明）
      const aggC = await sh.aggregator();
      await aggC.waitForState('online');
      const sender = await senderOn(`ws://127.0.0.1:${port}`, key('s'));
      let revived = false;
      for (let i = 0; i < 40; i++) {
        sender.send({ op: 'send', id: `am1${i}`, targetMachine: 'node-host:boss', body: 'x' });
        const r = await sender.waitFor((f) => (f.op === 'error' || f.op === 'receipt') && f.id === `am1${i}`);
        if (r.op === 'receipt' && r.status === 'delivered') {
          revived = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      expect(revived).toBe(true); // broker 重启后册仍在——同 id 自动复活
      // 册外活进程（从未入册）仍走 adopt 收编
      sh.state.claude = [
        { sessionId: 'sess-boss', name: 'boss' },
        { sessionId: 'sess-orphan', name: 'orphan', updatedAt: 99 },
      ];
      const out: string[] = [];
      const rc = await runAdopt(
        { connect: 'sl-r2', adopt: 'orphan' },
        starJoinDeps(sh, { stdout: (l) => out.push(l), stderr: (l) => out.push(l) }),
      );
      expect(rc).toBe(0);
      expect(out.some((l) => l.includes('已收编 orphan'))).toBe(true);
      sender.send({ op: 'send', id: 'am2', targetMachine: 'node-host:orphan', body: 'back' });
      const back = await sender.waitFor((f) => f.op === 'receipt' && f.id === 'am2');
      expect(back).toMatchObject({ status: 'delivered' });
      // 幂等：再次 adopt → 提示已是成员
      const out2: string[] = [];
      const rc2 = await runAdopt({ connect: 'sl-r2', adopt: 'orphan' }, starJoinDeps(sh, { stdout: (l) => out2.push(l), stderr: (l) => out2.push(l) }));
      expect(rc2).toBe(0);
      expect(out2.some((l) => l.includes('已是星 sl-r2 成员'))).toBe(true);
    },
    25_000,
  );
});

// ---- adopt 错误路径 -------------------------------------------------------------------

describe('018 批二：adopt 错误路径', () => {
  it(
    'UNKNOWN→候选 did-you-mean；双活→NAME_COLLISION；--extend-session 血统入册',
    async () => {
      const sh = await startStarStar('sl-a1');
      await sh.aggregator();
      const deps = starJoinDeps(sh, { stdout: () => {}, stderr: () => {} });
      // UNKNOWN：名字不存在，报错带候选
      sh.state.claude = [{ sessionId: 'sess-alice', name: 'alice' }];
      const err: string[] = [];
      const rcUnknown = await runAdopt({ connect: 'sl-a1', adopt: 'alicia' }, starJoinDeps(sh, { stdout: () => {}, stderr: (l) => err.push(l) }));
      expect(rcUnknown).toBe(1);
      expect(err.some((l) => l.includes('alice'))).toBe(true);
      // 双活：claude 与 codex 同名
      sh.state.codex = [{ id: CODEX_THREAD, name: 'alice' }];
      const rcCollision = await runAdopt({ connect: 'sl-a1', adopt: 'alice' }, deps);
      expect(rcCollision).toBe(1);
      // --extend-session：收编并声明接续旧名 → 死名投递指路（SESSION_SUPERSEDED）
      sh.state.codex = [];
      const out: string[] = [];
      const rcExtends = await runAdopt(
        { connect: 'sl-a1', adopt: 'alice', extendSession: 'retired' },
        starJoinDeps(sh, { stdout: (l) => out.push(l), stderr: (l) => out.push(l) }),
      );
      expect(rcExtends).toBe(0);
      const sender = await senderOn(sh.harness.url, key('s'));
      sender.send({ op: 'send', id: 'ex1', targetMachine: 'node-host:retired', body: 'x' });
      const superseded = await sender.waitFor((f) => f.op === 'error' && f.id === 'ex1');
      expect(superseded).toMatchObject({ code: 'SESSION_SUPERSEDED' });
      // 020：adopt 收编声明带 tool——指路地址带工具限定词
      expect(superseded.op === 'error' && superseded.message).toContain('node-host:claude/alice');
    },
    15_000,
  );
});

// ---- status 星会话视图 -----------------------------------------------------------------

describe('018 批二：status --stars 会话视图与诊断行', () => {
  it('每星下会话成员行（机器:会话名 extends←旧名）+ adopt 诊断行 + json sessions 键', async () => {
    const baseDir = mkdtempSync(join(root, 'st-'));
    mkdirSync(join(baseDir, 'tcp'), { recursive: true });
    writeFileSync(
      join(baseDir, 'tcp', 'node.json'),
      `${JSON.stringify({ brokers: [{ host: '127.0.0.1', port: 7260, key: 'k', name: 'sl-v' }] }, null, 2)}\n`,
      'utf8',
    );
    // 本机守护在线（status-node-sl-v.json 新鲜、brokerAlias=星名）
    writeFileSync(
      join(baseDir, 'tcp', 'status-node-sl-v.json'),
      `${JSON.stringify({ state: 'online', brokerAlias: 'sl-v', since: new Date().toISOString(), lastUpdated: new Date().toISOString() })}\n`,
      'utf8',
    );
    const rosterMachines = [
      {
        name: 'node-host',
        mid8: 'a1b2c3d4',
        online: true,
        sessions: [
          { sessionId: 's1', name: 'boss' },
          { sessionId: 's2', name: 'boss2', extends: 'boss' },
        ],
      },
      { name: 'win-other', mid8: WIN_MID.replace(/-/g, '').slice(0, 8), online: false },
    ];
    const deps: StatusDeps = {
      listClaudeSessions: () => ({
        sessions: [
          { pid: 1, sessionId: 's9', kind: 'interactive', name: 'orphan', status: 'idle', messagingSocketPath: 'x' },
        ],
        malformed: 0,
      }),
      listCodexThreads: async () => [],
      tcpDir: join(baseDir, 'tcp'),
      roster: async () => rosterMachines,
    };
    const text = await runStatus(deps, false, false, {}, undefined, true);
    expect(text).toContain('sl-v ✓ 可达');
    expect(text).toContain('会话: node-host:boss、node-host:boss2 (extends←boss)');
    expect(text).toContain('crosschat serve --connect sl-v --adopt orphan');
    // json：stars 分组带 sessions（additive，旧键不动）
    const json = JSON.parse(await runStatus(deps, true, false, {}, undefined, true)) as {
      stars?: Array<{ machines: Array<{ sessions?: unknown[] }> }>;
    };
    const withSessions = json.stars?.[0]?.machines.find((m) => (m.sessions?.length ?? 0) > 0);
    expect(withSessions?.sessions).toHaveLength(2);
    // 诊断行不出现在无守护的离线星
    expect(text).not.toContain('--adopt boss'); // 已是成员的会话不给诊断
  });
});

// ---- 9b 命令面告警 ---------------------------------------------------------------------

describe('018 批二：9b 降级告警（不只日志）', () => {
  it(
    'NodeClient.warn 直打一行；warnIfBrokerLacksSessionCaps 对老 broker 出声、新 broker 静默',
    async () => {
      // 假老 broker：info caps 恒空数组
      const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
      await new Promise<void>((resolve) => wss.once('listening', resolve));
      const port = (wss.address() as { port: number }).port;
      wss.on('connection', (ws) => {
        ws.on('message', (data: RawData) => {
          const f = parseFrame(data.toString());
          if (f !== undefined && f.op === 'connect') ws.send(encodeFrame({ op: 'connected', machineName: 'old-broker' }));
        });
        ws.send(encodeFrame({ op: 'info', proto: 1, server: 'crosschat/old', caps: [] }));
      });
      const dir = mkdtempSync(join(root, 'oldbk-'));
      const entry: BrokerEntry = { host: '127.0.0.1', port, key: 'k', name: 'sl-old' };
      const warns: string[] = [];
      const client = new NodeClient({
        config: { entries: [entry] },
        configFile: join(dir, 'node.json'),
        machineId: () => 'NODE-MID',
        statusFile: join(dir, 'status-node.json'),
        fileInbox: new FileInbox({ inboxDir: join(dir, 'inbox'), partsDir: join(dir, 'parts') }),
        makeSendDeps: () => scanDeps({ claude: [], codex: [], delivered: [] }),
        now: () => Date.now(),
        log: () => {},
        backoffBaseMs: 50,
        memberCheckMs: 60_000,
        warn: (line) => warns.push(line),
      });
      nodeClients.push(client);
      void client.run().catch(() => {});
      await client.waitForState('online');
      // 启动器/serve 父进程同款探针：老 broker → 一行告警
      const capWarns: string[] = [];
      await warnIfBrokerLacksSessionCaps(entry, (l) => capWarns.push(l));
      expect(capWarns.some((l) => l.includes('已降级机器级'))).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(warns.some((l) => l.includes('已降级机器级'))).toBe(true); // 聚合器命令面告警
      await client.stop();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      // 新 broker：caps 含 session-members → 不出声
      const sh = await startStarStar('sl-9b');
      const silent: string[] = [];
      await warnIfBrokerLacksSessionCaps(sh.entry, (l) => silent.push(l));
      expect(silent).toHaveLength(0);
      expect(CAP_SESSION_MEMBERS).toBe('session-members');
    },
    15_000,
  );
});

// ---- 改名跟随（裁定 1） ------------------------------------------------------------------

describe('018 批二：/rename 自动跟随（claude 扫描 + codex 名字回填）', () => {
  it(
    'claude 改名→成员名跟随重播；codex 未命名成员→线程表名字回填',
    async () => {
      const sh = await startStarStar('sl-n1', { memberCheckMs: 100 });
      await sh.aggregator();
      sh.state.claude = [{ sessionId: 'sess-1', name: 'boss' }];
      sh.state.codex = [{ id: CODEX_THREAD, name: null }];
      const pipe = await connectAttachPipe(attachPipePath(sh.entry, join(sh.baseDir, 'tcp')), 30, 200);
      expect((await pipe.send({ op: 'attach', sessionId: 'sess-1', name: 'boss' })).ok).toBe(true);
      expect((await pipe.send({ op: 'attach', sessionId: CODEX_THREAD })).ok).toBe(true); // codex 无名入星（id 先行）
      const sender = await senderOn(sh.harness.url, key('s'));
      const send3 = async (id: string, target: string): Promise<Frame> => {
        sender.send({ op: 'send', id, targetMachine: target, body: 'x' });
        return sender.waitFor((f) => (f.op === 'receipt' || f.op === 'error') && f.id === id);
      };
      // 改名：claude boss→boss2；codex 线程获名 cname（/rename）
      sh.state.claude = [{ sessionId: 'sess-1', name: 'boss2' }];
      sh.state.codex = [{ id: CODEX_THREAD, name: 'cname' }];
      let renamed = false;
      let codexNamed = false;
      for (let i = 0; i < 150; i++) {
        if (!renamed) {
          const r = await send3(`n1${i}`, 'node-host:boss2');
          if (r.op === 'receipt' && r.status === 'delivered') renamed = true;
        }
        if (!codexNamed) {
          const r = await send3(`n2${i}`, 'node-host:cname');
          if (r.op === 'receipt' && r.status === 'delivered') codexNamed = true;
        }
        if (renamed && codexNamed) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      expect(renamed).toBe(true); // 新名直达
      expect(codexNamed).toBe(true); // codex 名字从线程表回填
      expect(await send3('n3', 'node-host:boss')).toMatchObject({ op: 'error', code: 'SESSION_NOT_MEMBER' }); // 旧名退位
      await pipe.close();
    },
    // CI 慢速 runner（Windows）上每轮两次 WS 往返显著慢于本机——窗口放宽到 60s（本机 15s 压线过的同款时序）
    60_000,
  );
});

// ---- 兼容性锁 ---------------------------------------------------------------------------

describe('018 批二：兼容锁（机器级零回归锚）', () => {
  it('status 解析 --stars 仍只与 --json 组合；机器级 roster 无 sessions 字段照旧可读', () => {
    expect(() => parseStatusArgs(['--stars', '--claude'])).toThrow(MultichatError);
    expect(parseStatusArgs(['--stars', '--json'])).toMatchObject({ stars: true, json: true });
  });
});

// ---- 028 双模式与命令面 -------------------------------------------------------------------

describe('028 双模式与命令面', () => {
  it('旗标面：--rm 剥离透传；--rm×--extend-session 互斥（边界2）；--rm 无 --connect 拒绝', () => {
    const flags = splitStarLauncherArgs(['-n', 'w', '--connect', 's1', '--rm', '--model', 'x']);
    expect(flags.rm).toBe(true);
    expect(flags.connects).toEqual(['s1']);
    expect(flags.passthrough).toEqual(['-n', 'w', '--model', 'x']);
    expect(() => splitStarLauncherArgs(['--connect', 's1', '--rm', '--extend-session', 'old'])).toThrow('互斥');
    expect(() => splitStarLauncherArgs(['--rm'])).toThrow('--rm 修饰 --connect');
  });

  it('serve 命令面：--connect --rm 组合拒绝（边界5）；--member-remove 解析与缺 --connect 即拒', async () => {
    expect(parseServeArgs(['--connect', 's1', '--rm'])).toMatchObject({ connect: 's1', rm: true });
    expect(parseServeArgs(['--connect', 's1', '--member-remove', 'boss'])).toMatchObject({ connect: 's1', memberRemove: 'boss' });
    const baseDeps = {
      baseDir: mkdtempSync(join(root, 'srv-')),
      stdout: () => {},
      env: {},
      version: 't',
      machineId: () => 'm',
      hostname: () => 'h',
      networkInterfaces: () => ({}),
      now: () => 0,
      onSignal: () => {},
    };
    await expect(runServe({ connect: 's1', rm: true }, baseDeps)).rejects.toThrow('临时会话旗标');
    await expect(runServe({ memberRemove: 'boss' }, baseDeps)).rejects.toThrow('--member-remove 与 --connect');
  });

  it(
    '双模式集成：默认永久（退出=下线/裸 resume 同 id 复活）；--rm 零痕迹（退出册外无名）',
    async () => {
      const sh = await startStarStar('sl-dm', { memberCheckMs: 100 });
      await sh.aggregator();
      sh.state.claude = [{ sessionId: 'sess-base', name: 'old', updatedAt: 1 }];
      const sender = await senderOn(sh.harness.url, key('s'));
      const deliver = async (id: string, target: string): Promise<Frame> => {
        sender.send({ op: 'send', id, targetMachine: target, body: 'x' });
        return sender.waitFor((f) => (f.op === 'receipt' || f.op === 'error') && f.id === id);
      };
      const pollFor = async (target: string, want: 'delivered' | string, prefix: string): Promise<Frame> => {
        let last = 'none';
        for (let i = 0; i < 60; i++) {
          const r = await deliver(`${prefix}${i}`, target);
          last = r.op === 'error' ? `${r.op}:${r.code}` : `${r.op}:${(r as { status?: string }).status ?? ''}`;
          if (want === 'delivered' && r.op === 'receipt' && r.status === 'delivered') return r;
          if (want !== 'delivered' && r.op === 'error' && r.code === want) return r;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(`pollFor ${target} ${want} 未达成（最后收到 ${last}）`);
      };
      // 永久模式（默认）：spawn 入星 → 退出（进程死+detach）→ 下线册位保留
      const joiner1 = new StarJoiner({ deps: starJoinDeps(sh), side: 'claude', connects: ['sl-dm'], spawnName: 'boss' });
      await joiner1.begin();
      sh.state.claude = [
        { sessionId: 'sess-base', name: 'old', updatedAt: 1 },
        { sessionId: 'sess-kid', name: 'boss', updatedAt: 99 },
      ];
      await pollFor('node-host:boss', 'delivered', 'd1');
      sh.state.claude = [{ sessionId: 'sess-base', name: 'old', updatedAt: 1 }]; // 会话退出
      await joiner1.stop();
      const off = await pollFor('node-host:boss', 'SESSION_OFFLINE', 'd2');
      expect(off.op === 'error' && off.message).toContain('resume');
      // 裸 resume：同 id 会话回归（无启动器重声明）→ 对账循环验活自动复活
      sh.state.claude = [
        { sessionId: 'sess-base', name: 'old', updatedAt: 1 },
        { sessionId: 'sess-kid', name: 'boss', updatedAt: 100 },
      ];
      await pollFor('node-host:boss', 'delivered', 'd3');
      // --rm 模式：退出即离册零痕迹——会话进程仍活也册外无名
      const joiner2 = new StarJoiner({ deps: starJoinDeps(sh), side: 'claude', connects: ['sl-dm'], spawnName: 'worker', rm: true });
      await joiner2.begin();
      sh.state.claude = [
        { sessionId: 'sess-base', name: 'old', updatedAt: 1 },
        { sessionId: 'sess-kid', name: 'boss', updatedAt: 100 },
        { sessionId: 'sess-tmp', name: 'worker', updatedAt: 101 },
      ];
      await pollFor('node-host:worker', 'delivered', 'd4');
      await joiner2.stop(); // 一次性 worker 退出（扫描里进程仍在——册必须已无痕）
      await pollFor('node-host:worker', 'SESSION_NOT_MEMBER', 'd5');
    },
    60_000,
  );

  it(
    'member-remove 命令面：runServe 删册→册外无名（进程仍活）；幂等再删注明本不在册',
    async () => {
      const sh = await startStarStar('sl-mr');
      sh.state.claude = [{ sessionId: 'sess-boss', name: 'boss' }];
      await sh.aggregator();
      const pipe = await connectAttachPipe(attachPipePath(sh.entry, join(sh.baseDir, 'tcp')), 30, 200);
      expect((await pipe.send({ op: 'attach', sessionId: 'sess-boss', name: 'boss' })).ok).toBe(true);
      for (let i = 0; i < 40; i++) {
        const roster = await fetchRosterFor(sh.baseDir, sh.entry);
        if (roster?.some((m) => m.sessions?.some((s) => s.name === 'boss'))) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const serveDepsOf = (out: string[]) => ({
        baseDir: sh.baseDir,
        stdout: (l: string) => out.push(l),
        stderr: (l: string) => out.push(l),
        env: {},
        version: 't',
        machineId: () => 'NODE-MID',
        hostname: () => 'node-host',
        networkInterfaces: () => ({}),
        now: () => Date.now(),
        onSignal: () => {},
      });
      const out: string[] = [];
      expect(await runServe({ connect: 'sl-mr', memberRemove: 'boss' }, serveDepsOf(out))).toBe(0);
      expect(out.some((l) => l.includes('已从星 sl-mr') && l.includes('boss'))).toBe(true);
      // 聚合器收清表推送重播后：册外无名（进程仍活——册是事实源）
      const sender = await senderOn(sh.harness.url, key('s'));
      let gone: Frame | undefined;
      for (let i = 0; i < 30; i++) {
        sender.send({ op: 'send', id: `mr${i}`, targetMachine: 'node-host:boss', body: 'x' });
        const r = await sender.waitFor((f) => (f.op === 'error' || f.op === 'receipt') && f.id === `mr${i}`);
        if (r.op === 'error' && r.code === 'SESSION_NOT_MEMBER') {
          gone = r;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      expect(gone).toMatchObject({ code: 'SESSION_NOT_MEMBER' });
      const out2: string[] = [];
      expect(await runServe({ connect: 'sl-mr', memberRemove: 'boss' }, serveDepsOf(out2))).toBe(0);
      expect(out2.some((l) => l.includes('本不在册'))).toBe(true); // 幂等：删不存在条目=成功注明
      await pipe.close();
    },
    20_000,
  );
});

// ---- 020 工具限定词：启动器声明与 spawn 前预警 ----------------------------------------------

describe('020 工具限定词：启动器声明与 spawn 前预警', () => {
  it(
    'attach 带 tool；星内已有异工具同名成员→spawn 前打预警行；限定地址直达、裸名报碰撞列两地址',
    async () => {
      const sh = await startStarStar('sl-t1');
      await sh.aggregator(); // 聚合器先在（预警探针的管道面）
      // 既有成员 codex/boss（attach 管道直声明，带 tool）
      const pipe = await connectAttachPipe(attachPipePath(sh.entry, join(sh.baseDir, 'tcp')));
      const reply = await pipe.send({ op: 'attach', sessionId: CODEX_THREAD, name: 'boss', tool: 'codex' });
      expect(reply.ok).toBe(true);
      sh.state.codex = [{ id: CODEX_THREAD, name: 'boss' }];
      const out: string[] = [];
      const err: string[] = [];
      const joiner = new StarJoiner({
        deps: starJoinDeps(sh, { stdout: (l) => out.push(l), stderr: (l) => err.push(l) }),
        side: 'claude',
        connects: ['sl-t1'],
        spawnName: 'boss',
      });
      await joiner.begin(); // 差分基线=空表（预警后快照）
      // 021 纪律：横幅 + 预警都在 spawn 前打出（out 定格于 begin 返回时）
      expect(out[0]).toContain('入星 sl-t1');
      expect(out.some((l) => l.startsWith('预警:') && l.includes('codex/boss') && l.includes('claude/boss'))).toBe(true);
      // 模拟 spawn 出新会话（claude/boss）→ attach（带 tool=claude）生效
      sh.state.claude = [{ sessionId: 'sess-new', name: 'boss', updatedAt: 99 }];
      const sender = await senderOn(sh.harness.url, key('s'));
      const deliver = async (id: string, target: string): Promise<Frame> => {
        sender.send({ op: 'send', id, targetMachine: target, body: 'x' });
        return sender.waitFor((f) => (f.op === 'receipt' || f.op === 'error') && f.id === id);
      };
      for (let i = 0; i < 50; i++) {
        const r = await deliver(`tq${i}`, 'node-host:claude/boss');
        if (r.op === 'receipt' && r.status === 'delivered') break;
        if (i === 49) throw new Error('claude/boss 限定直达未生效');
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      // 裸名 boss 现在跨工具撞名 → NAME_COLLISION 列两个限定地址
      const col = await deliver('tq-col', 'node-host:boss');
      expect(col).toMatchObject({ op: 'error', code: 'NAME_COLLISION' });
      expect(col.op === 'error' && col.message).toContain('node-host:claude/boss');
      expect(col.op === 'error' && col.message).toContain('node-host:codex/boss');
      await joiner.stop();
      pipe.close();
    },
    20_000,
  );

  it('聚合器不在→预警静默跳过（begin 不炸不延迟，只有横幅行）', async () => {
    const sh = await startStarStar('sl-t2'); // 不拉聚合器——管道不存在
    const out: string[] = [];
    const joiner = new StarJoiner({
      deps: starJoinDeps(sh, { stdout: (l) => out.push(l) }),
      side: 'claude',
      connects: ['sl-t2'],
      spawnName: 'boss',
    });
    await joiner.begin();
    expect(out).toEqual(['入星 sl-t2——会话地址 tcp:sl-t2:node-host:boss（attach 自动，异常见日志）']);
    await joiner.stop();
  }, 10_000);
});
