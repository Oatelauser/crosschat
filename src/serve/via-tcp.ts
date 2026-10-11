/**
 * `send --via tcp:<机器>` 发送腿（票B B2）：瞬态 ws 连 broker（role:'sender'），
 * send 帧 → 等 receipt/error/超时。输出语义与 ssh 形态逐字对齐（成功打印远端
 * output 同格式；错误同码重抛 + [via tcp:目标] 前缀）；发起侧记账与 ssh via
 * 分支同款。文件走 file-begin/chunk/end 分块流（256KiB/块，64MiB 上限）。
 */
import { randomUUID } from 'node:crypto';
import { hostname as osHostname } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { MultichatError } from '../errors.js';
import { encodeOrigin, originDisplayName } from '../federation.js';
import { identityKey, resolveCallerIdentity, type CallerIdentity } from '../identity.js';
import { recordConversation } from '../conversations.js';
import { decodeRef } from '../ref.js';
import type { SendLogEntry } from '../send-log.js';
import type { SendArgs, SendDeps } from '../commands/send.js';
import { encodeFrame, ERR, MAX_PAYLOAD_BYTES, parseFrame, PROTOCOL_VERSION } from './protocol.js';
import type { ErrorFrame, FileResultFrame, Frame, ReceiptFrame, RosterMachine } from './protocol.js';
import { defaultBaseDir, tcpDir } from './registry.js';
import { readNodeConfig } from './node.js';
import { FILE_CHUNK_BYTES, FILE_MAX_BYTES, readFileForSend } from './file-channel.js';

/** 发起侧记账：与 runViaSend（ssh 腿）同款字段——tcp/ssh 两形态共用此 helper。 */
export function makeViaLogger(deps: SendDeps, caller: CallerIdentity) {
  const fromName = originDisplayName(caller);
  return (fields: Omit<SendLogEntry, 'ts'>): void => {
    deps.appendLog?.({ from: identityKey(caller), fromName, ...fields, ts: new Date(deps.now()).toISOString() });
  };
}

