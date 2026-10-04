import { createConnection } from 'node:net';
import process from 'node:process';
import { MultichatError } from '../errors.js';

/** Windows named pipe path prefix used by Claude Code messaging sockets. */
export const PIPE_PREFIX = '\\\\.\\pipe\\';

/**
 * Platform seam (Q7b): write newline-delimited lines to a session messaging
 * pipe. Each line is written verbatim; a trailing newline is appended when
 * missing. The whole payload is written once per connection, then the socket
 * is ended. Implementations never retry.
 */
export interface PipeTransport {
  sendLines(pipePath: string, lines: readonly string[]): Promise<void>;
}

export class WindowsNamedPipeTransport implements PipeTransport {
  async sendLines(pipePath: string, lines: readonly string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let connected = false;
      let ended = false;
      let lastError: Error | undefined;
      let flushTimer: NodeJS.Timeout | undefined;

      const settle = (outcome: () => void) => {
        if (settled) return;
        settled = true;
        if (flushTimer !== undefined) clearTimeout(flushTimer);
        outcome();
      };
      // The peer normally closes the connection right after our EOF; a short
      // grace period lets a broken pipe surface as an error (named pipes can
      // report the write error a tick AFTER the end callback) instead of a
      // false "delivered" when the peer just holds the connection open.
      const FLUSH_GRACE_MS = 250;

      const socket = createConnection({ path: pipePath }, () => {
        connected = true;
        try {
          for (const line of lines) {
            socket.write(line.endsWith('\n') ? line : `${line}\n`);
          }
          socket.end(() => {
            ended = true;
            flushTimer = setTimeout(() => settle(resolve), FLUSH_GRACE_MS);
          });
        } catch (err) {
          lastError = err as Error;
          socket.destroy();
        }
      });

      socket.on('error', (err: Error) => {
        lastError = err;
      });
      socket.on('close', (hadError: boolean) => {
        if (hadError || lastError !== undefined || !ended) {
          if (!connected) {
            settle(() =>
              reject(
                new MultichatError('PIPE_CONNECT_FAILED', `Cannot connect to pipe ${pipePath}.`, {
                  cause: lastError,
                }),
              ),
            );
          } else {
            settle(() =>
              reject(
                new MultichatError(
                  'PIPE_WRITE_UNCERTAIN',
                  `Connection to pipe ${pipePath} failed or closed early; delivery state unknown.`,
                  { cause: lastError },
                ),
              ),
            );
          }
        } else {
          settle(resolve);
        }
      });
    });
  }
}

/**
 * Unix domain socket transport: identical wire semantics to the Windows
 * named pipe transport, because `net.createConnection({ path })` addresses
 * a UDS with the same API. Writes newline-delimited lines once per
 * connection, ends the socket after the last write, never retries.
 */
export class PosixPipeTransport implements PipeTransport {
  async sendLines(pipePath: string, lines: readonly string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let connected = false;
      let ended = false;
      let lastError: Error | undefined;
      let flushTimer: NodeJS.Timeout | undefined;

      const settle = (outcome: () => void) => {
        if (settled) return;
        settled = true;
        if (flushTimer !== undefined) clearTimeout(flushTimer);
        outcome();
      };
      // The peer normally closes the connection right after our EOF; a short
      // grace period lets a broken socket surface as an error (the write
      // error can arrive a tick AFTER the end callback) instead of a false
      // "delivered" when the peer just holds the connection open.
      const FLUSH_GRACE_MS = 250;

      const socket = createConnection({ path: pipePath }, () => {
        connected = true;
        try {
          for (const line of lines) {
            socket.write(line.endsWith('\n') ? line : `${line}\n`);
          }
          socket.end(() => {
            ended = true;
            flushTimer = setTimeout(() => settle(resolve), FLUSH_GRACE_MS);
          });
        } catch (err) {
          lastError = err as Error;
          socket.destroy();
        }
      });

      socket.on('error', (err: Error) => {
        lastError = err;
      });
      socket.on('close', (hadError: boolean) => {
        if (hadError || lastError !== undefined || !ended) {
          if (!connected) {
            settle(() =>
              reject(
                new MultichatError('PIPE_CONNECT_FAILED', `Cannot connect to socket ${pipePath}.`, {
                  cause: lastError,
                }),
              ),
            );
          } else {
            settle(() =>
              reject(
                new MultichatError(
                  'PIPE_WRITE_UNCERTAIN',
                  `Connection to socket ${pipePath} failed or closed early; delivery state unknown.`,
                  { cause: lastError },
                ),
              ),
            );
          }
        } else {
          settle(resolve);
        }
      });
    });
  }
}

export function getPipeTransport(): PipeTransport {
  return process.platform === 'win32' ? new WindowsNamedPipeTransport() : new PosixPipeTransport();
}
