import type { Session, SessionDetail, SessionListRequest, SessionPage, SessionReader, SessionRef, SourceError } from './model.js';
import { cancelledPage, errorPage, isRecord, untilAborted } from './reading.js';

export interface SessionFilter {
  providerIds?: readonly string[];
  /** Case-insensitive substring across name, full native ID, provider and raw state. */
  text?: string;
}

export interface SessionQuery extends SessionListRequest {
  filter?: SessionFilter;
}

interface CursorSource {
  providerId: string;
  cursor: string;
}

interface QueryState {
  sources: Array<{ reader: SessionReader; cursor?: string }>;
  errors: SourceError[];
  incomplete: boolean;
}

const errorKinds = new Set<SourceError['kind']>(['missing', 'unreadable', 'malformed', 'unavailable', 'legacy-limit', 'cancelled', 'invalid-cursor', 'unsupported']);

function cursorError(value: unknown, contextId: string): SourceError {
  if (!isRecord(value) || !isRecord(value.source) || value.source.contextId !== contextId || typeof value.source.providerId !== 'string' || typeof value.kind !== 'string' || ![...errorKinds].some((kind) => kind === value.kind) || typeof value.message !== 'string' || (value.source.path !== undefined && typeof value.source.path !== 'string') || (value.nextStep !== undefined && typeof value.nextStep !== 'string')) throw new Error('Invalid cursor error');
  const kind = [...errorKinds].find((kind) => kind === value.kind);
  if (kind === undefined) throw new Error('Invalid cursor error kind');
  return { source: { contextId, providerId: value.source.providerId, ...(typeof value.source.path === 'string' ? { path: value.source.path } : {}) }, kind, message: value.message, ...(typeof value.nextStep === 'string' ? { nextStep: value.nextStep } : {}) };
}

function filterKey(filter?: SessionFilter): string {
  return JSON.stringify([filter?.providerIds === undefined ? null : [...filter.providerIds].sort(), filter?.text ?? '']);
}

function matches(session: Session, filter?: SessionFilter): boolean {
  const text = filter?.text?.toLocaleLowerCase();
  if (!text) return true;
  const raw = typeof session.rawStatus === 'string' ? session.rawStatus : JSON.stringify(session.rawStatus);
  return [session.name, session.ref.nativeId, session.ref.providerId, raw].some((value) => value?.toLocaleLowerCase().includes(text));
}

/** Source-neutral query orchestration; no provider branches, writes or UI concepts. */
export class SessionCatalog {
  private readonly readers: Map<string, SessionReader>;

  constructor(readers: readonly SessionReader[], private readonly now: () => number = Date.now) {
    this.readers = new Map();
    for (const reader of readers) {
      if (this.readers.has(reader.providerId)) throw new Error(`Duplicate session provider: ${reader.providerId}`);
      this.readers.set(reader.providerId, reader);
    }
  }

  async query(request: SessionQuery): Promise<SessionPage> {
    if (request.signal?.aborted) return cancelledPage(request.contextId, 'catalog', this.now());
    let state: QueryState;
    try {
      state = this.sources(request);
    } catch {
      return errorPage({ source: { contextId: request.contextId, providerId: 'catalog' }, kind: 'invalid-cursor', message: 'Session page cursor does not match this query.', nextStep: 'Refresh from the first page.' }, this.now());
    }
    const { sources } = state;
    const work = Promise.all(sources.map(async ({ reader, cursor }) => {
      try {
        return await reader.list({ contextId: request.contextId, cursor, limit: request.limit, signal: request.signal });
      } catch {
        return errorPage({ source: { contextId: request.contextId, providerId: reader.providerId }, kind: 'unavailable', message: 'Session source could not be read.', nextStep: 'Check the source connection and retry.' }, this.now());
      }
    }));
    let pages: SessionPage[];
    try {
      pages = await untilAborted(work, request.signal);
    } catch {
      return cancelledPage(request.contextId, 'catalog', this.now());
    }
    if (request.signal?.aborted) return cancelledPage(request.contextId, 'catalog', this.now());
    const pending = pages.flatMap((page, index) => page.nextCursor === null ? [] : [{ providerId: sources[index].reader.providerId, cursor: page.nextCursor }]);
    const errors = [...state.errors, ...pages.flatMap((page) => page.errors)];
    const incomplete = state.incomplete || errors.length > 0 || pages.some((page) => page.completeness !== 'complete' && page.nextCursor === null);
    const items = pages.flatMap((page) => page.items).filter((item) => matches(item, request.filter));
    return {
      items,
      nextCursor: pending.length === 0 ? null : Buffer.from(JSON.stringify({ contextId: request.contextId, filterKey: filterKey(request.filter), pending, errors, incomplete })).toString('base64url'),
      completeness: !incomplete && pages.every((page) => page.completeness === 'complete') ? 'complete'
        : pages.length > 0 && pages.every((page) => page.completeness === 'unavailable') ? 'unavailable'
          : pages.some((page) => page.completeness === 'cancelled') ? 'cancelled' : 'partial',
      errors, observedAt: this.now(),
    };
  }

  async detail(ref: SessionRef, options: { signal?: AbortSignal } = {}): Promise<SessionDetail> {
    if (options.signal?.aborted) return this.detailPage(cancelledPage(ref.contextId, ref.providerId, this.now()));
    const reader = this.readers.get(ref.providerId);
    if (reader === undefined) return this.detailPage(errorPage({ source: ref, kind: 'unsupported', message: 'Session provider is not available in this context.' }, this.now()));
    try {
      const result = await untilAborted(reader.get({ contextId: ref.contextId, nativeId: ref.nativeId, signal: options.signal }), options.signal);
      return options.signal?.aborted ? this.detailPage(cancelledPage(ref.contextId, ref.providerId, this.now())) : result;
    } catch {
      return this.detailPage(options.signal?.aborted ? cancelledPage(ref.contextId, ref.providerId, this.now()) : errorPage({ source: ref, kind: 'unavailable', message: 'Session detail could not be read.' }, this.now()));
    }
  }

  private detailPage(page: SessionPage): SessionDetail {
    return { item: null, completeness: page.completeness, observedAt: page.observedAt, errors: page.errors };
  }

  private sources(request: SessionQuery): QueryState {
    if (request.cursor === undefined) return { sources: [...this.readers.values()].filter((reader) => request.filter?.providerIds === undefined || request.filter.providerIds.includes(reader.providerId)).map((reader) => ({ reader })), errors: [], incomplete: false };
    const value: unknown = JSON.parse(Buffer.from(request.cursor, 'base64url').toString('utf8'));
    if (!isRecord(value) || value.contextId !== request.contextId || value.filterKey !== filterKey(request.filter) || !Array.isArray(value.pending) || !Array.isArray(value.errors) || typeof value.incomplete !== 'boolean') throw new Error('Invalid cursor');
    const errors = value.errors.map((error) => cursorError(error, request.contextId));
    const pending: CursorSource[] = [];
    for (const entry of value.pending) {
      if (!isRecord(entry) || typeof entry.providerId !== 'string' || typeof entry.cursor !== 'string' || pending.some((source) => source.providerId === entry.providerId)) throw new Error('Invalid cursor source');
      pending.push({ providerId: entry.providerId, cursor: entry.cursor });
    }
    const sources = pending.map(({ providerId, cursor }) => {
      const reader = this.readers.get(providerId);
      if (reader === undefined || (request.filter?.providerIds !== undefined && !request.filter.providerIds.includes(providerId))) throw new Error('Unknown cursor provider');
      return { reader, cursor };
    });
    return { sources, errors, incomplete: value.incomplete || errors.length > 0 };
  }
}
