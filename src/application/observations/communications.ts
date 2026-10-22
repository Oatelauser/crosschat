import { lstat, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { aggregateSummaries } from '../../conversation-summary.js';
import { pairKeyOf, pairKeyOfEntry } from '../../conversations.js';
import type { PairAttribution } from '../../conversations.js';
import { decodeRef } from '../../ref.js';
import type { ConversationRef, RefEndpoint } from '../../ref.js';
import type { SendLogEntry } from '../../send-log.js';
import { queryLogTail } from '../queries/logs.js';
import type { CollectionResult } from '../queries/services.js';
import { checkAbort, isRecord, queryError } from '../queries/reading.js';
import type { QueryError, QueryOptions } from '../queries/reading.js';
import type { SessionRef } from '../sessions/model.js';

export interface CommunicationQueryOptions extends QueryOptions {
  baseDir: string;
  contextId: string;
  /** Each JSON file is bounded independently; oversized sources remain explicit partial rows. */
  maxFileBytes?: number;
  /** A recent audit window, independent of the complete persisted conversation-pair inventory. */
  auditMaxBytes?: number;
  auditMaxLines?: number;
  localMachineId?: string;
  localHostname?: string;
}

export interface OutboxItemMetadata {
  id: string;
  parkedAt: number;
  attempts: number;
  toName: string;
  callerKey?: string;
  deliveryMode?: string;
  deliveryState?: string;
}

export interface OutboxThreadMetadata {
  id: string;
  contextId: string;
  providerId: string;
  threadId: string;
  toName: string | null;
  /** null means the source could not be counted; it never means an empty queue. */
  count: number | null;
  oldestParkedAt: number | null;
  mailboxFile: string;
  state: 'ready' | 'unreadable' | 'malformed' | 'oversized';
  items: OutboxItemMetadata[];
}

export interface CommunicationSummary {
  id: string;
  contextId: string;
  pairId: string;
  endpoints: [string, string];
  names: [string, string];
  /** Existing persisted, decodable full reference only; no short handle allocation. */
  ref: string | null;
  updatedAt: number;
  channel: 'local' | 'ssh' | 'tcp' | 'unknown';
  turn: number | null;
  status: string | null;
  receipt: string | null;
  /** Only endpoints with positive local ownership evidence; names and id8 never establish it. */
  localSessionRefs: SessionRef[];
  /** null means at least one queue source could not be counted safely. */
  parked: number | null;
}

export type CommunicationsResult = CollectionResult<CommunicationSummary>;
export type OutboxMetadataResult = CollectionResult<OutboxThreadMetadata>;

export interface OutboxCounts {
  threads: number;
  /** null when any present source has unknown size. */
  items: number | null;
}

type PairRecord = { ref: string; updatedAt: number; handles?: Record<string, string> };
interface JsonRead { value?: unknown; state: 'ready' | 'missing' | 'unreadable' | 'malformed' | 'oversized'; error?: QueryError }
const JSON_LIMIT = 2 * 1024 * 1024;
function boundedNumber(value: number | undefined, fallback: number, maximum: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
}
function issue(source: string, message: string, kind: QueryError['kind'] = 'malformed'): QueryError {
  return { source, kind, message, nextStep: '核对该来源与访问权限后按 r 重新读取；本界面不会修复或重发。' };
}
function complete<T>(items: T[], errors: QueryError[], observedAt: number): CollectionResult<T> {
  return { items, errors, observedAt, completeness: errors.length === 0 ? 'complete' : items.length ? 'partial' : 'unavailable' };
}
function cancelled<T>(source: string, observedAt: number): CollectionResult<T> {
  return { items: [], observedAt, completeness: 'cancelled', errors: [issue(source, '读取已取消。', 'cancelled')] };
}

/** Bounded snapshots own every handle; stored payloads and arbitrary parser errors never leave here. */
async function jsonFile(file: string, options: CommunicationQueryOptions): Promise<JsonRead> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    checkAbort(options.signal);
    const previous = await lstat(file);
    checkAbort(options.signal);
    if (!previous.isFile() || previous.isSymbolicLink()) return { state: 'unreadable', error: issue(file, '来源不是普通文件，不读取链接或特殊文件。', 'unavailable') };
    const maximum = boundedNumber(options.maxFileBytes, JSON_LIMIT, JSON_LIMIT);
    if (previous.size > maximum) return { state: 'oversized', error: issue(file, `来源超过 ${maximum} 字节读取上限，条数未知。`, 'unavailable') };
    handle = await open(file, 'r');
    checkAbort(options.signal);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.ino !== previous.ino || stat.dev !== previous.dev) return { state: 'unreadable', error: issue(file, '来源读取期间被替换，请刷新核实。', 'unavailable') };
    if (stat.size > maximum) return { state: 'oversized', error: issue(file, `来源超过 ${maximum} 字节读取上限，条数未知。`, 'unavailable') };
    const buffer = Buffer.alloc(stat.size);
    let position = 0;
    while (position < buffer.length) {
      checkAbort(options.signal);
      const { bytesRead } = await handle.read(buffer, position, Math.min(64 * 1024, buffer.length - position), position);
      if (!bytesRead) break;
      position += bytesRead;
    }
    checkAbort(options.signal);
    try { const value: unknown = JSON.parse(buffer.subarray(0, position).toString('utf8')); return { state: 'ready', value }; }
    catch { return { state: 'malformed', error: issue(file, '来源不是有效的元数据 JSON。') }; }
  } catch (error) {
    checkAbort(options.signal);
    const errorIssue = queryError(file, error);
    return errorIssue.kind === 'missing' ? { state: 'missing' } : { state: 'unreadable', error: errorIssue };
  } finally { await handle?.close(); }
}

