import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { stateRoot } from './state-root.js';
import { MultichatError } from './errors.js';
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
  return join(stateRoot(), 'conversations.json');
}

interface PairRecord {
  ref: string;
  updatedAt: number;
  /**
   * F2 会话短柄表（c<数字> -> 完整 mc1_/mc2_ ref），寄生本分片零新文件。
   * 键的插入序即 LRU 序（同 nonce 刷新会重插到尾）；生成与消费同机同版本，
   * 短柄永不过网。
   */
  handles?: Record<string, string>;
  /**
   * 016① 机器名表（mid8 -> 信封 from-machine 名）：跨机信封到达时随
   * recordConversation 写入，回执显示层据它把裸指纹还原成 name(mid8)。
   * additive 新字段——旧版读写忽略（旧版重写分片会丢弃它，显示回退
   * mid8，无害）；键恒 8 hex，值恒字符串。
   */
  machines?: Record<string, string>;
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

/** F2：handles 形状防守——只收留字符串值的条目，其余丢弃。 */
function sanitizeHandles(value: unknown): Record<string, string> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [handle, ref] of Object.entries(value)) {
    if (typeof ref === 'string') out[handle] = ref;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 016①：machines 形状防守——同 handles，只收字符串值条目。 */
function sanitizeMachines(value: unknown): Record<string, string> | undefined {
  return sanitizeHandles(value);
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
      const handles = sanitizeHandles(parsed.handles);
      const machines = sanitizeMachines(parsed.machines);
      return {
        pair: parsed.pair,
        ref: parsed.ref,
        updatedAt: parsed.updatedAt,
        ...(handles === undefined ? {} : { handles }),
        ...(machines === undefined ? {} : { machines }),
      };
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

/** Attribution fields of a send-log entry (structural: SendLogEntry satisfies this). */
export interface PairAttribution {
  from?: string;
  target: string;
  replyRef?: string;
}

/**
 * Pair key of one send-log entry (014 moved here from conversation-summary so
 * the rate limiter shares the exact attribution logic); undefined when it
 * cannot be attributed: `from`+`target` directly, else decode the entry's own
 * embedded replyRef (that ref belongs to the message itself).
 */
export function pairKeyOfEntry(entry: PairAttribution): string | undefined {
  if (entry.from !== undefined && entry.target !== '') {
    return [entry.from, entry.target].sort().join('\n');
  }
  if (entry.replyRef !== undefined) {
    try {
      const ref = decodeRef(entry.replyRef);
      return pairKeyOf(ref.f, ref.t);
    } catch {
      // undecodable ref: no attribution
    }
  }
  return undefined;
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
      const sameEndpoints = matchesEndpoints(ref, caller, target);
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

/** Both endpoints present, in either f/t order (a record either side can continue). */
function matchesEndpoints(ref: ConversationRef, a: RefEndpoint, b: RefEndpoint): boolean {
  return (
    (endpointKey(ref.f) === endpointKey(a) && endpointKey(ref.t) === endpointKey(b)) ||
    (endpointKey(ref.f) === endpointKey(b) && endpointKey(ref.t) === endpointKey(a))
  );
}

/**
 * The conversation a `--conversation` reply should join (B22): the passed ref
 * advanced by one turn — unless the pair's shard has already moved at or past
 * it (late reply, or several senders working from the same stale base), in
 * which case the shard line wins and turn collisions disappear. Shard behind
 * the passed ref, absent, a different conversation (nonce differs), or
 * endpoint-mismatched: unchanged pass-through continuation.
 */
export function continueFromRef(
  file: string,
  ref: ConversationRef,
): { ref: ConversationRef; turn: number } {
  const stored = loadPair(file, pairKeyOf(ref.f, ref.t));
  if (stored !== undefined) {
    try {
      const shard = decodeRef(stored.ref);
      if (matchesEndpoints(shard, ref.f, ref.t) && shard.n === ref.n && shard.c >= ref.c) {
        const next = nextTurnRef(shard);
        return { ref: next, turn: next.c };
      }
    } catch {
      // stored ref no longer decodes: continue from the passed ref
    }
  }
  return { ref: nextTurnRef(ref), turn: ref.c + 1 };
}

/**
 * Record the pair's latest ref (issued with a message that got out: delivered,
 * queued, or parked). `machines`（016①）= 本次跨机信封到达携带的 mid8→名
 * 条目，随本次写合并进分片（既有条目不覆盖语义外的丢失）。
 */
export function recordConversation(
  file: string,
  ref: ConversationRef,
  nowMs: number = Date.now(),
  machines?: Record<string, string>,
): void {
  const pairKey = pairKeyOf(ref.f, ref.t);
  const existing = readShard(shardFileOf(file, pairKey));
  // F2 柄随轮次自新：骑本次原有写顺带把同 nonce 柄刷新到最新 ref（不新增写时刻）。
  const handles = refreshHandles(existing?.handles, ref);
  const mergedMachines = machines === undefined ? existing?.machines : { ...existing?.machines, ...machines };
  savePair(file, pairKey, {
    ref: encodeRef(ref),
    updatedAt: nowMs,
    ...(Object.keys(handles).length === 0 ? {} : { handles }),
    ...(mergedMachines === undefined || Object.keys(mergedMachines).length === 0 ? {} : { machines: mergedMachines }),
  });
}

/**
 * 016①：该对话分片持久化的机器名（信封 from-machine，键=mid8）；无字段/
 * 无该键（旧状态）返回 undefined——显示层回退 mid8。
 */
export function machineNameOfPair(
  file: string | undefined,
  ref: ConversationRef,
  mid8: string,
): string | undefined {
  if (file === undefined) return undefined;
  return loadPair(file, pairKeyOf(ref.f, ref.t))?.machines?.[mid8];
}

// ---- F2 会话短柄（c<数字>）：reply-hint 的两字符本地柄 ------------------------
// 寄生会话分片零新文件；柄号本机全分片唯一分配（max+1，CAS 撞号重试一次）；
// 每分片 LRU 封顶 HANDLE_MAX（键插入序即 LRU 序，JSON 往返保序）。

export const CONVERSATION_HANDLE_RE = /^c\d+$/;
export const HANDLE_MAX = 8;

/** One live handle entry anywhere on this machine. */
interface HandleEntry {
  handle: string;
  nonce: string;
  ref: string;
  turn: number;
}

/** Every handle across every shard (broken entries skipped). */
function scanHandles(file: string): HandleEntry[] {
  const out: HandleEntry[] = [];
  for (const record of Object.values(loadAllPairs(file))) {
    for (const [handle, ref] of Object.entries(record.handles ?? {})) {
      if (!CONVERSATION_HANDLE_RE.test(handle)) continue;
      try {
        const decoded = decodeRef(ref);
        out.push({ handle, nonce: decoded.n, ref, turn: decoded.c });
      } catch {
        // undecodable leftover: ignored
      }
    }
  }
  return out;
}

function maxHandleNumber(entries: readonly HandleEntry[]): number {
  let max = 0;
  for (const entry of entries) {
    const n = Number(entry.handle.slice(1));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max;
}

/**
 * 柄表维护：newHandle 缺省（recordConversation 刷新腿）= 同 nonce 条目原地换
 * 最新 ref 并 LRU 触碰（重插到尾）；newHandle 在场（分配/CAS 改写腿）= 同
 * nonce 旧柄被新柄顶替（丢弃）。超 HANDLE_MAX 淘汰首键（最久未触碰）；
 * undecodable 条目丢弃。
 */
function refreshHandles(
  handles: Record<string, string> | undefined,
  ref: ConversationRef,
  newHandle?: string,
): Record<string, string> {
  const encoded = encodeRef(ref);
  const next: Record<string, string> = {};
  let touched: string | undefined;
  for (const [handle, value] of Object.entries(handles ?? {})) {
    if (handle === newHandle) continue;
    try {
      if (decodeRef(value).n === ref.n) {
        if (newHandle === undefined) touched = handle; // refreshed in place below
        // else: superseded by newHandle — dropped
        continue;
      }
    } catch {
      continue;
    }
    next[handle] = value;
  }
  if (touched !== undefined) next[touched] = encoded;
  if (newHandle !== undefined) next[newHandle] = encoded;
  const keys = Object.keys(next);
  if (keys.length > HANDLE_MAX) delete next[keys[0]!];
  return next;
}

/**
 * Allocation write: merges the handle into the pair's shard WITHOUT advancing
 * its conversation line (ref/updatedAt kept verbatim) — a send that later fails
 * delivery leaves --to continuation untouched.
 */
function attachHandle(file: string, pairKey: string, ref: ConversationRef, handle: string): void {
  const existing = readShard(shardFileOf(file, pairKey));
  savePair(file, pairKey, {
    ref: existing?.ref ?? encodeRef(ref),
    updatedAt: existing?.updatedAt ?? 0,
    handles: refreshHandles(existing?.handles, ref, handle),
  });
}

/**
 * The conversation's short handle: reuse the machine-wide handle already bound
 * to this nonce, else claim max+1 with CAS collision protection.
 */
export function handleForRef(file: string, ref: ConversationRef): string {
  const entries = scanHandles(file);
  const reused = entries.find((entry) => entry.nonce === ref.n);
  if (reused !== undefined) return reused.handle;
  return claimHandle(file, ref, maxHandleNumber(entries) + 1);
}

/**
 * Claim + CAS verify + one rewrite at max+2. candidate is injectable so tests
 * can simulate a scan that raced a concurrent allocator. After the single
 * retry a still-colliding number is returned as-is — resolveHandle's ambiguity
 * error (列候选) is the safety net on consumption.
 */
export function claimHandle(file: string, ref: ConversationRef, candidate: number): string {
  const pairKey = pairKeyOf(ref.f, ref.t);
  let handle = `c${candidate}`;
  attachHandle(file, pairKey, ref, handle);
  const after = scanHandles(file);
  if (after.some((entry) => entry.handle === handle && entry.nonce !== ref.n)) {
    handle = `c${maxHandleNumber(after) + 2}`;
    attachHandle(file, pairKey, ref, handle);
  }
  return handle;
}

/**
 * Resolve a short handle to its full ref by scanning every shard: exactly one
 * nonce may hold the number. Zero hits = expired/unknown; multiple = 撞号 —
 * both teach the --to continuation (过期柄的消费侧自纠).
 */
export function resolveHandle(file: string | undefined, handle: string): string {
  const hits = (file === undefined ? [] : scanHandles(file))
    .filter((entry) => entry.handle === handle)
    .sort((a, b) => b.turn - a.turn); // same nonce twice: newest ref wins
  if (hits.length > 0 && hits.every((entry) => entry.nonce === hits[0]!.nonce)) return hits[0]!.ref;
  const teach = '——用 --to <名> 接续或开新对话';
  if (hits.length === 0) {
    throw new MultichatError('INVALID_CONVERSATION_REF', `${handle} 已过期或未知${teach}`);
  }
  const candidates = [...new Set(hits.map((entry) => entry.ref))].join(' ');
  throw new MultichatError('INVALID_CONVERSATION_REF', `${handle} 撞号指向多个对话：${candidates}${teach}`);
}
