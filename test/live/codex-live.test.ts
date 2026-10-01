import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { listCodexThreads } from '../../src/codex/discovery.js';
import { openCodexSession, type CodexSession } from '../../src/codex/client.js';
import { resolveCodexExecutable } from '../../src/codex/transport.js';

/**
 * Live tests against the user's real codex app-server daemon. Read-only by
 * default; live-b creates one isolated thread via thread/start, proves the
 * write channel (turn accepted / inProgress), and deletes the thread. The
 * daemon is never started or stopped by these tests.
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

/** Confirm thread/start and thread/delete exist in the generated protocol schema. */
function confirmSelfTestMethodsInSchema(): void {
  const dir = mkdtempSync(join(tmpdir(), 'multichat-b2-schema-'));
  try {
    const exe = resolveCodexExecutable();
    const gen = spawnSync(exe, ['app-server', 'generate-json-schema', '--out', dir], {
      encoding: 'utf8',
      timeout: 120_000,
    });
    expect(gen.status).toBe(0);
    const requests = readFileSync(join(dir, 'ClientRequest.json'), 'utf8');
    expect(requests).toContain('"thread/start"');
    expect(requests).toContain('"thread/delete"');
    console.log('[live-b] schema confirmed: thread/start and thread/delete present in ClientRequest.json');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Provider-degradation evidence (third-party relay 401/403 is a vendor issue). */
function providerDegradedEvidence(session: CodexSession, threadId: string): string[] {
  const hits: string[] = [];
  for (const n of session.notifications()) {
    if (n.method === 'turn/completed') {
      const params = n.params as { threadId?: string; turn?: { status?: string; error?: unknown } };
      if (params.threadId === threadId && params.turn?.status === 'failed') {
        hits.push(`turn/completed failed: ${JSON.stringify(params.turn.error ?? {})}`);
      }
    }
  }
  if (/\b40[13]\b/.test(JSON.stringify(session.notifications()))) hits.push('401/403 seen in notifications');
  return hits;
}

describe.skipIf(!process.env.MULTICHAT_LIVE)('codex live', () => {
  it(
    'live-a: read-only initialize + thread/list against the real daemon',
    { timeout: 300_000 },
    async (ctx) => {
      if (!daemonRunning()) {
        console.log('[live-a] SKIP_DAEMON_DOWN');
        ctx.skip();
      }
      const threads = await listCodexThreads();
      console.log(`[live-a] real codex threads routable: ${threads.length}`);
      for (const thread of threads.slice(0, 5)) {
        console.log(`[live-a]   id=${thread.id} status=${thread.status} name=${thread.name ?? '-'}`);
      }
      expect(Array.isArray(threads)).toBe(true);
    },
  );

  it(
    'live-b: isolated end-to-end write channel via thread/start + turn/start',
    { timeout: 300_000 },
    async (ctx) => {
      if (!daemonRunning()) {
        console.log('[live-b] SKIP_DAEMON_DOWN');
        ctx.skip();
      }
      confirmSelfTestMethodsInSchema();

      const workDir = mkdtempSync(join(tmpdir(), 'multichat-b2-selftest-'));
      const session: CodexSession = await openCodexSession({ requestTimeoutMs: 30_000 })();
      let threadId = '';
      let turnAccepted = false;
      try {
        await session.initialize();
        threadId = await session.startThread(workDir);
        console.log(`[live-b] isolated thread started: ${threadId} (cwd=${workDir})`);
        expect(threadId).toBeTruthy();

        // A freshly created thread has no rollout file yet, so thread/resume
        // rejects it with "no rollout found" (observed live). The creator is
        // subscribed by construction and owns the thread exclusively, so the
        // first turn goes straight in — deliver()'s resume-based disposition
        // applies to pre-existing threads, which always have rollouts.
        const turn = await session.startTurn(
          threadId,
          'multichat channel self-test. Reply with the single word: OK',
        );
        console.log(`[live-b] turn/start accepted: turnId=${turn.id} status=${turn.status}`);
        // Channel acceptance proof: the server took the turn and reports it running.
        expect(turn.status).toBe('inProgress');
        turnAccepted = true;

        // Best-effort model-call evidence. A provider 401/403 (third-party
        // relay outage) is NOT a channel failure: the turn was accepted.
        const waitDeadline = Date.now() + 90_000;
        let completed = false;
        while (Date.now() < waitDeadline) {
          completed = session
            .notifications()
            .some(
              (n) =>
                n.method === 'turn/completed' &&
                (n.params as { threadId?: string }).threadId === threadId,
            );
          if (completed) break;
          await sleep(2_000);
        }
        const degraded = providerDegradedEvidence(session, threadId);
        if (completed) {
          console.log('[live-b] turn/completed notification observed');
        } else {
          console.log('[live-b] no turn/completed within the observation window (best-effort only)');
        }
        if (degraded.length > 0) {
          console.log('[live-b] PROVIDER_AUTH_DEGRADED: ' + degraded.join(' | '));
        } else {
          console.log('[live-b] provider state: no 401/403 evidence in notifications');
        }
      } finally {
        if (threadId) {
          await session.unsubscribe(threadId).catch((err) => {
            console.log(`[live-b] unsubscribe failed (best-effort): ${String(err)}`);
          });
          await session.deleteThread(threadId).then(
            () => console.log('[live-b] self-test thread deleted'),
            (err) => {
              console.log(`[live-b] thread/delete failed; thread remains named multichat-b2-selftest: ${String(err)}`);
            },
          );
        }
        await session.close().catch(() => undefined);
        rmSync(workDir, { recursive: true, force: true });
        console.log(
          `[live-b] cleanup: thread ${threadId || '-'} ${turnAccepted ? 'deleted after acceptance' : ''}, temp dir removed`,
        );
      }
    },
  );
});
