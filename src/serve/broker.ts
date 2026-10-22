/**
 * tcp broker 服务端（票B B1）：全网唯一监听端口、节点零入站的星型组件。
 * ws 复用仓内依赖；投递处理器注入化（B2 接 runSend，B1 默认 NOT_READY）。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import * as net from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { PIPE_PREFIX } from '../platform/pipe-transport.js';
import {
  CAP_CHALLENGE_AUTH,
  CAP_MULTI_STAR,
  CAP_SESSION_MEMBERS,
  ERR,
  hasCap,
  MAX_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
  encodeFrame,
  parseFrame,
  sanitizeTool,
} from './protocol.js';
import type {
  AdminOpFrame,
  AdminOpResultFrame,
  AuthProofFrame,
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
  SocketLike,
  StatusPayload,
  StatusQueryFrame,
  StatusResultFrame,
  MemberRemoveFrame,
  MemberRemoveResultFrame,
  MemberRemoveExactFrame,
} from './protocol.js';
import {
  addStarTo,
  genAdminKeyFor,
  genKeysFor,
  loadBrokerFile,
  mutateBrokerFile,
  removeAdminKeyFor,
  removeNodeFor,
  removeStarFrom,
  sanitizeName,
  setNameFor,
  setShowNameFor,
  setStarShowNameFor,
  type NodeEntry,
  type RosterEntry,
} from './registry.js';

/** 028→032 兼容再导出：RosterEntry 定义随星册内嵌挪至 registry.ts（broker.json 同文件）。 */
export type { RosterEntry } from './registry.js';
import { FILE_MAX_BYTES, FileInbox } from './file-channel.js';
import { normalizeMid } from '../platform/machine-id.js';
import { parseDiscoveryRequest, parseDiscoveryResponse } from '../application/discovery/boundary.js';
import type { DiscoveryEndpoint, DiscoveryRequest, DiscoveryResponse } from '../application/discovery/model.js';
import type { DiscoverQueryFrame, DiscoverResultFrame } from './protocol.js';

/**
 * 默认端口 7260。IANA service-names-port-numbers 核对（2026-10-10 实查）：
 * 7260 未分配；顺延候选 7261/7262 亦未分配（留作将来冲突时顺延）。
 */
export const DEFAULT_PORT = 7260;

/**
 * 028 星成员册（roster）条目：成员资格 v2 的落盘事实源——注册/下线/复活/
 * extends 接任/remove 全落此。032 起随星内嵌 broker.json（定义在 registry.ts，
 * 此处再导出）；聚合器 sessions 帧=该机成员的在线声明，未声明的在册条目=下线
 * （死亡不再除名）。
 */

export interface BrokerDeps {
  registryFile: string;
  statusFile: string;
  /** package version，进 info.server。 */
  version: string;
  machineId: () => string | undefined;
  hostname: () => string;
  now: () => number;
  log: (line: string) => void;
  /**
   * B2 接 runSend；B1 默认实现回 NOT_READY。F1：第二参=发送方机器名（roster 真名，
   * 无名缺省）。022：第三参=目标星域（多星下信封星段随发送方连接的属星，回执
   * ref/from-star 同源；单星与旧调用方缺省不变）。
   */
  deliverLocal: (frame: SendFrame, fromMachine?: string, star?: { starId?: string; name?: string }) => Promise<ResultFrame | ErrorFrame>;
  /** B2：本机文件接收器（file-* 帧目标为 broker 机时落盘）；缺省 NOT_READY。 */
  fileInbox?: FileInbox;
  /** E1：本机会话扫描（status-query 目标是 ownMid 时应答）；缺省 NOT_READY。 */
  scanStatus?: () => Promise<StatusPayload>;
  /** 当前只读发现入口；每次读取独立取消，不复用有补投副作用的旧 status。 */
  discover?: DiscoveryEndpoint['execute'];
  /** 显式端口（0 = 随机，测试用）；缺省读注册表再缺省 DEFAULT_PORT。 */
  port?: number;
  heartbeatMs?: number;
  pongTimeoutMs?: number;
  connectTimeoutMs?: number;
  authFailDelayMs?: number;
  resultTimeoutMs?: number;
  /** 心跳 ping 发射器（测试注入 noop 模拟永不 pong 的死连接）。 */
  ping?: (ws: SocketLike) => void;
  /**
   * 033：内挂聚合器播种/收尾（serve 面注入）。spawn 含外部守护让位检查（幂等
   * ——未登记/让位形态静默跳过）；stop 供删星/停机收尾。热加星对账即调。
   */
  spawnLocalAggregator?: (starId: string) => void;
  stopLocalAggregator?: (starId: string) => Promise<void>;
}

/**
 * 033 管理插座回执：一行 JSON（ok=false 时 error 带人话教学）。CLI 打印的
 * "已生效"必出自此回执（021 不预支成功纪律）。
 */
export interface AdminReply {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
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
  /** 022：ws.WebSocket 或本进程自挂聚合器的虚拟 socket（SocketLike 同形状）。 */
  ws: SocketLike;
  authed: boolean;
  machineId?: string;
  machineName?: string;
  lastPong: number;
  connectTimer?: ReturnType<typeof setTimeout>;
  /** 018：该连接声明的会话成员（sessions 帧全量重播语义；undefined=从未声明）。连接断即随机器条目消失。 */
  members?: Map<string, SessionMemberDecl>;
  /** 022 连接绑星：钥匙核验命中的星（路由/册/注册表全按它切片；036 起无单星兜底——未绑星=异常形态）。 */
  starId?: string;
  /**
   * 034 认证身份（authed 后有值）：'member'=星钥连接（node/sender，同星共钥=
   * 互信域）；'admin'=星管理钥连接（挑战应答）。管理 op 的角色矩阵按它闸。
   */
  identity?: 'member' | 'admin';
  /** 034 挑战应答在途（管理连接）：nonce 一次性——发证明即消费，重复证明按重放拒。 */
  challenge?: { nonce: string };
  /** 034 星管理钥 label（审计来源行用——钥匙本体永不进日志）。 */
  adminLabel?: string;
  /** D02：实际认证凭证归属；sender 无 machineId，撤销不能以机器或 label 代替。 */
  credential?: { kind: 'node' | 'admin'; key: string };
  /** 撤权同步生效，close 回调前已经排队的帧也不得再执行。 */
  revoked?: boolean;
}

/**
 * 022 星域状态：一星一册一在线表（连接绑星——Session.starId 定归属；同一
 * 机器入两星=两条连接两个星域互不干扰）。星级身份以 starId 为键（addStar
 * 恒生成；缺省按 stars[0] 唯一性兜底）。032：册不再有独立文件——持久化走
 * mutateBrokerFile 拼段（broker.json 单文件）。
 */
interface StarState {
  starId?: string;
  name?: string;
  roster: RosterEntry[];
  online: Map<string, Session>;
}

type RouteOutcome =
  | { kind: 'result'; frame: ResultFrame & { status: 'delivered' | 'queued' | 'parked' } }
  | { kind: 'status'; frame: StatusResultFrame }
  | { kind: 'error'; code: string; message: string };

/** 018 send/file 目标解析结果（机器级双轨 + 会话级第三轨；022：ws 面=SocketLike——虚拟连接同轨）。 */
type ResolvedTarget =
  | { kind: 'local' }
  | { kind: 'node'; ws: SocketLike }
  | { kind: 'session'; ws: SocketLike; sessionId: string }
  | { kind: 'error'; code: string; message: string };

interface PendingResult {
  senderWs: SocketLike;
  targetWs: SocketLike;
  timer: ReturnType<typeof setTimeout>;
  resolve: (outcome: RouteOutcome) => void;
}

interface PendingDiscovery {
  sender: Session;
  requestId: string;
  starId: string;
  request: DiscoveryRequest;
  target?: Session;
  controller?: AbortController;
  timer: ReturnType<typeof setTimeout>;
}

/** B2：一笔文件传输的路由（id → 发送方与目标连接；targetWs=undefined 即本机）。 */
interface FileRoute {
  senderWs: SocketLike;
  targetWs: SocketLike | undefined;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // 长度不同先失败：timingSafeEqual 对不等长直接抛
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * 034 op×角色矩阵（表驱动）：WS 管理 op（admin-op 帧）→ 允许的连接身份。
 * 三层角色：普通成员（星钥）读本星；星管理员（星管理钥）另可发钥/删节点；
 * broker 主=本机插座专属（世上不存在全能远程钥匙）——list-stars/set-name/
 * add-star/remove-star 等本机域 op 空表即"WS 无人可用"，一律 ADMIN_REQUIRED。
 */
const ADMIN_OP_MATRIX: Record<string, readonly ('member' | 'admin')[]> = {
  'list-nodes': ['member', 'admin'],
  'list-members': ['member', 'admin'],
  'gen-key': ['admin'],
  'remove-node': ['admin'],
  'list-stars': [],
  'set-name': [],
  'add-star': [],
  'remove-star': [],
  'set-showname': [],
  'gen-admin-key': [],
  'remove-admin-key': [],
};

export class Broker {
  private readonly d: Required<Omit<BrokerDeps, 'port' | 'fileInbox' | 'scanStatus' | 'discover' | 'spawnLocalAggregator' | 'stopLocalAggregator'>> & {
    port?: number;
    fileInbox?: FileInbox;
    scanStatus?: () => Promise<StatusPayload>;
    discover?: DiscoveryEndpoint['execute'];
    spawnLocalAggregator?: (starId: string) => void;
    stopLocalAggregator?: (starId: string) => Promise<void>;
  };
  private wss?: WebSocketServer;
  private port?: number;
  /** 022：托管星域（连接绑星后一切星内状态按此切片；单星=[0] 行为与旧版逐字节等价）。 */
  private stars: StarState[] = [];
  private multiStar = false;
  private startedAt?: number;
  private stopped = false;
  private readonly sessions = new Set<Session>();
  private readonly pending = new Map<string, PendingResult>();
  /** 发现路由使用 broker 私有 id，客户端 id 仅在其连接内有效。 */
  private readonly discoveries = new Map<string, PendingDiscovery>();
  private readonly fileRoutes = new Map<string, FileRoute>();
  private hbTimer?: ReturnType<typeof setInterval>;
  /** 033：本机管理插座（台账唯一写入口的受理端；地址随机=知道地址即能力）。 */
  private adminServer?: net.Server;
  private adminPipe?: string;
  /** unix 域套接字文件路径（win 命名管不落盘，undefined）；stop 时清理。 */
  private adminSockFile?: string;
  /** 在途管理连接（stop 时强制收口——旧 typings 无 closeAllConnections）。 */
  private readonly adminSockets = new Set<net.Socket>();
  /**
   * 033 已收尾会话（热删星闭连接）：onClose/onMessage 跳过星域清理与帧处理。
   * 036 起 starOf 兜底已删（残余会话的 starId 指向已弃星、starOf 自然未命中），
   * 此集合转为防御性收口（删星竞态窗口内到达的帧/关闭事件不落入幸存星）。
   */
  private readonly reapedSessions = new Set<Session>();

