import { describe, expect, it, vi } from 'vitest';
import { diagnoseCodexTarget } from '../src/codex/discovery.js';
import { DesktopIpcError } from '../src/codex/desktop-ipc.js';
import type { DesktopThreadSession } from '../src/codex/desktop-ipc.js';
import type { DesktopMetadataRow } from '../src/codex/desktop-metadata.js';
import { MultichatError } from '../src/errors.js';

function row(id: string, name: string | null): DesktopMetadataRow {
  return { id, name, source: 'vscode', originator: 'fixture', cwd: '/fixture', createdAtMs: 1, updatedAtMs: 2, recencyAtMs: 3 };
}
function owner(id: string): DesktopThreadSession {
  return { threadId: id, ownerId: 'fixture-owner', snapshot: vi.fn(async () => ({ id, name: null, cwd: '/fixture', rawStatus: { type: 'idle' }, activeTurnId: null, idle: true, revision: 1 })),
    startTurn: vi.fn(async () => 'forbidden'), steerTurn: vi.fn(async () => 'forbidden'), close: vi.fn(async () => undefined) };
}

describe('saved Codex target diagnostics', () => {
  it('distinguishes a saved CLI/desktop record without a Desktop owner from a genuinely missing name', async () => {
    const openThread = vi.fn(async () => null);
    const options = { desktop: { listMetadata: async () => ({ data: [{ ...row('opaque/native/id', 'worker'), source: 'cli' }], nextCursor: null, completeness: 'complete' as const, observedAt: 1 }), openThread } };
    const saved = await diagnoseCodexTarget('worker', options);
    expect(saved).toMatchObject({ kind: 'saved', scope: 'desktop', cliStatus: 'not-checked', code: 'CODEX_DESKTOP_OWNER_UNAVAILABLE', candidates: [{ id: 'opaque/native/id', name: 'worker', status: 'owner-missing', failure: { stage: 'owner', code: 'CODEX_DESKTOP_OWNER_UNAVAILABLE' } }] });
    expect(saved.message).toContain('stage=owner');
    expect(saved.message).toContain('code=CODEX_DESKTOP_OWNER_UNAVAILABLE');
    expect(saved.message).toContain('CLI');
    expect(await diagnoseCodexTarget('absent', options)).toMatchObject({ kind: 'not-found', candidates: [] });
    expect(openThread).toHaveBeenCalledOnce();
  });

  it.each([
    { phase: 'owner', code: 'CODEX_DESKTOP_UNSUPPORTED', status: 'unsupported', outer: 'CODEX_DESKTOP_UNSUPPORTED' },
    { phase: 'owner', code: 'CODEX_DESKTOP_TIMEOUT', status: 'probe-failed', outer: 'CODEX_TARGET_PROBE_FAILED' },
    { phase: 'snapshot', code: 'CODEX_DESKTOP_PROTOCOL_ERROR', status: 'snapshot-failed', outer: 'CODEX_TARGET_PROBE_FAILED' },
  ] as const)('preserves $phase stage and $code without exposing native payloads', async ({ phase, code, status, outer }) => {
    const session = owner('native');
    const error = new DesktopIpcError(code, 'PRIVATE CHAT BODY key=SECRET', 'prewrite', phase === 'snapshot');
    if (phase === 'snapshot') session.snapshot = vi.fn(async () => { throw error; });
    const diagnosis = await diagnoseCodexTarget('worker', { desktop: {
      listMetadata: async () => ({ data: [row('native', 'worker')], nextCursor: null, completeness: 'complete', observedAt: 1 }),
      openThread: async () => { if (phase === 'owner') throw error; return session; },
    } });
    expect(diagnosis).toMatchObject({ kind: 'saved', code: outer, candidates: [{ status, failure: { stage: phase, code, ipcStage: 'prewrite' } }] });
    expect(diagnosis.message).toContain(`stage=${phase}`);
    expect(diagnosis.message).toContain(`code=${code}`);
    expect(JSON.stringify(diagnosis)).not.toMatch(/PRIVATE|SECRET/);
    if (phase === 'snapshot') expect(session.close).toHaveBeenCalledOnce();
    expect(session.startTurn).not.toHaveBeenCalled();
    expect(session.steerTurn).not.toHaveBeenCalled();
  });

  it('reports metadata read failure instead of asserting the name is absent', async () => {
    const openThread = vi.fn(async () => null);
    const result = await diagnoseCodexTarget('worker', { desktop: {
      listMetadata: async () => { throw new MultichatError('CODEX_DESKTOP_METADATA_UNAVAILABLE', 'PRIVATE SECRET'); }, openThread,
    } });
    expect(result).toMatchObject({ kind: 'source-error', code: 'CODEX_DISCOVERY_UNAVAILABLE', errors: [{ stage: 'metadata', code: 'CODEX_DESKTOP_METADATA_UNAVAILABLE' }] });
    expect(result.message).toContain('stage=metadata');
    expect(result.message).toContain('code=CODEX_DESKTOP_METADATA_UNAVAILABLE');
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(openThread).not.toHaveBeenCalled();
  });

  it('finds a saved target beyond the old 20-row window and probes only the matched opaque ID', async () => {
    const session = owner('native/last');
    const listMetadata = vi.fn(async ({ cursor }: { cursor?: string }) => cursor === undefined
      ? { data: Array.from({ length: 100 }, (_, i) => row(`native/${i}`, null)), nextCursor: 'last', completeness: 'partial' as const, observedAt: 1 }
      : { data: [row('native/last', 'worker')], nextCursor: null, completeness: 'complete' as const, observedAt: 1 });
    const openThread = vi.fn(async () => session);
    const result = await diagnoseCodexTarget('worker', { desktop: { listMetadata, openThread } });
    expect(result).toMatchObject({ kind: 'saved', code: 'CODEX_TARGET_DISCOVERY_CHANGED', candidates: [{ id: 'native/last', status: 'available' }] });
    expect(result.message).toMatch(/采样|变化/);
    expect(result.message).toContain('未自动发送');
    expect(openThread).toHaveBeenCalledWith('native/last', expect.objectContaining({ timeoutMs: 1000, snapshotTimeoutMs: 1000 }));
    expect(openThread).toHaveBeenCalledOnce();
    expect(session.close).toHaveBeenCalledOnce();
  });

  it('uses exact-name priority and reports ambiguous prefixes before probing any owner', async () => {
    const openThread = vi.fn(async () => null);
    const options = { desktop: { listMetadata: async () => ({ data: [row('a', 'worker'), row('b', 'worker-long')], nextCursor: null, completeness: 'complete' as const, observedAt: 1 }), openThread } };
    expect(await diagnoseCodexTarget('wor', options)).toMatchObject({ kind: 'ambiguous', code: 'NAME_COLLISION', candidates: [{ id: 'a' }, { id: 'b' }] });
    expect(openThread).not.toHaveBeenCalled();
    expect(await diagnoseCodexTarget('worker', options)).toMatchObject({ kind: 'saved', candidates: [{ id: 'a', status: 'owner-missing' }] });
    expect(openThread).toHaveBeenCalledOnce();
  });

  it.each([
    { nextCursor: 'repeated', completeness: 'partial' as const, code: 'CODEX_DESKTOP_METADATA_PROTOCOL_ERROR' },
    { nextCursor: null, completeness: 'partial' as const, code: 'CODEX_DESKTOP_METADATA_INCOMPLETE' },
  ])('does not assert absence from an incomplete metadata traversal: $code', async ({ nextCursor, completeness, code }) => {
    const openThread = vi.fn(async () => null);
    const result = await diagnoseCodexTarget('absent', { desktop: {
      listMetadata: async () => ({ data: [], nextCursor, completeness, observedAt: 1 }), openThread,
    } });
    expect(result).toMatchObject({ kind: 'source-error', errors: [{ stage: 'metadata', code }] });
    expect(openThread).not.toHaveBeenCalled();
  });

  it('cancels a pending snapshot and closes its read-only owner without classifying it as missing', async () => {
    const controller = new AbortController();
    const session = owner('native');
    session.snapshot = vi.fn(async () => new Promise(() => undefined));
    const result = diagnoseCodexTarget('worker', { signal: controller.signal, desktop: {
      listMetadata: async () => ({ data: [row('native', 'worker')], nextCursor: null, completeness: 'complete', observedAt: 1 }), openThread: async () => session,
    } });
    await vi.waitFor(() => expect(session.snapshot).toHaveBeenCalledOnce());
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(session.close).toHaveBeenCalledOnce());
  });

  it('does no IO when cancelled before the metadata query', async () => {
    const controller = new AbortController(); controller.abort();
    const listMetadata = vi.fn(async () => ({ data: [], nextCursor: null, completeness: 'complete' as const, observedAt: 1 }));
    await expect(diagnoseCodexTarget('worker', { signal: controller.signal, desktop: { listMetadata, openThread: async () => null } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(listMetadata).not.toHaveBeenCalled();
  });
});
