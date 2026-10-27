import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { MultichatError } from '../errors.js';
import { openCodexSession } from './client.js';
import type { CodexRawThreadSummary, CodexSession, CodexSessionFactory } from './client.js';
import { openDesktopThread } from './desktop-ipc.js';
import type { DesktopIpcOptions, DesktopThreadSession } from './desktop-ipc.js';
import { listDesktopMetadata } from './desktop-metadata.js';
import type { DesktopMetadataOptions, DesktopMetadataPage, DesktopMetadataRow } from './desktop-metadata.js';
import { codexHomeDir } from './rollout-meta.js';

export interface DesktopDiscoveryOptions {
  listMetadata?: (options: DesktopMetadataOptions) => Promise<DesktopMetadataPage>;
  openThread?: (id: string, options: DesktopIpcOptions) => Promise<DesktopThreadSession | null>;
  sqliteHome?: string;
  pipePath?: string;
  probeTimeoutMs?: number;
  concurrency?: number;
}

export interface CodexDiscoveryIssue {
  source: 'desktop' | 'cli';
  kind: 'unavailable' | 'malformed' | 'legacy-limit';
}

export interface CodexDiscoveryPage {
  data: CodexRawThreadSummary[];
  nextCursor: string | null;
  completeness: 'complete' | 'partial' | 'unavailable';
  errors: CodexDiscoveryIssue[];
}

export interface CodexDiscoveryOptions {
  sessionFactory?: CodexSessionFactory;
  codexHome?: string;
  desktop?: DesktopDiscoveryOptions;
  cursor?: string;
  cursorScope?: string;
  limit?: number;
  signal?: AbortSignal;
  /** Legacy CLI callers keep the existing one-shot limit-20 native request. */
  legacyCli?: boolean;
}

export interface CodexDiagnosticFailure {
  stage: 'metadata' | 'owner' | 'snapshot';
  code: string;
  ipcStage?: 'prewrite' | 'rejected' | 'uncertain';
}

export interface CodexCandidateDiagnostic {
  id: string;
  name: string | null;
  status: 'not-probed' | 'owner-missing' | 'unsupported' | 'probe-failed' | 'snapshot-failed' | 'available';
  failure?: CodexDiagnosticFailure;
}

interface CursorState {
  stage: 'desktop' | 'cli';
  nativeCursor?: string;
  seen: string[];
  sourceCursors: string[];
  errors: CodexDiscoveryIssue[];
  sourceRead: boolean;
}

const CURSOR_KIND = 'crosschat-codex-aggregate-v1';
const MAX_CURSOR_LENGTH = 2 * 1024 * 1024;
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function abortError(): DOMException { return new DOMException('Codex discovery cancelled.', 'AbortError'); }
function checkAbort(signal?: AbortSignal): void { if (signal?.aborted) throw abortError(); }
function invalidCursor(): MultichatError { return new MultichatError('CODEX_DISCOVERY_INVALID_CURSOR', 'Codex discovery cursor does not match this source. Refresh before reading more pages.'); }
function malformed(): MultichatError { return new MultichatError('CODEX_DISCOVERY_PROTOCOL_ERROR', 'Codex discovery source returned malformed pagination.'); }

async function untilAborted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return work;
  let cancel: (() => void) | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      cancel = () => reject(abortError());
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    })]);
  } finally { if (cancel !== undefined) signal.removeEventListener('abort', cancel); }
}

function issue(state: CursorState, source: CodexDiscoveryIssue['source'], kind: CodexDiscoveryIssue['kind']): void {
  if (!state.errors.some((value) => value.source === source && value.kind === kind)) state.errors.push({ source, kind });
}

function parseCursor(cursor: string | undefined, binding: string, desktopEnabled: boolean): CursorState {
  if (cursor === undefined) return { stage: desktopEnabled ? 'desktop' : 'cli', seen: [], sourceCursors: [], errors: [], sourceRead: false };
  try {
    if (cursor.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalidCursor();
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!record(value) || value.kind !== CURSOR_KIND || value.binding !== binding || !record(value.state)) throw invalidCursor();
    const state = value.state;
    if (state.stage !== 'desktop' && state.stage !== 'cli' || state.stage === 'desktop' && !desktopEnabled
      || state.nativeCursor !== undefined && typeof state.nativeCursor !== 'string'
      || !Array.isArray(state.seen) || !state.seen.every((id) => typeof id === 'string' && id.length > 0)
      || !Array.isArray(state.sourceCursors) || !state.sourceCursors.every((id) => typeof id === 'string')
      || !Array.isArray(state.errors) || !state.errors.every((error) => record(error) && ['desktop', 'cli'].includes(String(error.source)) && ['unavailable', 'malformed', 'legacy-limit'].includes(String(error.kind)))
      || typeof state.sourceRead !== 'boolean') throw invalidCursor();
    return { stage: state.stage, nativeCursor: state.nativeCursor as string | undefined, seen: [...state.seen] as string[], sourceCursors: [...state.sourceCursors] as string[],
      errors: state.errors.map((error) => ({ source: error.source, kind: error.kind })) as CodexDiscoveryIssue[], sourceRead: state.sourceRead };
  } catch { throw invalidCursor(); }
}