/** CROSSCHAT_TCP_TIMEOUT_MS（默认 120s），容错风格同 CROSSCHAT_SSH_TIMEOUT_MS。 */
export function tcpTimeoutMs(env: Record<string, string | undefined>): number {
  const raw = Number(env.CROSSCHAT_TCP_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 120_000;
}

interface Waiter {
  pred: (f: Frame) => boolean;
  resolve: (f: Frame) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** 一条到 broker 的瞬态发送连接（sender 角色）。 */
class SenderConn {
  private readonly waiters: Waiter[] = [];
  /** 已收帧缓冲：open 与 waitFor 注册之间到达的帧先落此，注册时回查。 */
  private readonly frameLog: Frame[] = [];
  /** 已被某次 waitFor 消费掉的帧——同 id 两阶段（begin/end 应答）互不误认。 */
  private readonly consumed = new WeakSet<Frame>();
  private closed = false;

  private constructor(readonly ws: WebSocket) {
    ws.on('close', () => {
      for (const w of this.waiters.splice(0)) {
        clearTimeout(w.timer);
        w.reject(new Error('连接断开'));
      }
    });
    ws.on('message', (data) => {
      const frame = parseFrame(data.toString());
      if (frame === undefined) return;
      this.frameLog.push(frame);
      this.dispatch(frame);
    });
  }

  private dispatch(frame: Frame): void {
    if (this.consumed.has(frame)) return;
    for (let i = 0; i < this.waiters.length; i++) {
      const w = this.waiters[i]!;
      if (w.pred(frame)) {
        clearTimeout(w.timer);
        this.waiters.splice(i, 1);
        this.consumed.add(frame);
        w.resolve(frame);
        return;
      }
    }
  }

  static async open(url: string, auth: string, machineId: string | undefined, timeoutMs: number): Promise<SenderConn> {
    const ws = new WebSocket(url, { maxPayload: MAX_PAYLOAD_BYTES });
    const conn = new SenderConn(ws);
    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('connect timeout')), timeoutMs);
        ws.once('open', () => { clearTimeout(t); resolve(); });
        ws.once('error', (err) => { clearTimeout(t); reject(err); });
      });
      const info = await conn.waitFor((f) => f.op === 'info', timeoutMs);
      if (info.op !== 'info' || info.proto !== PROTOCOL_VERSION) {
        throw new Error(`broker 协议不匹配（期望 ${PROTOCOL_VERSION}）`);
      }
      conn.send({ op: 'connect', proto: PROTOCOL_VERSION, role: 'sender', machineId, auth });
      const verdict = await conn.waitFor((f) => f.op === 'connected' || f.op === 'error', timeoutMs);
      if (verdict.op === 'error') {
        throw new MultichatError('TCP_TRANSPORT_FAILED', `broker 拒绝连接：${(verdict as ErrorFrame).code} ${(verdict as ErrorFrame).message}——核对 ~/.crosschat/tcp/node.json 与 broker 注册表`);
      }
      return conn;
    } catch (err) {
      conn.close();
      throw err instanceof MultichatError
        ? err
        : new MultichatError('TCP_TRANSPORT_FAILED', `无法连上 broker（${url}）：${err instanceof Error ? err.message : String(err)}——核对 node.json 的 broker 地址与 crosschat serve 是否在跑`);
    }
  }

  send(frame: Frame): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(encodeFrame(frame), () => resolve());
      else resolve();
    });
  }

  /** 等一帧；连接先断或超时都按传输失败拒绝。 */
  waitFor(pred: (f: Frame) => boolean, timeoutMs: number): Promise<Frame> {
    const seen = this.frameLog.find((f) => !this.consumed.has(f) && pred(f));
    if (seen !== undefined) {
      this.consumed.add(seen);
      return Promise.resolve(seen);
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        pred,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.drop(waiter);
          reject(new Error(`等待 broker 应答超时（${Math.round(timeoutMs / 1000)}s）`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
      if (this.closed) {
        this.drop(waiter);
        reject(new Error('连接已断开'));
      }
    });
  }

  private drop(w: Waiter): void {
    const i = this.waiters.indexOf(w);
    if (i >= 0) this.waiters.splice(i, 1);
  }

  close(): void {
    this.closed = true;
    for (const w of this.waiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(new Error('连接断开'));
    }
    try {
      this.ws.close();
    } catch { /* 已断开 */ }
  }
}

/** via 分支入口（send.ts 在 ssh 分流前调用）。body 在 --file 无 --body 时可为 undefined。 */
export async function runViaTcpSend(args: SendArgs, body: string | undefined, deps: SendDeps): Promise<string> {
  const target = args.via!.slice(4);
  if (target === '') {
    throw new MultichatError('USAGE', '--via tcp:<机器名>：机器名不能为空（broker 机上 crosschat serve --list 可查）');
  }
  const config = readNodeConfig(join(tcpDir(deps.tcpBaseDir ?? defaultBaseDir()), 'node.json'));
  const timeoutMs = tcpTimeoutMs(deps.env);

  const scan = deps.listClaudeSessions();
  const caller = resolveCallerIdentity(deps.env, scan);
  // B2.1：origin host 槽盖 mid8 并带 tcp 标记——对端 ref 端点 m=mid8，机器改名免疫；
  // 无 machine-id 时退回 hostname（降级：回信按 ssh 语义拼接）。
  const localMid = deps.machineId?.();
  const origin = encodeOrigin(
    caller,
    localMid?.slice(0, 8) ?? deps.hostname?.() ?? osHostname(),
    localMid,
    localMid === undefined ? undefined : 'tcp',
  );
  const logNow = makeViaLogger(deps, caller);
  const logTo = `${args.to ?? args.conversation ?? ''}@${target}`;

  const transportFailure = (detail: string, hint = ''): MultichatError =>
    new MultichatError(
      'TCP_TRANSPORT_FAILED',
      `${detail}，远端状态不明——勿盲目重发（可能与首次投递叠加）。先在对端查 send-log 或 status --conversations 核实后再决定。${hint}`,
    );

  // B2.1：删同机 hostname 特例——本机目标照常上 broker，resolveTarget 按
  // machineId 判定本机后走 deliverLocal（同机判定不再比对 hostname 字符串）。

  const url = `ws://${config.broker.host}:${config.broker.port}`;
  const conn = await SenderConn.open(url, config.key, deps.machineId?.(), Math.min(timeoutMs, 15_000));
  try {
    let finalBody = body;
    if (args.fileArg !== undefined) {
      const path = await sendFile(conn, args.fileArg, target, timeoutMs, transportFailure);
      finalBody = body ?? `文件 ${fileNameOf(args.fileArg)} 已送达：${path}`;
    }
    if (finalBody === undefined || finalBody === '') {
      throw new MultichatError('BODY_REQUIRED', 'Message body is required: pass --body "<text>" or pipe the message on stdin.');
    }
    return await sendBody(conn, args, finalBody, origin, target, timeoutMs, deps, caller, logNow, logTo, transportFailure);
  } finally {
    conn.close();
  }
}

