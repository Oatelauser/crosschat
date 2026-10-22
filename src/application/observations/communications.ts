import type { CollectionResult } from '../queries/services.js';
import type { QueryOptions } from '../queries/reading.js';
import type { SessionRef } from '../sessions/model.js';

export interface CommunicationQueryOptions extends QueryOptions {
  baseDir: string;
  contextId: string;
  /** Each JSON file is bounded independently; oversized sources remain explicit partial rows. */
  maxFileBytes?: number;
  /** A recent audit window, independent of the complete persisted conversation-pair inventory. */
  auditMaxBytes?: number;
  auditMaxLines?: number;
  localMachineId?: string;
  localHostname?: string;
}

export interface OutboxItemMetadata {
  id: string;
  parkedAt: number;
  attempts: number;
  toName: string;
  callerKey?: string;
  deliveryMode?: string;
  deliveryState?: string;
}

export interface OutboxThreadMetadata {
  id: string;
  contextId: string;
  providerId: string;
  threadId: string;
  toName: string | null;
  /** null means the source could not be counted; it never means an empty queue. */
  count: number | null;
  oldestParkedAt: number | null;
  mailboxFile: string;
  state: 'ready' | 'unreadable' | 'malformed' | 'oversized';
  items: OutboxItemMetadata[];
}

export interface CommunicationSummary {
  id: string;
  contextId: string;
  pairId: string;
  endpoints: [string, string];
  names: [string, string];
  /** Existing persisted, decodable full reference only; no short handle allocation. */
  ref: string | null;
  updatedAt: number;
  channel: 'local' | 'ssh' | 'tcp' | 'unknown';
  turn: number | null;
  status: string | null;
  receipt: string | null;
  /** Only endpoints with positive local ownership evidence; names and id8 never establish it. */
  localSessionRefs: SessionRef[];
  /** null means at least one queue source could not be counted safely. */
  parked: number | null;
}

export type CommunicationsResult = CollectionResult<CommunicationSummary>;
export type OutboxMetadataResult = CollectionResult<OutboxThreadMetadata>;

export interface OutboxCounts {
  threads: number;
  /** null when any present source has unknown size. */
  items: number | null;
}
