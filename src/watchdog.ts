import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { drain, outboxSummary } from './outbox.js';

/**
 * Detached outbox watchdog (B12): the 2026-10-02 incident showed parked
 * messages starve unless some CLI call happens to run while the target thread
 * is idle. After any park, send spawns `crosschat __drain --watch` detached;
 * it retries with backoff until the outbox empties, then exits. Single
 * instance via a pid+timestamp lockfile in the outbox dir (no resident
 * daemon: the process only lives while work is pending).
 */

export const WATCHDOG_BACKOFF_STEPS_MS = [30_000, 60_000, 120_000, 300_000] as const;

/** Backoff after N consecutive empty-handed rounds; any delivery resets it. */
export function nextBackoffMs(consecutiveEmptyRounds: number): number {
  const index = Math.min(Math.max(consecutiveEmptyRounds, 0), WATCHDOG_BACKOFF_STEPS_MS.length - 1);
  return WATCHDOG_BACKOFF_STEPS_MS[index]!;
}

const WATCHDOG_LOCK = 'watchdog.lock';
/** Heartbeat freshness; a holder without a heartbeat is considered dead. */
const WATCHDOG_STALE_MS = 90_000;

export interface WatchdogStatus {
  running: boolean;
  pid?: number;
}

export function watchdogStatus(outboxDir: string, nowMs: number = Date.now()): WatchdogStatus {
  try {
    const [pidText, tsText] = readFileSync(join(outboxDir, WATCHDOG_LOCK), 'utf8').trim().split(/\s+/);
    const pid = Number(pidText);
    const ts = Number(tsText);
    if (!Number.isFinite(ts)) return { running: false };
    if (nowMs - ts < WATCHDOG_STALE_MS) return { running: true, pid: Number.isFinite(pid) ? pid : undefined };
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, 0); // throws when the pid is gone
        return { running: true, pid };
      } catch {
        /* stale and dead */
      }
    }
  } catch {
    /* no lock file */
  }
  return { running: false };
}

/**
 * Best-effort spawn of the detached watchdog loop; never throws and never
 * spawns a second instance while one is alive. No-op under vitest so tests
 * cannot leak background processes.
 */
export function spawnWatchdog(outboxDir: string): void {
  if (watchdogStatus(outboxDir).running) return;
  const entry = process.argv[1];
  if (entry === undefined || entry.includes('vitest')) return;
  try {
    const child = spawn(process.execPath, [entry, '__drain', '--watch'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } catch {
    // ponytail: watchdog is liveness relief, not correctness; the next send retries the spawn.
  }
}

export interface WatchdogDeps {
  deliverCodex(threadId: string, content: string, busyTimeoutMs: number): Promise<unknown>;
  err(line: string): void;
  sleep?(ms: number): Promise<void>;
}

/** The watchdog loop itself; returns when the outbox is empty. Never throws. */
export async function runWatchdog(outboxDir: string, rateDir: string, deps: WatchdogDeps): Promise<void> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  try {
    mkdirSync(outboxDir, { recursive: true });
    writeFileSync(join(outboxDir, WATCHDOG_LOCK), `${process.pid} ${Date.now()}`, 'utf8');
    let emptyRounds = 0;
    for (;;) {
      const results = await drain(outboxDir, (threadId, content, busyTimeoutMs) =>
        deps.deliverCodex(threadId, content, busyTimeoutMs), { rateDir });
      const delivered = results.reduce((total, result) => total + result.delivered, 0);
      const dropped = results.reduce((total, result) => total + result.dropped, 0);
      if (delivered > 0) deps.err(`watchdog: 补投 ${delivered} 条`);
      if (dropped > 0) deps.err(`watchdog: 线程已不存在，丢弃 ${dropped} 条`);
      if (outboxSummary(outboxDir).every((thread) => thread.count === 0)) break;
      writeFileSync(join(outboxDir, WATCHDOG_LOCK), `${process.pid} ${Date.now()}`, 'utf8'); // heartbeat
      await sleep(nextBackoffMs(emptyRounds));
      emptyRounds = delivered > 0 ? 0 : emptyRounds + 1;
    }
  } catch {
    // Never throw out of the detached loop; the next park re-spawns a fresh watchdog.
  } finally {
    try {
      rmSync(join(outboxDir, WATCHDOG_LOCK), { force: true });
    } catch {
      /* already gone */
    }
  }
}
