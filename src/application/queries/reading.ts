import { readFile } from 'node:fs/promises';

export type QueryState = 'ready' | 'missing' | 'unreadable' | 'malformed' | 'unavailable' | 'cancelled';
export interface QueryError {
  source: string;
  kind: Exclude<QueryState, 'ready'>;
  message: string;
  nextStep: string;
}
export interface ReadResult<T> {
  state: QueryState;
  value: T | null;
  observedAt: number;
  errors: QueryError[];
}
export interface QueryOptions {
  signal?: AbortSignal;
  now?: () => number;
}
export interface TextOptions extends QueryOptions {
  readText?: (file: string, signal?: AbortSignal) => Promise<string>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
export function abortError(): Error {
  return Object.assign(new Error('Query cancelled'), { name: 'AbortError' });
}
export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/** Owns its listener; callers pass the same signal to the underlying IO. */
export async function cancellable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return work;
  let onAbort: () => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([work, cancelled]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

export function queryError(source: string, error: unknown, malformed = false): QueryError {
  const code = isRecord(error) ? error.code : undefined;
  const name = error instanceof Error ? error.name : undefined;
  const kind = name === 'AbortError' ? 'cancelled'
    : code === 'ENOENT' ? 'missing'
      : malformed ? 'malformed' : 'unreadable';
  return {
    source, kind,
    // Do not echo JSON parse errors, raw input, or arbitrary secret-bearing errors.
    message: kind === 'cancelled' ? '查询已取消' : kind === 'missing' ? '尚无此文件' : kind === 'malformed' ? '文件内容不符合所需格式' : '无法读取此来源',
    nextStep: kind === 'missing' ? '检查是否已配置或启动相应服务' : kind === 'cancelled' ? '需要时重新查询' : '检查该来源的格式、路径或访问权限',
  };
}

export async function readParsed<T>(file: string, parse: (raw: string) => T, options: TextOptions): Promise<ReadResult<T>> {
  const observedAt = (options.now ?? Date.now)();
  let raw: string;
  try {
    checkAbort(options.signal);
    const read = options.readText ?? ((path, signal) => readFile(path, { encoding: 'utf8', signal }));
    raw = await cancellable(read(file, options.signal), options.signal);
    checkAbort(options.signal);
  } catch (error) {
    const issue = queryError(file, error);
    return { state: issue.kind, value: null, observedAt, errors: [issue] };
  }
  try {
    return { state: 'ready', value: parse(raw), observedAt, errors: [] };
  } catch (error) {
    const issue = queryError(file, error, true);
    return { state: issue.kind, value: null, observedAt, errors: [issue] };
  }
}
