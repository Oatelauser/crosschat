import { Buffer } from 'node:buffer';
import { hostname as osHostname } from 'node:os';
import { MultichatError } from '../errors.js';
import type { ClaudeRegistryScan } from '../claude/registry.js';
import type { CodexThreadSummary } from '../codex/client.js';
import type { ClaudeDeliveryTarget } from '../claude/deliver.js';
import { checkAndRecord, rateKey } from '../rate-limit.js';
import { mailboxFileFor, outboxCount, park } from '../outbox.js';
import {
  endpointOfIdentity,
  identityKey,
  identityMatchesEndpoint,
  resolveCallerIdentity,
  type CallerIdentity,
} from '../identity.js';
import { resolveTargetByName } from '../resolve.js';
import { composeEnvelope } from '../envelope.js';
import {
  bodyTooLargeMessage,
  CLAUDE_ENDPOINT_MAX_BODY_BYTES,
  CODEX_ENDPOINT_MAX_BODY_BYTES,
  MAX_BODY_KIB_CEILING,
  resolveConfiguredMaxBodyBytes,
  resolveMaxTurn,
} from '../limits.js';
import { decodeOriginIdentity, isSameMachine, runViaSend } from '../federation.js';
import type { SendLogEntry } from '../send-log.js';
import { continueConversation, continueFromRef, recordConversation } from '../conversations.js';
import {
  decodeRef,
  encodeRef,
  newConversationRef,
  nextTurnRef,
  type ConversationRef,
  type RefEndpoint,
} from '../ref.js';

/** 票A：上限解析移入 limits.ts；此名保留（004 时代的外部引用面，= 默认 16384）。 */
export { DEFAULT_MAX_BODY_BYTES as MAX_BODY_BYTES } from '../limits.js';

export interface SendArgs {
  to?: string;
  conversation?: string;
  /** Body from --body; the alternative is deps.stdinText. */
  bodyArg?: string;
  json?: boolean;
  /** Federation (008/B1): `ssh:<host>` — remote CLI gets full authority. */
  via?: string;
  /** Machine-injected sender identity for ssh shells without agent env (008 D5); hidden flag. */
  origin?: string;
  /** 票A：--max-body-kb 原始值（正整数 KiB）；解析与容错在 limits.ts（非法静默降级）。 */
  maxBodyKb?: string;
  /** 票A：--max-turn 原始值（正整数轮数）；解析与容错在 limits.ts。 */
  maxTurn?: string;
}

export interface SendDeps {
  env: Record<string, string | undefined>;
  /** Stdin content when piped (already normalized: undefined = not given). */
  stdinText?: string;
  listClaudeSessions(): ClaudeRegistryScan;
  listCodexThreads(): Promise<CodexThreadSummary[]>;
  deliverClaude(target: ClaudeDeliveryTarget, content: string): Promise<{ status: 'delivered' }>;
  deliverCodex(threadId: string, content: string): Promise<{ status: 'accepted'; turnId: string; queued?: boolean }>;
  rateDir: string;
  /** Outbox root for parking busy/locked codex deliveries (%LOCALAPPDATA%/crosschat/outbox). */
  outboxDir: string;
  now(): number;
  /** Detached retry loop spawner (B12); optional so tests stay process-free. */
  spawnWatchdog?(): void;
  /** Sender-side send log (B14); optional so tests stay file-free. */
  appendLog?(entry: SendLogEntry): void;
  /** Rollout receipt probe for codex deliveries (B14). */
  confirmReceipt?(threadId: string, marker: string): Promise<'confirmed' | 'unconfirmed'>;
  /** Pair-conversation continuity state (B15); absent = always fresh threads. */
  conversationStateFile?: string;
  /** Federation transport executor (008/B1); injectable for tests. */
  sshExec?(argv: readonly string[], input: string, timeoutMs: number): Promise<import('../federation.js').SshResult>;
  /** Machine name stamped into --origin; default os.hostname(). */
  hostname?(): string;
  /** Stable per-install machine id (B10) for same-machine decisions; default platform read. */
  machineId?(): string | undefined;
}

