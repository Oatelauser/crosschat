import { getDshThread, listDshThreadPage } from '../../dsh/client.js';
import type { DshOptions, DshThread } from '../../dsh/client.js';
import { MultichatError } from '../../errors.js';
import { sessionKey } from './model.js';
import type { ProviderCapabilities, Session, SessionReader, SourceError } from './model.js';
import { cancelledPage, errorPage } from './reading.js';

const capabilities: ProviderCapabilities = { discovery: true, delivery: true, deliveryModes: ['queue', 'steer'], launch: false, diagnostics: false };
export interface DshReaderOptions extends DshOptions { now?: () => number }

function session(thread: DshThread, contextId: string): Session {
  const ref = { contextId, providerId: 'dsh', nativeId: thread.id, ...(thread.endpointType === undefined ? {} : { endpointType: thread.endpointType }) };
  return { ref, key: sessionKey(ref), name: thread.name, rawStatus: thread.rawStatus, capabilities,
    attributes: { ...thread.attributes, cwd: thread.cwd } };
}

function sourceError(error: unknown, contextId: string): SourceError {
  const code = error instanceof MultichatError ? error.code : '';
  const kind = code === 'DSH_NOT_CONFIGURED' ? 'missing'
    : code === 'DSH_REGISTRATION_UNREADABLE' ? 'unreadable'
      : code === 'DSH_INVALID_CURSOR' ? 'invalid-cursor'
        : code === 'DSH_UNSUPPORTED_VERSION' || code === 'DSH_UNSUPPORTED_PROTOCOL' ? 'unsupported'
          : code === 'DSH_REGISTRATION_MALFORMED' || code === 'DSH_PROTOCOL_ERROR' ? 'malformed'
            : code === 'DSH_CANCELLED' ? 'cancelled' : 'unavailable';
  return { source: { contextId, providerId: 'dsh' }, kind,
    message: error instanceof MultichatError ? error.message : 'Harness session source could not be read.',
    nextStep: 'Check the crosschat bridge in the original Harness profile, then refresh.' };
}

/** Reads only live root metadata through the authenticated bridge; never creates or resumes Agents. */
export function createDshSessionReader(options: DshReaderOptions = {}): SessionReader {
  const now = options.now ?? Date.now;
  return { providerId: 'dsh', capabilities,
    async list(request) {
      const signal = request.signal ?? options.signal;
      if (signal?.aborted) return cancelledPage(request.contextId, 'dsh', now());
      try {
        const page = await listDshThreadPage({ ...options, signal, cursor: request.cursor, limit: request.limit,
          ...(request.endpointType === undefined ? {} : { endpointType: request.endpointType }) });
        return { items: page.data.map((item) => session(item, request.contextId)), nextCursor: page.nextCursor,
          completeness: page.completeness, observedAt: now(), errors: [] };
      } catch (error) {
        if (signal?.aborted) return cancelledPage(request.contextId, 'dsh', now());
        return errorPage(sourceError(error, request.contextId), now());
      }
    },
    async get(request) {
      const signal = request.signal ?? options.signal;
      if (signal?.aborted) return { ...cancelledPage(request.contextId, 'dsh', now()), item: null };
      if (request.referenceKind === 'process') return { item: null, completeness: 'complete', observedAt: now(), errors: [] };
      try {
        const item = await getDshThread(request.nativeId, { ...options, signal,
          ...(request.endpointType === undefined ? {} : { endpointType: request.endpointType }) });
        return { item: item === null ? null : session(item, request.contextId), completeness: 'complete', observedAt: now(), errors: [] };
      } catch (error) {
        if (signal?.aborted) return { ...cancelledPage(request.contextId, 'dsh', now()), item: null };
        return { ...errorPage(sourceError(error, request.contextId), now()), item: null };
      }
    },
  };
}
