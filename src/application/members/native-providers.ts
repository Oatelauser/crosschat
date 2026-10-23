import type { ClaudeRegistryScan } from '../../claude/registry.js';
import type { CodexThreadSummary } from '../../codex/client.js';
import { codexHomeDir, lookupRolloutMetas } from '../../codex/rollout-meta.js';
import type { OpenCodeThread } from '../../opencode/client.js';
import { MultichatError } from '../../errors.js';
import type { MemberProvider } from './model.js';

export interface LegacyMemberProviderDeps {
  listClaudeSessions(): ClaudeRegistryScan;
  listCodexThreads(): Promise<readonly CodexThreadSummary[]>;
  listOpenCodeThreads?(): Promise<readonly OpenCodeThread[]>;
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
  let codexNames: Promise<Map<string, string>> | undefined;
  const readCodexNames = (): Promise<Map<string, string>> => {
    codexNames ??= (async () => {
      const names = new Map<string, string>();
      try {
        // Preserve the existing caller's default discovery scope (20 threads).
        for (const thread of await deps.listCodexThreads()) {
          if (thread.name !== null && thread.name !== '') names.set(thread.id, thread.name);
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
        async probe({ nativeId }) {
          const session = claudeById.get(nativeId);
          return { nativeId, presence: session === undefined ? 'absent' : 'present', name: session?.name ?? null, completeness: 'complete', errors: [], observedAt: now() };
        },
      },
      async readName({ nativeId }) { return claudeById.get(nativeId)?.name; },
    },
    {
      providerId: 'codex',
      liveness: {
        async probe({ nativeId }) {
          return { nativeId, presence: codexIds.has(nativeId) ? 'present' : 'absent', name: null, completeness: 'complete', errors: [], observedAt: now() };
        },
      },
      async readName({ nativeId }) { return (await readCodexNames()).get(nativeId); },
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
        async probe({ nativeId, contextId }) {
          try {
            const thread = (await readSnapshot()).get(nativeId);
            return { nativeId, presence: thread === undefined ? 'absent' : 'present', name: thread?.name ?? null,
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
  return providers;
}
