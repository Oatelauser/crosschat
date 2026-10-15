/**
 * tcp broker 服务端（票B B1）：全网唯一监听端口、节点零入站的星型组件。
 * ws 复用仓内依赖；投递处理器注入化（B2 接 runSend，B1 默认 NOT_READY）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import { Buffer } from 'node:buffer';
import { WebSocket, WebSocketServer } from 'ws';
import {
  CAP_SESSION_MEMBERS,
  ERR,
  MAX_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
  encodeFrame,
  parseFrame,
} from './protocol.js';
import type {
  ConnectFrame,
  ErrorFrame,
  FileBeginFrame,
  FileChunkFrame,
  FileEndFrame,
  FileResultFrame,
  Frame,
  ResultFrame,
  RosterMachine,
  RosterResultFrame,
  SendFrame,
  SessionMemberDecl,
  SessionsFrame,
  StatusPayload,
  StatusQueryFrame,
  StatusResultFrame,
} from './protocol.js';
import { readRegistry, sanitizeName, writeRegistry, type NodeEntry } from './registry.js';
import { FILE_MAX_BYTES, FileInbox } from './file-channel.js';
import { normalizeMid } from '../platform/machine-id.js';

/**
 * 默认端口 7260。IANA service-names-port-numbers 核对（2026-10-10 实查）：
 * 7260 未分配；顺延候选 7261/7262 亦未分配（留作将来冲突时顺延）。
 */
export const DEFAULT_PORT = 7260;

export interface BrokerDeps {
  registryFile: string;
  statusFile: string;
  /** package version，进 info.server。 */
  version: string;
  machineId: () => string | undefined;
  hostname: () => string;
  now: () => number;
  log: (line: string) => void;
  /** B2 接 runSend；B1 默认实现回 NOT_READY。F1：第二参=发送方机器名（roster 真名，无名缺省）。 */
  deliverLocal: (frame: SendFrame, fromMachine?: string) => Promise<ResultFrame | ErrorFrame>;
  /** B2：本机文件接收器（file-* 帧目标为 broker 机时落盘）；缺省 NOT_READY。 */
  fileInbox?: FileInbox;
  /** E1：本机会话扫描（status-query 目标是 ownMid 时应答）；缺省 NOT_READY。 */
  scanStatus?: () => Promise<StatusPayload>;
  /** 显式端口（0 = 随机，测试用）；缺省读注册表再缺省 DEFAULT_PORT。 */
  port?: number;
  heartbeatMs?: number;
  pongTimeoutMs?: number;
  connectTimeoutMs?: number;
  authFailDelayMs?: number;
  resultTimeoutMs?: number;
  /** 心跳 ping 发射器（测试注入 noop 模拟永不 pong 的死连接）。 */
  ping?: (ws: WebSocket) => void;
}

/** B1 默认本机投递：处理器尚未接线。 */
export function defaultDeliverLocal(): Promise<ErrorFrame> {
  return Promise.resolve({
    op: 'error',
    code: ERR.NOT_READY,
    message: '本机投递处理器尚未接线（B2 批接 runSend）',
  });
}

interface Session {
  ws: WebSocket;
  authed: boolean;
  machineId?: string;
  machineName?: string;
  lastPong: number;
  connectTimer?: ReturnType<typeof setTimeout>;
  /** 018：该连接声明的会话成员（sessions 帧全量重播语义；undefined=从未声明）。连接断即随机器条目消失。 */
  members?: Map<string, SessionMemberDecl>;
}

type RouteOutcome =
  | { kind: 'result'; frame: ResultFrame & { status: 'delivered' | 'queued' | 'parked' } }
  | { kind: 'status'; frame: StatusResultFrame }
  | { kind: 'error'; code: string; message: string };

/** 018 send/file 目标解析结果（机器级双轨 + 会话级第三轨）。 */
type ResolvedTarget =
  | { kind: 'local' }
  | { kind: 'node'; ws: WebSocket }
  | { kind: 'session'; ws: WebSocket; sessionId: string }
  | { kind: 'error'; code: string; message: string };

interface PendingResult {
  targetWs: WebSocket;
  timer: ReturnType<typeof setTimeout>;
  resolve: (outcome: RouteOutcome) => void;
}

