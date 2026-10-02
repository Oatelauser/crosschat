import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MultichatError } from '../errors.js';
import { PIPE_PREFIX } from '../platform/pipe-transport.js';

/**
 * Claude Code normalizes the pipe path before hashing: keep the
 * `\\.\pipe\` prefix, lowercase everything after it
 * (docs/research/claude-windows-pipe.md §3, verified against live samples).
 */
export function normalizePipePath(messagingSocketPath: string): string {
  if (!messagingSocketPath.startsWith(PIPE_PREFIX)) {
    throw new MultichatError(
      'CLAUDE_PIPE_PATH_INVALID',
      `Not a Windows named pipe path: ${JSON.stringify(messagingSocketPath)}`,
    );
  }
  return PIPE_PREFIX + messagingSocketPath.slice(PIPE_PREFIX.length).toLowerCase();
}

/** Key file name: `<pid>.<sha256(normalized pipe path)>.key`. */
export function keyFileName(pid: number, messagingSocketPath: string): string {
  const digest = createHash('sha256')
    .update(normalizePipePath(messagingSocketPath), 'utf8')
    .digest('hex');
  return `${pid}.${digest}.key`;
}

/** Read the peerToken bound to a session's messaging pipe. */
export function readPeerToken(
  sessionsDir: string,
  pid: number,
  messagingSocketPath: string,
): string {
  const filePath = join(sessionsDir, keyFileName(pid, messagingSocketPath));
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new MultichatError(
      'CLAUDE_KEY_FILE_MISSING',
      `Cannot read key file for pid ${pid}: ${filePath}`,
      { cause: err },
    );
  }
  try {
    const parsed = JSON.parse(text) as { peerToken?: unknown };
    if (typeof parsed.peerToken !== 'string' || parsed.peerToken === '') {
      throw new Error('peerToken missing or empty');
    }
    return parsed.peerToken;
  } catch (err) {
    throw new MultichatError(
      'CLAUDE_KEY_FILE_INVALID',
      `Key file for pid ${pid} has no usable peerToken: ${filePath}`,
      { cause: err },
    );
  }
}
