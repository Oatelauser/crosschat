import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { SenderConn, requestMemberRemoveExact } from '../src/serve/via-tcp.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

describe('endpoint identity capability guard', () => {
  it('refuses typed membership writes before sending to a broker that cannot preserve endpoint identity', async () => {
    const received: unknown[] = [];
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    server.on('connection', (socket) => {
      socket.send(JSON.stringify({ op: 'info', proto: 1, server: 'fixture', caps: ['multi-star'] }));
      socket.on('message', (data) => {
        const frame = JSON.parse(data.toString());
        if (frame.op === 'connect') socket.send(JSON.stringify({ op: 'connected', starId: 'star-a' }));
        else {
          received.push(frame);
          socket.send(JSON.stringify({ op: 'member-remove-exact-result', id: frame.id, ok: true, removed: true }));
        }
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture address');
    const conn = await SenderConn.open(`ws://127.0.0.1:${address.port}`, 'fixture-key', undefined, 500);
    cleanups.push(() => conn.close());
    await expect(requestMemberRemoveExact(conn, { sessionId: 'same-native-id', tool: 'codex', endpointType: 'desktop', machine: 'a'.repeat(32) }, 500)).rejects.toMatchObject({ code: 'BAD_PROTO' });
    expect(received).toEqual([]);
  });
});
