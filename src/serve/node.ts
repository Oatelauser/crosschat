/**
 * 节点客户端（票B B2）：`crosschat serve --connect` 的常驻腿——连 broker、
 * 收 deliver 帧进程内调 runSend（与 ssh 远端 CLI 同权：会话状态/限流/发件箱
 * 全是本机既有行为）、收 file-* 帧落盘 inbox。断线指数退避 1s→2s→…封顶
 * 60s 永不放弃；连续失败 ≥5 分钟进静音模式（日志每 10 次一条）。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { WebSocket } from 'ws';
import { MultichatError } from '../errors.js';
import { encodeFrame, MAX_PAYLOAD_BYTES, parseFrame, PROTOCOL_VERSION } from './protocol.js';
import type {
  DeliverFrame,
  ErrorFrame,
  FileBeginFrame,
  FileChunkFrame,
  FileEndFrame,
  Frame,
  InfoFrame,
  ResultFrame,
} from './protocol.js';
import { runSend, type SendDeps } from '../commands/send.js';
import type { CodexThreadWithMeta } from '../codex/discovery.js';
import { FileInbox } from './file-channel.js';
import type { StatusPayload, StatusQueryFrame } from './protocol.js';

/** B0 多星地基：一个 broker 条目（旧形状读进 broker 对象、新形状 brokers[] 元素）。 */
export interface BrokerEntry {
  host: string;
  port: number;
  /** E0 星名（broker 权威，info 帧自动同步；读层把旧 alias 值映射进来）。 */
  name?: string;
  starId?: string;
  key: string;
}

/** 归一化后的 node.json：旧/新双形状都收进 entries（多条目路由选择是 B1）。 */
export interface NodeConfig {
  entries: BrokerEntry[];
  /** E0 词表换轨：本机显示名（旧文件的顶层 name 读入映射；显示用，寻址权威是 machine-id 前缀）。 */
  showName?: string;
}

/** E0 选择器报错里的条目行：星名与 starId 前 6 位并排（cloud(6b76e1)），拷了就能用。 */
export function formatBrokerEntry(e: BrokerEntry): string {
  const id = e.starId === undefined ? 'starId 未登记' : e.starId.slice(0, 6);
  return `${e.name ?? '(无名)'}(${id})`;
}

/** 会员凭证缺失/损坏的教学报错（send --via tcp: 与 --connect 同用）。 */
export const NOT_JOINED_MESSAGE =
  '本机未入网——向管理员索取 node.json 放到 ~/.crosschat/tcp/（broker 机上 crosschat serve --gen-key 生成）';

/** 单条目净化校验：缺 key/host 或 port 非整数即坏形状。 */
function parseBrokerEntry(raw: unknown): BrokerEntry {
  if (raw === null || typeof raw !== 'object') throw new Error('bad shape');
  const e = raw as { host?: unknown; port?: unknown; name?: unknown; alias?: unknown; starId?: unknown; key?: unknown };
  if (
    typeof e.key !== 'string' || e.key === '' ||
    typeof e.host !== 'string' || typeof e.port !== 'number' || !Number.isInteger(e.port)
  ) {
    throw new Error('bad shape');
  }
  // E0 读层兼容：旧 alias 值映射为星名（新 name 优先）
  const name = typeof e.name === 'string' ? e.name : typeof e.alias === 'string' ? e.alias : undefined;
  return {
    host: e.host,
    port: e.port,
    ...(name === undefined ? {} : { name }),
    ...(typeof e.starId === 'string' ? { starId: e.starId } : {}),
    key: e.key,
  };
}

