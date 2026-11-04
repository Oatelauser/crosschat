import type { MemberLivenessReader, SessionGetRequest } from '../sessions/model.js';

/** Runtime capabilities, separate from serializable provider metadata. */
export interface MemberProvider {
  providerId: string;
  liveness: MemberLivenessReader;
  /** undefined keeps the current member name, including native anonymous sessions. */
  readName(request: SessionGetRequest): Promise<string | undefined>;
}

export interface MemberSnapshotRequest {
  contextId: string;
  nativeIds: readonly string[];
  /** Exact declared identities; raw nativeIds stay available to existing factories. */
  targets?: readonly { providerId: string; nativeId: string; endpointType?: string }[];
  signal?: AbortSignal;
}

export interface MemberObservation {
  providerId: string;
  endpointType?: string;
  readName(): Promise<string | undefined>;
}

export type MemberProviderFactory = (request: MemberSnapshotRequest) => readonly MemberProvider[];