async function files(directory: string, options: CommunicationQueryOptions, errors: QueryError[]): Promise<string[]> {
  try {
    checkAbort(options.signal);
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) { errors.push(issue(directory, '来源目录不是普通目录，不读取链接或特殊文件。', 'unavailable')); return []; }
    const entries = await readdir(directory, { withFileTypes: true });
    checkAbort(options.signal);
    return entries.filter((entry) => entry.name.endsWith('.json')).map((entry) => entry.name).sort();
  } catch (error) {
    checkAbort(options.signal);
    const errorIssue = queryError(directory, error);
    if (errorIssue.kind !== 'missing') errors.push(errorIssue);
    return [];
  }
}

function queueItem(input: unknown): OutboxItemMetadata | undefined {
  if (!isRecord(input) || typeof input.id !== 'string' || !input.id || typeof input.toName !== 'string'
    || typeof input.parkedAt !== 'number' || !Number.isFinite(input.parkedAt) || input.parkedAt < 0
    || typeof input.attempts !== 'number' || !Number.isSafeInteger(input.attempts) || input.attempts < 0
    || (input.callerKey !== undefined && typeof input.callerKey !== 'string')
    || (input.deliveryMode !== undefined && typeof input.deliveryMode !== 'string')
    || (input.deliveryState !== undefined && typeof input.deliveryState !== 'string')) return undefined;
  return { id: input.id, toName: input.toName, parkedAt: input.parkedAt, attempts: input.attempts,
    ...(typeof input.callerKey === 'string' ? { callerKey: input.callerKey } : {}),
    ...(typeof input.deliveryMode === 'string' ? { deliveryMode: input.deliveryMode } : {}),
    ...(typeof input.deliveryState === 'string' ? { deliveryState: input.deliveryState } : {}) };
}

/** Queue observation never claims items, probes workers, parses envelopes or initiates delivery. */
export async function queryOutbox(options: CommunicationQueryOptions): Promise<OutboxMetadataResult> {
  const observedAt = (options.now ?? Date.now)();
  const directory = join(options.baseDir, 'outbox');
  const items: OutboxThreadMetadata[] = [];
  const errors: QueryError[] = [];
  try {
    for (const name of await files(directory, options, errors)) {
      checkAbort(options.signal);
      const threadId = name.slice(0, -5);
      if (!threadId || threadId === '.' || threadId === '..' || /[/\\:]/.test(threadId)) { errors.push(issue(join(directory, name), '滞留文件名不能表示安全的完整线程 ID。')); continue; }
      const read = await jsonFile(join(directory, name), options);
      const metadata: OutboxThreadMetadata = { id: JSON.stringify([options.contextId, 'codex', threadId]), contextId: options.contextId, providerId: 'codex', threadId,
        toName: null, count: null, oldestParkedAt: null, mailboxFile: join(options.baseDir, 'mailbox', `${threadId}.md`), state: read.state === 'ready' || read.state === 'missing' ? 'unreadable' : read.state, items: [] };
      if (read.error) errors.push(read.error);
      if (read.state === 'missing') errors.push(issue(join(directory, name), '滞留来源在读取前消失，请刷新核实。', 'unavailable'));
      if (read.state === 'ready') {
        if (!isRecord(read.value) || !Array.isArray(read.value.items)) {
          metadata.state = 'malformed'; errors.push(issue(join(directory, name), '滞留来源缺少有效的条目列表。'));
        } else {
          metadata.items = read.value.items.flatMap((input: unknown) => { const value = queueItem(input); return value ? [value] : []; });
          if (metadata.items.length !== read.value.items.length || new Set(metadata.items.map((entry) => entry.id)).size !== metadata.items.length) {
            metadata.state = 'malformed'; errors.push(issue(join(directory, name), '滞留条目元数据不完整或 ID 重复，条数未知。'));
          } else { metadata.state = 'ready'; metadata.count = metadata.items.length; }
          metadata.toName = metadata.items.at(-1)?.toName ?? null;
          metadata.oldestParkedAt = metadata.count === null || metadata.count === 0 ? null : Math.min(...metadata.items.map((entry) => entry.parkedAt));
        }
      }
      if (metadata.count !== 0) items.push(metadata);
    }
    checkAbort(options.signal);
    return complete(items, errors, observedAt);
  } catch (error) { return options.signal?.aborted ? cancelled(directory, observedAt) : complete(items, [...errors, queryError(directory, error)], observedAt); }
}

