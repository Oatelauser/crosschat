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
import { decodeOriginIdentity, runViaSend } from '../federation.js';
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

/** Hard body limit (ticket 004): 16KiB, enforced synchronously, never truncated. */
export const MAX_BODY_BYTES = 16_384;

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
}

export async function runSend(args: SendArgs, deps: SendDeps): Promise<string> {
  resolveTargetArgs(args);
  const body = resolveBody(args, deps);
  const size = Buffer.byteLength(body, 'utf8');
  if (size > MAX_BODY_BYTES) {
    throw new MultichatError(
      'MESSAGE_TOO_LARGE',
      `Body is ${size} bytes; the limit is ${MAX_BODY_BYTES}. Write the content to a file and send the path instead.`,
    );
  }

  // Federation (008 B2, design §5 C): a cross-machine --conversation ref names
  // the remote machine in its endpoints — fill a missing --via from it so a
  // hand-typed reply without the flag still routes (the envelope's copy
  // already carries it; this is typo insurance). Undecodable refs fall
  // through to the normal path's error.
  if (args.via === undefined && args.conversation !== undefined) {
    const here = deps.hostname?.() ?? osHostname();
    try {
      const ref = decodeRef(args.conversation);
      const remote = [ref.f, ref.t].find(
        (ep): ep is { p: 'claude' | 'codex'; id: string; m: string } =>
          ep.p !== 'human' && ep.m !== undefined && ep.m !== here,
      );
      if (remote !== undefined) args = { ...args, via: `ssh:${remote.m}` };
    } catch {
      // invalid ref: the main path reports it
    }
  }

  // Federation (008/B1): everything via lives behind this early branch — the
  // 16K check above applies to cross-machine sends too (D6), and the local
  // path below stays byte-identical when --via is absent (D9).
  if (args.via !== undefined) {
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

  // Federation (008 B2): a remote-origin send (ssh shell + --origin) stamps
  // both endpoints with their machines so every later envelope can derive the
  // return --via from the ref alone. Local sends stamp nothing (no m = local).
  const here = deps.hostname?.() ?? osHostname();
  if (origin !== undefined) {
    const stamp = (ep: RefEndpoint, m: string): RefEndpoint =>
      ep.p === 'human' ? ep : { ...ep, m };
    newRef = {
      ...newRef,
      f: stamp(newRef.f, identityMatchesEndpoint(caller, newRef.f) ? origin.host : here),
      t: stamp(newRef.t, identityMatchesEndpoint(caller, newRef.t) ? origin.host : here),
    };
  }
  // The reply-hint's --via points at the machine of the endpoint reading this
  // envelope would reply to — the sender's own endpoint (D5: no --to needed).
  const senderEp = identityMatchesEndpoint(caller, newRef.f) ? newRef.f : newRef.t;
  const viaHost =
    senderEp.p !== 'human' && senderEp.m !== undefined && senderEp.m !== here ? senderEp.m : undefined;

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
    const content = composeEnvelope({ fromName, toName, turn, ref: replyRef, body, viaHost });
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
    return formatDelivery(args.json === true, toName, turn, replyRef, false);
  }

  // Codex delivers by threadId; a missing thread surfaces as a codex adapter error.
  checkAndRecord(deps.rateDir, rateKey(identityKey(caller), `codex:${target.id}`), deps.now());
  const threads = await deps.listCodexThreads();
  const threadName = threads.find((thread) => thread.id === target.id)?.name;
  const toName = threadName ?? shortId('codex', target.id);
  const content = composeEnvelope({ fromName, toName, turn, ref: replyRef, body, viaHost });
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
    return formatParked(args.json === true, toName, turn, replyRef, queue, mailboxPath);
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
      return `${out}\n已入对方服务端队列，本轮结束即处理；终态可查 crosschat status --conversations`;
    }
    if (receipt === 'unconfirmed') {
      return `${out}\n回执: 暂未在对方会话记录中确认（可能仍在落盘）；稍后查 send-log.jsonl 或重跑 status`;
    }
    return out;
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
      return formatParked(args.json === true, toName, turn, replyRef, queue, mailboxPath);
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
