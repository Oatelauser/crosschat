import type { DiscoveryJson } from '../discovery/model.js';
import type { ProviderCapabilities, SessionRef } from '../sessions/model.js';
import type { QueryError } from '../queries/reading.js';

export type TcpRole = 'broker-owner' | 'star-admin' | 'member';
export type TcpPresence = 'online' | 'offline' | 'unknown';
export type TcpCompleteness = 'complete' | 'partial' | 'unavailable' | 'cancelled';
export interface TcpReadResult {
  contextId: string;
  completeness: TcpCompleteness;
  observedAt: number;
  errors: QueryError[];
}
export interface TcpStar {
  id: string;
  contextId: string;
  starId: string;
  name: string | null;
  revision: string;
  role: TcpRole;
  host: string;
  port: number;
  health: 'reachable' | 'unavailable' | 'unknown';
  onlineNodes: number | null;
}
export interface TcpMachine {
  id: string;
  contextId: string;
  starId: string;
  machineId: string;
  mid8: string;
  name: string | null;
  labels: string[];
  presence: TcpPresence;
  addedAt: string | null;
}
export interface TcpCredential {
  id: string;
  contextId: string;
  starId: string;
  kind: 'node' | 'admin';
  label: string;
  revision: string;
  machineId: string | null;
  machineName: string | null;
  addedAt: string;
}
export interface TcpMember {
  id: string;
  contextId: string;
  starId: string;
  machineId: string;
  machineName: string | null;
  nativeId: string;
  providerId: string | null;
  name: string | null;
  presence: TcpPresence;
  temporary: boolean;
  extendsName?: string;
  extendsMachine?: string;
  address?: string;
  addressReason?: string;
}
export interface TcpStarsResult extends TcpReadResult {
  role: TcpRole | null;
  configured: boolean;
  items: TcpStar[];
}
export interface TcpStarResult extends TcpReadResult {
  star: TcpStar | null;
  machines: TcpMachine[];
  members: TcpMember[];
  credentials: TcpCredential[];
}
/** Native state and roster presence have independent authorities. */
export interface TcpSession {
  id: string;
  contextId: string;
  starId: string;
  machineId: string;
  mid8: string;
  machineName: string | null;
  nativeId: string;
  providerId: string | null;
  name: string | null;
  ref: SessionRef | null;
  rawStatus: DiscoveryJson;
  capabilities: ProviderCapabilities | null;
  attributes: Readonly<Record<string, DiscoveryJson>>;
  member: TcpMember | null;
  membership: 'member' | 'not-member' | 'unknown';
  presence: TcpPresence;
  discovered: boolean;
  address?: string;
  addressReason?: string;
}
export interface TcpSessionNodeResult {
  machineId: string;
  completeness: TcpCompleteness;
  observedAt: number;
  errors: QueryError[];
}
export interface TcpSessionsResult extends TcpReadResult {
  star: TcpStar | null;
  scope: 'members' | 'discoverable';
  items: TcpSession[];
  nodes: TcpSessionNodeResult[];
}
export interface TcpContextRequest { contextId: string; signal?: AbortSignal }
export interface TcpStarRequest extends TcpContextRequest { starId?: string }
export interface TcpSessionsRequest extends TcpStarRequest { machineId?: string; scope: 'members' | 'discoverable' }
export interface TcpApplication {
  readStars(request: TcpContextRequest): Promise<TcpStarsResult>;
  readStar(request: TcpStarRequest): Promise<TcpStarResult>;
  readSessions(request: TcpSessionsRequest): Promise<TcpSessionsResult>;
}
