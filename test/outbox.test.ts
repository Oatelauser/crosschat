import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  drain,
  OUTBOX_MAX_PER_THREAD,
  outboxCount,
  park,
  type DrainDeliverFn,
  type OutboxItem,
} from '../src/outbox.js';
import { MultichatError } from '../src/errors.js';
import { checkAndRecord, rateKey, RATE_LIMIT_MAX } from '../src/rate-limit.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-outbox-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// Fresh dir per test: drain() sweeps the whole directory, so shared files
// would leak between tests.
const freshDir = (): string => mkdtempSync(join(root, 'case-'));

const busy = (code = 'CODEX_THREAD_BUSY_TIMEOUT') => new MultichatError(code, 'still busy');
const ok: DrainDeliverFn = async () => undefined;

function itemsOf(dir: string, threadId: string): OutboxItem[] {
  return (JSON.parse(readFileSync(join(dir, `${threadId}.json`), 'utf8')) as { items: OutboxItem[] })
    .items;
}

/** Matches an item ignoring the generated id. */
const sansId = (envelope: string, toName: string, parkedAt: number, attempts: number) => ({
  envelope,
  toName,
  parkedAt,
  attempts,
  id: expect.any(String) as string,
});

describe('park', () => {
  it('appends FIFO with id/parkedAt/attempts and persists the composed envelope', () => {
    const dir = freshDir();
    park(dir, 't-park', { envelope: 'env-1', toName: 'alpha' }, 1_000);
    park(dir, 't-park', { envelope: 'env-2', toName: 'alpha' }, 2_000);
    expect(itemsOf(dir, 't-park')).toEqual([
      sansId('env-1', 'alpha', 1_000, 0),
      sansId('env-2', 'alpha', 2_000, 0),
    ]);
  });

  it('keeps threads in separate files', () => {
    const dir = freshDir();
    park(dir, 't-a', { envelope: 'env-1', toName: 'alpha' }, 1_000);
    park(dir, 't-b', { envelope: 'env-2', toName: 'beta' }, 2_000);
    expect(itemsOf(dir, 't-a')).toHaveLength(1);
    expect(itemsOf(dir, 't-b')).toHaveLength(1);
  });

  it('refuses honestly at the per-thread cap and leaves the file untouched', () => {
    const dir = freshDir();
    for (let i = 0; i < OUTBOX_MAX_PER_THREAD; i++) {
      park(dir, 't-full', { envelope: `env-${i}`, toName: 'gamma' }, 4_000 + i);
    }
    expect(itemsOf(dir, 't-full')).toHaveLength(OUTBOX_MAX_PER_THREAD);
    try {
      park(dir, 't-full', { envelope: 'env-21', toName: 'gamma' }, 9_000);
      expect.unreachable('should have thrown OUTBOX_FULL');
    } catch (err) {
      expect(err).toBeInstanceOf(MultichatError);
      expect((err as MultichatError).code).toBe('OUTBOX_FULL');
    }
    expect(itemsOf(dir, 't-full')).toHaveLength(OUTBOX_MAX_PER_THREAD);
  });

  it('writes atomically: no tmp leftovers next to the final file', () => {
    const dir = freshDir();
    park(dir, 't-atomic', { envelope: 'env', toName: 'delta' });
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(existsSync(join(dir, 't-atomic.json'))).toBe(true);
  });

  it('self-heals a corrupt file as an empty outbox', () => {
    const dir = freshDir();
    writeFileSync(join(dir, 't-corrupt.json'), 'not json', 'utf8');
    park(dir, 't-corrupt', { envelope: 'env', toName: 'alpha' }, 7_000);
    expect(itemsOf(dir, 't-corrupt')).toEqual([sansId('env', 'alpha', 7_000, 0)]);
  });

  it('mirrors every parked item into the mailbox file', () => {
    const dir = freshDir();
    const mailbox = freshDir();
    park(dir, 't-mirror', { envelope: 'env-1', toName: 'alpha' }, 1_000, mailbox);
    park(dir, 't-mirror', { envelope: 'env-2', toName: 'alpha' }, 2_000, mailbox);
    const mirror = readFileSync(join(mailbox, 't-mirror.md'), 'utf8');
    expect(mirror).toContain('寄存');
    expect(mirror).toContain('env-1');
    expect(mirror).toContain('env-2');
    expect(mirror).toContain('队列第 1 位');
    expect(mirror).toContain('队列第 2 位');
  });
});