export function readNodeConfig(configFile: string): NodeConfig {
  let raw: string;
  try {
    raw = readFileSync(configFile, 'utf8');
  } catch {
    throw new MultichatError('USAGE', NOT_JOINED_MESSAGE);
  }
  try {
    const parsed = JSON.parse(raw) as {
      broker?: { host?: unknown; port?: unknown; alias?: unknown; starId?: unknown };
      brokers?: unknown;
      key?: unknown;
      name?: unknown;
      showName?: unknown;
    } | null;
    if (parsed === null || typeof parsed !== 'object') throw new Error('bad shape');
    // E0 读层兼容：旧顶层 name 映射为 showName（新 showName 优先）
    const showName =
      typeof parsed.showName === 'string' ? parsed.showName : typeof parsed.name === 'string' ? parsed.name : undefined;
    // 新形状 {brokers: [...], showName}：条目数组原样收进 entries（空数组=坏形状；
    // 顶层多余 starId 忽略——星标识只认条目/starId 槽）
    if (Array.isArray(parsed.brokers)) {
      const entries = parsed.brokers.map(parseBrokerEntry);
      if (entries.length === 0) throw new Error('bad shape');
      return { ...(showName === undefined ? {} : { showName }), entries };
    }
    // 旧形状 {broker: {...}, key, name} → 单元素（行为与 B0 前逐字节等价）
    if (typeof parsed.key !== 'string' || parsed.key === '') throw new Error('bad shape');
    const broker = parsed.broker;
    if (broker === null || typeof broker !== 'object' || typeof broker.host !== 'string' || !Number.isInteger(broker.port)) {
      throw new Error('bad shape');
    }
    return {
      ...(showName === undefined ? {} : { showName }),
      entries: [parseBrokerEntry({ ...broker, key: parsed.key })],
    };
  } catch {
    throw new MultichatError('USAGE', `node.json 损坏（${configFile}）——向管理员重新索取覆盖；${NOT_JOINED_MESSAGE}`);
  }
}

/**
 * E0：info 同步写回——按 key+host+port 定位 node.json 对应条目，starId 仅缺失
 * 补、name 不一致覆盖（broker 权威），一致不写；重写时顺带清旧键（条目 alias
 * 值并轨进 name、顶层 name 改 showName）。tmp+rename 原子写；失败不倒连接。
 */
