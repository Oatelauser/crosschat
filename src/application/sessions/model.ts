/** Provider and context IDs are opaque, extensible strings, never display names. */
export interface SessionRef {
  contextId: string;
  providerId: string;
  nativeId: string;
  /** Process references are temporary; omission means a native session ID. */
  referenceKind?: 'native' | 'process';
}

/** Collision-free internal key. This does not replace any wire or persisted key. */
export function sessionKey(ref: SessionRef): string {
  return JSON.stringify([ref.contextId, ref.providerId, ref.referenceKind ?? 'native', ref.nativeId]);
}

/** Serializable metadata. Implementations of optional capabilities live separately. */
export interface ProviderCapabilities {
  discovery: boolean;
  delivery: boolean;
  launch: boolean;
  diagnostics: boolean;
}

export interface Session {
  ref: SessionRef;
  key: string;
  name: string | null;
  rawStatus: unknown;
  capabilities: ProviderCapabilities;
  attributes: Readonly<Record<string, unknown>>;
}

export interface ReadSource {
  contextId: string;
  providerId: string;
  path?: string;
}

export interface SourceError {
  source: ReadSource;
  kind: 'missing' | 'unreadable' | 'malformed' | 'unavailable' | 'legacy-limit' | 'cancelled' | 'invalid-cursor' | 'unsupported';
  message: string;
  nextStep?: string;
}

export type Completeness = 'complete' | 'partial' | 'unavailable' | 'cancelled';

export interface ReadResult {
  completeness: Completeness;
  /** Epoch milliseconds at the end of this observation, not a cache freshness claim. */
  observedAt: number;
  errors: SourceError[];
}

export interface SessionPage extends ReadResult {
  items: Session[];
  nextCursor: string | null;
}

export interface SessionDetail extends ReadResult {
  /** null means absent only when completeness is complete. */
  item: Session | null;
}

export interface SessionListRequest {
  contextId: string;
  cursor?: string;
  /** Per-provider page bound; providers may return fewer items. */
  limit?: number;
  signal?: AbortSignal;
}

export interface SessionGetRequest {
  contextId: string;
  nativeId: string;
  referenceKind?: 'native' | 'process';
  signal?: AbortSignal;
}

export interface MemberLiveness extends ReadResult {
  nativeId: string;
  presence: 'present' | 'absent' | 'unknown';
  name: string | null;
}

export interface MemberLivenessReader {
  probe(request: SessionGetRequest): Promise<MemberLiveness>;
}

export interface SessionReader {
  providerId: string;
  capabilities: ProviderCapabilities;
  list(request: SessionListRequest): Promise<SessionPage>;
  get(request: SessionGetRequest): Promise<SessionDetail>;
  memberLiveness?: MemberLivenessReader;
}

/** Pure connection descriptions. Transport ownership belongs to their adapter. */
export interface ConnectionContext {
  id: string;
  kind: string;
  name: string | null;
  attributes: Readonly<Record<string, unknown>>;
}

export interface ContextReader {
  list(request: { signal?: AbortSignal }): Promise<ReadResult & { items: ConnectionContext[] }>;
}
