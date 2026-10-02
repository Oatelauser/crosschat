import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { MultichatError } from './errors.js';
import { checkAndRecord, rateKey } from './rate-limit.js';

/**
 * Opportunistic outbox (B10): when a codex delivery fails with
 * CODEX_THREAD_BUSY_TIMEOUT / CODEX_THREAD_LOCKED, the fully composed envelope
 * is parked on disk (one JSON file per thread under
 * %LOCALAPPDATA%/crosschat/outbox/) and re-delivered verbatim by the next
 * send/status invocation. No daemon; drains are short-wait and never block
 * the invoking command for long.
 */

export const OUTBOX_MAX_PER_THREAD = 20;

export interface OutboxItem {
  /** Fully composed delivery content (envelope incl. reply-ref); reused verbatim on drain. */
  envelope: string;
  toName: string;
  /** Caller identity key at park time ("claude:<id>" / "codex:<id>" / "human"); rebuilds the rate-limit pair on drain. */
  callerKey?: string;
  parkedAt: number;
  attempts: number;
}

interface OutboxFile {
  items: OutboxItem[];
}

export interface DrainResult {
  threadId: string;
  /** Display name of the most recently delivered item (falls back to threadId). */
  toName: string;
  delivered: number;
  remaining: number;
  /** Parked items discarded this round because the thread no longer exists. */
  dropped: number;
}

export type DrainDeliverFn = (
  threadId: string,
  content: string,
  busyTimeoutMs: number,
) => Promise<unknown>;

/** Short wait for drains: opportunistic relief must not block the real command. */
const DEFAULT_DRAIN_BUSY_TIMEOUT_MS = 5_000;
/** B11: a drain round re-delivers at most this many items (rest waits for the next round). */
const DEFAULT_DRAIN_MAX_ITEMS = 5;
/** B11: wall-clock budget for one drain round, judged on the injected clock. */
const DEFAULT_DRAIN_BUDGET_MS = 15_000;

export function defaultOutboxDir(): string {
  return join(process.env.LOCALAPPDATA ?? homedir(), 'crosschat', 'outbox');
}

/** Append one parked item (FIFO); refuses honestly past the per-thread cap. */
export function park(
  dir: string,
  threadId: string,
  item: Pick<OutboxItem, 'envelope' | 'toName' | 'callerKey'>,
  nowMs: number = Date.now(),
): OutboxItem {
  const items = readItems(dir, threadId) ?? []; // missing/corrupt: self-heal as empty
  if (items.length >= OUTBOX_MAX_PER_THREAD) {
    throw new MultichatError(
      'OUTBOX_FULL',
      `Outbox full for codex thread ${threadId} (${OUTBOX_MAX_PER_THREAD} parked). ` +
        `线程疑似已死：改投其它线程，或人工清理 ${threadFile(dir, threadId)}。`,
    );
  }
  const parked = { ...item, parkedAt: nowMs, attempts: 0 };
  writeItems(dir, threadId, [...items, parked]);
  return parked;
}

export interface DrainOpts {
  busyTimeoutMs?: number;
  /** B11: max deliver-fn invocations per round (default 5); the rest waits for the next round. */
  maxItems?: number;
  /** B11: wall-clock budget for the whole round in ms (default 15s, judged on the injected clock). */
  budgetMs?: number;
  /** Injected clock (tests); also feeds the rate limiter. */
  now?(): number;
  /**
   * B11: rate-limit dir. When given, every re-delivery passes checkAndRecord
   * against the parked caller key (same limiter state as send) and a full
   * window skips the item for this round.
   */
  rateDir?: string;
}

/**
 * Try parked items once, in FIFO order, under a per-round budget. Success
 * removes the item; a still busy/locked thread keeps it with attempts+1;
 * CODEX_THREAD_NOT_FOUND dead-letters the whole thread (deleted threads are
 * unreachable forever); any other error keeps the item for a later drain.
 * Never throws (corrupt files are skipped, a missing dir is a no-op), so it
 * can run before any command without failing it.
 */
