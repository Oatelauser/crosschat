import { connectOpenCode, isRecord, openCodeError } from './service.js';
import type { OpenCodeConnection, OpenCodeOptions } from './service.js';

export type { OpenCodeOptions, OpenCodeEndpoint } from './service.js';

export interface OpenCodeThread {
  id: string;
  name: string | null;
  cwd: string;
  rawStatus: unknown;
  attributes: Readonly<Record<string, unknown>>;
}

export interface OpenCodeThreadPage {
  data: OpenCodeThread[];
  nextCursor: string | null;
  completeness: 'complete' | 'partial';
}

export interface OpenCodePageOptions extends OpenCodeOptions {
  cursor?: string;
  limit?: number;
}

function thread(value: unknown, active: Record<string, unknown>): OpenCodeThread {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id === ''
    || !isRecord(value.location) || typeof value.location.directory !== 'string'
    || (value.title !== undefined && typeof value.title !== 'string')) {
    throw openCodeError('PROTOCOL_ERROR', 'OpenCode session response has invalid fields.');
  }
  return {
    id: value.id, name: value.title || null, cwd: value.location.directory,
    rawStatus: Object.hasOwn(active, value.id) ? active[value.id] : { type: 'inactive' },
    attributes: { location: { directory: value.location.directory }, ...(typeof value.projectID === 'string' ? { projectID: value.projectID } : {}), ...(typeof value.parentID === 'string' ? { parentID: value.parentID } : {}) },
  };
}

async function activeSessions(connection: OpenCodeConnection): Promise<Record<string, unknown>> {
  const result = await connection.request('/api/session/active');
  if (!isRecord(result) || !isRecord(result.data) || Object.values(result.data).some((value) => !isRecord(value) || typeof value.type !== 'string' || value.type === '')) {
    throw openCodeError('PROTOCOL_ERROR', 'OpenCode active session response is malformed.');
  }
  return result.data;
}

async function readPage(connection: OpenCodeConnection, options: OpenCodePageOptions): Promise<OpenCodeThreadPage> {
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw openCodeError('PROTOCOL_ERROR', 'OpenCode session page limit must be between 1 and 1000.');
  if (options.cursor !== undefined && (typeof options.cursor !== 'string' || options.cursor === '' || options.cursor.length > 32 * 1024)) {
    throw openCodeError('INVALID_CURSOR', 'OpenCode session page cursor is invalid.');
  }
  const query = new URLSearchParams({ limit: String(limit), archived: 'false' });
  if (options.cursor !== undefined) query.set('cursor', options.cursor);
  const result = await connection.request(`/api/session?${query}`);
  if (!isRecord(result) || !Array.isArray(result.data) || !isRecord(result.cursor)
    || (result.cursor.next !== undefined && result.cursor.next !== null && (typeof result.cursor.next !== 'string' || result.cursor.next === ''))) {
    throw openCodeError('PROTOCOL_ERROR', 'OpenCode paged session response is malformed.');
  }
  const nextCursor = typeof result.cursor.next === 'string' ? result.cursor.next : null;
  const active = await activeSessions(connection);
  return { data: result.data.map((value: unknown) => thread(value, active)), nextCursor, completeness: nextCursor === null ? 'complete' : 'partial' };
}

export async function listOpenCodeThreadPage(options: OpenCodePageOptions = {}): Promise<OpenCodeThreadPage> {
  return readPage(await connectOpenCode(options), options);
}

/** All pages, with a bounded loop and no writes or native session activation. */
export async function listOpenCodeThreads(options: OpenCodeOptions = {}): Promise<OpenCodeThread[]> {
  const connection = await connectOpenCode(options);
  const results: OpenCodeThread[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let pages = 0; pages < 1000; pages += 1) {
    const page = await readPage(connection, { ...options, cursor });
    results.push(...page.data);
    if (page.nextCursor === null) return results;
    if (seen.has(page.nextCursor)) throw openCodeError('PROTOCOL_ERROR', 'OpenCode session source repeated its page cursor.');
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw openCodeError('PROTOCOL_ERROR', 'OpenCode session source exceeded the bounded page count.');
}

export function openCodeSessionPath(id: string): string {
  if (id === '' || id === '.' || id === '..') throw openCodeError('SESSION_NOT_FOUND', 'An exact native OpenCode session ID is required.');
  return `/api/session/${encodeURIComponent(id)}`;
}

export async function getOpenCodeThread(id: string, options: OpenCodeOptions = {}): Promise<OpenCodeThread | null> {
  const path = openCodeSessionPath(id);
  const connection = await connectOpenCode(options);
  let result: unknown;
  try { result = await connection.request(path); }
  catch (error) {
    if (isRecord(error) && error.code === 'OPENCODE_SESSION_NOT_FOUND') return null;
    throw error;
  }
  if (!isRecord(result)) throw openCodeError('PROTOCOL_ERROR', 'OpenCode session detail response is malformed.');
  const item = thread(result.data, await activeSessions(connection));
  if (item.id !== id) throw openCodeError('PROTOCOL_ERROR', 'OpenCode session detail did not match the requested native ID.');
  return item;
}
