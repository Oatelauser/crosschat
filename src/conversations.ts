import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { stateRoot } from './state-root.js';
import { withStateLock } from './state-lock.js';
import type { StateLockResult } from './state-lock.js';
import { MultichatError } from './errors.js';
import { identityKey } from './identity.js';
import {
  CONVERSATION_HANDLE_RE, LEGACY_CONVERSATION_HANDLE_RE,
  handleForSequence, highestHandleSequence, isCurrentHandle, isHandleSequence, sequenceForHandle,
} from './conversation-handles.js';
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
 * global file. Only current shards are read; the retired global file is not
 * a continuity or short-handle fallback.
 */

export function defaultConversationsFile(): string {
  return join(stateRoot(), 'conversations.json');
}

export interface PairRecord {
  ref: string;
  updatedAt: number;
  /**
   * 五字符会话短柄表（cA000 -> 完整 mc1_/mc2_ ref），寄生本分片零新文件。
   * 键的插入序即 LRU 序（同 nonce 刷新会重插到尾）；生成与消费同机同版本，
   * 短柄永不过网。
   */
  handles?: Record<string, string>;
  /** Highest machine-wide allocation committed by this shard; survives LRU eviction. */
  handleSequence?: number;
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
    const parsed: unknown = JSON.parse(text);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'pair' in parsed && 'ref' in parsed && 'updatedAt' in parsed &&
      typeof parsed.pair === 'string' &&
      typeof parsed.ref === 'string' &&
      typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)
    ) {
      const rawHandles = 'handles' in parsed ? parsed.handles : undefined;
      const handles = sanitizeHandles(rawHandles);
      const machines = sanitizeMachines('machines' in parsed ? parsed.machines : undefined);
      const progress = 'handleSequence' in parsed ? parsed.handleSequence : undefined;
      if (progress !== undefined && !isHandleSequence(progress)) return undefined;
      let required = 0;
      if (rawHandles !== null && typeof rawHandles === 'object' && !Array.isArray(rawHandles)) {
        for (const handle of Object.keys(rawHandles)) required = Math.max(required, sequenceForHandle(handle) ?? 0);
      }
      if (required > (progress ?? 0)) return undefined;
      return {
        pair: parsed.pair,
        ref: parsed.ref,
        updatedAt: parsed.updatedAt,
        ...(handles === undefined ? {} : { handles }),
        ...(progress === undefined ? {} : { handleSequence: progress }),
        ...(machines === undefined ? {} : { machines }),
      };
    }
  } catch {
    // corrupt shard: self-heal as absent (isolated to this pair)
  }
  return undefined;
}

export function readConversationShard(shardFile: string): ShardRecord | undefined {
  try {
    return parseShard(readFileSync(shardFile, 'utf8'));
  } catch {
    return undefined; // missing/unreadable shard
  }
}

/** One pair's current shard; old global snapshots cannot resurrect deleted state. */
function loadPair(file: string, pairKey: string): PairRecord | undefined {
  return readConversationShard(shardFileOf(file, pairKey));
}