describe('drain', () => {
  it('delivers FIFO, removes drained items, deletes the file once empty', async () => {
    const dir = freshDir();
    park(dir, 't-drain', { envelope: 'd-1', toName: 'alpha' });
    park(dir, 't-drain', { envelope: 'd-2', toName: 'alpha' });
    const seen: Array<[string, string, number]> = [];
    const results = await drain(dir, async (threadId, content, busyTimeoutMs) => {
      seen.push([threadId, content, busyTimeoutMs]);
    });
    expect(seen).toEqual([
      ['t-drain', 'd-1', 5_000],
      ['t-drain', 'd-2', 5_000],
    ]);
    expect(results).toEqual([
      { threadId: 't-drain', toName: 'alpha', delivered: 2, remaining: 0, dropped: 0 },
    ]);
    expect(existsSync(join(dir, 't-drain.json'))).toBe(false);
  });

  it('passes a custom short busyTimeoutMs through to the deliver fn', async () => {
    const dir = freshDir();
    park(dir, 't-timeout', { envelope: 'x', toName: 'alpha' });
    const timeouts: number[] = [];
    await drain(dir, async (_id, _c, busyTimeoutMs) => timeouts.push(busyTimeoutMs), {
      busyTimeoutMs: 250,
    });
    expect(timeouts).toEqual([250]);
  });

  it('aborts the thread on the first busy/locked failure: only the head gains attempts (B12)', async () => {
    const dir = freshDir();
    park(dir, 't-busy', { envelope: 'b-1', toName: 'alpha' }, 1_000);
    park(dir, 't-busy', { envelope: 'b-2', toName: 'alpha' }, 2_000);
    const results = await drain(dir, async () => {
      throw busy('CODEX_THREAD_LOCKED');
    });
    expect(results).toEqual([
      { threadId: 't-busy', toName: 'alpha', delivered: 0, remaining: 2, dropped: 0 },
    ]);
    // Busy is thread-level: item 2 would fail identically, so the round must
    // not burn budget on it (the pre-B12 loop attempted everything it could
    // and starved long queues).
    expect(itemsOf(dir, 't-busy')).toEqual([
      sansId('b-1', 'alpha', 1_000, 1),
      sansId('b-2', 'alpha', 2_000, 0),
    ]);
  });

  it('keeps items unchanged on any other delivery error', async () => {
    const dir = freshDir();
    park(dir, 't-uncertain', { envelope: 'u-1', toName: 'alpha' }, 5_000);
    const results = await drain(dir, async () => {
      throw new MultichatError('CODEX_WRITE_UNCERTAIN', 'unknown state');
    });
    expect(results).toEqual([
      { threadId: 't-uncertain', toName: 'alpha', delivered: 0, remaining: 1, dropped: 0 },
    ]);
    expect(itemsOf(dir, 't-uncertain')).toEqual([sansId('u-1', 'alpha', 5_000, 0)]);
  });

  it('marks delivered items in the mailbox mirror', async () => {
    const dir = freshDir();
    const mailbox = freshDir();
    park(dir, 't-marked', { envelope: 'm-1', toName: 'alpha' }, 1_000, mailbox);
    await drain(dir, ok, { mailboxDir: mailbox });
    const mirror = readFileSync(join(mailbox, 't-marked.md'), 'utf8');
    expect(mirror).toMatch(/> [0-9a-z-]+ 送达 /);
  });

  it('retries a previously busy item successfully on the next drain', async () => {
    const dir = freshDir();
    park(dir, 't-retry', { envelope: 'r-1', toName: 'alpha' });
    let failOnce = true;
    await drain(dir, async () => {
      if (failOnce) {
        failOnce = false;
        throw busy();
      }
    });
    expect(itemsOf(dir, 't-retry')).toHaveLength(1);
    await drain(dir, ok);
    expect(existsSync(join(dir, 't-retry.json'))).toBe(false);
  });

  it('is a no-op when the outbox dir does not exist', async () => {
    const results = await drain(join(root, 'never-created'), ok);
    expect(results).toEqual([]);
  });

  it('skips a corrupt outbox file without deleting it', async () => {
    const dir = freshDir();
    park(dir, 't-ok', { envelope: 'fine', toName: 'alpha' });
    writeFileSync(join(dir, 't-corrupt.json'), 'not json', 'utf8');
    const results = await drain(dir, ok);
    expect(results).toEqual([
      { threadId: 't-ok', toName: 'alpha', delivered: 1, remaining: 0, dropped: 0 },
    ]);
    expect(existsSync(join(dir, 't-corrupt.json'))).toBe(true);
  });
});