export function summarizeOutbox(items: readonly OutboxThreadMetadata[]): OutboxCounts {
  return { threads: items.length, items: items.some((item) => item.count === null) ? null : items.reduce((total, item) => total + (item.count ?? 0), 0) };
}

function pairRecord(pairId: string, input: unknown): PairRecord | undefined {
  if (pairId.split('\n').length !== 2 || pairId.split('\n').some((endpoint) => !endpoint) || !isRecord(input)
    || typeof input.ref !== 'string' || typeof input.updatedAt !== 'number' || !Number.isFinite(input.updatedAt) || input.updatedAt < 0) return undefined;
  const handles = isRecord(input.handles) ? Object.fromEntries(Object.entries(input.handles).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : undefined;
  return { ref: input.ref, updatedAt: input.updatedAt, ...(handles ? { handles } : {}) };
}

function savedRef(value: string, pairId: string): ConversationRef | undefined {
  try { const ref = decodeRef(value); return pairKeyOf(ref.f, ref.t) === pairId ? ref : undefined; }
  catch { return undefined; }
}

function normalizeAttribution(input: PairAttribution): PairAttribution {
  const entry = { ...input };
  if (entry.target.startsWith('via:')) {
    try {
      if (!entry.replyRef) throw new Error('Missing routed reference.');
      const ref = decodeRef(entry.replyRef);
      const identity = (endpoint: RefEndpoint) => endpoint.p === 'human' ? 'human' : `${endpoint.p}:${endpoint.id}`;
      const endpoints = [identity(ref.f), identity(ref.t)];
      if (entry.from !== undefined && endpoints.includes(entry.from)) entry.target = endpoints.find((endpoint) => endpoint !== entry.from) ?? entry.target;
      else { delete entry.from; entry.target = ''; }
    } catch { delete entry.from; entry.target = ''; }
  }
  return entry;
}

/** Shared metadata association; routed transport markers never become native session identities. */
export function communicationPairId(entry: PairAttribution): string | undefined {
  return pairKeyOfEntry(normalizeAttribution(entry));
}

function auditEntry(input: unknown): SendLogEntry | undefined {
  if (!isRecord(input) || typeof input.ts !== 'string' || !Number.isFinite(Date.parse(input.ts)) || typeof input.to !== 'string' || typeof input.target !== 'string'
    || (input.status !== 'delivered' && input.status !== 'queued' && input.status !== 'parked' && input.status !== 'failed')) return undefined;
  const entry: SendLogEntry = { ts: input.ts, to: input.to, target: input.target, status: input.status,
    ...(typeof input.from === 'string' ? { from: input.from } : {}), ...(typeof input.fromName === 'string' ? { fromName: input.fromName } : {}),
    ...(typeof input.replyRef === 'string' ? { replyRef: input.replyRef } : {}),
    ...(typeof input.turn === 'number' && Number.isSafeInteger(input.turn) && input.turn > 0 ? { turn: input.turn } : {}),
    ...(input.receipt === 'confirmed' || input.receipt === 'unconfirmed' ? { receipt: input.receipt } : {}), ...(typeof input.code === 'string' ? { code: input.code } : {}) };
  const attributed = normalizeAttribution(entry);
  if (attributed.from === undefined) delete entry.from;
  else entry.from = attributed.from;
  entry.target = attributed.target;
  return entry;
}

function localRefs(ref: ConversationRef | undefined, options: CommunicationQueryOptions): SessionRef[] {
  if (!ref) return [];
  return [ref.f, ref.t].flatMap((endpoint): SessionRef[] => {
    if (endpoint.p === 'human') return [];
    const local = endpoint.mid !== undefined ? options.localMachineId !== undefined && endpoint.mid === options.localMachineId
      : endpoint.m !== undefined ? options.localHostname !== undefined && endpoint.m === options.localHostname : true;
    return local ? [{ contextId: options.contextId, providerId: endpoint.p, nativeId: endpoint.id }] : [];
  });
}

/** Persisted pair inventory plus a declared recent audit window; no receipt rechecks or writes. */
export async function queryCommunications(options: CommunicationQueryOptions): Promise<CommunicationsResult> {
  const observedAt = (options.now ?? Date.now)();
  const errors: QueryError[] = [];
  const pairs = new Map<string, PairRecord>();
  try {
    checkAbort(options.signal);
    const legacyFile = join(options.baseDir, 'conversations.json');
    const legacy = await jsonFile(legacyFile, options);
    if (legacy.error) errors.push(legacy.error);
    if (legacy.state === 'ready') {
      if (!isRecord(legacy.value) || !isRecord(legacy.value.pairs)) errors.push(issue(legacyFile, '通信索引缺少有效的 pairs 元数据。'));
      else for (const [key, value] of Object.entries(legacy.value.pairs)) {
        const parsed = pairRecord(key, value);
        if (parsed) pairs.set(key, parsed); else errors.push(issue(legacyFile, '通信索引包含无法核验的完整通信对。'));
      }
    }
    const directory = join(options.baseDir, 'conversations');
    for (const name of await files(directory, options, errors)) {
      const file = join(directory, name);
      const read = await jsonFile(file, options);
      if (read.error) errors.push(read.error);
      if (read.state !== 'ready') continue;
      const pairId = isRecord(read.value) && typeof read.value.pair === 'string' ? read.value.pair : '';
      const parsed = pairRecord(pairId, read.value);
      if (parsed) pairs.set(pairId, parsed); else errors.push(issue(file, '通信分片缺少有效的完整通信对或采样时间。'));
    }
    const auditFile = join(options.baseDir, 'send-log.jsonl');
    const tail = await queryLogTail({ file: auditFile, maxBytes: boundedNumber(options.auditMaxBytes, 256 * 1024, JSON_LIMIT), signal: options.signal, now: options.now });
    checkAbort(options.signal);
    if (tail.state !== 'ready' && tail.state !== 'missing') errors.push(...tail.errors);
    const lines = boundedNumber(options.auditMaxLines, 200, 2000);
    if (tail.truncated || tail.lines.length > lines) errors.push(issue(auditFile, `投递审计仅展示最近 ${lines} 行的有界窗口，较早状态不在此次读取范围。`, 'unavailable'));
    const audit: SendLogEntry[] = [];
    for (const line of tail.lines.slice(-lines)) {
      try { const input: unknown = JSON.parse(line); const entry = auditEntry(input); if (!entry) throw new Error('Invalid audit metadata.'); audit.push(entry); }
      catch { errors.push(issue(auditFile, '投递审计含无法解析的元数据行，已保留其他有效记录。')); }
    }
    const outbox = await queryOutbox(options);
    checkAbort(options.signal);
    errors.push(...outbox.errors);
    const parked = new Map<string, number>();
    for (const thread of outbox.items) for (const item of thread.items) {
      const pairId = [item.callerKey ?? 'human', `codex:${thread.threadId}`].sort().join('\n');
      parked.set(pairId, (parked.get(pairId) ?? 0) + 1);
    }
    const unknownQueue = outbox.completeness !== 'complete' || outbox.items.some((item) => item.count === null);
    const summaries = aggregateSummaries(Object.fromEntries(pairs), audit, parked);
    const items = summaries.map((summary): CommunicationSummary => {
      const pairId = summary.endpoints.join('\n');
      const ref = savedRef(summary.ref, pairId);
      if (!ref) errors.push(issue(join(options.baseDir, 'conversations'), '已保存通信引用无法核对完整端点；仍展示元数据，不提供续话复制。'));
      return { id: JSON.stringify([options.contextId, pairId]), contextId: options.contextId, pairId, endpoints: summary.endpoints, names: summary.pair,
        ref: ref ? summary.ref : null, updatedAt: summary.updatedAt, channel: ref ? ref.starId !== undefined ? 'tcp' : [ref.f, ref.t].some((endpoint) => endpoint.p !== 'human' && (endpoint.m !== undefined || endpoint.mid !== undefined)) ? 'ssh' : 'local' : 'unknown',
        turn: summary.turn, status: summary.lastStatus, receipt: summary.receipt ?? null, parked: unknownQueue ? null : summary.parked, localSessionRefs: localRefs(ref, options) };
    });
    return complete(items, errors, observedAt);
  } catch (error) { return options.signal?.aborted ? cancelled(options.baseDir, observedAt) : complete([], [...errors, queryError(options.baseDir, error)], observedAt); }
}