function savePair(file: string, pairKey: string, record: PairRecord): boolean {
  try {
    const dir = shardDirOf(file);
    mkdirSync(dir, { recursive: true });
    const shard = shardFileOf(file, pairKey);
    // Only reached inside withConversationLock, so no other process can
    // interleave its own read-modify-write with this one.
    const tmp = `${shard}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify({ pair: pairKey, ...record }), 'utf8');
      renameSync(tmp, shard);
      return true;
    } finally {
      // A failed rename must not leave this write's scratch file behind; only
      // ever this process's own uniquely named tmp, never the shard itself.
      if (existsSync(tmp)) rmSync(tmp, { force: true });
    }
  } catch {
    // ponytail: continuity is best-effort; a lost record just starts a new thread.
    return false;
  }
}

export interface ConversationState {
  pairs: Record<string, PairRecord>;
  complete: boolean;
}

/** Missing state is empty; incomplete state must never restart short-handle allocation. */
export function readConversationState(file: string): ConversationState {
  const pairs: Record<string, PairRecord> = {};
  let entries;
  try {
    entries = readdirSync(shardDirOf(file), { withFileTypes: true });
  } catch (error) {
    return { pairs, complete: error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' };
  }
  let complete = true;
  for (const entry of entries) {
    if (!entry.name.endsWith('.json') || entry.isDirectory()) continue;
    if (!entry.isFile()) { complete = false; continue; }
    const shard = readConversationShard(join(shardDirOf(file), entry.name));
    if (shard !== undefined && join(shardDirOf(file), entry.name) === shardFileOf(file, shard.pair)) pairs[shard.pair] = shard;
    else complete = false;
  }
  return { pairs, complete };
}

/** Read-only continuity inventory; callers using handles also check completeness. */
export function loadAllPairs(file: string): Record<string, PairRecord> {
  return readConversationState(file).pairs;
}

function endpointKey(endpoint: RefEndpoint): string {
  return identityKey(endpoint);
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
export async function continueFromRef(
  file: string,
  ref: ConversationRef,
  original: ConversationRef = ref,
): Promise<{ ref: ConversationRef; turn: number }> {
  const locked = await withConversationLock(file, () => continueFromRefLocked(file, ref, original));
  if (!locked.acquired) throw conversationStateBusy();
  return locked.value;
}

function continueFromRefLocked(
  file: string,
  ref: ConversationRef,
  original: ConversationRef,
): { ref: ConversationRef; turn: number } {
  ref = reconcileRefinement(file, original, ref);
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
 * Filling an unknown endpoint changes its pair key, not its conversation.
 * Keep the nonce's handle and latest turn while rejecting stale unknown refs
 * which try to replace a type already established by an earlier continuation.
 */
function reconcileRefinement(file: string, original: ConversationRef, requested: ConversationRef): ConversationRef {
  const unknown = (endpoint: RefEndpoint) => endpoint.p !== 'human' && endpoint.endpointType === undefined;
  const originalHasUnknownType = unknown(original.f) || unknown(original.t);
  const records = matchingConversationRecords(file, original);
  let refined = requested;
  for (const { refs } of records) {
    for (const ref of refs) {
      refined = { ...refined,
        f: mergeEndpointTypes(refined.f, ref.f), t: mergeEndpointTypes(refined.t, ref.t),
        c: Math.max(refined.c, ref.c),
      };
    }
  }
  const pair = pairKeyOf(refined.f, refined.t);
  const changed = records.filter((entry) => entry.pair !== pair
    && (originalHasUnknownType || Object.values(entry.record.handles ?? {}).some((value) => encodedConversationMatches(value, original))));
  if (changed.length === 0) return refined;
  // Full references still route with damaged optional handle state. Do not
  // overwrite an unreadable high-water mark while refining such a reference.
  if (!readConversationState(file).complete) return refined;
  const existing = loadPair(file, pair);
  const handles: Record<string, string> = { ...existing?.handles };
  let machines = existing?.machines;
  let updatedAt = existing?.updatedAt ?? 0;
  // Per old record: the handles actually moved into the destination shard. A
  // number already owned by another conversation in the destination is left
  // exactly as is on both sides — refinement never picks a winner for an
  // existing collision, so that handle is not migrated at all.
  const migrated = new Map<PairRecord, Set<string>>();
  for (const { record } of records) {
    if (existing === undefined) updatedAt = Math.max(updatedAt, record.updatedAt);
    machines = { ...machines, ...record.machines };
    for (const [handle, value] of Object.entries(record.handles ?? {})) {
      if (!encodedConversationMatches(value, original)) continue;
      const current = handles[handle];
      if (current !== undefined && !encodedConversationMatches(current, original)) continue;
      delete handles[handle];
      handles[handle] = encodeRef(refined);
      const moved = migrated.get(record) ?? new Set<string>();
      moved.add(handle);
      migrated.set(record, moved);
    }
  }
  // Migrated handles are the most recently touched; keep the same per-shard
  // bound before delivery, including when delivery later fails.
  for (const handle of Object.keys(handles).slice(0, -HANDLE_MAX)) delete handles[handle];
  const encoded = encodeRef(refined);
  // Like handle allocation, refinement does not advance an existing pair's
  // successful conversation line. Delivery records the new line afterwards.
  const destinationRef = existing?.ref ?? encoded;
  const handleSequence = highestHandleSequence([...(existing === undefined ? [] : [existing]), ...records.map(({ record }) => record)]);
  const saved = savePair(file, pair, { ref: destinationRef, updatedAt,
    ...(Object.keys(handles).length ? { handles } : {}),
    ...(handleSequence === 0 ? {} : { handleSequence }),
    ...(machines === undefined || Object.keys(machines).length === 0 ? {} : { machines }),
  });
  const persisted = readConversationShard(shardFileOf(file, pair));
  if (!saved || persisted?.ref !== destinationRef || (handleSequence !== 0 && persisted.handleSequence !== handleSequence)
    || Object.entries(handles).some(([handle, value]) => persisted.handles?.[handle] !== value)) {
    throw new MultichatError('CONVERSATION_STATE_WRITE_FAILED', 'Conversation refinement could not be saved; no message was sent. The original conversation handle remains valid.');
  }
  // Remove only the handles that actually moved (never a skipped conflicting
  // one) from their former pair. Other conversations and the old untyped
  // continuity line remain intact.
  for (const { pair: previous, record } of changed) {
    const moved = migrated.get(record) ?? new Set<string>();
    const remaining = Object.fromEntries(Object.entries(record.handles ?? {}).filter(([handle, value]) => {
      return !(moved.has(handle) && encodedConversationMatches(value, original));
    }));
    if (!savePair(file, previous, { ...record, handles: remaining })) {
      throw new MultichatError('CONVERSATION_STATE_WRITE_FAILED', 'Conversation refinement could not remove an old handle copy; no message was sent. The existing conversation handle remains readable.');
    }
  }
  return refined;
}

/** Read an already established type before checking an explicitly selected recipient. */
export function latestKnownConversationRef(file: string, original: ConversationRef): ConversationRef {
  let known = original;
  for (const { refs } of matchingConversationRecords(file, original)) {
    for (const stored of refs) {
      known = { ...known, f: mergeEndpointTypes(known.f, stored.f), t: mergeEndpointTypes(known.t, stored.t), c: Math.max(known.c, stored.c) };
    }
  }
  return known;
}

function matchingConversationRecords(file: string, original: ConversationRef): { pair: string; record: PairRecord; refs: ConversationRef[] }[] {
  return Object.entries(loadAllPairs(file)).flatMap(([pair, record]) => {
    const refs: ConversationRef[] = [];
    for (const encoded of [record.ref, ...Object.values(record.handles ?? {})]) {
      try {
        const ref = decodeRef(encoded);
        if (conversationRefMatches(ref, original)) refs.push(ref);
      } catch { /* Corrupt continuity never supplies a type. */ }
    }
    return refs.length === 0 ? [] : [{ pair, record, refs }];
  });
}

function conversationRefMatches(stored: ConversationRef, original: ConversationRef): boolean {
  return stored.n === original.n && stored.starId === original.starId
    && nativeEndpointMatches(stored.f, original.f) && nativeEndpointMatches(stored.t, original.t);
}

function encodedConversationMatches(encoded: string, original: ConversationRef): boolean {
  try { return conversationRefMatches(decodeRef(encoded), original); }
  catch { return false; }
}

function nativeEndpointMatches(left: RefEndpoint, right: RefEndpoint): boolean {
  return nativeEndpointContextMatches(left, right)
    && (right.p === 'human' || left.p === 'human' || right.endpointType === undefined || left.endpointType === undefined || left.endpointType === right.endpointType);
}

function nativeEndpointContextMatches(left: RefEndpoint, right: RefEndpoint): boolean {
  if (left.p === 'human' || right.p === 'human') return left.p === right.p;
  return left.p === right.p && left.id === right.id
    && left.m === right.m && left.mid === right.mid;
}

function mergeEndpointTypes(requested: RefEndpoint, stored: RefEndpoint): RefEndpoint {
  if (requested.p === 'human' || stored.p === 'human') return requested;
  if (requested.endpointType !== undefined && stored.endpointType !== undefined && requested.endpointType !== stored.endpointType) {
    throw new MultichatError('TARGET_CONFLICT', 'This conversation already has a confirmed delivery type; an older untyped reference cannot replace it.');
  }
  return { ...stored, ...requested, ...(stored.endpointType === undefined ? {} : { endpointType: stored.endpointType }) };
}

/**
 * Record the pair's latest ref (issued with a message that got out: delivered,
 * queued, or parked). `machines`（016①）= 本次跨机信封到达携带的 mid8→名
 * 条目，随本次写合并进分片（既有条目不覆盖语义外的丢失）。
 */
export async function recordConversation(
  file: string,
  ref: ConversationRef,
  nowMs: number = Date.now(),
  machines?: Record<string, string>,
): Promise<void> {
  // Runs after native delivered/queued/parked: a busy lock or failed write must
  // never turn an accepted delivery into a failure, so every outcome is swallowed.
  try {
    await withConversationLock(file, () => { recordConversationLocked(file, ref, nowMs, machines); });
  } catch {
    // best-effort continuity only
  }
}

function recordConversationLocked(
  file: string,
  ref: ConversationRef,
  nowMs: number,
  machines?: Record<string, string>,
): void {
  const pairKey = pairKeyOf(ref.f, ref.t);
  if (!readConversationState(file).complete) return;
  const existing = readConversationShard(shardFileOf(file, pairKey));
  // F2 柄随轮次自新：骑本次原有写顺带把同 nonce 柄刷新到最新 ref（不新增写时刻）。
  const handles = refreshHandles(existing?.handles, ref);
  const mergedMachines = machines === undefined ? existing?.machines : { ...existing?.machines, ...machines };
  savePair(file, pairKey, {
    ref: encodeRef(ref),
    updatedAt: nowMs,
    ...(Object.keys(handles).length === 0 ? {} : { handles }),
    ...(existing?.handleSequence === undefined ? {} : { handleSequence: existing.handleSequence }),
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

// ---- 五字符本机会话短柄：代次 + 回环槽位 ------------------------------------
// 寄生会话分片零新文件；分配进度与新柄同一次原子保存，不回收已经发出的标识；
// 每分片 LRU 封顶 HANDLE_MAX（键插入序即 LRU 序，JSON 往返保序）。

export { CONVERSATION_HANDLE_RE, LEGACY_CONVERSATION_HANDLE_RE } from './conversation-handles.js';
export const HANDLE_MAX = 8;

/** One live handle entry anywhere on this machine. */
interface HandleEntry {
  handle: string;
  nonce: string;
  pair: string;
  ref: string;
  turn: number;
}

/** Every handle across every shard (broken entries skipped). */
function scanHandles(pairs: Record<string, PairRecord>): HandleEntry[] {
  const out: HandleEntry[] = [];
  const highest = highestHandleSequence(Object.values(pairs));
  for (const record of Object.values(pairs)) {
    for (const [handle, ref] of Object.entries(record.handles ?? {})) {
      if (!isCurrentHandle(handle, highest)) continue;
      try {
        const decoded = decodeRef(ref);
        out.push({ handle, nonce: decoded.n, pair: pairKeyOf(decoded.f, decoded.t), ref, turn: decoded.c });
      } catch {
        // undecodable leftover: ignored
      }
    }
  }
  return out;
}

/** Shared read-only selection for status: stale or ambiguous bindings are never advertised. */
export function resolvableConversationHandles(pairs: Record<string, PairRecord>): ReadonlyMap<string, string> {
  const grouped = new Map<string, HandleEntry[]>();
  for (const entry of scanHandles(pairs)) {
    const group = grouped.get(entry.handle) ?? [];
    group.push(entry);
    grouped.set(entry.handle, group);
  }
  const resolved = new Map<string, string>();
  for (const [handle, entries] of grouped) {
    const ref = entries.length === 1 ? entries[0]!.ref : resolveRefinementCopies(entries);
    if (ref !== undefined) resolved.set(handle, ref);
  }
  return resolved;
}

/**
 * 柄表维护：newHandle 缺省（recordConversation 刷新腿）= 同 nonce 条目原地换
 * 最新 ref 并 LRU 触碰（重插到尾）；newHandle 在场（分配腿）= 同
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
    if (!CONVERSATION_HANDLE_RE.test(handle)) continue;
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
function attachHandle(file: string, pairKey: string, ref: ConversationRef, handle: string, handleSequence: number): boolean {
  const existing = readConversationShard(shardFileOf(file, pairKey));
  const encoded = encodeRef(ref);
  const saved = savePair(file, pairKey, {
    ref: existing?.ref ?? encoded,
    updatedAt: existing?.updatedAt ?? 0,
    handles: refreshHandles(existing?.handles, ref, handle),
    handleSequence,
    ...(existing?.machines === undefined ? {} : { machines: existing.machines }),
  });
  // Verify the persisted shard carries this binding: an unsaved handle must
  // never come back as usable.
  const persisted = readConversationShard(shardFileOf(file, pairKey));
  return saved && persisted?.handles?.[handle] === encoded && persisted.handleSequence === handleSequence;
}

/** One machine-wide lock per real state directory: every conversation write shares it. */
const CONVERSATION_LOCK_KEY = 'conversation-state';
const CONVERSATION_LOCK_TIMEOUT_MS = 1_000;

/**
 * Serialize conversation-state writes across independent CLI processes. The lock
 * identity is the canonical shard directory (path aliases and symlinks included),
 * and the OS releases it when a holder dies. Never held across native delivery:
 * callers only wrap the local read-modify-write.
 */
async function withConversationLock<T>(file: string, work: () => T): Promise<StateLockResult<T>> {
  const directory = shardDirOf(file);
  mkdirSync(directory, { recursive: true });
  return withStateLock(directory, CONVERSATION_LOCK_KEY, async () => work(), CONVERSATION_LOCK_TIMEOUT_MS);
}

function conversationStateBusy(): MultichatError {
  return new MultichatError('CONVERSATION_STATE_BUSY', 'Conversation state is locked by another crosschat process; no message was sent. Retry the send.');
}

/**
 * Reuse a safe current handle, otherwise advance the finite machine-wide ring.
 * Optional hint failures fall back to the caller's complete, routable ref.
 */
export async function handleForRef(file: string, ref: ConversationRef): Promise<string | undefined> {
  try {
    const locked = await withConversationLock(file, () => handleForRefLocked(file, ref));
    return locked.acquired ? locked.value : undefined;
  } catch {
    return undefined; // optional hint must not block an otherwise routable full ref
  }
}

function handleForRefLocked(file: string, ref: ConversationRef): string | undefined {
  const state = readConversationState(file);
  if (!state.complete) return undefined;
  const entries = scanHandles(state.pairs);
  const pair = pairKeyOf(ref.f, ref.t);
  const mine = entries.filter((entry) => entry.nonce === ref.n && entry.pair === pair);
  if (mine.length === 0) return claimHandleLocked(file, ref, highestHandleSequence(Object.values(state.pairs)) + 1);
  // 撞号 already in the user's state: reusing that number would hand out an
  // ambiguous reply hint, and rewriting it would pick a winner for two real
  // conversations. Omit the hint and leave the historical state untouched.
  return mine.find((entry) => resolvesToNonce(file, entry.handle, ref.n))?.handle;
}

function resolvesToNonce(file: string, handle: string, nonce: string): boolean {
  try {
    return decodeRef(resolveHandle(file, handle)).n === nonce;
  } catch {
    return false; // 撞号 or expired: never handed out as a hint
  }
}

/**
 * Claim at or after the requested sequence under the same machine-wide lock.
 * A stale candidate can never overwrite an issued identifier or rewind progress.
 */
export async function claimHandle(file: string, ref: ConversationRef, candidate: number): Promise<string | undefined> {
  try {
    const locked = await withConversationLock(file, () => claimHandleLocked(file, ref, candidate));
    return locked.acquired ? locked.value : undefined;
  } catch {
    return undefined;
  }
}

function claimHandleLocked(file: string, ref: ConversationRef, candidate: number): string | undefined {
  const state = readConversationState(file);
  if (!state.complete) return undefined;
  const sequence = Math.max(highestHandleSequence(Object.values(state.pairs)) + 1, candidate);
  if (!isHandleSequence(sequence)) return undefined;
  const pairKey = pairKeyOf(ref.f, ref.t);
  const handle = handleForSequence(sequence);
  if (!attachHandle(file, pairKey, ref, handle, sequence)) return undefined;
  return handle;
}

/**
 * Resolve a short handle to its full ref by scanning every shard: exactly one
 * nonce may hold the number. Zero hits = expired/unknown; multiple = 撞号 —
 * both teach the --to continuation (过期柄的消费侧自纠).
 */
export function resolveHandle(file: string | undefined, handle: string): string {
  const teach = '——用 --to <名> --tool <收件类型> 接续或开新对话';
  if (LEGACY_CONVERSATION_HANDLE_RE.test(handle)) {
    throw new MultichatError('INVALID_CONVERSATION_REF', `${handle} 是旧版会话短柄，已停用${teach}`);
  }
  const state = file === undefined ? { pairs: {}, complete: true } : readConversationState(file);
  if (!state.complete) throw new MultichatError('INVALID_CONVERSATION_REF', `短柄状态无法完整核验，请使用完整会话引用${teach}`);
  const hits = scanHandles(state.pairs)
    .filter((entry) => entry.handle === handle)
    .sort((a, b) => b.turn - a.turn); // same nonce twice: newest ref wins
  if (hits.length === 1) return hits[0]!.ref;
  const refined = resolveRefinementCopies(hits);
  if (refined !== undefined) return refined;
  if (hits.length === 0) {
    throw new MultichatError('INVALID_CONVERSATION_REF', `${handle} 已过期或未知${teach}`);
  }
  const candidates = [...new Set(hits.map((entry) => entry.ref))].join(' ');
  throw new MultichatError('INVALID_CONVERSATION_REF', `${handle} 撞号指向多个对话：${candidates}${teach}`);
}

/** A failed old-shard cleanup may leave only compatible untyped/typed copies. */
function resolveRefinementCopies(entries: readonly HandleEntry[]): string | undefined {
  if (entries.length === 0) return undefined;
  let known = decodeRef(entries[0]!.ref);
  for (const entry of entries.slice(1)) {
    const ref = decodeRef(entry.ref);
    if (ref.n !== known.n || ref.starId !== known.starId
      || !nativeEndpointContextMatches(ref.f, known.f) || !nativeEndpointContextMatches(ref.t, known.t)) return undefined;
    try {
      known = { ...known, f: mergeEndpointTypes(known.f, ref.f), t: mergeEndpointTypes(known.t, ref.t), c: Math.max(known.c, ref.c) };
    } catch { return undefined; /* Different known endpoints still constitute a collision. */ }
  }
  return encodeRef(known);
}
