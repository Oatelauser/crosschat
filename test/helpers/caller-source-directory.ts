import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

/** Test setup only: choose a fresh directory whose deterministic mutex ports are free. */
export async function sourceStateDirectory(prefix: string, keys: readonly string[]): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const directory = await mkdtemp(join(tmpdir(), prefix));
    const listeners: Server[] = [];
    let available = true;
    try {
      const ports = new Set(await Promise.all(keys.map((key) => sourceStatePort(directory, key))));
      for (const port of ports) {
        const listener = await occupySourceStatePort(port);
        if (listener === undefined) { available = false; break; }
        listeners.push(listener);
      }
    } catch (error) {
      available = false;
      throw error;
    } finally {
      await Promise.all(listeners.map(closeSourceStateListener));
      if (!available) await rm(directory, { recursive: true, force: true });
    }
    if (available) return directory;
  }
  throw new Error('Could not allocate an isolated caller-source fixture directory with free mutex ports.');
}

/** Predict the documented mutex coordinate without acquiring or mutating production state. */
export async function sourceStatePort(directory: string, key: string): Promise<number> {
  const canonical = await realpath(directory);
  const normalized = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  return 20_000 + createHash('sha256').update(JSON.stringify([normalized, key])).digest().readUInt32BE(0) % 20_000;
}

export async function occupySourceStatePort(port: number): Promise<Server | undefined> {
  const server = createServer((socket) => socket.destroy());
  return new Promise((resolve, reject) => {
    const cleanup = () => { server.off('error', failed); server.off('listening', ready); };
    const failed = (error: NodeJS.ErrnoException) => {
      cleanup();
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolve(undefined);
      else reject(error);
    };
    const ready = () => { cleanup(); resolve(server); };
    server.once('error', failed);
    server.once('listening', ready);
    server.listen({ host: '127.0.0.1', port, exclusive: true });
  });
}

export async function closeSourceStateListener(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
