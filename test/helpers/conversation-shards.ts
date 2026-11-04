import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PairRecord } from '../../src/conversations.js';

/** Seed current isolated storage without depending on a retired global-file reader. */
export function writeConversationShards(file: string, pairs: Record<string, PairRecord>): void {
  const directory = join(dirname(file), 'conversations');
  mkdirSync(directory, { recursive: true });
  for (const [pair, record] of Object.entries(pairs)) {
    const name = createHash('sha256').update(pair).digest('hex');
    writeFileSync(join(directory, `${name}.json`), JSON.stringify({ pair, ...record }), 'utf8');
  }
}
