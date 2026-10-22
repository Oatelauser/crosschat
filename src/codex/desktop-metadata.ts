import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { MultichatError } from '../errors.js';

/** Metadata candidates only. Presence in SQLite never proves a live Desktop owner. */
export interface DesktopMetadataRow {
  id: string;
  name: string | null;
  cwd: string | null;
  source: string;
  originator: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  recencyAtMs: number;
}

export interface DesktopMetadataQueryRequest {
  databasePath: string;
  limit: number;
  after?: { id: string; recencyAtMs: number };
  signal?: AbortSignal;
  timeoutMs: number;
}

export type DesktopMetadataQuery = (request: DesktopMetadataQueryRequest) => Promise<unknown[]>;

export interface DesktopMetadataOptions {
  codexHome?: string;
  sqliteHome?: string;
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
  query?: DesktopMetadataQuery;
  now?: () => number;
  timeoutMs?: number;
}

export interface DesktopMetadataPage {
  data: DesktopMetadataRow[];
  nextCursor: string | null;
  completeness: 'complete' | 'partial';
  observedAt: number;
}

const SOURCES = new Set(['cli', 'vscode', 'exec']);
const MAX_LIMIT = 1_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const CURSOR_KIND = 'crosschat-desktop-metadata-v1';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message: string): MultichatError { return new MultichatError('CODEX_DESKTOP_METADATA_PROTOCOL_ERROR', message); }
function aborted(): DOMException { return new DOMException('Desktop metadata read cancelled.', 'AbortError'); }

function nullableText(value: unknown): value is string | null { return value === null || typeof value === 'string'; }
function timestamp(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }

function parseRow(value: unknown): DesktopMetadataRow {
  if (!record(value) || typeof value.id !== 'string' || value.id.length === 0 || !nullableText(value.name)
    || !nullableText(value.cwd) || typeof value.source !== 'string' || !SOURCES.has(value.source)
    || !nullableText(value.originator) || !timestamp(value.createdAtMs) || !timestamp(value.updatedAtMs) || !timestamp(value.recencyAtMs)) {
    throw invalid('Desktop metadata returned malformed native fields.');
  }
  return { id: value.id, name: value.name === '' ? null : value.name, cwd: value.cwd, source: value.source,
    originator: value.originator, createdAtMs: value.createdAtMs, updatedAtMs: value.updatedAtMs, recencyAtMs: value.recencyAtMs };
}

function parseCursor(cursor: string | undefined, binding: string): { id: string; recencyAtMs: number } | undefined {
  if (cursor === undefined) return undefined;
  try {
    if (cursor.length > 4_096 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error('invalid cursor');
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!record(value) || value.kind !== CURSOR_KIND || value.binding !== binding || !record(value.after)
      || typeof value.after.id !== 'string' || value.after.id.length === 0 || !timestamp(value.after.recencyAtMs)) throw new Error('invalid cursor');
    return { id: value.after.id, recencyAtMs: value.after.recencyAtMs };
  } catch (cause) {
    throw new MultichatError('CODEX_DESKTOP_METADATA_INVALID_CURSOR', 'Desktop metadata cursor does not match this source.', { cause });
  }
}