function cursorFor(state: CursorState, binding: string): string {
  const cursor = Buffer.from(JSON.stringify({ kind: CURSOR_KIND, binding, state })).toString('base64url');
  if (cursor.length > MAX_CURSOR_LENGTH) throw new MultichatError('CODEX_DISCOVERY_CURSOR_LIMIT', 'Codex discovery cursor exceeds the safe size limit. Refresh the source.');
  return cursor;
}

function finish(state: CursorState, binding: string, data: CodexRawThreadSummary[], more: boolean): CodexDiscoveryPage {
  return { data, nextCursor: more ? cursorFor(state, binding) : null,
    completeness: more || state.errors.length > 0 ? state.sourceRead ? 'partial' : 'unavailable' : 'complete', errors: [...state.errors] };
}

function nextNative(state: CursorState, next: unknown): boolean {
  if (next === null) return false;
  if (typeof next !== 'string' || next.length === 0 || state.sourceCursors.includes(next)) throw malformed();
  state.sourceCursors.push(next);
  state.nativeCursor = next;
  return true;
}

function deduplicate(state: CursorState, data: CodexRawThreadSummary[]): CodexRawThreadSummary[] {
  const seen = new Set(state.seen);
  const unique = data.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  state.seen = [...seen];
  return unique;
}

/** Owns one bounded read-only owner/snapshot lifecycle per candidate. */
export async function readDesktopCandidates(
  rows: readonly DesktopMetadataRow[], options: CodexDiscoveryOptions,
  seen: ReadonlySet<string> = new Set(),
): Promise<{ data: CodexRawThreadSummary[]; diagnostics: CodexCandidateDiagnostic[]; issues: CodexDiscoveryIssue[] }> {
  const configuration = options.desktop ?? {};
  const concurrency = configuration.concurrency ?? 8;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 32) throw malformed();
  const data: Array<CodexRawThreadSummary | undefined> = new Array(rows.length);
  const diagnostics: Array<CodexCandidateDiagnostic | undefined> = new Array(rows.length);
  const issues: CodexDiscoveryIssue[] = [];
  let index = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      checkAbort(options.signal);
      const current = index++;
      if (current >= rows.length) return;
      const row = rows[current];
      if (seen.has(row.id)) continue;
      const work = async (): Promise<void> => {
        let session: DesktopThreadSession | null = null;
        let stage: 'owner' | 'snapshot' = 'owner';
        try {
          session = await (configuration.openThread ?? openDesktopThread)(row.id, { codexHome: options.codexHome, pipePath: configuration.pipePath,
            timeoutMs: configuration.probeTimeoutMs ?? 1_000, snapshotTimeoutMs: configuration.probeTimeoutMs ?? 1_000, signal: options.signal });
          checkAbort(options.signal);
          if (session === null) {
            diagnostics[current] = { id: row.id, name: row.name, status: 'owner-missing',
              failure: { stage, code: 'CODEX_DESKTOP_OWNER_UNAVAILABLE' } };
            return;
          }
          stage = 'snapshot';
          const snapshot = await untilAborted(session.snapshot(), options.signal);
          checkAbort(options.signal);
          if (snapshot.id !== row.id || session.threadId !== row.id) throw malformed();
          data[current] = { id: row.id, name: row.name, rawStatus: snapshot.rawStatus, attributes: { cwd: row.cwd, originator: row.originator,
            source: row.source, createdAt: row.createdAtMs, updatedAt: row.updatedAtMs, transport: 'desktop', ownerId: session.ownerId } };
          diagnostics[current] = { id: row.id, name: row.name, status: 'available' };
        } catch (error) {
          if (options.signal?.aborted) throw abortError();
          // Preserve the existing summary contract separately from the more
          // detailed candidate codes. A generic coded Error is unavailable.
          const kind = error instanceof MultichatError && error.code.includes('PROTOCOL') ? 'malformed' : 'unavailable';
          if (!issues.some((value) => value.kind === kind)) issues.push({ source: 'desktop', kind });
          const code = record(error) && typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(error.code)
            ? error.code : 'CODEX_DESKTOP_PROBE_FAILED';
          const ipcStage = record(error) && (error.stage === 'prewrite' || error.stage === 'rejected' || error.stage === 'uncertain') ? error.stage : undefined;
          diagnostics[current] = { id: row.id, name: row.name,
            status: code === 'CODEX_DESKTOP_UNSUPPORTED' ? 'unsupported' : stage === 'snapshot' ? 'snapshot-failed' : 'probe-failed',
            failure: { stage, code, ...(ipcStage === undefined ? {} : { ipcStage }) } };
        } finally { await session?.close().catch(() => undefined); }
      };
      await untilAborted(work(), options.signal);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  return { data: data.filter((item): item is CodexRawThreadSummary => item !== undefined),
    diagnostics: diagnostics.filter((item): item is CodexCandidateDiagnostic => item !== undefined), issues };
}

