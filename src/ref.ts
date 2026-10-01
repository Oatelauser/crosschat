import { randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { MultichatError } from './errors.js';

/**
 * Self-contained conversation reference (ticket 003): both endpoints' native
 * ids plus a nonce and turn counter, encoded as `mc1_<base64url(json)>`.
 * No server state is consulted to route a reply.
 */

/** human has no routable native id; claude/codex always carry one. */
export type RefEndpoint = { p: 'human' } | { p: 'claude' | 'codex'; id: string };

export interface ConversationRef {
  v: 1;
  /** Conversation initiator. */
  f: RefEndpoint;
  /** First recipient. */
  t: RefEndpoint;
  /** Random hex identifying the conversation; stable across turns. */
  n: string;
  /** Turn number of the message this ref was issued with (>= 1). */
  c: number;
}

export const REF_PREFIX = 'mc1_';

function invalid(why: string): MultichatError {
  return new MultichatError('INVALID_CONVERSATION_REF', `Malformed conversation reference (${why}).`);
}

export function newConversationRef(f: RefEndpoint, t: RefEndpoint): ConversationRef {
  return { v: 1, f, t, n: randomBytes(8).toString('hex'), c: 1 };
}

/** Ref for the next message in the same conversation: same endpoints/nonce, c+1. */
export function nextTurnRef(ref: ConversationRef): ConversationRef {
  return { ...ref, c: ref.c + 1 };
}

export function encodeRef(ref: ConversationRef): string {
  return REF_PREFIX + Buffer.from(JSON.stringify(ref), 'utf8').toString('base64url');
}

/** Strict structural validation; anything malformed is INVALID_CONVERSATION_REF. */
export function decodeRef(encoded: string): ConversationRef {
  if (!encoded.startsWith(REF_PREFIX)) throw invalid('missing mc1_ prefix');
  let json: string;
  try {
    json = Buffer.from(encoded.slice(REF_PREFIX.length), 'base64url').toString('utf8');
  } catch {
    throw invalid('bad base64url payload');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw invalid('payload is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw invalid('payload is not an object');
  const value = raw as Record<string, unknown>;
  if (value.v !== 1) throw invalid('unsupported version');
  const n = value.n;
  if (typeof n !== 'string' || n === '') throw invalid('missing nonce');
  const c = value.c;
  if (typeof c !== 'number' || !Number.isInteger(c) || c < 1) throw invalid('bad turn counter');
  return { v: 1, f: validateEndpoint(value.f, 'f'), t: validateEndpoint(value.t, 't'), n, c };
}

function validateEndpoint(value: unknown, where: 'f' | 't'): RefEndpoint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`${where}: not an object`);
  }
  const ep = value as Record<string, unknown>;
  if (ep.p === 'human') {
    if (ep.id !== undefined && ep.id !== null) throw invalid(`${where}: human endpoint must not carry an id`);
    return { p: 'human' };
  }
  if ((ep.p === 'claude' || ep.p === 'codex') && typeof ep.id === 'string' && ep.id !== '') {
    return { p: ep.p, id: ep.id };
  }
  throw invalid(`${where}: unknown side or missing id`);
}