// 同机投递统一走 broker 的 deliverLocal（B2.1 判据=machineId，不再比对 hostname）。
function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? 'file';
}

interface TransportFail {
  (detail: string, hint?: string): MultichatError;
}

/** 文件分块流：begin（dedup/resumeFrom）→ chunks → end → 对端本地路径。 */
async function sendFile(
  conn: SenderConn,
  filePath: string,
  target: string,
  timeoutMs: number,
  transportFailure: TransportFail,
): Promise<string> {
  let file: ReturnType<typeof readFileForSend>;
  try {
    file = readFileForSend(filePath);
  } catch {
    throw new MultichatError('USAGE', `--file 读不到文件：${filePath}`);
  }
  if (file.size > FILE_MAX_BYTES) {
    throw new MultichatError(
      'FILE_TOO_LARGE',
      `文件 ${file.name} ${formatMiB(file.size)}MiB 超过 --file 上限 64MiB——请压缩或分段后重试`,
    );
  }
  const id = randomUUID();
  try {
    await conn.send({ op: 'file-begin', id, targetMachine: target, sha256: file.sha256, name: file.name, size: file.size });
    const begin = (await conn.waitFor((f) => f.op === 'file-result' && f.id === id, timeoutMs)) as FileResultFrame;
    if (!begin.ok) throw new MultichatError('FILE_TRANSFER_FAILED', begin.error ?? '对端拒绝接收文件');
    if (begin.dedup === true) return begin.path ?? '';
    const start = begin.resumeFrom ?? 0;
    for (let seq = start; seq * FILE_CHUNK_BYTES < file.size; seq++) {
      const slice = file.bytes.subarray(seq * FILE_CHUNK_BYTES, (seq + 1) * FILE_CHUNK_BYTES);
      await conn.send({ op: 'file-chunk', id, seq, bytes: slice.toString('base64') });
    }
    await conn.send({ op: 'file-end', id });
    const done = (await conn.waitFor((f) => f.op === 'file-result' && f.id === id, timeoutMs)) as FileResultFrame;
    if (!done.ok || done.path === undefined) {
      throw new MultichatError('FILE_TRANSFER_FAILED', done.error ?? '对端落盘失败');
    }
    return done.path;
  } catch (err) {
    if (err instanceof MultichatError) throw err;
    throw transportFailure(
      `文件 ${file.name} 传输中断（${err instanceof Error ? err.message : String(err)}）`,
      '断点已在对端保留，重跑同一命令将从断点续传。',
    );
  }
}

