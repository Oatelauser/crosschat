/** Read-only profile facts. Installed files and a running bridge are separate evidence. */
export type DshPluginIssue = 'profiles-unreadable' | 'profile-limit' | 'profile-location'
  | 'profile-unreadable' | 'profile-invalid' | 'installation-missing' | 'package-invalid'
  | 'installation-unreadable' | 'content-differs' | 'read-limit' | 'source-unavailable' | 'timeout';

export type DshProfileDiagnostic =
  | { state: 'not-declared'; profileDir: string }
  | { state: 'ready'; profileDir: string; packageDir: string; version: string }
  | { state: 'warning'; path: string; reason: DshPluginIssue; profileDir?: string; packageDir?: string; version?: string };

export interface DshProfileDiagnosticOptions {
  home: string;
  dshHome?: string;
  /** Only directories already verified by the native bridge handshake. */
  verifiedProfileDirs?: readonly string[];
  sourceDir?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Runs inside the existing query-owned process and creates no files. */
export async function inspectDshProfiles(options: DshProfileDiagnosticOptions): Promise<DshProfileDiagnostic[]> {
  void options;
  return [];
}
