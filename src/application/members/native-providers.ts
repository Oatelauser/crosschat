import type { ClaudeRegistryScan } from '../../claude/registry.js';
import type { CodexThreadSummary } from '../../codex/client.js';
import { codexHomeDir, lookupRolloutMetas } from '../../codex/rollout-meta.js';
import type { OpenCodeThread } from '../../opencode/client.js';
import type { DshThread } from '../../dsh/client.js';
import { MultichatError } from '../../errors.js';
import type { MemberProvider } from './model.js';
import { nativeTargetKey } from '../../tool-types.js';

export interface LegacyMemberProviderDeps {
  listClaudeSessions(): ClaudeRegistryScan;
  listCodexThreads(options?: { endpointType?: string; complete?: boolean }): Promise<readonly CodexThreadSummary[]>;
  listOpenCodeThreads?(): Promise<readonly OpenCodeThread[]>;
  listDshThreads?(): Promise<readonly DshThread[]>;
  codexHome?: string;
  lookupRolloutMetas?: typeof lookupRolloutMetas;
  now?: () => number;
}

/** One reconciliation cycle owns these native snapshots and the lazy name query. */
export function createLegacyMemberProviders(
  deps: LegacyMemberProviderDeps,
  nativeIds: readonly string[],
): readonly MemberProvider[] {
  const now = deps.now ?? Date.now;
  const claudeById = new Map(deps.listClaudeSessions().sessions.map((session) => [session.sessionId, session]));
  const remaining = [...new Set(nativeIds)].filter((id) => !claudeById.has(id));
  const codexIds = remaining.length === 0 ? new Set<string>()
    : new Set((deps.lookupRolloutMetas ?? lookupRolloutMetas)(deps.codexHome ?? codexHomeDir(), remaining).keys());
  const codexSnapshots = new Map<string | undefined, Promise<readonly CodexThreadSummary[]>>();
  const readCodexThreads = (endpointType?: string): Promise<readonly CodexThreadSummary[]> => {
    let snapshot = codexSnapshots.get(endpointType);
    if (snapshot === undefined) {
      // A typed absence can remove a temporary member: verify the selected
      // source completely, independently of other endpoint failures.
      snapshot = endpointType === undefined ? deps.listCodexThreads()
        : deps.listCodexThreads({ endpointType, complete: true });
      codexSnapshots.set(endpointType, snapshot);
    }
    return snapshot;
  };
  let codexNames: Promise<Map<string, string>> | undefined;
  const readCodexNames = (): Promise<Map<string, string>> => {
    codexNames ??= (async () => {
      const names = new Map<string, string>();
      try {
        // Preserve the existing caller's default discovery scope (20 threads).
        for (const thread of await readCodexThreads()) {
          if (thread.name !== null && thread.name !== '') {
            names.set(thread.id, thread.name);
            names.set(nativeTargetKey({ providerId: 'codex', nativeId: thread.id, endpointType: thread.endpointType }), thread.name);
          }
        }
      } catch {
        // Native liveness comes from rollout metadata; names are best effort.
      }
      return names;
    })();
    return codexNames;
  };
  const providers: MemberProvider[] = [
    {
      providerId: 'claude',
      liveness: {
        async probe({ nativeId, endpointType }) {
          const session = claudeById.get(nativeId);
          return { nativeId, presence: session === undefined || (endpointType !== undefined && endpointType !== 'cli') ? 'absent' : 'present', name: session?.name ?? null, completeness: 'complete', errors: [], observedAt: now() };
        },
      },
      async readName({ nativeId }) { return claudeById.get(nativeId)?.name; },
    },
    {
      providerId: 'codex',
      liveness: {
        async probe({ nativeId, endpointType, contextId }) {
          if (endpointType !== undefined) {
            try {
              const matches = (await readCodexThreads(endpointType)).filter((thread) => thread.id === nativeId && thread.endpointType === endpointType);
              return { nativeId, presence: matches.length === 1 ? 'present' : matches.length === 0 ? 'absent' : 'unknown', name: matches[0]?.name ?? null,
                completeness: matches.length > 1 ? 'unavailable' : 'complete', errors: [], observedAt: now() };
            } catch {
              return { nativeId, presence: 'unknown', name: null, completeness: 'unavailable', observedAt: now(), errors: [{ source: { contextId, providerId: 'codex' }, kind: 'unavailable',
                message: 'The exact Codex endpoint could not be verified; retain existing membership.' }] };
            }
          }
          return { nativeId, presence: codexIds.has(nativeId) ? 'present' : 'absent', name: null, completeness: 'complete', errors: [], observedAt: now() };
        },
      },
      async readName({ nativeId, endpointType }) {
        if (endpointType === undefined) return (await readCodexNames()).get(nativeId);
        try {
          const matches = (await readCodexThreads(endpointType)).filter((thread) => thread.id === nativeId && thread.endpointType === endpointType);
          return matches.length === 1 && matches[0].name !== null && matches[0].name !== '' ? matches[0].name : undefined;
        } catch { return undefined; }
      },
    },
  ];
  if (deps.listOpenCodeThreads !== undefined) {
    const list = deps.listOpenCodeThreads;
    let snapshot: Promise<Map<string, OpenCodeThread>> | undefined;
    const readSnapshot = (): Promise<Map<string, OpenCodeThread>> => {
      snapshot ??= list().then((threads) => new Map(threads.map((thread) => [thread.id, thread]))).catch((error: unknown) => {
        if (error instanceof MultichatError && error.code === 'OPENCODE_NOT_CONFIGURED') return new Map();
        throw error;
      });
      return snapshot;
    };
    providers.push({
      providerId: 'opencode',
      liveness: {
        async probe({ nativeId, contextId, endpointType }) {
          try {
            const thread = (await readSnapshot()).get(nativeId);
            return { nativeId, presence: thread === undefined || (endpointType !== undefined && endpointType !== 'shared') ? 'absent' : 'present', name: thread?.name ?? null,
              completeness: 'complete', errors: [], observedAt: now() };
          } catch {
            return { nativeId, presence: 'unknown', name: null, completeness: 'unavailable', observedAt: now(),
              errors: [{ source: { contextId, providerId: 'opencode' }, kind: 'unavailable',
                message: 'OpenCode member presence could not be checked; keep existing membership and retry.' }] };
          }
        },
      },
      async readName({ nativeId }) {
        return (await readSnapshot()).get(nativeId)?.name ?? undefined;
      },
    });
  }
  if (deps.listDshThreads !== undefined) {
    const list = deps.listDshThreads;
    let snapshot: Promise<Map<string, DshThread>> | undefined;
    const readSnapshot = (): Promise<Map<string, DshThread>> => {
      snapshot ??= list().then((threads) => {
        const byId = new Map<string, DshThread>();
        for (const thread of threads) {
          const key = nativeTargetKey({ providerId: 'dsh', nativeId: thread.id, endpointType: thread.endpointType });
          if (byId.has(key)) throw new Error('Ambiguous DeepSeek Harness native endpoint/session ID.');
          byId.set(key, thread);
        }
        return byId;
      }).catch((error: unknown) => {
        if (error instanceof MultichatError && error.code === 'DSH_NOT_CONFIGURED') return new Map();
        throw error;
      });
      return snapshot;
    };
    const readThread = async (nativeId: string, endpointType?: string): Promise<DshThread | undefined> => {
      const snapshot = await readSnapshot();
      if (endpointType !== undefined) return snapshot.get(nativeTargetKey({ providerId: 'dsh', nativeId, endpointType }));
      const hits = [...snapshot.values()].filter((thread) => thread.id === nativeId);
      if (hits.length > 1) throw new Error('Ambiguous Harness endpoint identity.');
      return hits[0];
    };
    // An actual new-provider collision cannot be hidden by the legacy
    // first-present policy. An unrelated new-source outage keeps a verified
    // existing native source usable; Harness probes still report unknown.
    for (const provider of providers) {
      const original = provider.liveness;
      provider.liveness = { async probe(request) {
        const result = await original.probe(request);
        if (result.presence !== 'present') return result;
        if (request.endpointType !== undefined) return result;
        let collision = false;
        try { collision = [...(await readSnapshot()).values()].some((thread) => thread.id === request.nativeId); }
        catch { return result; }
        return collision ? { ...result, presence: 'unknown', completeness: 'unavailable', errors: [{ source: { contextId: request.contextId, providerId: 'dsh' }, kind: 'unavailable',
          message: 'The native session ID is present in Harness and another tool; retain existing membership and resolve the ambiguity.' }] } : result;
      } };
    }
    providers.push({ providerId: 'dsh',
      liveness: { async probe({ nativeId, contextId, endpointType }) {
        try {
          const thread = await readThread(nativeId, endpointType);
          return { nativeId, presence: thread === undefined ? 'absent' : 'present', name: thread?.name ?? null, completeness: 'complete', errors: [], observedAt: now() };
        } catch {
          return { nativeId, presence: 'unknown', name: null, completeness: 'unavailable', observedAt: now(), errors: [{ source: { contextId, providerId: 'dsh' }, kind: 'unavailable',
            message: 'DeepSeek Harness member presence could not be checked; keep existing membership and retry.' }] };
        }
      } },
      async readName({ nativeId, endpointType }) { return (await readThread(nativeId, endpointType))?.name ?? undefined; },
    });
  }
  return providers;
}
