import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { randomBytes } from 'node:crypto';
import { MultichatError } from './errors.js';
import { checkAndRecord, rateKey } from './rate-limit.js';

/**
 * Opportunistic outbox (B10/B11, reworked B12): when a codex delivery fails
 * with CODEX_THREAD_BUSY_TIMEOUT / CODEX_THREAD_LOCKED, the fully composed
 * envelope is parked on disk (one JSON file per thread under
 * %LOCALAPPDATA%/crosschat/outbox/) and re-delivered verbatim by the next
 * send/status invocation or by the detached watchdog loop (src/watchdog.ts).
 *
 * B12 invariants, learned from the 2026-10-02 incident:
 * - busy/locked is a THREAD-level state: one failing attempt aborts the whole
 *   thread for this round instead of burning the budget on guaranteed failures
 *   (the old loop starved queue tails to attempts=0 for 12h).
 * - new sends join the queue instead of jumping it (enforced in send.ts).
 * - every parked/delivered/dropped item is mirrored into a human-readable
 *   mailbox file so stuck content is always readable.
 * - park/drain mutations take a per-thread lockfile so the watchdog and CLI
 *   drains cannot lose items by racing read-modify-write cycles.
 */

export const OUTBOX_MAX_PER_THREAD = 200;

export interface OutboxItem {
  /** Stable id used for mailbox markers and locked removal. */
  id: string;
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
/** Per-thread lockfile staleness; a crashed holder is stolen after this. */
const LOCK_STALE_MS = 60_000;

export function defaultOutboxDir(): string {
  return join(process.env.LOCALAPPDATA ?? homedir(), 'crosschat', 'outbox');
}

/** Mailbox mirror lives next to the outbox root (sibling "mailbox" directory). */
export function mailboxDirFor(outboxDir: string): string {
  return join(outboxDir, '..', 'mailbox');
}

export function mailboxFileFor(outboxDir: string, threadId: string): string {
  return join(mailboxDirFor(outboxDir), `${threadId}.md`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function genId(nowMs: number): string {
  return `${nowMs.toString(36)}-${randomBytes(3).toString('hex')}`;
}

function isoOf(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

/** Append one parked item (FIFO); refuses honestly past the per-thread cap. */
export function park(
  dir: string,
  threadId: string,
  item: Pick<OutboxItem, 'envelope' | 'toName' | 'callerKey'>,
  nowMs: number = Date.now(),
  mailboxDir: string = mailboxDirFor(dir),
): OutboxItem {
  // Best-effort lock: a contended park falls through lockless (ms-scale window,
  // same risk as pre-B12) rather than blocking the sending command.
  const locked = acquireThreadLock(dir, threadId, Date.now());
  try {
    const items = readItems(dir, threadId) ?? []; // missing/corrupt: self-heal as empty
    if (items.length >= OUTBOX_MAX_PER_THREAD) {
      throw new MultichatError(
        'OUTBOX_FULL',
        `Outbox full for codex thread ${threadId} (${OUTBOX_MAX_PER_THREAD} parked). ` +
          `对方线程持续忙或已死：读 ${join(mailboxDir, `${threadId}.md`)} 取回内容，` +
          `或确认线程仍存在后重发。`,
      );
    }
    const parked: OutboxItem = { ...item, id: genId(nowMs), parkedAt: nowMs, attempts: 0 };
    writeItems(dir, threadId, [...items, parked]);
    appendMailbox(
      mailboxDir,
      threadId,
      `\n## ${parked.id} 寄存 ${isoOf(nowMs)}（队列第 ${items.length + 1} 位）\n${parked.envelope}\n`,
    );
    return parked;
  } finally {
    if (locked) releaseThreadLock(dir, threadId);
  }
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
  /** Mailbox mirror dir (defaults to the sibling of the outbox dir). */
  mailboxDir?: string;
}

/**
 * Deliver parked items head-first, one at a time: each delivery re-reads the
 * file under the thread lock and removes exactly the delivered id, so a
 * concurrent park is never lost. A busy/locked failure aborts the thread for
 * this round (the state is thread-level); CODEX_THREAD_NOT_FOUND dead-letters
 * the whole thread; any other error skips just that item for this round.
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
  const mailboxDir = opts.mailboxDir ?? mailboxDirFor(dir);
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
    // Items to ignore for the rest of this round (rate-window full, unknown
    // delivery error): kept verbatim, retried by the next round.
    const skipIds = new Set<string>();
    let delivered = 0;
    let dropped = 0;
    let toName = '';
    for (;;) {
      if (allowance <= 0 || now() >= deadline) break;
      const head = await withThreadLock(dir, threadId, 2_000, () => {
        const items = readItems(dir, threadId);
        if (items === undefined || items.length === 0) return undefined;
        const item = items.find((candidate) => !skipIds.has(candidate.id));
        return item === undefined ? undefined : { item };
      });
      if (head === undefined) break;
      toName = head.item.toName;
      if (opts.rateDir !== undefined) {
        try {
          checkAndRecord(opts.rateDir, rateKey(head.item.callerKey ?? 'human', `codex:${threadId}`), now());
        } catch (err) {
          if (err instanceof MultichatError && err.code === 'RATE_LIMITED') {
            skipIds.add(head.item.id); // window full: skip this round, retry next drain
            continue;
          }
          throw err;
        }
      }
      allowance -= 1;
      try {
        await deliverFn(threadId, head.item.envelope, busyTimeoutMs);
        delivered++;
        appendMailbox(mailboxDir, threadId, `> ${head.item.id} 送达 ${isoOf(now())}\n`);
        await withThreadLock(dir, threadId, 2_000, () => {
          removeById(dir, threadId, head.item.id);
        });
      } catch (err) {
        if (err instanceof MultichatError && err.code === 'CODEX_THREAD_NOT_FOUND') {
          // Dead letter: the thread is gone, so every parked item for it is
          // unreachable — discard all of them, not just this one.
          const removed = (await withThreadLock(dir, threadId, 2_000, () => {
            const items = readItems(dir, threadId) ?? [];
            writeItems(dir, threadId, []);
            return items.length;
          })) ?? 0;
          dropped += removed;
          appendMailbox(mailboxDir, threadId, `> 线程已不存在，丢弃 ${removed} 条（${isoOf(now())}）\n`);
          break;
        }
        if (
          err instanceof MultichatError &&
          (err.code === 'CODEX_THREAD_BUSY_TIMEOUT' || err.code === 'CODEX_THREAD_LOCKED')
        ) {
          // Thread-level state: everything after the head would fail too.
          await withThreadLock(dir, threadId, 2_000, () => {
            bumpAttempts(dir, threadId, head.item.id);
          });
          break;
        }
        skipIds.add(head.item.id); // unknown state: keep, try again next drain
      }
    }
    const remaining = countItems(dir, threadId);
    if (delivered > 0 || remaining > 0 || dropped > 0) {
      results.push({
        threadId,
        toName: toName || shortThread(threadId),
        delivered,
        remaining,
        dropped,
      });
    }
  }
  return results;
}

/** Parked item count + oldest age per thread (doctor display); corrupt files are skipped. */
export function outboxSummary(dir: string): { threadId: string; count: number; oldestParkedAt?: number }[] {
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const summary: { threadId: string; count: number; oldestParkedAt?: number }[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const threadId = file.slice(0, -'.json'.length);
    const items = readItems(dir, threadId);
    if (items !== undefined && items.length > 0) {
      summary.push({
        threadId,
        count: items.length,
        oldestParkedAt: Math.min(...items.map((item) => item.parkedAt)),
      });
    }
  }
  return summary;
}

/** Queue depth for one thread (0 when nothing is parked). */
export function outboxCount(dir: string, threadId: string): number {
  return readItems(dir, threadId)?.length ?? 0;
}

function shortThread(threadId: string): string {
  return `codex/${threadId.slice(0, 8)}`;
}

function threadFile(dir: string, threadId: string): string {
  return join(dir, `${threadId}.json`);
}

function lockFile(dir: string, threadId: string): string {
  return join(dir, `${threadId}.lock`);
}

function readItems(dir: string, threadId: string): OutboxItem[] | undefined {
  try {
    const parsed = JSON.parse(readFileSync(threadFile(dir, threadId), 'utf8')) as OutboxFile;
    if (!Array.isArray(parsed.items)) return undefined;
    // Pre-B12 files carry no id: synthesize a stable one from parkedAt+index.
    return parsed.items.map((item, index) =>
      item.id === undefined ? { ...item, id: `${item.parkedAt.toString(36)}-${index.toString(36)}` } : item,
    );
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
  const tmp = join(dir, `${threadId}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, JSON.stringify({ items } satisfies OutboxFile), 'utf8');
  renameSync(tmp, file);
}

function removeById(dir: string, threadId: string, id: string): void {
  const items = readItems(dir, threadId);
  if (items === undefined) return;
  writeItems(dir, threadId, items.filter((item) => item.id !== id));
}

function bumpAttempts(dir: string, threadId: string, id: string): void {
  const items = readItems(dir, threadId);
  if (items === undefined) return;
  writeItems(
    dir,
    threadId,
    items.map((item) => (item.id === id ? { ...item, attempts: item.attempts + 1 } : item)),
  );
}

function countItems(dir: string, threadId: string): number {
  return readItems(dir, threadId)?.length ?? 0;
}

function appendMailbox(mailboxDir: string, threadId: string, text: string): void {
  try {
    mkdirSync(mailboxDir, { recursive: true });
    appendFileSync(join(mailboxDir, `${threadId}.md`), text, 'utf8');
  } catch {
    // ponytail: the mirror is best-effort observability; outbox json stays authoritative.
  }
}

function acquireThreadLock(dir: string, threadId: string, nowMs: number): boolean {
  const file = lockFile(dir, threadId);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openExclusive(file);
      writeSyncClose(fd, `${process.pid} ${nowMs}`);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return false;
      try {
        const [, ts] = readFileSync(file, 'utf8').trim().split(/\s+/);
        const written = Number(ts);
        if (Number.isFinite(written) && nowMs - written > LOCK_STALE_MS) {
          rmSync(file, { force: true }); // steal a crashed holder's lock
          continue;
        }
      } catch {
        return false;
      }
      return false;
    }
  }
  return false;
}

function releaseThreadLock(dir: string, threadId: string): void {
  rmSync(lockFile(dir, threadId), { force: true });
}

/** Run fn under the per-thread lock, waiting up to waitMs; undefined = never ran. */
async function withThreadLock<T>(
  dir: string,
  threadId: string,
  waitMs: number,
  fn: () => T,
): Promise<T | undefined> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    if (acquireThreadLock(dir, threadId, Date.now())) {
      try {
        return fn();
      } finally {
        releaseThreadLock(dir, threadId);
      }
    }
    if (Date.now() >= deadline) return undefined;
    await sleep(25);
  }
}

// fs.open with "wx" lives behind openSync's flag form; keep it tiny and local.
function openExclusive(file: string): number {
  return openSync(file, 'wx');
}

function writeSyncClose(fd: number, text: string): void {
  try {
    writeSync(fd, text, null, 'utf8');
  } finally {
    closeSync(fd);
  }
}
