import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deliverToCodexThread } from '../src/codex/deliver.js';
import { listCodexThreads } from '../src/codex/discovery.js';
import { openCodexSession, type CodexSession, type CodexThreadStatus } from '../src/codex/client.js';
import { CodexRpcRejectedError } from '../src/codex/rpc.js';
import { sanitizeProxyEnv } from '../src/codex/transport.js';
import { MultichatError } from '../src/errors.js';

describe('sanitizeProxyEnv', () => {
  it('strips dual-identity residue from both sides before spawning the proxy', () => {
    const clean = sanitizeProxyEnv({
      PATH: 'keep',
      CLAUDE_CODE_MESSAGING_SOCKET: 'sock',
      CLAUDE_CODE_MESSAGING_TOKEN: 'token',
      CLAUDE_CODE_SESSION_ID: 'cs-1',
      CODEX_THREAD_ID: 't-1',
      CODEX_SESSION_ID: 's-1',
    } as NodeJS.ProcessEnv);
    expect(clean).toEqual({ PATH: 'keep' });
  });
});

/**
 * Fake CodexSession scripting the whole app-server surface. Records every
 * call so tests can assert exact operation ordering and no-retry behavior.
 * A resume step may be a status or an Error (thrown = server rejection).
 */
function makeFakeSession(script: {
  resumeStatuses?: Array<CodexThreadStatus | Error>;
  turn?: { id: string; status: string };
  turnError?: Error;
  initializeError?: Error;
}): {
  session: CodexSession;
  calls: string[];
} {
  const calls: string[] = [];
  let resumeCount = 0;
  const session: CodexSession = {
    async initialize() {
      calls.push('initialize');
      if (script.initializeError) throw script.initializeError;
    },
    async listThreads() {
      calls.push('thread/list');
      return [{ id: 't-listed', name: 'work', status: 'idle' }];
    },
    async resumeThread(threadId: string) {
      calls.push(`resume:${threadId}`);
      const statuses = script.resumeStatuses ?? ['idle'];
      const step = statuses[Math.min(resumeCount, statuses.length - 1)];
      resumeCount += 1;
      if (step instanceof Error) throw step;
      return step;
    },
    async startTurn(threadId: string, text: string) {
      calls.push(`turn/start:${threadId}:${text}`);
      if (script.turnError) throw script.turnError;
      return script.turn ?? { id: 'turn-1', status: 'inProgress' };
    },
    async steerTurn(threadId: string) {
      calls.push(`turn/steer:${threadId}`);
      return 'turn-1';
    },
    async unsubscribe(threadId: string) {
      calls.push(`unsubscribe:${threadId}`);
    },
    async startThread(cwd: string) {
      calls.push(`thread/start:${cwd}`);
      return 't-new';
    },
    async deleteThread(threadId: string) {
      calls.push(`thread/delete:${threadId}`);
    },
    notifications() {
      return [];
    },
    async close() {
      calls.push('close');
    },
  };
  return { session, calls };
}

function factoryFor(session: () => Promise<CodexSession>) {
  return session;
}

const fast = { busyTimeoutMs: 60, pollIntervalMs: 5 };

