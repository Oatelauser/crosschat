import { describe, expect, it } from 'vitest';
import process from 'node:process';
import { mkdir, mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNativeSessionOperations } from '../src/application/session-operations.js';
import { createNativeOperationProviders } from '../src/application/native-operation-providers.js';
import type { DiscoverySession } from '../src/application/discovery/model.js';
import type { CodexSession } from '../src/codex/client.js';
import { CodexRpcRejectedError } from '../src/codex/rpc.js';

function fixture() {
  const item: DiscoverySession = { ref: { contextId: 'local', providerId: 'codex', nativeId: 'exact-cli-thread' }, name: 'before',
    rawStatus: { type: 'idle' }, capabilities: { discovery: true, delivery: true, launch: false, diagnostics: false }, attributes: { transport: 'cli' } };
  const methods: string[] = [];
  const session: CodexSession = {
    nativeIdentity: { userAgent: 'codex-tui/0.163.0', codexHome: process.cwd() },
    initialize: async () => { methods.push('initialize'); },
    readThreadMetadata: async (id) => { methods.push('read'); return { id, name: item.name, status: 'idle' }; },
    renameThread: async (id, name) => { methods.push(`rename:${id}`); item.name = name; },
    close: async () => { methods.push('close'); },
    listThreads: async () => [], resumeThread: async () => { throw new Error('must not resume'); },
    startTurn: async () => { throw new Error('must not message'); }, steerTurn: async () => { throw new Error('must not message'); },
    unsubscribe: async () => undefined, startThread: async () => { throw new Error('must not create'); },
    deleteThread: async () => { throw new Error('must not delete'); }, notifications: () => [],
  };
  const state: { owner: string; session: CodexSession; onRead?: () => void } = { owner: 'native-owner-1', session };
  const read = session.readThreadMetadata!;
  session.readThreadMetadata = async (id) => { const value = await read(id); state.onRead?.(); return value; };
  const operations = createNativeSessionOperations({ discovery: { execute: async () => ({ op: 'detail', providers: [{ providerId: item.ref.providerId, capabilities: item.capabilities }],
    detail: { item, completeness: 'complete', errors: [], observedAt: Date.now() } }) }, adopt: async () => undefined,
    providers: createNativeOperationProviders({ codex: { sessionFactory: async () => state.session, codexHome: process.cwd(), ownerIdentity: async () => state.owner } }) });
  return { operations, item, methods, state };
}