describe('drain rate limiting, budget, dead letters (B11)', () => {
  it('parks the caller identity key alongside the envelope', () => {
    const dir = freshDir();
    park(dir, 't-key', { envelope: 'env', toName: 'alpha', callerKey: 'claude:s-1' }, 1_000);
    expect(itemsOf(dir, 't-key')).toEqual([
      { ...sansId('env', 'alpha', 1_000, 0), callerKey: 'claude:s-1' },
    ]);
  });

  it('skips an item whose rate window is full, keeping it verbatim for the next round', async () => {
    const dir = freshDir();
    const rateDir = freshDir();
    park(dir, 't-rate', { envelope: 'r-1', toName: 'alpha', callerKey: 'claude:s-1' }, 1_000);
    const key = rateKey('claude:s-1', 'codex:t-rate');
    for (let i = 0; i < RATE_LIMIT_MAX; i++) checkAndRecord(rateDir, key, 5_000);
    const attempted: string[] = [];
    const results = await drain(
      dir,
      async (_t, content) => {
        attempted.push(content);
      },
      { rateDir, now: () => 6_000 },
    );
    expect(attempted).toEqual([]);
    expect(results).toEqual([
      { threadId: 't-rate', toName: 'alpha', delivered: 0, remaining: 1, dropped: 0 },
    ]);
    expect(itemsOf(dir, 't-rate')).toEqual([
      { ...sansId('r-1', 'alpha', 1_000, 0), callerKey: 'claude:s-1' },
    ]);
  });

  it('consumes the shared rate window: deliveries beyond the cap wait for the next round', async () => {
    const dir = freshDir();
    const rateDir = freshDir();
    park(dir, 't-shared', { envelope: 'a', toName: 'alpha', callerKey: 'claude:s-1' }, 1_000);
    park(dir, 't-shared', { envelope: 'b', toName: 'alpha', callerKey: 'claude:s-1' }, 2_000);
    const key = rateKey('claude:s-1', 'codex:t-shared');
    for (let i = 0; i < RATE_LIMIT_MAX - 1; i++) checkAndRecord(rateDir, key, 5_000);
    const attempted: string[] = [];
    const results = await drain(
      dir,
      async (_t, content) => {
        attempted.push(content);
      },
      { rateDir, now: () => 6_000 },
    );
    expect(attempted).toEqual(['a']); // the 30th send goes through, the 31st is skipped
    expect(results).toEqual([
      { threadId: 't-shared', toName: 'alpha', delivered: 1, remaining: 1, dropped: 0 },
    ]);
  });

  it('stops at maxItems and leaves the rest for the next round', async () => {
    const dir = freshDir();
    for (let i = 0; i < 7; i++) park(dir, 't-cap', { envelope: `e-${i}`, toName: 'alpha' }, i);
    const attempted: string[] = [];
    const results = await drain(
      dir,
      async (_t, content) => {
        attempted.push(content);
      },
      { maxItems: 3, now: () => 1_000 },
    );
    expect(attempted).toEqual(['e-0', 'e-1', 'e-2']);
    expect(results).toEqual([
      { threadId: 't-cap', toName: 'alpha', delivered: 3, remaining: 4, dropped: 0 },
    ]);
    expect(itemsOf(dir, 't-cap')).toHaveLength(4);
  });

  it('stops when the wall-clock budget is exhausted (injected clock, no real sleep)', async () => {
    const dir = freshDir();
    park(dir, 't-budget', { envelope: 'one', toName: 'alpha' }, 1_000);
    park(dir, 't-budget', { envelope: 'two', toName: 'alpha' }, 2_000);
    let t = 1_000;
    const now = () => (t += 8_000); // drain start reads 9_000; each item check advances 8s
    const attempted: string[] = [];
    const results = await drain(
      dir,
      async (_t, content) => {
        attempted.push(content);
      },
      { now, budgetMs: 15_000 },
    );
    expect(attempted).toEqual(['one']);
    expect(results).toEqual([
      { threadId: 't-budget', toName: 'alpha', delivered: 1, remaining: 1, dropped: 0 },
    ]);
  });

  it('dead-letters the whole thread on CODEX_THREAD_NOT_FOUND and deletes the file', async () => {
    const dir = freshDir();
    park(dir, 't-dead', { envelope: 'd-1', toName: 'alpha' }, 1_000);
    park(dir, 't-dead', { envelope: 'd-2', toName: 'alpha' }, 2_000);
    park(dir, 't-dead', { envelope: 'd-3', toName: 'alpha' }, 3_000);
    const attempted: string[] = [];
    const results = await drain(dir, async (_t, content) => {
      attempted.push(content);
      throw new MultichatError('CODEX_THREAD_NOT_FOUND', 'Codex thread t-dead 不存在（可能已删除），无法投递。');
    });
    expect(attempted).toEqual(['d-1']);
    expect(results).toEqual([
      { threadId: 't-dead', toName: 'alpha', delivered: 0, remaining: 0, dropped: 3 },
    ]);
    expect(existsSync(join(dir, 't-dead.json'))).toBe(false);
  });
});

