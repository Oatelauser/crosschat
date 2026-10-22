import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { defaultClaudeSessionsDir } from '../../claude/registry.js';
import { isProcessAlive } from '../../platform/process-inspector.js';
import { sessionKey } from './model.js';
import type { ProviderCapabilities, Session, SessionListRequest, SessionPage, SessionReader, SessionRef, SourceError } from './model.js';
import { abortError, cancelledPage, errorPage, findSession, isRecord, untilAborted } from './reading.js';

export interface ClaudeReaderOptions {
  directory?: string;
  now?: () => number;
  isProcessAlive?: (pid: number, signal?: AbortSignal) => boolean | Promise<boolean>;
  io?: {
    readDirectory(directory: string): Promise<string[]>;
    readText(path: string, signal?: AbortSignal): Promise<string>;
  };
}

const capabilities: ProviderCapabilities = { discovery: true, delivery: true, deliveryModes: ['queue', 'steer'], launch: false, diagnostics: false };

interface ClaudePageCursor {
  version: 1;
  contextId: string;
  offset: number;
  fingerprint: string;
}

function decodeCursor(raw: string, contextId: string): ClaudePageCursor | undefined {
  try {
    const cursor: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!isRecord(cursor) || cursor.version !== 1 || cursor.contextId !== contextId
      || typeof cursor.offset !== 'number' || !Number.isSafeInteger(cursor.offset) || cursor.offset < 1
      || typeof cursor.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(cursor.fingerprint)) return undefined;
    return { version: 1, contextId, offset: cursor.offset, fingerprint: cursor.fingerprint };
  } catch {
    return undefined;
  }
}

function invalidCursor(contextId: string, observedAt: number, changed = false): SessionPage {
  const page = errorPage({
    source: { contextId, providerId: 'claude' }, kind: 'invalid-cursor',
    message: changed ? 'Claude session registry changed between pages.' : 'Invalid Claude page cursor or limit.',
    nextStep: 'Refresh from the first page.',
  }, observedAt);
  return changed ? { ...page, completeness: 'partial' } : page;
}

function readError(contextId: string, path: string, error: unknown): SourceError {
  const missing = isRecord(error) && error.code === 'ENOENT';
  return {
    source: { contextId, providerId: 'claude', path }, kind: missing ? 'missing' : 'unreadable',
    message: missing ? 'Claude session registry is missing.' : 'Claude session registry could not be read.',
    nextStep: missing ? 'Start a Claude session with messaging enabled.' : 'Check access to the session registry.',
  };
}

export function createClaudeSessionReader(options: ClaudeReaderOptions = {}): SessionReader {
  const directory = options.directory ?? defaultClaudeSessionsDir();
  const now = options.now ?? Date.now;
  const alive = options.isProcessAlive ?? isProcessAlive;
  const io = options.io ?? { readDirectory: readdir, readText: (path: string, signal?: AbortSignal) => readFile(path, { encoding: 'utf8', signal }) };
  const reader: SessionReader = {
    providerId: 'claude', capabilities,
    async list(request): Promise<SessionPage> {
      if (request.signal?.aborted) return cancelledPage(request.contextId, 'claude', now());
      try {
        return await untilAborted(scan(request), request.signal);
      } catch (error) {
        return request.signal?.aborted ? cancelledPage(request.contextId, 'claude', now()) : errorPage(readError(request.contextId, directory, error), now());
      }
    },
    get(request) { return findSession(reader, request); },
  };

  async function scan(request: SessionListRequest): Promise<SessionPage> {
    const cursor = request.cursor === undefined ? undefined : decodeCursor(request.cursor, request.contextId);
    const limit = request.limit ?? 100;
    if ((request.cursor !== undefined && cursor === undefined) || !Number.isSafeInteger(limit) || limit < 1) return invalidCursor(request.contextId, now());
    const files = (await io.readDirectory(directory)).filter((file) => file.endsWith('.json')).sort();
    const fingerprint = createHash('sha256').update(JSON.stringify(files)).digest('hex');
    if (cursor !== undefined && cursor.fingerprint !== fingerprint) return invalidCursor(request.contextId, now(), true);
    const offset = cursor?.offset ?? 0;
    if (cursor !== undefined && offset >= files.length) return invalidCursor(request.contextId, now());
    const items: Session[] = [];
    const errors: SourceError[] = [];
    const end = Math.min(offset + limit, files.length);
    for (const file of files.slice(offset, end)) {
      if (request.signal?.aborted) throw abortError();
      const path = join(directory, file);
      let text: string;
      try {
        text = await io.readText(path, request.signal);
      } catch (error) {
        if (request.signal?.aborted) throw abortError();
        errors.push(readError(request.contextId, path, error));
        continue;
      }
      let entry: unknown;
      try { entry = JSON.parse(text); } catch { entry = undefined; }
      if (!isRecord(entry) || typeof entry.pid !== 'number' || !Number.isInteger(entry.pid) || typeof entry.messagingSocketPath !== 'string' || entry.messagingSocketPath === '') {
        errors.push({ source: { contextId: request.contextId, providerId: 'claude', path }, kind: 'malformed', message: 'Claude session registry entry is malformed.', nextStep: 'Check the native session registry writer.' });
        continue;
      }
      if (entry.kind !== 'interactive' && entry.kind !== 'bg') continue;
      if (!await alive(entry.pid, request.signal)) continue;
      if (request.signal?.aborted) throw abortError();
      const hasSessionId = typeof entry.sessionId === 'string' && entry.sessionId !== '';
      const ref: SessionRef = { contextId: request.contextId, providerId: 'claude', nativeId: hasSessionId ? String(entry.sessionId) : String(entry.pid), referenceKind: hasSessionId ? 'native' : 'process' };
      items.push({
        ref, key: sessionKey(ref), name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : null,
        rawStatus: entry.status ?? 'unknown', capabilities,
        attributes: { pid: entry.pid, kind: entry.kind, cwd: entry.cwd, messagingSocketPath: entry.messagingSocketPath, startedAt: entry.startedAt, updatedAt: entry.updatedAt, nativeIdSource: hasSessionId ? 'sessionId' : 'pid' },
      });
    }
    if (request.signal?.aborted) throw abortError();
    const nextCursor = end < files.length ? Buffer.from(JSON.stringify({ version: 1, contextId: request.contextId, offset: end, fingerprint })).toString('base64url') : null;
    return { items, nextCursor, completeness: errors.length === 0 && nextCursor === null ? 'complete' : 'partial', errors, observedAt: now() };
  }

  return reader;
}
