import { getOpenCodeThread, listOpenCodeThreadPage } from '../../opencode/client.js';
import type { OpenCodeOptions, OpenCodeThread } from '../../opencode/client.js';
import { MultichatError } from '../../errors.js';
import { sessionKey } from './model.js';
import type { ProviderCapabilities, Session, SessionReader, SourceError } from './model.js';
import { cancelledPage, errorPage } from './reading.js';

const capabilities: ProviderCapabilities = { discovery: true, delivery: true, deliveryModes: ['queue', 'steer'], launch: false, diagnostics: false };

export interface OpenCodeReaderOptions extends OpenCodeOptions {
  now?: () => number;
}

function session(thread: OpenCodeThread, contextId: string): Session {
  const ref = { contextId, providerId: 'opencode', nativeId: thread.id };
  return { ref, key: sessionKey(ref), name: thread.name, rawStatus: thread.rawStatus, capabilities, attributes: { ...thread.attributes, cwd: thread.cwd } };
}

function sourceError(error: unknown, contextId: string): SourceError {
  const code = error instanceof MultichatError ? error.code : '';
  const kind = code === 'OPENCODE_NOT_CONFIGURED' ? 'missing'
    : code === 'OPENCODE_REGISTRATION_UNREADABLE' ? 'unreadable'
      : code === 'OPENCODE_INVALID_CURSOR' ? 'invalid-cursor'
        : code === 'OPENCODE_REGISTRATION_MALFORMED' || code === 'OPENCODE_PROTOCOL_ERROR' ? 'malformed'
          : code === 'OPENCODE_CANCELLED' ? 'cancelled' : 'unavailable';
  return { source: { contextId, providerId: 'opencode' }, kind,
    message: error instanceof MultichatError ? error.message : 'OpenCode session source could not be read.',
    nextStep: 'Check the running OpenCode V2 service and refresh the session source.' };
}

export function createOpenCodeSessionReader(options: OpenCodeReaderOptions = {}): SessionReader {
  const now = options.now ?? Date.now;
  return {
    providerId: 'opencode', capabilities,
    async list(request) {
      const signal = request.signal ?? options.signal;
      if (signal?.aborted) return cancelledPage(request.contextId, 'opencode', now());
      try {
        const page = await listOpenCodeThreadPage({ ...options, signal, cursor: request.cursor, limit: request.limit });
        return { items: page.data.map((item) => session(item, request.contextId)), nextCursor: page.nextCursor,
          completeness: page.completeness, observedAt: now(), errors: [] };
      } catch (error) {
        if (signal?.aborted) return cancelledPage(request.contextId, 'opencode', now());
        return errorPage(sourceError(error, request.contextId), now());
      }
    },
    async get(request) {
      const signal = request.signal ?? options.signal;
      if (signal?.aborted) return { ...cancelledPage(request.contextId, 'opencode', now()), item: null };
      if (request.referenceKind === 'process') return { item: null, completeness: 'complete', observedAt: now(), errors: [] };
      try {
        const item = await getOpenCodeThread(request.nativeId, { ...options, signal });
        return { item: item === null ? null : session(item, request.contextId), completeness: 'complete', observedAt: now(), errors: [] };
      } catch (error) {
        if (signal?.aborted) return { ...cancelledPage(request.contextId, 'opencode', now()), item: null };
        return { ...errorPage(sourceError(error, request.contextId), now()), item: null };
      }
    },
  };
}
