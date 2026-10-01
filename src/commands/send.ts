import { Buffer } from 'node:buffer';
import { MultichatError } from '../errors.js';
import type { ClaudeRegistryScan } from '../claude/registry.js';
import type { CodexThreadSummary } from '../codex/client.js';
import type { ClaudeDeliveryTarget } from '../claude/deliver.js';
import { checkAndRecord, rateKey } from '../rate-limit.js';
import {
  endpointOfIdentity,
  identityKey,
  identityMatchesEndpoint,
  resolveCallerIdentity,
  type CallerIdentity,
} from '../identity.js';
import { resolveTargetByName } from '../resolve.js';
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
}

export interface SendDeps {
  env: Record<string, string | undefined>;
  /** Stdin content when piped (already normalized: undefined = not given). */
  stdinText?: string;
  listClaudeSessions(): ClaudeRegistryScan;
  listCodexThreads(): Promise<CodexThreadSummary[]>;
  deliverClaude(target: ClaudeDeliveryTarget, content: string): Promise<{ status: 'delivered' }>;
  deliverCodex(threadId: string, content: string): Promise<{ status: 'accepted'; turnId: string }>;
  rateDir: string;
  now(): number;
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

  const scan = deps.listClaudeSessions();
  const caller = resolveCallerIdentity(deps.env, scan);

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
        `Caller (${identityKey(caller)}) is not an endpoint of this conversation.`,
      );
    }
    target = asFrom ? ref.t : ref.f;
    if (target.p === 'human') {
      throw new MultichatError(
        'CANNOT_REPLY_TO_HUMAN',
        'This conversation was started by a human; there is no agent session to deliver a reply to.',
      );
    }
    turn = ref.c + 1;
    newRef = nextTurnRef(ref);
  } else {
    const threads = await deps.listCodexThreads();
    // Guard above ensures exactly one of --to/--conversation; here it is --to.
    const resolved = resolveTargetByName(args.to ?? '', scan.sessions, threads);
    target =
      resolved.side === 'claude'
        ? { p: 'claude', id: resolved.session.sessionId }
        : { p: 'codex', id: resolved.thread.id };
    newRef = newConversationRef(endpointOfIdentity(caller), target);
    turn = 1;
  }

  const replyRef = encodeRef(newRef);
  const content = composeContent(body, displayName(caller), turn, newRef);

  if (target.p === 'claude') {
    const claudeSession = scan.sessions.find((session) => session.sessionId === target.id);
    if (claudeSession === undefined) {
      throw new MultichatError(
        'TARGET_NOT_FOUND',
        `Claude session ${target.id} is not currently routable (process exited or unregistered).`,
      );
    }
    checkAndRecord(deps.rateDir, rateKey(identityKey(caller), `claude:${target.id}`), deps.now());
    const toName = claudeSession.name ?? shortId('claude', claudeSession.sessionId);
    await deps.deliverClaude(
      { pid: claudeSession.pid, messagingSocketPath: claudeSession.messagingSocketPath },
      content,
    );
    return formatDelivery(args.json === true, toName, turn, replyRef);
  }

  // Codex delivers by threadId; a missing thread surfaces as a codex adapter error.
  checkAndRecord(deps.rateDir, rateKey(identityKey(caller), `codex:${target.id}`), deps.now());
  const threads = await deps.listCodexThreads();
  const threadName = threads.find((thread) => thread.id === target.id)?.name;
  const toName = threadName ?? shortId('codex', target.id);
  await deps.deliverCodex(target.id, content);
  return formatDelivery(args.json === true, toName, turn, replyRef);
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

function composeContent(body: string, fromName: string, turn: number, ref: ConversationRef): string {
  return `${body}\n\n--- multichat ---\nfrom: ${fromName} (turn ${turn})\nreply with: multichat send --conversation ${encodeRef(ref)} --body "<your reply>"`;
}

function formatDelivery(json: boolean, toName: string, turn: number, replyRef: string): string {
  if (json) return JSON.stringify({ status: 'delivered', to: toName, turn, replyRef });
  return `delivered to ${toName} (turn ${turn})\nreply-ref: ${replyRef}`;
}
