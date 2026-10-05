import { MultichatError } from './errors.js';
import type { ClaudeSessionEntry } from './claude/registry.js';
import type { CodexThreadSummary } from './codex/client.js';

/**
 * `--to <name>` resolution (ticket 003): exact match on the claude registry
 * first, then codex thread names. Any ambiguity (duplicates on one side, or
 * the same name on both sides) is NAME_COLLISION with candidates; no match is
 * NAME_NOT_FOUND listing every currently available name.
 *
 * Names always win over ids: only when exact-name matching misses on both
 * sides do we try codex thread id addressing (optional `codex/` prefix + id8
 * or full lowercase uuid) so unnamed `codex exec` threads stay reachable.
 */

export type ResolvedTarget =
  | { side: 'claude'; session: ClaudeSessionEntry }
  | { side: 'codex'; thread: CodexThreadSummary };

export function resolveTargetByName(
  name: string,
  sessions: readonly ClaudeSessionEntry[],
  threads: readonly CodexThreadSummary[],
): ResolvedTarget {
  const claudeMatches = sessions.filter((session) => session.name === name && session.sessionId !== '');
  if (claudeMatches.length > 1) {
    const candidates = claudeMatches.map((session) => `pid ${session.pid} (${session.sessionId})`).join(', ');
    throw new MultichatError(
      'NAME_COLLISION',
      `Multiple Claude sessions are named ${JSON.stringify(name)}: ${candidates}.`,
    );
  }
  const codexMatches = threads.filter((thread) => thread.name === name);
  if (codexMatches.length > 1) {
    const candidates = codexMatches.map((thread) => thread.id.slice(0, 8)).join(', ');
    throw new MultichatError(
      'NAME_COLLISION',
      `Multiple Codex threads are named ${JSON.stringify(name)}: ${candidates}.`,
    );
  }
  if (claudeMatches.length === 1 && codexMatches.length === 1) {
    throw new MultichatError(
      'NAME_COLLISION',
      `${JSON.stringify(name)} exists on both sides: claude pid ${claudeMatches[0].pid} and codex thread ${codexMatches[0].id.slice(0, 8)}.`,
    );
  }
  if (claudeMatches.length === 1) return { side: 'claude', session: claudeMatches[0] };
  if (codexMatches.length === 1) return { side: 'codex', thread: codexMatches[0] };
  const idMatch = /^(?:codex\/)?([0-9a-f]{8}(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?)$/.exec(name);
  if (idMatch !== null) {
    const id = idMatch[1];
    if (id.length === 36) {
      const thread = threads.find((candidate) => candidate.id === id);
      if (thread !== undefined) return { side: 'codex', thread };
    } else {
      const prefixed = threads.filter((candidate) => candidate.id.startsWith(id));
      if (prefixed.length === 1) return { side: 'codex', thread: prefixed[0] };
      if (prefixed.length > 1) {
        throw new MultichatError(
          'NAME_COLLISION',
          `Multiple Codex threads match id prefix ${JSON.stringify(name)}: ${prefixed.map((thread) => thread.id).join(', ')}. Use the full id to address one.`,
        );
      }
    }
  }
  throw new MultichatError(
    'NAME_NOT_FOUND',
    `No agent named ${JSON.stringify(name)}. ${describeAvailableNames(sessions, threads)}`,
  );
}

function describeAvailableNames(
  sessions: readonly ClaudeSessionEntry[],
  threads: readonly CodexThreadSummary[],
): string {
  const claudeNames = sessions.flatMap((session) =>
    session.name !== undefined && session.sessionId !== '' ? [session.name] : [],
  );
  const namedThreads = threads.flatMap((thread) => (thread.name !== null ? [thread.name] : []));
  const unnamed = threads.length - namedThreads.length;
  const claudeList = claudeNames.map((name) => JSON.stringify(name)).join(', ') || '(no named sessions)';
  const codexList = namedThreads.map((name) => JSON.stringify(name)).join(', ') || '(no named threads)';
  return `Available names — claude: ${claudeList}; codex: ${codexList}${unnamed > 0 ? ` (+${unnamed} unnamed)` : ''}.${unnamed > 0 ? ' Unnamed codex threads can be addressed by id8 or full id (see crosschat status).' : ''}`;
}
