/**
 * 节点客户端（票B B2）：`crosschat serve --connect` 的常驻腿——连 broker、
 * 收 deliver 帧进程内调发送应用接口（与 ssh 远端 CLI 同权：会话状态/限流/发件箱
 * 全是本机既有行为）、收 file-* 帧落盘 inbox。断线指数退避 1s→2s→…封顶
 * 60s 永不放弃；连续失败 ≥5 分钟进静音模式（日志每 10 次一条）。
 */
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createNativeSessionOperations } from '../application/session-operations.js';
import type { NativeOperationProvider } from '../application/session-operations.js';
import type { SessionOperationFrame } from './protocol.js';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { WebSocket } from 'ws';
import { MultichatError } from '../errors.js';
import {
  CAP_MULTI_STAR,
  CAP_SESSION_MEMBERS,
  encodeFrame,
  hasCap,
  MAX_PAYLOAD_BYTES,
  parseFrame,
  PROTOCOL_VERSION,
  sanitizeTool,
} from './protocol.js';
import type {
  ConnectedFrame,
  DeliverFrame,
  ErrorFrame,
  FileBeginFrame,
  FileChunkFrame,
  FileEndFrame,
  Frame,
  InfoFrame,
  ResultFrame,
  SessionMemberDecl,
  SocketLike,
} from './protocol.js';
import { sendMessage } from '../application/send/index.js';
import { formatSendResult } from '../application/send/format.js';
import type { SendDeps } from '../application/send/types.js';
import type { CodexThreadWithMeta } from '../codex/discovery.js';
import { createLegacyMemberProviders, readMemberSnapshot } from '../application/members/index.js';
import type { MemberProvider, MemberProviderFactory } from '../application/members/index.js';
import { FileInbox } from './file-channel.js';
import { sanitizeName, setConnectedNodeShowNameFor } from './registry.js';
import { PIPE_PREFIX } from '../platform/pipe-transport.js';
import { normalizeMid } from '../platform/machine-id.js';
import type { StatusPayload, StatusQueryFrame } from './protocol.js';

import { syncNodeJsonEntry } from './node-config.js';
import type { BrokerEntry, NodeConfig } from './node-config.js';
import { readNodeRevocation, writeNodeRevocation } from './revocation.js';
import { parseDiscoveryRequest, parseDiscoveryResponse } from '../application/discovery/boundary.js';
import type { DiscoveryEndpoint, DiscoveryRequest } from '../application/discovery/model.js';
import { untilAborted } from '../application/sessions/reading.js';
import type { DiscoverQueryFrame } from './protocol.js';
export { formatBrokerEntry, NOT_JOINED_MESSAGE, readNodeConfig, syncNodeJsonEntry } from './node-config.js';
export type { BrokerEntry, NodeConfig } from './node-config.js';

/**
 * deliver 帧 → 本机 typed 发送结果（broker 侧 deliverLocal 同用此桥）：
 * payload=正文，to/conversation/origin 透传；origin 是发送机的
 * encodeOriginIdentity 编码（ssh 远端 CLI 的 --origin 同语义）。
 * 018：sessionId 在场=会话级直达（三段寻址命中星成员）——注入 targetSessionId，
 * id 定位优先（deliver.to 仅占位，名字解析跳过）。
 */
