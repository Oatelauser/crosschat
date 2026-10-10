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
  ERR,
  MAX_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
  encodeFrame,
  parseFrame,
} from './protocol.js';
import type { ConnectFrame, ErrorFrame, Frame, ResultFrame, SendFrame } from './protocol.js';
import { readRegistry, writeRegistry } from './registry.js';

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
  /** B2 接 runSend；B1 默认实现回 NOT_READY。 */
  deliverLocal: (frame: SendFrame) => Promise<ResultFrame | ErrorFrame>;
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
}

type RouteOutcome =
  | { kind: 'result'; frame: ResultFrame }
  | { kind: 'error'; code: string; message: string };

interface PendingResult {
  targetWs: WebSocket;
  timer: ReturnType<typeof setTimeout>;
  resolve: (outcome: RouteOutcome) => void;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // 长度不同先失败：timingSafeEqual 对不等长直接抛
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export class Broker {
  private readonly d: Required<Omit<BrokerDeps, 'port'>> & { port?: number };
  private wss?: WebSocketServer;
  private port?: number;
  private startedAt?: number;
  private stopped = false;
  private readonly sessions = new Set<Session>();
  private readonly online = new Map<string, Session>();
  private readonly pending = new Map<string, PendingResult>();
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
    this.send(ws, { op: 'info', proto: PROTOCOL_VERSION, server: `crosschat/${this.d.version}`, caps: [] });
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
    if (session.machineId !== undefined && this.online.get(session.machineId) === session) {
      this.online.delete(session.machineId);
      this.log(`node-down ${session.machineName ?? ''}(${session.machineId.slice(0, 8)})`);
      this.writeStatus('running');
    }
    for (const [id, entry] of this.pending) {
      if (entry.targetWs === session.ws) {
        clearTimeout(entry.timer);
        this.pending.delete(id);
        entry.resolve({ kind: 'error', code: ERR.PEER_OFFLINE, message: '节点连接断开' });
      }
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
        entry.resolve({ kind: 'result', frame });
      }
    }
    // 其余帧型（info/receipt/deliver/file-*）B1 服务端无行为
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
      if (entry.machineId === undefined || entry.machineId === '') {
        entry.machineId = mid;
      } else if (entry.machineId !== mid) {
        await this.authFail(session, 'machineId 与该钥匙登记的不一致');
        return;
      }
      if (entry.machineName === undefined || entry.machineName === '') {
        entry.machineName = this.d.hostname();
      }
      writeRegistry(this.d.registryFile, registry);
      session.machineId = mid;
      session.machineName = entry.machineName;
      const old = this.online.get(mid);
      if (old !== undefined && old !== session) {
        this.log(`replace ${entry.machineName}(${mid.slice(0, 8)}) 顶掉旧连接`);
        try {
          old.ws.close(1000, 'replaced by new connection');
        } catch {
          // 竞态关闭忽略
        }
      }
      this.online.set(mid, session);
      this.log(`node-up ${entry.machineName}(${mid.slice(0, 8)})`);
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
    const registry = readRegistry(this.d.registryFile);
    const candidates = registry.nodes.filter((node) => node.machineName === target);
    if (candidates.length === 0) {
      return fail(ERR.UNKNOWN_MACHINE, `注册表没有机器名 ${target}`);
    }
    const ownMid = this.d.machineId();
    if (candidates.length === 1 && ownMid !== undefined && candidates[0].machineId === ownMid) {
      // 目标是 broker 本机：本机投递处理器（B1 默认 NOT_READY）
      let outcome: ResultFrame | ErrorFrame;
      try {
        outcome = await this.d.deliverLocal(frame);
      } catch (err) {
        outcome = { op: 'error', code: ERR.NOT_READY, message: err instanceof Error ? err.message : String(err) };
      }
      if (outcome.op === 'error') return fail(outcome.code, outcome.message);
      this.send(sender.ws, {
        op: 'receipt',
        id: frame.id,
        status: outcome.status,
        turn: outcome.turn,
        replyRef: outcome.replyRef,
      });
      this.log(`route ${from}→${target}(local) ${outcome.status}`);
      return;
    }
    const onlineCandidates = candidates.filter((node) => node.machineId !== undefined && this.online.has(node.machineId));
    if (onlineCandidates.length > 1) {
      const ids = onlineCandidates.map((node) => node.machineId?.slice(0, 8)).join(', ');
      return fail(ERR.MACHINE_NAME_COLLISION, `多台机器同名 ${target} 且都在线（machine-id 短码：${ids}）——请消歧后重试`);
    }
    if (onlineCandidates.length === 0) {
      return fail(ERR.PEER_OFFLINE, `机器 ${target} 已注册但当前不在线`);
    }
    const node = onlineCandidates[0];
    const targetSession = this.online.get(node.machineId as string);
    if (targetSession === undefined) {
      return fail(ERR.PEER_OFFLINE, `机器 ${target} 已注册但当前不在线`);
    }
    // 转发 deliver，等对应 id 的 result 再映射 receipt 回发送方
    this.send(targetSession.ws, { op: 'deliver', id: frame.id, fromMachine: from, payload: frame.body });
    const outcome = await new Promise<RouteOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(frame.id);
        resolve({ kind: 'error', code: ERR.PEER_OFFLINE, message: `节点 ${target} 未在 ${this.d.resultTimeoutMs}ms 内回应 result` });
      }, this.d.resultTimeoutMs);
      this.pending.set(frame.id, { targetWs: targetSession.ws, timer, resolve });
    });
    if (outcome.kind === 'error') return fail(outcome.code, outcome.message);
    const result = outcome.frame;
    this.send(sender.ws, {
      op: 'receipt',
      id: frame.id,
      status: result.status,
      turn: result.turn,
      replyRef: result.replyRef,
    });
    this.log(`route ${from}→${target} ${result.status}`);
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
      writeFileSync(
        this.d.statusFile,
        `${JSON.stringify(
          {
            state,
            port: this.port,
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
