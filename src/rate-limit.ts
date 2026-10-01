import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { MultichatError } from './errors.js';

/**
 * File-based anti-ping-pong rate limit (tickets 003/004): max 30 messages per
 * endpoint pair per 60s sliding window. State lives in one JSON file per pair
 * under %LOCALAPPDATA%/multichat/rate/, replaced atomically via tmp+rename.
 */

export const RATE_LIMIT_MAX = 30;
export const RATE_WINDOW_MS = 60_000;

/** Stable file key for a pair of identity keys ("claude:<id>" / "codex:<id>" / "human"). */
export function rateKey(a: string, b: string): string {
  const pair = [a, b].sort().join('\n');
  return createHash('sha256').update(pair, 'utf8').digest('hex');
}

export function defaultRateDir(): string {
  return join(process.env.LOCALAPPDATA ?? homedir(), 'multichat', 'rate');
}

/**
 * Record one message for the pair, or throw RATE_LIMITED when the window is
 * full. Check and record are one step so a rejected message never writes.
 */
export function checkAndRecord(dir: string, key: string, nowMs: number = Date.now()): void {
  const file = join(dir, `${key}.json`);
  let sends: number[] = [];
  try {
    sends = JSON.parse(readFileSync(file, 'utf8')) as number[];
    if (!Array.isArray(sends)) sends = [];
  } catch {
    // Missing or corrupt file: treat as an empty window and self-heal on write.
  }
  sends = sends.filter((ts) => typeof ts === 'number' && ts > nowMs - RATE_WINDOW_MS);
  if (sends.length >= RATE_LIMIT_MAX) {
    const retryInSec = Math.max(1, Math.ceil((sends[0] + RATE_WINDOW_MS - nowMs) / 1000));
    throw new MultichatError(
      'RATE_LIMITED',
      `Rate limit hit: ${RATE_LIMIT_MAX} messages per ${RATE_WINDOW_MS / 1000}s are allowed per endpoint pair. Retry in ~${retryInSec}s.`,
    );
  }
  sends.push(nowMs);
  mkdirSync(dir, { recursive: true });
  // ponytail: no cross-process locking; a torn write self-heals as an empty window.
  const tmp = join(dir, `${key}.${process.pid}.${nowMs}.tmp`);
  writeFileSync(tmp, JSON.stringify(sends), 'utf8');
  renameSync(tmp, file);
}
