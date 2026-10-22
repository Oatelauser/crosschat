import { closeSync, fstatSync, mkdirSync, openSync, readSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { appendWithRotate } from './log-rotate.js';
import { stateRoot } from './state-root.js';
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
  return join(stateRoot(), 'send-log.jsonl');
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
  /** Target-bound digest of the exact transmitted envelope; never stores its body. */
  receiptMarker?: string;
}

/** Same evidence is used by the initial probe and a later status recheck. */
export function createReceiptMarker(threadId: string, envelope: string): string {
  return `sha256:${createHash('sha256').update(threadId).update('\0').update(envelope).digest('hex')}`;
}

export function appendSendLog(file: string, entry: SendLogEntry): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    // 014: 封顶改为轮转（超 5MB 挪 .old）——不再原地截断，历史整份留在 .old。
    appendWithRotate(file, `${JSON.stringify(entry)}\n`);
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
 * Poll the recipient thread's rollout until a decoded user message has the
 * exact target-bound envelope digest. The short reply handle is reusable and
 * the full reply-ref is not in the transmitted envelope. The rollout
 * write can lag turn/start acceptance by a moment, hence the short retry.
 * Never throws; 'unconfirmed' means "not seen within the budget", not "lost".
 */
export async function confirmInRollout(
  codexHome: string,
  threadId: string,
  marker: string,
  opts: ConfirmOpts = {},
): Promise<'confirmed' | 'unconfirmed'> {
  if (!/^sha256:[0-9a-f]{64}$/.test(marker)) return 'unconfirmed';
  const tries = opts.tries ?? 5;
  const delayMs = opts.delayMs ?? 300;
  for (let attempt = 0; attempt < tries; attempt++) {
    const file = findRolloutFile(codexHome, threadId);
    if (file !== undefined && fileContainsReceipt(file, threadId, marker)) return 'confirmed';
    await sleep(delayMs);
  }
  return 'unconfirmed';
}

/** Tail window the conversation summaries (status batch B0) ever parse; never a full scan. */
export const SEND_LOG_TAIL_LINES = 200;

/**
 * Last ~maxLines entries, read backwards from the end (stat the size, then
 * 64KB chunks like the receipt scanner below) so a large log costs a bounded read.
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

/** Bound each decoded record while streaming; unrelated large tool output is skipped. */
const MAX_RECEIPT_RECORD_CHARS = 4 * 1024 * 1024;

function fileContainsReceipt(path: string, threadId: string, marker: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
  } catch {
    return false;
  }
  try {
    const buf = Buffer.alloc(64 * 1024);
    const decoder = new StringDecoder('utf8');
    let carry = '';
    let oversized = false;
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) return false; // a partial final JSON line is not persisted receipt evidence
      const text = decoder.write(buf.subarray(0, n));
      let start = 0;
      for (;;) {
        const end = text.indexOf('\n', start);
        if (end === -1) break;
        if (!oversized && carry.length + end - start <= MAX_RECEIPT_RECORD_CHARS &&
            lineConfirms(carry + text.slice(start, end), threadId, marker)) return true;
        carry = '';
        oversized = false;
        start = end + 1;
      }
      if (!oversized) {
        carry += text.slice(start);
        if (carry.length > MAX_RECEIPT_RECORD_CHARS) {
          carry = '';
          oversized = true;
        }
      }
    }
  } catch {
    return false;
  } finally {
    closeSync(fd);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function lineConfirms(line: string, threadId: string, marker: string): boolean {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return false;
  }
  if (!isRecord(record) || !isRecord(record.payload)) return false;
  const payload = record.payload;
  if (record.type === 'event_msg' && payload.type === 'user_message' && typeof payload.message === 'string') {
    return createReceiptMarker(threadId, payload.message) === marker;
  }
  if (record.type !== 'response_item' || payload.type !== 'message' || payload.role !== 'user' ||
      !Array.isArray(payload.content)) return false;
  return payload.content.some((part: unknown) => isRecord(part) &&
    (part.type === 'input_text' || part.type === 'text') && typeof part.text === 'string' &&
    createReceiptMarker(threadId, part.text) === marker);
}
