import type { TuiContextsResult } from '../contexts/index.js';
import type { DiscoveryEndpoint } from '../discovery/model.js';
import type { DiagnosticQueryOptions } from '../diagnostics/query.js';
import type { DiagnosticLevel, DiagnosticResult, DiagnosticSummary } from '../diagnostics/model.js';
import type { QueryError } from '../queries/reading.js';
import type { CollectionResult, ServiceSnapshot } from '../queries/services.js';
import type { Completeness } from '../sessions/model.js';
import type { OutboxMetadataResult } from './communications.js';

export interface OverviewReadRequest { contextId: string; signal?: AbortSignal }
export interface OverviewResult { completeness: Completeness; observedAt: number; errors: QueryError[] }
export interface ProviderObservation {
  providerId: string;
  /** Observed counts; incomplete observations are never exact population counts. */
  count: number;
  anonymous: number;
  completeness: Completeness;
}
export interface ConnectionObservation { id: string; kind: string; name: string; target: string }
export interface ServiceObservation extends ServiceSnapshot {
  pause?: { state: 'revoked' | 'unknown'; message: string };
}
export interface WatchdogObservation {
  running: boolean | null;
  evidence: 'fresh-heartbeat' | 'live-pid' | 'missing' | 'stale' | 'unavailable';
  pid?: number;
  heartbeatAt?: number;
}
export interface DiagnosticObservation {
  id: string;
  group: string;
  code: string;
  level: DiagnosticLevel;
  label: string;
  description: string;
  guidance: string;
  facts: readonly { label: string; value: string }[];
}
export interface DoctorObservation extends OverviewResult {
  checks: readonly DiagnosticObservation[];
  summary: DiagnosticSummary | null;
}
export interface StatusOverview extends OverviewResult {
  providers: readonly ProviderObservation[];
  connections: readonly ConnectionObservation[];
  services: readonly ServiceObservation[];
  outbox: { threads: number; items: number | null };
  watchdog: WatchdogObservation;
  lastDoctor: DoctorObservation | null;
}
export interface LocalOverview {
  readStatus(request: OverviewReadRequest): Promise<StatusOverview>;
  readDoctor(request: OverviewReadRequest): Promise<DoctorObservation>;
}
export interface OverviewOptions {
  home: string;
  discovery: DiscoveryEndpoint;
  env?: NodeJS.ProcessEnv;
  readOutbox?(signal?: AbortSignal): Promise<OutboxMetadataResult>;
  readContexts?(signal?: AbortSignal): Promise<TuiContextsResult>;
  readServices?(signal?: AbortSignal): Promise<CollectionResult<ServiceSnapshot>>;
  queryDoctor?(options: DiagnosticQueryOptions & { home: string; env?: NodeJS.ProcessEnv; timeoutMs: number }): Promise<DiagnosticResult>;
  now?(): number;
  doctorTimeoutMs?: number;
}