  constructor(deps: BrokerDeps) {
    this.d = {
      heartbeatMs: 30_000,
      pongTimeoutMs: 60_000,
      connectTimeoutMs: 10_000,
      authFailDelayMs: 500,
      resultTimeoutMs: 120_000,
      ...deps,
      hostname: deps.hostname ?? (() => hostname()),
      ping: deps.ping ?? ((ws) => ws.ping?.()),
    };
  }

  /** 监听并返回实际端口（deps.port=0 时为随机端口）。 */
  async start(): Promise<number> {
    // 022/032：星域载入（broker.json 单文件，册随星内嵌）。serve 面在 start
    // 前已 bootstrap/ensureStarIds——这里只读不写，裸用（测试）容许无名星。
    const doc = loadBrokerFile(this.d.registryFile);
    this.multiStar = doc.stars.length > 1;
    this.stars = doc.stars.map((s) => ({
      ...(s.starId === undefined ? {} : { starId: s.starId }),
      ...(s.name === undefined ? {} : { name: s.name }),
      roster: s.roster,
      online: new Map<string, Session>(),
    }));
    const wantPort = this.d.port ?? doc.port ?? DEFAULT_PORT;
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
    this.startAdminPipe();
    this.writeStatus('running');
    this.hbTimer = setInterval(() => this.heartbeat(), this.d.heartbeatMs);
    wss.on('connection', (ws) => this.onConnection(ws));
    this.d.log(`${new Date(this.startedAt).toISOString()} broker listening on 0.0.0.0:${this.port}`);
    return this.port;
  }

  /**
   * 033：起本机管理插座（win 命名管 / unix 域套接字，**零 TCP 端口**）。地址
   * 随机（知道地址=能力，同仓 cc-msg-* 管道先例），写进 status-broker.json 的
   * adminPipe 字段——CLI 管理命令热路径由此找到它。受理台账写 op（决策2：
   * broker 运行期是台账唯一写者）。监听失败不倒 broker（CLI 退冷路径，日志留痕）。
   */
  private startAdminPipe(): void {
    const sockDir = dirname(this.d.statusFile);
    const pipe = process.platform === 'win32'
      ? `${PIPE_PREFIX}crosschat-admin-${randomBytes(8).toString('hex')}`
      : join(sockDir, `admin-${randomBytes(8).toString('hex')}.sock`);
    const server = net.createServer();
    server.on('connection', (socket) => this.onAdminConnection(socket));
    try {
      mkdirSync(sockDir, { recursive: true });
      server.listen(pipe);
      this.adminServer = server;
      this.adminPipe = pipe;
      if (process.platform !== 'win32') this.adminSockFile = pipe;
      this.d.log(`admin 插座已监听：${pipe}`);
    } catch (err) {
      this.d.log(`admin 插座监听失败（CLI 将走冷路径）：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** 一问一答：一行 JSON 请求 → 一行 JSON 回执（AdminReply），超时/坏形状拒绝。 */
  private onAdminConnection(socket: net.Socket): void {
    this.adminSockets.add(socket);
    socket.on('close', () => this.adminSockets.delete(socket));
    let buf = '';
    let replied = false;
    const timer = setTimeout(() => {
      try {
        socket.end(`${JSON.stringify({ ok: false, error: '管理请求处理超时' })}\n`);
      } catch {
        // 已断开
      }
    }, 10_000);
    socket.on('error', () => {
      clearTimeout(timer);
      socket.destroy();
    });
    socket.on('data', (chunk) => {
      if (replied) return;
      buf += chunk.toString('utf8');
      if (buf.length > 65_536) {
        socket.destroy();
        return;
      }
      const idx = buf.indexOf('\n');
      if (idx < 0) return;
      replied = true;
      clearTimeout(timer);
      const line = buf.slice(0, idx);
      void (async () => {
        let reply: AdminReply;
        try {
          const req = JSON.parse(line) as Record<string, unknown>;
          if (req === null || typeof req !== 'object' || typeof req.op !== 'string') {
            reply = { ok: false, error: '管理请求形状错误（须为含 op 的 JSON 对象）' };
          } else {
            reply = await this.adminOp(req);
          }
        } catch (err) {
          reply = { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
        try {
          socket.end(`${JSON.stringify(reply)}\n`);
        } catch {
          // 对端已断开
        }
      })();
    });
  }

  /**
   * 033 op 分发——全调 registry.ts 库函数（冷路径 CLI 直调同一套，函数不分
   * 家），回执带对账后状态。星清单变更 op 经 reconcileStars 增量播种/收尾。
   */
  private async adminOp(req: Record<string, unknown>): Promise<AdminReply> {
    const str = (k: string): string | undefined => (typeof req[k] === 'string' ? (req[k] as string) : undefined);
    const int = (k: string): number | undefined => (typeof req[k] === 'number' && Number.isInteger(req[k]) ? (req[k] as number) : undefined);
    const LOCAL = '本机插座'; // 034 审计来源：插座受理即 broker 主本人（地址随机=能力）
    switch (req.op) {
      case 'add-star': {
        const name = str('name');
        if (name === undefined || name === '') return { ok: false, error: 'add-star 缺少 name' };
        const starId = addStarTo(this.d.registryFile, name, {
          machineId: this.d.machineId(),
          hostname: this.d.hostname(),
          port: this.port ?? DEFAULT_PORT,
        });
        this.auditAdmin('add-star', `星 ${name}`, LOCAL);
        this.reconcileStars(); // 新星落位 + 按需播种内挂聚合器
        return { ok: true, starId, stars: this.stars.length };
      }
      case 'remove-star': {
        const starId = str('starId');
        if (starId === undefined) return { ok: false, error: 'remove-star 缺少 starId' };
        const removed = removeStarFrom(this.d.registryFile, starId);
        if (removed === undefined) return { ok: false, error: `星 ${starId} 不在台账——crosschat serve --list 可查` };
        this.auditAdmin('remove-star', `星 ${removed.name ?? starId}`, LOCAL);
        await this.teardownStar(starId); // 弃状态→停聚合器→闭连接（收"星已删除"教学）
        this.writeStatus('running');
        return { ok: true, removed };
      }
      case 'set-showname': {
        const name = str('name');
        if (name === undefined) return { ok: false, error: 'set-showname 缺少 name（空串=清除）' };
        const nodeJson = join(dirname(this.d.registryFile), 'node.json');
        // 036 双形态：带 starId=条目级覆盖（只重挂该星聚合器）；缺省=全局默认
        //（顶层 showName，重挂全部）。重挂即重连握手自报新名（machineName 回写
        // 随 connect 落台账——每星一份）。
        const starId = str('starId');
        if (starId !== undefined) {
          try {
            setStarShowNameFor(nodeJson, starId, name);
          } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
          }
          this.auditAdmin('set-showname', `星 ${starId} 显示名 ${name}`, LOCAL);
          try {
            await this.d.stopLocalAggregator?.(starId);
          } catch {
            // 收尾尽力而为
          }
          this.d.spawnLocalAggregator?.(starId);
          return { ok: true };
        }
        setShowNameFor(nodeJson, name);
        this.auditAdmin('set-showname', `显示名 ${name}`, LOCAL);
        for (const star of [...this.stars]) {
          if (star.starId === undefined) continue;
          try {
            await this.d.stopLocalAggregator?.(star.starId);
          } catch {
            // 收尾尽力而为
          }
          this.d.spawnLocalAggregator?.(star.starId);
        }
        return { ok: true };
      }
      case 'gen-key': {
        const starId = str('starId');
        const n = int('n');
        const host = str('host');
        if (starId === undefined || n === undefined || host === undefined) {
          return { ok: false, error: 'gen-key 缺少 starId/n/host' };
        }
        const star = loadBrokerFile(this.d.registryFile).stars.find((s) => s.starId === starId);
        if (star === undefined) return { ok: false, error: `星 ${starId} 不在台账` };
        const results = genKeysFor(this.d.registryFile, starId, n, {
          host,
          port: this.port ?? DEFAULT_PORT, // 热路径端口以在跑 broker 实际监听口为准
          ...(star.name === undefined ? {} : { name: star.name }),
        });
        this.auditAdmin('gen-key', `星 ${star.name ?? starId} n=${n}`, LOCAL);
        return { ok: true, results };
      }
      case 'set-name': {
        const starId = str('starId');
        const name = str('name');
        if (starId === undefined || name === undefined) return { ok: false, error: 'set-name 缺少 starId/name' };
        setNameFor(this.d.registryFile, starId, name);
        this.auditAdmin('set-name', `星 ${name}`, LOCAL);
        this.reconcileStars(); // 星名刷新进内存星域 + status
        return { ok: true };
      }
      case 'gen-admin-key': {
        // 034 发星管理钥（仅 broker 主本机插座）：label 绑定一星，回执带 adminKey
        const starId = str('starId');
        const label = str('label');
        if (starId === undefined || label === undefined) return { ok: false, error: 'gen-admin-key 缺少 starId/label' };
        const result = genAdminKeyFor(this.d.registryFile, starId, label);
        this.auditAdmin('gen-admin-key', `星 ${starId} label=${label}`, LOCAL);
        return { ok: true, result };
      }
      case 'remove-admin-key': {
        // 吊星管理钥仅 broker 主本机：认证连接立即失效，在途挑战仍现读台账验证。
        const starId = str('starId');
        const label = str('label');
        if (starId === undefined || label === undefined) return { ok: false, error: 'remove-admin-key 缺少 starId/label' };
        const entries = loadBrokerFile(this.d.registryFile).stars.find((s) => s.starId === starId)?.nodes ?? [];
        const removed = removeAdminKeyFor(this.d.registryFile, starId, label);
        this.auditAdmin('remove-admin-key', `星 ${starId} label=${removed ?? label}`, LOCAL);
        if (removed === undefined) return { ok: false, error: `星 ${starId} 无匹配管理钥 ${label}——crosschat serve --list 可查` };
        this.revokeCredentials(starId, entries.filter((entry) => entry.label === removed));
        return { ok: true, removed };
      }
      case 'remove-node': {
        const starId = str('starId');
        const label = str('label');
        if (starId === undefined || label === undefined) return { ok: false, error: 'remove-node 缺少 starId/label' };
        const removed = this.removeNodeCredential(starId, label);
        this.auditAdmin('remove-node', `星 ${starId} label=${label}`, LOCAL);
        return { ok: true, removed };
      }
      default:
        return { ok: false, error: `未知管理 op：${String(req.op)}` };
    }
  }

  /** 两个管理入口共用撤钥与在线失效，保留 registry 的精确 label/返回语义。 */
  private removeNodeCredential(starId: string, label: string): boolean {
    const entries = loadBrokerFile(this.d.registryFile).stars.find((s) => s.starId === starId)?.nodes.filter((entry) => entry.label === label) ?? [];
    const removed = removeNodeFor(this.d.registryFile, starId, label);
    if (removed) this.revokeCredentials(starId, entries);
    return removed;
  }

  /** 先标记所有匹配连接，再清路由/在线态和通知，避免同步虚拟连接回调重入。 */
  private revokeCredentials(starId: string, entries: NodeEntry[]): void {
    const affected = [...this.sessions].filter((session) => {
      if (session.starId !== starId || session.credential === undefined) return false;
      const credential = session.credential;
      return entries.some((entry) => {
        const key = credential.kind === 'admin' ? entry.adminKey : entry.key;
        return key !== undefined && safeEqual(credential.key, key);
      });
    });
    for (const session of affected) session.revoked = true;
    for (const session of affected) {
      const kind = session.credential!.kind;
      const message = kind === 'admin'
        ? '星管理钥已撤销，管理连接已失效；请向 broker 主索取新管理钥后重新连接'
        : '节点凭证已撤销，该星连接已失效并暂停自动重连；保留本机配置，换钥后显式重新连接';
      this.releaseSession(session, {
        code: ERR.CREDENTIAL_REVOKED,
        message: '对端凭证已撤销，连接已失效；已转发请求的结果需核实后再决定是否重发',
      });
      this.send(session.ws, { op: 'credential-revoked', starId, kind, reason: kind === 'admin' ? 'admin-key-revoked' : 'node-removed', message });
      try {
        session.ws.close(4001, 'credential revoked');
      } catch {
        // 状态与权限已经撤销，关闭中的连接无需重试。
      }
      this.log(`credential-revoked ${kind} 星 ${starId} ${session.adminLabel ?? session.machineName ?? session.machineId?.slice(0, 8) ?? 'sender'}`);
    }
  }

  /**
   * 033 对账+增量播种/收尾（管理 op 触发；幂等）：磁盘新增星落位并按需播种内
   * 挂聚合器；消失星收尾。syncStarsFromDisk 复用（032 连接入场对账同款）。
   */
  private reconcileStars(): void {
    const before = new Set(this.stars.flatMap((s) => (s.starId === undefined ? [] : [s.starId])));
    this.syncStarsFromDisk();
    const after = new Set(this.stars.flatMap((s) => (s.starId === undefined ? [] : [s.starId])));
    for (const id of after) {
      if (!before.has(id)) {
        try {
          this.d.spawnLocalAggregator?.(id);
        } catch (err) {
          this.log(`聚合器播种失败 星 ${id}：${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    for (const id of before) {
      if (!after.has(id)) void this.teardownStar(id);
    }
    this.writeStatus('running');
  }

  /**
   * 033 消失星收尾（决策1 顺序）：弃状态 → 停聚合器 → 闭连接。被删星在线会话
   * 先收"星已删除"错误帧再断（教学语；册随星葬、钥匙作废）。幂等（星不在=仅刷
   * 状态）。错误码 STAR_DELETED（034 收编 protocol.ts ERR 表——033 期为帧面
   * 零改动用的字面量）。
   */
  private async teardownStar(starId: string): Promise<void> {
    const star = this.stars.find((s) => s.starId === starId);
    this.stars = this.stars.filter((s) => s.starId !== starId);
    this.multiStar = this.stars.length > 1;
    for (const session of this.sessions) {
      if (session.starId === starId) this.cancelDiscoveriesFor(session, { code: ERR.STAR_DELETED, message: '星已删除，会话发现已取消' });
    }
    try {
      await this.d.stopLocalAggregator?.(starId);
    } catch {
      // 收尾尽力而为
    }
    if (star !== undefined) {
      const label = star.name ?? starId;
      for (const session of [...star.online.values()]) {
        this.sessions.delete(session);
        this.reapedSessions.add(session); // onClose 跳过星域清理（防残余会话误入幸存星）
        if (session.connectTimer !== undefined) clearTimeout(session.connectTimer);
        this.send(session.ws, {
          op: 'error',
          code: ERR.STAR_DELETED,
          message: `星 ${label} 已被删除（crosschat serve --remove-star）——册随星葬、钥匙作废、无墓碑无复活；如需重建找管理员 crosschat serve --add-star`,
        });
        try {
          session.ws.close(4001, 'star deleted');
        } catch {
          // 竞态关闭忽略
        }
        this.log(`star-deleted 断开 ${session.machineName ?? session.machineId?.slice(0, 8) ?? '?'}（星 ${label}）`);
      }
    }
    this.writeStatus('running');
  }

  /** 优雅退出：先停管理插座（不再受理台账写）再撤星状态、关连接、写终态。 */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.adminServer !== undefined) {
      const admin = this.adminServer;
      this.adminServer = undefined;
      for (const socket of this.adminSockets) {
        try {
          socket.destroy();
        } catch {
          // 已断开
        }
      }
      this.adminSockets.clear();
      try {
        admin.close();
      } catch {
        // 已关路径忽略
      }
    }
    if (this.adminSockFile !== undefined) {
      try {
        rmSync(this.adminSockFile);
      } catch {
        // 清理尽力而为
      }
      this.adminSockFile = undefined;
    }
    if (this.hbTimer !== undefined) clearInterval(this.hbTimer);
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.resolve({ kind: 'error', code: ERR.PEER_OFFLINE, message: 'broker 关闭' });
    }
    this.pending.clear();
    for (const routeId of [...this.discoveries.keys()]) {
      const entry = this.disposeDiscovery(routeId, true);
      if (entry !== undefined) this.discoveryError(entry, ERR.PEER_OFFLINE, 'broker 关闭，会话发现已取消');
    }
    for (const session of this.sessions) {
      try {
        session.ws.close(1000, 'broker shutting down');
      } catch {
        // 已断开的连接忽略
      }
    }
    this.sessions.clear();
    for (const star of this.stars) star.online.clear();
    this.writeStatus('stopped');
    await new Promise<void>((resolve) => {
      if (this.wss === undefined) return resolve();
      this.wss.close(() => resolve());
    });
  }