export async function runSend(args: SendArgs, deps: SendDeps): Promise<string> {
  resolveTargetArgs(args);
  const body = resolveBody(args, deps);
  const size = Buffer.byteLength(body, 'utf8');
  // 票A：上限三层来源（--max-body-kb > CROSSCHAT_MAX_BODY_KIB > 16384 兜底）。
  // 这里只做配置值的早期快速失败（默认 16384 时与 004 现状逐字节同序同码）；
  // 端点封顶（claude 64KiB / codex 1MiB）要等目标解析出来才能补检——生效值
  // = min(配置值, 目标端点封顶)。来源值自身有 16MiB 绝对上界，到顶时教学
  // 直接说"提额无效"，不再指一条走不通的路。
  const configuredMax = resolveConfiguredMaxBodyBytes(args.maxBodyKb, deps.env);
  const turnBudget = resolveMaxTurn(args.maxTurn, deps.env);
  if (size > configuredMax) {
    const atCeiling = configuredMax === MAX_BODY_KIB_CEILING * 1_024;
    // 远端来件（008 D5：--origin 只在 --via 的接收腿出现）拒绝大正文时，读
    // 报错的是发送方——单机教学（本机提额/落盘路径）对它全是误导，换远端
    // 变体（scp 旁路 + 上限属接收方操作者）。
    throw new MultichatError(
      'MESSAGE_TOO_LARGE',
      bodyTooLargeMessage(size, configuredMax, args.via, atCeiling ? 'absolute' : undefined, args.origin !== undefined),
    );
  }

  // Federation (008 B2, design §5 C): a cross-machine --conversation ref names
  // the remote machine in its endpoints — fill a missing --via from it so a
  // hand-typed reply without the flag still routes (the envelope's copy
  // already carries it; this is typo insurance). Undecodable refs fall
  // through to the normal path's error.
  // B11 fix: only the CALLER'S COUNTERPART may become the via target. The
  // previous form scanned both endpoints and picked the first non-local one —
  // on a cross-machine reply the sender's own endpoint lives on the OTHER
  // machine, so the remote leg auto-filled a via back to the sender's machine
  // and the two machines bounced the send at each other over ssh until the
  // 120s timeout, with zero output at either end.
  if (args.via === undefined && args.conversation !== undefined) {
    const here = deps.hostname?.() ?? osHostname();
    const localMid = deps.machineId?.();
    try {
      const ref = decodeRef(args.conversation);
      const envScan = deps.listClaudeSessions();
      const envCaller = resolveCallerIdentity(deps.env, envScan);
      const caller =
        envCaller.p === 'human' && args.origin !== undefined
          ? decodeOriginIdentity(args.origin)
          : envCaller;
      const remote = [ref.f, ref.t].find(
        (ep): ep is { p: 'claude' | 'codex'; id: string; m: string } =>
          !identityMatchesEndpoint(caller, ep) &&
          ep.p !== 'human' && ep.m !== undefined && !isSameMachine(ep.mid, ep.m, localMid, here),
      );
      if (remote !== undefined) args = { ...args, via: `ssh:${remote.m}` };
    } catch {
      // invalid ref: the main path reports it
    }
  }

  // Federation (008/B1): everything via lives behind this early branch — the
  // configured-cap check above applies to cross-machine sends too (D6), and the
  // local path below stays byte-identical when --via is absent (D9).
  if (args.via !== undefined) {
    // 票A：--via 本地无法解析远端目标——按最宽端点（codex 1MiB）预检，远端
    // 自行复检（现状语义）。--max-body-kb 不透传远端：远程命令面保持固定
    // 白名单（buildSshArgv），远端用自己的两层来源决定上限。
    const viaLimit = Math.min(configuredMax, CODEX_ENDPOINT_MAX_BODY_BYTES);
    if (size > viaLimit) {
      throw new MultichatError('MESSAGE_TOO_LARGE', bodyTooLargeMessage(size, viaLimit, args.via, 'ssh-precheck'));
    }
    return runViaSend(args, body, deps);
  }

  const scan = deps.listClaudeSessions();
  const envCaller = resolveCallerIdentity(deps.env, scan);
  // Federation (008 D5): an ssh shell has no agent env, so the remote caller
  // would collapse to human (unreplyable). --origin — injected by the sending
  // machine's CLI — is the identity fallback; a real env identity always wins.
  const origin = envCaller.p === 'human' && args.origin !== undefined ? decodeOriginIdentity(args.origin) : undefined;
  const caller: CallerIdentity = origin ?? envCaller;

  let target: RefEndpoint;
  let newRef: ConversationRef;
  let turn: number;
  if (args.conversation !== undefined) {
    const ref = decodeRef(args.conversation);
    const asFrom = identityMatchesEndpoint(caller, ref.f);
    const asTo = identityMatchesEndpoint(caller, ref.t);
    if (!asFrom && !asTo) {
      throw new MultichatError(
        'CALLER_NOT_IN_CONVERSATION',
        `Caller (${identityKey(caller)}) is not an endpoint of this conversation. ` +
          '手里的 ref 可能抄漏或已过期——改用 --to <名字> 自动接续该端对最新对话。',
      );
    }
    target = asFrom ? ref.t : ref.f;
    if (target.p === 'human') {
      throw new MultichatError(
        'CANNOT_REPLY_TO_HUMAN',
        'This conversation was started by a human; there is no agent session to deliver a reply to.',
      );
    }
    // B22: the reply-hint ref is a snapshot of send time; when the pair's
    // stored line has already moved at or past it (late reply, parallel
    // senders from one old base), the stored line wins — no turn collisions.
    // Unwired state keeps the exact legacy nextTurnRef behavior.
    const continued =
      deps.conversationStateFile === undefined
        ? { ref: nextTurnRef(ref), turn: ref.c + 1 }
        : continueFromRef(deps.conversationStateFile, ref);
    newRef = continued.ref;
    turn = continued.turn;
  } else {
    // Codex may be entirely absent (unix deploy); --to resolution still has
    // to work claude-side, so an unreachable codex degrades to an empty
    // thread list. A codex-side name then fails resolution with its own
    // error instead of a transport spawn failure, and the codex-target
    // delivery path still hits the real proxy below.
    let threads: CodexThreadSummary[] = [];
    try {
      threads = await deps.listCodexThreads();
    } catch {
      // claude-side --to names still resolvable; otherwise let resolveTargetByName report it
    }
    // Guard above ensures exactly one of --to/--conversation; here it is --to.
    const resolved = resolveTargetByName(args.to ?? '', scan.sessions, threads);
    target =
      resolved.side === 'claude'
        ? { p: 'claude', id: resolved.session.sessionId }
        : { p: 'codex', id: resolved.thread.id };
    // B15: --to continues the pair's latest conversation when state is wired
    // (meaningful turn counting); absent state keeps the legacy fresh-thread
    // behavior so existing tests/embeddings stay untouched.
    const callerEndpoint = endpointOfIdentity(caller);
    const continued =
      deps.conversationStateFile === undefined
        ? { ref: newConversationRef(callerEndpoint, target), turn: 1 }
        : continueConversation(deps.conversationStateFile, callerEndpoint, target);
    newRef = continued.ref;
    turn = continued.turn;
  }

  // 票A：端点封顶——早期检查只查了配置值，claude 端点 64KiB 更严，解析出
  // 目标后必须补检（配置再大也送不进端点）。到端点硬顶 = 提额无效，教学
  // 直接指向落盘。（信封教学行永远静态 16KiB——第六单政策，见 envelope.ts。）
  const endpointCap = target.p === 'claude' ? CLAUDE_ENDPOINT_MAX_BODY_BYTES : CODEX_ENDPOINT_MAX_BODY_BYTES;
  const effectiveMax = Math.min(configuredMax, endpointCap);
  if (size > effectiveMax) {
    // 远端来件同样换远端教学（第八单）：硬顶事实保留（提额无效），尾巴换
    // scp 旁路——接收方提额也过不了端点硬顶，scp 是唯一出路。
    throw new MultichatError(
      'MESSAGE_TOO_LARGE',
      bodyTooLargeMessage(size, effectiveMax, args.via, target.p, args.origin !== undefined),
    );
  }

  // Federation (008 B2 + B10): a remote-origin send (ssh shell + --origin)
  // stamps both endpoints with their machines — m (hostname) routes the return
  // --via, mid (machine-id) decides "same machine" so hostname collisions
  // cannot fake a local conversation. Local sends stamp nothing (no m = local).
  const here = deps.hostname?.() ?? osHostname();
  const localMid = deps.machineId?.();
  if (origin !== undefined) {
    const fIsCaller = identityMatchesEndpoint(caller, newRef.f);
    const stamp = (ep: RefEndpoint, m: string, mid: string | undefined): RefEndpoint =>
      ep.p === 'human' ? ep : { ...ep, m, ...(mid === undefined ? {} : { mid }) };
    newRef = {
      ...newRef,
      f: stamp(newRef.f, fIsCaller ? origin.host : here, fIsCaller ? origin.mid : localMid),
      t: stamp(newRef.t, fIsCaller ? here : origin.host, fIsCaller ? localMid : origin.mid),
    };
  }
  // The reply-hint's --via points at the machine of the endpoint reading this
  // envelope would reply to — the sender's own endpoint (D5: no --to needed).
  const senderEp = identityMatchesEndpoint(caller, newRef.f) ? newRef.f : newRef.t;
  const viaHost =
    senderEp.p !== 'human' && senderEp.m !== undefined && !isSameMachine(senderEp.mid, senderEp.m, localMid, here)
      ? senderEp.m
      : undefined;
  // B10 collision warning: the ssh peer's hostname equals ours but its
  // machine-id differs — routing is still correct (per-machine ssh alias
  // namespaces resolve it), the name ambiguity is worth telling the human.
  const collision =
    origin !== undefined &&
    origin.host === here &&
    origin.mid !== undefined &&
    localMid !== undefined &&
    origin.mid !== localMid
      ? `⚠ 两台机器同名 (${here})：已按跨机路由（machine-id 不同）。建议改名避免混淆。`
      : undefined;
  const finish = (out: string): string => {
    if (collision === undefined) return out;
    if (args.json === true) {
      try {
        return JSON.stringify({ ...JSON.parse(out) as Record<string, unknown>, warning: collision });
      } catch {
        return out;
      }
    }
    return `${out}\n${collision}`;
  };

  const replyRef = encodeRef(newRef);
  const fromName = displayName(caller);
  /** Every exit path logs who sent what to whom (B14, +from in B16, +fromName in B21). */
  const logNow = (fields: Omit<SendLogEntry, 'ts'>): void => {
    deps.appendLog?.(logEntry(deps, { from: identityKey(caller), fromName, ...fields }));
  };

  if (target.p === 'claude') {
    const claudeSession = scan.sessions.find((session) => session.sessionId === target.id);
    if (claudeSession === undefined) {
      throw new MultichatError(
        'TARGET_NOT_FOUND',
        `Claude session ${target.id} is not currently routable (process exited or unregistered). ` +
          '对端会话可能已重启——改用 --to <名字> 自动接续该端对最新对话（--to 同名即续，无需换名）。' +
          'status 只列本机会话；跨机对端用 ssh <对端> crosschat status 查。',
      );
    }
    checkAndRecord(deps.rateDir, rateKey(identityKey(caller), `claude:${target.id}`), deps.now());
    const toName = claudeSession.name ?? shortId('claude', claudeSession.sessionId);
    const content = composeEnvelope({ fromName, toName, turn, ref: replyRef, body, viaHost, turnBudget });
    try {
      await deps.deliverClaude(
        { pid: claudeSession.pid, messagingSocketPath: claudeSession.messagingSocketPath },
        content,
      );
    } catch (err) {
      logNow({ to: toName, target: `claude:${target.id}`, status: 'failed', code: errorCode(err), turn, replyRef });
      throw err;
    }
    logNow({ to: toName, target: `claude:${target.id}`, status: 'delivered', turn, replyRef });
    if (deps.conversationStateFile !== undefined) recordConversation(deps.conversationStateFile, newRef, deps.now());
    return finish(formatDelivery(args.json === true, toName, turn, replyRef, false));
  }

  // Codex delivers by threadId; a missing thread surfaces as a codex adapter error.
  checkAndRecord(deps.rateDir, rateKey(identityKey(caller), `codex:${target.id}`), deps.now());
  const threads = await deps.listCodexThreads();
  const threadName = threads.find((thread) => thread.id === target.id)?.name;
  const toName = threadName ?? shortId('codex', target.id);
  const content = composeEnvelope({ fromName, toName, turn, ref: replyRef, body, viaHost, turnBudget });
  const parkNow = (): number => {
    park(
      deps.outboxDir,
      target.id,
      { envelope: content, toName, callerKey: identityKey(caller) },
      deps.now(),
    );
    deps.spawnWatchdog?.();
    return outboxCount(deps.outboxDir, target.id);
  };
  const mailboxPath = mailboxFileFor(deps.outboxDir, target.id);
  // Queue discipline (B12): when older items are still parked, a fresh send
  // joins the queue instead of jumping it — order stays FIFO even though a
  // direct attempt could squeeze through an idle window the drain missed.
  const queuedBefore = outboxCount(deps.outboxDir, target.id);
  if (queuedBefore > 0) {
    const queue = parkNow();
    return finish(formatParked(args.json === true, toName, turn, replyRef, queue, mailboxPath));
  }
  try {
    const delivered = await deps.deliverCodex(target.id, content);
    const queued = delivered.queued === true;
    // Queued sits behind the recipient's running turn: a rollout receipt is
    // structurally impossible within the probe budget, so do not even look.
    const receipt = queued ? undefined : await deps.confirmReceipt?.(target.id, replyRef);
    logNow({ to: toName, target: `codex:${target.id}`, status: queued ? 'queued' : 'delivered', turn, replyRef, receipt });
    const out = formatDelivery(args.json === true, toName, turn, replyRef, queued);
    if (deps.conversationStateFile !== undefined) recordConversation(deps.conversationStateFile, newRef, deps.now());
    if (queued) {
      return finish(`${out}\n已入对方服务端队列，本轮结束即处理；终态可查 crosschat status --conversations`);
    }
    if (receipt === 'unconfirmed') {
      return finish(`${out}\n回执: 暂未在对方会话记录中确认（可能仍在落盘）；稍后查 send-log.jsonl 或重跑 status`);
    }
    return finish(out);
  } catch (err) {
    // Busy/locked = definitively not delivered (deliver.ts polls before giving
    // up): park the composed envelope verbatim; the watchdog retries it.
    if (
      err instanceof MultichatError &&
      (err.code === 'CODEX_THREAD_BUSY_TIMEOUT' || err.code === 'CODEX_THREAD_LOCKED')
    ) {
      const queue = parkNow();
      logNow({ to: toName, target: `codex:${target.id}`, status: 'parked', turn, replyRef });
      if (deps.conversationStateFile !== undefined) recordConversation(deps.conversationStateFile, newRef, deps.now());
      return finish(formatParked(args.json === true, toName, turn, replyRef, queue, mailboxPath));
    }
    logNow({ to: toName, target: `codex:${target.id}`, status: 'failed', code: errorCode(err), turn, replyRef });
    throw err;
  }
}

