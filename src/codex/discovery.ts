import { MultichatError } from '../errors.js';
import { openCodexSession, type CodexSessionFactory, type CodexThreadSummary } from './client.js';
import { codexHomeDir, lookupRolloutMetas, type RolloutMeta } from './rollout-meta.js';
import { listCodexThreadPage, readDesktopCandidates } from './aggregate-discovery.js';
import type { CodexCandidateDiagnostic, CodexDiagnosticFailure, DesktopDiscoveryOptions } from './aggregate-discovery.js';
import { normalizeThreadStatus } from './client.js';
import { listDesktopMetadata } from './desktop-metadata.js';
import type { DesktopMetadataRow } from './desktop-metadata.js';
import { resolveTargetByName } from '../resolve.js';

/** A thread/list summary enriched with rollout-file metadata when available. */
export interface CodexThreadWithMeta extends CodexThreadSummary {
  /** Absent when no rollout file matches the thread id or it is unreadable. */
  meta?: RolloutMeta;
}

export interface CodexThreadDiscoveryOptions {
  sessionFactory?: CodexSessionFactory;
  codexHome?: string;
  desktop?: DesktopDiscoveryOptions;
  signal?: AbortSignal;
}

interface CodexTargetDiagnosisBase {
  scope: 'desktop';
  cliStatus: 'not-checked';
  candidates: CodexCandidateDiagnostic[];
  errors: CodexDiagnosticFailure[];
}

export type CodexTargetDiagnosis = CodexTargetDiagnosisBase & (
  | { kind: 'not-found'; code?: never; message?: never }
  | { kind: 'saved' | 'ambiguous' | 'source-error'; code: string; message: string }
);

/** Injected reads may ignore the signal; stop waiting and release our listener. */
async function awaitDiagnosticRead<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return work;
  let cancel: (() => void) | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      cancel = () => reject(new DOMException('Codex target diagnosis cancelled.', 'AbortError'));
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    })]);
  } finally { if (cancel !== undefined) signal.removeEventListener('abort', cancel); }
}

/** Diagnose a normal name miss without adding saved records to deliverable lists. */
export async function diagnoseCodexTarget(
  query: string, options: Pick<CodexThreadDiscoveryOptions, 'codexHome' | 'desktop' | 'signal'> = {},
): Promise<CodexTargetDiagnosis> {
  const base: CodexTargetDiagnosisBase = { scope: 'desktop', cliStatus: 'not-checked', candidates: [], errors: [] };
  const rows = new Map<string, DesktopMetadataRow>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  try {
    do {
      if (options.signal?.aborted) throw new DOMException('Codex target diagnosis cancelled.', 'AbortError');
      const page = await awaitDiagnosticRead((options.desktop?.listMetadata ?? listDesktopMetadata)({ codexHome: options.codexHome,
        sqliteHome: options.desktop?.sqliteHome, cursor, signal: options.signal, limit: 100 }), options.signal);
      if (options.signal?.aborted) throw new DOMException('Codex target diagnosis cancelled.', 'AbortError');
      for (const row of page.data) rows.set(row.id, row);
      if (page.nextCursor !== null && (page.nextCursor.length === 0 || cursors.has(page.nextCursor))) {
        throw new MultichatError('CODEX_DESKTOP_METADATA_PROTOCOL_ERROR', 'Metadata source repeated its cursor.');
      }
      if (page.nextCursor === null && page.completeness === 'partial') {
        throw new MultichatError('CODEX_DESKTOP_METADATA_INCOMPLETE', 'Metadata source did not confirm a complete result.');
      }
      cursor = page.nextCursor ?? undefined;
      if (cursor !== undefined) cursors.add(cursor);
    } while (cursor !== undefined);
  } catch (error) {
    if (options.signal?.aborted || error instanceof Error && error.name === 'AbortError') throw error;
    const code = error instanceof MultichatError && /^[A-Z][A-Z0-9_]{0,95}$/.test(error.code) ? error.code : 'CODEX_DESKTOP_METADATA_UNAVAILABLE';
    return { ...base, kind: 'source-error', code: 'CODEX_DISCOVERY_UNAVAILABLE', errors: [{ stage: 'metadata', code }],
      message: `Codex 保存记录查询失败：stage=metadata code=${code}；无法确认名称是否存在。仅诊断 Desktop，CLI 未复核。` };
  }
  const metadata = [...rows.values()];
  let matched: DesktopMetadataRow;
  try {
    const resolved = resolveTargetByName(query, [], metadata);
    if (resolved.side !== 'codex') throw new Error('Unexpected target provider.');
    const row = rows.get(resolved.thread.id);
    if (row === undefined) throw new Error('Metadata target disappeared.');
    matched = row;
  } catch (error) {
    if (error instanceof MultichatError && error.code === 'NAME_NOT_FOUND') return { ...base, kind: 'not-found' };
    if (error instanceof MultichatError && error.code === 'NAME_COLLISION') {
      const exact = metadata.filter((row) => row.name === query);
      const lower = query.toLowerCase();
      const matches = exact.length > 0 ? exact : metadata.filter((row) => row.name !== null && lower !== '' && row.name.toLowerCase().startsWith(lower));
      // ID-prefix ambiguity is handled by the same resolver after names miss.
      const id = /^(?:codex\/)?([0-9a-f]{8})$/.exec(query)?.[1];
      const candidates = matches.length > 0 ? matches : metadata.filter((row) => id !== undefined && row.id.startsWith(id));
      return { ...base, kind: 'ambiguous', code: 'NAME_COLLISION', candidates: candidates.map((row) => ({ id: row.id, name: row.name, status: 'not-probed' })),
        message: `多个保存的 Codex 会话匹配 ${JSON.stringify(query)}：${candidates.map((row) => `${JSON.stringify(row.name)} (${row.id})`).join(', ')}。请用完整名称或 ID 区分；仅诊断 Desktop，CLI 未复核。` };
    }
    throw error;
  }
  const inspected = await readDesktopCandidates([matched], options);
  const candidate = inspected.diagnostics[0];
  if (candidate === undefined) throw new MultichatError('CODEX_DISCOVERY_PROTOCOL_ERROR', 'The target diagnostic returned no candidate.');
  const failure = candidate.failure;
  const code = candidate.status === 'available' ? 'CODEX_TARGET_DISCOVERY_CHANGED'
    : candidate.status === 'owner-missing' ? 'CODEX_DESKTOP_OWNER_UNAVAILABLE'
      : candidate.status === 'unsupported' ? 'CODEX_DESKTOP_UNSUPPORTED' : 'CODEX_TARGET_PROBE_FAILED';
  const explanation = candidate.status === 'available' ? '名称列表采样已变化，现在可探测，但未自动发送；请重试原命令'
    : candidate.status === 'owner-missing' ? '已找到保存记录，但当前没有可达的 Desktop owner'
      : candidate.status === 'unsupported' ? '已找到保存记录，但 Desktop owner 不支持外部输入'
        : '已找到保存记录，但 Desktop 只读探测失败';
  return { ...base, kind: 'saved', code, candidates: [candidate],
    message: `Codex ${JSON.stringify(matched.name ?? matched.id)} (${matched.id})：${explanation}${failure === undefined ? '' : `；stage=${failure.stage} code=${failure.code}${failure.ipcStage === undefined ? '' : ` ipcStage=${failure.ipcStage}`}`}。仅诊断 Desktop，CLI 未复核。` };
}

