import { cancellable } from '../queries/reading.js';

interface ChallengeTarget { contextId: string; host: string; prompt: string }
export type SshChallenge =
  | (ChallengeTarget & { kind: 'password' | 'passphrase' })
  | (ChallengeTarget & { kind: 'host-key'; algorithm: string; fingerprint: string });
export type SshChallengeHandler = (challenge: SshChallenge, signal: AbortSignal) => Promise<string | boolean | null>;
export interface SshInteractionRequest extends ChallengeTarget { revision: string; signal?: AbortSignal }
export interface SshInteraction {
  answer(request: SshInteractionRequest): Promise<string | null>;
  setActiveContext(contextId: string | null): void;
  rejectCredentials(contextId: string): void;
  dispose(): void;
}

function challenge(request: SshInteractionRequest): SshChallenge | null {
  const { contextId, host, prompt } = request;
  if (prompt.length > 16_384 || [...prompt].some((char) => (char.charCodeAt(0) < 32 && !'\t\r\n'.includes(char)) || char.charCodeAt(0) === 127)) return null;
  if (/authenticity of host|continue connecting/i.test(prompt)) {
    const identity = /\b(ED25519(?:-SK)?|ECDSA(?:-SK)?|RSA|DSA) key fingerprint is (SHA256:[A-Za-z0-9+/]{43})(?:\.|\s|$)/.exec(prompt);
    if (!identity || !/Are you sure you want to continue connecting/i.test(prompt)) return null;
    return { kind: 'host-key', contextId, host, prompt, algorithm: identity[1], fingerprint: identity[2] };
  }
  if (/^Enter passphrase(?: for key .+)?:\s*$/i.test(prompt)) return { kind: 'passphrase', contextId, host, prompt };
  if (/^(?:[^\r\n]*'s )?password:\s*$/i.test(prompt)) return { kind: 'password', contextId, host, prompt };
  return null;
}

/** Secrets belong to an entered connection, never to the selected list row or a persisted profile. */
export function createSshInteraction(options: { onChallenge?: SshChallengeHandler }): SshInteraction {
  let activeContext: string | null = null;
  let revision: string | undefined;
  let disposed = false;
  let lifetime = new AbortController();
  const secrets = new Map<string, Buffer>();
  const clear = () => {
    lifetime.abort();
    lifetime = new AbortController();
    for (const secret of secrets.values()) secret.fill(0);
    secrets.clear();
    revision = undefined;
  };
  function setActiveContext(contextId: string | null): void {
    if (disposed || activeContext === contextId) return;
    clear();
    activeContext = contextId;
  }
  async function answer(request: SshInteractionRequest): Promise<string | null> {
    if (disposed || activeContext !== request.contextId || request.signal?.aborted || !options.onChallenge) return null;
    if (revision !== undefined && revision !== request.revision) clear();
    revision = request.revision;
    const parsed = challenge(request);
    if (!parsed) return null;
    const signal = request.signal ? AbortSignal.any([lifetime.signal, request.signal]) : lifetime.signal;
    const cacheKey = `${parsed.kind}\0${request.prompt}`;
    if (parsed.kind !== 'host-key') {
      const saved = secrets.get(cacheKey);
      if (saved) return saved.toString('utf8');
    }
    try {
      const result = await cancellable(options.onChallenge(parsed, signal), signal);
      if (signal.aborted || activeContext !== request.contextId || revision !== request.revision || disposed) return null;
      if (parsed.kind === 'host-key') return result === true ? 'yes' : null;
      if (typeof result !== 'string' || !result || Buffer.byteLength(result) > 1023 || /[\r\n\0]/.test(result)) return null;
      secrets.set(cacheKey, Buffer.from(result));
      return result;
    } catch { return null; }
  }
  return {
    answer, setActiveContext,
    rejectCredentials(contextId) { if (activeContext === contextId) clear(); },
    dispose() { if (disposed) return; clear(); disposed = true; activeContext = null; },
  };
}
