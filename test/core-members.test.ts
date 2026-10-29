import { describe, expect, it, vi } from 'vitest';
import { createLegacyMemberProviders, readMemberSnapshot } from '../src/application/members/index.js';
import type { MemberProvider } from '../src/application/members/index.js';

function provider(providerId: string, presence: 'present' | 'absent' | 'unknown' = 'present'): MemberProvider {
  return {
    providerId,
    liveness: {
      probe: vi.fn(async (request) => ({ nativeId: request.nativeId, presence, name: null, observedAt: 1, errors: [], completeness: presence === 'unknown' ? 'unavailable' : 'complete' })),
    },
    readName: vi.fn(async () => `${providerId}-name`),
  };
}

describe('provider member capabilities', () => {
  it('probes a qualified native target only through its Provider and keeps same-ID endpoint observations distinct', async () => {
    const claude = provider('claude');
    const codex = provider('codex');
    const targets = [{ providerId: 'codex', endpointType: 'cli', nativeId: 'same-id' },
      { providerId: 'codex', endpointType: 'desktop', nativeId: 'same-id' }];
    const snapshot = await readMemberSnapshot([claude, codex], Object.assign({ contextId: 'local', nativeIds: ['same-id'] }, { targets }));
    expect(claude.liveness.probe).not.toHaveBeenCalled();
    expect(codex.liveness.probe).toHaveBeenCalledTimes(2);
    expect(codex.liveness.probe).toHaveBeenCalledWith({ contextId: 'local', nativeId: 'same-id', endpointType: 'cli', signal: undefined });
    expect(codex.liveness.probe).toHaveBeenCalledWith({ contextId: 'local', nativeId: 'same-id', endpointType: 'desktop', signal: undefined });
    expect(snapshot.get(JSON.stringify(['codex', 'cli', 'same-id']))).toMatchObject({ providerId: 'codex', endpointType: 'cli' });
    expect(snapshot.get(JSON.stringify(['codex', 'desktop', 'same-id']))).toMatchObject({ providerId: 'codex', endpointType: 'desktop' });
  });

  it('delegates native IDs and names to an arbitrary provider and preserves provider priority', async () => {
    const first = provider('thirdtool');
    const second = provider('otherprovider');
    const snapshot = await readMemberSnapshot([first, second], { contextId: 'local', nativeIds: ['opaque/native', 'opaque/native'] });
    expect(snapshot.get('opaque/native')?.providerId).toBe('thirdtool');
    expect(await snapshot.get('opaque/native')?.readName()).toBe('thirdtool-name');
    expect(first.liveness.probe).toHaveBeenCalledOnce();
    expect(first.liveness.probe).toHaveBeenCalledWith({ contextId: 'local', nativeId: 'opaque/native', signal: undefined });
    expect(second.liveness.probe).not.toHaveBeenCalled();
  });

  it('keeps unavailable liveness distinct from absence and skips later providers', async () => {
    const unknown = provider('thirdtool', 'unknown');
    const fallback = provider('otherprovider');
    await expect(readMemberSnapshot([unknown, fallback], { contextId: 'local', nativeIds: ['id'] })).rejects.toThrow('unknown');
    expect(fallback.liveness.probe).not.toHaveBeenCalled();
  });

  it('does not probe providers after cancellation', async () => {
    const source = provider('thirdtool');
    const controller = new AbortController();
    controller.abort();
    await expect(readMemberSnapshot([source], { contextId: 'local', nativeIds: ['id'], signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(source.liveness.probe).not.toHaveBeenCalled();
  });

  it('preserves one Claude scan, one remaining-ID rollout lookup and lazy one-shot Codex names', async () => {
    const listClaudeSessions = vi.fn(() => ({ sessions: [{ pid: 10, sessionId: 'claude-id', kind: 'interactive', name: 'claude-name', status: 'idle', messagingSocketPath: 'fixture' }], malformed: 0 }));
    const listCodexThreads = vi.fn(async () => [{ id: 'codex-id', name: 'codex-name', status: 'idle' as const }]);
    const lookupRolloutMetas = vi.fn(() => new Map([['codex-id', { cwd: undefined, originator: undefined, createdAt: undefined }]]));
    const ids = ['claude-id', 'codex-id', 'absent-id'];
    const providers = createLegacyMemberProviders({ listClaudeSessions, listCodexThreads, lookupRolloutMetas, codexHome: 'fixture-home', now: () => 10 }, ids);
    const snapshot = await readMemberSnapshot(providers, { contextId: 'local', nativeIds: ids });
    expect(snapshot.get('claude-id')?.providerId).toBe('claude');
    expect(snapshot.get('codex-id')?.providerId).toBe('codex');
    expect(snapshot.has('absent-id')).toBe(false);
    expect(listClaudeSessions).toHaveBeenCalledOnce();
    expect(lookupRolloutMetas).toHaveBeenCalledOnce();
    expect(lookupRolloutMetas).toHaveBeenCalledWith('fixture-home', ['codex-id', 'absent-id']);
    expect(listCodexThreads).not.toHaveBeenCalled();
    expect(await snapshot.get('claude-id')?.readName()).toBe('claude-name');
    expect(listCodexThreads).not.toHaveBeenCalled();
    expect(await snapshot.get('codex-id')?.readName()).toBe('codex-name');
    expect(await snapshot.get('codex-id')?.readName()).toBe('codex-name');
    expect(listCodexThreads).toHaveBeenCalledOnce();
  });

  it('retains rollout liveness if the optional Codex name query fails', async () => {
    const providers = createLegacyMemberProviders({ listClaudeSessions: () => ({ sessions: [], malformed: 0 }), listCodexThreads: async () => { throw new Error('proxy unavailable'); }, lookupRolloutMetas: () => new Map([['codex-id', { cwd: undefined, originator: undefined, createdAt: undefined }]]), codexHome: 'fixture-home' }, ['codex-id']);
    const snapshot = await readMemberSnapshot(providers, { contextId: 'local', nativeIds: ['codex-id'] });
    expect(snapshot.get('codex-id')?.providerId).toBe('codex');
    expect(await snapshot.get('codex-id')?.readName()).toBeUndefined();
  });

  it('verifies typed Codex members beyond the default list limit through independent complete endpoint snapshots', async () => {
    const oldId = 'older-than-twenty';
    const firstPage = Array.from({ length: 20 }, (_, index) => ({ id: `recent-${index}`, endpointType: 'cli', name: `Recent ${index}`, status: 'idle' as const }));
    const listCodexThreads = vi.fn(async (options?: { endpointType?: string; complete?: boolean }) => {
      if (options?.complete !== true) return firstPage;
      return [...(options.endpointType === 'cli' ? firstPage : []), { id: oldId, endpointType: options.endpointType, name: `${options.endpointType} title`, status: 'idle' as const }];
    });
    const providers = createLegacyMemberProviders({ listClaudeSessions: () => ({ sessions: [], malformed: 0 }), listCodexThreads,
      lookupRolloutMetas: () => new Map(), codexHome: 'fixture-home' }, [oldId]);
    const targets = ['cli', 'desktop'].map((endpointType) => ({ providerId: 'codex', nativeId: oldId, endpointType }));
    const snapshot = await readMemberSnapshot(providers, { contextId: 'local', nativeIds: [oldId], targets });
    expect(snapshot.size).toBe(2);
    for (const target of targets) {
      const observation = snapshot.get(JSON.stringify(['codex', target.endpointType, oldId]));
      expect(observation).toMatchObject({ providerId: 'codex', endpointType: target.endpointType });
      expect(await observation?.readName()).toBe(`${target.endpointType} title`);
    }
    expect(listCodexThreads.mock.calls).toEqual([[{ endpointType: 'cli', complete: true }], [{ endpointType: 'desktop', complete: true }]]);
  });

  it('retains an unverifiable typed member and does not reuse a different Codex endpoint as its fallback', async () => {
    const listCodexThreads = vi.fn(async (options?: { endpointType?: string; complete?: boolean }) => {
      if (options?.endpointType === 'cli') throw new Error('CLI source incomplete');
      return [{ id: 'shared-id', endpointType: 'desktop', name: 'Desktop title', status: 'idle' as const }];
    });
    const providers = createLegacyMemberProviders({ listClaudeSessions: () => ({ sessions: [], malformed: 0 }), listCodexThreads,
      lookupRolloutMetas: () => new Map(), codexHome: 'fixture-home' }, ['shared-id']);
    await expect(readMemberSnapshot(providers, { contextId: 'local', nativeIds: ['shared-id'],
      targets: [{ providerId: 'codex', nativeId: 'shared-id', endpointType: 'cli' }] })).rejects.toThrow('unknown');
    const desktop = await readMemberSnapshot(providers, { contextId: 'local', nativeIds: ['shared-id'],
      targets: [{ providerId: 'codex', nativeId: 'shared-id', endpointType: 'desktop' }] });
    expect(desktop.get(JSON.stringify(['codex', 'desktop', 'shared-id']))?.endpointType).toBe('desktop');
    expect(listCodexThreads.mock.calls).toEqual([[{ endpointType: 'cli', complete: true }], [{ endpointType: 'desktop', complete: true }]]);
  });
});
