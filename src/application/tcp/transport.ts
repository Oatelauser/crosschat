import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import { join } from 'node:path';
import { isProcessAlive } from '../../platform/process-inspector.js';
import { buildStarSnapshot } from '../../serve/star-snapshot.js';
import { requestAdminOp, SenderConn } from '../../serve/via-tcp.js';
import { checkAbort, isRecord, readParsed } from '../queries/reading.js';
import type { TcpConfigurationOptions, TcpResolvedTarget } from './reading.js';
import { readTcpText } from './reading.js';

/** One bounded local read owns its IPC socket; it never invokes cold-path writers. */
async function localSnapshot(pipe: string, starId: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<unknown> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    let socket: Socket | undefined;
    let settled = false;
    let bytes = 0;
    const chunks: Buffer[] = [];
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      socket?.removeListener('data', onData); socket?.removeListener('error', onError); socket?.removeListener('close', onClose);
      socket?.destroy(); if (error) reject(error); else resolve(value);
    };
    const onAbort = () => finish(Object.assign(new Error('Snapshot read cancelled'), { name: 'AbortError' }));
    const onError = () => finish(new Error('Snapshot IPC unavailable'));
    const onClose = () => finish(new Error('Snapshot IPC closed without a reply'));
    const onData = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) { finish(new Error('Snapshot IPC exceeded read bound')); return; }
      chunks.push(chunk);
      const data = Buffer.concat(chunks);
      const newline = data.indexOf(10);
      if (newline < 0) return;
      try {
        const reply: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, newline)));
        if (!isRecord(reply) || reply.ok !== true || !('snapshot' in reply)) throw new Error('Snapshot IPC rejected');
        finish(undefined, reply.snapshot);
      } catch { finish(new Error('Snapshot IPC returned invalid metadata')); }
    };
    const timer = setTimeout(() => finish(new Error('Snapshot IPC timed out')), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      socket = createConnection({ path: pipe }, () => { socket!.write(`${JSON.stringify({ op: 'star-snapshot', starId })}\n`); });
      socket.on('data', onData); socket.on('error', onError); socket.on('close', onClose);
      if (signal?.aborted) onAbort();
    } catch { onError(); }
  });
}

/** New readonly snapshot capability; admin-op list audit rules remain untouched. */
export async function readTcpStarSnapshot(target: TcpResolvedTarget, signal: AbortSignal | undefined, options: TcpConfigurationOptions & { timeoutMs: number }): Promise<unknown> {
  checkAbort(signal);
  if (target.kind === 'local') {
    if (!target.star?.starId) throw new Error('An explicit local star is required');
    const file = join(options.baseDir, 'tcp', 'status-broker.json');
    const status = await readParsed(file, (raw): Record<string, unknown> => {
      const value: unknown = JSON.parse(raw);
      if (!isRecord(value) || typeof value.state !== 'string') throw new Error('Invalid broker status');
      return value;
    }, { signal, now: options.now, readText: options.readText ?? ((path, current) => readTcpText(options.baseDir, path, current)) });
    if (status.state === 'cancelled') checkAbort(signal);
    if (status.state === 'missing' || (status.value?.state === 'stopped')
      || (typeof status.value?.pid === 'number' && !isProcessAlive(status.value.pid))) {
      return buildStarSnapshot(target.star, { role: 'broker-owner', onlineMachines: new Set(), live: false });
    }
    if (!status.value || status.value.state !== 'running' || typeof status.value.adminPipe !== 'string' || !status.value.adminPipe) throw new Error('Live broker read capability unavailable');
    return localSnapshot(status.value.adminPipe, target.star.starId, signal, options.timeoutMs);
  }
  if (!target.entry) throw new Error('Missing TCP credentials');
  const entry = target.entry;
  const host = entry.host.includes(':') && !entry.host.startsWith('[') ? `[${entry.host}]` : entry.host;
  const connection = entry.adminKey ? await SenderConn.openAdmin(`ws://${host}:${entry.port}`, entry.adminKey, options.timeoutMs, signal)
    : await SenderConn.open(`ws://${host}:${entry.port}`, entry.key, undefined, options.timeoutMs, signal);
  const abort = () => connection.close();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    checkAbort(signal);
    if (!connection.starId || (entry.starId !== undefined && connection.starId !== entry.starId)) throw new Error('TCP star identity changed');
    const reply: unknown = await requestAdminOp(connection, 'star-snapshot', {}, options.timeoutMs);
    if (!isRecord(reply) || reply.ok !== true || !isRecord(reply.snapshot) || reply.snapshot.starId !== connection.starId) throw new Error('TCP snapshot identity mismatch');
    return reply.snapshot;
  } finally { signal?.removeEventListener('abort', abort); connection.close(); }
}
