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
});
