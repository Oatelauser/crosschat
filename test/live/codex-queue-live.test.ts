import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { openCodexSession, type CodexSession } from '../../src/codex/client.js';
import { queueToCodexThread } from '../../src/codex/queue.js';
import { resolveCodexExecutable } from '../../src/codex/transport.js';

/**
 * Live test for the `codex queue` CLI wrapper (queue.ts). The open-window
 * behavior itself was already proven by hand (research/
 * codex-open-window-injection.md: queued message auto-starts a turn in the
 * live TUI within ~2s); here we only verify our spawn封装 is correct: against
 * a thread we created ourselves, the real `codex queue` invocation exits 0
 * and reports queued. Read-only probes otherwise; the daemon is never started
 * or stopped. Only self-created threads are touched.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Read-only daemon probe; never starts anything. */
function daemonRunning(): boolean {
  let exe: string;
  try {
    exe = resolveCodexExecutable();
  } catch {
    return false;
  }
  const probe = spawnSync(exe, ['app-server', 'daemon', 'version'], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  return probe.status === 0 && probe.stdout.includes('"status":"running"');
}

describe.skipIf(!process.env.MULTICHAT_LIVE)('codex queue live', () => {
  it(
    'live-q: queue CLI wrapper exits 0 against a self-created thread',
    { timeout: 300_000 },
    async (ctx) => {
      if (!daemonRunning()) {
        console.log('[live-q] SKIP_DAEMON_DOWN');
        ctx.skip();
      }
      const workDir = mkdtempSync(join(tmpdir(), 'multichat-b6-queue-'));
      const session: CodexSession = await openCodexSession({ requestTimeoutMs: 30_000 })();
      let threadId = '';
      try {
        await session.initialize();
        threadId = await session.startThread(workDir);
        console.log(`[live-q] isolated thread started: ${threadId}`);
        expect(threadId).toBeTruthy();

        // Give the thread a real turn so a rollout exists (a rollout-less
        // thread may be rejected by queue's thread read; mirrors deliver()'s
        // pre-existing-thread path).
        const turn = await session.startTurn(
          threadId,
          'multichat queue self-test setup. Reply with the single word: OK',
        );
        expect(turn.status).toBe('inProgress');
        // Best-effort: let the setup turn finish so the thread is idle again.
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline) {
          const done = session
            .notifications()
            .some(
              (n) =>
                n.method === 'turn/completed' &&
                (n.params as { threadId?: string }).threadId === threadId,
            );
          if (done) break;
          await sleep(2_000);
        }
        console.log('[live-q] setup turn observed:', session.notifications().some(
          (n) => n.method === 'turn/completed',
        ));

        // The assertion under test: our spawn wrapper runs the real CLI and
        // the daemon accepts the queued message (exit 0).
        const result = await queueToCodexThread(
          threadId,
          'QUEUE-LIVE-TEST: multichat queue channel self-test',
        );
        console.log(`[live-q] queue result: ${JSON.stringify(result)}`);
        expect(result).toEqual({ status: 'queued' });
      } finally {
        if (threadId) {
          await session.unsubscribe(threadId).catch(() => undefined);
          await session.deleteThread(threadId).then(
            () => console.log('[live-q] self-test thread deleted'),
            (err) =>
              console.log(
                `[live-q] thread/delete failed; thread remains (${threadId}): ${String(err)}`,
              ),
          );
        }
        await session.close().catch(() => undefined);
        rmSync(workDir, { recursive: true, force: true });
        console.log(`[live-q] cleanup: thread ${threadId || '-'} handled, temp dir removed`);
      }
    },
  );
});
