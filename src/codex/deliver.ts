import { MultichatError } from '../errors.js';
import {
  openCodexSession,
  normalizeThreadStatus,
  type CodexSession,
  type CodexSessionFactory,
  type CodexThreadStatus,
} from './client.js';
import { CodexRpcRejectedError } from './rpc.js';
import { resolveDeliveryMode } from '../delivery-mode.js';
import type { DeliveryMode, DeliveryOptions } from '../delivery-mode.js';
import { DesktopIpcError, openDesktopThread } from './desktop-ipc.js';
import type { DesktopThreadSession } from './desktop-ipc.js';

/**
 * Deliver through the exact Desktop owner when present, otherwise the CLI
 * app-server. Queue waits in crosschat while busy; native turn/start can append
 * to the current task (verified with a real 0.163.0 TUI), so its acceptance is
 * not evidence of independent queueing. Steer targets a verified active turn,
 * or starts a new turn when idle. Unknown writes are never replayed, and
 * approvals are never answered on the user's behalf.
 */

export interface CodexDeliveryOptions extends DeliveryOptions {
  sessionFactory?: CodexSessionFactory;
  /** An injected CLI session disables real Desktop discovery unless this is also supplied. */
  desktopFactory?: (threadId: string) => Promise<DesktopThreadSession | null>;
  /**
   * Stall budget for the two remaining poll loops (writer lock held, thread
   * not_loaded): default ~10s, capped at ~10s; smaller injected values (tests,
   * drain) are honored. Busy queue returns immediately for the outbox worker.
   */
  busyTimeoutMs?: number;
  /** Re-resume poll interval while waiting for a writer-locked or loading thread (default 3s). */
  pollIntervalMs?: number;
}

export type CodexDeliveryResult = { status: 'accepted'; turnId: string; queued?: boolean };

/**
 * B19 stall budget: a writer lock that never releases or a thread that never
 * loads parks after ~10s (about 3 polls at the default 3s interval — enough to
 * ride out transient stalls) instead of blocking the sender for the old 120s.
 * send.ts maps both outcomes to parked; the watchdog re-delivers.
 */
const STALL_PARK_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 3_000;

/** Server-side rejection text when a codex TUI window holds the thread writer. */
const ACTIVE_WRITER_PATTERN = /already has an active writer/i;
const NO_ACTIVE_TURN_PATTERN = /\bno active turn\b|\bactive turn (?:already )?(?:ended|finished)\b|\bturn is not active\b/i;
/**
 * Server-side rejection texts when the thread does not exist (deleted or
 * archived); same evidence embassy's codex transport classifies as not_found.
 */
const THREAD_NOT_FOUND_PATTERN =
  /^(thread not found: |no rollout found for thread id |session .+ is archived\.)/i;
