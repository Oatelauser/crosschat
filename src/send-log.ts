import { appendFileSync, closeSync, fstatSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { findRolloutFile } from './codex/rollout-meta.js';

/**
 * Sender-side send log (B14, F4): every send's final outcome is appended as
 * one JSON line so a delivery whose CLI invocation already returned (tool
 * timeout → background continuation) stays observable after the fact, and a
 * codex delivery is confirmed against the target's rollout file — turning
 * "delivered" from "the server accepted the turn" into "the message is
 * verifiably in the recipient's conversation history". Metadata only; no
 * message bodies are ever written here.
 */

export function defaultSendLogFile(): string {
  return join(process.env.LOCALAPPDATA ?? homedir(), 'crosschat', 'send-log.jsonl');
}

export interface SendLogEntry {
  /** ISO timestamp of the outcome. */
  ts: string;
  /** Sender identity key ("claude:<id>" / "codex:<id>" / "human"); audit needs who, not just whom. */
  from?: string;
  /**
   * Display name of the sender (B21): recorded at the source so the
   * conversations view can render the sender by name before the peer has
   * ever replied (only a reply's `to` carried a sender name before).
   * Absent on pre-B21 entries; readers must fall back to `from`.
   */
  fromName?: string;
  /** Display name of the recipient. */
  to: string;
  /** 'claude:<sessionId>' | 'codex:<threadId>'. */
  target: string;
  status: 'delivered' | 'queued' | 'parked' | 'failed';
  turn?: number;
  replyRef?: string;
  /** Error code when status === 'failed'. */
  code?: string;
  /** Rollout confirmation for codex deliveries; absent = not attempted. */
  receipt?: 'confirmed' | 'unconfirmed';
}

export function appendSendLog(file: string, entry: SendLogEntry): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
    capSendLog(file);
  } catch {
    // ponytail: observability must never break the send itself.
  }
}

/**
 * Cap the log so it cannot grow forever (2026-10-06 audit): once it passes
 * MAX bytes, rewrite it as the last ~KEEP bytes of whole lines. Best-effort
 * like everything here — a torn rewrite at worst costs corrupt lines the
 * tail reader already skips. Only fires past the cap: the under-cap append
 * path is byte-identical to before.
 */
const SEND_LOG_MAX_BYTES = 5 * 1024 * 1024;
const SEND_LOG_KEEP_BYTES = 1024 * 1024;

function capSendLog(file: string): void {
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return;
  }
  if (size <= SEND_LOG_MAX_BYTES) return;
  try {
    const keep = Math.min(SEND_LOG_KEEP_BYTES, size);
    let tail: Buffer;
    const fd = openSync(file, 'r');
    try {
      const buf = Buffer.alloc(keep);
      readSync(fd, buf, 0, keep, size - keep);
      tail = buf.subarray(buf.indexOf(0x0a) + 1); // drop the leading partial line
    } finally {
      closeSync(fd);
    }
    writeFileSync(file, tail);
  } catch {
    // ponytail: observability must never break the send itself.
  }
}

export interface ConfirmOpts {
  tries?: number;
  delayMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll the recipient thread's rollout file until the marker (the unique
 * reply-ref embedded in every envelope) shows up — the receipt. The rollout
 * write can lag turn/start acceptance by a moment, hence the short retry.
 * Never throws; 'unconfirmed' means "not seen within the budget", not "lost".
 */
export async function confirmInRollout(
  codexHome: string,
  threadId: string,
  marker: string,
  opts: ConfirmOpts = {},
): Promise<'confirmed' | 'unconfirmed'> {
  const tries = opts.tries ?? 5;
  const delayMs = opts.delayMs ?? 300;
  for (let attempt = 0; attempt < tries; attempt++) {
    const file = findRolloutFile(codexHome, threadId);
    if (file !== undefined && fileContains(file, marker)) return 'confirmed';
    await sleep(delayMs);
  }
  return 'unconfirmed';
}

/** Tail window the conversation summaries (status batch B0) ever parse; never a full scan. */
export const SEND_LOG_TAIL_LINES = 200;

/**
 * Last ~maxLines entries, read backwards from the end (stat the size, then
 * 64KB chunks like fileContains below) so a large log costs a bounded read.
 * The window's first line is dropped as a fragment when the cut landed
 * mid-line; unparsable lines are skipped — the log is best-effort anyway.
 * Missing file → empty; never throws.
 */
export function readSendLogTail(file: string, maxLines: number = SEND_LOG_TAIL_LINES): SendLogEntry[] {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
  } catch {
    return [];
  }
  try {
    const size = fstatSync(fd).size;
    const parts: Buffer[] = [];
    let pos = size;
    let newlines = 0;
    while (pos > 0 && newlines <= maxLines) {
      const len = Math.min(64 * 1024, pos);
      pos -= len;
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, pos);
      parts.unshift(buf);
      // 0x0A never appears inside a multi-byte UTF-8 sequence: byte count = line count.
      for (const byte of buf) if (byte === 0x0a) newlines++;
    }
    let lines = Buffer.concat(parts).toString('utf8').split('\n');
    if (pos > 0) lines = lines.slice(1); // window cut the first line mid-line
    const entries: SendLogEntry[] = [];
    for (const line of lines) {
      if (line.trim() === '') continue;
      try {
        entries.push(JSON.parse(line) as SendLogEntry);
      } catch {
        // corrupt line: skip
      }
    }
    return entries.slice(-maxLines);
  } catch {
    return [];
  } finally {
    closeSync(fd);
  }
}

/** Chunked substring scan; carries a tail so a marker spanning chunks is found. */
function fileContains(path: string, marker: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
  } catch {
    return false;
  }
  try {
    const buf = Buffer.alloc(64 * 1024);
    let carry = '';
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) return false;
      const text = carry + buf.subarray(0, n).toString('utf8');
      if (text.includes(marker)) return true;
      carry = text.slice(Math.max(0, text.length - marker.length));
    }
  } catch {
    return false;
  } finally {
    closeSync(fd);
  }
}
