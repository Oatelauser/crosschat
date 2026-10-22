import type { DiscoveryEndpoint } from '../discovery/model.js';
import type { SessionMembershipService } from '../session-membership/index.js';
import type { TcpApplication } from './model.js';

export type TcpManagementAction = 'add-star' | 'rename-star' | 'remove-star' | 'set-show-name'
  | 'generate-node-key' | 'generate-admin-key' | 'remove-node' | 'revoke-credential' | 'remove-member' | 'adopt-session';
export interface TcpManagementField {
  id: string;
  label: string;
  required?: boolean;
  initialValue?: string;
  options?: readonly { value: string; label: string; enabled?: boolean; reason?: string }[];
}
export interface TcpManagementRequest {
  contextId: string;
  action: TcpManagementAction;
  starId?: string;
  targetId?: string;
  targetRevision?: string;
  values: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}
export interface TcpManagementPreview {
  enabled: boolean;
  reason?: string;
  nextStep?: string;
  revision: string;
  fields: readonly TcpManagementField[];
  impact: readonly { label: string; value: string }[];
}
/** Deliberate, one-use result material. Never put this field in ordinary pages, notices or history. */
export interface TcpManagementSecret {
  kind: 'node-configs' | 'admin-fragment';
  title: string;
  materials: readonly { label: string; content: string; connectCommand?: string }[];
  notice: string;
}
export interface TcpManagementResult {
  kind: 'applied' | 'rejected' | 'uncertain';
  message: string;
  selectedId?: string;
  mode?: 'hot' | 'cold';
  secret?: TcpManagementSecret;
}
export interface TcpManagement {
  preview(request: TcpManagementRequest): Promise<TcpManagementPreview>;
  apply(request: TcpManagementRequest & { expectedPreviewRevision: string }): Promise<TcpManagementResult>;
}
export interface TcpManagementOptions {
  baseDir: string;
  catalog: Pick<TcpApplication, 'readStars' | 'readStar'>;
  membership?: SessionMembershipService;
  discovery?: DiscoveryEndpoint;
  now?(): number;
}
