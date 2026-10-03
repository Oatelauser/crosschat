import { closeSync, openSync, readdirSync, readSync, type Dirent } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

/**
 * Read-only lookup of codex rollout session metadata. Rollout files live at
 * `<codexHome>/sessions/YYYY/MM/DD/rollout-<timestamp>-<threadId>.jsonl` and
 * their first line is a `session_meta` JSON object whose payload carries the
 * session's cwd/originator/timestamp. Every entry point here is side-effect
 * free and never throws; missing or malformed data yields `undefined`.
 */

export interface RolloutMeta {
  cwd: string | undefined;
  originator: string | undefined;
  /** ISO timestamp of session creation, from the session_meta payload. */
  createdAt: string | undefined;
}

/** Codex home directory (rollout sessions root lives under `<home>/sessions`). */
export function codexHomeDir(): string {
  return process.env.CODEX_HOME ?? join(homedir(), '.codex');
}

/**
 * Read only the first line of a file. Chunked because a session_meta first
 * line embeds base instructions and can far exceed one read buffer.
 */
function readFirstLine(path: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
  } catch {
    return undefined;
  }
  try {
    const chunks: Buffer[] = [];
    const buf = Buffer.alloc(65536);
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      const newline = buf.subarray(0, n).indexOf(0x0a);
      if (newline >= 0) {
        chunks.push(Buffer.from(buf.subarray(0, newline)));
        return Buffer.concat(chunks).toString('utf8');
      }
      // Copy: subarray views the reused read buffer and would be overwritten.
      chunks.push(Buffer.from(buf.subarray(0, n)));
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Extract meta fields with tolerance for missing/malformed payload pieces. */
function parseMeta(line: string | undefined): RolloutMeta | undefined {
  if (!line) return undefined;
  try {
    const payload = (JSON.parse(line) as { payload?: unknown })?.payload;
    if (typeof payload !== 'object' || payload === null) return undefined;
    const record = payload as Record<string, unknown>;
    const meta: RolloutMeta = {
      cwd: nonEmptyString(record.cwd),
      originator: nonEmptyString(record.originator),
      createdAt: nonEmptyString(record.timestamp),
    };
    return meta.cwd !== undefined || meta.originator !== undefined || meta.createdAt !== undefined
      ? meta
      : undefined;
  } catch {
    return undefined;
  }
}

/** One recursive walk of the sessions tree; maps each wanted id to its rollout file. */
function findRolloutFiles(
  dir: string,
  wanted: ReadonlySet<string>,
  found: Map<string, string> = new Map(),
): Map<string, string> {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (found.size === wanted.size) break;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      findRolloutFiles(path, wanted, found);
    } else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
      const stem = entry.name.slice(0, -'.jsonl'.length);
      for (const id of wanted) {
        if (stem.endsWith(`-${id}`)) {
          found.set(id, path);
          break;
        }
      }
    }
  }
  return found;
}

/**
 * Look up rollout metadata for several thread ids with a single directory
 * walk (a per-status call must stay well under a couple of seconds).
 */
export function lookupRolloutMetas(
  codexHome: string,
  threadIds: readonly string[],
): Map<string, RolloutMeta> {
  const metas = new Map<string, RolloutMeta>();
  const wanted = new Set(threadIds.filter((id) => id.length > 0));
  if (wanted.size === 0) return metas;
  for (const [id, path] of findRolloutFiles(join(codexHome, 'sessions'), wanted)) {
    const meta = parseMeta(readFirstLine(path));
    if (meta !== undefined) metas.set(id, meta);
  }
  return metas;
}

/** Single-thread convenience wrapper around {@link lookupRolloutMetas}. */
export function lookupRolloutMeta(codexHome: string, threadId: string): RolloutMeta | undefined {
  return lookupRolloutMetas(codexHome, [threadId]).get(threadId);
}

/** Rollout file path for one thread id; undefined when no rollout exists. */
export function findRolloutFile(codexHome: string, threadId: string): string | undefined {
  if (threadId.length === 0) return undefined;
  return findRolloutFiles(join(codexHome, 'sessions'), new Set([threadId])).get(threadId);
}
