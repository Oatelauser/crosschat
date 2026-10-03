import { appendFileSync, closeSync, mkdirSync, openSync, readSync } from 'node:fs';
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
