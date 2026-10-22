import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { listTuiContexts } from '../contexts/index.js';
import type { TuiContextsResult } from '../contexts/index.js';
import type { DiscoveryEndpoint } from '../discovery/model.js';
import type { DiagnosticQueryOptions } from '../diagnostics/query.js';
import { parseDiagnosticResult, queryDoctorDiagnostics } from '../diagnostics/query.js';
import { formatDiagnosticCheck } from '../diagnostics/render.js';
import type { DiagnosticLevel, DiagnosticResult, DiagnosticSummary } from '../diagnostics/model.js';
import type { QueryError } from '../queries/reading.js';
import { checkAbort, readParsed } from '../queries/reading.js';
import { queryServiceStatuses } from '../queries/services.js';
import type { CollectionResult, ServiceSnapshot } from '../queries/services.js';
import type { Completeness } from '../sessions/model.js';
import type { OutboxMetadataResult } from './communications.js';
import { queryOutbox, summarizeOutbox } from './communications.js';
import { parseWatchdogEvidence } from './watchdog.js';
import { parseDiscoveryResponse } from '../discovery/boundary.js';
import { sessionKey } from '../sessions/model.js';
import type { DiscoverySession } from '../discovery/model.js';
import { untilAborted } from '../sessions/reading.js';
import { isProcessAlive } from '../../platform/process-inspector.js';
import { parseNodeConfig } from '../../serve/node-config.js';
import { readNodeRevocationAsync } from '../../serve/revocation.js';

export interface OverviewReadRequest { contextId: string; signal?: AbortSignal }
export interface OverviewResult { completeness: Completeness; observedAt: number; errors: QueryError[] }
export interface ProviderObservation {
  providerId: string;
  /** Observed counts; incomplete observations are never exact population counts. */
  count: number;
  anonymous: number;
  completeness: Completeness;
}
export interface ConnectionObservation { id: string; kind: string; name: string; target: string }
export interface ServiceObservation extends ServiceSnapshot {
  pause?: { state: 'revoked' | 'unknown'; message: string };
}
export interface WatchdogObservation {
  running: boolean | null;
  evidence: 'fresh-heartbeat' | 'live-pid' | 'missing' | 'stale' | 'unavailable';
  pid?: number;
  heartbeatAt?: number;
}
export interface DiagnosticObservation {
  id: string;
  group: string;
  code: string;
  level: DiagnosticLevel;
  label: string;
  description: string;
  guidance: string;
  facts: readonly { label: string; value: string }[];
}
export interface DoctorObservation extends OverviewResult {
  checks: readonly DiagnosticObservation[];
  summary: DiagnosticSummary | null;
}
export interface StatusOverview extends OverviewResult {
  providers: readonly ProviderObservation[];
  connections: readonly ConnectionObservation[];
  services: readonly ServiceObservation[];
  outbox: { threads: number; items: number | null };
  watchdog: WatchdogObservation;
  lastDoctor: DoctorObservation | null;
}
export interface LocalOverview {
  readStatus(request: OverviewReadRequest): Promise<StatusOverview>;
  readDoctor(request: OverviewReadRequest): Promise<DoctorObservation>;
}
export interface OverviewOptions {
  home: string;
  discovery: DiscoveryEndpoint;
  env?: NodeJS.ProcessEnv;
  nativeEnvironment?: DiagnosticQueryOptions['nativeEnvironment'];
  readOutbox?(signal?: AbortSignal): Promise<OutboxMetadataResult>;
  readContexts?(signal?: AbortSignal): Promise<TuiContextsResult>;
  readServices?(signal?: AbortSignal): Promise<CollectionResult<ServiceSnapshot>>;
  queryDoctor?(options: DiagnosticQueryOptions & { home: string; env?: NodeJS.ProcessEnv; timeoutMs: number }): Promise<DiagnosticResult>;
  now?(): number;
  doctorTimeoutMs?: number;
}

const MAX_METADATA_BYTES = 2 * 1024 * 1024;
async function readMetadata(path: string, signal?: AbortSignal): Promise<string> {
  checkAbort(signal);
  const entry = await lstat(path);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Metadata source is not a regular file.');
  const file = await open(path, 'r');
  try {
    checkAbort(signal);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_METADATA_BYTES) throw new Error('Metadata source exceeds its byte limit.');
    const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_METADATA_BYTES + 1));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    checkAbort(signal);
    if (bytesRead > MAX_METADATA_BYTES) throw new Error('Metadata source exceeds its byte limit.');
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await file.close(); }
}

function issue(source: string, message = '无法读取此观察来源', kind: QueryError['kind'] = 'unavailable'): QueryError {
  return { source, kind, message, nextStep: '检查此来源的路径、格式或读取能力后按 r 刷新' };
}
function emptyStatus(observedAt: number, completeness: Completeness, errors: QueryError[], lastDoctor: DoctorObservation | null): StatusOverview {
  return { providers: [], connections: [], services: [], outbox: { threads: 0, items: null }, watchdog: { running: null, evidence: 'unavailable' }, lastDoctor, observedAt, completeness, errors };
}

