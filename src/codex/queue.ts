import { spawn } from 'node:child_process';
import process from 'node:process';
import { MultichatError } from '../errors.js';
import { resolveCodexExecutable } from './transport.js';

/**
 * Delivery via `codex queue --thread <id> --message <content>`: the one
 * channel that reaches a thread even while a codex TUI window holds the
 * writer (open window = delivered live in ~2s; closed window = stored until
 * the next resume). Used by deliver.ts as the fallback when thread/resume is
 * rejected with "already has an active writer".
 */

/** Minimal child shape queueToCodexThread consumes; real ChildProcess fits. */
export interface CodexQueueProcess {
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'close', listener: (code: number | null, signal: string | null) => void): unknown;
  stderr?: { on(event: 'data', listener: (chunk: Buffer) => void): unknown } | null;
  kill(): void;
}

export type CodexQueueSpawner = (command: string, args: readonly string[]) => CodexQueueProcess;

export interface CodexQueueOptions {
  executable?: string;
  /** How long the CLI may run before it is killed (default 30s). */
  timeoutMs?: number;
  /** Test seam: spawns the queue CLI process. */
  spawnProcess?: CodexQueueSpawner;
}

export interface CodexQueueResult {
  status: 'queued';
}

const DEFAULT_QUEUE_TIMEOUT_MS = 30_000;
const STDERR_EXCERPT_CHARS = 300;
const STDERR_CAPTURE_LIMIT = 4_096;

/**
 * The message travels as a single argv element (`--message <content>`), so
 * there is no shell quoting involved. Windows caps the command line at ~32K
 * characters; multichat's 16KiB body limit (enforced in commands/send.ts)
 * plus the envelope overhead keeps argv safely below that ceiling.
 */
export async function queueToCodexThread(
  threadId: string,
  content: string,
  options: CodexQueueOptions = {},
): Promise<CodexQueueResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS;
  const command = options.executable ?? resolveCodexExecutable();
  const doSpawn: CodexQueueSpawner =
    options.spawnProcess ??
    ((cmd, args) =>
      spawn(cmd, [...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
        env: process.env,
      }) as unknown as CodexQueueProcess);

  return new Promise<CodexQueueResult>((resolve, reject) => {
    let child: CodexQueueProcess;
    try {
      child = doSpawn(command, ['queue', '--thread', threadId, '--message', content]);
    } catch (err) {
      reject(queueFailed(threadId, command, 'process could not be spawned', err));
      return;
    }
    let stderrText = '';
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle();
    };
    const timer = setTimeout(() => {
      finish(() => {
        try {
          child.kill();
        } catch {
          // already dead
        }
        reject(queueFailed(threadId, command, `timed out after ${timeoutMs}ms`));
      });
    }, timeoutMs);
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrText.length < STDERR_CAPTURE_LIMIT) stderrText += chunk.toString('utf8');
    });
    child.on('error', (err) =>
      finish(() => reject(queueFailed(threadId, command, 'process error', err, stderrText))),
    );
    // 'close' (not 'exit'): fires after the stdio pipes drained, so stderr is in.
    child.on('close', (code) =>
      finish(() => {
        if (code === 0) resolve({ status: 'queued' });
        else reject(queueFailed(threadId, command, `exited with code ${code}`, undefined, stderrText));
      }),
    );
  });
}

function queueFailed(
  threadId: string,
  command: string,
  reason: string,
  cause?: unknown,
  stderrText = '',
): MultichatError {
  const excerpt =
    stderrText === '' ? '' : ` stderr: ${stderrText.replace(/\s+/g, ' ').trim().slice(0, STDERR_EXCERPT_CHARS)}`;
  return new MultichatError(
    'CODEX_QUEUE_FAILED',
    `codex queue for thread ${threadId} failed (${command}): ${reason}.${excerpt}`,
    { cause, stderrText: stderrText === '' ? undefined : stderrText },
  );
}
