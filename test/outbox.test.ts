import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  drain,
  OUTBOX_MAX_PER_THREAD,
  park,
  type DrainDeliverFn,
  type OutboxItem,
} from '../src/outbox.js';
import { MultichatError } from '../src/errors.js';

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

describe('park', () => {
  it('appends FIFO with parkedAt/attempts and persists the composed envelope', () => {
    const dir = freshDir();
    park(dir, 't-park', { envelope: 'env-1', toName: 'alpha' }, 1_000);
    park(dir, 't-park', { envelope: 'env-2', toName: 'alpha' }, 2_000);
    expect(itemsOf(dir, 't-park')).toEqual([
      { envelope: 'env-1', toName: 'alpha', parkedAt: 1_000, attempts: 0 },
      { envelope: 'env-2', toName: 'alpha', parkedAt: 2_000, attempts: 0 },
    ]);
  });

  it('keeps threads in separate files', () => {
    const dir = freshDir();
    park(dir, 't-a', { envelope: 'env-1', toName: 'alpha' }, 1_000);
    park(dir, 't-b', { envelope: 'env-2', toName: 'beta' }, 2_000);
    expect(itemsOf(dir, 't-a')).toHaveLength(1);
    expect(itemsOf(dir, 't-b')).toHaveLength(1);
  });

  it('refuses honestly at 20 per thread and leaves the file untouched', () => {
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
    expect(itemsOf(dir, 't-corrupt')).toEqual([
      { envelope: 'env', toName: 'alpha', parkedAt: 7_000, attempts: 0 },
    ]);
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
    expect(results).toEqual([{ threadId: 't-drain', toName: 'alpha', delivered: 2, remaining: 0 }]);
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

  it('keeps items with attempts+1 when the thread is still busy/locked', async () => {
    const dir = freshDir();
    park(dir, 't-busy', { envelope: 'b-1', toName: 'alpha' }, 1_000);
    park(dir, 't-busy', { envelope: 'b-2', toName: 'alpha' }, 2_000);
    const results = await drain(dir, async () => {
      throw busy('CODEX_THREAD_LOCKED');
    });
    expect(results).toEqual([{ threadId: 't-busy', toName: 'alpha', delivered: 0, remaining: 2 }]);
    expect(itemsOf(dir, 't-busy')).toEqual([
      { envelope: 'b-1', toName: 'alpha', parkedAt: 1_000, attempts: 1 },
      { envelope: 'b-2', toName: 'alpha', parkedAt: 2_000, attempts: 1 },
    ]);
  });

  it('keeps items unchanged on any other delivery error', async () => {
    const dir = freshDir();
    park(dir, 't-uncertain', { envelope: 'u-1', toName: 'alpha' }, 5_000);
    const results = await drain(dir, async () => {
      throw new MultichatError('CODEX_WRITE_UNCERTAIN', 'unknown state');
    });
    expect(results).toEqual([{ threadId: 't-uncertain', toName: 'alpha', delivered: 0, remaining: 1 }]);
    expect(itemsOf(dir, 't-uncertain')).toEqual([
      { envelope: 'u-1', toName: 'alpha', parkedAt: 5_000, attempts: 0 },
    ]);
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
    expect(results).toEqual([{ threadId: 't-ok', toName: 'alpha', delivered: 1, remaining: 0 }]);
    expect(existsSync(join(dir, 't-corrupt.json'))).toBe(true);
  });
});