/** Read-only per-TUI owner. Only explicit doctor reads update its in-memory report. */
export function createLocalOverview(options: OverviewOptions): LocalOverview {
  const baseDir = join(options.home, '.crosschat');
  const tcpDir = join(baseDir, 'tcp');
  const now = options.now ?? Date.now;
  let lastDoctor: DoctorObservation | null = null;
  let doctorGeneration = 0;

  async function providers(signal?: AbortSignal): Promise<{ items: ProviderObservation[]; completeness: Completeness; errors: QueryError[] }> {
    const items = new Map<string, DiscoverySession>();
    const ids = new Set<string>();
    const cursors = new Set<string>();
    const errors: QueryError[] = [];
    let cursor: string | undefined;
    let completeness: Completeness = 'complete';
    for (;;) {
      checkAbort(signal);
      try {
        const result = parseDiscoveryResponse(await untilAborted(options.discovery.execute({ op: 'list', limit: 100, ...(cursor === undefined ? {} : { cursor }) }, { contextId: 'local', signal }), signal));
        if (result.op !== 'list' || result.page.items.some((item) => item.ref.contextId !== 'local')) throw new Error('Invalid source scope.');
        for (const provider of result.providers) ids.add(provider.providerId);
        for (const item of result.page.items) { ids.add(item.ref.providerId); items.set(sessionKey(item.ref), item); }
        errors.push(...result.page.errors.map((error) => ({ ...issue(error.source.path ?? `discovery:${error.source.providerId}`, error.message,
          ['missing', 'unreadable', 'malformed', 'unavailable', 'cancelled'].includes(error.kind) ? error.kind as QueryError['kind'] : 'unavailable'),
          ...(error.nextStep === undefined ? {} : { nextStep: error.nextStep }) })));
        completeness = result.page.completeness;
        if (completeness === 'cancelled') throw new Error('Cancelled source.');
        if (result.page.nextCursor === null || completeness === 'unavailable') break;
        if (cursors.has(result.page.nextCursor)) { errors.push(issue('discovery', '会话来源重复分页游标，已停止读取', 'malformed')); completeness = 'partial'; break; }
        cursors.add(result.page.nextCursor); cursor = result.page.nextCursor;
      } catch {
        checkAbort(signal);
        errors.push(issue('discovery', '会话来源不可读或返回无效元数据')); completeness = items.size ? 'partial' : 'unavailable'; break;
      }
    }
    if (completeness === 'complete' && errors.length) completeness = 'partial';
    return { items: [...ids].map((providerId) => {
      const sessions = [...items.values()].filter((item) => item.ref.providerId === providerId);
      return { providerId, count: sessions.length, anonymous: sessions.filter((item) => !item.name).length, completeness };
    }), completeness, errors };
  }

  async function watchdog(signal?: AbortSignal): Promise<{ value: WatchdogObservation; errors: QueryError[] }> {
    const file = join(baseDir, 'outbox', 'watchdog.lock');
    const result = await readParsed(file, parseWatchdogEvidence, { signal, readText: readMetadata, now });
    if (result.state === 'missing') return { value: { running: false, evidence: 'missing' }, errors: [] };
    if (!result.value) return { value: { running: null, evidence: 'unavailable' }, errors: result.errors };
    const fresh = now() - result.value.heartbeatAt < 90_000;
    const live = !fresh && isProcessAlive(result.value.pid);
    return { value: { ...result.value, running: fresh || live, evidence: fresh ? 'fresh-heartbeat' : live ? 'live-pid' : 'stale' }, errors: [] };
  }

  async function servicePause(items: readonly ServiceSnapshot[], signal?: AbortSignal): Promise<{ items: ServiceObservation[]; errors: QueryError[] }> {
    const services: ServiceObservation[] = items.map((item) => ({ ...item }));
    const revoked = services.filter((item) => item.kind === 'node' && item.state === 'revoked');
    if (!revoked.length) return { items: services, errors: [] };
    const file = join(tcpDir, 'node.json');
    const config = await readParsed(file, (text) => parseNodeConfig(text, file), { signal, readText: readMetadata, now });
    const errors = [...config.errors];
    for (const service of revoked) {
      checkAbort(signal);
      service.pause = { state: 'unknown', message: '暂停状态未知：当前凭证无匹配撤权记录，请核对当前连接与日志' };
      const matches = config.value?.entries.filter((entry) => (entry.name ?? `${entry.host}:${entry.port}`) === service.brokerAlias) ?? [];
      if (matches.length !== 1) continue;
      try {
        if (await readNodeRevocationAsync(file, matches[0], { signal, readText: readMetadata })) {
          service.pause = { state: 'revoked', message: '当前凭证已撤销，自动重连已暂停；换钥后显式重新连接' };
        }
      } catch {
        checkAbort(signal);
        errors.push(issue(`${file}#pause`, '撤权暂停记录不可读，不能确认当前凭证的暂停状态', 'malformed'));
      }
    }
    return { items: services, errors };
  }

  async function readStatus(request: OverviewReadRequest): Promise<StatusOverview> {
    const observedAt = now();
    if (request.contextId !== 'local') return emptyStatus(observedAt, 'unavailable', [issue('overview', '此总览仅支持已选本机上下文')], lastDoctor);
    const signal = request.signal;
    try {
      checkAbort(signal);
      const results = await untilAborted(Promise.allSettled([
        providers(signal),
        options.readContexts?.(signal) ?? listTuiContexts({ home: options.home, signal, now, readText: readMetadata }),
        options.readServices?.(signal) ?? queryServiceStatuses({ tcpDir, signal, now, readText: readMetadata }),
        options.readOutbox?.(signal) ?? queryOutbox({ baseDir, contextId: 'local', signal, now }),
        watchdog(signal),
      ]), signal);
      checkAbort(signal);
      const errors: QueryError[] = [];
      const [sessions, contexts, services, queue, worker] = results;
      const sessionPage = sessions.status === 'fulfilled' ? sessions.value : { items: [], completeness: 'unavailable' as const, errors: [issue('discovery')] };
      const connectionPage = contexts.status === 'fulfilled' ? contexts.value : { items: [], errors: [issue('contexts')] };
      const servicePage = services.status === 'fulfilled' ? services.value : { items: [], completeness: 'unavailable' as const, errors: [issue(tcpDir)] };
      const queuePage = queue.status === 'fulfilled' ? queue.value : { items: [], completeness: 'unavailable' as const, errors: [issue(join(baseDir, 'outbox'))] };
      const watchdogPage = worker.status === 'fulfilled' ? worker.value : { value: { running: null, evidence: 'unavailable' as const }, errors: [issue(join(baseDir, 'outbox', 'watchdog.lock'))] };
      const paused = await servicePause(servicePage.items, signal);
      errors.push(...sessionPage.errors, ...connectionPage.errors, ...servicePage.errors.filter((error) => error.kind !== 'missing'), ...queuePage.errors, ...watchdogPage.errors, ...paused.errors);
      const counts = summarizeOutbox(queuePage.items);
      const servicesMissing = servicePage.errors.length > 0 && servicePage.errors.every((error) => error.kind === 'missing');
      checkAbort(signal);
      return { providers: sessionPage.items, connections: connectionPage.items.map(({ id, kind, name, target }) => ({ id, kind, name, target })), services: paused.items,
        outbox: { threads: counts.threads, items: queuePage.completeness === 'complete' ? counts.items : null }, watchdog: watchdogPage.value, lastDoctor,
        completeness: errors.length || sessionPage.completeness !== 'complete' || queuePage.completeness !== 'complete' || (servicePage.completeness !== 'complete' && !servicesMissing) ? 'partial' : 'complete', observedAt: now(), errors };
    } catch {
      return emptyStatus(now(), signal?.aborted ? 'cancelled' : 'unavailable', [issue('overview', signal?.aborted ? '总览读取已取消' : '无法读取本机总览', signal?.aborted ? 'cancelled' : 'unavailable')], lastDoctor);
    }
  }

  async function readDoctor(request: OverviewReadRequest): Promise<DoctorObservation> {
    const generation = ++doctorGeneration;
    const fail = (completeness: Completeness, message: string): DoctorObservation => ({ checks: [], summary: null, completeness, observedAt: now(), errors: [issue('doctor', message, completeness === 'cancelled' ? 'cancelled' : 'unavailable')] });
    if (request.contextId !== 'local') return fail('unavailable', '此体检仅支持已选本机上下文');
    try {
      checkAbort(request.signal);
      const query = options.queryDoctor ?? queryDoctorDiagnostics;
      const work = query({ home: options.home, env: options.env, nativeEnvironment: options.nativeEnvironment ?? 'isolated', signal: request.signal, timeoutMs: options.doctorTimeoutMs ?? 30_000 });
      const result = parseDiagnosticResult(await (options.queryDoctor ? untilAborted(work, request.signal) : work));
      checkAbort(request.signal);
      const repeated = new Map<string, number>();
      const checks = result.groups.flatMap((group) => group.checks.map((check): DiagnosticObservation => {
        const digest = createHash('sha256').update(JSON.stringify([group.context, check.code, check.data])).digest('hex');
        const occurrence = repeated.get(digest) ?? 0; repeated.set(digest, occurrence + 1);
        return { id: `diagnostic:${digest}:${occurrence}`, group: group.context.kind === 'environment' ? '环境' : group.context.kind === 'other' ? '其他' : `TCP${group.context.star ? ` / ${group.context.star}` : ''}`,
          code: check.code, level: check.level, ...formatDiagnosticCheck(check), facts: Object.entries(check.data).map(([label, value]) => ({ label, value: typeof value === 'string' ? value : JSON.stringify(value) })) };
      }));
      const page: DoctorObservation = { checks, summary: result.summary, completeness: 'complete', observedAt: now(), errors: [] };
      if (generation === doctorGeneration) lastDoctor = page;
      return page;
    } catch { return fail(request.signal?.aborted ? 'cancelled' : 'unavailable', request.signal?.aborted ? '体检已取消' : '体检未完成或返回无效结果，请检查诊断来源后重试'); }
  }
  return { readStatus, readDoctor };
}
