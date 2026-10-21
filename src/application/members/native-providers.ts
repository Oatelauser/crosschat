import type { ClaudeRegistryScan } from '../../claude/registry.js';
import type { CodexThreadSummary } from '../../codex/client.js';
import { codexHomeDir, lookupRolloutMetas } from '../../codex/rollout-meta.js';
import type { MemberProvider } from './model.js';

export interface LegacyMemberProviderDeps {
  listClaudeSessions(): ClaudeRegistryScan;
  listCodexThreads(): Promise<readonly CodexThreadSummary[]>;
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
  return [
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
}
