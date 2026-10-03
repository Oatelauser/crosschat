import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import {
  decodeRef,
  encodeRef,
  newConversationRef,
  nextTurnRef,
  type ConversationRef,
  type RefEndpoint,
} from './ref.js';

/**
 * Pair-keyed conversation continuity (B15): `--to` sends continue the pair's
 * latest conversation instead of always starting a new one, so the turn
 * counter is meaningful without either agent having to carry refs by hand
 * (measured 2026-10-02: 30 distinct worker->codex messages all arrived
 * labeled turn=1). Purely local, self-healing state; corrupt/missing data
 * simply falls back to a fresh conversation. Role-free: works for any pair
 * of endpoints in any direction.
 */

export function defaultConversationsFile(): string {
  return join(process.env.LOCALAPPDATA ?? homedir(), 'crosschat', 'conversations.json');
}

interface ConversationState {
  pairs: Record<string, { ref: string; updatedAt: number }>;
}

function endpointKey(endpoint: RefEndpoint): string {
  return endpoint.p === 'human' ? 'human' : `${endpoint.p}:${endpoint.id}`;
}

/** Unordered pair key: (A→B) and (B→A) map to the same conversation. */
export function pairKeyOf(a: RefEndpoint, b: RefEndpoint): string {
  return [endpointKey(a), endpointKey(b)].sort().join('\n');
}

function loadState(file: string): ConversationState {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as ConversationState;
    if (parsed !== null && typeof parsed === 'object' && parsed.pairs !== undefined) return parsed;
  } catch {
    // missing/corrupt: self-heal as empty
  }
  return { pairs: {} };
}

function saveState(file: string, state: ConversationState): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(state), 'utf8');
    renameSync(tmp, file);
  } catch {
    // ponytail: continuity is best-effort; a lost record just starts a new thread.
  }
}

/**
 * The conversation a fresh `--to` send should join: the pair's stored ref
 * advanced by one turn. Either endpoint may continue (f/t order is the
 * initiator's and stays fixed). No usable record -> brand-new conversation.
 */
export function continueConversation(
  file: string,
  caller: RefEndpoint,
  target: RefEndpoint,
): { ref: ConversationRef; turn: number } {
  const stored = loadState(file).pairs[pairKeyOf(caller, target)];
  if (stored !== undefined) {
    try {
      const ref = decodeRef(stored.ref);
      const sameEndpoints =
        (endpointKey(ref.f) === endpointKey(caller) && endpointKey(ref.t) === endpointKey(target)) ||
        (endpointKey(ref.f) === endpointKey(target) && endpointKey(ref.t) === endpointKey(caller));
      if (sameEndpoints && ref.c >= 1) {
        const next = nextTurnRef(ref);
        return { ref: next, turn: next.c };
      }
    } catch {
      // stored ref no longer decodes: fall through to a fresh conversation
    }
  }
  return { ref: newConversationRef(caller, target), turn: 1 };
}

/** Record the pair's latest ref (issued with a message that got out: delivered, queued, or parked). */
export function recordConversation(file: string, ref: ConversationRef, nowMs: number = Date.now()): void {
  const state = loadState(file);
  state.pairs[pairKeyOf(ref.f, ref.t)] = { ref: encodeRef(ref), updatedAt: nowMs };
  saveState(file, state);
}