export async function deliverViaRunSend(frame: DeliverFrame, deps: SendDeps): Promise<ResultFrame> {
  try {
    const result = await sendMessage(
      {
        to: frame.sessionId === undefined ? frame.to : (frame.to ?? frame.sessionId),
        ...(frame.sessionId === undefined ? {} : { targetSessionId: frame.sessionId }),
        conversation: frame.conversation,
        bodyArg: frame.payload,
        origin: frame.origin,
        delivery: frame.delivery,
      },
      frame.fromMachine === undefined ? deps : { ...deps, fromMachine: frame.fromMachine },
    );
    return {
      op: 'result', id: frame.id,
      // Existing wire status remains unchanged; queued evidence is in output.queued.
      status: result.receipt.status,
      turn: result.receipt.turn === undefined ? undefined : String(result.receipt.turn),
      replyRef: result.receipt.replyRef,
      output: formatSendResult(result, true),
    };
  } catch (error) {
    return {
      op: 'result', id: frame.id, status: 'error',
      code: error instanceof MultichatError ? error.code : 'INTERNAL',
      message: error instanceof Error ? error.message : String(error),
    };
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
  state: 'connecting' | 'online' | 'reconnect-wait' | 'revoked';
  /** E0 起记录解析后的星名（无星名退回 host:port）；字段名沿用旧版兼容。 */
  brokerAlias: string;
  since: string;
  lastUpdated: string;
  nextAttemptAt?: string;
  /** F1：本守护的 crosschat 版本（doctor 版本对账）；旧守护缺省。 */
  version?: string;
  /** 026：守护进程 pid（doctor 新鲜文件验活防幽灵）；旧守护缺省。 */
  pid?: number;
}

export interface NodeClientDeps {
  config: NodeConfig;
  /** B0：node.json 路径——starId 回填写回原文件用。 */
  configFile: string;
  machineId: () => string | undefined;
  /**
   * 守护状态文件（status-node[-<星>].json；doctor/--stop 消费）。032 起可选：
   * broker 进程内挂的聚合器不是独立进程（同 pid 同生命周期，broker 行全覆盖）
   * ——省略即不写，status 视图不出现幽灵"守护"行。
   */
  statusFile?: string;
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
  /** 018：attach 管道标签（缺省=条目星名→starId；测试注入唯一值防撞名）。 */
  attachLabel?: string;
  /** 018：成员活性核验周期（缺省 30s 与心跳同量级；测试注入短值）。 */
  memberCheckMs?: number;
  /** 018：codex 线程活性核验的 CODEX_HOME（缺省真 codexHomeDir；测试注入临时目录保密闭）。 */
  codexHome?: string;
  /** Optional provider capabilities; the default preserves native reconciliation policy. */
  memberProviders?: MemberProviderFactory;
  /**
   * 018（9b 批二）：降级告警直达命令面（stdout/stderr 一行，不只日志）——
   * broker 无 session-members cap 时调用一次。缺省不打印（嵌入式调用方零噪音）。
   */
  warn?(line: string): void;
  /**
   * 022：连接工厂注入（缺省真开 ws://）——broker 进程内挂本机聚合器时注入
   * 本进程虚拟 socket（省回环 WS 与第二进程，见 serve 面自挂装配）。
   */
  makeSocket?: (url: string) => SocketLike;
  /** Current read-only discovery; never substitutes the legacy status scan. */
  discover?: DiscoveryEndpoint['execute'];
  operationProviders?: readonly NativeOperationProvider[];
}

/** 018：会话成员表条目（内存态——零新持久文件；连接断/失活即消失）。 */
interface MemberEntry {
  sessionId: string;
  name?: string;
  /** 020：工具限定词（claude/codex/未来适配器；启动器/adopt 天然知道 side 直接填）。 */
  tool?: string;
  /** 机器限定旧名（machine 缺省=同机旧名）。 */
  extends?: { machine?: string; name: string };
  /** 029 --rm：临时成员——对账验死即报 member-remove（零痕迹），不留下线册位。 */
  temporary?: boolean;
  selectionOwned?: boolean;
}

/**
 * 018：本（机器,星）attach 管道名——管道名含星名可发现（启动器据 node.json
 * 条目同源计算）；win named pipe / unix domain socket 同名约定，复用平台
 * 管道层前缀（PIPE_PREFIX）。dir=tcp 状态目录（UDS 落盘处）。
 */
export function attachPipePath(entry: BrokerEntry, dir: string, labelOverride?: string): string {
  const label = labelOverride ?? entry.name ?? entry.starId ?? 'star';
  return process.platform === 'win32'
    ? `${PIPE_PREFIX}crosschat-attach-${label}`
    : join(dir, `attach-${label}.sock`);
}

/**
 * 018 attach/detach IPC 帧的成员声明校验：sessionId 非空；名字净化后禁冒号
 * （tcp 三段寻址保留字，与星名同规则）；extends 收敛为 {machine?,name}。
 */
function parseMemberDecl(raw: unknown): { ok: true; entry: MemberEntry } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object') return { ok: false, error: '成员声明形状错误（须为对象）' };
  const r = raw as { sessionId?: unknown; name?: unknown; tool?: unknown; extends?: unknown; temporary?: unknown; selectionOwned?: unknown };
  if (typeof r.sessionId !== 'string' || r.sessionId === '') {
    return { ok: false, error: '成员声明缺 sessionId（成员键=会话 ID，启动器 spawn 后必持有）' };
  }
  const name = typeof r.name === 'string' ? sanitizeName(r.name) : undefined;
  if (name !== undefined && name.includes(':')) {
    return { ok: false, error: `会话名 ${name} 禁含冒号（tcp:<星>:<机器>:<会话> 三段寻址保留字）` };
  }
  // 020：tool 值规约——小写字母数字 ≤16（禁冒号禁斜杠）；非法声明拒收教学（大小写归一）
  let tool: string | undefined;
  if (r.tool !== undefined) {
    tool = sanitizeTool(r.tool);
    if (tool === undefined) {
      return { ok: false, error: `工具限定词 ${String(r.tool)} 非法（小写字母/数字，≤16 字符，禁冒号禁斜杠）` };
    }
  }
  let ext: { machine?: string; name: string } | undefined;
  if (r.extends !== undefined) {
    if (typeof r.extends === 'string') {
      const oldName = sanitizeName(r.extends);
      if (oldName === undefined || oldName.includes(':')) {
        return { ok: false, error: 'extends 旧会话名非法（非空、禁冒号）' };
      }
      ext = { name: oldName };
    } else if (typeof r.extends === 'object' && r.extends !== null) {
      const q = r.extends as { machine?: unknown; name?: unknown };
      const oldName = typeof q.name === 'string' ? sanitizeName(q.name) : undefined;
      const machine = typeof q.machine === 'string' ? sanitizeName(q.machine) : undefined;
      if (oldName === undefined || oldName.includes(':')) {
        return { ok: false, error: 'extends 旧会话名非法（非空、禁冒号）' };
      }
      ext = machine === undefined ? { name: oldName } : { machine, name: oldName };
    } else {
      return { ok: false, error: 'extends 须为旧会话名字符串或 {machine,name}' };
    }
  }
  return {
    ok: true,
    entry: {
      sessionId: r.sessionId,
      ...(name === undefined ? {} : { name }),
      ...(tool === undefined ? {} : { tool }),
      ...(ext === undefined ? {} : { extends: ext }),
      ...(r.temporary === true ? { temporary: true } : {}),
      ...(r.selectionOwned === true ? { selectionOwned: true } : {}),
    },
  };
}

