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
export interface LogWindowEntry { offset: number; text: string; terminated: boolean }
export interface LogWindowResult extends Omit<LogTailResult, 'lines'> {
  entries: LogWindowEntry[];
  omittedLeadingLine: boolean;
}

/** Payload window is at most maxBytes, plus one byte to identify a cut line. */
export async function queryLogTail(options: QueryOptions & { file: string; maxBytes?: number; contains?: string; previous?: LogCursor }): Promise<LogTailResult> {
  const result = await queryLogWindow(options);
  return { state: result.state, lines: result.entries.filter((entry) => options.contains === undefined || entry.text.includes(options.contains)).map((entry) => entry.text),
    bytesRead: result.bytesRead, truncated: result.truncated, rotated: result.rotated, cursor: result.cursor, observedAt: result.observedAt, errors: result.errors };
}

/** Complete starts retain their byte identity even when identical text repeats. */
export async function queryLogWindow(options: QueryOptions & { file: string; maxBytes?: number; previous?: LogCursor }): Promise<LogWindowResult> {
  const result: LogWindowResult = { state: 'ready', entries: [], omittedLeadingLine: false, bytesRead: 0, truncated: false, rotated: false, observedAt: (options.now ?? Date.now)(), errors: [] };
  const maxBytes = Number.isFinite(options.maxBytes) ? Math.min(2 * 1024 * 1024, Math.max(1, Math.floor(options.maxBytes!))) : 64 * 1024;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    checkAbort(options.signal);
    handle = await open(options.file, 'r');
    checkAbort(options.signal);
    const stat = await handle.stat({ bigint: true });
    checkAbort(options.signal);
    if (!stat.isFile()) throw new Error('Not a regular log file');
    const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
    const size = Number(stat.size);
    if (!Number.isSafeInteger(size)) throw new Error('Log size exceeds supported byte offsets');
    result.cursor = { identity, size };
    result.rotated = options.previous !== undefined && (options.previous.identity !== identity || size < options.previous.size);
    const start = Math.max(0, size - maxBytes);
    let startsMidLine = false;
    if (start > 0) {
      const boundary = Buffer.alloc(1);
      await handle.read(boundary, 0, 1, start - 1);
      checkAbort(options.signal);
      startsMidLine = boundary[0] !== 10;
    }
    const buffer = Buffer.alloc(Math.min(size, maxBytes));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    checkAbort(options.signal);
    result.bytesRead = bytesRead;
    result.truncated = start > 0;
    const bytes = buffer.subarray(0, bytesRead);
    let offset = 0;
    if (startsMidLine) {
      result.omittedLeadingLine = true;
      const boundary = bytes.indexOf(10);
      offset = boundary < 0 ? bytes.length : boundary + 1;
    }
    while (offset < bytes.length) {
      const newline = bytes.indexOf(10, offset);
      const end = newline < 0 ? bytes.length : newline;
      const contentEnd = newline >= 0 && bytes[end - 1] === 13 ? end - 1 : end;
      result.entries.push({ offset: start + offset, text: bytes.subarray(offset, contentEnd).toString('utf8'), terminated: newline >= 0 });
      offset = newline < 0 ? bytes.length : newline + 1;
    }
    return result;
  } catch (error) {
    const issue = queryError(options.file, error);
    return { ...result, state: issue.kind, entries: [], errors: [issue] };
  } finally {
    await handle?.close();
  }
}