  private onConnection(ws: SocketLike): void {
    this.syncStarsFromDisk();
    // 022/036 握手时序恒倒置：info 只报 caps（multi-star 标记即"info 无星标识
    // 是合法形态"的信号），星标识由钥匙自证、connected 帧回填——单星 broker 的
    // info 携带星标识旧形随葬（统一当多星处理）。
    const session = this.registerSession(ws);
    this.send(ws, {
      op: 'info',
      proto: PROTOCOL_VERSION,
      server: `crosschat/${this.d.version}`,
      // 034：challenge-auth additive——管理连接（星管理钥）握手走挑战应答；
      // 客户端见此 cap 缺席即拒连无降级。星钥连接行为不变。
      caps: [CAP_SESSION_MEMBERS, CAP_MULTI_STAR, CAP_CHALLENGE_AUTH],
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

  /**
   * 022：本进程自挂聚合器的虚拟连接入场（serve 面构造 VirtualSocket 对后调
   * 用）——按星发 info（带星标识，聚合器预检照旧走 info 路径），此后帧走
   * onMessage 正道（connect 握手/成员声明/投递全用真实代码路径）。
   */
  admitLocal(ws: SocketLike, starId: string): void {
    const star = this.stars.find((s) => s.starId === starId);
    if (star === undefined) return;
    const session = this.registerSession(ws, star);
    // 036：info 恒倒置形（与 onConnection 同形）——星标识由 connected 回填，
    // 内挂聚合器预检走同一条延迟核星路径
    this.send(ws, {
      op: 'info',
      proto: PROTOCOL_VERSION,
      server: `crosschat/${this.d.version}`,
      caps: [CAP_SESSION_MEMBERS, CAP_MULTI_STAR, CAP_CHALLENGE_AUTH],
    });
    session.connectTimer = setTimeout(() => {
      this.log('connect-timeout 关闭本进程聚合器连接（握手未完成——异常形态）');
      try {
        ws.close(4000, 'connect timeout');
      } catch {
        // 竞态关闭忽略
      }
    }, this.d.connectTimeoutMs);
  }

  /**
   * 032：星域清单与磁盘对账（每笔连接入场时）——按 starId 匹配保留既有
   * StarState（在线表/内存册权威不丢），磁盘新增星落位（start 后播种/在跑
   * add-star 即时可见）、消失星剔除。星域节点表本就每操作现读，这里只对账
   * 清单与身份。
   */
  private syncStarsFromDisk(): void {
    const doc = loadBrokerFile(this.d.registryFile);
    const next: StarState[] = [];
    doc.stars.forEach((rec, index) => {
      // 匹配序：starId 精确 → 位对应（stars[] append-only 不变量；无 id 星/手编
      // 改 id 的星按位保留状态对象——在线表与内存册不因对账被清）。认领即刷新身份。
      const existing = (rec.starId !== undefined ? this.stars.find((s) => s.starId === rec.starId) : undefined) ?? this.stars[index];
      if (existing !== undefined) {
        existing.starId = rec.starId ?? existing.starId;
        existing.name = rec.name;
        next.push(existing);
      } else {
        next.push({
          ...(rec.starId === undefined ? {} : { starId: rec.starId }),
          ...(rec.name === undefined ? {} : { name: rec.name }),
          roster: rec.roster,
          online: new Map<string, Session>(),
        });
      }
    });
    this.stars = next;
    this.multiStar = next.length > 1;
  }

  /** 连接入场公共段：注册会话、挂事件、预绑星（钥匙核验前的 hint，onConnect 定案）。 */
  private registerSession(ws: SocketLike, star?: { starId?: string; name?: string }): Session {
    const session: Session = { ws, authed: false, lastPong: this.d.now(), ...(star?.starId === undefined ? {} : { starId: star.starId }) };
    this.sessions.add(session);
    ws.on('pong', () => {
      session.lastPong = this.d.now();
    });
    ws.on('close', () => this.onClose(session));
    ws.on('message', (data) => {
      void this.onMessage(session, String(data));
    });
    return session;
  }

  /**
   * 022/036：连接属星（钥匙核验后的权威归属）。036 起 stars[0] 兜底删除——
   * 032 后钥匙必绑星、连入按钥匙定籍；未绑星连接（异常形态）返回 undefined，
   * 调用方按"属星未定"处理。
   */
  private starOf(session: Session): StarState | undefined {
    if (session.starId === undefined) return undefined;
    return this.stars.find((s) => s.starId === session.starId);
  }

  /**
   * 022/032：星域节点表（broker.json 每笔现读——gen/remove/add-star 即时生
   * 效，哲学不变）。星域状态按位对应磁盘 stars[]，现读顺带把 starId/name
   * 刷新进 StarState（在跑加星/改名的星标识即时可见）。
   */
  private starNodes(star: StarState): NodeEntry[] {
    const index = this.stars.indexOf(star);
    const doc = loadBrokerFile(this.d.registryFile);
    const fresh = doc.stars[index];
    if (fresh === undefined) return [];
    star.starId = fresh.starId;
    star.name = fresh.name;
    return fresh.nodes;
  }

  private onClose(session: Session): void {
    this.releaseSession(session, { code: ERR.PEER_OFFLINE, message: '节点连接断开' });
  }

  /** 关闭事件与明确撤权共用资源收尾；撤权不等待 socket close。 */
  private releaseSession(session: Session, error: { code: string; message: string }): void {
    this.sessions.delete(session);
    this.cancelDiscoveriesFor(session, error);
    if (session.connectTimer !== undefined) clearTimeout(session.connectTimer);
    for (const [id, entry] of this.pending) {
      if (entry.targetWs === session.ws || entry.senderWs === session.ws) {
        clearTimeout(entry.timer);
        this.pending.delete(id);
        entry.resolve({ kind: 'error', ...error });
      }
    }
    // 撤权时 surviving sender 不会断线，显式结束其等待，但不宣称撤回已转发数据。
    for (const [id, route] of this.fileRoutes) {
      if (route.senderWs !== session.ws && route.targetWs !== session.ws) continue;
      this.fileRoutes.delete(id);
      if (error.code === ERR.CREDENTIAL_REVOKED && route.targetWs === session.ws && route.senderWs !== session.ws) {
        const sender = [...this.sessions].find((candidate) => candidate.ws === route.senderWs);
        if (sender !== undefined && !sender.revoked) this.send(route.senderWs, { op: 'file-result', id, ok: false, error: error.message });
      }
    }
    // 033：被删星收尾的会话——星域状态已随星弃置，跳过在线表/册回收（防残余
    // 会话误入幸存星）
    if (this.reapedSessions.delete(session)) return;
    // F0：online 键=归一 mid（onConnect 写入侧同款），下线按同键回收（022：星域内）
    if (session.machineId !== undefined) {
      const star = this.starOf(session);
      if (star !== undefined) {
        const midNorm = normalizeMid(session.machineId);
        if (star.online.get(midNorm) === session) {
          star.online.delete(midNorm);
          this.log(`node-down ${session.machineName ?? ''}(${session.machineId.slice(0, 8)})`);
          this.writeStatus('running');
          // 028：聚合器断连——该机在册条目全部转下线（顶换窗口里新连接已接管则跳过；
          // 册位保留，聚合器回线后由常驻对账循环按本地验活复活）
          if (star.online.get(midNorm) === undefined) this.setMachineOffline(star, midNorm);
        }
      }
    }
  }

  private async onMessage(session: Session, text: string): Promise<void> {
    if (session.revoked || this.reapedSessions.has(session)) return; // 已撤权/删星的排队帧丢弃
    const frame = parseFrame(text);
    if (frame === undefined) return; // 损坏/未知帧丢弃
    if (!session.authed) {
      // 034 挑战应答：管理连接 connect 后只等 auth-proof（nonce 一次性）；
      // 其余帧（含再来一份 connect）丢弃——握手超时兜底不变。
      if (session.challenge !== undefined) {
        if (frame.op === 'auth-proof') await this.onAuthProof(session, frame);
        return;
      }
      if (frame.op !== 'connect') return; // 只等 connect，握手超时兜底
      await this.onConnect(session, frame);
      return;
    }
    // 034 防重放：已认证连接上的重复 connect/auth-proof = 重放证明，拒绝不静默
    if (frame.op === 'connect' || frame.op === 'auth-proof') {
      await this.authFail(session, '重复握手/挑战证明（重放）拒绝——挑战一次性，每连接至多一份证明');
      return;
    }
    if (frame.op === 'admin-op') {
      this.onAdminOpFrame(session, frame);
      return;
    }
    if (frame.op === 'discover-query') {
      this.routeDiscovery(session, frame);
      return;
    }
    if (frame.op === 'discover-result') {
      this.onDiscoveryResult(session, frame);
      return;
    }
    if (frame.op === 'discover-cancel') {
      for (const [routeId, entry] of this.discoveries) {
        if (entry.sender === session && entry.requestId === frame.id) this.disposeDiscovery(routeId, true);
      }
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
      const star = this.starOf(session);
      if (star !== undefined) this.send(session.ws, this.buildRoster(star));
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
    if (frame.op === 'member-remove-exact') {
      this.onMemberRemoveExact(session, frame);
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
    const star = this.starOf(session);
    if (star === undefined) return; // 022：星域未定（异常形态）——声明无处落册
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
      this.applyRosterUpdate(star, normalizeMid(session.machineId), session.machineName, [...members.values()], session)
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
  private applyRosterUpdate(star: StarState, mid: string, machineName: string | undefined, decls: SessionMemberDecl[], from: Session): SessionMemberDecl[] {
    let changed = false;
    const effective: SessionMemberDecl[] = [];
    const declared = new Set(decls.map((d) => d.sessionId));
    for (const decl of decls) {
      const existing = star.roster.find((e) => e.sessionId === decl.sessionId);
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
        const successor = star.roster.find(
          (e) => e.extendsName === name && e.sessionId !== decl.sessionId && (e.tool ?? undefined) === (decl.tool ?? undefined),
        );
        if (successor !== undefined) {
          const succMachine = successor.machineName ?? successor.machine.slice(0, 8);
          const succName = successor.name ?? successor.sessionId.slice(0, 8);
          this.send(from.ws, {
            op: 'error',
            code: ERR.EXTENDS_CONFLICT,
            message: `会话名 ${name} 已由 ${succMachine}:${successor.tool === undefined ? '' : `${successor.tool}/`}${succName} 接任（--extend-session），回归不夺回——本会话按 id 寻址 tcp:${star.name ?? '<星>'}:${machineName ?? mid.slice(0, 8)}:${decl.sessionId.slice(0, 8)}，或换名重启`,
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
        const clash = star.roster.find(
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
        ...(decl.temporary === true ? { temporary: true } : {}),
      };
      if (existing === undefined) {
        star.roster.push(next);
        changed = true;
      } else if (
        existing.name !== next.name || existing.tool !== next.tool || existing.online !== true ||
        existing.extendsName !== next.extendsName || existing.extendsMachine !== next.extendsMachine ||
        existing.machineName !== next.machineName || existing.temporary !== next.temporary
      ) {
        star.roster[star.roster.indexOf(existing)] = next;
        changed = true;
      }
      effective.push(name === undefined ? { ...decl, name: undefined } : decl);
    }
    // 下线：该机在册但未声明（死/退出）——册位保留，翻 offline（--rm 走 member-remove 删条）
    for (const entry of star.roster) {
      if (entry.machine === mid && entry.online && !declared.has(entry.sessionId)) {
        entry.online = false;
        changed = true;
        this.log(`member-offline ${entry.name ?? entry.sessionId.slice(0, 8)}（未声明，册位保留）`);
      }
    }
    if (changed) this.persistRoster(star);
    return effective;
  }

  /** 该机在册条目全部转下线（聚合器断连；册位保留——022：星域内）。 */
  private setMachineOffline(star: StarState, mid: string): void {
    let changed = false;
    for (const entry of star.roster) {
      if (entry.machine === mid && entry.online) {
        entry.online = false;
        changed = true;
      }
    }
    if (changed) this.persistRoster(star);
  }

  /**
   * 032：册持久化——mutateBrokerFile 现读拼段（保住在跑 gen-key/add-star 写进
   * 文件的新钥匙/新星，整写内存快照严禁）；按 starId 定位星，找不到（异常
   * 形态）按位兜底。
   */
  private persistRoster(star: StarState): void {
    try {
      mutateBrokerFile(this.d.registryFile, (doc) => {
        const index = this.stars.indexOf(star);
        const target = doc.stars.find((s) => star.starId !== undefined && s.starId === star.starId) ?? doc.stars[index];
        if (target !== undefined) target.roster = star.roster;
      });
    } catch {
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
    const star = this.starOf(session);
    if (star === undefined) return;
    const mid = normalizeMid(session.machineId);
    const slice = star.roster
      .filter((e) => e.machine === mid)
      .map((e): SessionMemberDecl => ({
        sessionId: e.sessionId,
        ...(e.name === undefined ? {} : { name: e.name }),
        ...(e.tool === undefined ? {} : { tool: e.tool }),
        ...(e.extendsName === undefined ? {} : { extends: e.extendsMachine === undefined ? e.extendsName : { machine: e.extendsMachine, name: e.extendsName } }),
        ...(e.temporary === true ? { temporary: true } : {}),
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
    const star = this.starOf(session);
    if (star === undefined) return;
    const target = frame.target;
    // 匹配泳道（先specific后模糊）：精确会话 id（--rm erase 上报全量 id）→
    // id 前缀（≥8 位 hex 形态，命令面 id8）→ 名字精确。首泳道命中即定。
    const lower = target.toLowerCase();
    const exact = star.roster.filter((e) => e.sessionId === target);
    const hits =
      exact.length > 0
        ? exact
        : target.length >= 8 && /^[0-9a-fA-F-]+$/.test(target)
          ? star.roster.filter((e) => e.sessionId.toLowerCase().startsWith(lower))
          : star.roster.filter((e) => e.name === target);
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
      star.roster.splice(star.roster.indexOf(entry), 1);
      removed.push(entry.name ?? entry.sessionId.slice(0, 8));
      // 归属机聚合器在线则转发清本地表（否则其重播会把条目带回册——幂等无害但噪音）
      const owner = star.online.get(entry.machine);
      if (owner !== undefined && owner !== session) this.send(owner.ws, { op: 'member-remove', target: entry.sessionId });
    }
    if (removed.length > 0) this.persistRoster(star);
    reply(true, removed, removed.length === 0 ? `成员 ${target} 本不在册（幂等成功）` : undefined);
    this.log(`member-remove ${target}：删 ${removed.length} 条`);
  }

  private onMemberRemoveExact(session: Session, frame: MemberRemoveExactFrame): void {
    const star = this.starOf(session);
    if (star === undefined) return;
    const matches = star.roster.filter((entry) => entry.sessionId === frame.sessionId);
    const entry = matches.length === 1 ? matches[0] : undefined;
    const machine = normalizeMid(frame.machine);
    if (entry === undefined || !/^[0-9a-fA-F-]+$/.test(frame.machine) || machine.length !== 32 || entry.machine !== machine || entry.tool !== frame.tool) {
      this.send(session.ws, { op: 'member-remove-exact-result', id: frame.id, ok: false, removed: false,
        code: 'TARGET_CHANGED', error: '册位的完整会话、机器或工具身份已改变，请刷新后重新确认' });
      return;
    }
    star.roster.splice(star.roster.indexOf(entry), 1);
    const owner = star.online.get(entry.machine);
    if (owner !== undefined && owner !== session) this.send(owner.ws, { op: 'member-remove', target: entry.sessionId });
    this.persistRoster(star);
    this.send(session.ws, { op: 'member-remove-exact-result', id: frame.id, ok: true, removed: true });
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
    // 032 非兼容升级（用户拍板拒绝历史包袱）：连接方必须声明 multi-star 能力
    // （node/sender 同规，新版两腿都发）——旧版 crosschat 不发 caps，一律拒并
    // 教升级。无过渡期，两端同版是硬要求。
    if (!hasCap(frame.caps, CAP_MULTI_STAR)) {
      this.send(session.ws, {
        op: 'error',
        code: ERR.BAD_PROTO,
        message: '对端 crosschat 版本过旧（未声明 multi-star 能力）——本 broker 已升级多星单文件格式，两端都须同版：npm i -g @oatelauser/crosschat@latest，然后 broker 机 serve --stop && serve、节点机守护自动重连',
      });
      this.log('bad-proto 拒绝旧版连接（无 multi-star 能力声明）');
      session.ws.close(4000, 'legacy client');
      return;
    }
    // 注册表每笔连接现读（文件小，不缓存）：gen/remove 即时生效。022：钥匙
    // 反查星籍——遍历托管星域的节点表，命中即连接绑星（同 broker 机多星同端口）。
    if (frame.admin === true) {
      await this.onAdminConnect(session, frame);
      return;
    }
    if (typeof frame.auth !== 'string' || frame.auth === '') {
      await this.authFail(session, 'connect 缺钥匙（auth）——管理连接改带 admin:true 走挑战应答');
      return;
    }
    const auth = frame.auth; // 闭包内不可依赖属性收窄——先落局部量
    let entry: NodeEntry | undefined;
    let star: StarState | undefined;
    for (const candidate of this.stars) {
      const nodes = this.starNodes(candidate);
      const hit = nodes.find((node) => node.key !== undefined && safeEqual(auth, node.key));
      if (hit !== undefined) {
        entry = hit;
        star = candidate;
        break;
      }
    }
    if (entry === undefined || star === undefined) {
      // 033 教学语核对（决策6）：零星/删星后死星钥连入在此直指"星可能未创建或
      // 已删除，找管理员"——发送方（--via tcp: 三段投递）同文直报，不走防重发绕弯。
      await this.authFail(session, '钥匙不匹配任何星——星可能未创建或已删除（--remove-star 即废钥），找管理员核对 node.json 或索取新配置');
      return;
    }
    // 036：钥匙必绑星——命中星缺 starId（手编异常形状）即拒（starOf 兜底已删，
    // 未绑星连接无处归属）；serve 启动会自动补 id，教学指路。
    if (star.starId === undefined) {
      await this.authFail(session, '命中星的 starId 缺失（手编异常形状）——broker 机跑一次 crosschat serve 自动补 id 后重连');
      return;
    }
    session.starId = star.starId;
    // 已核验的凭证先登记归属；顶换旧 socket 的同步回调可能在握手收尾前撤钥。
    session.credential = { kind: 'node', key: auth };
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
        // B2.1：注册时 mid 前 8 位碰撞检测——前缀寻址在此长度歧义，记日志警告
        const clash = this.starNodes(star).find(
          (n) => n.key !== entry!.key && n.machineId !== undefined && normalizeMid(n.machineId).slice(0, 8) === midNorm.slice(0, 8),
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
      // 032：machineId 绑定/名字回写走 mutateBrokerFile 拼段（保住文件里在跑
      // gen-key/add-star 写进的新段落）。
      const selfName = sanitizeName(frame.name);
      const bound = entry.machineId === undefined || entry.machineId === '';
      const authKey = frame.auth;
      const starId = star.starId;
      const starIndex = this.stars.indexOf(star);
      mutateBrokerFile(this.d.registryFile, (doc) => {
        const target = doc.stars.find((s) => starId !== undefined && s.starId === starId) ?? doc.stars[starIndex];
        const e = target?.nodes.find((n) => n.key === authKey);
        if (e !== undefined) {
          if (bound) e.machineId = mid;
          if (selfName !== undefined) e.machineName = selfName;
        }
      });
      session.machineId = mid;
      session.machineName = selfName ?? entry.machineName;
      // F0：online 键取归一 mid——两形态互指的同机仍是同一台（顶换语义不变；星域内）
      const old = star.online.get(midNorm);
      if (old !== undefined && old !== session) {
        this.log(`replace ${session.machineName}(${mid.slice(0, 8)}) 顶掉旧连接`);
        try {
          old.ws.close(1000, 'replaced by new connection');
        } catch {
          // 竞态关闭忽略
        }
      }
      if (session.revoked || this.stopped || !this.sessions.has(session) || session.ws.readyState !== WebSocket.OPEN || this.starOf(session) !== star) return;
      if (!this.starNodes(star).some((node) => node.key !== undefined && safeEqual(node.key, auth))) {
        await this.authFail(session, '握手期间节点钥匙已失效，请核对配置后重新连接');
        return;
      }
      star.online.set(midNorm, session);
      this.log(`node-up ${session.machineName}(${mid.slice(0, 8)})`);
    }
    // B2：sender 角色也带出注册表里的 machineName（send 路由的 fromMachine 展示）
    if (frame.role !== 'node' && entry.machineName !== undefined) {
      session.machineName = entry.machineName;
    }
    if (session.revoked || this.stopped || !this.sessions.has(session) || session.ws.readyState !== WebSocket.OPEN) return;
    if (session.connectTimer !== undefined) clearTimeout(session.connectTimer);
    session.authed = true;
    session.identity = 'member';
    // 022/036：星标识在钥匙核验后回填（握手时序恒倒置——info 无法预知属星，
    // 单星也回填）
    this.send(session.ws, {
      op: 'connected',
      machineName: session.machineName,
      ...(star.starId === undefined ? {} : { starId: star.starId }),
      ...(star.name === undefined ? {} : { name: star.name }),
    });
    this.writeStatus('running');
  }

  /**
   * 034 管理连接（connect.admin=true）：不发挑战前先守一条硬边界——auth 在场
   * 即拒（钥匙永不过线，绝不收"顺手套钥"形态）。随后发一次性 nonce，等证明。
   */
  private async onAdminConnect(session: Session, frame: ConnectFrame): Promise<void> {
    if (typeof frame.auth === 'string' && frame.auth !== '') {
      await this.authFail(session, '管理连接不得携带钥匙（挑战应答——adminKey 永不过线），去掉 auth 字段重连');
      return;
    }
    const nonce = randomBytes(32).toString('hex');
    session.challenge = { nonce };
    this.send(session.ws, { op: 'auth-challenge', nonce });
  }

  /**
   * 034 挑战证明核验：proof = HMAC-SHA256(adminKey, nonce) hex，全星域管理钥
   * 逐条验（台账每笔现读——被吊钥此处即刻失效）。nonce 即消费（一次性），
   * 命中即定星籍（发放即绑定一星）与 label（审计来源）；未命中恒定延迟拒。
   */
  private async onAuthProof(session: Session, frame: AuthProofFrame): Promise<void> {
    const nonce = session.challenge?.nonce;
    session.challenge = undefined;
    if (nonce === undefined || typeof frame.proof !== 'string' || frame.proof === '') {
      await this.authFail(session, '挑战应答形状错误（无在途挑战或 proof 缺失）');
      return;
    }
    for (const star of this.stars) {
      if (star.starId === undefined) continue; // 036：无 id 星不可绑籍（同星钥路径）
      for (const node of this.starNodes(star)) {
        if (node.adminKey === undefined) continue;
        const expect = createHmac('sha256', node.adminKey).update(nonce).digest('hex');
        if (!safeEqual(frame.proof, expect)) continue;
        session.identity = 'admin';
        session.credential = { kind: 'admin', key: node.adminKey };
        session.adminLabel = node.label;
        session.starId = star.starId;
        if (session.connectTimer !== undefined) clearTimeout(session.connectTimer);
        session.authed = true;
        this.send(session.ws, {
          op: 'connected',
          ...(star.starId === undefined ? {} : { starId: star.starId }),
          ...(star.name === undefined ? {} : { name: star.name }),
        });
        this.log(`admin-auth 星管理钥(${node.label}) 入星 ${star.name ?? star.starId ?? '?'}`);
        this.writeStatus('running');
        return;
      }
    }
    await this.authFail(session, '星管理钥证明不匹配（钥匙已吊销或不属于本 broker 的星）——找 broker 主核对：crosschat serve --list 可查管理钥 label');
  }

  /**
   * 034 审计：管理 op 逐笔记 broker.log——来源=本机插座 | 星管理钥(label)。
   * 钥匙本体永不进日志（只记 label）。
   */
  private auditAdmin(action: string, subject: string, source: string): void {
    this.log(`audit admin-op ${action} ${subject} 来源=${source}`);
  }

  /** 034 WS 管理 op（admin-op 帧）：矩阵闸 → 星域执行 → 审计。 */
  private onAdminOpFrame(session: Session, frame: AdminOpFrame): void {
    const identity = session.identity ?? 'member';
    const allowed = ADMIN_OP_MATRIX[frame.action];
    if (allowed === undefined || !allowed.includes(identity)) {
      const message =
        allowed === undefined || allowed.length === 0
          ? `管理 op ${frame.action} 仅 broker 主本机可用（本机插座/CLI）——世上不存在全能远程钥匙；本星只读清单走 list-nodes/list-members`
          : `管理 op ${frame.action} 需星管理员（星管理钥）——当前连接是普通成员（星钥）；找 broker 主发星管理钥：crosschat serve --star <星> --gen-admin-key <label>`;
      this.send(session.ws, { op: 'error', code: ERR.ADMIN_REQUIRED, message, id: frame.id });
      this.log(`admin-required ${frame.action}（${identity} 身份请求被拒）`);
      return;
    }
    const star = this.starOf(session);
    if (star === undefined) {
      this.send(session.ws, { op: 'error', code: 'INTERNAL', message: '连接属星未定（异常形态）', id: frame.id });
      return;
    }
    const starLabel = star.name ?? star.starId ?? '?';
    const audit = (action: string): void => this.auditAdmin(action, `星 ${starLabel}`, `星管理钥(${session.adminLabel ?? '?'})`);
    switch (frame.action) {
      case 'list-nodes': {
        // 回显永不含钥匙：label/显示名/mid8/addedAt；管理钥条目带 admin 标记
        const nodes = this.starNodes(star).map((n) => ({
          label: n.label,
          ...(n.machineName === undefined ? {} : { name: n.machineName }),
          ...(n.machineId === undefined ? {} : { mid8: n.machineId.slice(0, 8) }),
          addedAt: n.addedAt,
          ...(n.adminKey === undefined ? {} : { admin: true }),
        }));
        const reply: AdminOpResultFrame = { op: 'admin-op-result', id: frame.id, ok: true, nodes };
        this.send(session.ws, reply);
        audit('list-nodes');
        return;
      }
      case 'list-members': {
        const members = star.roster.map((e) => ({
          sessionId: e.sessionId,
          ...(e.name === undefined ? {} : { name: e.name }),
          ...(e.tool === undefined ? {} : { tool: e.tool }),
          machine: e.machine,
          ...(e.machineName === undefined ? {} : { machineName: e.machineName }),
          ...(e.online === true ? { online: true } : {}),
        }));
        const reply: AdminOpResultFrame = { op: 'admin-op-result', id: frame.id, ok: true, members };
        this.send(session.ws, reply);
        audit('list-members');
        return;
      }
      case 'gen-key': {
        const n = frame.n;
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 10) {
          this.send(session.ws, { op: 'error', code: ERR.BAD_PROTO, message: 'gen-key 数量须为 1-10 的整数', id: frame.id });
          return;
        }
        if (star.starId === undefined || typeof frame.host !== 'string' || frame.host === '') {
          this.send(session.ws, { op: 'error', code: ERR.BAD_PROTO, message: 'gen-key 缺 starId/host（异常形状）', id: frame.id });
          return;
        }
        const starName = star.name;
        try {
          const results = genKeysFor(this.d.registryFile, star.starId, n, {
            host: frame.host,
            port: this.port ?? DEFAULT_PORT,
            ...(starName === undefined ? {} : { name: starName }),
          });
          const reply: AdminOpResultFrame = { op: 'admin-op-result', id: frame.id, ok: true, results };
          this.send(session.ws, reply);
          audit('gen-key');
        } catch (err) {
          this.send(session.ws, { op: 'error', code: 'USAGE', message: err instanceof Error ? err.message : String(err), id: frame.id });
        }
        return;
      }
      case 'remove-node': {
        if (star.starId === undefined || typeof frame.label !== 'string' || frame.label === '') {
          this.send(session.ws, { op: 'error', code: ERR.BAD_PROTO, message: 'remove-node 缺 starId/label', id: frame.id });
          return;
        }
        // 管理钥条目不走本 op（管理员互吊是越权面）——吊钥仅 broker 主本机
        const target = this.starNodes(star).find((n) => n.label === frame.label);
        if (target?.adminKey !== undefined) {
          this.send(session.ws, {
            op: 'error',
            code: ERR.ADMIN_REQUIRED,
            message: `label ${frame.label} 是星管理钥条目——吊管理钥仅 broker 主本机：crosschat serve --star ${starLabel} --remove-admin-key ${frame.label}`,
            id: frame.id,
          });
          this.log(`admin-required remove-node(${frame.label})（管理钥条目，星管理员不可吊同侪）`);
          return;
        }
        const removed = this.removeNodeCredential(star.starId, frame.label);
        const reply: AdminOpResultFrame = { op: 'admin-op-result', id: frame.id, ok: true, removed };
        this.send(session.ws, reply);
        audit('remove-node');
        return;
      }
      default:
        this.send(session.ws, { op: 'error', code: ERR.ADMIN_REQUIRED, message: `管理 op ${frame.action} 仅 broker 主本机可用`, id: frame.id });
    }
  }

  /** 鉴权失败统一路径：恒定延迟再回 BAD_AUTH，挫钥匙枚举计时。 */
  private async authFail(session: Session, message: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.d.authFailDelayMs));
    if (session.revoked || !this.sessions.has(session)) return;
    this.send(session.ws, { op: 'error', code: ERR.BAD_AUTH, message });
    this.log(`bad-auth 拒绝连接（${message}）`);
    session.ws.close(4001, 'bad auth');
  }

  private discoverySenderActive(entry: PendingDiscovery): boolean {
    return !entry.sender.revoked && this.sessions.has(entry.sender) && entry.sender.ws.readyState === WebSocket.OPEN
      && entry.sender.starId === entry.starId && this.starOf(entry.sender) !== undefined;
  }

  private discoveryError(entry: PendingDiscovery, code: string, message: string): void {
    if (this.discoverySenderActive(entry)) this.send(entry.sender.ws, { op: 'error', id: entry.requestId, code, message });
  }

  /** 先删归属和 timer 再发取消，abort/虚拟 socket 的同步回调也不能完成旧请求。 */
  private disposeDiscovery(routeId: string, cancel: boolean): PendingDiscovery | undefined {
    const entry = this.discoveries.get(routeId);
    if (entry === undefined) return;
    this.discoveries.delete(routeId);
    clearTimeout(entry.timer);
    if (cancel) {
      entry.controller?.abort();
      if (entry.target !== undefined) this.send(entry.target.ws, { op: 'discover-cancel', id: routeId });
    }
    return entry;
  }

  private cancelDiscoveriesFor(session: Session, error: { code: string; message: string }): void {
    for (const [routeId, entry] of this.discoveries) {
      if (entry.sender !== session && entry.target !== session) continue;
      this.disposeDiscovery(routeId, true);
      if (entry.sender !== session) this.discoveryError(entry, error.code, error.message);
    }
  }

  private routeDiscovery(sender: Session, frame: DiscoverQueryFrame): void {
    const fail = (code: string, message: string): void => this.send(sender.ws, { op: 'error', id: frame.id, code, message });
    if (this.stopped) return fail(ERR.PEER_OFFLINE, 'broker 正在关闭，不再开始会话发现');
    let request: DiscoveryRequest;
    try {
      if (Buffer.byteLength(encodeFrame(frame)) > MAX_PAYLOAD_BYTES) throw new Error('oversized');
      request = parseDiscoveryRequest(frame.request);
    } catch {
      return fail(ERR.BAD_PROTO, '会话发现请求形状错误或超过帧大小上限');
    }
    const owned = [...this.discoveries.values()].filter((entry) => entry.sender === sender);
    if (owned.some((entry) => entry.requestId === frame.id)) return fail(ERR.BAD_PROTO, '会话发现请求 id 已在该连接使用，请等待或取消原请求');
    if (owned.length >= 8) return fail(ERR.BAD_PROTO, '每个连接最多同时执行 8 个会话发现请求');
    const star = this.starOf(sender);
    if (star?.starId === undefined) return fail('INTERNAL', '连接属星未定');
    const resolved = this.resolveTarget(frame.targetMachine, star);
    if (resolved.kind === 'error') return fail(resolved.code, resolved.message);
    if (resolved.kind === 'session') return fail(ERR.BAD_PROTO, '会话发现必须指定机器');
    if (resolved.kind === 'local' && this.d.discover === undefined) return fail(ERR.NOT_READY, '本机只读会话发现入口未接线');
    const target = resolved.kind === 'node' ? [...this.sessions].find((session) => session.ws === resolved.ws) : undefined;
    if (resolved.kind === 'node' && (target === undefined || target.revoked || target.starId !== star.starId)) return fail(ERR.PEER_OFFLINE, '目标节点连接已失效');
    const routeId = randomBytes(24).toString('hex');
    const timer = setTimeout(() => {
      const expired = this.disposeDiscovery(routeId, true);
      if (expired !== undefined) this.discoveryError(expired, ERR.PEER_OFFLINE, '会话发现超时，读取已取消');
    }, this.d.resultTimeoutMs);
    const entry: PendingDiscovery = {
      sender, requestId: frame.id, starId: star.starId, request, timer,
      ...(target === undefined ? { controller: new AbortController() } : { target }),
    };
    this.discoveries.set(routeId, entry);
    if (target !== undefined) {
      this.send(target.ws, { op: 'discover-query', id: routeId, targetMachine: frame.targetMachine, request });
    } else {
      void this.executeLocalDiscovery(routeId, entry);
    }
  }

  private async executeLocalDiscovery(routeId: string, entry: PendingDiscovery): Promise<void> {
    let result: DiscoveryResponse;
    try {
      result = await this.d.discover!(entry.request, { contextId: 'local', signal: entry.controller?.signal });
    } catch {
      if (this.discoveries.get(routeId) !== entry) return;
      this.disposeDiscovery(routeId, false);
      if (this.discoverySenderActive(entry)) this.send(entry.sender.ws, { op: 'discover-result', id: entry.requestId, ok: false, error: '本机会话发现失败，请检查节点服务后重试' });
      return;
    }
    if (this.discoveries.get(routeId) === entry) this.completeDiscovery(routeId, entry, result);
  }

  private onDiscoveryResult(target: Session, frame: DiscoverResultFrame): void {
    const entry = this.discoveries.get(frame.id);
    if (entry?.target !== target || target.revoked || !this.sessions.has(target) || target.starId !== entry.starId) return;
    const star = this.starOf(target);
    if (star === undefined || target.machineId === undefined || star.online.get(normalizeMid(target.machineId)) !== target) return;
    if (!frame.ok) {
      this.disposeDiscovery(frame.id, false);
      if (this.discoverySenderActive(entry)) this.send(entry.sender.ws, { op: 'discover-result', id: entry.requestId, ok: false, error: '目标节点会话发现失败，请检查节点服务后重试' });
      return;
    }
    this.completeDiscovery(frame.id, entry, frame.result);
  }

  private completeDiscovery(routeId: string, entry: PendingDiscovery, input: unknown): void {
    this.disposeDiscovery(routeId, false);
    if (!this.discoverySenderActive(entry)) return;
    try {
      const result = parseDiscoveryResponse(input);
      if (result.op !== entry.request.op) throw new Error('wrong operation');
      if (result.op === 'detail' && entry.request.op === 'detail' && result.detail.item !== null) {
        const ref = result.detail.item.ref;
        if (ref.providerId !== entry.request.providerId || ref.nativeId !== entry.request.nativeId
          || (ref.referenceKind ?? 'native') !== (entry.request.referenceKind ?? 'native')) throw new Error('wrong session');
      }
      const frame: DiscoverResultFrame = { op: 'discover-result', id: entry.requestId, ok: true, result };
      if (Buffer.byteLength(encodeFrame(frame)) > MAX_PAYLOAD_BYTES) throw new Error('oversized');
      this.send(entry.sender.ws, frame);
    } catch {
      this.discoveryError(entry, ERR.BAD_PROTO, '目标返回的会话发现数据形状错误或超过帧大小上限');
    }
  }

  private async routeSend(sender: Session, frame: SendFrame): Promise<void> {
    const target = frame.targetMachine;
    const from = sender.machineName ?? frame.origin ?? 'unknown';
    const star = this.starOf(sender);
    if (star === undefined) {
      this.send(sender.ws, { op: 'error', code: 'INTERNAL', message: '连接属星未定（异常形态）', id: frame.id });
      return;
    }
    const fail = (code: string, message: string) => {
      if (sender.revoked) return;
      this.send(sender.ws, { op: 'error', code, message, id: frame.id });
      this.log(`route ${from}→${target} ${code}`);
    };
    // 018：含冒号的目标先整段按机器名解析（零回归锚点：冒号机器名照旧机器级），
    // 失败再拆最后一段作会话名（机器段可含冒号，会话名聚合器侧已禁冒号）。
    const resolved = target.includes(':') ? this.resolveTargetWithSession(target, star) : this.resolveTarget(target, star);
    if (resolved.kind === 'error') return fail(resolved.code, resolved.message);
    if (resolved.kind === 'local') {
      // 目标是 broker 本机：本机投递处理器（B2 起 serve 接线真实现）。
      // F1：本机投递同带发送方 roster 真名——远端来件在 broker 机上的信封
      // 也要有真 from-machine（消灭旧 'local' 占位）。022：星段随发送方连接
      // 的属星（多星下回执 ref/from-star 按星）。
      let outcome: ResultFrame | ErrorFrame;
      try {
        outcome = await this.d.deliverLocal(frame, sender.machineName, { starId: star.starId, ...(star.name === undefined ? {} : { name: star.name }) });
      } catch (err) {
        outcome = { op: 'error', code: ERR.NOT_READY, message: err instanceof Error ? err.message : String(err) };
      }
      if (sender.revoked) return;
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
    // 虚拟连接同步回调，先登记等待者，结果/撤权才不会在转发期间丢失。
    const waiting = new Promise<RouteOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(frame.id);
        resolve({ kind: 'error', code: ERR.PEER_OFFLINE, message: `节点 ${target} 未在 ${this.d.resultTimeoutMs}ms 内回应 result` });
      }, this.d.resultTimeoutMs);
      this.pending.set(frame.id, { senderWs: sender.ws, targetWs: targetSession, timer, resolve });
    });
    // 转发 deliver（B2：to/conversation/origin 随帧透传），等对应 id 的 result 再映射 receipt 回发送方。
    // F1：fromMachine 只写真 roster 名（无名瞬态发送方缺省——投递侧省略信封属性，不填 origin 编码/unknown 占位）。
    // 018：会话轨命中时附带 sessionId——聚合器本地按它注入投递（id 定位，不经名字解析）。
    this.send(targetSession, {
      op: 'deliver',
      id: frame.id,
      ...(sender.machineName === undefined ? {} : { fromMachine: sender.machineName }),
      payload: frame.body,
      ...(frame.delivery === undefined ? {} : { delivery: frame.delivery }),
      to: frame.to,
      conversation: frame.conversation,
      origin: frame.origin,
      ...(resolved.kind === 'session' ? { sessionId: resolved.sessionId } : {}),
    });
    const outcome = await waiting;
    if (sender.revoked) return;
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
      if (sender.revoked) return;
      this.send(sender.ws, { op: 'error', code, message, id: frame.id });
      this.log(`status-route ${from}→${target} ${code}`);
    };
    const star = this.starOf(sender);
    if (star === undefined) {
      return fail('INTERNAL', '连接属星未定（异常形态）');
    }
    const resolved = this.resolveTarget(target, star);
    if (resolved.kind === 'error') return fail(resolved.code, resolved.message);
    if (resolved.kind === 'local') {
      if (this.d.scanStatus === undefined) {
        return fail(ERR.NOT_READY, '本机会话扫描器未接线（升级 broker 机 crosschat）');
      }
      const payload = await this.d.scanStatus();
      if (sender.revoked) return;
      this.send(sender.ws, { op: 'status-result', id: frame.id, ok: true, payload });
      this.log(`status-route ${from}→${target}(local) ok`);
      return;
    }
    const waiting = new Promise<RouteOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(frame.id);
        resolve({ kind: 'error', code: ERR.PEER_OFFLINE, message: `节点 ${target} 未在 ${this.d.resultTimeoutMs}ms 内回应 status-result` });
      }, this.d.resultTimeoutMs);
      this.pending.set(frame.id, { senderWs: sender.ws, targetWs: resolved.ws, timer, resolve });
    });
    this.send(resolved.ws, frame);
    const outcome = await waiting;
    if (sender.revoked) return;
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
    const star = this.starOf(sender);
    if (star === undefined) return fail('INTERNAL', '连接属星未定（异常形态）');
    const resolved = this.resolveTarget(frame.targetMachine, star);
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
   * F0：mid8 与去重键取归一形态（带杠条目与纯 hex 条目同机合一）。
   * 028：册内下线成员随 offlineSessions 单列（sessions 保持活成员语义不动——
   * extends 校验共用）；不在注册表的机器的册条目不展示（机器已除网）。 */
  private buildRoster(star: StarState): RosterResultFrame {
    const nodes = this.starNodes(star);
    const ownNorm = normalizeMid(this.d.machineId() ?? '');
    const machines = new Map<string, RosterMachine>();
    for (const node of nodes) {
      const nm = normalizeMid(node.machineId ?? '');
      if (nm === '') continue;
      const conn = star.online.get(nm);
      const decls = conn?.members !== undefined && conn.members.size > 0 ? [...conn.members.values()] : undefined;
      machines.set(nm, {
        ...(node.machineName === undefined ? {} : { name: node.machineName }),
        mid8: nm.slice(0, 8),
        online: (ownNorm !== '' && nm === ownNorm) || conn !== undefined,
        ...(decls === undefined ? {} : { sessions: decls }),
      });
    }
    const offlineByMid = new Map<string, SessionMemberDecl[]>();
    for (const entry of star.roster) {
      if (entry.online || !machines.has(entry.machine)) continue;
      const decl: SessionMemberDecl = {
        sessionId: entry.sessionId,
        ...(entry.name === undefined ? {} : { name: entry.name }),
        ...(entry.tool === undefined ? {} : { tool: entry.tool }),
        ...(entry.extendsName === undefined
          ? {}
          : { extends: entry.extendsMachine === undefined ? entry.extendsName : { machine: entry.extendsMachine, name: entry.extendsName } }),
      };
      const list = offlineByMid.get(entry.machine);
      if (list === undefined) offlineByMid.set(entry.machine, [decl]);
      else list.push(decl);
    }
    for (const [mid, decls] of offlineByMid) machines.get(mid)!.offlineSessions = decls;
    return { op: 'roster-result', machines: [...machines.values()] };
  }

  /**
   * send/file 共用的目标解析（B2.1 双轨）：hex spec = machine-id 前缀（git
   * 短哈希式最短无歧义解析，寻址权威）；非 hex = name/label（人读显示用）。
   * local=broker 本机（按 machineId 判定，不再比对 hostname 字符串）。
   * F0：spec 与注册表条目 mid 均在读取侧归一后比对——带杠 UUID（Windows
   * MachineGuid）与纯 hex 两形态互投同轨；存储与帧携带值保持历史形态。
   */
  private resolveTarget(spec: string, star: StarState): ResolvedTarget {
    const nodes = this.starNodes(star);
    const ownNorm = normalizeMid(this.d.machineId() ?? '');
    const pick = (resolved: NodeEntry): ResolvedTarget => {
      const midNorm = normalizeMid(resolved.machineId ?? '');
      if (ownNorm !== '' && midNorm === ownNorm) return { kind: 'local' };
      const target = midNorm === '' ? undefined : star.online.get(midNorm);
      if (target === undefined) {
        return { kind: 'error', code: ERR.PEER_OFFLINE, message: `机器 ${spec} 已注册但当前不在线` };
      }
      return { kind: 'node', ws: target.ws };
    };
    // 轨一：hex spec（F0：含带杠 UUID 形态）= mid 前缀（最短无歧义；多命中教加长）
    const specNorm = normalizeMid(spec);
    if (specNorm !== '' && /^[0-9a-fA-F-]+$/.test(spec)) {
      const hits = nodes.filter((node) => {
        const nm = normalizeMid(node.machineId ?? '');
        return nm !== '' && nm.startsWith(specNorm); // 归一后为空的条目跳过（空串 startsWith 假命中守卫）
      });
      if (hits.length === 0) {
        return { kind: 'error', code: ERR.UNKNOWN_MACHINE, message: this.unknownMachine(spec, `注册表没有 machine-id 前缀 ${spec} 的机器（crosschat serve --list 可查 mid8）`, star) };
      }
      if (hits.length > 1) {
        const ids = hits.map((node) => node.machineId?.slice(0, 12)).join(', ');
        return { kind: 'error', code: ERR.MACHINE_NAME_COLLISION, message: `前缀 ${spec} 命中多台机器（machine-id：${ids}）——加长前缀后重试` };
      }
      return pick(hits[0]!);
    }
    // 轨二：name/label（人读；冲突列 mid 教消歧）
    const candidates = nodes.filter((node) => node.machineName === spec || node.label === spec);
    if (candidates.length === 0) {
      return { kind: 'error', code: ERR.UNKNOWN_MACHINE, message: this.unknownMachine(spec, `注册表没有机器名 ${spec}（crosschat serve --list 可查名字与 mid8）`, star) };
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
  private resolveTargetWithSession(spec: string, star: StarState): ResolvedTarget {
    const whole = this.resolveTarget(spec, star);
    if (whole.kind !== 'error') return whole;
    const idx = spec.lastIndexOf(':');
    if (idx <= 0 || idx === spec.length - 1) return whole; // 无会话段可拆——原错误照报
    const machineSpec = spec.slice(0, idx);
    const sessionName = spec.slice(idx + 1);
    const machine = this.resolveTarget(machineSpec, star);
    if (machine.kind === 'error') return machine;
    if (machine.kind === 'local') {
      // broker 本机的会话成员同样经由本机聚合器（成员表/活性在聚合器；deliverLocal
      // 无会话注入）——022 起聚合器由 broker 进程内挂（虚拟会话常驻），免手动
      // serve --connect；本机外部守护在跑时同样出现在 online 表（让位形态）。
      const ownNorm = normalizeMid(this.d.machineId() ?? '');
      const conn = ownNorm === '' ? undefined : star.online.get(ownNorm);
      if (conn === undefined) {
        return { kind: 'error', code: ERR.NOT_READY, message: 'broker 本机聚合器未挂——本机跑 crosschat serve（内挂）即可会话级投递' };
      }
      return this.resolveSessionMember(conn, sessionName, star);
    }
    const conn = this.sessionByWs(machine.ws);
    if (conn === undefined) return machine; // 防御：解析出的 ws 不在会话表——按机器级走
    return this.resolveSessionMember(conn, sessionName, star);
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
  private resolveSessionMember(target: Session, sessionName: string, star: StarState): ResolvedTarget {
    const members = [...target.members?.values() ?? []];
    const declaredTools = new Set(members.flatMap((m) => (m.tool === undefined ? [] : [m.tool])));
    const machine = target.machineName ?? target.machineId?.slice(0, 8) ?? '?';
    const hit = (m: SessionMemberDecl): ResolvedTarget => ({ kind: 'session', ws: target.ws, sessionId: m.sessionId });
    // 1) 全串裸名精确（名字或全量会话 id——今日全量 id 寻址零回归）
    const exact = members.filter((m) => m.name === sessionName || m.sessionId === sessionName);
    if (exact.length === 1) return hit(exact[0]!);
    if (exact.length > 1) return this.sessionCollision(sessionName, exact, machine, star);
    // 2) 限定词拆解（仅当命中该机已声明 tool 集；否则整体视为会话名，落到 3/4）
    const slash = sessionName.indexOf('/');
    if (slash > 0 && slash < sessionName.length - 1) {
      const tool = sessionName.slice(0, slash).toLowerCase();
      const rest = sessionName.slice(slash + 1);
      if (declaredTools.has(tool)) {
        const qualified = members.filter((m) => m.tool === tool && (m.name === rest || m.sessionId === rest));
        if (qualified.length === 1) return hit(qualified[0]!);
        if (qualified.length > 1) return this.sessionCollision(rest, qualified, machine, star);
        const sup = this.extendsHit(tool, rest, star);
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
    const sup = this.extendsHit(undefined, sessionName, star);
    if (sup !== undefined) return sup;
    // 5) 028 下线成员（该机在册、当前未在线）——报错等上线，绝不静默改投
    const down = star.roster.find(
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
    star: StarState,
  ): ResolvedTarget {
    const starName = star.name ?? '<星>';
    const anyToolless = hits.some((h) => h.tool === undefined);
    const distinctTools = new Set(hits.flatMap((h) => (h.tool === undefined ? [] : [h.tool])));
    const qualifiedUnique = !anyToolless && distinctTools.size >= 2;
    const lines = hits
      .map((h) =>
        qualifiedUnique
          ? `  tcp:${starName}:${machine}:${h.tool}/${name}`
          : `  ${h.tool === undefined ? '' : `${h.tool}/`}${name}(${h.sessionId.slice(0, 8)})`,
      )
      .join('\n');
    const teach = qualifiedUnique
      ? '改投限定地址即可'
      : `限定地址相同（${anyToolless ? '对端聚合器未声明 tool' : '同工具同名'}）——改投 id 前缀：tcp:${starName}:${machine}:<id 前 8 位>（括号内照抄）`;
    const note = anyToolless ? '；部分成员未声明 tool——对端聚合器版本旧，升级后可用 工具/名 限定词消歧' : '';
    return {
      kind: 'error',
      code: ERR.NAME_COLLISION,
      message: `会话名 ${name} 在 ${machine} 上有多个同名成员：\n${lines}\n${teach}${note}`,
    };
  }

  /** extends 旧名命中（028 起查落盘 roster——接任随册持久；1 血统→SUPERSEDED 指路；多血统→碰撞列接任者地址）。 */
  private extendsHit(tool: string | undefined, oldName: string, star: StarState): ResolvedTarget | undefined {
    const entries = star.roster.filter((e) => e.extendsName === oldName);
    const hits = tool === undefined ? entries : entries.filter((e) => (e.tool ?? undefined) === tool);
    if (hits.length === 0) return undefined;
    if (hits.length === 1) return this.superseded(oldName, hits[0]!, star);
    const starName = star.name ?? '<星>';
    const lines = hits
      .map((e) => {
        const m = e.machineName ?? e.machine.slice(0, 8);
        const n = e.name ?? e.sessionId.slice(0, 8);
        return `  tcp:${starName}:${m}:${e.tool === undefined ? '' : `${e.tool}/`}${n}`;
      })
      .join('\n');
    return {
      kind: 'error',
      code: ERR.NAME_COLLISION,
      message: `旧会话名 ${oldName} 有多条接续血统：\n${lines}\n改投接任者地址即可`,
    };
  }

  /** SESSION_SUPERSEDED 指路（020：接任者带工具限定词；无 tool 同旧形态）。 */
  private superseded(oldName: string, entry: RosterEntry, star: StarState): ResolvedTarget {
    const succMachine = entry.machineName ?? entry.machine.slice(0, 8);
    const succName = entry.name ?? entry.sessionId.slice(0, 8);
    const succTool = entry.tool === undefined ? '' : `${entry.tool}/`;
    return {
      kind: 'error',
      code: ERR.SESSION_SUPERSEDED,
      message: `会话 ${oldName} 已由 ${succMachine}:${succTool}${succName} 接续——改投接任者 tcp:${star.name ?? '<星>'}:${succMachine}:${succTool}${succName}`,
    };
  }

  private sessionByWs(ws: SocketLike): Session | undefined {
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
  private unknownMachine(spec: string, reason: string, star?: StarState): string {
    const nodes = star === undefined ? (loadBrokerFile(this.d.registryFile).stars[0]?.nodes ?? []) : this.starNodes(star);
    const specNorm = normalizeMid(spec);
    const lines: string[] = [];
    let suggest = '';
    for (const node of nodes) {
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
        session.ws.terminate?.();
      }
    }
    this.writeStatus('running'); // lastUpdated 每心跳周期刷新
  }

  private writeStatus(state: 'running' | 'stopped'): void {
    try {
      mkdirSync(dirname(this.d.statusFile), { recursive: true });
      // 017：broker 自身恒在线——本机 status 的"在线机器"含本机（带（本机）标），
      // 改 showName 重启 serve 后本机 status 即见新名。与 buildRoster ownNorm 同判：
      // 注册表有本机条目才算（名字取注册表），未注册不虚列。022/036：按星分组
      // 单一格式——一行一星（星名: 机器表），单星扁平旧形随葬。
      const ownNorm = normalizeMid(this.d.machineId() ?? '');
      const sole = this.stars.length === 1 ? this.stars[0]! : undefined;
      const onlineNodes: string[] = [];
      for (const star of this.stars) {
        const names = [...star.online.values()].map((session) => session.machineName ?? session.machineId?.slice(0, 8) ?? '?');
        if (ownNorm !== '') {
          const selfEntry = this.starNodes(star).find((n) => normalizeMid(n.machineId ?? '') === ownNorm);
          if (selfEntry !== undefined) names.unshift(`${selfEntry.machineName ?? ownNorm.slice(0, 8)}（本机）`);
        }
        onlineNodes.push(`${star.name ?? star.starId ?? '?'}: ${names.length > 0 ? names.join('、') : '（无在线）'}`);
      }
      writeFileSync(
        this.d.statusFile,
        `${JSON.stringify(
          {
            state,
            port: this.port,
            version: this.d.version, // F1：doctor 版本对账（常驻版本 vs 本机 CLI）
            pid: process.pid, // 026：doctor 验活用
            // 033：管理插座地址（CLI 热路径据此连入；stopped 态保留无妨——CLI 先验 state+pid）
            ...(this.adminPipe === undefined ? {} : { adminPipe: this.adminPipe }),
            ...(sole === undefined || sole.name === undefined ? {} : { name: sole.name }),
            // 022：托管星域清单（单星也写——013 延伸防护按它识别"本机 broker 已
            // 内挂该星聚合器"，免手动 serve --connect 双开）
            stars: this.stars.map((s) => ({ ...(s.name === undefined ? {} : { name: s.name }), starId: s.starId ?? '' })),
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

  private send(ws: SocketLike, frame: Frame): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(encodeFrame(frame));
  }

  private log(event: string): void {
    this.d.log(`${new Date(this.d.now()).toISOString()} ${event}`);
  }
}
