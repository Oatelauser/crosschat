import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { nextBackoffMs, runWatchdog, watchdogStatus, WATCHDOG_BACKOFF_STEPS_MS } from '../src/watchdog.js';
import { park } from '../src/outbox.js';
import { MultichatError } from '../src/errors.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-watchdog-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const freshDir = (): string => mkdtempSync(join(root, 'case-'));

describe('nextBackoffMs', () => {
  it('steps 30s → 60s → 120s → 300s and caps there, resetting is caller-side', () => {
    expect(WATCHDOG_BACKOFF_STEPS_MS).toEqual([30_000, 60_000, 120_000, 300_000]);
    expect(nextBackoffMs(0)).toBe(30_000);
    expect(nextBackoffMs(1)).toBe(60_000);
    expect(nextBackoffMs(2)).toBe(120_000);
    expect(nextBackoffMs(3)).toBe(300_000);
    expect(nextBackoffMs(99)).toBe(300_000);
    expect(nextBackoffMs(-5)).toBe(30_000);
  });
});

describe('watchdogStatus', () => {
  it('reports idle with no lockfile', () => {
    expect(watchdogStatus(freshDir(), 1_000)).toEqual({ running: false });
  });

  it('treats a fresh heartbeat as running, a stale one as dead', () => {
    const dir = freshDir();
    // pid=0：跳过 kill 探活分支（写死宿主 pid 会随机器进程表碰巧存活而翻车——
    // 真联邦在跑的机器上实测踩过 12345 存活导致 stale 判 running）
    writeFileSync(join(dir, 'watchdog.lock'), `0 1000000`, 'utf8');
    expect(watchdogStatus(dir, 1000000 + 89_000).running).toBe(true);
    expect(watchdogStatus(dir, 1000000 + 91_000).running).toBe(false);
  });
});

describe('runWatchdog', () => {
  it('stops after an uncertain write instead of replaying or spinning forever', async () => {
    const dir = freshDir();
    park(dir, 'uncertain', { envelope: 'input', toName: 'target', deliveryMode: 'queue' });
    let calls = 0;
    let sleeps = 0;
    await runWatchdog(dir, join(freshDir(), 'send-log.jsonl'), {
      deliverCodex: async () => { calls++; throw new MultichatError('CODEX_WRITE_UNCERTAIN', 'unknown'); },
      err: () => undefined,
      sleep: async () => { if (++sleeps > 1) throw new Error('must not keep polling'); },
    });
    expect(calls).toBe(1);
    expect(sleeps).toBe(0);
  });

  it('rechecks explicit queue messages promptly and preserves their mode', async () => {
    const dir = freshDir();
    park(dir, 'queue', { envelope: 'input', toName: 'target', deliveryMode: 'queue' });
    const modes: unknown[] = [];
    const sleeps: number[] = [];
    await runWatchdog(dir, join(freshDir(), 'send-log.jsonl'), {
      deliverCodex: async (_id, _text, _timeout, options) => {
        modes.push(options?.mode);
        if (modes.length === 1) throw new MultichatError('CODEX_THREAD_BUSY_TIMEOUT', 'busy');
      },
      err: () => undefined,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    expect(modes).toEqual(['queue', 'queue']);
    expect(sleeps).toEqual([1_000]);
  });

  it('drains until empty with backoff sleeps, then removes its lock', async () => {
    const dir = freshDir();
    const sendLogFile = join(freshDir(), 'send-log.jsonl');
    park(dir, 't-wd', { envelope: 'w-1', toName: 'alpha', callerKey: 'claude:x' }, 1_000);
    park(dir, 't-wd', { envelope: 'w-2', toName: 'alpha', callerKey: 'claude:x' }, 2_000);
    const sleeps: number[] = [];
    const lines: string[] = [];
    // First round: busy → nothing delivered; second round: all delivered.
    let round = 0;
    await runWatchdog(dir, sendLogFile, {
      deliverCodex: async (_t, content) => {
        round++;
        if (round === 1) throw new MultichatError('CODEX_THREAD_BUSY_TIMEOUT', 'busy');
        void content;
      },
      err: (line) => lines.push(line),
      sleep: async (ms) => sleeps.push(ms),
    });
    // Round 1 busy → one backoff sleep; round 2 delivers both and exits.
    expect(sleeps).toEqual([30_000]);
    expect(lines.some((line) => line.includes('补投 2 条'))).toBe(true);
    expect(watchdogStatus(dir).running).toBe(false);
    expect(readFileSync(join(dir, '..', 'mailbox', 't-wd.md'), 'utf8')).toContain('送达');
  });

  it('survives transient unknown errors and still finishes', async () => {
    const dir = freshDir();
    park(dir, 't-boom', { envelope: 'x', toName: 'alpha' }, 1_000);
    const sendLogFile = join(freshDir(), 'send-log.jsonl');
    let calls = 0;
    await runWatchdog(dir, sendLogFile, {
      deliverCodex: async () => {
        calls++;
        if (calls <= 2) throw new Error('boom'); // unknown error: skipped this round
      },
      err: () => undefined,
      sleep: async () => undefined,
    });
    expect(calls).toBe(3); // two failed rounds, third delivers and empties the queue
    expect(watchdogStatus(dir).running).toBe(false);
  });
});
