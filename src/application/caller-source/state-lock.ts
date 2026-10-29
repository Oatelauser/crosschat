import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { Server } from 'node:net';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

export type SourceStateLockResult<T> = { acquired: true; value: T } | { acquired: false };

async function listen(server: Server, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { server.off('error', failed); server.off('listening', ready); };
    const failed = (error: NodeJS.ErrnoException) => {
      cleanup();
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolve(false);
      else reject(error);
    };
    const ready = () => { cleanup(); resolve(true); };
    server.once('error', failed);
    server.once('listening', ready);
    server.listen({ host: '127.0.0.1', port, exclusive: true });
  });
}

/** An OS-owned loopback listener releases the mutex even when its process dies. */
export async function withSourceStateLock<T>(
  directory: string,
  key: string,
  work: () => Promise<T>,
  timeoutMs = 1_000,
): Promise<SourceStateLockResult<T>> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) throw new Error('Invalid caller source lock timeout.');
  const canonical = await realpath(directory);
  const normalized = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  const hash = createHash('sha256').update(JSON.stringify([normalized, key])).digest();
  const port = 20_000 + hash.readUInt32BE(0) % 20_000;
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const server = createServer((socket) => socket.destroy());
    if (await listen(server, port)) {
      let failure: Error | undefined;
      const failed = (error: Error) => { failure = error; };
      server.on('error', failed);
      try {
        const value = await work();
        if (failure !== undefined) throw failure;
        return { acquired: true, value };
      } finally {
        try { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
        finally { server.off('error', failed); }
      }
    }
    const remaining = deadline - performance.now();
    if (remaining <= 0) return { acquired: false };
    await delay(Math.min(10, remaining));
  }
}
