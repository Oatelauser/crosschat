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
}

export type ClaudeDeliveryResult = { status: 'delivered' };

/**
 * Deliver one user message to a running Claude session over its messaging
 * pipe: auth line + user frame, written once, never retried. Transport
 * failures surface as CLAUDE_PIPE_CONNECT_FAILED (never connected) or
 * CLAUDE_PIPE_WRITE_UNCERTAIN (failed after the write started).
 */
export async function deliverToClaudeSession(
  session: ClaudeDeliveryTarget,
  content: string,
  options: ClaudeDeliveryOptions = {},
): Promise<ClaudeDeliveryResult> {
  const sessionsDir = options.sessionsDir ?? defaultClaudeSessionsDir();
  const token = readPeerToken(sessionsDir, session.pid, session.messagingSocketPath);
  const lines = [encodeAuthLine(token), encodeUserFrame(content)];
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
