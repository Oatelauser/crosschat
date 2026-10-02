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

/** Server-side rejection text when a codex TUI window holds the thread writer. */
const ACTIVE_WRITER_PATTERN = /already has an active writer/i;
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
      // A thread held open by a codex TUI window has an active writer; the
      // server rejects resume for it. This is a routing fact, not a protocol
      // fault, so it gets its own actionable code.
      if (err instanceof CodexRpcRejectedError && ACTIVE_WRITER_PATTERN.test(err.message)) {
        throw new MultichatError(
          'CODEX_THREAD_LOCKED',
          `Codex thread ${threadId} 正被 codex 窗口占用（开着=只读，关着=可投）。` +
            '关闭该窗口后重发，或改投未被占用的信箱线程。',
          { cause: err },
        );
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
