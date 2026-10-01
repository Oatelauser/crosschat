import { MultichatError } from '../errors.js';
import { openCodexSession, type CodexSession, type CodexSessionFactory } from './client.js';
import { CodexRpcRejectedError } from './rpc.js';

/**
 * One-shot delivery of a message into a Codex thread. Every operation runs the
 * full fresh flow: spawn proxy -> initialize -> resume -> disposition ->
 * turn/start -> confirm inProgress -> unsubscribe -> close. Never retried;
 * approvals are never answered on the user's behalf.
 */

export interface CodexDeliveryOptions {
  sessionFactory?: CodexSessionFactory;
  /** How long a busy thread is polled before giving up (default 120s). */
  busyTimeoutMs?: number;
  /** Re-resume poll interval while waiting for a busy thread (default 3s). */
  pollIntervalMs?: number;
}

export interface CodexDeliveryResult {
  status: 'accepted';
  turnId: string;
}

const DEFAULT_BUSY_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 3_000;

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
    if (err instanceof MultichatError && err.code === 'CODEX_PROXY_SPAWN_FAILED') throw err;
    throw new MultichatError(
      'CODEX_PROXY_SPAWN_FAILED',
      'Failed to establish the codex app-server proxy channel.',
      { cause: err },
    );
  }

  let resumed = false;
  try {
    try {
      await session.initialize();
      const deadline = Date.now() + busyTimeoutMs;
      // Disposition: idle -> proceed; busy -> wait for idle; waiting_approval
      // -> APPROVAL_REQUIRED (never answered for the user); not_loaded keeps
      // polling (the server loads asynchronously after resume).
      for (;;) {
        const status = await session.resumeThread(threadId);
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
        if (Date.now() + pollIntervalMs > deadline) {
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
        (err.code === 'CODEX_APPROVAL_REQUIRED' || err.code === 'CODEX_THREAD_BUSY_TIMEOUT')
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