export function syncNodeJsonEntry(
  configFile: string,
  match: { host: string; port: number; key: string },
  patch: { starId?: string; name?: string },
): void {
  try {
    const parsed = JSON.parse(readFileSync(configFile, 'utf8')) as {
      broker?: Record<string, unknown> | null;
      brokers?: Array<Record<string, unknown> | null>;
      key?: unknown;
      name?: unknown;
      showName?: unknown;
    } | null;
    if (parsed === null || typeof parsed !== 'object') return;
    const sameTarget = (e: unknown): e is Record<string, unknown> => {
      if (e === null || typeof e !== 'object') return false;
      const rec = e as Record<string, unknown>;
      return rec.host === match.host && rec.port === match.port && rec.key === match.key;
    };
    let hit: Record<string, unknown> | undefined;
    if (Array.isArray(parsed.brokers)) {
      hit = parsed.brokers.find(sameTarget);
    } else if (parsed.broker !== null && typeof parsed.broker === 'object') {
      hit = sameTarget({ ...parsed.broker, key: parsed.key }) ? parsed.broker : undefined;
    }
    if (hit === undefined) return;
    let changed = false;
    if (patch.starId !== undefined && hit.starId === undefined) {
      hit.starId = patch.starId;
      changed = true;
    }
    if (patch.name !== undefined && hit.name !== patch.name) {
      hit.name = patch.name;
      changed = true;
    }
    if (!changed) return;
    // 词表换轨：重写时旧 alias 值并轨进 name（未覆盖时）并删旧键
    if (hit.name === undefined && typeof hit.alias === 'string') hit.name = hit.alias;
    delete hit.alias;
    if (parsed.showName === undefined && typeof parsed.name === 'string') {
      parsed.showName = parsed.name;
      delete parsed.name;
    }
    const tmp = `${configFile}.tmp`;
    mkdirSync(dirname(configFile), { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    renameSync(tmp, configFile);
  } catch {
    // 同步写失败不倒连接（下次握手再试）
  }
}

/**
 * deliver 帧 → 本机 runSend（broker 侧 deliverLocal 同用此桥）：
 * payload=正文，to/conversation/origin 透传；origin 是发送机的
 * encodeOriginIdentity 编码（ssh 远端 CLI 的 --origin 同语义）。
 */
export async function deliverViaRunSend(frame: DeliverFrame, deps: SendDeps): Promise<ResultFrame> {
  let output: string;
  try {
    // F1：broker 透传的发送方 roster 真名随 deps 进 runSend——跨机信封的
    // from-machine 属性来源；无名瞬态发送方（frame 缺省）不注入。
    output = await runSend(
      {
        to: frame.to,
        conversation: frame.conversation,
        bodyArg: frame.payload,
        origin: frame.origin,
        json: true,
      },
      frame.fromMachine === undefined ? deps : { ...deps, fromMachine: frame.fromMachine },
    );
  } catch (err) {
    if (err instanceof MultichatError) {
      return { op: 'result', id: frame.id, status: 'error', code: err.code, message: err.message };
    }
    return {
      op: 'result',
      id: frame.id,
      status: 'error',
      code: 'INTERNAL',
      message: err instanceof Error ? err.message : String(err),
    };
  }
  // runSend --json 输出：{status,to,turn,replyRef[,queue,mailbox]}
  try {
    const receipt = JSON.parse(output) as { status: 'delivered' | 'queued' | 'parked'; turn?: number; replyRef?: string };
    return {
      op: 'result',
      id: frame.id,
      status: receipt.status,
      turn: receipt.turn === undefined ? undefined : String(receipt.turn),
      replyRef: receipt.replyRef,
      output,
    };
  } catch {
    return { op: 'result', id: frame.id, status: 'error', code: 'INTERNAL', message: `本机回执不是 JSON: ${output.slice(0, 200)}` };
  }
}

/**
 * E1 远程枚举载荷（票012）：本机扫描 = claude 注册表 + codex 线程表，分段
 * 镜像本地 status 语义——codex 不可用降级为 unavailable 段（部分应答），
 * 不让整次查询失败。节点守护应答与 broker 本机应答（serve 注线）共用。
 */
export async function buildStatusPayload(
  deps: Pick<SendDeps, 'listClaudeSessions' | 'listCodexThreads'>,
): Promise<StatusPayload> {
  const scan = deps.listClaudeSessions();
  let codex: StatusPayload['codex'];
  try {
    codex = (await deps.listCodexThreads()).map((thread) => {
      // SendDeps 类型只承诺 summary；真接线（realSendDeps）返回带 meta 的完整行
      const meta = (thread as CodexThreadWithMeta).meta;
      return {
        name: thread.name,
        status: thread.status,
        id: thread.id.slice(0, 8),
        cwd: meta?.cwd ?? null,
        createdAt: meta?.createdAt ?? null,
        originator: meta?.originator ?? null,
      };
    });
  } catch (err) {
    // codex down is a valid status answer——同本地 status 的 unavailable 语义
    const message = err instanceof MultichatError
      ? `${err.code}: ${err.message}`
      : `INTERNAL: ${err instanceof Error ? err.message : String(err)}`;
    codex = { unavailable: message };
  }
  return {
    claude: scan.sessions.map((session) => ({
      name: session.name ?? null,
      kind: session.kind,
      status: session.status,
      pid: session.pid,
      cwd: session.cwd ?? null,
    })),
    codex,
  };
}

export interface NodeStatusFile {
  state: 'connecting' | 'online' | 'reconnect-wait';
  /** E0 起记录解析后的星名（无星名退回 host:port）；字段名沿用旧版兼容。 */
  brokerAlias: string;
  since: string;
  lastUpdated: string;
  nextAttemptAt?: string;
  /** F1：本守护的 crosschat 版本（doctor 版本对账）；旧守护缺省。 */
  version?: string;
}

export interface NodeClientDeps {
  config: NodeConfig;
  /** B0：node.json 路径——starId 回填写回原文件用。 */
  configFile: string;
  machineId: () => string | undefined;
  statusFile: string;
  /** F1：本守护的 crosschat 版本，落 status 文件供 doctor 对账；缺省不写该字段。 */
  version?: string;
  fileInbox: FileInbox;
  makeSendDeps(): SendDeps;
  now(): number;
  log(line: string): void;
  /** 重连退避基数（测试注入短值）；翻倍封顶 60s。 */
  backoffBaseMs?: number;
  /** 连续失败多久进静音（默认 5 分钟）。 */
  quietAfterMs?: number;
  onSignal?(sig: 'SIGINT' | 'SIGTERM', cb: () => void): void;
}

interface FrameWaiter {
  pred: (f: Frame) => boolean;
  resolve: (f: Frame) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface StateWaiter {
  state: NodeStatusFile['state'];
  resolve: () => void;
  timer: ReturnType<typeof setTimeout>;
}

export class NodeClient {
  private readonly d: NodeClientDeps & { backoffBaseMs: number; quietAfterMs: number };
  private stopped = false;
  private ws?: WebSocket;
  private state: NodeStatusFile['state'] = 'connecting';
  private stateSince = 0;
  private readonly frameWaiters: FrameWaiter[] = [];
  /** 本连接已收帧（open 与 nextFrame 注册之间到达的帧先落此，注册时回查）。 */
  private frameLog: Frame[] = [];
  private readonly stateWaiters: StateWaiter[] = [];
  private minuteTimer?: ReturnType<typeof setInterval>;
  private mainLoop?: Promise<void>;
  private stopResolve?: () => void;

  constructor(deps: NodeClientDeps) {
    this.d = { backoffBaseMs: 1_000, quietAfterMs: 300_000, ...deps };
  }

  /** 阻塞跑直到 stop（serve --connect 前台姿态）。 */
  async run(): Promise<void> {
    this.d.onSignal?.('SIGINT', () => void this.stop());
    this.d.onSignal?.('SIGTERM', () => void this.stop());
    this.mainLoop = this.loop();
    await new Promise<void>((resolve) => {
      this.stopResolve = resolve;
    });
    await this.mainLoop;
  }

  /** 停主循环、关连接（幂等）；打断退避睡眠立即返回。 */
  async stop(): Promise<void> {
    if (this.stopped) {
      await this.mainLoop?.catch(() => {});
      return;
    }
    this.stopped = true;
    this.clearFrameWaiters(new Error('stopped'));
    try {
      this.ws?.close(1000, 'node stopping');
    } catch { /* 竞态关闭忽略 */ }
    clearInterval(this.minuteTimer);
    this.stopResolve?.();
    await this.mainLoop?.catch(() => {});
  }

  /** 等到指定状态（测试用）；超时拒绝。 */
  waitForState(state: NodeStatusFile['state'], timeoutMs = 5_000): Promise<void> {
    if (this.state === state) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const waiter: StateWaiter = {
        state,
        resolve,
        timer: setTimeout(() => {
          const i = this.stateWaiters.indexOf(waiter);
          if (i >= 0) this.stateWaiters.splice(i, 1);
          reject(new Error(`waitForState(${state}) timeout`));
        }, timeoutMs),
      };
      this.stateWaiters.push(waiter);
    });
  }

  private async loop(): Promise<void> {
    let attempt = 0;
    let firstFailAt: number | undefined;
    while (!this.stopped) {
      this.setState('connecting');
      let everOnline: boolean;
      try {
        everOnline = await this.connectOnce();
      } catch (err) {
        // B2：STAR_ID_MISMATCH 是配置错，退避重试无意义——永久停机等人工修配置。
        if (err instanceof MultichatError && err.code === 'STAR_ID_MISMATCH') {
          this.log('星标识不符已停机，修正配置后重启 crosschat serve --connect');
          this.stopped = true;
          this.stopResolve?.();
          break;
        }
        throw err;
      }
      if (this.stopped) break;
      attempt = everOnline ? 0 : attempt + 1;
      if (attempt === 1) firstFailAt = this.d.now();
      const failedFor = firstFailAt === undefined ? 0 : this.d.now() - firstFailAt;
      const quiet = failedFor >= this.d.quietAfterMs;
      const delay = Math.min(this.d.backoffBaseMs * 2 ** Math.max(0, attempt - 1), 60_000);
      if (!quiet || attempt % 10 === 1) {
        this.log(`reconnect-wait 第 ${attempt} 次失败后 ${delay}ms 再试（连续失败 ${Math.round(failedFor / 1000)}s）`);
      }
      this.setState('reconnect-wait');
      this.writeStatus(this.d.now() + delay);
      await this.sleepInterruptible(delay);
    }
  }

  /** 一次连接生命周期；resolve(false)=从未上线即断，resolve(true)=上线后断开。 */
  private async connectOnce(): Promise<boolean> {
    const cfg = this.d.config.entries[0]!;
    const url = `ws://${cfg.host}:${cfg.port}`;
    this.frameLog = [];
    const ws = new WebSocket(url, { maxPayload: MAX_PAYLOAD_BYTES });
    this.ws = ws;
    let everOnline = false;
    let closed: () => void = () => {};
    const closedPromise = new Promise<void>((resolve) => {
      closed = resolve;
    });
    ws.once('close', () => closed());
    ws.once('error', () => closed());
    ws.on('message', (data) => {
      void this.onFrame(data.toString());
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('connect timeout')), 15_000);
        ws.once('open', () => { clearTimeout(t); resolve(); });
        ws.once('error', (err) => { clearTimeout(t); reject(err); });
      });
      const info = await this.nextFrame((f) => f.op === 'info', 10_000);
      if (info.op !== 'info' || info.proto !== PROTOCOL_VERSION) {
        throw new Error(`协议不匹配：服务端 ${info.op === 'info' ? info.proto : '?'}`);
      }
      this.syncBrokerInfo(info as InfoFrame);
      ws.send(encodeFrame({
        op: 'connect',
        proto: PROTOCOL_VERSION,
        role: 'node',
        machineId: this.d.machineId() ?? '',
        auth: cfg.key,
        ...(this.d.config.showName === undefined ? {} : { name: this.d.config.showName }),
      }));
      const verdict = await this.nextFrame((f) => f.op === 'connected' || f.op === 'error', 10_000);
      if (verdict.op === 'error') {
        throw new Error(`broker 拒绝: ${(verdict as ErrorFrame).code} ${(verdict as ErrorFrame).message}`);
      }
      everOnline = true;
      this.setState('online');
      this.log(`online（broker ${cfg.name ?? url}）`);
      this.minuteTimer = setInterval(() => {
        if (this.state === 'online') this.writeStatus(undefined);
      }, 60_000);
      await closedPromise;
      this.log('offline（连接断开）');
    } catch (err) {
      this.log(`connect 失败: ${err instanceof MultichatError ? `${err.code} ${err.message}` : err instanceof Error ? err.message : String(err)}`);
      // B2：星标识不符是永久性配置错——上抛给主循环停机（其余错误照旧退避重试）
      if (err instanceof MultichatError && err.code === 'STAR_ID_MISMATCH') throw err;
    } finally {
      clearInterval(this.minuteTimer);
      this.clearFrameWaiters(new Error('connection closed'));
      try { ws.close(); } catch { /* 已断开 */ }
      if (this.ws === ws) this.ws = undefined;
    }
    return everOnline;
  }

  /**
   * B0 星标识哨兵 + E0 星名同步（info 后、发 connect 含 key 之前）：两侧
   * starId 都有且不等 → 拒发 key 中止连接；本机缺 → 回填；info.name（星名，
   * broker 权威）与条目不一致 → 原子覆盖写回（顺带清旧 alias 键）。
   */
  private syncBrokerInfo(info: InfoFrame): void {
    const entry = this.d.config.entries[0]!;
    if (info.starId !== undefined && entry.starId !== undefined && entry.starId !== info.starId) {
      throw new MultichatError('STAR_ID_MISMATCH', '本 broker 星标识与本机配置不符——向管理员重新索取 node.json');
    }
    const patch: { starId?: string; name?: string } = {};
    if (info.starId !== undefined && entry.starId === undefined) patch.starId = info.starId;
    if (info.name !== undefined) patch.name = info.name;
    if (patch.starId === undefined && patch.name === undefined) return;
    syncNodeJsonEntry(this.d.configFile, entry, patch);
    if (patch.starId !== undefined) entry.starId = patch.starId;
    if (patch.name !== undefined) entry.name = patch.name;
  }

  private async onFrame(text: string): Promise<void> {
    const frame = parseFrame(text);
    if (frame === undefined) return;
    this.frameLog.push(frame);
    for (let i = 0; i < this.frameWaiters.length; i++) {
      const w = this.frameWaiters[i]!;
      if (w.pred(frame)) {
        clearTimeout(w.timer);
        this.frameWaiters.splice(i, 1);
        w.resolve(frame);
        return;
      }
    }
    if (frame.op === 'deliver') {
      void this.onDeliver(frame);
      return;
    }
    if (frame.op === 'status-query') {
      void this.onStatusQuery(frame);
      return;
    }
    if (frame.op === 'file-begin' || frame.op === 'file-chunk' || frame.op === 'file-end') {
      this.onFile(frame);
    }
  }

  /** E1：status-query → 本机扫描 → status-result（载荷分段见 buildStatusPayload）。 */
  private async onStatusQuery(frame: StatusQueryFrame): Promise<void> {
    try {
      const payload = await buildStatusPayload(this.d.makeSendDeps());
      this.send({ op: 'status-result', id: frame.id, ok: true, payload });
      this.log(`status-query ${frame.id} 已应答`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.send({ op: 'status-result', id: frame.id, ok: false, error });
      this.log(`status-query ${frame.id} 失败: ${error}`);
    }
  }

  private async onDeliver(frame: DeliverFrame): Promise<void> {
    // B1：经此腿投递签发的 ref 盖上本连接条目的星标识（握手时已校验/回填的
    // entries[0]）——回信方按它选本机条目，路由成为纯函数 f(ref, node.json)。
    const starId = this.d.config.entries[0]!.starId;
    const deps = this.d.makeSendDeps();
    const result = await deliverViaRunSend(frame, starId === undefined ? deps : { ...deps, refStarId: starId });
    this.send(result);
    this.log(`deliver ${frame.id} → ${result.status}${result.status === 'error' ? ` (${result.code})` : ''}`);
  }

  private onFile(frame: FileBeginFrame | FileChunkFrame | FileEndFrame): void {
    if (frame.op === 'file-begin') {
      this.send(this.d.fileInbox.begin(frame));
      return;
    }
    if (frame.op === 'file-chunk') {
      if (!this.d.fileInbox.chunk(frame)) {
        this.send({ op: 'file-result', id: frame.id, ok: false, error: '分块失序或未知 id——请重新 begin 续传' });
      }
      return;
    }
    const res = this.d.fileInbox.end(frame.id);
    this.send(res);
    this.log(`file ${frame.id} ${res.ok ? `→ ${res.path}` : `失败: ${res.error}`}`);
  }

  private nextFrame(pred: (f: Frame) => boolean, timeoutMs: number): Promise<Frame> {
    const seen = this.frameLog.find(pred);
    if (seen !== undefined) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const waiter: FrameWaiter = {
        pred,
        resolve,
        reject,
        timer: setTimeout(() => {
          const i = this.frameWaiters.indexOf(waiter);
          if (i >= 0) this.frameWaiters.splice(i, 1);
          reject(new Error('frame timeout'));
        }, timeoutMs),
      };
      this.frameWaiters.push(waiter);
    });
  }

  private clearFrameWaiters(err: Error): void {
    for (const w of this.frameWaiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(err);
    }
  }

  private send(frame: Frame): void {
    if (this.ws !== undefined && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeFrame(frame));
    }
  }

  private setState(state: NodeStatusFile['state']): void {
    this.state = state;
    this.stateSince = this.d.now();
    this.writeStatus(undefined);
    for (let i = this.stateWaiters.length - 1; i >= 0; i--) {
      const w = this.stateWaiters[i]!;
      if (w.state !== state) continue;
      clearTimeout(w.timer);
      this.stateWaiters.splice(i, 1);
      w.resolve();
    }
  }

  private writeStatus(nextAttemptAt: number | undefined): void {
    const entry = this.d.config.entries[0]!;
    const status: NodeStatusFile = {
      state: this.state,
      brokerAlias: entry.name ?? `${entry.host}:${entry.port}`,
      since: new Date(this.stateSince).toISOString(),
      lastUpdated: new Date(this.d.now()).toISOString(),
      ...(this.d.version === undefined ? {} : { version: this.d.version }),
      ...(nextAttemptAt === undefined ? {} : { nextAttemptAt: new Date(nextAttemptAt).toISOString() }),
    };
    try {
      mkdirSync(dirname(this.d.statusFile), { recursive: true });
      writeFileSync(this.d.statusFile, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
    } catch {
      // 状态文件写失败不倒客户端
    }
  }

  /** 退避睡眠可被 stop 打断（100ms 片轮询），避免 SIGINT 卡最长 60s。 */
  private async sleepInterruptible(ms: number): Promise<void> {
    let left = ms;
    while (left > 0 && !this.stopped) {
      const slice = Math.min(left, 100);
      await new Promise((resolve) => setTimeout(resolve, slice));
      left -= slice;
    }
  }

  private log(event: string): void {
    this.d.log(`${new Date(this.d.now()).toISOString()} ${event}`);
  }
}
