import { MultichatError } from '../errors.js';
import {
  openCodexSession,
  type CodexSession,
  type CodexSessionFactory,
  type CodexThreadStatus,
} from './client.js';
import { CodexRpcRejectedError } from './rpc.js';

/**
 * One-shot delivery of a message into a Codex thread. Every operation runs the
 * full fresh flow: spawn proxy -> initialize -> resume -> disposition ->
 * turn/start -> confirm inProgress -> unsubscribe -> close. When resume is
 * rejected because a TUI window holds the writer, delivery polls until the
 * window releases it (busyTimeoutMs), then delivers headless; on timeout it
 * fails with CODEX_THREAD_LOCKED. Never retried otherwise; approvals are never
 * answered on the user's behalf.
 */

export interface CodexDeliveryOptions {
  sessionFactory?: CodexSessionFactory;
  /** How long a busy or writer-locked thread is polled before giving up (default 120s). */
  busyTimeoutMs?: number;
  /** Re-resume poll interval while waiting for a busy or writer-locked thread (default 3s). */
  pollIntervalMs?: number;
}

export type CodexDeliveryResult = { status: 'accepted'; turnId: string };

const DEFAULT_BUSY_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 3_000;

/** Server-side rejection text when a codex TUI window holds the thread writer. */
const ACTIVE_WRITER_PATTERN = /already has an active writer/i;
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
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sessionFactory = options.sessionFactory ?? openCodexSession();

  let session: CodexSession;
  try {
    session = await sessionFactory();
  } catch (err) {
    throw spawnFailure(err);
  }

  let resumed = false;
  try {
    try {
      await session.initialize();
      const deadline = Date.now() + busyTimeoutMs;
      // Disposition loop: idle -> proceed; busy or TUI active-writer -> poll
      // for release (both release into the same headless delivery);
      // waiting_approval -> APPROVAL_REQUIRED (never answered for the user);
      // system_error -> fail; not_loaded keeps polling (the server loads
      // asynchronously after resume).
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
          if (status === 'idle') break;
          if (status === 'waiting_approval') {
            throw new MultichatError(
              'CODEX_APPROVAL_REQUIRED',
              `Codex thread ${threadId} is waiting for an approval; only the user can answer it.`,
            );
          }
          if (status === 'system_error') {
            throw protocolFailure(`Codex thread ${threadId} is in system_error state.`, undefined);
          }
          // Resume succeeded, so no writer lock; the thread is merely busy.
          writerHeld = false;
        }
        if (Date.now() + pollIntervalMs > deadline) {
          if (writerHeld) {
            throw new MultichatError(
              'CODEX_THREAD_LOCKED',
              `Codex thread ${threadId} 正被 codex 窗口占用，等待 ${busyTimeoutMs / 1000}s 未释放。` +
                '关闭该窗口后重发将立即送达；或改投其它线程。',
            );
          }
          throw new MultichatError(
            'CODEX_THREAD_BUSY_TIMEOUT',
            `Codex thread ${threadId} stayed busy longer than ${busyTimeoutMs}ms.`,
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
    return { status: 'accepted', turnId: turn.id };
  } finally {
    if (resumed) {
      await session.unsubscribe(threadId).catch(() => undefined);
    }
    await session.close().catch(() => undefined);
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
