import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Broker } from '../src/serve/broker.js';
import { attachPipePath, NodeClient } from '../src/serve/node.js';
import { connectAttachPipe } from '../src/serve/attach-client.js';
import { FileInbox } from '../src/serve/file-channel.js';
import { SenderConn } from '../src/serve/via-tcp.js';
import { loadBrokerFile, writeBrokerFile } from '../src/serve/registry.js';
import type { SessionOperationFrame } from '../src/serve/protocol.js';
import type { DiscoveryEndpoint, DiscoverySession } from '../src/application/discovery/model.js';
import { createTcpSessionOperation } from '../src/application/tcp/session-operations.js';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const machineId = 'a'.repeat(32);
async function fixture(rename?: 'normal' | 'lost') {
  const dir = await mkdtemp(join(tmpdir(), 'cc-session-ops-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const registryFile = join(dir, 'broker.json');
  writeBrokerFile(registryFile, { stars: [{ starId: 'star-a', name: 'alpha', nodes: [{ label: 'node', key: 'fixture-key', addedAt: '2026-10-26' }], roster: [] },
    { starId: 'star-b', name: 'beta', nodes: [{ label: 'node', key: 'other-key', addedAt: '2026-10-26' }], roster: [] }] });
  const broker = new Broker({ registryFile, statusFile: join(dir, 'status.json'), version: 'fixture', machineId: () => 'b'.repeat(32),
    hostname: () => 'fixture', now: Date.now, log: () => undefined, port: 0, heartbeatMs: 60_000, resultTimeoutMs: 500,
    deliverLocal: async (frame) => ({ op: 'result', id: frame.id, status: 'delivered' }) });
  const port = await broker.start(); cleanups.push(() => broker.stop());
  const entry = { host: '127.0.0.1', port, key: 'fixture-key', starId: 'star-a', name: 'alpha' };
  await mkdir(join(dir, 'tcp')); const configFile = join(dir, 'tcp', 'node.json');
  await writeFile(configFile, JSON.stringify({ brokers: [entry] }));
  const state: { item: DiscoverySession | null; renameCalls: number } = { renameCalls: 0, item: { ref: { contextId: 'local', providerId: 'claude', nativeId: 'exact-session-a' }, name: 'A',
    rawStatus: 'idle', capabilities: { discovery: true, delivery: true, launch: false, diagnostics: false }, attributes: { owner: 'window-a', version: '1' } } };
  const discover: DiscoveryEndpoint['execute'] = async (request) => {
    if (request.op !== 'detail') throw new Error('Only exact native lookup is allowed');
    return { op: 'detail', providers: [{ providerId: 'claude', capabilities: { discovery: true, delivery: true, launch: false, diagnostics: false } }],
      detail: { item: state.item?.ref.nativeId === request.nativeId ? state.item : null, completeness: 'complete', errors: [], observedAt: Date.now() } };
  };
  const attachLabel = dir.split(/[\\/]/).at(-1)!;
  const node = new NodeClient({ config: { entries: [entry] }, configFile, machineId: () => machineId,
    fileInbox: new FileInbox({ inboxDir: join(dir, 'inbox'), partsDir: join(dir, 'parts') }), now: Date.now, log: () => undefined,
    makeSendDeps: () => { throw new Error('Operations must not send messages'); }, memberProviders: () => [], memberCheckMs: 60_000,
    discover, ...(rename ? { operationProviders: [{ providerId: 'claude', tool: 'claude', canAdopt: () => ({ allowed: true }), rename: {
      contextKey: (item: DiscoverySession) => String(item.attributes.owner), probe: async () => ({ state: 'executable' as const }),
      apply: async (_item: DiscoverySession, name: string) => {
        state.renameCalls++;
        if (rename === 'lost') await new Promise<void>(() => undefined);
        else if (state.item) { state.item.name = name; state.item.attributes = { ...state.item.attributes, updatedAt: Date.now() }; }
      },
    } }] } : {}), attachLabel });
  const running = node.run(); cleanups.push(async () => { await node.stop(); await running; }); await node.waitForState('online');
  const conn = await SenderConn.open(`ws://127.0.0.1:${port}`, 'fixture-key', undefined, 1_000); cleanups.push(() => conn.close());
  const other = await SenderConn.open(`ws://127.0.0.1:${port}`, 'other-key', undefined, 1_000); cleanups.push(() => other.close());
  let serial = 0;
  const request = async (input: SessionOperationFrame['request'], selected = conn, starId = 'star-a', nativeId = 'exact-session-a') => {
    const id = `fixture-${++serial}`;
    await selected.send({ op: 'session-operation', id, starId, machineId, providerId: 'claude', nativeId, request: input });
    return selected.waitFor((frame) => (frame.op === 'session-operation-result' || frame.op === 'error') && frame.id === id, 2_000);
  };
  return { dir, registryFile, state, request, other, node, attachPath: attachPipePath(entry, join(dir, 'tcp'), attachLabel) };
}

describe('exact node session operations over real broker/node transport', () => {
  it('repeating TUI adoption preserves a temporary window membership and releases it with the final window', async () => {
    const f = await fixture();
    const window = await connectAttachPipe(f.attachPath);
    cleanups.push(() => window.close());
    expect(await window.send({ op: 'attach', sessionId: 'exact-session-a', tool: 'claude', temporary: true, claimId: 'window-a', selectionOwned: true })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(loadBrokerFile(f.registryFile).stars[0]?.roster?.[0]).toMatchObject({ temporary: true }));
    const described = await f.request({ kind: 'describe' });
    if (described.op !== 'session-operation-result' || !described.description) throw new Error('Missing capability receipt');
    expect(await f.request({ kind: 'apply', operation: 'adopt', expectedRevision: described.description.revision })).toMatchObject({ result: { kind: 'applied' } });
    expect(loadBrokerFile(f.registryFile).stars[0]?.roster?.[0]).toMatchObject({ temporary: true, selectionOwned: true });
    await window.send({ op: 'detach', sessionId: 'exact-session-a', claimId: 'window-a', erase: true });
    await vi.waitFor(() => expect(loadBrokerFile(f.registryFile).stars[0]?.roster).toEqual([]));
    expect(f.state.item?.ref.nativeId).toBe('exact-session-a');
  });

  it('the configured application transport adopts the exact target and synchronizes a verified native rename', async () => {
    const f = await fixture('normal');
    const operate = createTcpSessionOperation({ baseDir: f.dir, timeoutMs: 1500 });
    const target = { contextId: 'local', starId: 'star-a', machineId, providerId: 'claude', nativeId: 'exact-session-a' };
    const described = await operate(target, { kind: 'describe' });
    expect(described.description?.actions.rename.state).toBe('executable');
    const adopted = await operate(target, { kind: 'apply', operation: 'adopt', expectedRevision: described.description!.revision });
    expect(adopted.result?.kind).toBe('applied');
    const current = await operate(target, { kind: 'describe' });
    expect((await operate(target, { kind: 'apply', operation: 'rename', name: 'Native B', expectedRevision: current.description!.revision })).result?.kind).toBe('applied');
    expect(f.state.renameCalls).toBe(1);
    expect(loadBrokerFile(f.registryFile).stars[0]?.roster?.[0]?.name).toBe('Native B');
    expect(loadBrokerFile(f.registryFile).stars[1]?.roster).toEqual([]);
  });

  it('disconnect after a native write returns uncertain; read recovery never replays the write', async () => {
    const f = await fixture('lost');
    const described = await f.request({ kind: 'describe' });
    if (described.op !== 'session-operation-result' || !described.description) throw new Error('Missing description');
    const writing = f.request({ kind: 'apply', operation: 'rename', expectedRevision: described.description.revision, name: 'B' });
    await vi.waitFor(() => expect(f.state.renameCalls).toBe(1));
    await f.node.stop();
    expect(await writing).toMatchObject({ result: { kind: 'uncertain' } });
    expect(await f.request({ kind: 'describe' })).toMatchObject({ result: { kind: 'rejected' } });
    expect(f.state.renameCalls).toBe(1);
  });

  it('describes then adopts an exact remote session permanently, with broker roster confirmation', async () => {
    const f = await fixture();
    const described = await f.request({ kind: 'describe' });
    expect(described).toMatchObject({ op: 'session-operation-result', description: { actions: { adopt: { state: 'executable' }, rename: { state: 'needs-verification' } } } });
    if (described.op !== 'session-operation-result' || !described.description) throw new Error('Missing capability receipt');
    const result = await f.request({ kind: 'apply', operation: 'adopt', expectedRevision: described.description.revision });
    expect(result).toMatchObject({ result: { kind: 'applied' } });
    expect(loadBrokerFile(f.registryFile).stars[0]?.roster).toEqual([expect.objectContaining({ sessionId: 'exact-session-a', machine: machineId, tool: 'claude' })]);
    expect(loadBrokerFile(f.registryFile).stars[0]?.roster?.[0]?.temporary).toBeUndefined();
    expect(loadBrokerFile(f.registryFile).stars[1]?.roster).toEqual([]);
  });

  it('rejects stale native targets and cross-star requests without adding a roster entry', async () => {
    const f = await fixture();
    const described = await f.request({ kind: 'describe' });
    if (described.op !== 'session-operation-result' || !described.description) throw new Error('Missing capability receipt');
    f.state.item = null;
    expect(await f.request({ kind: 'apply', operation: 'adopt', expectedRevision: described.description.revision })).toMatchObject({ result: { kind: 'rejected' } });
    expect(await f.request({ kind: 'describe' }, f.other)).toMatchObject({ result: { kind: 'rejected' } });
    expect(loadBrokerFile(f.registryFile).stars.every((star) => star.roster?.length === 0)).toBe(true);
  });
});
