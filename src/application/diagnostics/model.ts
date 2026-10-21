export type DiagnosticLevel = 'pass' | 'warn' | 'error' | 'info';
export type DiagnosticGroup = { kind: 'environment' } | { kind: 'tcp'; star?: string } | { kind: 'other' };
type Empty = Record<string, never>;
type SkillSide = 'claude' | 'codex';
type Endpoint = { host: string; port: number };
type Version = { version: string };

/** Facts only: presentation and guidance belong to the renderer. No credentials. */
export interface DiagnosticData {
  'node-supported': Version;
  'node-unsupported': Version;
  'claude-ready': { executable: string; count: number };
  'claude-empty': { executable: string };
  'claude-missing': Empty;
  'claude-registry-malformed': { count: number };
  'codex-missing': Empty;
  'codex-unparsed': { firstLine: string; status: number | null };
  'codex-cli-old': Version;
  'codex-cli-ready': Version;
  'codex-daemon-missing': Empty;
  'codex-daemon-old': Version;
  'codex-daemon-ready': Version;
  'skill-missing': { side: SkillSide; path: string };
  'skill-installed': { side: SkillSide };
  'skill-match': { side: SkillSide };
  'skill-mismatch': { side: SkillSide; paths: string[] };
  'identity-conflict': Empty;
  'identity-clear': Empty;
  'node-config-invalid': { path: string };
  'node-config-ready': Empty;
  'node-star-id-missing': { label: string };
  'node-star-id-duplicate': { first: string; label: string; starId: string };
  'broker-reachable': Endpoint;
  'broker-unreachable': Endpoint;
  'broker-empty': Empty;
  'broker-ready': { stars: number; nodes: number };
  'broker-port-custom': { port: number; defaultPort: number; path: string };
  'broker-invalid': Empty;
  'status-stale': { file: string };
  'status-process-unavailable': { file: string; pid?: number };
  'resident-version-mismatch': { label: string; version: string; cliVersion: string; restartCommand: string };
  'outbox-empty': Empty;
  'outbox-parked': {
    threadId: string; count: number; ageMinutes?: number;
    watchdogRunning: boolean; mailboxFile: string;
  };
}

export type DiagnosticCode = keyof DiagnosticData;
export type DiagnosticInput = { [C in DiagnosticCode]: { code: C; data: DiagnosticData[C] } }[DiagnosticCode];
export type DiagnosticCheck = DiagnosticInput & { level: DiagnosticLevel };
export interface DiagnosticCheckGroup {
  context: DiagnosticGroup;
  checks: DiagnosticCheck[];
}
export interface DiagnosticSummary {
  pass: number;
  warn: number;
  error: number;
  failed: boolean;
}
export interface DiagnosticResult {
  groups: DiagnosticCheckGroup[];
  summary: DiagnosticSummary;
}

const LEVELS: Record<DiagnosticCode, DiagnosticLevel> = {
  'node-supported': 'pass', 'node-unsupported': 'error',
  'claude-ready': 'pass', 'claude-empty': 'warn', 'claude-missing': 'warn', 'claude-registry-malformed': 'warn',
  'codex-missing': 'warn', 'codex-unparsed': 'warn', 'codex-cli-old': 'warn', 'codex-cli-ready': 'pass',
  'codex-daemon-missing': 'warn', 'codex-daemon-old': 'warn', 'codex-daemon-ready': 'pass',
  'skill-missing': 'warn', 'skill-installed': 'pass', 'skill-match': 'pass', 'skill-mismatch': 'warn',
  'identity-conflict': 'warn', 'identity-clear': 'pass',
  'node-config-invalid': 'error', 'node-config-ready': 'pass', 'node-star-id-missing': 'warn', 'node-star-id-duplicate': 'warn',
  'broker-reachable': 'pass', 'broker-unreachable': 'error', 'broker-empty': 'warn', 'broker-ready': 'pass',
  'broker-port-custom': 'warn', 'broker-invalid': 'error',
  'status-stale': 'info', 'status-process-unavailable': 'info', 'resident-version-mismatch': 'warn',
  'outbox-empty': 'pass', 'outbox-parked': 'pass',
};

export function diagnosticCheck(input: DiagnosticInput): DiagnosticCheck {
  return { ...input, level: LEVELS[input.code] };
}

/** Preserve the existing rule: warnings and uncounted info never fail doctor. */
export function summarizeDiagnosticChecks(groups: readonly DiagnosticCheckGroup[]): DiagnosticSummary {
  const summary = { pass: 0, warn: 0, error: 0, failed: false };
  for (const group of groups) {
    for (const check of group.checks) {
      if (check.level !== 'info') summary[check.level] += 1;
    }
  }
  summary.failed = summary.error > 0;
  return summary;
}
