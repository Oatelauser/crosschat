import { MultichatError } from './errors.js';
import { pairKeyOfEntry } from './conversations.js';
import { readSendLogTail, type SendLogEntry } from './send-log.js';

/**
 * Anti-ping-pong rate limit (tickets 003/004): max 30 messages per endpoint
 * pair per 60s sliding window. 014 蒸发：不再自建 `rate/<hash>.json` 计数
 * 文件（与 send-log 双重记账），计数改读 send-log 尾窗——同一份条目既审计
 * 又限流。检查只读：本次 send 的条目在投递结局后落账，未来检查才数它
 * （串行语义与旧"先记数后投递"一致）。
 */

export const RATE_LIMIT_MAX = 30;
export const RATE_WINDOW_MS = 60_000;
/** 限流数数的尾窗行数（status 视图的 200 行界独立存在，互不影响）。 */
export const RATE_TAIL_LINES = 500;

/**
 * Count the pair's in-window entries in an already-read tail, or throw
 * RATE_LIMITED at the cap. Pair attribution shares pairKeyOfEntry (from+
 * target, else replyRef decode) — the same logic the conversations view uses.
 */
export function checkRateLimit(tail: SendLogEntry[], from: string, target: string, nowMs: number): void {
  // shortcut: 尾窗 500 行被全机高频挤占时计数偏低、限流偏松——持续 8 条/秒才触达，可接受
  const key = [from, target].sort().join('\n');
  let count = 0;
  let oldest: number | undefined;
  for (const entry of tail) {
    if (pairKeyOfEntry(entry) !== key) continue;
    const ts = Date.parse(entry.ts);
    if (!Number.isFinite(ts) || ts <= nowMs - RATE_WINDOW_MS) continue;
    count++;
    if (oldest === undefined || ts < oldest) oldest = ts;
  }
  if (count >= RATE_LIMIT_MAX) {
    const retryInSec = Math.max(1, Math.ceil(((oldest ?? nowMs) + RATE_WINDOW_MS - nowMs) / 1000));
    throw new MultichatError(
      'RATE_LIMITED',
      `Rate limit hit: ${RATE_LIMIT_MAX} messages per ${RATE_WINDOW_MS / 1000}s are allowed per endpoint pair. Retry in ~${retryInSec}s.`,
    );
  }
}

/** File-bound wrapper: one bounded tail read, then the pure check. */
export function checkSendLogRate(
  sendLogFile: string,
  from: string,
  target: string,
  nowMs: number = Date.now(),
): void {
  checkRateLimit(readSendLogTail(sendLogFile, RATE_TAIL_LINES), from, target, nowMs);
}