describe('deliverToCodexThread', () => {
  it('delivers straight through when the thread is idle', async () => {
    const { session, calls } = makeFakeSession({});
    const result = await deliverToCodexThread('t1', 'hello', {
      ...fast,
      sessionFactory: factoryFor(async () => session),
    });
    expect(result).toEqual({ status: 'accepted', turnId: 'turn-1', queued: false });
    expect(calls).toEqual([
      'initialize',
      'resume:t1',
      'turn/start:t1:hello',
      'unsubscribe:t1',
      'close',
    ]);
  });

  it('queues a turn immediately on a busy thread (daemon >=0.160 inbox semantics)', async () => {
    const { session, calls } = makeFakeSession({ resumeStatuses: ['busy', 'busy', 'idle'] });
    const result = await deliverToCodexThread('t1', 'hello', {
      busyTimeoutMs: 1_000,
      pollIntervalMs: 5,
      sessionFactory: factoryFor(async () => session),
    });
    expect(result).toEqual({ status: 'accepted', turnId: 'turn-1', queued: true });
    // No busy polling: exactly one resume, then the queued turn/start.
    expect(calls.filter((c) => c.startsWith('resume:'))).toHaveLength(1);
    expect(calls).toContain('turn/start:t1:hello');
  });

  it('parks (CODEX_THREAD_BUSY_TIMEOUT) when an old daemon rejects the queued turn/start', async () => {
    const { session, calls } = makeFakeSession({
      resumeStatuses: ['busy'],
      turnError: new CodexRpcRejectedError(-32600, 'thread is busy'),
    });
    await expect(
      deliverToCodexThread('t1', 'hello', {
        ...fast,
        sessionFactory: factoryFor(async () => session),
      }),
    ).rejects.toMatchObject({ code: 'CODEX_THREAD_BUSY_TIMEOUT' });
    expect(calls).toContain('turn/start:t1:hello');
    expect(calls).toContain('unsubscribe:t1');
    expect(calls).toContain('close');
  });

  it('times out with CODEX_THREAD_BUSY_TIMEOUT when the thread never loads', async () => {
    const { session, calls } = makeFakeSession({ resumeStatuses: ['not_loaded'] });
    await expect(
      deliverToCodexThread('t1', 'hello', {
        busyTimeoutMs: 30,
        pollIntervalMs: 5,
        sessionFactory: factoryFor(async () => session),
      }),
    ).rejects.toMatchObject({ code: 'CODEX_THREAD_BUSY_TIMEOUT' });
    expect(calls).not.toContain('turn/start:t1:hello');
    // The thread was resumed (subscribed), so it must be unsubscribed.
    expect(calls).toContain('unsubscribe:t1');
    expect(calls).toContain('close');
  });

  it('reports CODEX_APPROVAL_REQUIRED and never answers or starts a turn', async () => {
    const { session, calls } = makeFakeSession({ resumeStatuses: ['waiting_approval'] });
    await expect(
      deliverToCodexThread('t1', 'hello', {
        ...fast,
        sessionFactory: factoryFor(async () => session),
      }),
    ).rejects.toMatchObject({ code: 'CODEX_APPROVAL_REQUIRED' });
    expect(calls).not.toContain('turn/start:t1:hello');
    expect(calls).toEqual(['initialize', 'resume:t1', 'unsubscribe:t1', 'close']);
  });

  it('maps a not_found resume rejection to CODEX_THREAD_NOT_FOUND (B11)', async () => {
    const { session, calls } = makeFakeSession({
      resumeStatuses: [new CodexRpcRejectedError(-32001, 'thread not found: t1')],
    });
    const err = (await deliverToCodexThread('t1', 'hello', {
      ...fast,
      sessionFactory: factoryFor(async () => session),
    }).catch((e: unknown) => e)) as MultichatError;
    expect(err).toBeInstanceOf(MultichatError);
    expect(err.code).toBe('CODEX_THREAD_NOT_FOUND');
    expect(err.message).toBe('Codex thread t1 不存在（可能已删除），无法投递。');
    expect(calls).not.toContain('turn/start:t1:hello');
    expect(calls).not.toContain('unsubscribe:t1'); // resume never succeeded
    expect(calls[0]).toBe('initialize');
    expect(calls.at(-1)).toBe('close');
  });

  it('maps a rejected turn to CODEX_TURN_REJECTED without retrying', async () => {
    const { session, calls } = makeFakeSession({
      turnError: new CodexRpcRejectedError(-32001, 'thread not found: t1'),
    });
    await expect(
      deliverToCodexThread('t1', 'hello', {
        ...fast,
        sessionFactory: factoryFor(async () => session),
      }),
    ).rejects.toMatchObject({ code: 'CODEX_TURN_REJECTED' });
    expect(calls.filter((c) => c.startsWith('turn/start:'))).toHaveLength(1);
  });

  it('maps an unconfirmed turn write to CODEX_WRITE_UNCERTAIN without retrying', async () => {
    const { session, calls } = makeFakeSession({
      turnError: new MultichatError('CODEX_REQUEST_TIMEOUT', 'timed out'),
    });
    await expect(
      deliverToCodexThread('t1', 'hello', {
        ...fast,
        sessionFactory: factoryFor(async () => session),
      }),
    ).rejects.toMatchObject({ code: 'CODEX_WRITE_UNCERTAIN' });
    expect(calls.filter((c) => c.startsWith('turn/start:'))).toHaveLength(1);
  });

  it('maps a turn that never reached inProgress to CODEX_WRITE_UNCERTAIN', async () => {
    const { session } = makeFakeSession({ turn: { id: 'turn-9', status: 'interrupted' } });
    await expect(
      deliverToCodexThread('t1', 'hello', {
        ...fast,
        sessionFactory: factoryFor(async () => session),
      }),
    ).rejects.toMatchObject({ code: 'CODEX_WRITE_UNCERTAIN' });
  });

  it('reports CODEX_PROXY_SPAWN_FAILED when the session cannot be established', async () => {
    await expect(
      deliverToCodexThread('t1', 'hello', {
        ...fast,
        sessionFactory: async () => {
          throw new MultichatError('CODEX_PROXY_SPAWN_FAILED', 'codex executable not found');
        },
      }),
    ).rejects.toMatchObject({ code: 'CODEX_PROXY_SPAWN_FAILED' });
  });

  it('waits out an active writer, then delivers headless once the window releases', async () => {
    const { session, calls } = makeFakeSession({
      resumeStatuses: [
        new CodexRpcRejectedError(-32001, 'thread t1 already has an active writer'),
        new CodexRpcRejectedError(-32001, 'thread t1 already has an active writer'),
        'idle',
      ],
    });
    const result = await deliverToCodexThread('t1', 'hello', {
      busyTimeoutMs: 1_000,
      pollIntervalMs: 5,
      sessionFactory: factoryFor(async () => session),
    });
    expect(result).toEqual({ status: 'accepted', turnId: 'turn-1', queued: false });
    expect(calls).toEqual([
      'initialize',
      'resume:t1',
      'resume:t1',
      'resume:t1',
      'turn/start:t1:hello',
      'unsubscribe:t1',
      'close',
    ]);
  });

  it('times out with CODEX_THREAD_LOCKED while a window holds the writer', async () => {
    const { session, calls } = makeFakeSession({
      resumeStatuses: [new CodexRpcRejectedError(-32001, 'thread t1 already has an active writer')],
    });
    const err = (await deliverToCodexThread('t1', 'hello', {
      busyTimeoutMs: 30,
      pollIntervalMs: 5,
      sessionFactory: factoryFor(async () => session),
    }).catch((e: unknown) => e)) as MultichatError;
    expect(err.code).toBe('CODEX_THREAD_LOCKED');
    expect(err.message).toContain('正被 codex 窗口占用');
    expect(err.message).toContain('关闭该窗口后重发将立即送达');
    expect(err.message).toContain('或改投其它线程');
    // Polled repeatedly; zero turn writes; resume never succeeded so no
    // unsubscribe; the proxy session is still closed.
    expect(calls.filter((c) => c.startsWith('resume:'))).toHaveLength(calls.length - 2);
    expect(calls.filter((c) => c.startsWith('resume:')).length).toBeGreaterThanOrEqual(3);
    expect(calls).not.toContain('turn/start:t1:hello');
    expect(calls).not.toContain('unsubscribe:t1');
    expect(calls[0]).toBe('initialize');
    expect(calls.at(-1)).toBe('close');
  });

  it('attaches proxy stderr evidence and daemon guidance to CODEX_PROXY_SPAWN_FAILED', async () => {
    const dead = new MultichatError('CODEX_TRANSPORT_CLOSED', 'codex proxy connection failed.');
    dead.stderrText = 'Error: Io error: daemon socket refused (os error 10061)';
    const err = (await deliverToCodexThread('t1', 'hello', {
      ...fast,
      sessionFactory: async () => {
        throw dead;
      },
    }).catch((e: MultichatError) => e)) as MultichatError;
    expect(err.code).toBe('CODEX_PROXY_SPAWN_FAILED');
    expect(err.message).toContain('os error 10061');
    expect(err.message).toContain('codex app-server daemon start');
    expect(err.cause).toBe(dead);
  });

  it('collapses pre-write protocol failures to CODEX_PROTOCOL_ERROR', async () => {
    const { session, calls } = makeFakeSession({
      initializeError: new MultichatError('CODEX_REQUEST_TIMEOUT', 'timed out'),
    });
    await expect(
      deliverToCodexThread('t1', 'hello', {
        ...fast,
        sessionFactory: factoryFor(async () => session),
      }),
    ).rejects.toMatchObject({ code: 'CODEX_PROTOCOL_ERROR' });
    // Never resumed, so no unsubscribe; the session is still closed.
    expect(calls).toEqual(['initialize', 'close']);
  });
});