const OS_ERROR_PATTERN = /os error \d+/gi;
const STDERR_EXCERPT_CHARS = 300;
const DAEMON_START_HINT = 'codex app-server daemon 可能未启动，可运行: codex app-server daemon start';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function deliverToCodexThread(
  threadId: string,
  content: string,
  options: CodexDeliveryOptions = {},
): Promise<CodexDeliveryResult> {
  const mode = resolveDeliveryMode(options.mode);
  const desktopFactory = options.desktopFactory ?? (options.sessionFactory === undefined ? openDesktopThread : undefined);
  if (desktopFactory !== undefined) {
    const desktop = await desktopFactory(threadId);
    if (desktop !== null) return deliverDesktop(desktop, content, mode);
  }
  const stallTimeoutMs = Math.min(options.busyTimeoutMs ?? STALL_PARK_TIMEOUT_MS, STALL_PARK_TIMEOUT_MS);
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sessionFactory = options.sessionFactory ?? openCodexSession();

  let session: CodexSession;
  try {
    session = await sessionFactory();
  } catch (err) {
    throw spawnFailure(err);
  }

  let resumed = false;
  let threadBusy = false;
  try {
    try {
      await session.initialize();
      const deadline = Date.now() + stallTimeoutMs;
      // Disposition loop: idle -> start; busy -> steer or defer queue;
      // waiting_approval -> APPROVAL_REQUIRED (never answered for the user);
      // system_error -> fail; a TUI
      // active-writer rejection or not_loaded keep polling (legacy old-daemon
      // path; the server also loads asynchronously after resume).
      let writerHeld = false;
      for (;;) {
        let status: CodexThreadStatus | undefined;
        try {
          status = await session.resumeThread(threadId);
        } catch (err) {
          // A codex TUI window holds the thread writer, so the server rejects
          // resume. `codex queue` is NOT a fallback: it exits 0 but the
          // message never reaches the local TUI (measured black hole; the
          // feature looks remote-architecture only). Instead, wait for the
          // window to release the writer, then deliver headless.
          if (err instanceof CodexRpcRejectedError && ACTIVE_WRITER_PATTERN.test(err.message)) {
            writerHeld = true;
          } else if (
            err instanceof CodexRpcRejectedError &&
            THREAD_NOT_FOUND_PATTERN.test(err.message)
          ) {
            throw new MultichatError(
              'CODEX_THREAD_NOT_FOUND',
              `Codex thread ${threadId} 不存在（可能已删除），无法投递。`,
              { cause: err },
            );
          } else {
            throw err;
          }
        }
        if (status !== undefined) {
          resumed = true;
          if (status === 'idle' || status === 'busy') {
            threadBusy = status === 'busy';
            break;
          }
          if (status === 'waiting_approval') {
            throw new MultichatError(
              'CODEX_APPROVAL_REQUIRED',
              `Codex thread ${threadId} is waiting for an approval; only the user can answer it.`,
            );
          }
          if (status === 'system_error') {
            throw protocolFailure(`Codex thread ${threadId} is in system_error state.`, undefined);
          }
          // Resume succeeded, so no writer lock; only not_loaded remains,
          // which resolves asynchronously — keep polling.
          writerHeld = false;
        }
        if (Date.now() + pollIntervalMs > deadline) {
          if (writerHeld) {
            throw new MultichatError(
              'CODEX_THREAD_LOCKED',
              `Codex thread ${threadId} 正被 codex 窗口占用，等待 ${stallTimeoutMs / 1000}s 未释放。` +
                '关闭该窗口后重发将立即送达；或改投其它线程。',
            );
          }
          throw new MultichatError(
            'CODEX_THREAD_BUSY_TIMEOUT',
            `Codex thread ${threadId} did not become reachable within ${stallTimeoutMs}ms.`,
          );
        }
        await sleep(pollIntervalMs);
      }
    } catch (err) {
      if (
        err instanceof MultichatError &&
        (err.code === 'CODEX_APPROVAL_REQUIRED' ||
          err.code === 'CODEX_THREAD_BUSY_TIMEOUT' ||
          err.code === 'CODEX_THREAD_LOCKED' ||
          err.code === 'CODEX_THREAD_NOT_FOUND')
      ) {
        throw err;
      }
      // Pre-write failures (timeout, transport closed, rpc rejection, bad
      // frames) all collapse to CODEX_PROTOCOL_ERROR: nothing was written.
      const detail = err instanceof Error ? ` (${err.message})` : '';
      throw protocolFailure(`codex setup (initialize/resume) failed for ${threadId}.${detail}`, err);
    }

    if (mode === 'queue' && threadBusy) {
      throw new MultichatError('CODEX_THREAD_BUSY_TIMEOUT', 'Codex thread is busy; the message must wait in the crosschat queue.');
    }
    if (mode === 'steer' && threadBusy) {
      const steered = await steerCli(session, threadId, content);
      if (steered !== undefined) return steered;
    }
    let turn;
    try {
      turn = await session.startTurn(threadId, content);
    } catch (err) {
      if (err instanceof CodexRpcRejectedError) {
        throw new MultichatError(
          'CODEX_TURN_REJECTED',
          `Codex rejected the turn for thread ${threadId}: ${err.message}`,
          { cause: err },
        );
      }
      // Timeout/transport/protocol after the write was sent: acceptance is
      // unknown, and we never resend.
      throw new MultichatError(
        'CODEX_WRITE_UNCERTAIN',
        `Acceptance of the turn for thread ${threadId} could not be confirmed.`,
        { cause: err },
      );
    }
    if (turn.status !== 'inProgress') {
      throw new MultichatError(
        'CODEX_WRITE_UNCERTAIN',
        `Turn for thread ${threadId} returned unexpected status: ${turn.status}.`,
      );
    }
    return { status: 'accepted', turnId: turn.id, queued: false };
  } finally {
    if (resumed) {
      await session.unsubscribe(threadId).catch(() => undefined);
    }
    await session.close().catch(() => undefined);
  }
}

function approvalRequired(threadId: string): MultichatError {
  return new MultichatError('CODEX_APPROVAL_REQUIRED', `Codex thread ${threadId} is waiting for an approval; only the user can answer it.`);
}

async function deliverDesktop(session: DesktopThreadSession, content: string, mode: DeliveryMode): Promise<CodexDeliveryResult> {
  try {
    const snapshot = await session.snapshot();
    const status = normalizeThreadStatus(snapshot.rawStatus);
    if (status === 'waiting_approval') throw approvalRequired(session.threadId);
    if (status === 'system_error') throw protocolFailure('Desktop thread is in system_error state.', undefined);
    if (snapshot.idle && status === 'idle') return await desktopWrite(session, 'startTurn', content);
    if (mode === 'queue') throw new MultichatError('CODEX_THREAD_BUSY_TIMEOUT', 'Desktop thread is busy; the message must wait in the crosschat queue.');
    if (status !== 'busy' || snapshot.activeTurnId === null) throw protocolFailure('Desktop thread has no verified active turn or idle state.', undefined);
    try { return await desktopWrite(session, 'steerTurn', content); }
    catch (error) {
      if (error instanceof DesktopIpcError && error.stage === 'rejected' && error.code === 'CODEX_NO_ACTIVE_TURN') {
        const current = await session.snapshot();
        if (current.idle && normalizeThreadStatus(current.rawStatus) === 'idle') return await desktopWrite(session, 'startTurn', content);
      }
      throw error;
    }
  } finally { await session.close().catch(() => undefined); }
}