/**
 * Read-only Codex thread discovery: initialize + thread/list on a fresh proxy
 * session, then close. Never resumes, starts turns, or mutates anything.
 * Each listed thread is tagged with its rollout session metadata (cwd,
 * originator, creation time); a metadata lookup failure never fails the list.
 */
export async function listCodexThreads(
  options: CodexThreadDiscoveryOptions = {},
): Promise<CodexThreadWithMeta[]> {
  // Existing injected CLI adapters remain isolated from the user's DB and pipe.
  if (options.sessionFactory === undefined || options.desktop !== undefined) {
    const threads: CodexThreadWithMeta[] = [];
    let cursor: string | undefined;
    let available = false;
    let cliUnavailable = false;
    do {
      const page = await listCodexThreadPage({ ...options, cursor, limit: 20, legacyCli: true });
      available ||= page.completeness !== 'unavailable';
      cliUnavailable ||= page.errors.some((error) => error.source === 'cli' && error.kind !== 'legacy-limit');
      for (const thread of page.data) {
        if (threads.length === 20) break;
        let status: CodexThreadSummary['status'];
        if (typeof thread.rawStatus === 'string' && ['idle', 'busy', 'not_loaded', 'waiting_approval', 'system_error'].includes(thread.rawStatus)) status = thread.rawStatus as CodexThreadSummary['status'];
        else {
          try { status = normalizeThreadStatus(thread.rawStatus); }
          catch { status = 'not_loaded'; }
        }
        const attributes = thread.attributes;
        const meta = {
          cwd: typeof attributes.cwd === 'string' ? attributes.cwd : undefined,
          originator: typeof attributes.originator === 'string' ? attributes.originator : undefined,
          createdAt: typeof attributes.createdAt === 'number' ? new Date(attributes.createdAt).toISOString() : undefined,
        };
        threads.push({ id: thread.id, name: thread.name, status,
          ...(meta.cwd !== undefined || meta.originator !== undefined || meta.createdAt !== undefined ? { meta } : {}) });
      }
      cursor = page.nextCursor ?? undefined;
    } while (threads.length < 20 && cursor !== undefined);
    if (!available || threads.length === 0 && cliUnavailable) throw new MultichatError('CODEX_PROXY_SPAWN_FAILED', 'No live Codex Desktop thread was found and the CLI app-server could not be read.');
    let metas = new Map<string, RolloutMeta>();
    try { metas = lookupRolloutMetas(options.codexHome ?? codexHomeDir(), threads.filter((thread) => thread.meta === undefined).map((thread) => thread.id)); }
    catch { /* Existing CLI rollout enrichment remains best effort. */ }
    return threads.map((thread) => {
      const meta = metas.get(thread.id);
      return meta === undefined ? thread : { ...thread, meta };
    });
  }
  const sessionFactory = options.sessionFactory ?? openCodexSession();
  let session;
  try {
    session = await sessionFactory();
  } catch (err) {
    if (err instanceof MultichatError && err.code === 'CODEX_PROXY_SPAWN_FAILED') throw err;
    throw new MultichatError(
      'CODEX_PROXY_SPAWN_FAILED',
      'Failed to establish the codex app-server proxy channel.',
      { cause: err },
    );
  }
  try {
    await session.initialize();
    const threads = await session.listThreads();
    let metas = new Map<string, RolloutMeta>();
    try {
      metas = lookupRolloutMetas(options.codexHome ?? codexHomeDir(), threads.map((t) => t.id));
    } catch {
      // Metadata is best-effort identification only.
    }
    return threads.map((thread) => {
      const meta = metas.get(thread.id);
      return meta === undefined ? thread : { ...thread, meta };
    });
  } catch (err) {
    if (err instanceof MultichatError) throw err;
    throw new MultichatError('CODEX_PROTOCOL_ERROR', 'codex thread/list failed.', { cause: err });
  } finally {
    await session.close().catch(() => undefined);
  }
}