// The SQLite builtin is loaded only inside this worker. Importing the CLI still
// works on earlier Node 22 installations that do not provide node:sqlite.
const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  let database;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    database = new DatabaseSync(workerData.databasePath, { readOnly: true });
    database.exec('PRAGMA query_only=ON');
    const recency = 'COALESCE(recency_at_ms,updated_at_ms,updated_at*1000)';
    const condition = workerData.after ? ' AND (' + recency + ' < ? OR (' + recency + ' = ? AND id < ?))' : '';
    const sql = 'SELECT id,name,cwd,source,originator,COALESCE(created_at_ms,created_at*1000) AS createdAtMs,' +
      'COALESCE(updated_at_ms,updated_at*1000) AS updatedAtMs,' + recency + ' AS recencyAtMs ' +
      "FROM threads WHERE archived=0 AND source IN ('cli','vscode','exec')" + condition +
      ' ORDER BY recencyAtMs DESC,id DESC LIMIT ?';
    const args = workerData.after ? [workerData.after.recencyAtMs,workerData.after.recencyAtMs,workerData.after.id,workerData.limit] : [workerData.limit];
    const rows = database.prepare(sql).all(...args);
    parentPort.postMessage({ rows });
  } catch { parentPort.postMessage({ error: true }); }
  finally { database?.close(); }
})();
`;

async function queryInWorker(request: DesktopMetadataQueryRequest): Promise<unknown[]> {
  if (request.signal?.aborted) throw aborted();
  const worker = new Worker(WORKER_SOURCE, { eval: true, execArgv: ['--no-warnings'], workerData: {
    databasePath: request.databasePath, limit: request.limit, after: request.after,
  } });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  try {
    return await new Promise<unknown[]>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Desktop metadata worker timed out.')), request.timeoutMs);
      cancel = () => reject(aborted());
      request.signal?.addEventListener('abort', cancel, { once: true });
      worker.once('message', (value: unknown) => {
        if (record(value) && Array.isArray(value.rows)) resolve(value.rows);
        else reject(new Error('Desktop metadata is unavailable.'));
      });
      worker.once('error', reject);
      worker.once('exit', () => reject(new Error('Desktop metadata worker exited before returning data.')));
      if (request.signal?.aborted) cancel();
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (cancel !== undefined) request.signal?.removeEventListener('abort', cancel);
    await worker.terminate();
  }
}

async function cancellableQuery(query: DesktopMetadataQuery, request: DesktopMetadataQueryRequest): Promise<unknown[]> {
  let cancel: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      query(request),
      new Promise<never>((_resolve, reject) => {
        cancel = () => reject(aborted());
        request.signal?.addEventListener('abort', cancel, { once: true });
        timer = setTimeout(() => reject(new Error('Desktop metadata query timed out.')), request.timeoutMs);
        if (request.signal?.aborted) cancel();
      }),
    ]);
  } finally {
    if (cancel !== undefined) request.signal?.removeEventListener('abort', cancel);
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Bounded keyset pages over the current nonarchived native metadata source. */
export async function listDesktopMetadata(options: DesktopMetadataOptions = {}): Promise<DesktopMetadataPage> {
  if (options.signal?.aborted) throw aborted();
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw invalid('Desktop metadata limit must be between 1 and 1000.');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw invalid('Desktop metadata timeout must be positive.');
  const home = options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex');
  const databasePath = resolve(options.sqliteHome ?? process.env.CODEX_SQLITE_HOME ?? home, 'state_5.sqlite');
  const binding = createHash('sha256').update(databasePath).digest('hex');
  const after = parseCursor(options.cursor, binding);
  let values: unknown[];
  try {
    const request: DesktopMetadataQueryRequest = { databasePath, limit: limit + 1, after, signal: options.signal, timeoutMs };
    values = options.query === undefined ? await queryInWorker(request) : await cancellableQuery(options.query, request);
  } catch (cause) {
    if (options.signal?.aborted || cause instanceof DOMException && cause.name === 'AbortError') throw aborted();
    throw new MultichatError('CODEX_DESKTOP_METADATA_UNAVAILABLE', 'Desktop native metadata could not be read.', { cause });
  }
  if (options.signal?.aborted) throw aborted();
  if (!Array.isArray(values) || values.length > limit + 1) throw invalid('Desktop metadata returned an invalid page size.');
  const rows = values.map(parseRow);
  if (after !== undefined && rows.some((row) => row.recencyAtMs > after.recencyAtMs
    || row.recencyAtMs === after.recencyAtMs && Buffer.compare(Buffer.from(row.id), Buffer.from(after.id)) >= 0)) {
    throw invalid('Desktop metadata did not advance beyond the cursor boundary.');
  }
  for (let index = 1; index < rows.length; index++) {
    const previous = rows[index - 1], current = rows[index];
    if (previous.recencyAtMs < current.recencyAtMs || previous.recencyAtMs === current.recencyAtMs
      && Buffer.compare(Buffer.from(previous.id), Buffer.from(current.id)) <= 0) throw invalid('Desktop metadata is not in native keyset order.');
  }
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  const nextCursor = rows.length > limit && last !== undefined
    ? Buffer.from(JSON.stringify({ kind: CURSOR_KIND, binding, after: { id: last.id, recencyAtMs: last.recencyAtMs } })).toString('base64url') : null;
  return { data, nextCursor, completeness: nextCursor === null ? 'complete' : 'partial', observedAt: (options.now ?? Date.now)() };
}
