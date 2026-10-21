/**
 * 033 星生命周期热闭环与台账静态化：
 * - 热加星不重启即收发（admin 插座回执 + 对账播种内挂聚合器 + 新星上完整收发）
 * - 删星即时收尾（连接收"星已删除"教学断开；发送方拿死钥直报）+ 最后一颗可删 + --add-star 重建
 * - 零星合法（serve 永不造星；doctor/status/CLI 教学指 --add-star）
 * - roster 无 online（写侧剥除、读侧旧值归一——新旧互读无害）
 * - 插座冷热路径与 stop 收口（回执超时绝不回落直写）
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as net from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import WebSocket, { type RawData } from 'ws';
import { runServe, type ServeDeps } from '../src/commands/serve.js';
import { runDoctor, type DoctorDeps } from '../src/commands/doctor.js';
import { runStatus, type StatusDeps } from '../src/commands/status.js';
import { loadBrokerFile, registryFileOf, writeBrokerFile, type NodeEntry, type RosterEntry } from '../src/serve/registry.js';
import { encodeFrame, parseFrame, CAP_MULTI_STAR, type Frame } from '../src/serve/protocol.js';
import type { SendDeps } from '../src/commands/send.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-star-lifecycle-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const key = (c: string) => c.repeat(64);
const MID = 'MID-TEST';

function entry(partial: Partial<NodeEntry>): NodeEntry {
  return { label: partial.label ?? 'node-1', key: partial.key ?? key('1'), addedAt: '2026-01-01T00:00:00.000Z', ...partial };
}

/** 聚合器/deliverLocal 接线所需的最小 SendDeps（收发闭环用）。 */
function fakeSendDeps(): SendDeps {
  return {
    env: {},
    listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
    listCodexThreads: async () => [],
    deliverClaude: async () => ({ status: 'delivered' }),
    deliverCodex: async () => ({ status: 'accepted', turnId: 't' }),
    sendLogFile: join(root, 'send-log.jsonl'),
    outboxDir: join(root, 'outbox'),
    now: () => Date.now(),
    hostname: () => 'cli-host',
    machineId: () => MID,
  } as unknown as SendDeps;
}

function cliDeps(extra: Partial<ServeDeps> = {}): { deps: ServeDeps; lines: string[]; errs: string[]; dir: string; registryFile: string } {
  const dir = mkdtempSync(join(root, 'cli-'));
  const lines: string[] = [];
  const errs: string[] = [];
  const deps: ServeDeps = {
    baseDir: dir,
    stdout: (line) => lines.push(line),
    stderr: (line) => errs.push(line),
    env: {},
    version: 'test',
    machineId: () => MID,
    hostname: () => 'cli-host',
    networkInterfaces: () => ({}),
    now: () => Date.now(),
    onSignal: () => {},
    listServeProcesses: () => [],
    makeSendDeps: () => fakeSendDeps(),
    ...extra,
  };
  return { deps, lines, errs, dir, registryFile: registryFileOf(dir) };
}

/** 起 runServe 前台 broker（随机端口），返回停机句柄与出口 promise。 */
function startServe(deps: ServeDeps): { stop: () => void; done: Promise<number> } {
  let stop: (() => void) | undefined;
  const d2: ServeDeps = { ...deps, onSignal: (_s, cb) => { stop = cb; } };
  const done = runServe({}, d2);
  return { stop: () => stop!(), done };
}

