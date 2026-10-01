import { MultichatError } from './errors.js';
import type { ClaudeRegistryScan } from './claude/registry.js';
import type { RefEndpoint } from './ref.js';

/**
 * Caller identity from environment variables (ticket 003, stateless CLI):
 * - CLAUDE_CODE_MESSAGING_SOCKET -> match the pipe path against the registry
 * - CODEX_THREAD_ID || CODEX_SESSION_ID -> codex thread identity
 * - neither -> human (may send, cannot receive)
 */

export type CallerIdentity =
  | { p: 'claude'; id: string; name?: string }
  | { p: 'codex'; id: string }
  | { p: 'human' };

/** Canonical key used for rate-limit buckets ("claude:<id>" / "codex:<id>" / "human"). */
export function identityKey(identity: { p: string; id?: string }): string {
  return identity.p === 'human' || identity.id === undefined ? identity.p : `${identity.p}:${identity.id}`;
}

export function endpointOfIdentity(identity: CallerIdentity): RefEndpoint {
  return identity.p === 'human' ? { p: 'human' } : { p: identity.p, id: identity.id };
}

export function identityMatchesEndpoint(identity: CallerIdentity, endpoint: RefEndpoint): boolean {
  if (endpoint.p === 'human') return identity.p === 'human';
  if (identity.p === 'human') return false;
  return identity.p === endpoint.p && identity.id === endpoint.id;
}

export function resolveCallerIdentity(
  env: Record<string, string | undefined>,
  scan: ClaudeRegistryScan,
): CallerIdentity {
  const socket = env.CLAUDE_CODE_MESSAGING_SOCKET ?? '';
  const claude = socket !== '' ? claudeIdentity(socket, scan) : undefined;
  const codexId = env.CODEX_THREAD_ID || env.CODEX_SESSION_ID || '';
  if (claude !== undefined && codexId !== '') {
    throw new MultichatError(
      'CALLER_IDENTITY_CONFLICT',
      `Environment declares both a Claude session (socket ${socket}) and a Codex thread (${codexId}); cannot determine the sender.`,
    );
  }
  if (claude !== undefined) return claude;
  if (codexId !== '') return { p: 'codex', id: codexId };
  return { p: 'human' };
}

function claudeIdentity(socket: string, scan: ClaudeRegistryScan): CallerIdentity {
  const matches = scan.sessions.filter(
    (session) => session.messagingSocketPath === socket && session.sessionId !== '',
  );
  const ids = new Set(matches.map((session) => session.sessionId));
  if (ids.size !== 1) {
    throw new MultichatError(
      'IDENTITY_UNRESOLVED',
      `CLAUDE_CODE_MESSAGING_SOCKET does not match exactly one routable Claude session (matched ${matches.length}); cannot determine the sender.`,
    );
  }
  const session = matches[0];
  return { p: 'claude', id: session.sessionId, name: session.name };
}
