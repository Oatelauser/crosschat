import { MultichatError } from '../errors.js';
import { openCodexSession, type CodexSessionFactory, type CodexThreadSummary } from './client.js';

/**
 * Read-only Codex thread discovery: initialize + thread/list on a fresh proxy
 * session, then close. Never resumes, starts turns, or mutates anything.
 */
export async function listCodexThreads(
  options: { sessionFactory?: CodexSessionFactory } = {},
): Promise<CodexThreadSummary[]> {
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
    return await session.listThreads();
  } catch (err) {
    if (err instanceof MultichatError) throw err;
    throw new MultichatError('CODEX_PROTOCOL_ERROR', 'codex thread/list failed.', { cause: err });
  } finally {
    await session.close().catch(() => undefined);
  }
}
