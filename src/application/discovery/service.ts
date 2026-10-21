import { SessionCatalog } from '../sessions/catalog.js';
import { sessionKey } from '../sessions/model.js';
import type { SessionReader, SourceError } from '../sessions/model.js';
import { errorPage } from '../sessions/reading.js';
import { parseDiscoveryRequest, parseDiscoveryResponse } from './boundary.js';
import type { DiscoveryEndpoint, DiscoveryOptions, DiscoveryProvider, DiscoveryRequest, DiscoveryResponse } from './model.js';

export function discoveryFailure(request: DiscoveryRequest, contextId: string, kind: SourceError['kind'], message: string, observedAt = Date.now()): DiscoveryResponse {
  const base = { completeness: kind === 'cancelled' ? 'cancelled' as const : 'unavailable' as const, observedAt, errors: [{ source: { contextId, providerId: 'discovery' }, kind, message }] };
  return request.op === 'list' ? { op: 'list', providers: [], page: { ...base, items: [], nextCursor: null } } : { op: 'detail', providers: [], detail: { ...base, item: null } };
}

/** Shared read-only core for local, SSH and TCP discovery; adapters own authority and transport. */
export class DiscoveryService implements DiscoveryEndpoint {
  private readonly catalog: SessionCatalog;
  private readonly providers: DiscoveryProvider[];

  constructor(readers: readonly SessionReader[], private readonly now: () => number = Date.now) {
    this.providers = readers.map((reader) => ({ providerId: reader.providerId, capabilities: { ...reader.capabilities } }));
    this.catalog = new SessionCatalog(readers.map((reader) => this.safeReader(reader)), now);
  }

  async execute(input: DiscoveryRequest, options: DiscoveryOptions = {}): Promise<DiscoveryResponse> {
    const request = parseDiscoveryRequest(input);
    const contextId = options.contextId ?? 'local';
    const signal = options.signal;
    const response = request.op === 'list'
      ? { op: 'list', providers: this.providers, page: await this.catalog.query({ contextId, cursor: request.cursor, limit: request.limit ?? 100, filter: request.filter, signal }) }
      : { op: 'detail', providers: this.providers, detail: await this.catalog.detail({ contextId, providerId: request.providerId, nativeId: request.nativeId, referenceKind: request.referenceKind }, { signal }) };
    try { return parseDiscoveryResponse(response); }
    catch { return discoveryFailure(request, contextId, 'malformed', 'Session source returned invalid discovery metadata.', this.now()); }
  }

  private safeReader(reader: SessionReader): SessionReader {
    const providers = [{ providerId: reader.providerId, capabilities: reader.capabilities }];
    const malformed = (contextId: string) => errorPage({ source: { contextId, providerId: reader.providerId }, kind: 'malformed', message: 'Session source returned invalid discovery metadata.' }, this.now());
    return {
      providerId: reader.providerId, capabilities: reader.capabilities,
      list: async (request) => {
        const page = await reader.list(request);
        try {
          const response = parseDiscoveryResponse({ op: 'list', providers, page });
          if (response.op !== 'list') throw new Error('Invalid source operation.');
          return { ...response.page, items: response.page.items.map((item) => ({ ...item, key: sessionKey(item.ref) })) };
        } catch { return malformed(request.contextId); }
      },
      get: async (request) => {
        const detail = await reader.get(request);
        try {
          const response = parseDiscoveryResponse({ op: 'detail', providers, detail });
          if (response.op !== 'detail') throw new Error('Invalid source operation.');
          const item = response.detail.item;
          return { ...response.detail, item: item === null ? null : { ...item, key: sessionKey(item.ref) } };
        } catch {
          const page = malformed(request.contextId);
          return { item: null, completeness: page.completeness, errors: page.errors, observedAt: page.observedAt };
        }
      },
    };
  }
}
