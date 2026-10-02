import { randomUUID } from 'node:crypto';

/**
 * Peer protocol v1 single-line frames (no trailing newline; the transport
 * appends it). Byte-compatible with embassy's encodeClaudePeerUserFrame.
 */
export interface ClaudeUserFrame {
  msgV: 1;
  msg_id: string;
  type: 'user';
  message: { role: 'user'; content: string };
  priority: 'next';
}

export function encodeUserFrame(content: string, messageId: string = randomUUID()): string {
  const frame: ClaudeUserFrame = {
    msgV: 1,
    msg_id: messageId,
    type: 'user',
    message: { role: 'user', content },
    priority: 'next',
  };
  return JSON.stringify(frame);
}

/** Mandatory first line on Windows pipes (docs/research/claude-windows-pipe.md §3). */
export function encodeAuthLine(token: string): string {
  return JSON.stringify({ type: 'auth', token });
}
