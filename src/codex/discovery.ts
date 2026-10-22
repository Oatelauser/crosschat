import { MultichatError } from '../errors.js';
import { openCodexSession, type CodexSessionFactory, type CodexThreadSummary } from './client.js';
import { codexHomeDir, lookupRolloutMetas, type RolloutMeta } from './rollout-meta.js';
import { listCodexThreadPage } from './aggregate-discovery.js';
import type { DesktopDiscoveryOptions } from './aggregate-discovery.js';
import { normalizeThreadStatus } from './client.js';

/** A thread/list summary enriched with rollout-file metadata when available. */
export interface CodexThreadWithMeta extends CodexThreadSummary {
  /** Absent when no rollout file matches the thread id or it is unreadable. */
  meta?: RolloutMeta;
}

export interface CodexThreadDiscoveryOptions {
  sessionFactory?: CodexSessionFactory;
  codexHome?: string;
  desktop?: DesktopDiscoveryOptions;
  signal?: AbortSignal;
}

/**
 * Read-only Codex thread discovery: initialize + thread/list on a fresh proxy
 * session, then close. Never resumes, starts turns, or mutates anything.
 * Each listed thread is tagged with its rollout session metadata (cwd,
 * originator, creation time); a metadata lookup failure never fails the list.
 */
export async function listCodexThreads(
  options: CodexThreadDiscoveryOptions = {},
): Promise<CodexThreadWithMeta[]> {
  // Existing injected CLI adapters remain isolated from the user's DB and pipe.
  if (options.sessionFactory === undefined || options.desktop !== undefined) {
    const threads: CodexThreadWithMeta[] = [];
    let cursor: string | undefined;
    let available = false;
    let cliUnavailable = false;
    do {
      const page = await listCodexThreadPage({ ...options, cursor, limit: 20, legacyCli: true });
      available ||= page.completeness !== 'unavailable';
      cliUnavailable ||= page.errors.some((error) => error.source === 'cli' && error.kind !== 'legacy-limit');
      for (const thread of page.data) {
        if (threads.length === 20) break;
        let status: CodexThreadSummary['status'];
        if (typeof thread.rawStatus === 'string' && ['idle', 'busy', 'not_loaded', 'waiting_approval', 'system_error'].includes(thread.rawStatus)) status = thread.rawStatus as CodexThreadSummary['status'];
        else {
          try { status = normalizeThreadStatus(thread.rawStatus); }
          catch { status = 'not_loaded'; }
        }
        const attributes = thread.attributes;
        const meta = {
          cwd: typeof attributes.cwd === 'string' ? attributes.cwd : undefined,
          originator: typeof attributes.originator === 'string' ? attributes.originator : undefined,
          createdAt: typeof attributes.createdAt === 'number' ? new Date(attributes.createdAt).toISOString() : undefined,
        };
        threads.push({ id: thread.id, name: thread.name, status,
          ...(meta.cwd !== undefined || meta.originator !== undefined || meta.createdAt !== undefined ? { meta } : {}) });
      }
      cursor = page.nextCursor ?? undefined;
    } while (threads.length < 20 && cursor !== undefined);
    if (!available || threads.length === 0 && cliUnavailable) throw new MultichatError('CODEX_PROXY_SPAWN_FAILED', 'No live Codex Desktop thread was found and the CLI app-server could not be read.');
    let metas = new Map<string, RolloutMeta>();
    try { metas = lookupRolloutMetas(options.codexHome ?? codexHomeDir(), threads.filter((thread) => thread.meta === undefined).map((thread) => thread.id)); }
    catch { /* Existing CLI rollout enrichment remains best effort. */ }
    return threads.map((thread) => {
      const meta = metas.get(thread.id);
      return meta === undefined ? thread : { ...thread, meta };
    });
  }
  const sessionFactory = options.sessionFactory ?? openCodexSession();
  let session;
  try {
    session = await sessionFactory();
  } catch (err) {
    if (err instanceof MultichatError && err.code === 'CODEX_PROXY_SPAWN_FAILED') throw err;
    throw new MultichatError(
      'CODEX_PROXY_SPAWN_FAILED',
      'Failed to establish the codex app-server proxy channel.',
      { cause: err },
    );
  }
  try {
    await session.initialize();
    const threads = await session.listThreads();
    let metas = new Map<string, RolloutMeta>();
    try {
      metas = lookupRolloutMetas(options.codexHome ?? codexHomeDir(), threads.map((t) => t.id));
    } catch {
      // Metadata is best-effort identification only.
    }
    return threads.map((thread) => {
      const meta = metas.get(thread.id);
      return meta === undefined ? thread : { ...thread, meta };
    });
  } catch (err) {
    if (err instanceof MultichatError) throw err;
    throw new MultichatError('CODEX_PROTOCOL_ERROR', 'codex thread/list failed.', { cause: err });
  } finally {
    await session.close().catch(() => undefined);
  }
}