async function readCli(options: CodexDiscoveryOptions, state: CursorState, limit: number): Promise<{ data: CodexRawThreadSummary[]; more: boolean }> {
  let session: CodexSession | undefined;
  const work = async (): Promise<{ data: CodexRawThreadSummary[]; more: boolean }> => {
    try {
      session = await (options.sessionFactory ?? openCodexSession())();
      checkAbort(options.signal);
      await untilAborted(session.initialize(), options.signal);
      checkAbort(options.signal);
      if (options.legacyCli || session.listThreadPage === undefined) {
        const data = (await untilAborted(session.listThreads(), options.signal)).map((thread) => ({ id: thread.id, name: thread.name, rawStatus: thread.status, attributes: { transport: 'cli' } }));
        issue(state, 'cli', 'legacy-limit');
        state.sourceRead = true;
        return { data, more: false };
      }
      const page = await untilAborted(session.listThreadPage({ cursor: state.nativeCursor, limit, signal: options.signal }), options.signal);
      checkAbort(options.signal);
      const more = nextNative(state, page.nextCursor);
      if (page.completeness === 'partial') issue(state, 'cli', 'legacy-limit');
      state.sourceRead = true;
      return { data: page.data.map((thread) => ({ ...thread, attributes: { ...thread.attributes, transport: 'cli' } })), more };
    } finally { await session?.close().catch(() => undefined); }
  };
  return untilAborted(work(), options.signal);
}

/** Read-only pages: Desktop owners first, then CLI, with exact cross-page ID deduplication. */
export async function listCodexThreadPage(options: CodexDiscoveryOptions = {}): Promise<CodexDiscoveryPage> {
  checkAbort(options.signal);
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw malformed();
  const desktopEnabled = options.desktop !== undefined || options.sessionFactory === undefined;
  const binding = createHash('sha256').update(JSON.stringify([resolve(options.codexHome ?? codexHomeDir()), options.desktop?.sqliteHome ?? process.env.CODEX_SQLITE_HOME ?? null,
    options.desktop?.pipePath ?? null, options.cursorScope ?? null, options.legacyCli === true, desktopEnabled])).digest('hex');
  const state = parseCursor(options.cursor, binding, desktopEnabled);
  if (state.stage === 'desktop') {
    try {
      const page = await untilAborted((options.desktop?.listMetadata ?? listDesktopMetadata)({ codexHome: options.codexHome,
        sqliteHome: options.desktop?.sqliteHome, cursor: state.nativeCursor, limit, signal: options.signal }), options.signal);
      checkAbort(options.signal);
      if (!Array.isArray(page.data) || page.data.length > limit) throw malformed();
      const more = nextNative(state, page.nextCursor);
      if (page.completeness === 'partial' && !more) issue(state, 'desktop', 'legacy-limit');
      const inspected = await readDesktopCandidates(page.data, options, new Set(state.seen));
      for (const failure of inspected.issues) issue(state, failure.source, failure.kind);
      const data = deduplicate(state, inspected.data);
      state.sourceRead = true;
      if (more) return finish(state, binding, data, true);
      state.stage = 'cli'; state.nativeCursor = undefined; state.sourceCursors = [];
      if (data.length > 0) return finish(state, binding, data, true);
    } catch (error) {
      if (options.signal?.aborted) throw abortError();
      issue(state, 'desktop', error instanceof MultichatError && error.code.includes('PROTOCOL') ? 'malformed' : 'unavailable');
      state.stage = 'cli'; state.nativeCursor = undefined; state.sourceCursors = [];
    }
  }
  try {
    const page = await readCli(options, state, limit);
    return finish(state, binding, deduplicate(state, page.data), page.more);
  } catch (error) {
    if (options.signal?.aborted) throw abortError();
    issue(state, 'cli', error instanceof MultichatError && error.code.includes('PROTOCOL') ? 'malformed' : 'unavailable');
    return finish(state, binding, [], false);
  }
}
