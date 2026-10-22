import { join } from 'node:path';
import process from 'node:process';
import { openCodexSession } from '../../codex/client.js';
import { createClaudeSessionReader } from '../sessions/claude-reader.js';
import { createCodexSessionReader } from '../sessions/codex-reader.js';
import type { SessionReader } from '../sessions/model.js';
import { DiscoveryService } from './service.js';

function nativeReaders(home?: string): readonly SessionReader[] {
  if (home === undefined) return [createClaudeSessionReader({}), createCodexSessionReader({})];
  const codexHome = join(home, '.codex');
  const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: codexHome };
  delete env.CODEX_SQLITE_HOME;
  return [
    createClaudeSessionReader({ directory: join(home, '.claude', 'sessions') }),
    createCodexSessionReader({ codexHome, desktop: { sqliteHome: codexHome }, sessionFactory: openCodexSession({ env }) }),
  ];
}

/** Compose native readers without querying, starting or repairing their sources. */
export function createLocalDiscoveryService(options: { home?: string; readers?: readonly SessionReader[] } = {}): DiscoveryService {
  return new DiscoveryService(options.readers ?? nativeReaders(options.home));
}
