import { openCodexSession } from '../../codex/client.js';
import type { CodexSession, CodexSessionFactory } from '../../codex/client.js';
import { sessionKey } from './model.js';
import type { ProviderCapabilities, SessionPage, SessionReader } from './model.js';
import { abortError, cancelledPage, errorPage, findSession, untilAborted } from './reading.js';

export interface CodexReaderOptions {
  sessionFactory?: CodexSessionFactory;
  now?: () => number;
}

const capabilities: ProviderCapabilities = { discovery: true, delivery: true, launch: false, diagnostics: false };

export function createCodexSessionReader(options: CodexReaderOptions = {}): SessionReader {
  const factory = options.sessionFactory ?? openCodexSession();
  const now = options.now ?? Date.now;
  const reader: SessionReader = {
    providerId: 'codex', capabilities,
    async list(request): Promise<SessionPage> {
      if (request.signal?.aborted) return cancelledPage(request.contextId, 'codex', now());
      let session: CodexSession | undefined;
      let closing: Promise<void> | undefined;
      const close = (): Promise<void> => {
        if (session === undefined) return Promise.resolve();
        closing ??= session.close().catch(() => undefined);
        return closing;
      };
      const work = async (): Promise<SessionPage> => {
        session = await factory();
        if (request.signal?.aborted) { await close(); throw abortError(); }
        await session.initialize();
        if (request.signal?.aborted) throw abortError();
        const legacy = session.listThreadPage === undefined;
        const page = session.listThreadPage === undefined
          ? { data: (await session.listThreads()).map((thread) => ({ ...thread, rawStatus: thread.status, attributes: {} })), nextCursor: null, completeness: 'partial' as const }
          : await session.listThreadPage({ cursor: request.cursor, limit: request.limit, signal: request.signal });
        if (request.signal?.aborted) throw abortError();
        const partial = legacy || page.completeness === 'partial';
        return {
          items: page.data.map((thread) => {
            const ref = { contextId: request.contextId, providerId: 'codex', nativeId: thread.id };
            return { ref, key: sessionKey(ref), name: thread.name, rawStatus: thread.rawStatus, capabilities, attributes: thread.attributes };
          }),
          nextCursor: page.nextCursor,
          completeness: partial || page.nextCursor !== null ? 'partial' : 'complete', observedAt: now(),
          errors: partial ? [{ source: { contextId: request.contextId, providerId: 'codex' }, kind: 'legacy-limit', message: 'This Codex source does not confirm a complete paged result.', nextStep: 'Use a Codex version that reports page cursors.' }] : [],
        };
      };
      try {
        return await untilAborted(work(), request.signal);
      } catch {
        return request.signal?.aborted ? cancelledPage(request.contextId, 'codex', now()) : errorPage({ source: { contextId: request.contextId, providerId: 'codex' }, kind: 'unavailable', message: 'Codex session source could not be read.', nextStep: 'Check the Codex app-server connection and retry.' }, now());
      } finally {
        await close();
      }
    },
    get(request) { return findSession(reader, request); },
  };
  return reader;
}