function logEntry(
  deps: SendDeps,
  fields: Omit<SendLogEntry, 'ts'>,
): SendLogEntry {
  return { ...fields, ts: new Date(deps.now()).toISOString() };
}

function errorCode(err: unknown): string {
  return err instanceof MultichatError ? err.code : 'INTERNAL';
}

function resolveTargetArgs(args: SendArgs): void {
  if (args.to !== undefined && args.conversation !== undefined) {
    throw new MultichatError('TARGET_CONFLICT', 'Use either --to <name> or --conversation <ref>, not both.');
  }
  if (args.to === undefined && args.conversation === undefined) {
    throw new MultichatError('TARGET_REQUIRED', 'Specify a target: --to <name> or --conversation <ref>.');
  }
}

function resolveBody(args: SendArgs, deps: SendDeps): string {
  if (args.bodyArg !== undefined && deps.stdinText !== undefined) {
    throw new MultichatError('BODY_CONFLICT', 'Message body was given both via --body and stdin; pick one.');
  }
  const body = args.bodyArg ?? deps.stdinText;
  if (body === undefined || body === '') {
    throw new MultichatError(
      'BODY_REQUIRED',
      'Message body is required: pass --body "<text>" or pipe the message on stdin.',
    );
  }
  return body;
}

function displayName(identity: CallerIdentity): string {
  if (identity.p === 'claude') return identity.name ?? shortId('claude', identity.id);
  if (identity.p === 'codex') return shortId('codex', identity.id);
  return 'human';
}

function shortId(prefix: string, id: string): string {
  return `${prefix}/${id.slice(0, 8)}`;
}

function formatDelivery(json: boolean, toName: string, turn: number, replyRef: string, queued: boolean): string {
  if (json) {
    return JSON.stringify({ status: 'delivered', to: toName, turn, replyRef, queued });
  }
  if (queued) {
    return `queued to ${toName} (turn ${turn}; 对方正忙，已入队，本轮结束即处理)\nreply-ref: ${replyRef}`;
  }
  return `delivered to ${toName} (turn ${turn})\nreply-ref: ${replyRef}`;
}

function formatParked(
  json: boolean,
  toName: string,
  turn: number,
  replyRef: string,
  queue: number,
  mailboxPath: string,
): string {
  if (json) {
    return JSON.stringify({ status: 'parked', to: toName, turn, replyRef, queue, mailbox: mailboxPath });
  }
  return [
    `已寄存给 ${toName}（对方忙，未送达）。队列共 ${queue} 条，看门狗每 0.5–5 分钟自动重试，无需手动 status。`,
    `人工随时可读滞留内容: ${mailboxPath}`,
    `reply-ref: ${replyRef}`,
  ].join('\n');
}
