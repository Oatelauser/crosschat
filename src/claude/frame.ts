import { randomUUID } from 'node:crypto';
import { resolveDeliveryMode } from '../delivery-mode.js';
import type { DeliveryMode } from '../delivery-mode.js';

/**
 * Peer protocol v1 single-line frames (no trailing newline; the transport
 * appends it). later waits for turn end; next folds into the current turn.
 */
export interface ClaudeUserFrame {
  msgV: 1;
  msg_id: string;
  type: 'user';
  message: { role: 'user'; content: string };
  priority: 'next' | 'later';
}

export function encodeUserFrame(content: string, messageId: string = randomUUID(), mode: DeliveryMode = 'queue'): string {
  const frame: ClaudeUserFrame = {
    msgV: 1,
    msg_id: messageId,
    type: 'user',
    message: { role: 'user', content },
    priority: resolveDeliveryMode(mode) === 'steer' ? 'next' : 'later',
  };
  return JSON.stringify(frame);
}

/** Mandatory first line on Windows pipes (docs/research/claude-windows-pipe.md §3). */
export function encodeAuthLine(token: string): string {
  return JSON.stringify({ type: 'auth', token });
}
