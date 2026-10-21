import type { SessionFilter } from '../sessions/catalog.js';
import type { ProviderCapabilities, ReadResult, SessionRef } from '../sessions/model.js';

export type DiscoveryRequest =
  | { op: 'list'; cursor?: string; limit?: number; filter?: SessionFilter }
  | { op: 'detail'; providerId: string; nativeId: string; referenceKind?: 'native' | 'process' };

export type DiscoveryJson = null | boolean | number | string | DiscoveryJson[] | { [key: string]: DiscoveryJson };

export interface DiscoveryProvider {
  providerId: string;
  capabilities: ProviderCapabilities;
}

/** Transport metadata has no delivery socket, credentials, chat body or internal session key. */
export interface DiscoverySession {
  ref: SessionRef;
  name: string | null;
  rawStatus: DiscoveryJson;
  capabilities: ProviderCapabilities;
  attributes: Readonly<Record<string, DiscoveryJson>>;
}

export interface DiscoveryPage extends ReadResult {
  items: DiscoverySession[];
  nextCursor: string | null;
}

export interface DiscoveryDetail extends ReadResult {
  item: DiscoverySession | null;
}

export type DiscoveryResponse =
  | { op: 'list'; providers: DiscoveryProvider[]; page: DiscoveryPage }
  | { op: 'detail'; providers: DiscoveryProvider[]; detail: DiscoveryDetail };

export interface DiscoveryOptions {
  contextId?: string;
  signal?: AbortSignal;
}

export interface DiscoveryEndpoint {
  execute(request: DiscoveryRequest, options?: DiscoveryOptions): Promise<DiscoveryResponse>;
}

export interface DiscoveryRemoteScope {
  contextId: string;
  /** Authoritative target identity, including the star for TCP. */
  target: string;
}
