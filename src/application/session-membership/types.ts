import type { DiscoveryEndpoint, DiscoverySession } from '../discovery/model.js';
import type { Completeness, SessionRef, SourceError } from '../sessions/model.js';

export interface MembershipRequest {
  op: 'adopt' | 'remove';
  ref: SessionRef;
  starId: string;
  signal?: AbortSignal;
}

export interface MembershipTargets {
  stars: readonly { id: string; label: string; eligible: boolean; reason?: string }[];
  completeness: Completeness;
  observedAt: number;
  errors: SourceError[];
}

export interface MembershipCheck {
  allowed: boolean;
  reason?: string;
  nextStep?: string;
  impact?: readonly string[];
}

export interface MembershipResult {
  kind: 'applied' | 'rejected' | 'uncertain';
  message: string;
}

/** UI-neutral membership operations. Results never contain credentials or BrokerEntry. */
export interface SessionMembershipService {
  listTargets(request: { contextId: string; signal?: AbortSignal }): Promise<MembershipTargets>;
  check(request: MembershipRequest): Promise<MembershipCheck>;
  apply(request: MembershipRequest): Promise<MembershipResult>;
}

export interface SessionMembershipOptions {
  /** ~/.crosschat, not its tcp subdirectory. */
  baseDir: string;
  discovery: DiscoveryEndpoint;
  contextId?: string;
  machineId?(): string | undefined | Promise<string | undefined>;
  readText?(path: string, signal?: AbortSignal): Promise<string>;
  now?(): number;
  timeoutMs?: number;
  spawnServeDetach?(selector: string): void;
  aggregatorTimeoutMs?: number;
  providers?: readonly MembershipProvider[];
}

/** Explicit mapping isolates the existing wire tool limits from Provider identities. */
export interface MembershipProvider {
  providerId: string;
  tool: string;
  canAdopt(session: DiscoverySession): MembershipCheck;
}
