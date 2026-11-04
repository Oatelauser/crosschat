import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SenderConn, requestMemberRemoveExact } from '../src/serve/via-tcp.js';
import { NodeClient } from '../src/serve/node.js';
import { FileInbox } from '../src/serve/file-channel.js';
import { encodeOrigin } from '../src/federation.js';
import { encodeRef, newConversationRef } from '../src/ref.js';
import type { SendFrame } from '../src/serve/protocol.js';

const endpointSends: ReadonlyArray<Partial<SendFrame>> = [
  { conversation: encodeRef(newConversationRef({ p: 'codex', id: 'initiator', endpointType: 'cli' }, { p: 'codex', id: 'recipient' })) },
  { conversation: encodeRef(newConversationRef({ p: 'codex', id: 'initiator' }, { p: 'codex', id: 'recipient', endpointType: 'desktop' })) },
  { origin: encodeOrigin({ p: 'codex', id: 'initiator', endpointType: 'cli' }, 'sender-machine') },
];

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

describe('endpoint identity capability guard', () => {
  it.each(endpointSends)('refuses typed conversation/origin before writing to an incapable broker: %j', async (identity) => {
    const received: unknown[] = [];
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    server.on('connection', (socket) => {
      socket.send(JSON.stringify({ op: 'info', proto: 1, server: 'fixture', caps: ['multi-star'] }));
      socket.on('message', (data) => {
        const frame = JSON.parse(data.toString());
        if (frame.op === 'connect') socket.send(JSON.stringify({ op: 'connected', starId: 'star-a' }));
        else received.push(frame);
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture address');
    const conn = await SenderConn.open(`ws://127.0.0.1:${address.port}`, 'fixture-key', undefined, 500);
    cleanups.push(() => conn.close());
    await expect(conn.send({ op: 'send', id: 'typed-send', targetMachine: 'target-machine', body: 'test', ...identity })).rejects.toMatchObject({ code: 'BAD_PROTO' });
    expect(received).toEqual([]);
  });

  it('does not replay an uncertain lifecycle removal while readonly roster still reports the same temporary member', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crosschat-endpoint-uncertain-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    let removals = 0;
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    server.on('connection', (socket) => {
      socket.send(JSON.stringify({ op: 'info', proto: 1, server: 'fixture', caps: ['multi-star', 'session-members', 'endpoint-types-v1'] }));
      socket.on('message', (data) => {
        const frame = JSON.parse(data.toString());
        if (frame.op === 'connect') socket.send(JSON.stringify({ op: 'connected', starId: 'star-a' }));
        if (frame.op === 'members-query') socket.send(JSON.stringify({ op: 'members-result', members: [
          { sessionId: 'uncertain-member', tool: 'claude', endpointType: 'cli', temporary: true, selectionOwned: true },
        ] }));
        if (frame.op === 'member-remove') removals++;
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture address');
    const node = new NodeClient({ config: { entries: [{ host: '127.0.0.1', port: address.port, key: 'fixture', starId: 'star-a' }] },
      configFile: join(dir, 'node.json'), attachLabel: dir.split(/[\\/]/).at(-1), machineId: () => 'a'.repeat(32),
      fileInbox: new FileInbox({ inboxDir: join(dir, 'inbox'), partsDir: join(dir, 'parts') }), now: Date.now, log: () => undefined,
      makeSendDeps: () => { throw new Error('No native message delivery'); }, memberCheckMs: 25,
      memberProviders: () => [{ providerId: 'claude', liveness: { probe: async ({ nativeId }) => ({ nativeId, presence: 'absent', name: null, completeness: 'complete', errors: [], observedAt: 1 }) }, readName: async () => undefined }] });
    const running = node.run();
    cleanups.push(async () => { await node.stop(); await running; });
    await node.waitForState('online');
    await new Promise((resolve) => setTimeout(resolve, 5_400));
    expect(removals).toBe(1);
  }, 9_000);

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
