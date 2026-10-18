/**
 * `send --via tcp:<机器>` 发送腿（票B B2）：瞬态 ws 连 broker（role:'sender'），
 * send 帧 → 等 receipt/error/超时。输出语义与 ssh 形态逐字对齐（成功打印远端
 * output 同格式；错误同码重抛 + [via tcp:目标] 前缀）；发起侧记账与 ssh via
 * 分支同款。文件走 file-begin/chunk/end 分块流（256KiB/块，64MiB 上限）。
 */
import { randomUUID } from 'node:crypto';
import { hostname as osHostname, tmpdir as osTmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { WebSocket } from 'ws';
import { MultichatError } from '../errors.js';
import { encodeOrigin, machineDisplay, originDisplayName } from '../federation.js';
import { identityKey, resolveCallerIdentity, type CallerIdentity } from '../identity.js';
import { handleForRef, recordConversation } from '../conversations.js';
import { decodeRef } from '../ref.js';
import { CODEX_ENDPOINT_MAX_BODY_BYTES } from '../limits.js';
import type { SendLogEntry } from '../send-log.js';
import type { SendArgs, SendDeps } from '../commands/send.js';
import { encodeFrame, ERR, MAX_PAYLOAD_BYTES, parseFrame, PROTOCOL_VERSION } from './protocol.js';
import type { ErrorFrame, FileResultFrame, Frame, MemberRemoveResultFrame, ReceiptFrame, RosterMachine, StatusPayload, StatusResultFrame } from './protocol.js';
import { defaultBaseDir, tcpDir } from './registry.js';
import { formatBrokerEntry, readNodeConfig, type BrokerEntry } from './node.js';
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

/**
 * B1 多星条目选择（纯函数，send 与 --file 共用一条 conn，在此一次选定）：
 * a. `tcp:<选择器>:<目标>`：选择器先按条目星名（name）精确匹配，无命中再按
 *    starId 前缀唯一匹配（多命中教加长，零命中列全部条目 cloud(6b76e1) 式）；
 * b. 裸 `tcp:<目标>` 且带 --conversation：按 ref.starId 精确匹配（无匹配教
 *    核对配置/索取）；ref 无 starId 或解不开则落到 c/d（单条目行为不变）；
 * c. 裸且仅 1 条 → 用它（B0 前的今日行为）；
 * d. 裸且多条 → 教学报错：列出 星名(starId前缀)，示例 `--via tcp:<星名>:<目标>`。
 */
export function selectBrokerEntry(entries: BrokerEntry[], selector: string | undefined, conversation: string | undefined): BrokerEntry {
  const listEntries = (): string => entries.map(formatBrokerEntry).join('、');
  if (selector !== undefined) {
    const byName = entries.find((e) => e.name === selector);
    if (byName !== undefined) return byName;
    const byPrefix = entries.filter((e) => e.starId !== undefined && e.starId.startsWith(selector));
    if (byPrefix.length === 1) return byPrefix[0]!;
    if (byPrefix.length > 1) {
      throw new MultichatError(
        'USAGE',
        `--via 选择器 ${selector} 的 starId 前缀命中多个星（${byPrefix.map(formatBrokerEntry).join('、')}）——加长前缀使其唯一`,
      );
    }
    throw new MultichatError('USAGE', `--via 选择器 ${selector} 不匹配任何条目——本机 node.json 现有：${listEntries()}`);
  }
  if (conversation !== undefined) {
    let refStarId: string | undefined;
    try {
      refStarId = decodeRef(conversation).starId;
    } catch {
      // 选路解不开的 ref 不在这里抢报错——交给后续投递路径的教学
    }
    if (refStarId !== undefined) {
      const hit = entries.find((e) => e.starId === refStarId);
      if (hit === undefined) {
        throw new MultichatError('USAGE', `会话经由的星（starId ${refStarId}）不在本机 node.json——核对配置或向管理员索取`);
      }
      return hit;
    }
  }
  if (entries.length === 1) return entries[0]!;
  throw new MultichatError(
    'USAGE',
    `本机 node.json 有 ${entries.length} 个 broker 条目，裸 tcp:<目标> 无法选择——现有：${listEntries()}；示例：--via tcp:${entries[0]!.name ?? entries[0]!.starId}:<目标>`,
  );
}

/** B1 `tcp:<选择器>:<目标>` 拆解（send 与 status --via tcp: 同一函数族共用）。 */
export function parseTcpViaSpec(via: string): { selector: string | undefined; target: string } {
  const viaRest = via.slice(4);
  const sep = viaRest.indexOf(':');
  return {
    selector: sep > 0 ? viaRest.slice(0, sep) : undefined,
    target: sep > 0 ? viaRest.slice(sep + 1) : viaRest,
  };
}

/** via 分支入口（send.ts 在 ssh 分流前调用）。body 在 --file 无 --body 时可为 undefined。 */
export async function runViaTcpSend(args: SendArgs, body: string | undefined, deps: SendDeps): Promise<string> {
  // B1：`tcp:<选择器>:<目标>`——第一个':'前是选择器（星名/starId 前缀），其余是目标
  const { selector, target } = parseTcpViaSpec(args.via!);
  if (target === '') {
    throw new MultichatError('USAGE', '--via tcp:<机器名>：机器名不能为空（broker 机上 crosschat serve --list 可查；多星机可 --via tcp:<星名>:<机器名> 指定）');
  }
  // 019：两段式会话投递退役——tcp 机器级目标（无会话段）+ --to 会话名 = 远端
  // 任意同名活会话即收的 ambient 语义，与星成员模型冲突（文档已先行 proto:3
  // 口径）。机器级操作（--file / --conversation / status / roster）与 ssh 形态不受影响。
  if (args.to !== undefined && !target.includes(':')) {
    throw new MultichatError(
      'SESSION_NOT_MEMBER',
      `两段式会话投递已退役：--via tcp:<机器> --to <会话名> 不再投递机器上的非成员会话——会话须经启动器入星（crosschat claude/codex --connect <星>）才能按名投递，三段寻址 --via tcp:<星>:<机器>:<会话名> 直达星成员`,
    );
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

  // B1：按 选择器/--conversation.starId/条目数 选本机条目（见 selectBrokerEntry）
  const entry = selectBrokerEntry(config.entries, selector, args.conversation);
  const url = `ws://${entry.host}:${entry.port}`;
  const conn = await SenderConn.open(url, entry.key, deps.machineId?.(), Math.min(timeoutMs, 15_000));
  // D0 自动降级：正文超 1MiB tcp 预检线不再报 MESSAGE_TOO_LARGE，改落
  // os.tmpdir 唯一临时文件走既有 --file 分块流（≤64MiB 一次成功）。成功删
  // 临时文件并注明对端落地路径；任何失败保留原文、本机路径进教学。显式
  // --file 的行为一个字节不变（降级只在无 --file 时发生）。
  let tmpFile: string | undefined;
  try {
    if (args.fileArg === undefined && body !== undefined && Buffer.byteLength(body, 'utf8') > CODEX_ENDPOINT_MAX_BODY_BYTES) {
      tmpFile = join(osTmpdir(), `crosschat-msg-${randomUUID().slice(0, 8)}.txt`);
      writeFileSync(tmpFile, body, 'utf8');
    }
    let finalBody = body;
    let landedPath: string | undefined;
    const filePath = args.fileArg ?? tmpFile;
    if (filePath !== undefined) {
      const path = await sendFile(conn, filePath, target, timeoutMs, transportFailure);
      landedPath = path;
      finalBody =
        tmpFile !== undefined
          ? `文件 ${fileNameOf(tmpFile)} 已送达：${path}`
          : body ?? `文件 ${fileNameOf(filePath)} 已送达：${path}`;
    }
    if (finalBody === undefined || finalBody === '') {
      throw new MultichatError('BODY_REQUIRED', 'Message body is required: pass --body "<text>" or pipe the message on stdin.');
    }
    const out = await sendBody(conn, args, finalBody, origin, target, timeoutMs, deps, caller, logNow, logTo, transportFailure);
    if (tmpFile === undefined) return out;
    rmSync(tmpFile, { force: true });
    if (args.json === true) {
      try {
        return JSON.stringify({ ...JSON.parse(out) as Record<string, unknown>, file: landedPath });
      } catch {
        return out;
      }
    }
    return `${out}\n正文超限已自动转文件通道：${landedPath}`;
  } catch (err) {
    if (tmpFile !== undefined && err instanceof Error) {
      err.message += `\n正文原文已保留: ${tmpFile}`;
    }
    throw err;
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
    // 027-F：回显原样带完整 --via（含星段）——selector 在场不丢（曾被误读为"地址被误拆"）
    const viaEcho = args.via ?? `tcp:${target}`;
    if (code === ERR.PEER_OFFLINE) {
      logNow({ to: logTo, target: `via:tcp:${target}`, status: 'failed', code });
      throw new MultichatError(
        code,
        `[via ${viaEcho}] ${message}——对端离线，稍后重试；若两端另配了 ssh 也可走 ssh 形态`,
      );
    }
    if (code === ERR.UNKNOWN_MACHINE) {
      logNow({ to: logTo, target: `via:tcp:${target}`, status: 'failed', code });
      throw new MultichatError(
        code,
        `[via ${viaEcho}] ${message}——核对机器名：在 broker 机跑 crosschat serve --list 查看`,
      );
    }
    const err = new MultichatError(code, `[via ${viaEcho}] ${message}`);
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
  // 016① 显示型机器段统一 name(mid8)（寻址面不变：--via/帧 targetMachine/错误前缀照旧）。
  const machine = machineDisplay(
    target,
    replyRef,
    deps.machineId?.(),
    deps.hostname?.() ?? osHostname(),
    deps.conversationStateFile,
  );
  logNow({ to: remote !== undefined ? `${remote.to}@${machine}` : logTo, target: `via:tcp:${target}`, status, turn, replyRef });
  // G0 长引用退场：落定后顺带给我方分片配短柄，人眼输出行尾 `· 续话 cN`。
  let handle: string | undefined;
  if (deps.conversationStateFile !== undefined && replyRef !== '') {
    try {
      const ref = decodeRef(replyRef);
      recordConversation(deps.conversationStateFile, ref, deps.now());
      handle = handleForRef(deps.conversationStateFile, ref);
    } catch {
      // 不可解码的 ref 不能让已送达的发送失败
    }
  }
  const displayTo = `${remote?.to ?? target}@${machine}`;
  if (args.json === true) {
    return JSON.stringify({ status, to: displayTo, turn, replyRef, ...(remote?.queue !== undefined ? { queue: remote.queue } : {}), ...(remote?.mailbox !== undefined ? { mailbox: remote.mailbox } : {}), via: `tcp:${target}` });
  }
  if (status === 'parked') {
    return [
      `已寄存给 ${displayTo}（对方忙，未送达）。队列共 ${remote?.queue ?? 1} 条，看门狗每 0.5–5 分钟自动重试，无需手动 status。`,
      `人工随时可读滞留内容: ${remote?.mailbox ?? ''}（位于 ${machine}）`,
      handle === undefined ? `reply-ref: ${replyRef}` : `续话: ${handle}`,
    ].join('\n');
  }
  const tail = handle === undefined ? `\nreply-ref: ${replyRef}` : ` · 续话 ${handle}`;
  if (status === 'queued') {
    return `queued to ${displayTo} (turn ${turn ?? '?'}; 对方正忙，已入队，本轮结束即处理)${tail}`;
  }
  return `delivered to ${displayTo} (turn ${turn ?? '?'})${tail}`;
}

function formatMiB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/**
 * B2.1：status 拉在线机器表——瞬态 sender 连接发 roster 帧；任何失败返回
 * undefined（调用方静默降级为"转发器: 不可达"）。
 * B2：entry 可指定探哪颗星（status 多条目逐星探）；缺省 entries[0]（B2.1 行为）。
 */
export async function fetchRosterFor(
  tcpBaseDir: string,
  entry: BrokerEntry | undefined,
  timeoutMs = 2_000,
): Promise<RosterMachine[] | undefined> {
  let conn: SenderConn;
  try {
    const config = readNodeConfig(join(tcpDir(tcpBaseDir), 'node.json'));
    const target = entry ?? config.entries[0]!; // B0：多条目暂取第一条
    conn = await SenderConn.open(`ws://${target.host}:${target.port}`, target.key, undefined, timeoutMs);
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

/** B2.1 原签名（探 entries[0]）——单条目路径与既有调用方沿用。 */
export function fetchRoster(tcpBaseDir: string, timeoutMs = 2_000): Promise<RosterMachine[] | undefined> {
  return fetchRosterFor(tcpBaseDir, undefined, timeoutMs);
}

/**
 * 028 `serve --connect <星> --member-remove <名|id8>` 的传输腿：瞬态 sender
 * 连接发 member-remove 帧等回执（星内任何机器可执——纯册状态操作，无需本地
 * 验活）。broker 不可达/超时按传输失败教学重抛。
 */
export async function requestMemberRemove(
  entry: BrokerEntry,
  target: string,
  timeoutMs = 8_000,
): Promise<MemberRemoveResultFrame> {
  const conn = await SenderConn.open(`ws://${entry.host}:${entry.port}`, entry.key, undefined, Math.min(timeoutMs, 15_000));
  try {
    await conn.send({ op: 'member-remove', target });
    const frame = await conn.waitFor((f) => f.op === 'member-remove-result' || f.op === 'error', timeoutMs);
    if (frame.op === 'error') {
      throw new MultichatError(frame.code, frame.message);
    }
    if (frame.op !== 'member-remove-result') {
      throw new MultichatError('TCP_TRANSPORT_FAILED', 'broker 应答形状异常（非 member-remove-result）');
    }
    return frame;
  } catch (err) {
    if (err instanceof MultichatError) throw err;
    throw new MultichatError(
      'TCP_TRANSPORT_FAILED',
      `member-remove 未应答（${err instanceof Error ? err.message : String(err)}）——broker 在跑吗（crosschat serve）？两端 crosschat 都需 ≥1.7.0`,
    );
  } finally {
    conn.close();
  }
}

/**
 * 018 批二（9b）：瞬态读 broker 握手 info 的 caps——启动器/serve --detach 父
 * 进程的降级预检（只等第一帧 info 即关，不做 connect 握手）。任何失败返回
 * undefined（探测不到=不告警；聚合器重连时会再出声）。message 监听在 open
 * 之前挂好——info 帧在 open 事件后即刻可达，晚了会丢首帧。
 */
export async function fetchBrokerCaps(entry: BrokerEntry, timeoutMs = 2_000): Promise<string[] | undefined> {
  const ws = new WebSocket(`ws://${entry.host}:${entry.port}`, { maxPayload: MAX_PAYLOAD_BYTES });
  const firstFrame = new Promise<Frame | undefined>((resolve) => {
    const t = setTimeout(() => resolve(undefined), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(t);
      resolve(parseFrame(data.toString()));
    });
    ws.once('error', () => {
      clearTimeout(t);
      resolve(undefined);
    });
  });
  const opened = new Promise<boolean>((resolve) => {
    ws.once('open', () => resolve(true));
    ws.once('error', () => resolve(false));
  });
  if (!(await opened)) {
    try { ws.close(); } catch { /* 已断开 */ }
    return undefined;
  }
  const info = await firstFrame;
  try { ws.close(); } catch { /* 已断开 */ }
  return info !== undefined && info.op === 'info' ? info.caps : undefined;
}

/** E1 status --via tcp:<机器> 的传输腿依赖（cli 注真值，测试注临时目录）。 */
export interface TcpStatusDeps {
  env: Record<string, string | undefined>;
  tcpBaseDir?: string;
  machineId?(): string | undefined;
}

/**
 * E1 远程会话枚举发送腿（票012）：与 send 同款瞬态 sender 连接——握手 →
 * status-query → 等 status-result/error → 关。超时教学覆盖版本偏差（旧
 * broker 对未知 op 静默无行为 → 请求方在此超时）。
 */
export async function runViaTcpStatus(
  via: string,
  deps: TcpStatusDeps,
): Promise<{ target: string; payload: StatusPayload }> {
  const { selector, target } = parseTcpViaSpec(via);
  if (target === '') {
    throw new MultichatError('USAGE', '--via tcp:<机器名>：机器名不能为空（broker 机上 crosschat serve --list 可查；多星机可 --via tcp:<星名>:<机器名> 指定）');
  }
  const config = readNodeConfig(join(tcpDir(deps.tcpBaseDir ?? defaultBaseDir()), 'node.json'));
  const timeoutMs = tcpTimeoutMs(deps.env);
  const entry = selectBrokerEntry(config.entries, selector, undefined);
  const conn = await SenderConn.open(`ws://${entry.host}:${entry.port}`, entry.key, deps.machineId?.(), Math.min(timeoutMs, 15_000));
  try {
    const id = randomUUID();
    await conn.send({ op: 'status-query', id, targetMachine: target });
    const frame = await conn.waitFor((f) => (f.op === 'status-result' || f.op === 'error') && f.id === id, timeoutMs);
    if (frame.op === 'error') {
      const { code, message } = frame as ErrorFrame;
      if (code === ERR.PEER_OFFLINE) {
        throw new MultichatError(code, `[via tcp:${target}] ${message}——对端离线，稍后重试；ssh 形态可 ssh <对端> crosschat status`);
      }
      if (code === ERR.UNKNOWN_MACHINE) {
        throw new MultichatError(code, `[via tcp:${target}] ${message}——核对机器名：在 broker 机跑 crosschat serve --list 查看`);
      }
      throw new MultichatError(code, `[via tcp:${target}] ${message}`);
    }
    const result = frame as StatusResultFrame;
    if (!result.ok || result.payload === undefined) {
      throw new MultichatError('REMOTE_FAILED', `[via tcp:${target}] 对端扫描失败：${result.error ?? '无详情'}`);
    }
    return { target, payload: result.payload };
  } catch (err) {
    if (err instanceof MultichatError) throw err;
    throw new MultichatError(
      'TCP_TRANSPORT_FAILED',
      `对端未应答（${err instanceof Error ? err.message : String(err)}）——目标机的节点客户端在跑吗（crosschat serve --connect）？两端 crosschat 都需升级到支持 status --via 的版本`,
    );
  } finally {
    conn.close();
  }
}