async function sendBody(
  conn: SenderConn,
  args: SendArgs,
  body: string,
  origin: string,
  target: string,
  timeoutMs: number,
  deps: SendDeps,
  caller: CallerIdentity,
  logNow: (fields: Omit<SendLogEntry, 'ts'>) => void,
  logTo: string,
  transportFailure: TransportFail,
): Promise<string> {
  const id = randomUUID();
  await conn.send({
    op: 'send',
    id,
    targetMachine: target,
    to: args.to,
    conversation: args.conversation,
    body,
    origin,
  });
  const frame = await conn
    .waitFor((f) => (f.op === 'receipt' || f.op === 'error') && f.id === id, timeoutMs)
    .catch((err: Error) => {
      logNow({ to: logTo, target: `via:tcp:${target}`, status: 'failed', code: 'TCP_TRANSPORT_FAILED' });
      throw transportFailure(err instanceof Error ? err.message : String(err));
    });

  if (frame.op === 'error') {
    const { code, message } = frame as ErrorFrame;
    if (code === ERR.PEER_OFFLINE) {
      logNow({ to: logTo, target: `via:tcp:${target}`, status: 'failed', code });
      throw new MultichatError(
        code,
        `[via tcp:${target}] ${message}——对端离线，稍后重试；若两端另配了 ssh 也可走 ssh 形态`,
      );
    }
    if (code === ERR.UNKNOWN_MACHINE) {
      logNow({ to: logTo, target: `via:tcp:${target}`, status: 'failed', code });
      throw new MultichatError(
        code,
        `[via tcp:${target}] ${message}——核对机器名：在 broker 机跑 crosschat serve --list 查看`,
      );
    }
    const err = new MultichatError(code, `[via tcp:${target}] ${message}`);
    logNow({ to: logTo, target: `via:tcp:${target}`, status: 'failed', code: err.code });
    throw err;
  }

  const receipt = frame as ReceiptFrame;
  // 节点附带了完整 runSend --json 输出——按 ssh 形态同款格式化
  let remote: { status: string; to: string; turn: number; replyRef: string; queue?: number; mailbox?: string } | undefined;
  if (receipt.output !== undefined) {
    try {
      remote = JSON.parse(receipt.output) as typeof remote;
    } catch {
      remote = undefined;
    }
  }
  const status = receipt.status;
  const turn = remote?.turn;
  const replyRef = receipt.replyRef ?? remote?.replyRef ?? '';
  logNow({ to: remote !== undefined ? `${remote.to}@${target}` : logTo, target: `via:tcp:${target}`, status, turn, replyRef });
  if (deps.conversationStateFile !== undefined && replyRef !== '') {
    try {
      recordConversation(deps.conversationStateFile, decodeRef(replyRef), deps.now());
    } catch {
      // 不可解码的 ref 不能让已送达的发送失败
    }
  }
  const displayTo = `${remote?.to ?? target}@${target}`;
  if (args.json === true) {
    return JSON.stringify({ status, to: displayTo, turn, replyRef, ...(remote?.queue !== undefined ? { queue: remote.queue } : {}), ...(remote?.mailbox !== undefined ? { mailbox: remote.mailbox } : {}), via: `tcp:${target}` });
  }
  if (status === 'parked') {
    return [
      `已寄存给 ${displayTo}（对方忙，未送达）。队列共 ${remote?.queue ?? 1} 条，看门狗每 0.5–5 分钟自动重试，无需手动 status。`,
      `人工随时可读滞留内容: ${remote?.mailbox ?? ''}（位于 ${target}）`,
      `reply-ref: ${replyRef}`,
    ].join('\n');
  }
  if (status === 'queued') {
    return `queued to ${displayTo} (turn ${turn ?? '?'}; 对方正忙，已入队，本轮结束即处理)\nreply-ref: ${replyRef}`;
  }
  return `delivered to ${displayTo} (turn ${turn ?? '?'})\nreply-ref: ${replyRef}`;
}

function formatMiB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/**
 * B2.1：status 拉在线机器表——瞬态 sender 连接发 roster 帧；任何失败返回
 * undefined（调用方静默降级为"转发器: 不可达"）。
 */
export async function fetchRoster(tcpBaseDir: string, timeoutMs = 2_000): Promise<RosterMachine[] | undefined> {
  let conn: SenderConn;
  try {
    const config = readNodeConfig(join(tcpDir(tcpBaseDir), 'node.json'));
    conn = await SenderConn.open(`ws://${config.broker.host}:${config.broker.port}`, config.key, undefined, timeoutMs);
  } catch {
    return undefined;
  }
  try {
    await conn.send({ op: 'roster' });
    const frame = await conn.waitFor((f) => f.op === 'roster-result', timeoutMs);
    return frame.op === 'roster-result' ? frame.machines : undefined;
  } catch {
    return undefined;
  } finally {
    conn.close();
  }
}