/** MemberEntry → sessions 帧声明元素（extends 还原为字符串/对象双形态）。 */
function memberToDecl(m: MemberEntry): SessionMemberDecl {
  return {
    sessionId: m.sessionId,
    ...(m.name === undefined ? {} : { name: m.name }),
    ...(m.tool === undefined ? {} : { tool: m.tool }),
    ...(m.extends === undefined
      ? {}
      : { extends: m.extends.machine === undefined ? m.extends.name : { machine: m.extends.machine, name: m.extends.name } }),
    ...(m.temporary === true ? { temporary: true } : {}),
    ...(m.selectionOwned === true ? { selectionOwned: true } : {}),
  };
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

interface NodeDiscoveryRead {
  socket: SocketLike;
  controller: AbortController;
}

export class NodeClient {
  private readonly d: NodeClientDeps & { backoffBaseMs: number; quietAfterMs: number; memberCheckMs: number };
  private stopped = false;
  private ws?: SocketLike;
  private authenticatingSocket?: SocketLike;
  private discoverySocket?: SocketLike;
  private readonly discoveryReads = new Map<string, NodeDiscoveryRead>();
  private state: NodeStatusFile['state'] = 'connecting';
  private stateSince = 0;
  private readonly frameWaiters: FrameWaiter[] = [];
  /** 本连接已收帧（open 与 nextFrame 注册之间到达的帧先落此，注册时回查）。 */
  private frameLog: Frame[] = [];
  private readonly pendingErases = new Map<string, string>();
  private readonly membershipModes = new Map<string, boolean>();
  private readonly memberClaims = new Map<string, Map<string, Socket | undefined>>();
  private readonly operationReads = new Map<string, { socket: SocketLike; controller: AbortController }>();
  private readonly stateWaiters: StateWaiter[] = [];
  private minuteTimer?: ReturnType<typeof setInterval>;
  private mainLoop?: Promise<void>;
  private stopResolve?: () => void;
  /** 018：会话成员表（内存态，跨重连存续——重连后全量重播）。 */
  private readonly members = new Map<string, MemberEntry>();
  /**
   * 028 --rm 墓碑：erase 删册的会话不再由对账循环复活（进程退出有迟滞——
   * erase 与切片回执竞态会把刚删的活会话拉回册，破"零痕迹"）。显式 attach
   * 重新入星即解除（启动器/adopt 是有意的再注册）。
   */
  private readonly erased = new Set<string>();
  /** 018：attach IPC 服务端（每（本机,星）一条；首度上线时起，stop 关）。 */
  private attachServer?: Server;
  /** 018：attach 连接自持（stop 时全毁——win 管道名随最后句柄释放）。 */
  private readonly attachSockets = new Set<import('node:net').Socket>();
  private memberTimer?: ReturnType<typeof setInterval>;
  /** 018：broker 会话级能力（info.caps 协商；false=老 broker，成员声明不发送）。 */
  private brokerSessionCap = false;
  /** Identity belongs to one authenticated WS lifetime, never a config snapshot. */
  private attachIdentity?: { socket: SocketLike; starId: string; machine: string };
  /** 018（9b）：降级告警只出声一次（重连老 broker 不刷屏；升级 broker 后按新能力行事）。 */
  private warnedNoCap = false;
  /** 028：对账循环重入闸（members-query 往返慢于 tick 时跳过本轮，防等待者堆积）。 */
  private reconciling = false;

  constructor(deps: NodeClientDeps) {
    this.d = { backoffBaseMs: 1_000, quietAfterMs: 300_000, memberCheckMs: 30_000, ...deps };
  }

  /** 阻塞跑直到 stop（serve --connect 前台姿态）。 */
  async run(): Promise<void> {
    if (this.d.config.entries.length === 0) throw new MultichatError('USAGE', '本机尚未配置 TCP 连接，不能启动节点守护。');
    if (readNodeRevocation(this.d.configFile, this.d.config.entries[0]!) !== undefined) {
      this.setState('revoked');
      this.log('节点凭证已撤销，自动重连已暂停；换钥后显式重新连接');
      return;
    }
    this.d.onSignal?.('SIGINT', () => void this.stop());
    this.d.onSignal?.('SIGTERM', () => void this.stop());
    const stopped = new Promise<void>((resolve) => { this.stopResolve = resolve; });
    this.memberTimer = setInterval(() => void this.checkMemberLiveness(), this.d.memberCheckMs);
    this.mainLoop = this.loop();
    await stopped;
    await this.mainLoop;
  }

  /** 停主循环、关连接（幂等）；打断退避睡眠立即返回。 */
  async stop(): Promise<void> {
    if (this.stopped) {
      await this.mainLoop?.catch(() => {});
      return;
    }
    this.stopped = true;
    this.attachIdentity = undefined;
    this.cancelDiscoveryReads();
    this.clearFrameWaiters(new Error('stopped'));
    try {
      this.ws?.close(1000, 'node stopping');
    } catch { /* 竞态关闭忽略 */ }
    clearInterval(this.minuteTimer);
    clearInterval(this.memberTimer);
    this.closeAttachServer();
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
      if (this.stopped || this.state === 'revoked') break;
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
    // 022：ws 工厂可注入（broker 内挂聚合器走本进程虚拟 socket；缺省真开 ws://）
    const ws = this.d.makeSocket !== undefined ? this.d.makeSocket(url) : new WebSocket(url, { maxPayload: MAX_PAYLOAD_BYTES });
    this.ws = ws;
    let everOnline = false;
    let closed: () => void = () => {};
    const closedPromise = new Promise<void>((resolve) => {
      closed = resolve;
    });
    const onClosed = () => {
      this.cancelDiscoveryReads(ws);
      if (this.attachIdentity?.socket === ws) this.attachIdentity = undefined;
      closed();
    };
    ws.once('close', onClosed);
    ws.once('error', onClosed);
    ws.on('message', (data) => {
      void this.onFrame(String(data), ws);
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
      // 018（9b）：caps 协商——info.caps 不含会话成员标识=老 broker（proto:1），
      // 成员声明不发送（发了也被静默丢），日志显性留痕；命令面告警批二接。
      this.brokerSessionCap = hasCap((info as InfoFrame).caps, CAP_SESSION_MEMBERS);
      if (!this.brokerSessionCap) {
        this.log('broker 不支持会话级星成员（proto:1）——已降级机器级，本机成员声明不发送');
        if (!this.warnedNoCap) {
          this.warnedNoCap = true;
          // 9b：命令面一行告警（不只日志）——detach 场景由 serve 父进程预检补声
          this.d.warn?.('broker 不支持会话成员（proto:3），已降级机器级——本机会话的入星声明不生效（机器级收发不受影响）');
        }
      }
      this.authenticatingSocket = ws;
      const connectedMachine = this.d.machineId() ?? '';
      ws.send(encodeFrame({
        op: 'connect',
        proto: PROTOCOL_VERSION,
        role: 'node',
        machineId: connectedMachine,
        auth: cfg.key,
        // 036：自报名取条目级覆盖 ?? 顶层全局（修订 017 单一事实源为双态）
        name: cfg.showName ?? this.d.config.showName ?? '',
        // 032 非兼容升级：multi-star 能力声明是新版腿的通行证（无它即旧版被拒）
        caps: [CAP_SESSION_MEMBERS, CAP_MULTI_STAR],
      }));
      const verdict = await this.nextFrame((f) => f.op === 'connected' || f.op === 'error', 10_000);
      if (this.stopped) return false;
      if (verdict.op === 'error') {
        throw new Error(`broker 拒绝: ${(verdict as ErrorFrame).code} ${(verdict as ErrorFrame).message}`);
      }
      // 022 多星：info 无星标识（握手时序倒置——broker 见钥匙才知星）——connected
      // 帧补核，同 syncBrokerInfo 预检语义（不一致即 STAR_ID_MISMATCH 停机等修配置）
      if ((info as InfoFrame).starId === undefined && (verdict as ConnectedFrame).starId !== undefined) {
        this.syncBrokerInfo(verdict as ConnectedFrame);
      }
      if (verdict.op === 'connected' && typeof verdict.starId === 'string' && verdict.starId !== '') {
        this.attachIdentity = { socket: ws, starId: verdict.starId, machine: connectedMachine };
      }
      everOnline = true;
      this.discoverySocket = ws;
      this.setState('online');
      this.log(`online（broker ${cfg.name ?? url}）`);
      // 018：首度上线起 attach 管道（此后跨重连常驻）。
      this.startAttachServer();
      // 018：跨重连存续的成员先全量重播（活的立即回在线）；空表跳过——028 起
      // 空重播=该机册条目翻下线，当前启动器重连声明或显式管理后恢复。
      if (this.members.size > 0) this.sendSessions();
      // 上线即对账：同步权威属性并检查已声明成员，不从发现结果新增声明。
      void this.checkMemberLiveness();
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
      this.cancelDiscoveryReads(ws);
      clearInterval(this.minuteTimer);
      this.clearFrameWaiters(new Error('connection closed'));
      try { ws.close(); } catch { /* 已断开 */ }
      if (this.ws === ws) this.ws = undefined;
      if (this.authenticatingSocket === ws) this.authenticatingSocket = undefined;
      if (this.discoverySocket === ws) this.discoverySocket = undefined;
      if (this.attachIdentity?.socket === ws) this.attachIdentity = undefined;
    }
    return everOnline;
  }

  /**
   * B0 星标识哨兵 + E0 星名同步（info 后、发 connect 含 key 之前）：两侧
   * starId 都有且不等 → 拒发 key 中止连接；本机缺 → 回填；info.name（星名，
   * broker 权威）与条目不一致 → 原子覆盖写回（顺带清旧 alias 键）。
   * 022：多星 broker 星标识在 connected 帧——同一函数复用（见 connectOnce 补核）。
   */
  private syncBrokerInfo(info: Pick<InfoFrame, 'starId' | 'name'>): void {
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

  private async onFrame(text: string, socket: SocketLike): Promise<void> {
    if (this.stopped || this.ws !== socket) return;
    const frame = parseFrame(text);
    if (frame === undefined) return;
    if (frame.op === 'session-operation') { void this.onSessionOperation(frame, socket); return; }
    if (frame.op === 'session-operation-cancel') {
      const read = this.operationReads.get(frame.id);
      if (read?.socket === socket) { this.operationReads.delete(frame.id); read.controller.abort(); }
      return;
    }
    if (frame.op === 'node-name-set') {
      const identity = this.attachIdentity;
      const entry = this.d.config.entries[0];
      if (this.state !== 'online' || !identity || identity.socket !== socket || identity.starId !== frame.starId || normalizeMid(identity.machine) !== frame.machineId || !entry || entry.starId !== frame.starId || this.authenticatingSocket !== socket) return;
      let applied: { showName: string; name?: string };
      try { applied = setConnectedNodeShowNameFor(this.d.configFile, { ...entry, starId: frame.starId }, frame.name); }
      catch {
        try { socket.send(encodeFrame({ op: 'node-name-result', id: frame.id, starId: frame.starId, machineId: frame.machineId, ok: false, saved: false, applied: false, error: '无法核实并保存当前星节点名称。' })); } catch { /* No write occurred and the broker owns the missing-receipt outcome. */ }
        return;
      }
      if (applied.showName === '') { delete entry.showName; this.d.config.showName = applied.name; }
      else entry.showName = applied.showName;
      try { socket.send(encodeFrame({ op: 'node-name-result', id: frame.id, starId: frame.starId, machineId: frame.machineId, ok: true, saved: true, applied: true, ...applied })); }
      catch { /* Persisted and applied: a lost reply must remain uncertain, never a false rejection. */ }
      return;
    }
    if (frame.op === 'credential-revoked') {
      const entry = this.d.config.entries[0]!;
      if (frame.kind !== 'node' || this.authenticatingSocket !== socket
        || (entry.starId !== undefined && frame.starId !== entry.starId)) return;
      this.cancelDiscoveryReads(socket);
      // Persist before closing attach IPC: launcher supervisors must observe the pause before reconnecting.
      let persisted = false;
      try {
        writeNodeRevocation(this.d.configFile, entry, frame.starId, this.d.now());
        persisted = true;
      } catch {
        this.log('撤权暂停记录写入失败，请检查 tcp 目录写权限');
      }
      this.setState('revoked');
      this.log('节点凭证已撤销，自动重连已暂停；换钥后显式重新连接');
      if (persisted) {
        void this.stop();
      } else {
        // Keep the paused IPC owner alive when persistence fails, so launchers cannot replace it.
        clearInterval(this.minuteTimer);
        clearInterval(this.memberTimer);
        this.clearFrameWaiters(new Error('credential revoked'));
        this.startAttachServer();
        try { socket.close(1008, 'credential revoked'); } catch { /* Already closed. */ }
      }
      return;
    }
    if (frame.op === 'discover-query') {
      void this.onDiscoveryQuery(frame, socket);
      return;
    }
    if (frame.op === 'discover-cancel') {
      if (this.discoverySocket !== socket) return;
      const read = this.discoveryReads.get(frame.id);
      if (read?.socket === socket) {
        this.discoveryReads.delete(frame.id);
        read.controller.abort();
      }
      return;
    }
    this.frameLog.push(frame);
    for (let i = 0; i < this.frameWaiters.length; i++) {
      const w = this.frameWaiters[i]!;
      if (w.pred(frame)) {
        clearTimeout(w.timer);
        this.frameWaiters.splice(i, 1);
        // 028：消费即出缓冲——周期对账（members-query 每 tick 一问）不吃旧回执
        const consumed = this.frameLog.indexOf(frame);
        if (consumed >= 0) this.frameLog.splice(consumed, 1);
        w.resolve(frame);
        return;
      }
    }
    if (frame.op === 'deliver') {
      void this.onDeliver(frame);
      return;
    }
    if (frame.op === 'member-remove') {
      // 028：broker 册删除的归属机清表推送（管理删/member-remove 命令侧）——
      // 本地移出声明集并重播，防下次全量重播把条目带回册；墓碑挡对账复活
      this.erased.add(frame.target);
      this.membershipModes.delete(frame.target);
      this.memberClaims.delete(frame.target);
      if (this.members.delete(frame.target)) {
        this.log(`member-removed ${frame.target.slice(0, 8)}（broker 册删除推送）`);
        this.sendSessions();
      }
      return;
    }
    if (frame.op === 'status-query') {
      void this.onStatusQuery(frame);
      return;
    }
    if (frame.op === 'file-begin' || frame.op === 'file-chunk' || frame.op === 'file-end') {
      this.onFile(frame);
    }
    if (frame.op === 'error') {
      // 018：无等待者兜到的 broker 回执（如 extends 冲突）——上日志不静默
      this.log(`broker 回执错误 ${(frame as ErrorFrame).code}: ${(frame as ErrorFrame).message}`);
    }
  }

  private cancelDiscoveryReads(socket?: SocketLike): void {
    for (const [id, read] of this.operationReads) {
      if (socket !== undefined && read.socket !== socket) continue;
      this.operationReads.delete(id); read.controller.abort();
    }
    if (socket === undefined || this.discoverySocket === socket) this.discoverySocket = undefined;
    for (const [id, read] of this.discoveryReads) {
      if (socket !== undefined && read.socket !== socket) continue;
      this.discoveryReads.delete(id);
      read.controller.abort();
    }
  }

  private async onSessionOperation(frame: SessionOperationFrame, socket: SocketLike): Promise<void> {
    const identity = this.attachIdentity;
    if (this.state !== 'online' || !identity || identity.socket !== socket || identity.starId !== frame.starId
      || normalizeMid(identity.machine) !== frame.machineId || this.authenticatingSocket !== socket) return;
    const { request, ...target } = frame;
    const reply = (value: Pick<import('./protocol.js').SessionOperationResultFrame, 'description' | 'result'>) => {
      if (this.ws === socket && !this.stopped && this.state === 'online') {
        try { socket.send(encodeFrame({ ...target, op: 'session-operation-result', ...value })); } catch { /* Result remains uncertain. */ }
      }
    };
    if (!this.d.discover || this.operationReads.size >= 8 || this.operationReads.has(frame.id)) {
      reply({ result: { kind: 'rejected', message: '节点原生操作入口不可用或当前请求过多。' } }); return;
    }
    const controller = new AbortController();
    this.operationReads.set(frame.id, { socket, controller });
    const current = () => !controller.signal.aborted && !this.stopped && this.ws === socket && this.state === 'online' && this.attachIdentity === identity;
    const operations = createNativeSessionOperations({ discovery: { execute: this.d.discover }, providers: this.d.operationProviders,
      adopt: async (item, tool) => {
        if (!current()) throw new Error('Node context changed');
        const previous = this.members.get(item.ref.nativeId);
        if (previous?.tool !== undefined && previous.tool !== tool) throw new Error('Native provider conflict');
        const temporary = frame.membership?.temporary ?? this.membershipModes.get(item.ref.nativeId) ?? previous?.temporary;
        this.members.set(item.ref.nativeId, { sessionId: item.ref.nativeId, tool,
          ...(item.name === null ? {} : { name: item.name }), ...(temporary === true ? { temporary: true } : {}) });
        // Repeating adoption cannot turn a temporary launch into a manual lifetime.
        if (temporary !== true) {
          const claims = this.memberClaims.get(item.ref.nativeId) ?? new Map<string, Socket | undefined>();
          claims.set('manual', undefined); this.memberClaims.set(item.ref.nativeId, claims);
        } else if (previous?.selectionOwned || frame.membership?.selectionOwned) this.members.get(item.ref.nativeId)!.selectionOwned = true;
        this.erased.delete(item.ref.nativeId); this.pendingErases.delete(item.ref.nativeId);
        this.sendSessions();
      },
      renamed: async (item) => {
        if (!current()) throw new Error('Node context changed');
        const member = this.members.get(item.ref.nativeId);
        if (!member || member.tool !== item.ref.providerId || item.name === null) throw new Error('Member changed');
        member.name = item.name; this.sendSessions();
      },
    });
    try {
      const ref = { contextId: 'local', providerId: frame.providerId, nativeId: frame.nativeId };
      if (request.kind === 'describe') {
        const description = await operations.describe(ref, controller.signal);
        if (current()) reply({ description });
      } else {
        const result = await operations.apply({ ...request, ref, signal: controller.signal });
        if (current()) reply({ result });
      }
    } catch { if (current()) reply({ result: { kind: request.kind === 'apply' ? 'uncertain' : 'rejected', message: '节点操作未取得有效结果，请刷新核实。' } }); }
    finally { this.operationReads.delete(frame.id); controller.abort(); }
  }

  private async onDiscoveryQuery(frame: DiscoverQueryFrame, socket: SocketLike): Promise<void> {
    const fail = (error: string) => {
      if (this.ws === socket && socket.readyState === WebSocket.OPEN && !this.stopped) socket.send(encodeFrame({ op: 'discover-result', id: frame.id, ok: false, error }));
    };
    if (this.discoverySocket !== socket || this.state !== 'online') { fail('NOT_AUTHENTICATED'); return; }
    let request: DiscoveryRequest;
    try { request = parseDiscoveryRequest(frame.request); }
    catch { fail('INVALID_REQUEST'); return; }
    if (this.d.discover === undefined) { fail('NOT_READY'); return; }
    if (this.discoveryReads.has(frame.id)) { fail('DUPLICATE_REQUEST'); return; }
    if (this.discoveryReads.size >= 8) { fail('BUSY'); return; }
    const read: NodeDiscoveryRead = { socket, controller: new AbortController() };
    this.discoveryReads.set(frame.id, read);
    const current = () => !this.stopped && this.ws === socket && this.discoverySocket === socket && this.state === 'online'
      && socket.readyState === WebSocket.OPEN && !read.controller.signal.aborted && this.discoveryReads.get(frame.id) === read;
    try {
      const input = await untilAborted(this.d.discover(request, { contextId: 'local', signal: read.controller.signal }), read.controller.signal);
      if (!current()) return;
      const result = parseDiscoveryResponse(input);
      if (result.op !== request.op) { fail('INVALID_RESULT'); return; }
      if (result.op === 'detail' && request.op === 'detail' && result.detail.item !== null) {
        const ref = result.detail.item.ref;
        if (ref.providerId !== request.providerId || ref.nativeId !== request.nativeId || (ref.referenceKind ?? 'native') !== (request.referenceKind ?? 'native')) { fail('INVALID_RESULT'); return; }
      }
      const payload = encodeFrame({ op: 'discover-result', id: frame.id, ok: true, result });
      if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) { fail('INVALID_RESULT'); return; }
      socket.send(payload);
    } catch {
      if (current()) fail('DISCOVERY_FAILED');
    } finally {
      if (this.discoveryReads.get(frame.id) === read) this.discoveryReads.delete(frame.id);
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
    // 024 方案3：星名一并注入（信封正向坐标星段）——无名条目退 starId 前缀，
    // 选星语法星名/starId 前缀都认。
    const entry = this.d.config.entries[0]!;
    const starId = entry.starId;
    const starName = entry.name ?? starId;
    const deps = this.d.makeSendDeps();
    const result = await deliverViaRunSend(frame, {
      ...deps,
      ...(starId === undefined ? {} : { refStarId: starId }),
      ...(starName === undefined ? {} : { fromStarName: starName }),
    });
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

  /**
   * 018：attach IPC 服务端——每（本机,星）一条 named pipe / UDS（管道名含星名
   * 可发现，启动器据 node.json 同源计算）。帧为换行分隔 JSON：attach/detach/
   * sync（全量对账），逐帧回执 {ok} 一行。同用户 ACL：UDS 落监听后收紧 0600；
   * win named pipe 默认 DACL 即创建者可写。监听失败只降级（日志留痕）不倒守护。
   */
  private startAttachServer(): void {
    if (this.attachServer !== undefined) return;
    const pipePath = attachPipePath(this.d.config.entries[0]!, dirname(this.d.configFile), this.d.attachLabel);
    const server = createServer((socket) => {
      this.attachSockets.add(socket);
      socket.on('close', () => {
        this.attachSockets.delete(socket);
        for (const [id, claims] of this.memberClaims) {
          for (const [claim, owner] of claims) if (owner === socket) this.releaseMemberClaim(id, claim, socket);
        }
      });
      let buf = '';
      socket.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        for (;;) {
          const idx = buf.indexOf('\n');
          if (idx < 0) break;
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (line === '') continue;
          this.handleAttachLine(line, socket, (reply) => {
            try {
              socket.write(`${JSON.stringify(reply)}\n`);
            } catch {
              // 对端已断开——回执尽力而为
            }
          });
        }
      });
      socket.on('error', () => socket.destroy());
    });
    server.on('error', (err) => {
      this.attachServer = undefined;
      this.log(`attach 管道 ${pipePath} 监听失败（${err instanceof Error ? err.message : String(err)}）——会话入星不可用`);
    });
    server.listen({ path: pipePath }, () => {
      if (process.platform !== 'win32') {
        try {
          chmodSync(pipePath, 0o600);
        } catch {
          // ACL 收紧尽力而为
        }
      }
      this.log(`attach 管道 ${pipePath} 已监听`);
    });
    this.attachServer = server;
  }

  private closeAttachServer(): void {
    const server = this.attachServer;
    if (server === undefined) return;
    this.attachServer = undefined;
    for (const socket of this.attachSockets) {
      try {
        socket.destroy();
      } catch {
        // 已断开忽略
      }
    }
    this.attachSockets.clear();
    try {
      server.close(() => {});
    } catch {
      // 已关闭忽略
    }
  }

  /** attach IPC 单帧处理：attach/detach/sync/status，成员表变化即重播 sessions 帧。 */
  private handleAttachLine(
    line: string,
    socket: Socket,
    reply: (r: { ok: true } | { ok: true; online: boolean; brokerCap: boolean; members: SessionMemberDecl[]; starId?: string; machine?: string } | { ok: false; error: string }) => void,
  ): void {
    if (this.state === 'revoked') {
      reply({ ok: false, error: '节点凭证已撤销，自动重连已暂停；换钥后显式重新连接' });
      return;
    }
    let req: unknown;
    try {
      req = JSON.parse(line);
    } catch {
      return reply({ ok: false, error: 'attach 帧不是合法 JSON' });
    }
    if (req === null || typeof req !== 'object') {
      return reply({ ok: false, error: 'attach 帧形状错误' });
    }
    const r = req as { op?: unknown; sessionId?: unknown; sessions?: unknown; erase?: unknown; claimId?: unknown };
    if (r.claimId !== undefined && (typeof r.claimId !== 'string' || r.claimId.length === 0 || r.claimId.length > 128)) {
      return reply({ ok: false, error: 'claimId 必须是有效的窗口声明标识' });
    }
    if (r.op === 'attach') {
      const parsed = parseMemberDecl(r);
      if (!parsed.ok) return reply({ ok: false, error: parsed.error });
      const previous = this.members.get(parsed.entry.sessionId);
      const mode = this.membershipModes.get(parsed.entry.sessionId) ?? (previous === undefined ? undefined : previous.temporary === true);
      if (mode !== undefined) parsed.entry.temporary = mode;
      this.membershipModes.set(parsed.entry.sessionId, parsed.entry.temporary === true);
      this.pendingErases.delete(parsed.entry.sessionId);
      const claims = this.memberClaims.get(parsed.entry.sessionId) ?? new Map<string, Socket | undefined>();
      claims.set(typeof r.claimId === 'string' ? r.claimId : 'manual', typeof r.claimId === 'string' ? socket : undefined);
      parsed.entry.selectionOwned = !claims.has('manual') && (parsed.entry.selectionOwned === true || previous?.selectionOwned === true);
      this.memberClaims.set(parsed.entry.sessionId, claims);
      this.members.set(parsed.entry.sessionId, parsed.entry);
      this.erased.delete(parsed.entry.sessionId); // 显式再注册解除 --rm 墓碑
      this.log(`member-up ${parsed.entry.name ?? parsed.entry.sessionId.slice(0, 8)}`);
      this.sendSessions();
      return reply({ ok: true });
    }
    if (r.op === 'detach') {
      if (typeof r.sessionId !== 'string' || r.sessionId === '') {
        return reply({ ok: false, error: 'detach 缺 sessionId' });
      }
      this.releaseMemberClaim(r.sessionId, typeof r.claimId === 'string' ? r.claimId : 'manual',
        typeof r.claimId === 'string' ? socket : undefined, r.erase === true);
      return reply({ ok: true }); // 幂等：不在表内也算成功
    }
    if (r.op === 'sync') {
      if (!Array.isArray(r.sessions)) {
        return reply({ ok: false, error: 'sync 缺 sessions 数组' });
      }
      const entries: MemberEntry[] = [];
      for (const raw of r.sessions) {
        const parsed = parseMemberDecl(raw);
        if (!parsed.ok) return reply({ ok: false, error: parsed.error });
        entries.push(parsed.entry);
      }
      this.members.clear();
      this.memberClaims.clear();
      for (const e of entries) this.members.set(e.sessionId, e);
      this.log(`sync 成员表：${entries.length} 条`);
      this.sendSessions();
      return reply({ ok: true });
    }
    if (r.op === 'status') {
      // 018 批二：启动器/adopt 的只读探针——当前成员表 + broker 能力（extends
      // 校验与幂等判断的数据源；不动成员表不触发重播）
      const online = this.state === 'online' && this.ws?.readyState === WebSocket.OPEN;
      const identity = online && this.attachIdentity?.socket === this.ws ? this.attachIdentity : undefined;
      return reply({
        ok: true,
        online,
        brokerCap: this.brokerSessionCap,
        members: [...this.members.values()].map(memberToDecl),
        ...(identity === undefined ? {} : { starId: identity.starId, machine: identity.machine }),
      });
    }
    return reply({ ok: false, error: `未知 attach 操作：${String(r.op)}` });
  }

  /** A reconnect may transfer a claim; a stale socket can only release its own claims. */
  private releaseMemberClaim(id: string, claim: string, socket?: Socket, erase = false): void {
    const claims = this.memberClaims.get(id);
    if (socket !== undefined && (!claims?.has(claim) || claims.get(claim) !== socket)) return;
    claims?.delete(claim);
    if (claims && claims.size > 0) {
      const member = this.members.get(id);
      if (member) member.selectionOwned = !claims.has('manual');
      this.sendSessions(); return;
    }
    this.memberClaims.delete(id);
    const member = this.members.get(id);
    const gone = this.members.delete(id);
    if (erase || member?.temporary === true) this.eraseTemporary(id);
    if (gone) { this.log(`member-down ${id.slice(0, 8)}（窗口声明释放）`); this.sendSessions(); }
  }

  /**
   * 028 常驻对账循环（018 双活性 + 恢复链②合并常态化，每 memberCheckMs 一轮）：
   * members-query 只同步本星权威属性，再由 Provider 核验已声明成员的活性/名称。
   * 永久下线册位不得由原生发现自行恢复：所有工具都由启动器当前选择重声明，
   * 或 TUI/显式 adopt 恢复。临时无主成员条件清册；未知来源保留待核实。
   */
  private async checkMemberLiveness(): Promise<void> {
    if (this.state !== 'online' || !this.brokerSessionCap || this.stopped || this.reconciling) return;
    this.reconciling = true;
    try {
      // 1) 读取本机册位切片；超时保留已知属性，不据缺失结果改变永久/临时。
      let slice: SessionMemberDecl[] = [];
      try {
        this.send({ op: 'members-query' });
        const frame = await this.nextFrame((f) => f.op === 'members-result', 5_000);
        if (frame.op === 'members-result' && Array.isArray(frame.members)) {
          slice = frame.members.filter(
            (decl) => decl !== null && typeof decl === 'object' && typeof decl.sessionId === 'string' && decl.sessionId !== '',
          );
        }
      } catch {
        // 查不回：本轮只做本地活性（下轮再查）
      }
      // 2) Provider capabilities own native liveness, source selection and name lookup.
      const request = { contextId: 'local', nativeIds: [...new Set([...this.members.keys(), ...slice.map((decl) => decl.sessionId)])] };
      for (const decl of slice) {
        this.membershipModes.set(decl.sessionId, decl.temporary === true);
        const member = this.members.get(decl.sessionId);
        if (member !== undefined) member.temporary = decl.temporary === true;
      }
      let providers: readonly MemberProvider[];
      if (this.d.memberProviders !== undefined) {
        providers = this.d.memberProviders(request);
      } else {
        const deps = this.d.makeSendDeps();
        providers = createLegacyMemberProviders({ listClaudeSessions: deps.listClaudeSessions, listCodexThreads: deps.listCodexThreads, codexHome: this.d.codexHome, now: this.d.now }, request.nativeIds);
      }
      const observations = await readMemberSnapshot(providers, request);
      const toolOf = (id: string): string | undefined =>
        observations.get(id)?.providerId;
      let changed = false;
      // Uniform enrollment: native discovery cannot reactivate an offline roster entry.
      // 3.5) 029 死临时成员清册：切片里 temporary 而本地验死（含聚合器重启后
      // 声明表为空的形态）——报 member-remove + 墓碑，零痕迹不留下线册位
      for (const decl of slice) {
        if (decl.temporary !== true || this.members.has(decl.sessionId)) continue;
        if ((decl.selectionOwned !== true && toolOf(decl.sessionId) !== undefined) || this.erased.has(decl.sessionId)) continue;
        this.eraseTemporary(decl.sessionId);
        this.log(`member-erase ${decl.sessionId.slice(0, 8)}（临时成员死亡清册——未上报则滞留下线态）`);
      }
      // 4) 下线：已声明而本地查无——永久成员移出声明集（broker 册位保留，不再除名）；
      //    临时成员（029）改走 member-remove + 墓碑（异常死亡同零痕迹）
      for (const [id, entry] of [...this.members.entries()]) {
        if (entry.selectionOwned && this.memberClaims.get(id)?.size) continue;
        if (toolOf(id) !== undefined) continue;
        this.members.delete(id);
        this.memberClaims.delete(id);
        changed = true;
        if (entry.temporary === true) {
          this.eraseTemporary(id);
          this.log(`member-erase ${entry.name ?? id.slice(0, 8)}（临时成员死亡清册，零痕迹）`);
        } else {
          this.log(`member-offline ${id.slice(0, 8)}（本地验活无此会话，上报下线——册位保留）`);
        }
      }
      // 5) 名字跟随（改名→id 跟随，roster 显示与按名寻址随扫描自新）
      for (const [id, member] of this.members) {
        const want = await observations.get(id)?.readName();
        if (want === undefined || want === member.name || want.includes(':')) continue;
        member.name = want;
        changed = true;
        this.log(`member-rename ${id.slice(0, 8)} → ${want}（扫描跟随）`);
      }
      // 切片非空即每轮重播：声明集就是在线报告——broker 据此把该机未声明的
      // 在册条目翻下线（对账闭环；幂等 upsert，无变化不写盘）
      if (changed || slice.length > 0) this.sendSessions();
    } catch {
      // 对账失败不倒守护（下轮再查）
    } finally {
      this.reconciling = false;
    }
  }

  /** 018：全量重播 sessions 帧（上线时 & 成员表变化时；老 broker/离线不发）。 */
  private eraseTemporary(sessionId: string): void {
    if (this.state !== 'online' || !this.brokerSessionCap || this.pendingErases.has(sessionId)) return;
    const id = randomUUID();
    this.pendingErases.set(sessionId, id);
    this.send({ op: 'member-remove', target: sessionId, temporaryOnly: true, id });
    void this.nextFrame((frame) => frame.op === 'member-remove-result' && frame.id === id, 5_000)
      .then((frame) => {
        if (this.pendingErases.get(sessionId) !== id) return;
        if (frame.op === 'member-remove-result' && frame.ok && frame.removed.length > 0) {
          this.erased.add(sessionId);
          this.membershipModes.delete(sessionId);
        }
      }).catch(() => { /* Next liveness check revalidates; no uncertain write replay. */ })
      .finally(() => { if (this.pendingErases.get(sessionId) === id) this.pendingErases.delete(sessionId); });
  }

  /** Full current declaration, independent of launcher defaults. */
  private sendSessions(): void {
    if (this.state !== 'online' || !this.brokerSessionCap) return;
    this.send({ op: 'sessions', sessions: [...this.members.values()].map(memberToDecl) });
  }

  private nextFrame(pred: (f: Frame) => boolean, timeoutMs: number): Promise<Frame> {
    if (this.stopped) return Promise.reject(new Error('stopped'));
    // 028：命中即取走（同 pred 的周期查询不再复读首帧旧回执）
    const idx = this.frameLog.findIndex(pred);
    if (idx >= 0) return Promise.resolve(this.frameLog.splice(idx, 1)[0]!);
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
    if (this.d.statusFile === undefined) return; // 内挂聚合器：非独立进程不落 status
    const entry = this.d.config.entries[0]!;
    const status: NodeStatusFile = {
      state: this.state,
      brokerAlias: entry.name ?? `${entry.host}:${entry.port}`,
      since: new Date(this.stateSince).toISOString(),
      lastUpdated: new Date(this.d.now()).toISOString(),
      ...(this.d.version === undefined ? {} : { version: this.d.version }),
      pid: process.pid, // 026：doctor 验活用
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
