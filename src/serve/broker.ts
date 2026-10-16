/**
 * tcp broker 服务端（票B B1）：全网唯一监听端口、节点零入站的星型组件。
 * ws 复用仓内依赖；投递处理器注入化（B2 接 runSend，B1 默认 NOT_READY）。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { WebSocket, WebSocketServer } from 'ws';
import {
  CAP_SESSION_MEMBERS,
  ERR,
  MAX_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
  encodeFrame,
  parseFrame,
  sanitizeTool,
} from './protocol.js';
import type {
  ConnectFrame,
  ErrorFrame,
  FileBeginFrame,
  FileChunkFrame,
  FileEndFrame,
  FileResultFrame,
  Frame,
  MembersResultFrame,
  ResultFrame,
  RosterMachine,
  RosterResultFrame,
  SendFrame,
  SessionMemberDecl,
  SessionsFrame,
  StatusPayload,
  StatusQueryFrame,
  StatusResultFrame,
  MemberRemoveFrame,
  MemberRemoveResultFrame,
} from './protocol.js';
import { readRegistry, sanitizeName, writeRegistry, type NodeEntry } from './registry.js';
import { FILE_MAX_BYTES, FileInbox } from './file-channel.js';
import { normalizeMid } from '../platform/machine-id.js';

/**
 * 默认端口 7260。IANA service-names-port-numbers 核对（2026-10-10 实查）：
 * 7260 未分配；顺延候选 7261/7262 亦未分配（留作将来冲突时顺延）。
 */
export const DEFAULT_PORT = 7260;

/**
 * 028 星成员册（roster）条目：成员资格 v2 的落盘事实源——注册/下线/复活/
 * extends 接任/remove 全部落此。broker 单写者（tmp+rename 原子写）；每星一份
 * （本 broker 一星，与 registry 同目录）；聚合器 sessions 帧=该机成员的在线
 * 声明，未声明的在册条目=下线（死亡不再除名）。
 */
export interface RosterEntry {
  /** 成员键=会话 ID（claude sessionId / codex thread id），全星唯一。 */
  sessionId: string;
  name?: string;
  tool?: string;
  /** 归属机器（归一 mid）——复活判定的机器一致性锚（边界1：跨机拒绝）。 */
  machine: string;
  machineName?: string;
  online: boolean;
  /** 经 --extend-session 接任的旧名（接任转移的持久证据——接任者胜复活）。 */
  extendsName?: string;
  /** 接任旧名的归属机器（跨机接续 {machine,name} 的 machine 段）。 */
  extendsMachine?: string;
}

/** roster 文件与 registry/status 同目录同风格：tcp/roster.json。 */
export function rosterFileOf(registryFile: string): string {
  return join(dirname(registryFile), 'roster.json');
}

/** 读 roster；不存在/损坏按空册（册是状态不是资产，重建走重声明路径）。 */
export function readRoster(file: string): RosterEntry[] {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as { entries?: unknown } | null;
    if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter(
      (e): e is RosterEntry =>
        e !== null && typeof e === 'object' && typeof (e as RosterEntry).sessionId === 'string' && (e as RosterEntry).sessionId !== '',
    );
  } catch {
    return [];
  }
}

