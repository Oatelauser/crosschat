import type { ClaudeRegistryScan } from '../claude/registry.js';
import type { CodexThreadSummary } from '../codex/client.js';
import { MultichatError } from '../errors.js';

/**
 * Read-only `status`: claude registry sessions (name/kind/status/pid) plus
 * codex threads (name/status/id prefix). A codex discovery failure degrades to
 * an "unavailable" marker instead of failing the whole command — a side being
 * down is a valid status answer.
 */

export interface StatusDeps {
  listClaudeSessions(): ClaudeRegistryScan;
  listCodexThreads(): Promise<CodexThreadSummary[]>;
}

export async function runStatus(deps: StatusDeps, json: boolean): Promise<string> {
  const scan = deps.listClaudeSessions();
  let threads: CodexThreadSummary[] | undefined;
  let codexError: string | undefined;
  try {
    threads = await deps.listCodexThreads();
  } catch (err) {
    codexError =
      err instanceof MultichatError
        ? `${err.code}: ${err.message}`
        : `INTERNAL: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (json) {
    return JSON.stringify({
      claude: scan.sessions.map((session) => ({
        name: session.name ?? null,
        kind: session.kind,
        status: session.status,
        pid: session.pid,
      })),
      codex:
        threads === undefined
          ? { error: codexError }
          : threads.map((thread) => ({
              name: thread.name,
              status: thread.status,
              id: thread.id.slice(0, 8),
            })),
    });
  }

  const lines: string[] = ['claude:'];
  if (scan.sessions.length === 0) lines.push('  (none)');
  for (const session of scan.sessions) {
    lines.push(
      `  ${(session.name ?? '(unnamed)').padEnd(24)} ${session.kind.padEnd(12)} ${session.status.padEnd(16)} pid ${session.pid}`,
    );
  }
  lines.push('codex:');
  if (codexError !== undefined) lines.push(`  unavailable (${codexError})`);
  else if ((threads ?? []).length === 0) lines.push('  (none)');
  else {
    for (const thread of threads ?? []) {
      lines.push(`  ${(thread.name ?? '(unnamed)').padEnd(24)} ${thread.status.padEnd(16)} ${thread.id.slice(0, 8)}`);
    }
  }
  return lines.join('\n');
}
