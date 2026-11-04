import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Broker } from '../src/serve/broker.js';
import { NodeClient, attachPipePath } from '../src/serve/node.js';
import { connectAttachPipe } from '../src/serve/attach-client.js';
import { writeBrokerFile } from '../src/serve/registry.js';
import { FileInbox } from '../src/serve/file-channel.js';
import type { DshThread } from '../src/dsh/client.js';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

describe('DeepSeek Harness native member wiring in a real controlled node', () => {
  it('keeps a verified Harness member alive and never uses Harness to keep an exited other-tool member alive', async () => {
    const root = mkdtempSync(join(tmpdir(), 'crosschat-dsh-node-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'tcp'));
    const key = 'a'.repeat(64);
    const machine = '11111111222233334444555555555555';
    const registryFile = join(root, 'broker.json');
    writeBrokerFile(registryFile, { stars: [{ starId: 'dsh-fixture-star', name: 'dsh-fixture', nodes: [{ label: 'member', key, addedAt: '2026-01-01' }], roster: [] }] });
    const broker = new Broker({ registryFile, statusFile: join(root, 'status-broker.json'), port: 0, version: 'fixture', machineId: () => '66666666777788889999aaaaaaaaaaaa',
      hostname: () => 'fixture', now: Date.now, log: () => {}, deliverLocal: async (frame) => ({ op: 'result', id: frame.id, status: 'delivered' }), heartbeatMs: 60_000 });
    const port = await broker.start(); cleanup.push(() => broker.stop());
    const entry = { host: '127.0.0.1', port, key, name: 'dsh-fixture', starId: 'dsh-fixture-star' };
    const configFile = join(root, 'tcp', 'node.json'); writeFileSync(configFile, JSON.stringify({ brokers: [entry] }));
    const harness: DshThread = { id: 'harness-native', name: 'Harness Worker', cwd: '', rawStatus: { type: 'idle' }, attributes: {} };
    let threads = [harness];
    let claudeAlive = true;
    const listDshThreads = vi.fn(async () => threads);
    const node = new NodeClient({ config: { entries: [entry] }, configFile, machineId: () => machine, now: Date.now, log: () => {}, memberCheckMs: 30,
      codexHome: join(root, 'empty-codex'), fileInbox: new FileInbox({ inboxDir: join(root, 'inbox'), partsDir: join(root, 'parts') }),
      makeSendDeps: () => ({ env: {}, listClaudeSessions: () => ({ sessions: claudeAlive ? [{ pid: 1, sessionId: 'old-claude', name: 'Old Claude', kind: 'interactive', messagingSocketPath: 'fixture' }] : [], malformed: 0 }),
        listCodexThreads: async () => [], listDshThreads, deliverClaude: async () => ({ status: 'delivered' }), deliverCodex: async () => ({ status: 'accepted', turnId: 'unused' }),
        sendLogFile: join(root, 'send-log.jsonl'), outboxDir: join(root, 'outbox'), now: Date.now }),
    });
    cleanup.push(() => node.stop()); void node.run().catch(() => undefined); await node.waitForState('online');
    const pipe = await connectAttachPipe(attachPipePath(entry, join(root, 'tcp'))); cleanup.push(() => pipe.close());
    expect((await pipe.send({ op: 'attach', sessionId: harness.id, tool: 'dsh', name: harness.name })).ok).toBe(true);
    expect((await pipe.send({ op: 'attach', sessionId: 'old-claude', tool: 'claude', name: 'Old Claude' })).ok).toBe(true);
    await vi.waitFor(() => expect(listDshThreads.mock.calls.length).toBeGreaterThan(1), { timeout: 2500, interval: 20 });
    expect((await pipe.send({ op: 'status' })).members).toEqual(expect.arrayContaining([expect.objectContaining({ sessionId: harness.id, tool: 'dsh' })]));
    const before = listDshThreads.mock.calls.length;
    claudeAlive = false; threads = [harness, { ...harness, id: 'old-claude', name: 'Unrelated Harness' }];
    await vi.waitFor(async () => {
      expect(listDshThreads.mock.calls.length).toBeGreaterThan(before + 1);
      const members = (await pipe.send({ op: 'status' })).members ?? [];
      expect(members.some((member) => member.sessionId === 'old-claude')).toBe(false);
      expect(members).toEqual(expect.arrayContaining([expect.objectContaining({ sessionId: harness.id, tool: 'dsh' })]));
    }, { timeout: 2500, interval: 20 });
  });
});