/** B2：一笔文件传输的路由（id → 发送方与目标连接；targetWs=undefined 即本机）。 */
interface FileRoute {
  senderWs: WebSocket;
  targetWs: WebSocket | undefined;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // 长度不同先失败：timingSafeEqual 对不等长直接抛
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export class Broker {
  private readonly d: Required<Omit<BrokerDeps, 'port' | 'fileInbox' | 'scanStatus'>> & {
    port?: number;
    fileInbox?: FileInbox;
    scanStatus?: () => Promise<StatusPayload>;
  };
  private wss?: WebSocketServer;
  private port?: number;
  /** E0 星名（start 时定格；status-broker.json 化妆用）。 */
  private starName?: string;
  private startedAt?: number;
  private stopped = false;
  private readonly sessions = new Set<Session>();
  private readonly online = new Map<string, Session>();
  private readonly pending = new Map<string, PendingResult>();
  private readonly fileRoutes = new Map<string, FileRoute>();
  /** 018 extends 星内映射（内存）：旧名 → 接续声明（归属连接——断连/重播即失效）。同旧名先声明先得。 */
  private readonly extendsByOldName = new Map<string, { holder: Session; decl: SessionMemberDecl }>();
  private hbTimer?: ReturnType<typeof setInterval>;

  constructor(deps: BrokerDeps) {
    this.d = {
      heartbeatMs: 30_000,
      pongTimeoutMs: 60_000,
      connectTimeoutMs: 10_000,
      authFailDelayMs: 500,
      resultTimeoutMs: 120_000,
      ...deps,
      hostname: deps.hostname ?? (() => hostname()),
      ping: deps.ping ?? ((ws) => ws.ping()),
    };
  }

  /** 监听并返回实际端口（deps.port=0 时为随机端口）。 */
  async start(): Promise<number> {
    const registry = readRegistry(this.d.registryFile);
    this.starName = registry.name;
    const wantPort = this.d.port ?? registry.port ?? DEFAULT_PORT;
    const wss = new WebSocketServer({ host: '0.0.0.0', port: wantPort, maxPayload: MAX_PAYLOAD_BYTES });
    try {
      await new Promise<void>((resolve, reject) => {
        wss.once('listening', () => resolve());
        wss.once('error', reject);
      });
    } catch (err) {
      try {
        wss.close();
      } catch {
        // 监听失败路径，句柄尽力回收
      }
      throw err;
    }
    this.wss = wss;
    const addr = wss.address();
    this.port = typeof addr === 'object' && addr !== null ? addr.port : wantPort;
    this.startedAt = this.d.now();
    this.writeStatus('running');
    this.hbTimer = setInterval(() => this.heartbeat(), this.d.heartbeatMs);
    wss.on('connection', (ws) => this.onConnection(ws));
    this.d.log(`${new Date(this.startedAt).toISOString()} broker listening on 0.0.0.0:${this.port}`);
    return this.port;
  }

  /** 优雅退出：关所有连接、清定时器、写终态。 */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.hbTimer !== undefined) clearInterval(this.hbTimer);
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.resolve({ kind: 'error', code: ERR.PEER_OFFLINE, message: 'broker 关闭' });
    }
    this.pending.clear();
    for (const session of this.sessions) {
      try {
        session.ws.close(1000, 'broker shutting down');
      } catch {
        // 已断开的连接忽略
      }
    }
    this.sessions.clear();
    this.online.clear();
    this.writeStatus('stopped');
    await new Promise<void>((resolve) => {
      if (this.wss === undefined) return resolve();
      this.wss.close(() => resolve());
    });
  }

  private onConnection(ws: WebSocket): void {
    const session: Session = { ws, authed: false, lastPong: this.d.now() };
    this.sessions.add(session);
    ws.on('pong', () => {
      session.lastPong = this.d.now();
    });
    ws.on('close', () => this.onClose(session));
    ws.on('message', (data) => {
      void this.onMessage(session, data.toString());
    });
    // B0：注册表带 starId / E0：带星名 则随 info 下发（缺省不发——additive，旧节点无感）
    // 018（9b）：caps 广播会话级星成员能力——聚合器据此识别新 broker（老 broker 恒空数组）
    const { starId, name } = readRegistry(this.d.registryFile);
    this.send(ws, {
      op: 'info',
      proto: PROTOCOL_VERSION,
      server: `crosschat/${this.d.version}`,
      caps: [CAP_SESSION_MEMBERS],
      ...(starId === undefined ? {} : { starId }),
      ...(name === undefined ? {} : { name }),
    });
    session.connectTimer = setTimeout(() => {
      this.log('connect-timeout 关闭未握手连接');
      try {
        ws.close(4000, 'connect timeout');
      } catch {
        // 竞态关闭忽略
      }
    }, this.d.connectTimeoutMs);
  }

  private onClose(session: Session): void {
    this.sessions.delete(session);
    if (session.connectTimer !== undefined) clearTimeout(session.connectTimer);
    // 018：该连接声明的 extends 随机器条目消失（成员表挂在 session 上同灭）
    for (const [oldName, entry] of this.extendsByOldName) {
      if (entry.holder === session) this.extendsByOldName.delete(oldName);
    }
    // F0：online 键=归一 mid（onConnect 写入侧同款），下线按同键回收
    if (session.machineId !== undefined) {
      const midNorm = normalizeMid(session.machineId);
      if (this.online.get(midNorm) === session) {
        this.online.delete(midNorm);
        this.log(`node-down ${session.machineName ?? ''}(${session.machineId.slice(0, 8)})`);
        this.writeStatus('running');
      }
    }
    for (const [id, entry] of this.pending) {
      if (entry.targetWs === session.ws) {
        clearTimeout(entry.timer);
        this.pending.delete(id);
        entry.resolve({ kind: 'error', code: ERR.PEER_OFFLINE, message: '节点连接断开' });
      }
    }
    // B2：清掉该连接参与的一切文件路由（对端等待者会随断线失败）
    for (const [id, route] of this.fileRoutes) {
      if (route.senderWs === session.ws || route.targetWs === session.ws) this.fileRoutes.delete(id);
    }
  }

  private async onMessage(session: Session, text: string): Promise<void> {
    const frame = parseFrame(text);
    if (frame === undefined) return; // 损坏/未知帧丢弃
    if (!session.authed) {
      if (frame.op !== 'connect') return; // 只等 connect，握手超时兜底
      await this.onConnect(session, frame);
      return;
    }
    if (frame.op === 'send') {
      await this.routeSend(session, frame);
      return;
    }
    if (frame.op === 'result') {
      const entry = this.pending.get(frame.id);
      if (entry !== undefined && entry.targetWs === session.ws) {
        clearTimeout(entry.timer);
        this.pending.delete(frame.id);
        // B2：节点结构化错误（status='error'）映射为发送方 error 帧
        if (frame.status === 'error') {
          entry.resolve({ kind: 'error', code: frame.code ?? 'REMOTE_FAILED', message: frame.message ?? '节点投递失败' });
        } else {
          // 上面排除了 'error'，收窄回三态（TS 不会对整个对象做属性收窄）
          entry.resolve({ kind: 'result', frame: { ...frame, status: frame.status as 'delivered' | 'queued' | 'parked' } });
        }
      }
      return;
    }
    if (frame.op === 'file-begin') {
      await this.routeFileBegin(session, frame);
      return;
    }
    if (frame.op === 'file-chunk' || frame.op === 'file-end') {
      this.routeFileCont(session, frame);
      return;
    }
    if (frame.op === 'file-result') {
      this.routeFileResult(session, frame);
      return;
    }
    if (frame.op === 'roster') {
      this.send(session.ws, this.buildRoster());
      return;
    }
    if (frame.op === 'status-query') {
      await this.routeStatusQuery(session, frame);
      return;
    }
    if (frame.op === 'status-result') {
      const entry = this.pending.get(frame.id);
      if (entry !== undefined && entry.targetWs === session.ws) {
        clearTimeout(entry.timer);
        this.pending.delete(frame.id);
        entry.resolve({ kind: 'status', frame });
      }
      return;
    }
    if (frame.op === 'sessions') {
      this.onSessions(session, frame);
      return;
    }
    // 其余帧型（info/receipt/deliver）服务端无行为
  }

  /**
   * 018：会话成员声明帧（node 角色独占）——全量重播语义：数组即该连接当前
   * 全部成员，空数组=清空。extends 星内映射随声明重建：同旧名先声明先得，
   * 后声明者收 EXTENDS_CONFLICT 回执（成员本身照常入册——失败方向不锁死用户）。
   * 双活性（9a）由聚合器核验，broker 只聚合计数不做活性判断。
   */
  private onSessions(session: Session, frame: SessionsFrame): void {
    if (session.machineId === undefined) return; // sender 角色不收成员声明
    if (!Array.isArray(frame.sessions)) return; // 坏形状丢弃
    const members = new Map<string, SessionMemberDecl>();
    for (const decl of frame.sessions) {
      if (decl === null || typeof decl !== 'object' || typeof decl.sessionId !== 'string' || decl.sessionId === '') {
        continue; // 单条坏形状跳过，不整帧拒
      }
      members.set(decl.sessionId, decl);
    }
    session.members = members;
    // 归属重建：先撤本连接旧声明，再逐条登记
    for (const [oldName, entry] of this.extendsByOldName) {
      if (entry.holder === session) this.extendsByOldName.delete(oldName);
    }
    for (const decl of members.values()) {
      if (decl.extends === undefined) continue;
      const oldName = typeof decl.extends === 'string' ? decl.extends : decl.extends.name;
      const existing = this.extendsByOldName.get(oldName);
      if (existing !== undefined && existing.holder !== session) {
        const holder = existing.holder.machineName ?? existing.holder.machineId?.slice(0, 8) ?? '?';
        const winner = existing.decl.name ?? existing.decl.sessionId.slice(0, 8);
        this.send(session.ws, {
          op: 'error',
          code: ERR.EXTENDS_CONFLICT,
          message: `会话 ${decl.name ?? decl.sessionId.slice(0, 8)} 的 extends 旧名 ${oldName} 已由 ${holder} 的会话 ${winner} 接续（先声明先得）——本条 extends 未生效`,
        });
        this.log(`extends-conflict ${oldName}：${session.machineName ?? '?'} 后到，${holder} 先得`);
        continue;
      }
      this.extendsByOldName.set(oldName, { holder: session, decl });
    }
    this.log(`sessions ${session.machineName ?? session.machineId.slice(0, 8)}: ${members.size} 成员`);
  }

  private async onConnect(session: Session, frame: ConnectFrame): Promise<void> {
    if (frame.proto !== PROTOCOL_VERSION) {
      this.send(session.ws, {
        op: 'error',
        code: ERR.BAD_PROTO,
        message: `协议版本不匹配：本服务端支持版本 ${PROTOCOL_VERSION}，客户端 ${frame.proto}`,
      });
      this.log(`bad-proto 拒绝（客户端 ${frame.proto}）`);
      session.ws.close(4000, 'bad proto');
      return;
    }
    // 注册表每笔连接现读（文件小，不缓存）：gen/remove 即时生效
    const registry = readRegistry(this.d.registryFile);
    const entry = registry.nodes.find((node) => safeEqual(frame.auth, node.key));
    if (entry === undefined) {
      await this.authFail(session, '钥匙不匹配');
      return;
    }
    if (frame.role === 'node') {
      const mid = frame.machineId ?? '';
      if (mid === '') {
        await this.authFail(session, 'node 角色必须携带 machineId');
        return;
      }
      // F0：绑定比对双侧归一（带杠旧条目 vs 纯 hex 新帧同值放行，防升级窗口断连）；
      // 注册表存储仍写帧原值，mid8 碰撞检测取归一形态（跨形态同机不漏报）。
      const midNorm = normalizeMid(mid);
      if (entry.machineId === undefined || entry.machineId === '') {
        entry.machineId = mid;
        // B2.1：注册时 mid 前 8 位碰撞检测——前缀寻址在此长度歧义，记日志警告
        const clash = registry.nodes.find(
          (n) => n !== entry && n.machineId !== undefined && normalizeMid(n.machineId).slice(0, 8) === midNorm.slice(0, 8),
        );
        if (clash !== undefined) {
          this.log(`warn mid8 碰撞：${midNorm.slice(0, 8)} 同时登记于 ${clash.label} 与 ${entry.label}——前缀寻址需 ≥9 位消歧`);
        }
      } else if (normalizeMid(entry.machineId) !== midNorm) {
        await this.authFail(session, 'machineId 与该钥匙登记的不一致');
        return;
      }
      // B2.1：名字=connect 自报（重连改名即覆盖）；显示用，寻址权威是 mid 前缀。
      // （旧版用 broker 自己的 hostname() 回填——双机部署时把节点全标成 broker 机名，已删。）
      const selfName = sanitizeName(frame.name);
      if (selfName !== undefined) entry.machineName = selfName;
      writeRegistry(this.d.registryFile, registry);
      session.machineId = mid;
      session.machineName = entry.machineName;
      // F0：online 键取归一 mid——两形态互指的同机仍是同一台（顶换语义不变）
      const old = this.online.get(midNorm);
      if (old !== undefined && old !== session) {
        this.log(`replace ${entry.machineName}(${mid.slice(0, 8)}) 顶掉旧连接`);
        try {
          old.ws.close(1000, 'replaced by new connection');
        } catch {
          // 竞态关闭忽略
        }
      }
      this.online.set(midNorm, session);
      this.log(`node-up ${entry.machineName}(${mid.slice(0, 8)})`);
    }
    // B2：sender 角色也带出注册表里的 machineName（send 路由的 fromMachine 展示）
    if (frame.role !== 'node' && entry.machineName !== undefined) {
      session.machineName = entry.machineName;
    }
    if (session.connectTimer !== undefined) clearTimeout(session.connectTimer);
    session.authed = true;
    this.send(session.ws, { op: 'connected', machineName: session.machineName });
    this.writeStatus('running');
  }

  /** 鉴权失败统一路径：恒定延迟再回 BAD_AUTH，挫钥匙枚举计时。 */
  private async authFail(session: Session, message: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.d.authFailDelayMs));
    this.send(session.ws, { op: 'error', code: ERR.BAD_AUTH, message });
    this.log(`bad-auth 拒绝连接（${message}）`);
    session.ws.close(4001, 'bad auth');
  }

  private async routeSend(sender: Session, frame: SendFrame): Promise<void> {
    const target = frame.targetMachine;
    const from = sender.machineName ?? frame.origin ?? 'unknown';
    const fail = (code: string, message: string) => {
      this.send(sender.ws, { op: 'error', code, message, id: frame.id });
      this.log(`route ${from}→${target} ${code}`);
    };
    // 018：含冒号的目标先整段按机器名解析（零回归锚点：冒号机器名照旧机器级），
    // 失败再拆最后一段作会话名（机器段可含冒号，会话名聚合器侧已禁冒号）。
    const resolved = target.includes(':') ? this.resolveTargetWithSession(target) : this.resolveTarget(target);
    if (resolved.kind === 'error') return fail(resolved.code, resolved.message);
    if (resolved.kind === 'local') {
      // 目标是 broker 本机：本机投递处理器（B2 起 serve 接线真实现）。
      // F1：本机投递同带发送方 roster 真名——远端来件在 broker 机上的信封
      // 也要有真 from-machine（消灭旧 'local' 占位）。
      let outcome: ResultFrame | ErrorFrame;
      try {
        outcome = await this.d.deliverLocal(frame, sender.machineName);
      } catch (err) {
        outcome = { op: 'error', code: ERR.NOT_READY, message: err instanceof Error ? err.message : String(err) };
      }
      if (outcome.op === 'error') return fail(outcome.code, outcome.message);
      // B2：deliverLocal 可能回 error 态 ResultFrame（结构化失败）——同按失败路由
      if (outcome.status === 'error') {
        return fail(outcome.code ?? 'REMOTE_FAILED', outcome.message ?? '本机投递失败');
      }
      this.send(sender.ws, {
        op: 'receipt',
        id: frame.id,
        status: outcome.status,
        turn: outcome.turn,
        replyRef: outcome.replyRef,
        ...(outcome.output === undefined ? {} : { output: outcome.output }),
      });
      this.log(`route ${from}→${target}(local) ${outcome.status}`);
      return;
    }
    const targetSession = resolved.ws;
    // 转发 deliver（B2：to/conversation/origin 随帧透传），等对应 id 的 result 再映射 receipt 回发送方。
    // F1：fromMachine 只写真 roster 名（无名瞬态发送方缺省——投递侧省略信封属性，不填 origin 编码/unknown 占位）。
    // 018：会话轨命中时附带 sessionId——聚合器本地按它注入投递（id 定位，不经名字解析）。
    this.send(targetSession, {
      op: 'deliver',
      id: frame.id,
      ...(sender.machineName === undefined ? {} : { fromMachine: sender.machineName }),
      payload: frame.body,
      to: frame.to,
      conversation: frame.conversation,
      origin: frame.origin,
      ...(resolved.kind === 'session' ? { sessionId: resolved.sessionId } : {}),
    });
    const outcome = await new Promise<RouteOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(frame.id);
        resolve({ kind: 'error', code: ERR.PEER_OFFLINE, message: `节点 ${target} 未在 ${this.d.resultTimeoutMs}ms 内回应 result` });
      }, this.d.resultTimeoutMs);
      this.pending.set(frame.id, { targetWs: targetSession, timer, resolve });
    });
    if (outcome.kind === 'error') return fail(outcome.code, outcome.message);
    if (outcome.kind === 'status') return fail('INTERNAL', 'send 路由收到 status 回程（id 串扰）'); // 防御：send/status 的 id 各自随机，不应互串
    const result = outcome.frame;
    this.send(sender.ws, {
      op: 'receipt',
      id: frame.id,
      status: result.status,
      turn: result.turn,
      replyRef: result.replyRef,
      ...(result.output === undefined ? {} : { output: result.output }),
    });
    this.log(`route ${from}→${target} ${result.status}`);
  }

  /**
   * E1 远程会话枚举（票012）：resolveTarget 同款路由——目标是节点则转发
   * status-query 并复用 send/result 的 pending 机制等 status-result 回程
   * （超时/断线同款回 error）；目标是本机则直接扫描应答。
   */
  private async routeStatusQuery(sender: Session, frame: StatusQueryFrame): Promise<void> {
    const target = frame.targetMachine;
    const from = sender.machineName ?? 'unknown';
    const fail = (code: string, message: string): void => {
      this.send(sender.ws, { op: 'error', code, message, id: frame.id });
      this.log(`status-route ${from}→${target} ${code}`);
    };
    const resolved = this.resolveTarget(target);
    if (resolved.kind === 'error') return fail(resolved.code, resolved.message);
    if (resolved.kind === 'local') {
      if (this.d.scanStatus === undefined) {
        return fail(ERR.NOT_READY, '本机会话扫描器未接线（升级 broker 机 crosschat）');
      }
      const payload = await this.d.scanStatus();
      this.send(sender.ws, { op: 'status-result', id: frame.id, ok: true, payload });
      this.log(`status-route ${from}→${target}(local) ok`);
      return;
    }
    this.send(resolved.ws, frame);
    const outcome = await new Promise<RouteOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(frame.id);
        resolve({ kind: 'error', code: ERR.PEER_OFFLINE, message: `节点 ${target} 未在 ${this.d.resultTimeoutMs}ms 内回应 status-result` });
      }, this.d.resultTimeoutMs);
      this.pending.set(frame.id, { targetWs: resolved.ws, timer, resolve });
    });
    if (outcome.kind === 'error') return fail(outcome.code, outcome.message);
    this.send(sender.ws, outcome.frame);
    this.log(`status-route ${from}→${target} ok`);
  }

  /** B2：file-begin 尺寸预拒 + 按 targetMachine 路由（本机则 fileInbox 落盘）。 */
  private async routeFileBegin(sender: Session, frame: FileBeginFrame): Promise<void> {
    const fail = (code: string, message: string): void => {
      this.send(sender.ws, { op: 'error', code, message, id: frame.id });
      this.log(`file-route ${sender.machineName ?? '?'}→${frame.targetMachine} ${code}`);
    };
    if (frame.size > FILE_MAX_BYTES) {
      return fail(ERR.FILE_TOO_LARGE, `文件 ${frame.name} 超过 64MiB 上限（${frame.size} 字节）`);
    }
    const resolved = this.resolveTarget(frame.targetMachine);
    if (resolved.kind === 'error') return fail(resolved.code, resolved.message);
    const targetWs = resolved.kind === 'node' ? resolved.ws : undefined;
    this.fileRoutes.set(frame.id, { senderWs: sender.ws, targetWs });
    if (targetWs !== undefined) {
      this.send(targetWs, frame);
      this.log(`file-route ${sender.machineName ?? '?'}→${frame.targetMachine} begin ${frame.size}B`);
      return;
    }
    // 目标是 broker 本机
    if (this.d.fileInbox === undefined) {
      this.fileRoutes.delete(frame.id);
      return fail(ERR.NOT_READY, '本机文件接收器未接线');
    }
    this.send(sender.ws, this.d.fileInbox.begin(frame));
    this.log(`file-route ${sender.machineName ?? '?'}→local begin ${frame.size}B`);
  }

  /** B2：chunk/end 按 id 路由到既有传输（本机传输直接驱动 fileInbox）。 */
  private routeFileCont(sender: Session, frame: FileChunkFrame | FileEndFrame): void {
    const route = this.fileRoutes.get(frame.id);
    if (route === undefined || route.senderWs !== sender.ws) return;
    if (route.targetWs !== undefined) {
      this.send(route.targetWs, frame);
      return;
    }
    if (this.d.fileInbox === undefined) return;
    if (frame.op === 'file-chunk') {
      if (!this.d.fileInbox.chunk(frame)) {
        this.send(sender.ws, { op: 'file-result', id: frame.id, ok: false, error: '分块失序或未知 id——请重新 begin 续传' });
      }
      return;
    }
    this.send(sender.ws, this.d.fileInbox.end(frame.id));
  }

  /** B2：节点的 file-result 回送发起方；带 resumeFrom 的是 begin 应答（保留路由）。 */
  private routeFileResult(session: Session, frame: FileResultFrame): void {
    const route = this.fileRoutes.get(frame.id);
    if (route === undefined || route.targetWs !== session.ws) return;
    this.send(route.senderWs, frame);
    if (frame.resumeFrom === undefined) {
      this.fileRoutes.delete(frame.id);
      this.log(`file-result ${frame.id} ${frame.ok ? 'ok' : `失败: ${frame.error ?? '?'}`}`);
    }
  }

  /** B2.1：roster 应答——注册表全部已激活机器（mid 去重）+ 在线态；broker 自身恒在线。
   * F0：mid8 与去重键取归一形态（带杠条目与纯 hex 条目同机合一）。 */
  private buildRoster(): RosterResultFrame {
    const registry = readRegistry(this.d.registryFile);
    const ownNorm = normalizeMid(this.d.machineId() ?? '');
    const machines = new Map<string, RosterMachine>();
    for (const node of registry.nodes) {
      const nm = normalizeMid(node.machineId ?? '');
      if (nm === '') continue;
      machines.set(nm, {
        ...(node.machineName === undefined ? {} : { name: node.machineName }),
        mid8: nm.slice(0, 8),
        online: (ownNorm !== '' && nm === ownNorm) || this.online.has(nm),
      });
    }
    return { op: 'roster-result', machines: [...machines.values()] };
  }

  /**
   * send/file 共用的目标解析（B2.1 双轨）：hex spec = machine-id 前缀（git
   * 短哈希式最短无歧义解析，寻址权威）；非 hex = name/label（人读显示用）。
   * local=broker 本机（按 machineId 判定，不再比对 hostname 字符串）。
   * F0：spec 与注册表条目 mid 均在读取侧归一后比对——带杠 UUID（Windows
   * MachineGuid）与纯 hex 两形态互投同轨；存储与帧携带值保持历史形态。
   */
  private resolveTarget(spec: string): ResolvedTarget {
    const registry = readRegistry(this.d.registryFile);
    const ownNorm = normalizeMid(this.d.machineId() ?? '');
    const pick = (resolved: NodeEntry): ResolvedTarget => {
      const midNorm = normalizeMid(resolved.machineId ?? '');
      if (ownNorm !== '' && midNorm === ownNorm) return { kind: 'local' };
      const target = midNorm === '' ? undefined : this.online.get(midNorm);
      if (target === undefined) {
        return { kind: 'error', code: ERR.PEER_OFFLINE, message: `机器 ${spec} 已注册但当前不在线` };
      }
      return { kind: 'node', ws: target.ws };
    };
    // 轨一：hex spec（F0：含带杠 UUID 形态）= mid 前缀（最短无歧义；多命中教加长）
    const specNorm = normalizeMid(spec);
    if (specNorm !== '' && /^[0-9a-fA-F-]+$/.test(spec)) {
      const hits = registry.nodes.filter((node) => {
        const nm = normalizeMid(node.machineId ?? '');
        return nm !== '' && nm.startsWith(specNorm); // 归一后为空的条目跳过（空串 startsWith 假命中守卫）
      });
      if (hits.length === 0) {
        return { kind: 'error', code: ERR.UNKNOWN_MACHINE, message: this.unknownMachine(spec, `注册表没有 machine-id 前缀 ${spec} 的机器（crosschat serve --list 可查 mid8）`) };
      }
      if (hits.length > 1) {
        const ids = hits.map((node) => node.machineId?.slice(0, 12)).join(', ');
        return { kind: 'error', code: ERR.MACHINE_NAME_COLLISION, message: `前缀 ${spec} 命中多台机器（machine-id：${ids}）——加长前缀后重试` };
      }
      return pick(hits[0]!);
    }
    // 轨二：name/label（人读；冲突列 mid 教消歧）
    const candidates = registry.nodes.filter((node) => node.machineName === spec || node.label === spec);
    if (candidates.length === 0) {
      return { kind: 'error', code: ERR.UNKNOWN_MACHINE, message: this.unknownMachine(spec, `注册表没有机器名 ${spec}（crosschat serve --list 可查名字与 mid8）`) };
    }
    if (candidates.length > 1) {
      const ids = candidates.map((node) => node.machineId?.slice(0, 12) ?? `${node.label}(未激活)`).join(', ');
      return { kind: 'error', code: ERR.MACHINE_NAME_COLLISION, message: `多台机器同名 ${spec}（machine-id：${ids}）——改用 mid 前缀寻址` };
    }
    return pick(candidates[0]!);
  }

  /**
   * 018：三段寻址 `tcp:<星>:<机器>:<会话>` 的 broker 侧拆解——targetMachine 携带
   * `<机器>:<会话>`（最后一个冒号后是会话段：机器名可含冒号、会话名聚合器侧
   * 已禁冒号）。整段先按现行机器名解析（冒号机器名零回归锚点），失败才拆段。
   * 会话段查该机器聚合器连接的成员表：命中→会话轨（sessionId 随 deliver 注入）；
   * 非成员→extends 指路或教学报错。alive-wins：活成员在则正常投递，extends 休眠。
   */
  private resolveTargetWithSession(spec: string): ResolvedTarget {
    const whole = this.resolveTarget(spec);
    if (whole.kind !== 'error') return whole;
    const idx = spec.lastIndexOf(':');
    if (idx <= 0 || idx === spec.length - 1) return whole; // 无会话段可拆——原错误照报
    const machineSpec = spec.slice(0, idx);
    const sessionName = spec.slice(idx + 1);
    const machine = this.resolveTarget(machineSpec);
    if (machine.kind === 'error') return machine;
    if (machine.kind === 'local') {
      // broker 本机的会话成员同样经由本机聚合器（成员表/活性在聚合器；deliverLocal 无会话注入）
      const ownNorm = normalizeMid(this.d.machineId() ?? '');
      const conn = ownNorm === '' ? undefined : this.online.get(ownNorm);
      if (conn === undefined) {
        return { kind: 'error', code: ERR.NOT_READY, message: 'broker 本机无聚合器连接——会话级投递需本机跑 crosschat serve --connect' };
      }
      return this.resolveSessionMember(conn, sessionName);
    }
    const conn = this.sessionByWs(machine.ws);
    if (conn === undefined) return machine; // 防御：解析出的 ws 不在会话表——按机器级走
    return this.resolveSessionMember(conn, sessionName);
  }

  /** 会话段在目标机器连接的成员表内解析（名字或 id 命中；alive-wins 优先于 extends）。 */
  private resolveSessionMember(target: Session, sessionName: string): ResolvedTarget {
    for (const decl of target.members?.values() ?? []) {
      if (decl.name === sessionName || decl.sessionId === sessionName) {
        return { kind: 'session', ws: target.ws, sessionId: decl.sessionId };
      }
    }
    const ext = this.extendsByOldName.get(sessionName);
    if (ext !== undefined) {
      const succMachine = ext.holder.machineName ?? ext.holder.machineId?.slice(0, 8) ?? '?';
      const succName = ext.decl.name ?? ext.decl.sessionId.slice(0, 8);
      return {
        kind: 'error',
        code: ERR.SESSION_SUPERSEDED,
        message: `会话 ${sessionName} 已由 ${succMachine}:${succName} 接续——改投接任者 tcp:<星>:${succMachine}:${succName}`,
      };
    }
    return {
      kind: 'error',
      code: ERR.SESSION_NOT_MEMBER,
      message: `会话 ${sessionName} 不是星成员——会话须经启动器入星（crosschat claude/codex --connect <星>）才能按名投递`,
    };
  }

  private sessionByWs(ws: WebSocket): Session | undefined {
    for (const session of this.sessions) {
      if (session.ws === ws) return session;
    }
    return undefined;
  }

  /**
   * F0：UNKNOWN_MACHINE did-you-mean——自动列注册表候选（label/name(mid8)，
   * ≤10 条封顶）；归一 spec 恰为某条目 mid 前缀时明示该机器（名字轨落进来的
   * mid 形态教学）。归一后为空的条目不参与匹配。
   */
  private unknownMachine(spec: string, reason: string): string {
    const registry = readRegistry(this.d.registryFile);
    const specNorm = normalizeMid(spec);
    const lines: string[] = [];
    let suggest = '';
    for (const node of registry.nodes) {
      const nm = normalizeMid(node.machineId ?? '');
      if (nm === '') continue;
      const shown = `${node.label}${node.machineName === undefined ? '' : `/${node.machineName}`}(${nm.slice(0, 8)})`;
      if (lines.length < 10) lines.push(shown);
      if (suggest === '' && specNorm !== '' && nm.startsWith(specNorm)) suggest = shown;
    }
    return `${reason}${suggest === '' ? '' : `；${spec} 是 ${suggest} 的 machine-id 前缀，可用 mid 前缀寻址`}${lines.length === 0 ? '' : `；已注册：${lines.join('、')}`}`;
  }

  private heartbeat(): void {
    const now = this.d.now();
    for (const session of this.sessions) {
      this.d.ping(session.ws);
      if (now - session.lastPong > this.d.pongTimeoutMs) {
        this.log(`heartbeat-kill ${session.machineName ?? session.machineId?.slice(0, 8) ?? '未握手连接'} 无 pong 超时`);
        session.ws.terminate();
      }
    }
    this.writeStatus('running'); // lastUpdated 每心跳周期刷新
  }

  private writeStatus(state: 'running' | 'stopped'): void {
    try {
      mkdirSync(dirname(this.d.statusFile), { recursive: true });
      const onlineNodes = [...this.online.values()].map(
        (session) => session.machineName ?? session.machineId?.slice(0, 8) ?? '?',
      );
      // 017：broker 自身恒在线——本机 status 的"在线机器"含本机（带（本机）标），
      // 改 showName 重启 serve 后本机 status 即见新名（此前自排除让用户误以为没生效）。
      // 与 buildRoster ownNorm 同判：注册表有本机条目才算（名字取注册表——017 后与
      // showName 同源），未注册不虚列。
      const ownNorm = normalizeMid(this.d.machineId() ?? '');
      if (ownNorm !== '') {
        const selfEntry = readRegistry(this.d.registryFile).nodes.find(
          (n) => normalizeMid(n.machineId ?? '') === ownNorm,
        );
        if (selfEntry !== undefined) {
          onlineNodes.unshift(`${selfEntry.machineName ?? ownNorm.slice(0, 8)}（本机）`);
        }
      }
      writeFileSync(
        this.d.statusFile,
        `${JSON.stringify(
          {
            state,
            port: this.port,
            version: this.d.version, // F1：doctor 版本对账（常驻版本 vs 本机 CLI）
            ...(this.starName === undefined ? {} : { name: this.starName }),
            startedAt: this.startedAt !== undefined ? new Date(this.startedAt).toISOString() : undefined,
            lastUpdated: new Date(this.d.now()).toISOString(),
            onlineNodes,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
    } catch {
      // 状态文件写失败不倒服务（status 命令会看到旧值）
    }
  }

  private send(ws: WebSocket, frame: Frame): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(encodeFrame(frame));
  }

  private log(event: string): void {
    this.d.log(`${new Date(this.d.now()).toISOString()} ${event}`);
  }
}