describe('B12: locks, migration, queue depth', () => {
  it('synthesizes stable ids for pre-B12 files without rewriting them eagerly', () => {
    const dir = freshDir();
    writeFileSync(
      join(dir, 't-old.json'),
      JSON.stringify({ items: [{ envelope: 'legacy', toName: 'old', parkedAt: 123, attempts: 4 }] }),
      'utf8',
    );
    const first = itemsOf(dir, 't-old');
    const second = itemsOf(dir, 't-old');
    expect(first[0]!.id).toBe(second[0]!.id);
    expect(first[0]!.envelope).toBe('legacy');
  });

  it('outboxCount reports the queue depth and 0 for unknown threads', () => {
    const dir = freshDir();
    expect(outboxCount(dir, 't-none')).toBe(0);
    park(dir, 't-count', { envelope: 'a', toName: 'alpha' }, 1_000);
    park(dir, 't-count', { envelope: 'b', toName: 'alpha' }, 2_000);
    expect(outboxCount(dir, 't-count')).toBe(2);
  });

  it('a drain delivers in strict FIFO order across interleaved parks', async () => {
    const dir = freshDir();
    park(dir, 't-fifo', { envelope: 'first', toName: 'alpha' }, 1_000);
    park(dir, 't-fifo', { envelope: 'second', toName: 'alpha' }, 2_000);
    const attempted: string[] = [];
    await drain(dir, async (_t, content) => {
      attempted.push(content);
      if (content === 'first') park(dir, 't-fifo', { envelope: 'late', toName: 'alpha' }, 3_000);
    });
    expect(attempted).toEqual(['first', 'second', 'late']);
  });

  it('leaves no lockfiles behind after a drain round', async () => {
    const dir = freshDir();
    park(dir, 't-lockclean', { envelope: 'x', toName: 'alpha' }, 1_000);
    await drain(dir, ok);
    expect(readdirSync(dir).filter((f) => f.endsWith('.lock'))).toEqual([]);
  });
});
