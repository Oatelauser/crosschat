import { open } from 'node:fs/promises';
import { checkAbort, queryError } from './reading.js';
import type { QueryOptions, QueryState, QueryError } from './reading.js';

export interface LogCursor {
  identity: string;
  size: number;
}
export interface LogTailResult {
  state: QueryState;
  lines: string[];
  bytesRead: number;
  truncated: boolean;
  rotated: boolean;
  cursor?: LogCursor;
  observedAt: number;
  errors: QueryError[];
}

/** A bounded snapshot. UI polling/follow owns its schedule; replacement reopens each time. */
export async function queryLogTail(options: QueryOptions & { file: string; maxBytes?: number; contains?: string; previous?: LogCursor }): Promise<LogTailResult> {
  const result: LogTailResult = { state: 'ready', lines: [], bytesRead: 0, truncated: false, rotated: false, observedAt: (options.now ?? Date.now)(), errors: [] };
  const maxBytes = Number.isFinite(options.maxBytes) ? Math.min(2 * 1024 * 1024, Math.max(1, Math.floor(options.maxBytes!))) : 64 * 1024;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    checkAbort(options.signal);
    handle = await open(options.file, 'r');
    checkAbort(options.signal);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Not a regular log file');
    const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
    result.cursor = { identity, size: stat.size };
    result.rotated = options.previous !== undefined && (options.previous.identity !== identity || stat.size < options.previous.size);
    const start = Math.max(0, stat.size - maxBytes);
    const buffer = Buffer.alloc(Math.min(stat.size, maxBytes));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    checkAbort(options.signal);
    result.bytesRead = bytesRead;
    result.truncated = start > 0;
    // A cut UTF-8 character and line are discarded together at the bounded start.
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    if (start > 0) {
      const boundary = text.indexOf('\n');
      text = boundary < 0 ? '' : text.slice(boundary + 1);
    }
    result.lines = text.split(/\r?\n/).filter((line, index, lines) => (index < lines.length - 1 || line !== '') && (options.contains === undefined || line.includes(options.contains)));
    return result;
  } catch (error) {
    const issue = queryError(options.file, error);
    return { ...result, state: issue.kind, lines: [], errors: [issue] };
  } finally {
    await handle?.close();
  }
}
