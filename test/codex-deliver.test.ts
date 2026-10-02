import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { deliverToCodexThread } from '../src/codex/deliver.js';
import { listCodexThreads } from '../src/codex/discovery.js';
import { openCodexSession, type CodexSession, type CodexThreadStatus } from '../src/codex/client.js';
import type { CodexQueueOptions, CodexQueueProcess } from '../src/codex/queue.js';
import { CodexRpcRejectedError } from '../src/codex/rpc.js';
import { MultichatError } from '../src/errors.js';

/** Fake `codex queue` child for the active-writer fallback tests. */
function fakeQueue(script: { code?: number; stderr?: string }): {
  options: CodexQueueOptions;
  calls: { command: string; args: string[] }[];
} {
  const calls: { command: string; args: string[] }[] = [];
  return {
    calls,
    options: {
      executable: 'codex',
      spawnProcess: (command, args) => {
        calls.push({ command, args: [...args] });
        const child = new EventEmitter() as unknown as CodexQueueProcess;
        child.stderr = {
          on(event, listener) {
            if (event === 'data' && script.stderr) {
              setTimeout(() => listener(Buffer.from(script.stderr)), 0);
            }
          },
        };
        child.kill = () => undefined;
        setTimeout(() => child.emit('close', script.code ?? 0, null), 5);
        return child;
      },
    },
  };
}

/**
 * Fake CodexSession scripting the whole app-server surface. Records every
 * call so tests can assert exact operation ordering and no-retry behavior.
 */
function makeFakeSession(script: {
  resumeStatuses?: CodexThreadStatus[];
  resumeError?: Error;
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
      if (script.resumeError) throw script.resumeError;
      const statuses = script.resumeStatuses ?? ['idle'];
      const status = statuses[Math.min(resumeCount, statuses.length - 1)];
      resumeCount += 1;
      return status;
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
    expect(result).toEqual({ status: 'accepted', turnId: 'turn-1' });
    expect(calls).toEqual([
      'initialize',
      'resume:t1',
      'turn/start:t1:hello',
      'unsubscribe:t1',
      'close',
    ]);
  });

  it('waits for a busy thread to become idle, then delivers', async () => {
    const { session, calls } = makeFakeSession({ resumeStatuses: ['busy', 'busy', 'idle'] });
    const result = await deliverToCodexThread('t1', 'hello', {
      busyTimeoutMs: 1_000,
      pollIntervalMs: 5,
      sessionFactory: factoryFor(async () => session),
    });
    expect(result.status).toBe('accepted');
    expect(calls.filter((c) => c.startsWith('resume:'))).toHaveLength(3);
    expect(calls).toContain('turn/start:t1:hello');
  });

  it('times out with CODEX_THREAD_BUSY_TIMEOUT when the thread stays busy', async () => {
    const { session, calls } = makeFakeSession({ resumeStatuses: ['busy'] });
    await expect(
      deliverToCodexThread('t1', 'hello', {
        busyTimeoutMs: 30,
        pollIntervalMs: 5,
        sessionFactory: factoryFor(async () => session),
      }),
    ).rejects.toMatchObject({ code: 'CODEX_THREAD_BUSY_TIMEOUT' });
    expect(calls).not.toContain('turn/start:t1:hello');
    // The busy thread was resumed (subscribed), so it must be unsubscribed.
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

  it('falls back to codex queue when resume hits an active writer, and reports queued', async () => {
    const { session, calls } = makeFakeSession({
      resumeError: new CodexRpcRejectedError(-32001, 'thread t1 already has an active writer'),
    });
    const queue = fakeQueue({});
    const result = await deliverToCodexThread('t1', 'hello', {
      ...fast,
      sessionFactory: factoryFor(async () => session),
      queue: queue.options,
    });
    expect(result).toEqual({ status: 'queued' });
    expect(queue.calls).toEqual([
      { command: 'codex', args: ['queue', '--thread', 't1', '--message', 'hello'] },
    ]);
    // Zero turn writes; resume never succeeded so no unsubscribe; the proxy
    // session is still closed before queue delivery is returned.
    expect(calls).toEqual(['initialize', 'resume:t1', 'close']);
  });

  it('maps an active-writer resume rejection to CODEX_THREAD_LOCKED when queue also fails', async () => {
    const { session, calls } = makeFakeSession({
      resumeError: new CodexRpcRejectedError(-32001, 'thread t1 already has an active writer'),
    });
    const queue = fakeQueue({ code: 1, stderr: 'Error: daemon socket refused' });
    const err = (await deliverToCodexThread('t1', 'hello', {
      ...fast,
      sessionFactory: factoryFor(async () => session),
      queue: queue.options,
    }).catch((e: unknown) => e)) as MultichatError;
    expect(err.code).toBe('CODEX_THREAD_LOCKED');
    expect(err.message).toContain('queue 通道也失败');
    expect(err.message).toContain('daemon socket refused');
    expect(err.message).toContain('关闭该窗口后重发，或改投未被占用的信箱线程');
    expect(queue.calls).toHaveLength(1);
    // Zero writes: no turn, and resume never succeeded so no unsubscribe.
    expect(calls).toEqual(['initialize', 'resume:t1', 'close']);
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

  it('openCodexSession propagates spawn failures', async () => {
    const factory = openCodexSession({
      spawnProxy: () => {
        throw new Error('ENOENT');
      },
    });
    await expect(factory()).rejects.toMatchObject({ code: 'CODEX_PROXY_SPAWN_FAILED' });
  });
});