/** 裸 WS 客户端（帧收发/等待，multistar 同款最小面）。 */
class TestClient {
  readonly ws: WebSocket;
  private readonly frames: Frame[] = [];
  private readonly waiters: { pred: (f: Frame) => boolean; resolve: (f: Frame) => void; timer: ReturnType<typeof setTimeout> }[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
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

  close(): void {
    try {
      this.ws.close();
    } catch {
      // 已断开
    }
  }
}

async function handshake(url: string, auth: string, role: 'node' | 'sender', machineId?: string, name?: string): Promise<{ c: TestClient; frame: Frame }> {
  const c = new TestClient(url);
  await c.opened();
  await c.waitFor((f) => f.op === 'info');
  c.send({
    op: 'connect',
    proto: 1,
    role,
    ...(machineId === undefined ? {} : { machineId }),
    auth,
    ...(name === undefined ? {} : { name }),
    caps: [CAP_MULTI_STAR],
  });
  const frame = await c.waitFor((f) => f.op === 'connected' || f.op === 'error');
  return { c, frame };
}

async function serveUrl(deps: ServeDeps): Promise<string> {
  const st = JSON.parse(readFileSync(join(deps.baseDir, 'tcp', 'status-broker.json'), 'utf8')) as { port: number };
  return `ws://127.0.0.1:${st.port}`;
}

describe('033 热加星：不重启即托管即收发', () => {
  it('在跑 serve + CLI --add-star 经管理插座：回执生效、自登记落位、聚合器播种、新星上 node/sender 完整收发', async () => {
    const { deps, lines, dir, registryFile } = cliDeps();
    // 预置一颗星（含 broker 机 self 条目 + node.json 自用条目——serve 自挂前提）。
    // port: 0 = 随机监听口（本机 7260 有真 broker 在跑——测试不碰固定端口）。
    const selfKey = key('as');
    mkdirSync(join(dir, 'tcp'), { recursive: true });
    writeFileSync(
      registryFile,
      `${JSON.stringify({ port: 0, stars: [{ starId: 'aaaabbbbcccc', name: 'alpha', nodes: [entry({ label: 'self', key: selfKey, machineId: MID, machineName: 'cli-host' })], roster: [] }] }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      join(dir, 'tcp', 'node.json'),
      `${JSON.stringify({ brokers: [{ host: '127.0.0.1', port: 0, name: 'alpha', starId: 'aaaabbbbcccc', key: selfKey }], showName: 'cli-host' }, null, 2)}\n`,
      'utf8',
    );
    const serve = startServe(deps);
    await new Promise((r) => setTimeout(r, 1_500));

    // 热加星：CLI 走管理插座（status-broker.json 有 adminPipe + pid 验活）
    lines.length = 0;
    expect(await runServe({ addStarArg: 'beta' }, deps)).toBe(0);
    expect(lines.some((l) => l.includes('已加星 beta') && l.includes('免重启'))).toBe(true);
    // 台账：新星带自登记（serve 未重启——addStarTo 库函数播种，与冷路径同一套）
    const doc = loadBrokerFile(registryFile);
    expect(doc.stars.map((s) => s.name)).toEqual(['alpha', 'beta']);
    const betaSelf = doc.stars[1]!.nodes.find((n) => n.label === 'self-beta');
    expect(betaSelf).toMatchObject({ machineId: MID, machineName: 'cli-host' });
    // node.json：beta 自用条目已追加
    const nodeJson = JSON.parse(readFileSync(join(dir, 'tcp', 'node.json'), 'utf8')) as { brokers: Array<{ starId?: string }> };
    expect(nodeJson.brokers.some((e) => e.starId === doc.stars[1]!.starId)).toBe(true);
    // 内挂聚合器随对账播种（免重启）
    expect(lines.some((l) => l.includes('本进程聚合器启动：星 beta'))).toBe(true);

    // 热发钥（同经插座）：beta 得 2 把新钥
    lines.length = 0;
    expect(await runServe({ genKeyArg: '2', starArg: 'beta' }, deps)).toBe(0);
    expect(lines.some((l) => l.includes('入星 beta：生成 2 把钥匙'))).toBe(true);
    const betaNodes = loadBrokerFile(registryFile).stars[1]!.nodes;
    expect(betaNodes).toHaveLength(3); // self-beta + node-1 + node-2
    const extKey = betaNodes.find((n) => n.label === 'node-1')!.key;

    // 新星上完整收发：外部 node 入 beta 星 + sender 经 beta self 钥投递给它
    const url = await serveUrl(deps);
    const node = await handshake(url, extKey, 'node', 'eeee5555eeee', 'ext-node');
    expect(node.frame.op).toBe('connected');
    const sender = await handshake(url, betaSelf!.key, 'sender');
    expect(sender.frame.op).toBe('connected');
    node.c.send({ op: 'send', id: 'hi-1', targetMachine: 'cli-host', body: 'ping from ext' }); // 反向腿也过新星路由（deliverLocal 接线，回执不在此断言）
    sender.c.send({ op: 'send', id: 'hi-2', targetMachine: 'ext-node', body: 'pong to ext' });
    // ext-node 收 deliver 即回 result —— sender 得 receipt（收发闭环）
    const deliver = await node.c.waitFor((f) => f.op === 'deliver' && (f as { id?: string }).id === 'hi-2');
    expect((deliver as { payload?: string }).payload).toBe('pong to ext');
    node.c.send({ op: 'result', id: 'hi-2', status: 'delivered' });
    const receipt = await sender.c.waitFor((f) => f.op === 'receipt' && (f as { id?: string }).id === 'hi-2');
    expect((receipt as { status?: string }).status).toBe('delivered');

    node.c.close();
    sender.c.close();
    serve.stop();
    expect(await serve.done).toBe(0);
  }, 20_000);
});

describe('033 删星：即时收尾 + 直报已删 + 最后一颗可删', () => {
  it('热删 beta：在跑连接收"星已删除"断开、node.json 摘条、死钥直报、邻星零中断', async () => {
    const { deps, lines, errs, dir, registryFile } = cliDeps();
    const selfKeyA = key('as');
    mkdirSync(join(dir, 'tcp'), { recursive: true });
    // port: 0 = 随机监听口（不碰 7260）
    const seed = (stars: unknown): void => {
      writeFileSync(registryFile, `${JSON.stringify({ port: 0, stars }, null, 2)}\n`, 'utf8');
    };
    seed([
      { starId: 'aaaabbbbcccc', name: 'alpha', nodes: [entry({ label: 'self', key: selfKeyA, machineId: MID, machineName: 'cli-host' })], roster: [] },
      { starId: 'bbbbccccdddd', name: 'beta', nodes: [entry({ label: 'self-beta', key: key('bs'), machineId: MID, machineName: 'cli-host' }), entry({ label: 'node-1', key: key('b1') })], roster: [{ sessionId: 'sess-b1', machine: 'eeee5555eeee', machineName: 'ext-node' }] },
    ]);
    writeFileSync(
      join(dir, 'tcp', 'node.json'),
      `${JSON.stringify({ brokers: [
        { host: '127.0.0.1', port: 0, name: 'alpha', starId: 'aaaabbbbcccc', key: selfKeyA },
        { host: '127.0.0.1', port: 0, name: 'beta', starId: 'bbbbccccdddd', key: key('bs') },
      ], showName: 'cli-host' }, null, 2)}\n`,
      'utf8',
    );
    const serve = startServe(deps);
    await new Promise((r) => setTimeout(r, 1_500));
    const url = await serveUrl(deps);

    // beta 星上挂一个外部节点（删星时在线——应收教学断连）
    const ext = await handshake(url, key('b1'), 'node', 'eeee5555eeee', 'ext-node');
    expect(ext.frame.op).toBe('connected');
    // alpha 邻星常驻连接（零中断对照）
    const alphaSender = await handshake(url, selfKeyA, 'sender');
    expect(alphaSender.frame.op).toBe('connected');

    // 将死清单（执行前打印）+ 热删
    lines.length = 0;
    expect(await runServe({ removeStarArg: 'beta' }, deps)).toBe(0);
    expect(lines.some((l) => l.includes('将删除星 beta') && l.includes('册随星葬'))).toBe(true);
    expect(lines.some((l) => l.includes('星 beta 已删除') && l.includes('连接已断'))).toBe(true);
    // 在线 beta 连接收"星已删除"教学帧并断开
    const errFrame = await ext.c.waitFor((f) => f.op === 'error');
    expect((errFrame as { code?: string }).code).toBe('STAR_DELETED');
    expect((errFrame as { message?: string }).message).toContain('星 beta 已被删除');
    await new Promise((r) => setTimeout(r, 300));
    expect(ext.c.ws.readyState).toBe(WebSocket.CLOSED);
    // 台账/node.json/status 三面收尾
    expect(loadBrokerFile(registryFile).stars.map((s) => s.name)).toEqual(['alpha']);
    const nodeJson = JSON.parse(readFileSync(join(dir, 'tcp', 'node.json'), 'utf8')) as { brokers: Array<{ starId?: string }> };
    expect(nodeJson.brokers.some((e) => e.starId === 'bbbbccccdddd')).toBe(false);
    const st = JSON.parse(readFileSync(join(dir, 'tcp', 'status-broker.json'), 'utf8')) as { stars?: Array<{ starId?: string }> };
    expect(st.stars!.some((s) => s.starId === 'bbbbccccdddd')).toBe(false);
    // 邻星零中断：alpha 的连接仍在（roster 应答可回）
    alphaSender.c.send({ op: 'roster' });
    const roster = await alphaSender.c.waitFor((f) => f.op === 'roster-result');
    expect(roster.op).toBe('roster-result');
    // 发送方拿死星钥直报"星可能未创建或已删除"（不走防重发绕弯——BAD_AUTH 教学语）
    const dead = await handshake(url, key('bs'), 'sender');
    expect(dead.frame.op).toBe('error');
    expect((dead.frame as { code?: string }).code).toBe('BAD_AUTH');
    expect((dead.frame as { message?: string }).message).toContain('星可能未创建或已删除');
    void errs;
    alphaSender.c.close();
    ext.c.close();
    dead.c.close();
    serve.stop();
    expect(await serve.done).toBe(0);
  }, 20_000);

  it('冷路径删最后一颗星合法 + --add-star 重建（新 starId，零星态文件形状合法）', async () => {
    const { deps, lines, registryFile } = cliDeps();
    const starId = 'ccccddddeeee';
    mkdirSync(join(deps.baseDir, 'tcp'), { recursive: true });
    writeFileSync(registryFile, `${JSON.stringify({ stars: [{ starId, name: 'solo', nodes: [entry({ key: key('s') })], roster: [] }] }, null, 2)}\n`, 'utf8');
    // 最后一颗允许删（broker 未跑——冷路径直调库函数）
    expect(await runServe({ removeStarArg: 'solo' }, deps)).toBe(0);
    expect(lines.some((l) => l.includes('将删除星 solo'))).toBe(true);
    const empty = loadBrokerFile(registryFile);
    expect(empty.stars).toHaveLength(0); // 零星态合法
    expect(readFileSync(registryFile, 'utf8')).toContain('"stars": []');
    // 重建：同星名可用（无墓碑无复活——纯新星）
    expect(await runServe({ addStarArg: 'solo' }, deps)).toBe(0);
    const rebuilt = loadBrokerFile(registryFile);
    expect(rebuilt.stars).toHaveLength(1);
    expect(rebuilt.stars[0]!.name).toBe('solo');
    expect(rebuilt.stars[0]!.starId).not.toBe(starId); // 新 starId（旧钥作废不复用）
    // 零星态的教学面
    lines.length = 0;
    expect(await runServe({ removeStarArg: 'solo' }, deps)).toBe(0);
    expect(await runServe({ list: true }, deps)).toBe(0);
    expect(lines.some((l) => l.includes('零星') && l.includes('--add-star'))).toBe(true);
    // --gen-key 空表教学指 --add-star
    await expect(runServe({ genKeyArg: '1' }, deps)).rejects.toThrow(/零星.*--add-star/);
  });
});

describe('033 零星合法与教学（doctor/status）', () => {
  it('doctor：broker.json 零星 → ⚠️ 教学指 --add-star（不判错）', () => {
    const dir = mkdtempSync(join(root, 'doc-'));
    mkdirSync(join(dir, 'tcp'), { recursive: true });
    writeFileSync(join(dir, 'tcp', 'broker.json'), JSON.stringify({ stars: [] }));
    const deps: DoctorDeps = {
      nodeVersion: '22.13.0',
      env: {},
      resolveClaude: () => { throw new Error('skip'); },
      listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
      codexBin: () => { throw new Error('skip'); },
      run: () => ({ status: 0, stdout: 'v0.160.0' }),
      exists: () => false,
      readFile: (p) => (p === join(dir, 'tcp', 'broker.json') ? readFileSync(p, 'utf8') : undefined),
      homeDir: () => dir,
      listOutbox: () => [],
      tcpDir: join(dir, 'tcp'),
      probeTcp: () => true,
      cliVersion: 'test',
      repoSkillFiles: () => undefined,
    };
    const report = runDoctor(deps);
    expect(report.output).toContain('零星');
    expect(report.output).toContain('crosschat serve --add-star');
    expect(report.failed).toBe(false); // 零星是合法待配状态——不 ❌
  });

  it('status：在跑 broker 零星 → 转发器区块教学行', async () => {
    const dir = mkdtempSync(join(root, 'st-'));
    mkdirSync(join(dir, 'tcp'), { recursive: true });
    writeFileSync(
      join(dir, 'tcp', 'status-broker.json'),
      JSON.stringify({ state: 'running', port: 7260, lastUpdated: new Date().toISOString(), onlineNodes: [], stars: [] }),
    );
    const deps: StatusDeps = {
      listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
      listCodexThreads: async () => [],
      tcpDir: join(dir, 'tcp'),
    };
    const out = await runStatus(deps, false, false, { section: 'claude' });
    expect(out).toContain('零星待配（合法状态）——首星：crosschat serve --add-star');
  });
});

describe('033 roster 无 online（新旧互读无害）', () => {
  it('写侧剥除：带 online 的 roster 写盘 → 文件无 "online" 字样，读回缺省', () => {
    const dir = mkdtempSync(join(root, 'wo-'));
    const file = registryFileOf(dir);
    mkdirSync(join(dir, 'tcp'), { recursive: true });
    const roster: RosterEntry[] = [
      { sessionId: 's1', name: 'boss', tool: 'claude', machine: 'mm', machineName: 'win', online: true },
    ];
    writeBrokerFile(file, { stars: [{ starId: 'aaaa', name: 'a', nodes: [], roster }] });
    expect(readFileSync(file, 'utf8')).not.toContain('"online"');
    // 读回：条目在、online 归一为缺省（默认离线——聚合器重连数秒自愈）
    const doc = loadBrokerFile(file);
    expect(doc.stars[0]!.roster).toHaveLength(1);
    expect(doc.stars[0]!.roster[0]!.online).toBeUndefined();
    expect(doc.stars[0]!.roster[0]!.name).toBe('boss');
  });

  it('读侧归一：旧形状文件（roster 带 online:true）读入不炸、按默认离线', () => {
    const dir = mkdtempSync(join(root, 'ro-'));
    const file = registryFileOf(dir);
    mkdirSync(join(dir, 'tcp'), { recursive: true });
    writeFileSync(
      file,
      `${JSON.stringify({ stars: [{ starId: 'aaaa', name: 'a', nodes: [], roster: [{ sessionId: 's1', machine: 'mm', online: true }, { sessionId: 's2', machine: 'mm', online: false }] }] }, null, 2)}\n`,
      'utf8',
    );
    const doc = loadBrokerFile(file);
    expect(doc.stars[0]!.roster.map((e) => e.sessionId)).toEqual(['s1', 's2']);
    expect(doc.stars[0]!.roster.every((e) => e.online === undefined)).toBe(true); // 活性不信任文件——重连自愈
  });
});

describe('033 插座冷热路径与 stop 收口', () => {
  it('冷路径：broker 未跑 → 直调库函数落盘，打印注明', async () => {
    const { deps, lines, registryFile } = cliDeps();
    expect(await runServe({ addStarArg: 'cold' }, deps)).toBe(0);
    expect(lines.some((l) => l.includes('broker 未在跑') && l.includes('已落盘'))).toBe(true);
    expect(loadBrokerFile(registryFile).stars[0]!.name).toBe('cold');
  });

  it('回执超时绝不回落直写：插座连上但无回执 → 报错重试、台账零改动', async () => {
    const { deps, errs, registryFile } = cliDeps();
    // 假插座：受理连接但永不回执（模拟挂死 broker）
    const pipe = process.platform === 'win32'
      ? `\\\\.\\pipe\\crosschat-admin-fake-${Date.now()}`
      : join(root, `fake-${Date.now()}.sock`);
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(pipe, () => resolve()));
    mkdirSync(join(deps.baseDir, 'tcp'), { recursive: true });
    writeFileSync(
      join(deps.baseDir, 'tcp', 'status-broker.json'),
      JSON.stringify({ state: 'running', pid: process.pid, adminPipe: pipe, lastUpdated: new Date().toISOString() }),
    );
    expect(await runServe({ addStarArg: 'stuck' }, deps)).toBe(1);
    expect(errs.some((l) => l.includes('绝不回落直写') && l.includes('重试'))).toBe(true);
    expect(loadBrokerFile(registryFile).stars).toHaveLength(0); // 台账零改动（未直写）
    server.close();
  }, 20_000);

  it('stop 收口：serve 停机后状态 stopped、插座随进程撤（CLI 退冷路径）', async () => {
    const { deps, lines, registryFile } = cliDeps();
    mkdirSync(join(deps.baseDir, 'tcp'), { recursive: true });
    writeFileSync(registryFile, `${JSON.stringify({ port: 0, stars: [{ starId: 'aaaa', name: 'alpha', nodes: [], roster: [] }] }, null, 2)}\n`, 'utf8');
    const serve = startServe(deps);
    await new Promise((r) => setTimeout(r, 1_500));
    const statusFile = join(deps.baseDir, 'tcp', 'status-broker.json');
    const running = JSON.parse(readFileSync(statusFile, 'utf8')) as { state: string; adminPipe?: string };
    expect(running.state).toBe('running');
    expect(typeof running.adminPipe).toBe('string'); // writeStatus 扩 adminPipe
    // 热路径一例（--show-name）：在跑时生效
    expect(await runServe({ showNameArg: 'renamed' }, deps)).toBe(0);
    expect(lines.some((l) => l.includes('显示名已改为 renamed') && l.includes('秒级生效'))).toBe(true);
    serve.stop();
    expect(await serve.done).toBe(0);
    const stopped = JSON.parse(readFileSync(statusFile, 'utf8')) as { state: string };
    expect(stopped.state).toBe('stopped');
    // 停机后 CLI 退冷路径（不再连插座）
    lines.length = 0;
    expect(await runServe({ addStarArg: 'after-stop' }, deps)).toBe(0);
    expect(lines.some((l) => l.includes('broker 未在跑'))).toBe(true);
    expect(loadBrokerFile(registryFile).stars.map((s) => s.name)).toEqual(['alpha', 'after-stop']);
  }, 20_000);
});

describe('036 按星机器名（--star --show-name）热闭环', () => {
  /** 轮询等待条件成立（聚合器重挂重连异步——machineName 回写有毫秒级迟滞）。 */
  async function until(cond: () => boolean, ms = 5_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (cond()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('until timeout');
  }

  it('按星只重挂该星：条目覆盖落 node.json、注册表该星 machineName 更新、邻星回落全局不变；--list 显示随条目；\'\' 清除回落全局', async () => {
    const { deps, lines, dir, registryFile } = cliDeps();
    const selfKeyA = key('as');
    const selfKeyB = key('bs');
    mkdirSync(join(dir, 'tcp'), { recursive: true });
    // port: 0 = 随机监听口（不碰 7260）；双星各带 broker 机 self 条目（machineName 同名起步）
    writeFileSync(
      registryFile,
      `${JSON.stringify({ port: 0, stars: [
        { starId: 'aaaabbbbcccc', name: 'alpha', nodes: [entry({ label: 'self', key: selfKeyA, machineId: MID, machineName: 'cli-host' })], roster: [] },
        { starId: 'bbbbccccdddd', name: 'beta', nodes: [entry({ label: 'self-beta', key: selfKeyB, machineId: MID, machineName: 'cli-host' })], roster: [] },
      ] }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      join(dir, 'tcp', 'node.json'),
      `${JSON.stringify({ brokers: [
        { host: '127.0.0.1', port: 0, name: 'alpha', starId: 'aaaabbbbcccc', key: selfKeyA },
        { host: '127.0.0.1', port: 0, name: 'beta', starId: 'bbbbccccdddd', key: selfKeyB },
      ], showName: 'cli-host' }, null, 2)}\n`,
      'utf8',
    );
    const serve = startServe(deps);
    await new Promise((r) => setTimeout(r, 1_500));

    // 按星命名 alpha：插座热路径（只重挂 alpha 聚合器）
    lines.length = 0;
    expect(await runServe({ showNameArg: 'alpha-main', starArg: 'alpha' }, deps)).toBe(0);
    expect(lines.some((l) => l.includes('星 alpha 显示名已改为 alpha-main') && l.includes('秒级生效'))).toBe(true);
    // node.json：alpha 条目级覆盖落位；beta 条目无覆盖；顶层全局不动
    const nodeJson = JSON.parse(readFileSync(join(dir, 'tcp', 'node.json'), 'utf8')) as { brokers: Array<{ starId?: string; showName?: string }>; showName?: string };
    expect(nodeJson.brokers.find((e) => e.starId === 'aaaabbbbcccc')!.showName).toBe('alpha-main');
    expect(nodeJson.brokers.find((e) => e.starId === 'bbbbccccdddd')!.showName).toBeUndefined();
    expect(nodeJson.showName).toBe('cli-host');
    // 注册表：alpha self machineName 随重挂重连自报更新；beta（未重挂）保持全局名
    await until(() => loadBrokerFile(registryFile).stars[0]!.nodes.find((n) => n.label === 'self')!.machineName === 'alpha-main');
    expect(loadBrokerFile(registryFile).stars[1]!.nodes.find((n) => n.label === 'self-beta')!.machineName).toBe('cli-host');
    // --list 显示随条目（决策5）：各星机器名取该星 nodes[].machineName
    lines.length = 0;
    expect(await runServe({ list: true }, deps)).toBe(0);
    expect(lines.some((l) => l.includes('alpha-main'))).toBe(true);
    expect(lines.some((l) => l.includes('=== 星 beta ==='))).toBe(true);
    expect(lines.some((l) => l.includes('cli-host'))).toBe(true);
    // '' 清除条目覆盖 → 重挂回落全局
    expect(await runServe({ showNameArg: '', starArg: 'alpha' }, deps)).toBe(0);
    await until(() => loadBrokerFile(registryFile).stars[0]!.nodes.find((n) => n.label === 'self')!.machineName === 'cli-host');
    const cleared = JSON.parse(readFileSync(join(dir, 'tcp', 'node.json'), 'utf8')) as { brokers: Array<{ starId?: string; showName?: string }> };
    expect(cleared.brokers.find((e) => e.starId === 'aaaabbbbcccc')!.showName).toBeUndefined();

    serve.stop();
    expect(await serve.done).toBe(0);
  }, 20_000);
});