describe('production native rename providers', () => {
  it('rejects a target that disappears before the setter without claiming a write was sent', async () => {
    const f = fixture();
    const described = await f.operations.describe(f.item.ref);
    const read = f.state.session.readThreadMetadata!;
    let reads = 0;
    f.state.session.readThreadMetadata = async (id) => {
      if (++reads === 2) throw new CodexRpcRejectedError(-32602, 'Target no longer loaded');
      return read(id);
    };
    expect(await f.operations.apply({ ref: f.item.ref, operation: 'rename', name: 'after', expectedRevision: described.revision })).toMatchObject({ kind: 'rejected' });
    expect(f.methods.some((method) => method.startsWith('rename:'))).toBe(false);
  });

  it('recovers from a missing native daemon identity without starting a service or replaying a write', async () => {
    const f = fixture();
    const home = await mkdtemp(join(tmpdir(), 'crosschat-rename-owner-'));
    const daemon = join(home, 'app-server-daemon'); const file = join(daemon, 'daemon.pid');
    await mkdir(daemon);
    f.state.session = { ...f.state.session, nativeIdentity: { userAgent: 'codex-tui/0.163.0', codexHome: home } };
    const operations = createNativeSessionOperations({ discovery: { execute: async () => ({ op: 'detail', providers: [{ providerId: 'codex', capabilities: f.item.capabilities }],
      detail: { item: f.item, completeness: 'complete', errors: [], observedAt: Date.now() } }) }, adopt: async () => undefined,
      providers: createNativeOperationProviders({ codex: { codexHome: home, sessionFactory: async () => f.state.session } }) });
    try {
      expect((await operations.describe(f.item.ref)).actions).toMatchObject({ adopt: { state: 'executable' }, rename: { state: 'unavailable' } });
      await writeFile(file, JSON.stringify({ pid: process.pid, processStartTime: 'isolated-start', executableIdentity: { digest: Array(32).fill(1), path_digest: Array(32).fill(2) } }));
      expect((await operations.describe(f.item.ref)).actions.rename.state).toBe('executable');
      f.state.session = { ...f.state.session, nativeIdentity: { userAgent: 'codex-tui/0.160.0', codexHome: home } };
      expect((await operations.describe(f.item.ref)).actions.rename.state).toBe('needs-verification');
      expect(f.methods.some((method) => method.startsWith('rename:'))).toBe(false);
    } finally { await rm(file, { force: true }); await rmdir(daemon); await rmdir(home); }
  });

  it('distinguishes a native rejection from a lost setter response and never replays either', async () => {
    const f = fixture();
    f.state.session.renameThread = async () => { f.methods.push('rename:rejected'); throw new CodexRpcRejectedError(-32601, 'Native method unavailable'); };
    const described = await f.operations.describe(f.item.ref);
    expect(await f.operations.apply({ ref: f.item.ref, operation: 'rename', name: 'after', expectedRevision: described.revision })).toMatchObject({ kind: 'rejected' });
    f.state.session.renameThread = async () => { f.methods.push('rename:lost'); throw new Error('Connection lost after write'); };
    expect(await f.operations.apply({ ref: f.item.ref, operation: 'rename', name: 'after', expectedRevision: described.revision })).toMatchObject({ kind: 'uncertain' });
    await f.operations.describe(f.item.ref);
    expect(f.methods.filter((method) => method.startsWith('rename:'))).toEqual(['rename:rejected', 'rename:lost']);
  });

  it('rejects stale owner confirmation and a service replacement immediately before the write', async () => {
    const f = fixture();
    const before = await f.operations.describe(f.item.ref);
    f.state.owner = 'native-owner-2';
    expect(await f.operations.apply({ ref: f.item.ref, operation: 'rename', name: 'after', expectedRevision: before.revision })).toMatchObject({ kind: 'rejected' });
    const refreshed = await f.operations.describe(f.item.ref);
    let reads = 0;
    f.state.onRead = () => { if (++reads === 2) f.state.owner = 'native-owner-3'; };
    expect(await f.operations.apply({ ref: f.item.ref, operation: 'rename', name: 'after', expectedRevision: refreshed.revision })).toMatchObject({ kind: 'rejected' });
    expect(f.item.name).toBe('before');
    expect(f.methods.some((method) => method.startsWith('rename:'))).toBe(false);
    f.state.onRead = undefined;
    expect((await f.operations.describe(f.item.ref)).actions.rename.state).toBe('executable');
  });

  it('keeps Desktop and Claude usable for membership but never sends an unverified rename', async () => {
    const f = fixture();
    f.item.attributes = { transport: 'desktop', ownerId: 'actual-desktop-owner' };
    const desktop = await f.operations.describe(f.item.ref);
    expect(desktop.actions).toMatchObject({ adopt: { state: 'executable' }, rename: { state: 'unsupported', reason: expect.stringContaining('桌面') } });
    expect(await f.operations.apply({ ref: f.item.ref, operation: 'rename', name: 'after', expectedRevision: desktop.revision })).toMatchObject({ kind: 'rejected' });
    f.item.ref.providerId = 'claude';
    f.item.attributes = { pid: 123, startedAt: 1 };
    const claude = await f.operations.describe(f.item.ref);
    expect(claude.actions).toMatchObject({ adopt: { state: 'executable' }, rename: { state: 'needs-verification', reason: expect.stringContaining('SDK') } });
    expect(f.methods).toEqual([]);
  });

  it('renames a loaded Codex CLI thread on its current owner and verifies the native name', async () => {
    const f = fixture();
    const description = await f.operations.describe(f.item.ref);
    expect(description.actions.rename.state).toBe('executable');
    expect(await f.operations.apply({ ref: f.item.ref, operation: 'rename', name: 'after', expectedRevision: description.revision })).toMatchObject({ kind: 'applied' });
    expect(f.item.name).toBe('after');
    expect(f.methods.filter((method) => method.startsWith('rename:'))).toEqual(['rename:exact-cli-thread']);
    expect(f.methods.filter((method) => method === 'close')).toHaveLength(f.methods.filter((method) => method === 'initialize').length);
  });
});