/** tmp+rename 原子写（与 node.json 同款约定）；失败只留日志不倒服务。 */
function writeRoster(file: string, entries: RosterEntry[]): boolean {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ entries }, null, 2)}\n`, 'utf8');
    renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

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
  /**
   * 028 星成员册（落盘事实源，start 时从 roster.json 载入）：条目含归属机器与
   * 在线态——sessions 帧是各机的在线声明（未声明=下线），extends 接任与册位
   * 随 broker 重启存活（018 的内存 lastKnownMembers/extendsByOldName 由本册取代）。
   */
  private roster: RosterEntry[] = [];
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
    this.roster = readRoster(rosterFileOf(this.d.registryFile));
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
    // F0：online 键=归一 mid（onConnect 写入侧同款），下线按同键回收
    if (session.machineId !== undefined) {
      const midNorm = normalizeMid(session.machineId);
      if (this.online.get(midNorm) === session) {
        this.online.delete(midNorm);
        this.log(`node-down ${session.machineName ?? ''}(${session.machineId.slice(0, 8)})`);
        this.writeStatus('running');
        // 028：聚合器断连——该机在册条目全部转下线（顶换窗口里新连接已接管则跳过；
        // 册位保留，聚合器回线后由常驻对账循环按本地验活复活）
        if (this.online.get(midNorm) === undefined) this.setMachineOffline(midNorm);
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
    if (frame.op === 'members-query') {
      this.onMembersQuery(session);
      return;
    }
    if (frame.op === 'member-remove') {
      this.onMemberRemove(session, frame);
      return;
    }
    // 其余帧型（info/receipt/deliver）服务端无行为
  }

  /**
   * 018/028：会话成员声明帧（node 角色独占）——全量重播语义：数组即该连接当前
   * 全部在线成员；未声明的该机在册条目=下线（028：死亡不再除名）。声明逐条落
   * 册（roster 持久），边界在此钉死：跨机声明拒绝复活（MACHINE_BOUND）、名字
   * 已被 extends 接任不夺回（名字剥离+教学）、同旧名同工具先声明先得
   * （EXTENDS_CONFLICT，成员本身照常入册——失败方向不锁死用户）。
   */
  private onSessions(session: Session, frame: SessionsFrame): void {
    if (session.machineId === undefined) return; // sender 角色不收成员声明
    if (!Array.isArray(frame.sessions)) return; // 坏形状丢弃
    const members = new Map<string, SessionMemberDecl>();
    for (const decl of frame.sessions) {
      if (decl === null || typeof decl !== 'object' || typeof decl.sessionId !== 'string' || decl.sessionId === '') {
        continue; // 单条坏形状跳过，不整帧拒
      }
      // 020：tool 容错归一（聚合器侧已严校验；坏值剥离降级为无 tool，不拒帧）
      const { tool: rawTool, ...rest } = decl as SessionMemberDecl & { tool?: unknown };
      const tool = sanitizeTool(rawTool);
      members.set(decl.sessionId, { ...rest, ...(tool === undefined ? {} : { tool }) });
    }
    session.members = new Map(
      this.applyRosterUpdate(normalizeMid(session.machineId), session.machineName, [...members.values()], session)
        .map((d) => [d.sessionId, d]),
    );
    this.log(`sessions ${session.machineName ?? session.machineId.slice(0, 8)}: ${session.members.size} 成员`);
  }

  /**
   * 028 roster 核心转移点：声明集 → 册（落盘），返回生效声明集（连接成员表/
   * 路由真相源只收生效条目——跨机拒收整条、名字被接任则剥名保留 id 寻址）。
   * 注册/复活=同 id 上线（机器一致才准）；下线=该机未声明的在册条目翻 offline；
   * extends 接任=记 extendsName（持久，接任者胜复活）。教学回执走 error 帧
   * 直发声明方连接。
   */
  private applyRosterUpdate(mid: string, machineName: string | undefined, decls: SessionMemberDecl[], from: Session): SessionMemberDecl[] {
    let changed = false;
    const effective: SessionMemberDecl[] = [];
    const declared = new Set(decls.map((d) => d.sessionId));
    for (const decl of decls) {
      const existing = this.roster.find((e) => e.sessionId === decl.sessionId);
      // 边界1：跨机 resume——册位绑原机器，异机声明拒绝复活+教学（迁移走显式操作）
      if (existing !== undefined && existing.machine !== mid) {
        const bound = existing.machineName ?? existing.machine.slice(0, 8);
        this.send(from.ws, {
          op: 'error',
          code: ERR.MACHINE_BOUND,
          message: `会话 ${decl.name ?? decl.sessionId.slice(0, 8)} 的册位绑在 ${bound}（同 id 异机不复活）——迁移走显式操作：先在 ${bound} 执行 crosschat serve --connect <星> --member-remove ${decl.sessionId.slice(0, 8)}，再在本机重新入星`,
        });
        this.log(`machine-bound 拒绝：${decl.sessionId.slice(0, 8)} 册在 ${bound}，${machineName ?? mid.slice(0, 8)} 声明`);
        continue;
      }
      let name = decl.name;
      // 边界6（extends 胜复活）：名字已被接任——原会话回归不夺回，名字剥离只留 id 寻址
      if (name !== undefined) {
        const successor = this.roster.find(
          (e) => e.extendsName === name && e.sessionId !== decl.sessionId && (e.tool ?? undefined) === (decl.tool ?? undefined),
        );
        if (successor !== undefined) {
          const succMachine = successor.machineName ?? successor.machine.slice(0, 8);
          const succName = successor.name ?? successor.sessionId.slice(0, 8);
          this.send(from.ws, {
            op: 'error',
            code: ERR.EXTENDS_CONFLICT,
            message: `会话名 ${name} 已由 ${succMachine}:${successor.tool === undefined ? '' : `${successor.tool}/`}${succName} 接任（--extend-session），回归不夺回——本会话按 id 寻址 tcp:${this.starName ?? '<星>'}:${machineName ?? mid.slice(0, 8)}:${decl.sessionId.slice(0, 8)}，或换名重启`,
          });
          this.log(`extends-wins：${decl.sessionId.slice(0, 8)} 回归不夺回名字 ${name}（接任者 ${succMachine}）`);
          name = undefined;
        }
      }
      // extends 接任登记（020 血统限定：同旧名同工具先声明先得，后到不生效）
      let extendsName = existing?.extendsName;
      let extendsMachine = existing?.extendsMachine;
      if (decl.extends !== undefined) {
        const oldName = typeof decl.extends === 'string' ? decl.extends : decl.extends.name;
        const oldMachine = typeof decl.extends === 'string' ? undefined : decl.extends.machine;
        const clash = this.roster.find(
          (e) => e.extendsName === oldName && e.sessionId !== decl.sessionId && (e.tool ?? undefined) === (decl.tool ?? undefined),
        );
        if (clash !== undefined) {
          const holder = clash.machineName ?? clash.machine.slice(0, 8);
          const winner = clash.name ?? clash.sessionId.slice(0, 8);
          this.send(from.ws, {
            op: 'error',
            code: ERR.EXTENDS_CONFLICT,
            message: `会话 ${decl.name ?? decl.sessionId.slice(0, 8)} 的 extends 旧名 ${oldName}${decl.tool === undefined ? '' : `（${decl.tool} 血统）`} 已由 ${holder} 的会话 ${winner} 接续（先声明先得）——本条 extends 未生效`,
          });
          this.log(`extends-conflict ${oldName}：${machineName ?? '?'} 后到，${holder} 先得`);
        } else {
          extendsName = oldName;
          extendsMachine = oldMachine;
        }
      }
      // 注册/复活（同 id 且机器一致）：upsert 上线（幂等——字段无变化不写盘）
      const next: RosterEntry = {
        sessionId: decl.sessionId,
        ...(name === undefined ? {} : { name }),
        ...(decl.tool === undefined ? {} : { tool: decl.tool }),
        machine: mid,
        ...(machineName === undefined ? {} : { machineName }),
        online: true,
        ...(extendsName === undefined ? {} : { extendsName }),
        ...(extendsMachine === undefined || typeof decl.extends !== 'object' ? {} : { extendsMachine }),
      };
      if (existing === undefined) {
        this.roster.push(next);
        changed = true;
      } else if (
        existing.name !== next.name || existing.tool !== next.tool || existing.online !== true ||
        existing.extendsName !== next.extendsName || existing.extendsMachine !== next.extendsMachine ||
        existing.machineName !== next.machineName
      ) {
        this.roster[this.roster.indexOf(existing)] = next;
        changed = true;
      }
      effective.push(name === undefined ? { ...decl, name: undefined } : decl);
    }
    // 下线：该机在册但未声明（死/退出）——册位保留，翻 offline（--rm 走 member-remove 删条）
    for (const entry of this.roster) {
      if (entry.machine === mid && entry.online && !declared.has(entry.sessionId)) {
        entry.online = false;
        changed = true;
        this.log(`member-offline ${entry.name ?? entry.sessionId.slice(0, 8)}（未声明，册位保留）`);
      }
    }
    if (changed) this.persistRoster();
    return effective;
  }

  /** 该机在册条目全部转下线（聚合器断连；册位保留）。 */
  private setMachineOffline(mid: string): void {
    let changed = false;
    for (const entry of this.roster) {
      if (entry.machine === mid && entry.online) {
        entry.online = false;
        changed = true;
      }
    }
    if (changed) this.persistRoster();
  }

  private persistRoster(): void {
    if (!writeRoster(rosterFileOf(this.d.registryFile), this.roster)) {
      this.log('roster 落盘失败（下次数变化重试）');
    }
  }

  /**
   * 028 恢复链常态化输入：聚合器查"我机器的册内切片"（在线+下线都在——本地
   * 验活后活的重新声明=复活，死的保持未声明=下线）。老语义（最后已知名单）
   * 由本切片取代；broker 重启不再失忆（roster 落盘）。
   */
  private onMembersQuery(session: Session): void {
    if (session.machineId === undefined) return; // sender 角色不受理
    const mid = normalizeMid(session.machineId);
    const slice = this.roster
      .filter((e) => e.machine === mid)
      .map((e): SessionMemberDecl => ({
        sessionId: e.sessionId,
        ...(e.name === undefined ? {} : { name: e.name }),
        ...(e.tool === undefined ? {} : { tool: e.tool }),
        ...(e.extendsName === undefined ? {} : { extends: e.extendsMachine === undefined ? e.extendsName : { machine: e.extendsMachine, name: e.extendsName } }),
      }));
    const reply: MembersResultFrame = { op: 'members-result', members: slice };
    this.send(session.ws, reply);
    this.log(`members-query ${session.machineName ?? session.machineId.slice(0, 8)}: 回 ${slice.length} 条册内切片`);
  }

  /**
   * 028 成员删除（星内任何机器可执——纯册状态操作；--rm 退场离册同帧）。
   * 幂等：零命中=成功注明本不在册；多名/多 id 前缀命中=拒绝列 id8 教消歧。
   * 删除后向归属机聚合器（若在线）转发同帧清其本地表，防下次重播回册。
   */
  private onMemberRemove(session: Session, frame: MemberRemoveFrame): void {
    const target = frame.target;
    // 匹配泳道（先specific后模糊）：精确会话 id（--rm erase 上报全量 id）→
    // id 前缀（≥8 位 hex 形态，命令面 id8）→ 名字精确。首泳道命中即定。
    const lower = target.toLowerCase();
    const exact = this.roster.filter((e) => e.sessionId === target);
    const hits =
      exact.length > 0
        ? exact
        : target.length >= 8 && /^[0-9a-fA-F-]+$/.test(target)
          ? this.roster.filter((e) => e.sessionId.toLowerCase().startsWith(lower))
          : this.roster.filter((e) => e.name === target);
    const reply = (ok: boolean, removed: string[], error?: string): void => {
      const res: MemberRemoveResultFrame = { op: 'member-remove-result', ok, removed, ...(error === undefined ? {} : { error }) };
      this.send(session.ws, res);
    };
    if (hits.length > 1) {
      const lines = hits.map((e) => `  ${e.machineName ?? e.machine.slice(0, 8)}:${e.tool === undefined ? '' : `${e.tool}/`}${e.name ?? '?'}(${e.sessionId.slice(0, 8)})`).join('\n');
      reply(false, [], `成员 ${target} 命中多个册内条目：\n${lines}\n改用会话 id 前 8 位精确删除`);
      this.log(`member-remove ${target}：多命中拒绝`);
      return;
    }
    const removed: string[] = [];
    for (const entry of hits) {
      this.roster.splice(this.roster.indexOf(entry), 1);
      removed.push(entry.name ?? entry.sessionId.slice(0, 8));
      // 归属机聚合器在线则转发清本地表（否则其重播会把条目带回册——幂等无害但噪音）
      const owner = this.online.get(entry.machine);
      if (owner !== undefined && owner !== session) this.send(owner.ws, { op: 'member-remove', target: entry.sessionId });
    }
    if (removed.length > 0) this.persistRoster();
    reply(true, removed, removed.length === 0 ? `成员 ${target} 本不在册（幂等成功）` : undefined);
    this.log(`member-remove ${target}：删 ${removed.length} 条`);
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
      const conn = this.online.get(nm);
      const decls = conn?.members !== undefined && conn.members.size > 0 ? [...conn.members.values()] : undefined;
      machines.set(nm, {
        ...(node.machineName === undefined ? {} : { name: node.machineName }),
        mid8: nm.slice(0, 8),
        online: (ownNorm !== '' && nm === ownNorm) || conn !== undefined,
        ...(decls === undefined ? {} : { sessions: decls }),
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

  /**
   * 会话段在目标机器连接的成员表内解析（020 收命中集，替代旧"首个名命中即投"
   * 的静默首中）：全串裸名精确优先（名字可含 `/`——防"会话起名 tool/x 而机器
   * 恰有 tool"的自伤边角）→ 1 命中投 / >1 碰撞错误。未命中才拆 `工具/` 前缀，
   * 且前缀仅当命中该机已声明的 tool 值才当限定词（broker 永不硬编码工具清单，
   * 新适配器声明即寻址）；再 id8/加长前缀（≥8 位 hex，照机器段 mid8 规则）；
   * 再 extends 旧名（roster 接任者优先——含复活不夺回）；最后 028 下线检查
   * （册内在册未在线→SESSION_OFFLINE 教学，绝不静默改投）；册外无名照旧
   * SESSION_NOT_MEMBER。
   */
  private resolveSessionMember(target: Session, sessionName: string): ResolvedTarget {
    const members = [...target.members?.values() ?? []];
    const declaredTools = new Set(members.flatMap((m) => (m.tool === undefined ? [] : [m.tool])));
    const machine = target.machineName ?? target.machineId?.slice(0, 8) ?? '?';
    const hit = (m: SessionMemberDecl): ResolvedTarget => ({ kind: 'session', ws: target.ws, sessionId: m.sessionId });
    // 1) 全串裸名精确（名字或全量会话 id——今日全量 id 寻址零回归）
    const exact = members.filter((m) => m.name === sessionName || m.sessionId === sessionName);
    if (exact.length === 1) return hit(exact[0]!);
    if (exact.length > 1) return this.sessionCollision(sessionName, exact, machine);
    // 2) 限定词拆解（仅当命中该机已声明 tool 集；否则整体视为会话名，落到 3/4）
    const slash = sessionName.indexOf('/');
    if (slash > 0 && slash < sessionName.length - 1) {
      const tool = sessionName.slice(0, slash).toLowerCase();
      const rest = sessionName.slice(slash + 1);
      if (declaredTools.has(tool)) {
        const qualified = members.filter((m) => m.tool === tool && (m.name === rest || m.sessionId === rest));
        if (qualified.length === 1) return hit(qualified[0]!);
        if (qualified.length > 1) return this.sessionCollision(rest, qualified, machine);
        const sup = this.extendsHit(tool, rest);
        if (sup !== undefined) return sup;
        return {
          kind: 'error',
          code: ERR.SESSION_NOT_MEMBER,
          message: `会话 ${sessionName} 不是星成员——会话须经启动器入星（crosschat claude/codex --connect <星>）才能按名投递`,
        };
      }
    }
    // 3) 会话 id 前缀（id8 短前缀寻址；多命中教加长——照机器段 mid8 规则）
    const idLike = sessionName.length >= 8 && /^[0-9a-fA-F-]+$/.test(sessionName);
    if (idLike) {
      const lower = sessionName.toLowerCase();
      const byId = members.filter((m) => m.sessionId.toLowerCase().startsWith(lower));
      if (byId.length === 1) return hit(byId[0]!);
      if (byId.length > 1) {
        const ids = byId.map((m) => m.sessionId.slice(0, 12)).join(', ');
        return { kind: 'error', code: ERR.NAME_COLLISION, message: `会话 id 前缀 ${sessionName} 在 ${machine} 上命中多个成员（${ids}）——加长前缀后重试` };
      }
    }
    // 4) extends 旧名（roster 接任者优先——含 028 复活不夺回；裸名收全部血统）
    const sup = this.extendsHit(undefined, sessionName);
    if (sup !== undefined) return sup;
    // 5) 028 下线成员（该机在册、当前未在线）——报错等上线，绝不静默改投
    const down = this.roster.find(
      (e) => e.machine === normalizeMid(target.machineId ?? '') && !e.online &&
        (e.name === sessionName || (idLike && e.sessionId.toLowerCase().startsWith(sessionName.toLowerCase()))),
    );
    if (down !== undefined) {
      return {
        kind: 'error',
        code: ERR.SESSION_OFFLINE,
        message: `成员 ${down.name ?? down.sessionId.slice(0, 8)} 已下线（册位保留）——等其 resume 上线（同 id 自动复活）或 --extend-session 接任；点对点直达其特定会话可用 id8 寻址（现也下线，上线即达）`,
      };
    }
    return {
      kind: 'error',
      code: ERR.SESSION_NOT_MEMBER,
      message: `会话 ${sessionName} 不是星成员——会话须经启动器入星（crosschat claude/codex --connect <星>）才能按名投递`,
    };
  }

  /**
   * 020 撞名错误构造：跨工具（全部带 tool 且 ≥2 种）列限定地址、教改投限定；
   * 同工具同名或混老聚合器（无 tool）限定地址相同——列 id8 行、教 id 前缀照抄，
   * 后者加"对端聚合器版本旧"升级教学。
   */
  private sessionCollision(
    name: string,
    hits: SessionMemberDecl[],
    machine: string,
  ): ResolvedTarget {
    const star = this.starName ?? '<星>';
    const anyToolless = hits.some((h) => h.tool === undefined);
    const distinctTools = new Set(hits.flatMap((h) => (h.tool === undefined ? [] : [h.tool])));
    const qualifiedUnique = !anyToolless && distinctTools.size >= 2;
    const lines = hits
      .map((h) =>
        qualifiedUnique
          ? `  tcp:${star}:${machine}:${h.tool}/${name}`
          : `  ${h.tool === undefined ? '' : `${h.tool}/`}${name}(${h.sessionId.slice(0, 8)})`,
      )
      .join('\n');
    const teach = qualifiedUnique
      ? '改投限定地址即可'
      : `限定地址相同（${anyToolless ? '对端聚合器未声明 tool' : '同工具同名'}）——改投 id 前缀：tcp:${star}:${machine}:<id 前 8 位>（括号内照抄）`;
    const note = anyToolless ? '；部分成员未声明 tool——对端聚合器版本旧，升级后可用 工具/名 限定词消歧' : '';
    return {
      kind: 'error',
      code: ERR.NAME_COLLISION,
      message: `会话名 ${name} 在 ${machine} 上有多个同名成员：\n${lines}\n${teach}${note}`,
    };
  }

  /** extends 旧名命中（028 起查落盘 roster——接任随册持久；1 血统→SUPERSEDED 指路；多血统→碰撞列接任者地址）。 */
  private extendsHit(tool: string | undefined, oldName: string): ResolvedTarget | undefined {
    const entries = this.roster.filter((e) => e.extendsName === oldName);
    const hits = tool === undefined ? entries : entries.filter((e) => (e.tool ?? undefined) === tool);
    if (hits.length === 0) return undefined;
    if (hits.length === 1) return this.superseded(oldName, hits[0]!);
    const star = this.starName ?? '<星>';
    const lines = hits
      .map((e) => {
        const m = e.machineName ?? e.machine.slice(0, 8);
        const n = e.name ?? e.sessionId.slice(0, 8);
        return `  tcp:${star}:${m}:${e.tool === undefined ? '' : `${e.tool}/`}${n}`;
      })
      .join('\n');
    return {
      kind: 'error',
      code: ERR.NAME_COLLISION,
      message: `旧会话名 ${oldName} 有多条接续血统：\n${lines}\n改投接任者地址即可`,
    };
  }

  /** SESSION_SUPERSEDED 指路（020：接任者带工具限定词；无 tool 同旧形态）。 */
  private superseded(oldName: string, entry: RosterEntry): ResolvedTarget {
    const succMachine = entry.machineName ?? entry.machine.slice(0, 8);
    const succName = entry.name ?? entry.sessionId.slice(0, 8);
    const succTool = entry.tool === undefined ? '' : `${entry.tool}/`;
    return {
      kind: 'error',
      code: ERR.SESSION_SUPERSEDED,
      message: `会话 ${oldName} 已由 ${succMachine}:${succTool}${succName} 接续——改投接任者 tcp:${this.starName ?? '<星>'}:${succMachine}:${succTool}${succName}`,
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
            pid: process.pid, // 026：doctor 验活用
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
