import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
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
 *
 * Storage (B20): one JSON shard per pair in a `conversations/` directory
 * next to the legacy state file (the `rate/<sha256>.json` precedent), so
 * concurrent sends from different pairs no longer read-modify-write one
 * global file. Lazy migration: reads prefer the shard and fall back to the
 * legacy global file (read-only — never rewritten, never deleted); writes
 * only ever touch the shard, so a stale global snapshot is harmless.
 */

export function defaultConversationsFile(): string {
  return join(process.env.LOCALAPPDATA ?? homedir(), 'crosschat', 'conversations.json');
}

interface PairRecord {
  ref: string;
  updatedAt: number;
}

/** Shard content: the pair key rides along so enumeration can rebuild the map. */
interface ShardRecord extends PairRecord {
  pair: string;
}

/** Shard directory for a state-file path: its `conversations/` sibling. */
function shardDirOf(file: string): string {
  return join(dirname(file), 'conversations');
}

function shardFileOf(file: string, pairKey: string): string {
  const name = createHash('sha256').update(pairKey, 'utf8').digest('hex');
  return join(shardDirOf(file), `${name}.json`);
}

function parseShard(text: string): ShardRecord | undefined {
  try {
    const parsed = JSON.parse(text) as Partial<ShardRecord>;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof parsed.pair === 'string' &&
      typeof parsed.ref === 'string' &&
      typeof parsed.updatedAt === 'number'
    ) {
      return { pair: parsed.pair, ref: parsed.ref, updatedAt: parsed.updatedAt };
    }
  } catch {
    // corrupt shard: self-heal as absent (isolated to this pair)
  }
  return undefined;
}

function readShard(shardFile: string): ShardRecord | undefined {
  try {
    return parseShard(readFileSync(shardFile, 'utf8'));
  } catch {
    return undefined; // missing/unreadable shard
  }
}

/** The legacy global file, read-only: `{pairs: Record<pairKey, record>}`. */
function loadLegacyPairs(file: string): Record<string, PairRecord> {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { pairs?: Record<string, PairRecord> };
    if (parsed !== null && typeof parsed === 'object' && parsed.pairs !== undefined) return parsed.pairs;
  } catch {
    // missing/corrupt: nothing to fall back to
  }
  return {};
}

/** One pair's record: shard first, else its entry in the legacy global file. */
function loadPair(file: string, pairKey: string): PairRecord | undefined {
  const shard = readShard(shardFileOf(file, pairKey));
  if (shard !== undefined) return shard;
  return loadLegacyPairs(file)[pairKey];
}

function savePair(file: string, pairKey: string, record: PairRecord): void {
  try {
    const dir = shardDirOf(file);
    mkdirSync(dir, { recursive: true });
    const shard = shardFileOf(file, pairKey);
    // ponytail: no cross-process locking; same-pair millisecond races are
    // last-write-wins — the pair's continuity lags one turn at worst, and
    // refs are self-contained so in-flight replies are unaffected.
    const tmp = `${shard}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify({ pair: pairKey, ...record }), 'utf8');
    renameSync(tmp, shard);
  } catch {
    // ponytail: continuity is best-effort; a lost record just starts a new thread.
  }
}

/** All pairs' records: every shard, plus legacy records not yet migrated (shard wins). */
export function loadAllPairs(file: string): Record<string, PairRecord> {
  const pairs: Record<string, PairRecord> = loadLegacyPairs(file);
  let names: string[] = [];
  try {
    names = readdirSync(shardDirOf(file));
  } catch {
    return pairs; // no shard directory yet: legacy view only
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const shard = readShard(join(shardDirOf(file), name));
    if (shard !== undefined) pairs[shard.pair] = shard;
  }
  return pairs;
}

function endpointKey(endpoint: RefEndpoint): string {
  return endpoint.p === 'human' ? 'human' : `${endpoint.p}:${endpoint.id}`;
}

/** Unordered pair key: (A→B) and (B→A) map to the same conversation. */
export function pairKeyOf(a: RefEndpoint, b: RefEndpoint): string {
  return [endpointKey(a), endpointKey(b)].sort().join('\n');
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
  const stored = loadPair(file, pairKeyOf(caller, target));
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
  savePair(file, pairKeyOf(ref.f, ref.t), { ref: encodeRef(ref), updatedAt: nowMs });
}
