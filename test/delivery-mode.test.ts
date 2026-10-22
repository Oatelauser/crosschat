import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSendArgs } from '../src/cli.js';
import { sendMessage } from '../src/application/send/index.js';
import type { SendDeps } from '../src/application/send/types.js';
import { buildSshArgv } from '../src/federation.js';
import { deliverViaRunSend } from '../src/serve/node.js';
import { parseFrame } from '../src/serve/protocol.js';
import { parseDiscoveryResponse } from '../src/application/discovery/boundary.js';
import { outboxCount, park } from '../src/outbox.js';
import { MultichatError } from '../src/errors.js';
import { sendViaTcp } from '../src/serve/via-tcp.js';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture(): SendDeps {
  const directory = mkdtempSync(join(tmpdir(), 'crosschat-delivery-mode-'));
  directories.push(directory);
  return {
    env: { CODEX_THREAD_ID: 'sender' },
    listClaudeSessions: () => ({ sessions: [{ pid: 1, sessionId: 'claude-target', name: 'claude-worker', kind: 'interactive', status: 'busy', messagingSocketPath: 'fake' }], malformed: 0 }),
    listCodexThreads: async () => [{ id: 'codex-target', name: 'worker', status: 'busy' }],
    deliverClaude: vi.fn(async () => ({ status: 'delivered' as const })),
    deliverCodex: vi.fn(async () => ({ status: 'accepted' as const, turnId: 'native-turn' })),
    sendLogFile: join(directory, 'send-log.jsonl'), outboxDir: join(directory, 'outbox'), tcpBaseDir: directory, now: () => 100,
  };
}

describe('per-message delivery mode', () => {
  it('parses both option forms and rejects unknown mode values', () => {
    expect(parseSendArgs(['--to', 'worker', '--delivery', 'steer'])).toMatchObject({ delivery: 'steer' });
    expect(parseSendArgs(['--delivery=queue'])).toMatchObject({ delivery: 'queue' });
    expect(() => parseSendArgs(['--delivery=interrupt'])).toThrow(expect.objectContaining({ code: 'USAGE' }));
    expect(() => parseSendArgs(['--delivery'])).toThrow(/requires a value/);
  });

  it('defaults each send and reply to queue while forwarding explicit steer', async () => {
    const deps = fixture();
    const first = await sendMessage({ to: 'claude-worker', bodyArg: 'append', delivery: 'steer' }, deps);
    expect(deps.deliverClaude).toHaveBeenLastCalledWith(expect.any(Object), expect.any(String), { mode: 'steer' });
    await sendMessage({ conversation: first.receipt.replyRef, bodyArg: 'next independent message' }, deps);
    expect(deps.deliverClaude).toHaveBeenLastCalledWith(expect.any(Object), expect.any(String), { mode: 'queue' });
  });

  it('steers immediately past parked queue items without consuming them', async () => {
    const deps = fixture();
    park(deps.outboxDir, 'codex-target', { envelope: 'older queue item', toName: 'worker' }, 1);
    const result = await sendMessage({ to: 'worker', bodyArg: 'append now', delivery: 'steer' }, deps);
    expect(result.status).toBe('delivered');
    expect(result.deliveryMode).toBe('steer');
    expect(deps.deliverCodex).toHaveBeenCalledWith('codex-target', expect.any(String), { mode: 'steer' });
    expect(outboxCount(deps.outboxDir, 'codex-target')).toBe(1);
  });

  it('keeps queue FIFO and does not park a rejected steer', async () => {
    const deps = fixture();
    park(deps.outboxDir, 'codex-target', { envelope: 'older', toName: 'worker' }, 1);
    expect((await sendMessage({ to: 'worker', bodyArg: 'queue default' }, deps)).status).toBe('parked');
    expect(deps.deliverCodex).not.toHaveBeenCalled();
    const rejected = { ...deps, deliverCodex: vi.fn(async () => { throw new MultichatError('CODEX_THREAD_LOCKED', 'not writable'); }) };
    await expect(sendMessage({ to: 'worker', bodyArg: 'steer refused', delivery: 'steer' }, rejected)).rejects.toMatchObject({ code: 'CODEX_THREAD_LOCKED' });
    expect(rejected.deliverCodex).toHaveBeenCalledOnce();
    expect(outboxCount(deps.outboxDir, 'codex-target')).toBe(2);
  });

  it('rejects an invalid programmatic mode before discovery or delivery', async () => {
    const deps = fixture();
    const invalid = { to: 'worker', bodyArg: 'body', delivery: 'queue' as const };
    Object.assign(invalid, { delivery: 'interrupt' });
    await expect(sendMessage(invalid, deps)).rejects.toMatchObject({ code: 'USAGE' });
    expect(deps.deliverCodex).not.toHaveBeenCalled();
  });

  it('rejects invalid mode at the public TCP entry before opening config or a connection', async () => {
    const invalid = { via: 'tcp:missing', conversation: 'mc1_x', delivery: 'queue' as const };
    Object.assign(invalid, { delivery: 'interrupt' });
    await expect(sendViaTcp(invalid, 'body', fixture())).rejects.toThrow('--delivery must be queue or steer');
  });

  it('forwards an explicit mode through the SSH command whitelist', () => {
    const args = { to: 'worker', delivery: 'steer' as const };
    expect(buildSshArgv('host', args, 'origin')).toContain('--delivery');
    expect(buildSshArgv('host', args, 'origin')).toContain('steer');
  });

  it('preserves a mode through the receiving TCP bridge', async () => {
    const deps = fixture();
    const frame = { op: 'deliver' as const, id: 'message', payload: 'append', to: 'worker', delivery: 'steer' as const };
    const result = await deliverViaRunSend(frame, deps);
    expect(result.status).toBe('delivered');
    expect(deps.deliverCodex).toHaveBeenCalledWith('codex-target', expect.any(String), { mode: 'steer' });
  });

  it.each(['send', 'deliver'])('rejects unknown delivery enums in %s network frames', (op) => {
    expect(parseFrame(JSON.stringify({ op, id: 'id', targetMachine: 'node', body: 'hello', payload: 'hello', delivery: 'interrupt' }))).toBeUndefined();
  });
});

describe('delivery capability DTO boundary', () => {
  const response = (deliveryModes: unknown) => ({ op: 'list', providers: [{ providerId: 'third', capabilities: { discovery: true, delivery: true, launch: false, diagnostics: false, deliveryModes } }], page: { items: [], nextCursor: null, completeness: 'complete', observedAt: 1, errors: [] } });
  it('retains optional typed modes for any provider without inventing capabilities when absent', () => {
    expect(parseDiscoveryResponse(response(['queue', 'steer'])).providers[0]?.capabilities).toHaveProperty('deliveryModes', ['queue', 'steer']);
    expect(parseDiscoveryResponse(response(undefined)).providers[0]?.capabilities).not.toHaveProperty('deliveryModes');
  });
  it.each([{ modes: ['interrupt'] }, { modes: 'queue' }, { modes: ['queue', 'queue'] }, { modes: [null] }])('rejects malformed modes $modes', ({ modes }) => {
    expect(() => parseDiscoveryResponse(response(modes))).toThrow(/Malformed discovery/);
  });
});
