import { readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { checkAbort, queryError } from './reading.js';
import type { QueryOptions } from './reading.js';
import type { CollectionResult } from './services.js';

export interface ManagedFile {
  file: string;
  category: 'configuration' | 'status' | 'log' | 'inbox' | 'parts' | 'outbox' | 'mailbox' | 'conversations';
  bytes: number;
  modifiedAt: string;
}

/** Metadata inventory, never reads file bodies or follows directory symlinks. */
export async function queryManagedFiles(options: QueryOptions & { baseDir: string }): Promise<CollectionResult<ManagedFile>> {
  const result: CollectionResult<ManagedFile> = { items: [], completeness: 'complete', observedAt: (options.now ?? Date.now)(), errors: [] };
  const directories: { directory: string; category?: ManagedFile['category'] }[] = [
    { directory: options.baseDir }, { directory: join(options.baseDir, 'tcp') },
    ...(['inbox', 'parts'] as const).map((category) => ({ directory: join(options.baseDir, 'tcp', category), category })),
    ...(['outbox', 'mailbox', 'conversations'] as const).map((category) => ({ directory: join(options.baseDir, category), category })),
  ];
  try {
    checkAbort(options.signal);
    for (const { directory, category } of directories) {
      checkAbort(options.signal);
      let entries;
      try {
        const parent = await lstat(directory);
        checkAbort(options.signal);
        if (!parent.isDirectory() || parent.isSymbolicLink()) continue;
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        const issue = queryError(directory, error);
        if (issue.kind === 'cancelled') throw error;
        if (issue.kind !== 'missing') result.errors.push(issue);
        continue;
      }
      for (const entry of entries) {
        checkAbort(options.signal);
        if (!entry.isFile()) continue;
        const file = join(directory, entry.name);
        const inferred = category ?? (entry.name === 'broker.json' || entry.name === 'node.json' ? 'configuration'
          : /^status-.*\.json$/.test(entry.name) ? 'status' : /\.log(\.old)?$|\.jsonl(\.old)?$/.test(entry.name) ? 'log' : undefined);
        if (inferred === undefined) continue;
        try {
          const stat = await lstat(file);
          if (stat.isFile() && !stat.isSymbolicLink()) result.items.push({ file, category: inferred, bytes: stat.size, modifiedAt: stat.mtime.toISOString() });
        } catch (error) {
          result.errors.push(queryError(file, error));
        }
      }
    }
    checkAbort(options.signal);
  } catch (error) {
    return { ...result, items: [], completeness: 'cancelled', errors: [queryError(options.baseDir, error)] };
  }
  result.items.sort((a, b) => a.file.localeCompare(b.file));
  result.completeness = result.errors.length === 0 ? 'complete' : 'partial';
  return result;
}
