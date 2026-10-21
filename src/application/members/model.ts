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
  signal?: AbortSignal;
}

export interface MemberObservation {
  providerId: string;
  readName(): Promise<string | undefined>;
}

export type MemberProviderFactory = (request: MemberSnapshotRequest) => readonly MemberProvider[];
