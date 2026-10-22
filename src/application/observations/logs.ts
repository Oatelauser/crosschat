import type { LogCursor } from '../queries/logs.js';
import type { CollectionResult } from '../queries/services.js';
import type { SessionRef } from '../sessions/model.js';

export interface ManagedLogSource { id: string; label: string; path: string }
export interface ManagedLogLine { id: string; offset: number; text: string; terminated: boolean }
export interface LogCheckpoint { cursor: LogCursor; epoch: number }
export interface ManagedLogResult extends CollectionResult<ManagedLogLine> {
  source: ManagedLogSource | null;
  sources: readonly ManagedLogSource[];
  checkpoint?: LogCheckpoint;
  bytesRead: number;
  truncated: boolean;
  omittedLeadingLine: boolean;
  rotated: boolean;
}
export interface ManagedLogOptions {
  baseDir: string;
  sourceId?: string;
  signal?: AbortSignal;
  now?: () => number;
  maxBytes?: number;
  previous?: LogCheckpoint;
  sessionRef?: SessionRef;
  pairId?: string;
}
