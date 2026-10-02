import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { MultichatError } from './errors.js';

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
}

export type DrainDeliverFn = (
  threadId: string,
  content: string,
  busyTimeoutMs: number,
) => Promise<unknown>;

/** Short wait for drains: opportunistic relief must not block the real command. */
const DEFAULT_DRAIN_BUSY_TIMEOUT_MS = 5_000;

export function defaultOutboxDir(): string {
  return join(process.env.LOCALAPPDATA ?? homedir(), 'crosschat', 'outbox');
}

/** Append one parked item (FIFO); refuses honestly past the per-thread cap. */
export function park(
  dir: string,
  threadId: string,
  item: Pick<OutboxItem, 'envelope' | 'toName'>,
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

/**
 * Try every parked item once, in FIFO order. Success removes the item; a still
 * busy/locked thread keeps it with attempts+1; any other error keeps it for a
 * later drain. Never throws (corrupt files are skipped, a missing dir is a
 * no-op), so it can run before any command without failing it.
 */
export async function drain(
  dir: string,
  deliverFn: DrainDeliverFn,
  opts: { busyTimeoutMs?: number } = {},
): Promise<DrainResult[]> {
  const busyTimeoutMs = opts.busyTimeoutMs ?? DEFAULT_DRAIN_BUSY_TIMEOUT_MS;
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
    let deliveredName = '';
    for (const item of items) {
      try {
        await deliverFn(threadId, item.envelope, busyTimeoutMs);
        delivered++;
        deliveredName = item.toName;
      } catch (err) {
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
    if (delivered > 0 || remaining.length > 0) {
      results.push({
        threadId,
        toName: deliveredName || items.at(-1)?.toName || threadId,
        delivered,
        remaining: remaining.length,
      });
    }
  }
  return results;
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
