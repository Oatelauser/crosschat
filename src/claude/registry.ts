import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MultichatError } from '../errors.js';
import { isProcessAlive } from '../platform/process-inspector.js';

/** Registry kinds crosschat can route to. daemon/daemon-worker are not user sessions. */
const ROUTABLE_KINDS = new Set(['interactive', 'bg']);

export interface ClaudeSessionEntry {
  pid: number;
  sessionId: string;
  kind: string;
  name?: string;
  status: string;
  cwd?: string;
  messagingSocketPath: string;
}

export interface ClaudeRegistryScan {
  sessions: ClaudeSessionEntry[];
  /** *.json registry entries skipped because they are malformed. */
  malformed: number;
}

export function defaultClaudeSessionsDir(): string {
  return join(homedir(), '.claude', 'sessions');
}

function parseEntry(text: string): ClaudeSessionEntry | undefined {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (typeof value.pid !== 'number' || !Number.isInteger(value.pid)) return undefined;
  if (typeof value.messagingSocketPath !== 'string' || value.messagingSocketPath === '') {
    return undefined;
  }
  return {
    pid: value.pid,
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : '',
    kind: typeof value.kind === 'string' ? value.kind : '',
    name: typeof value.name === 'string' && value.name !== '' ? value.name : undefined,
    status: typeof value.status === 'string' ? value.status : 'unknown',
    cwd: typeof value.cwd === 'string' ? value.cwd : undefined,
    messagingSocketPath: value.messagingSocketPath,
  };
}

/**
 * Enumerate routable Claude sessions from the registry: kind interactive/bg
 * with a live process. Malformed entries are skipped and counted, never thrown.
 */
export function listClaudeSessions(dir: string = defaultClaudeSessionsDir()): ClaudeRegistryScan {
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return { sessions: [], malformed: 0 };
  }
  const sessions: ClaudeSessionEntry[] = [];
  let malformed = 0;
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    let entry: ClaudeSessionEntry | undefined;
    try {
      entry = parseEntry(readFileSync(join(dir, file), 'utf8'));
    } catch {
      entry = undefined;
    }
    if (entry === undefined) {
      malformed += 1;
      continue;
    }
    if (!ROUTABLE_KINDS.has(entry.kind)) continue;
    if (!isProcessAlive(entry.pid)) continue;
    sessions.push(entry);
  }
  return { sessions, malformed };
}

/** Exact-name lookup over a scan's sessions; throws NAME_COLLISION on duplicates. */
export function findByExactName(
  name: string,
  sessions: readonly ClaudeSessionEntry[],
): ClaudeSessionEntry | undefined {
  const matches = sessions.filter((session) => session.name === name);
  if (matches.length > 1) {
    const candidates = matches.map((m) => `pid ${m.pid} (${m.sessionId})`).join(', ');
    throw new MultichatError(
      'NAME_COLLISION',
      `Multiple Claude sessions are named ${JSON.stringify(name)}: ${candidates}. Address one by pid instead.`,
    );
  }
  return matches[0];
}
