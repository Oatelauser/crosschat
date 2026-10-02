import { MultichatError } from '../errors.js';
import { openCodexSession, type CodexSessionFactory, type CodexThreadSummary } from './client.js';
import { codexHomeDir, lookupRolloutMetas, type RolloutMeta } from './rollout-meta.js';

/** A thread/list summary enriched with rollout-file metadata when available. */
export interface CodexThreadWithMeta extends CodexThreadSummary {
  /** Absent when no rollout file matches the thread id or it is unreadable. */
  meta?: RolloutMeta;
}

/**
 * Read-only Codex thread discovery: initialize + thread/list on a fresh proxy
 * session, then close. Never resumes, starts turns, or mutates anything.
 * Each listed thread is tagged with its rollout session metadata (cwd,
 * originator, creation time); a metadata lookup failure never fails the list.
 */
export async function listCodexThreads(
  options: { sessionFactory?: CodexSessionFactory; codexHome?: string } = {},
): Promise<CodexThreadWithMeta[]> {
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
