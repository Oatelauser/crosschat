import { join } from 'node:path';
import process from 'node:process';
import { openCodexSession } from '../../codex/client.js';
import { createClaudeSessionReader } from '../sessions/claude-reader.js';
import { createCodexSessionReader } from '../sessions/codex-reader.js';
import { createOpenCodeSessionReader } from '../sessions/opencode-reader.js';
import type { SessionReader } from '../sessions/model.js';
import { DiscoveryService } from './service.js';

function nativeReaders(home?: string): readonly SessionReader[] {
  if (home === undefined) return [createClaudeSessionReader({}), createCodexSessionReader({}), optionalOpenCodeSource(createOpenCodeSessionReader({}), process.env)];
  const codexHome = join(home, '.codex');
  const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: codexHome };
  for (const key of Object.keys(env)) if (key.toUpperCase() === 'CODEX_SQLITE_HOME') delete env[key];
  const openCodeEnv: NodeJS.ProcessEnv = { HOME: home, USERPROFILE: home, XDG_STATE_HOME: join(home, '.local', 'state') };
  return [
    createClaudeSessionReader({ directory: join(home, '.claude', 'sessions') }),
    createCodexSessionReader({ codexHome, desktop: { sqliteHome: codexHome }, sessionFactory: openCodexSession({ env }) }),
    optionalOpenCodeSource(createOpenCodeSessionReader({ home, env: openCodeEnv }), openCodeEnv),
  ];
}

/** An uninstalled optional tool is an empty source; configured failures stay visible. */
function optionalOpenCodeSource(reader: SessionReader, env: NodeJS.ProcessEnv): SessionReader {
  const absent = (errors: readonly { kind: string }[]) => env.CROSSCHAT_OPENCODE_SERVICE_FILE === undefined
    && errors.length === 1 && errors[0].kind === 'missing';
  return { ...reader,
    async list(request) {
      const page = await reader.list(request);
      return page.items.length === 0 && absent(page.errors)
        ? { ...page, completeness: 'complete', errors: [], nextCursor: null } : page;
    },
    async get(request) {
      const detail = await reader.get(request);
      return detail.item === null && absent(detail.errors)
        ? { ...detail, completeness: 'complete', errors: [] } : detail;
    },
  };
}

/** Compose native readers without querying, starting or repairing their sources. */
export function createLocalDiscoveryService(options: { home?: string; readers?: readonly SessionReader[] } = {}): DiscoveryService {
  return new DiscoveryService(options.readers ?? nativeReaders(options.home));
}