export async function drain(
  dir: string,
  deliverFn: DrainDeliverFn,
  opts: DrainOpts = {},
): Promise<DrainResult[]> {
  const busyTimeoutMs = opts.busyTimeoutMs ?? DEFAULT_DRAIN_BUSY_TIMEOUT_MS;
  const maxItems = opts.maxItems ?? DEFAULT_DRAIN_MAX_ITEMS;
  const budgetMs = opts.budgetMs ?? DEFAULT_DRAIN_BUDGET_MS;
  const now = opts.now ?? Date.now;
  const deadline = now() + budgetMs;
  let allowance = maxItems;
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return []; // no outbox yet: nothing parked anywhere
  }
  const results: DrainResult[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const threadId = file.slice(0, -'.json'.length);
    const items = readItems(dir, threadId);
    if (items === undefined) continue; // missing/corrupt: leave the file alone
    const remaining: OutboxItem[] = [];
    let delivered = 0;
    let dropped = 0;
    let deliveredName = '';
    for (const item of items) {
      if (allowance <= 0 || now() >= deadline) {
        remaining.push(item); // round budget exhausted: keep verbatim for the next drain
        continue;
      }
      if (opts.rateDir !== undefined) {
        try {
          checkAndRecord(opts.rateDir, rateKey(item.callerKey ?? 'human', `codex:${threadId}`), now());
        } catch (err) {
          if (err instanceof MultichatError && err.code === 'RATE_LIMITED') {
            remaining.push(item); // window full: skip this round, retry next drain
            continue;
          }
          throw err;
        }
      }
      allowance -= 1;
      try {
        await deliverFn(threadId, item.envelope, busyTimeoutMs);
        delivered++;
        deliveredName = item.toName;
      } catch (err) {
        if (err instanceof MultichatError && err.code === 'CODEX_THREAD_NOT_FOUND') {
          // Dead letter: the thread is gone, so every parked item for it is
          // unreachable — discard all of them, not just this one.
          dropped = items.length - delivered;
          remaining.length = 0;
          break;
        }
        if (
          err instanceof MultichatError &&
          (err.code === 'CODEX_THREAD_BUSY_TIMEOUT' || err.code === 'CODEX_THREAD_LOCKED')
        ) {
          // ponytail: attempts grows unbounded; cap/age-out if a stuck thread ever floods the file.
          remaining.push({ ...item, attempts: item.attempts + 1 });
        } else {
          remaining.push(item); // unknown state: keep, try again next drain
        }
      }
    }
    const changed =
      remaining.length !== items.length || remaining.some((item, i) => item !== items[i]);
    if (changed) writeItems(dir, threadId, remaining);
    if (delivered > 0 || remaining.length > 0 || dropped > 0) {
      results.push({
        threadId,
        toName: deliveredName || items.at(-1)?.toName || threadId,
        delivered,
        remaining: remaining.length,
        dropped,
      });
    }
  }
  return results;
}

/** Parked item count per thread (doctor display); corrupt/empty files are skipped. */
export function outboxSummary(dir: string): { threadId: string; count: number }[] {
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const summary: { threadId: string; count: number }[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const threadId = file.slice(0, -'.json'.length);
    const items = readItems(dir, threadId);
    if (items !== undefined && items.length > 0) summary.push({ threadId, count: items.length });
  }
  return summary;
}

function threadFile(dir: string, threadId: string): string {
  return join(dir, `${threadId}.json`);
}

function readItems(dir: string, threadId: string): OutboxItem[] | undefined {
  try {
    const parsed = JSON.parse(readFileSync(threadFile(dir, threadId), 'utf8')) as OutboxFile;
    return Array.isArray(parsed.items) ? parsed.items : undefined;
  } catch {
    return undefined;
  }
}

/** Atomic write (tmp+rename); an emptied outbox deletes its file. */
function writeItems(dir: string, threadId: string, items: OutboxItem[]): void {
  const file = threadFile(dir, threadId);
  if (items.length === 0) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(dir, { recursive: true });
  // ponytail: no cross-process locking; two concurrent drains can double-deliver
  // one item — rare and downstream-idempotent enough; add a lockfile if it bites.
  const tmp = join(dir, `${threadId}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, JSON.stringify({ items } satisfies OutboxFile), 'utf8');
  renameSync(tmp, file);
}
