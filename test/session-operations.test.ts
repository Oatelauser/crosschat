import { describe, expect, it, vi } from 'vitest';
import { createNativeSessionOperations } from '../src/application/session-operations.js';
import type { DiscoveryEndpoint, DiscoverySession } from '../src/application/discovery/model.js';

function fixture(probe: () => Promise<{ state: 'executable' }> = async () => ({ state: 'executable' }), lostWrite = false) {
  const item: DiscoverySession = { ref: { contextId: 'local', providerId: 'third', nativeId: 'full/native/id' }, name: 'A', rawStatus: 'idle',
    capabilities: { discovery: true, delivery: true, launch: false, diagnostics: false }, attributes: { owner: 'owner-a', version: '1' } };
  let unavailable = false;
  const discovery: DiscoveryEndpoint = { execute: vi.fn(async () => {
    if (unavailable) throw new Error('offline');
    return { op: 'detail', providers: [{ providerId: item.ref.providerId, capabilities: item.capabilities }], detail: { item, completeness: 'complete', errors: [], observedAt: 1 } };
  }) };
  const adopt = vi.fn(async () => undefined);
  const rename = vi.fn(async (_session: DiscoverySession, name: string) => {
    if (lostWrite) await new Promise<void>(() => undefined);
    item.name = name;
  });
  const operations = createNativeSessionOperations({ discovery, adopt,
    timeoutMs: 50,
    providers: [{ providerId: 'third', tool: 'third', canAdopt: () => ({ allowed: true }),
      rename: { contextKey: (session) => JSON.stringify([session.attributes.owner, session.attributes.version]), probe, apply: rename } }] });
  return { item, adopt, rename, operations, offline: (value: boolean) => { unavailable = value; } };
}

describe('native session operation interface', () => {
  it('a failed rename probe only disables rename and recovers without replaying changes', async () => {
    let failing = true;
    const f = fixture(async () => { if (failing) throw new Error('native endpoint down'); return { state: 'executable' }; });
    const unavailable = await f.operations.describe(f.item.ref);
    expect(unavailable.actions).toMatchObject({ adopt: { state: 'executable' }, rename: { state: 'unavailable' } });
    expect(await f.operations.apply({ ref: f.item.ref, operation: 'rename', name: 'B', expectedRevision: unavailable.revision })).toMatchObject({ kind: 'rejected' });
    failing = false;
    expect((await f.operations.describe(f.item.ref)).actions.rename.state).toBe('executable');
    expect(f.rename).not.toHaveBeenCalled();
    expect(f.adopt).not.toHaveBeenCalled();
  });

  it('a timed out native write returns uncertain and subsequent recovery stays read-only', async () => {
    const f = fixture(undefined, true);
    const described = await f.operations.describe(f.item.ref);
    expect(await f.operations.apply({ ref: f.item.ref, operation: 'rename', name: 'B', expectedRevision: described.revision })).toMatchObject({ kind: 'uncertain' });
    expect((await f.operations.describe(f.item.ref)).actions.rename.state).toBe('executable');
    expect(f.rename).toHaveBeenCalledOnce();
    const cancelled = new AbortController(); cancelled.abort();
    expect(await f.operations.apply({ ref: f.item.ref, operation: 'rename', name: 'B', expectedRevision: described.revision, signal: cancelled.signal })).toMatchObject({ kind: 'rejected' });
    expect(f.rename).toHaveBeenCalledOnce();
  });

  it('third provider supports native rename; missing adapter disables mutation independently', async () => {
    const f = fixture();
    const described = await f.operations.describe(f.item.ref);
    expect(described.actions.adopt.state).toBe('executable');
    expect(described.actions.rename.state).toBe('executable');
    expect(await f.operations.apply({ ref: f.item.ref, operation: 'rename', name: 'B', expectedRevision: described.revision })).toMatchObject({ kind: 'applied' });
    expect(f.item.name).toBe('B');
    const unknown = await f.operations.describe({ ...f.item.ref, providerId: 'unknown' });
    expect(unknown.actions.rename.state).toBe('unsupported');
    expect(unknown.actions.adopt.state).toBe('unsupported');
    expect(f.adopt).not.toHaveBeenCalled();
  });

  it('source recovery is read-only; changed owner rejects old confirmation without replaying writes', async () => {
    const f = fixture();
    const before = await f.operations.describe(f.item.ref);
    f.offline(true);
    expect((await f.operations.describe(f.item.ref)).actions.adopt.state).toBe('unavailable');
    f.offline(false);
    f.item.attributes = { owner: 'owner-b', version: '2' };
    const after = await f.operations.describe(f.item.ref);
    expect(after.actions.adopt.state).toBe('executable');
    expect(await f.operations.apply({ ref: f.item.ref, operation: 'adopt', expectedRevision: before.revision })).toMatchObject({ kind: 'rejected' });
    expect(f.adopt).not.toHaveBeenCalled();
    expect(f.rename).not.toHaveBeenCalled();
  });
});
