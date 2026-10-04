import process from 'node:process';
import { getPipeTransport, type PipeTransport } from '../platform/pipe-transport.js';
import { MultichatError } from '../errors.js';
import { encodeAuthLine, encodeUserFrame } from './frame.js';
import { readPeerToken } from './key-file.js';
import { defaultClaudeSessionsDir } from './registry.js';

export interface ClaudeDeliveryTarget {
  pid: number;
  messagingSocketPath: string;
}

export interface ClaudeDeliveryOptions {
  sessionsDir?: string;
  transport?: PipeTransport;
  /** Defaults to process.platform; injectable so both branches test on any CI. */
  platform?: NodeJS.Platform;
}

export type ClaudeDeliveryResult = { status: 'delivered' };

/**
 * Deliver one user message to a running Claude session over its messaging
 * pipe, written once, never retried. On win32 the payload is auth line +
 * user frame, the token read from the session's key file; on unix only the
 * user frame is sent — no key file, no auth line
 * (docs/research/claude-unix-socket.md: the auth line is optional there,
 * same-uid kernel credentials are the identity). Transport failures surface
 * as CLAUDE_PIPE_CONNECT_FAILED (never connected) or
 * CLAUDE_PIPE_WRITE_UNCERTAIN (failed after the write started).
 */
export async function deliverToClaudeSession(
  session: ClaudeDeliveryTarget,
  content: string,
  options: ClaudeDeliveryOptions = {},
): Promise<ClaudeDeliveryResult> {
  const sessionsDir = options.sessionsDir ?? defaultClaudeSessionsDir();
  const platform = options.platform ?? process.platform;
  let lines: string[];
  if (platform === 'win32') {
    const token = readPeerToken(sessionsDir, session.pid, session.messagingSocketPath);
    lines = [encodeAuthLine(token), encodeUserFrame(content)];
  } else {
    lines = [encodeUserFrame(content)];
  }
  const transport = options.transport ?? getPipeTransport();
  try {
    await transport.sendLines(session.messagingSocketPath, lines);
  } catch (err) {
    if (err instanceof MultichatError) {
      if (err.code === 'PIPE_CONNECT_FAILED') {
        throw new MultichatError(
          'CLAUDE_PIPE_CONNECT_FAILED',
          `Cannot connect to the messaging pipe of Claude pid ${session.pid}.`,
          { cause: err },
        );
      }
      if (err.code === 'PIPE_WRITE_UNCERTAIN') {
        throw new MultichatError(
          'CLAUDE_PIPE_WRITE_UNCERTAIN',
          `Write to the messaging pipe of Claude pid ${session.pid} failed mid-flight; delivery state unknown.`,
          { cause: err },
        );
      }
    }
    throw err;
  }
  return { status: 'delivered' };
}
