import type { ClaudeRegistryScan } from '../claude/registry.js';
import type { CodexThreadWithMeta } from '../codex/discovery.js';
import { MultichatError } from '../errors.js';

/**
 * Read-only `status`: claude registry sessions (name/kind/status/pid/dir) plus
 * codex threads (name/dir/created/originator/id/status). A codex discovery
 * failure degrades to an "unavailable" marker instead of failing the whole
 * command — a side being down is a valid status answer.
 */

export interface StatusDeps {
  listClaudeSessions(): ClaudeRegistryScan;
  listCodexThreads(): Promise<CodexThreadWithMeta[]>;
}

/** Last two segments of a session cwd (`D:\workspace\CC\foo` -> `CC\foo`). */
export function formatCwdShort(cwd: string | undefined): string {
  if (!cwd) return '-';
  const parts = cwd.split(/[\\/]+/).filter((segment) => segment.length > 0);
  if (parts.length === 0) return '-';
  return parts.slice(-2).join(cwd.includes('\\') ? '\\' : '/');
}

/** `MM-DD HH:mm` (local time) from an ISO timestamp; `-` when unknown/invalid. */
export function formatCreatedAt(iso: string | undefined): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export async function runStatus(deps: StatusDeps, json: boolean): Promise<string> {
  const scan = deps.listClaudeSessions();
  let threads: CodexThreadWithMeta[] | undefined;
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
        cwd: session.cwd ?? null,
      })),
      codex:
        threads === undefined
          ? { error: codexError }
          : threads.map((thread) => ({
              name: thread.name,
              status: thread.status,
              id: thread.id.slice(0, 8),
              cwd: thread.meta?.cwd ?? null,
              createdAt: thread.meta?.createdAt ?? null,
              originator: thread.meta?.originator ?? null,
            })),
    });
  }

  const lines: string[] = ['claude:'];
  if (scan.sessions.length === 0) lines.push('  (none)');
  for (const session of scan.sessions) {
    lines.push(
      `  ${(session.name ?? '(unnamed)').padEnd(24)} ${session.kind.padEnd(12)} ${session.status.padEnd(16)} pid ${String(session.pid).padEnd(6)} ${formatCwdShort(session.cwd)}`,
    );
  }
  lines.push('codex:');
  if (codexError !== undefined) lines.push(`  unavailable (${codexError})`);
  else if ((threads ?? []).length === 0) lines.push('  (none)');
  else {
    for (const thread of threads ?? []) {
      const name = (thread.name ?? '(unnamed)').padEnd(24);
      const dir = formatCwdShort(thread.meta?.cwd).padEnd(20);
      const created = formatCreatedAt(thread.meta?.createdAt).padEnd(11);
      const originator = (thread.meta?.originator ?? '-').padEnd(16);
      lines.push(`  ${name} ${dir} ${created} ${originator} ${thread.id.slice(0, 8)}  ${thread.status}`);
    }
  }
  return lines.join('\n');
}