async function desktopWrite(session: DesktopThreadSession, method: 'startTurn' | 'steerTurn', content: string): Promise<CodexDeliveryResult> {
  try {
    const turnId = await session[method](content);
    if (typeof turnId !== 'string' || turnId === '') throw new Error('Missing native turn identity.');
    return { status: 'accepted', turnId, queued: false };
  } catch (error) {
    if (error instanceof DesktopIpcError) throw error;
    throw new MultichatError('CODEX_WRITE_UNCERTAIN', 'Desktop write acceptance could not be confirmed; it was not retried.', { cause: error });
  }
}

async function readCliState(session: CodexSession, threadId: string) {
  if (session.readThreadState === undefined) throw protocolFailure('This Codex session cannot attest the active turn for steer delivery.', undefined);
  try { return await session.readThreadState(threadId); }
  catch (error) { throw protocolFailure('Codex active turn could not be read before delivery.', error); }
}

/** undefined allows one start only after authoritative idle evidence. */
async function steerCli(session: CodexSession, threadId: string, content: string): Promise<CodexDeliveryResult | undefined> {
  const state = await readCliState(session, threadId);
  if (state.status === 'waiting_approval') throw approvalRequired(threadId);
  if (state.status === 'idle' && state.activeTurnId === null) return undefined;
  if (state.status !== 'busy' || state.activeTurnId === null) throw protocolFailure('Codex thread has no verified active turn.', undefined);
  try {
    const turnId = await session.steerTurn(threadId, state.activeTurnId, content);
    if (turnId !== state.activeTurnId) throw new Error('The native steer receipt did not match the expected active turn.');
    return { status: 'accepted', turnId, queued: false };
  } catch (error) {
    if (error instanceof CodexRpcRejectedError) {
      if (NO_ACTIVE_TURN_PATTERN.test(error.message)) {
        const current = await readCliState(session, threadId);
        if (current.status === 'idle' && current.activeTurnId === null) return undefined;
      }
      throw new MultichatError('CODEX_TURN_REJECTED', `Codex rejected steer for thread ${threadId}: ${error.message}`, { cause: error });
    }
    throw new MultichatError('CODEX_WRITE_UNCERTAIN', `Acceptance of steer for thread ${threadId} could not be confirmed.`, { cause: error });
  }
}

function protocolFailure(message: string, cause: unknown): MultichatError {
  return new MultichatError('CODEX_PROTOCOL_ERROR', message, { cause });
}

/**
 * CODEX_PROXY_SPAWN_FAILED with the underlying evidence attached: the bounded
 * stderr tail of the dead proxy (<=300 chars) and any os-error mentions from
 * the cause chain (e.g. "os error 10061", daemon socket refused).
 */
function spawnFailure(err: unknown): MultichatError {
  const base =
    err instanceof MultichatError && err.code === 'CODEX_PROXY_SPAWN_FAILED'
      ? err.message
      : 'Failed to establish the codex app-server proxy channel.';
  const { stderrTail, osErrors } = proxyFailureEvidence(err);
  const parts: string[] = [base];
  if (osErrors.length > 0) parts.push(`底层 OS 错误: ${osErrors.join(', ')}.`);
  if (stderrTail !== '') parts.push(`proxy stderr 尾部: ${stderrTail}`);
  if (!base.includes('executable not found')) parts.push(DAEMON_START_HINT);
  return new MultichatError('CODEX_PROXY_SPAWN_FAILED', parts.join(' '), { cause: err });
}

function proxyFailureEvidence(err: unknown): { stderrTail: string; osErrors: string[] } {
  const osErrors = new Set<string>();
  let stderrTail = '';
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    const text = (current as MultichatError).stderrText;
    if (stderrTail === '' && typeof text === 'string' && text !== '') {
      stderrTail = text.replace(/\s+/g, ' ').trim().slice(-STDERR_EXCERPT_CHARS);
    }
    for (const match of current.message.matchAll(OS_ERROR_PATTERN)) osErrors.add(match[0]);
    current = current.cause;
  }
  for (const match of stderrTail.matchAll(OS_ERROR_PATTERN)) osErrors.add(match[0]);
  return { stderrTail, osErrors: [...osErrors] };
}