describe('deliverToCodexThread stall budget (B19: park early, never 120s)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const writerRejection = () =>
    new CodexRpcRejectedError(-32001, 'thread t1 already has an active writer');

  /** Advance fake time in 1s steps until the attempt settles; report fake ms spent. */
  async function drive(attempt: Promise<unknown>, budgetMs = 120_000): Promise<number> {
    let settled = false;
    let elapsed = 0;
    attempt.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    while (!settled && elapsed < budgetMs) {
      await vi.advanceTimersByTimeAsync(1_000);
      elapsed += 1_000;
    }
    return elapsed;
  }

  it('parks (CODEX_THREAD_LOCKED) after ~10s when the writer lock never releases', async () => {
    const { session, calls } = makeFakeSession({ resumeStatuses: [writerRejection()] });
    const attempt = deliverToCodexThread('t1', 'hello', { sessionFactory: async () => session });
    let rejection: unknown;
    attempt.catch((e: unknown) => { rejection = e; });
    const elapsed = await drive(attempt);
    expect(rejection).toBeInstanceOf(MultichatError);
    expect((rejection as MultichatError).code).toBe('CODEX_THREAD_LOCKED');
    // Bailed at the ~10s stall budget, not the old 120s.
    expect(elapsed).toBeGreaterThanOrEqual(9_000);
    expect(elapsed).toBeLessThanOrEqual(10_000);
    // ~3 poll rounds at the default 3s interval before giving up; zero writes.
    expect(calls.filter((c) => c.startsWith('resume:'))).toHaveLength(4);
    expect(calls).not.toContain('turn/start:t1:hello');
    expect(calls.at(-1)).toBe('close');
  });

  it('parks (CODEX_THREAD_BUSY_TIMEOUT) after ~10s when the thread never loads', async () => {
    const { session, calls } = makeFakeSession({ resumeStatuses: ['not_loaded'] });
    const attempt = deliverToCodexThread('t1', 'hello', { sessionFactory: async () => session });
    let rejection: unknown;
    attempt.catch((e: unknown) => { rejection = e; });
    const elapsed = await drive(attempt);
    expect(rejection).toBeInstanceOf(MultichatError);
    expect((rejection as MultichatError).code).toBe('CODEX_THREAD_BUSY_TIMEOUT');
    expect(elapsed).toBeGreaterThanOrEqual(9_000);
    expect(elapsed).toBeLessThanOrEqual(10_000);
    expect(calls).not.toContain('turn/start:t1:hello');
    // Resume succeeded, so the subscription is released before close.
    expect(calls).toContain('unsubscribe:t1');
    expect(calls.at(-1)).toBe('close');
  });

  it('still delivers when the writer releases within the stall budget (round-2 recovery)', async () => {
    const { session, calls } = makeFakeSession({ resumeStatuses: [writerRejection(), 'idle'] });
    const attempt = deliverToCodexThread('t1', 'hello', { sessionFactory: async () => session });
    let result: unknown;
    let rejection: unknown;
    attempt.then(
      (r: unknown) => { result = r; },
      (e: unknown) => { rejection = e; },
    );
    const elapsed = await drive(attempt, 30_000);
    expect(rejection).toBeUndefined();
    expect(result).toEqual({ status: 'accepted', turnId: 'turn-1', queued: false });
    expect(elapsed).toBe(3_000); // one default-interval poll rode out the stall
    expect(calls).toContain('turn/start:t1:hello');
  });
});

describe('listCodexThreads (read-only discovery)', () => {
  it('lists threads without any resume or turn calls', async () => {
    const { session, calls } = makeFakeSession({});
    const threads = await listCodexThreads({ sessionFactory: factoryFor(async () => session) });
    expect(threads).toEqual([{ id: 't-listed', name: 'work', status: 'idle' }]);
    expect(calls).toEqual(['initialize', 'thread/list', 'close']);
  });

  it('wraps a transport failure at session-open time as CODEX_PROXY_SPAWN_FAILED', async () => {
    await expect(
      listCodexThreads({
        sessionFactory: async () => {
          throw new Error('ws upgrade failed');
        },
      }),
    ).rejects.toMatchObject({ code: 'CODEX_PROXY_SPAWN_FAILED' });
  });

  it('openCodexSession propagates spawn failures', { timeout: 20_000 }, async () => {
    const factory = openCodexSession({
      spawnProxy: () => {
        throw new Error('ENOENT');
      },
    });
    await expect(factory()).rejects.toMatchObject({ code: 'CODEX_PROXY_SPAWN_FAILED' });
  });
});
