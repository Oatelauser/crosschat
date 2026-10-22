import { join } from 'node:path';
import { createClaudeSessionReader } from '../sessions/claude-reader.js';
import { createCodexSessionReader } from '../sessions/codex-reader.js';
import type { SessionReader } from '../sessions/model.js';
import { DiscoveryService } from './service.js';

/** Compose native readers without querying, starting or repairing their sources. */
export function createLocalDiscoveryService(options: { home?: string; readers?: readonly SessionReader[] } = {}): DiscoveryService {
  return new DiscoveryService(options.readers ?? [
    createClaudeSessionReader(options.home === undefined ? {} : { directory: join(options.home, '.claude', 'sessions') }),
    createCodexSessionReader(options.home === undefined ? {} : { codexHome: join(options.home, '.codex') }),
  ]);
}
