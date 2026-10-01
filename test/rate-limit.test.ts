import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { checkAndRecord, rateKey, RATE_LIMIT_MAX } from '../src/rate-limit.js';
import { MultichatError } from '../src/errors.js';

const dir = mkdtempSync(join(tmpdir(), 'multichat-rate-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable(`should have thrown ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(MultichatError);
    expect((err as MultichatError).code).toBe(code);
  }
}

describe('rateKey', () => {
  it('is order-independent and stable', () => {
    expect(rateKey('claude:a', 'codex:b')).toBe(rateKey('codex:b', 'claude:a'));
    expect(rateKey('claude:a', 'codex:b')).not.toBe(rateKey('claude:a', 'codex:c'));
  });
});

describe('checkAndRecord sliding window', () => {
  it('fills the window, throws RATE_LIMITED, then frees up as time passes', () => {
    const key = rateKey('claude:s1', 'codex:t1');
    const file = join(dir, `${key}.json`);
    let now = 1_000_000;

    for (let i = 0; i < RATE_LIMIT_MAX; i++) checkAndRecord(dir, key, now);
    expect(JSON.parse(readFileSync(file, 'utf8')) as number[]).toHaveLength(RATE_LIMIT_MAX);

    expectCode(() => checkAndRecord(dir, key, now), 'RATE_LIMITED');
    expectCode(() => checkAndRecord(dir, key, now + 10_000), 'RATE_LIMITED');
    // Rejected sends must not extend the window.
    expect(JSON.parse(readFileSync(file, 'utf8')) as number[]).toHaveLength(RATE_LIMIT_MAX);

    now += 61_000; // entire window expired
    checkAndRecord(dir, key, now);
    expect(JSON.parse(readFileSync(file, 'utf8')) as number[]).toHaveLength(1);
  });

  it('keeps separate buckets per endpoint pair', () => {
    const now = 5_000_000;
    for (let i = 0; i < RATE_LIMIT_MAX; i++) checkAndRecord(dir, rateKey('claude:s1', 'codex:t1'), now);
    expectCode(() => checkAndRecord(dir, rateKey('claude:s1', 'codex:t1'), now), 'RATE_LIMITED');
    checkAndRecord(dir, rateKey('claude:s1', 'codex:t2'), now); // different pair: unaffected
  });

  it('prunes only expired entries within the 60s window', () => {
    const key = rateKey('human', 'claude:s9');
    checkAndRecord(dir, key, 100_000);
    checkAndRecord(dir, key, 140_000);
    checkAndRecord(dir, key, 170_000); // 100_000 is now 70s old, the others are not
    const sends = JSON.parse(readFileSync(join(dir, `${key}.json`), 'utf8')) as number[];
    expect(sends).toEqual([140_000, 170_000]);
  });

  it('self-heals a corrupt rate file', () => {
    const key = rateKey('claude:corrupt', 'codex:t');
    writeFileSync(join(dir, `${key}.json`), 'not json at all', 'utf8');
    checkAndRecord(dir, key, 200_000);
    expect(JSON.parse(readFileSync(join(dir, `${key}.json`), 'utf8')) as number[]).toEqual([200_000]);
  });
});
