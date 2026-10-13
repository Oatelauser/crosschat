/** 014 限流蒸发：计数改读 send-log 尾窗（纯函数 checkRateLimit + 文件腿 checkSendLogRate）。 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { checkRateLimit, checkSendLogRate, RATE_LIMIT_MAX, RATE_WINDOW_MS } from '../src/rate-limit.js';
import { appendSendLog, type SendLogEntry } from '../src/send-log.js';
import { MultichatError } from '../src/errors.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-rate-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const NOW = 1_800_000_000_000;

function entry(from: string, target: string, tsMs: number): SendLogEntry {
  return { ts: new Date(tsMs).toISOString(), from, to: 'peer', target, status: 'delivered' };
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable(`should have thrown ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(MultichatError);
    expect((err as MultichatError).code).toBe(code);
  }
}

describe('checkRateLimit tail-window counting', () => {
  it('throws RATE_LIMITED when the window holds the cap, passes one short of it', () => {
    const from = 'claude:s1';
    const target = 'codex:t1';
    expect(() => checkRateLimit([], from, target, NOW)).not.toThrow();
    const short = Array.from({ length: RATE_LIMIT_MAX - 1 }, (_, i) => entry(from, target, NOW - i * 100));
    expect(() => checkRateLimit(short, from, target, NOW)).not.toThrow(); // 29: still room
    const full = Array.from({ length: RATE_LIMIT_MAX }, (_, i) => entry(from, target, NOW - i * 100));
    expectCode(() => checkRateLimit(full, from, target, NOW), 'RATE_LIMITED');
  });

  it('counts entries of this pair only — other pairs never accumulate', () => {
    const from = 'claude:s1';
    const tail: SendLogEntry[] = [];
    for (let i = 0; i < RATE_LIMIT_MAX + 10; i++) tail.push(entry('claude:other', 'codex:t1', NOW));
    for (let i = 0; i < RATE_LIMIT_MAX; i++) tail.push(entry(from, 'codex:unrelated', NOW));
    expect(() => checkRateLimit(tail, from, 'codex:t1', NOW)).not.toThrow();
  });

  it('expires entries past the 60s window boundary', () => {
    const from = 'claude:s1';
    const target = 'codex:t1';
    const stale = Array.from({ length: RATE_LIMIT_MAX }, (_, i) => entry(from, target, NOW - RATE_WINDOW_MS - i * 100));
    expect(() => checkRateLimit(stale, from, target, NOW)).not.toThrow();
    // one fresh entry on top of the stale pile: the old ones do not count
    expect(() => checkRateLimit([...stale, entry(from, target, NOW)], from, target, NOW)).not.toThrow();
    const fresh = Array.from({ length: RATE_LIMIT_MAX }, (_, i) => entry(from, target, NOW - i * 100));
    expectCode(() => checkRateLimit(fresh, from, target, NOW), 'RATE_LIMITED');
  });

  it('pair key is order-independent: (A→B) counts for (B→A) attribution', () => {
    const tail = Array.from({ length: RATE_LIMIT_MAX }, (_, i) => entry('claude:s1', 'codex:t1', NOW - i * 100));
    expectCode(() => checkRateLimit(tail, 'codex:t1', 'claude:s1', NOW), 'RATE_LIMITED');
  });

  it('RATE_LIMITED teaching text is byte-stable (regression anchor)', () => {
    // all entries at ts=NOW → oldest sits exactly one full window away → Retry in ~60s
    const tail = Array.from({ length: RATE_LIMIT_MAX }, () => entry('human', 'claude:s9', NOW));
    try {
      checkRateLimit(tail, 'human', 'claude:s9', NOW);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(MultichatError);
      expect((err as MultichatError).message).toBe(
        `Rate limit hit: ${RATE_LIMIT_MAX} messages per ${RATE_WINDOW_MS / 1000}s are allowed per endpoint pair. Retry in ~60s.`,
      );
    }
  });
});

describe('checkSendLogRate file leg', () => {
  it('reads the pair window from a real send-log file; missing file = empty window', () => {
    const dir = mkdtempSync(join(root, 'case-'));
    const file = join(dir, 'send-log.jsonl');
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      appendSendLog(file, entry('claude:s1', 'codex:t1', NOW - i * 100));
    }
    expectCode(() => checkSendLogRate(file, 'claude:s1', 'codex:t1', NOW), 'RATE_LIMITED');
    expect(() => checkSendLogRate(file, 'claude:s1', 'codex:t2', NOW)).not.toThrow();
    expect(() => checkSendLogRate(join(dir, 'missing.jsonl'), 'claude:s1', 'codex:t1', NOW)).not.toThrow();
  });
});
