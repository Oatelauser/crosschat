import type { LogCheckpoint, ManagedLogOptions, ManagedLogResult } from '../../application/observations/logs.js';
import { isRecord, untilAborted } from '../../application/sessions/reading.js';
import type { SessionRef } from '../../application/sessions/model.js';
import type { TuiAction, TuiPage, TuiReadRequest, TuiResource, TuiResourceAdapter } from '../model.js';

export interface LogsResourceOptions {
  read(options: Omit<ManagedLogOptions, 'baseDir' | 'now'> & { sourceId: string; signal: AbortSignal }): Promise<ManagedLogResult>;
  intervalMs?: number;
}

function action(id: string, label: string, shortcut: string, kind: TuiAction['kind'], extra: Partial<TuiAction> = {}): TuiAction {
  return { id, label, shortcut, kind, ownerResourceId: 'logs', selectionPolicy: 'none', mutation: false, returnPolicy: 'restore', ...extra };
}
const resource: TuiResource = {
  id: 'logs', label: 'crosschat日志', aliases: ['log'], description: '本机有界日志、来源选择、暂停与跟随', sortable: false,
  columns: [{ id: 'line', label: '日志行', width: 110, priority: 100 }, { id: 'offset', label: '字节位置', width: 12, priority: 10 }],
  actions: [action('source', '选择日志来源', 't', 'route-choice'), action('follow', '暂停 / 恢复跟随', 'Space', 'follow'),
    action('read-summary', '读取信息', 'i', 'detail', { viewId: 'read-summary' })],
};

function invalid(message: string): TuiPage {
  return { rows: [], completeness: 'unavailable', canFollow: false, notice: message,
    detailViews: { 'read-summary': { title: '日志读取信息', fields: [{ label: '原因', value: message }, { label: '下一步', value: '选择本机上下文；从对应资源重新进入，或使用 :logs 查看全部本机日志。' }] } } };
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

function scope(request: TuiReadRequest): Omit<ManagedLogOptions, 'baseDir' | 'now' | 'signal'> | undefined {
  if (!request.context || request.context.kind !== 'local') return undefined;
  if (request.route?.contextId !== undefined && request.route.contextId !== request.context.id) return undefined;
  const query = request.route?.query ?? {};
  if (Object.keys(query).some((key) => !['source', 'sessionRef', 'pairId', 'audit', 'starId'].includes(key))) return undefined;
  if (query.audit !== undefined && (query.audit !== 'admin-op' || !['broker', 'broker.old'].includes(query.source ?? '') || query.sessionRef || query.pairId)) return undefined;
  if (query.starId !== undefined && (!query.starId || query.starId.length > 1024 || query.audit !== 'admin-op')) return undefined;
  let sessionRef: SessionRef | undefined;
  if (query.sessionRef !== undefined) {
    let raw: unknown;
    try { raw = JSON.parse(query.sessionRef); } catch { return undefined; }
    if (!isRecord(raw) || raw.contextId !== request.context.id || typeof raw.providerId !== 'string' || raw.providerId === ''
      || typeof raw.nativeId !== 'string' || raw.nativeId === '' || (raw.referenceKind !== undefined && raw.referenceKind !== 'native')
      || Object.keys(raw).some((key) => !['contextId', 'providerId', 'nativeId', 'referenceKind'].includes(key))) return undefined;
    sessionRef = { contextId: request.context.id, providerId: raw.providerId, nativeId: raw.nativeId, ...(raw.referenceKind === 'native' ? { referenceKind: 'native' as const } : {}) };
  }
  if (query.pairId !== undefined && (!query.pairId || query.pairId.length > 16_384)) return undefined;
  return { contextId: request.context.id, sourceId: query.source ?? 'send-log', ...(sessionRef ? { sessionRef } : {}), ...(query.pairId ? { pairId: query.pairId } : {}), ...(query.audit ? { audit: 'admin-op' as const } : {}), ...(query.starId ? { starId: query.starId } : {}) };
}

/** The page owns no filesystem or protocol; its watch owns one cancellable read at a time. */
export function createLogsResource(options: LogsResourceOptions): { resource: TuiResource; adapter: TuiResourceAdapter } {
  const intervalMs = options.intervalMs ?? 1000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 100) throw new Error('Log follow interval must be at least 100ms.');
  const checkpoints = new Map<string, LogCheckpoint>();
  async function read(request: TuiReadRequest): Promise<TuiPage> {
    const selected = scope(request);
    if (!selected) return invalid('日志上下文或完整关联条件无效；未读取本机文件。');
    if (request.signal.aborted) return { ...invalid('读取已取消'), completeness: 'cancelled' };
    const key = JSON.stringify([request.context!.id, selected.sourceId, selected.sessionRef ?? null, selected.pairId ?? null, selected.audit ?? null, selected.starId ?? null]);
    const result = await untilAborted(options.read({ ...selected, sourceId: selected.sourceId ?? 'send-log', signal: request.signal, previous: checkpoints.get(key) }), request.signal);
    if (request.signal.aborted) return { ...invalid('读取已取消'), completeness: 'cancelled' };
    if (result.checkpoint) checkpoints.set(key, result.checkpoint);
    return {
      rows: result.items.map((entry) => ({ id: entry.id, contextId: request.context!.id, cells: { line: entry.text, offset: String(entry.offset) }, searchText: entry.text, copyValue: entry.text,
        detail: [{ label: '完整日志行', value: entry.text }, { label: '来源', value: result.source?.path ?? '' }, { label: '字节位置', value: String(entry.offset) }, { label: '末行状态', value: entry.terminated ? '已换行' : '当前已写内容；末行尚未换行' }] })),
      completeness: result.completeness, sampledAt: result.observedAt, canFollow: result.source !== null,
      notice: `${selected.audit ? `管理审计${selected.starId ? ` · 星 ${selected.starId}` : ''} · ` : ''}${result.source?.label ?? '未知来源'} · 只读 ${result.bytesRead} 字节${result.truncated ? '，最近有界窗口' : ''}${result.rotated ? '；文件已轮转或缩短' : ''}${result.errors.length ? '；按 i 查看来源问题' : ''}`,
      routeChoices: { source: { title: '选择本机日志来源（切换后查看该来源全部内容）', options: result.sources.map((source) => ({ value: source.id, label: `${source.label} · ${source.path}`, route: { resourceId: 'logs', contextId: request.context!.id, query: { source: source.id } } })) } },
      detailViews: { 'read-summary': { title: '日志读取信息', fields: [
        { label: '来源', value: result.source?.path ?? '未登记' }, { label: '完整性', value: result.completeness }, { label: '采样时间', value: String(result.observedAt) },
        { label: '读取范围', value: `${result.bytesRead}字节；${result.truncated ? '有界尾窗' : '当前完整文件'}；${result.omittedLeadingLine ? '有未完整读取的边缘行，不提供片段复制' : '没有截断行片段'}` },
        { label: '关联条件', value: selected.audit ? `管理审计 ${selected.starId ?? '所有星'}；按完整starId归属，旧行缺标识明确列为无法归属。` : selected.sessionRef ? JSON.stringify(selected.sessionRef, null, 2) : selected.pairId ?? '全部当前来源' },
        { label: '来源问题与下一步', value: result.errors.length ? result.errors.map((issue) => `${issue.source} <${issue.kind}>：${issue.message}\n${issue.nextStep}`).join('\n\n') : '无来源错误。日志事件不表示原生任务完成。' },
      ] } },
    };
  }
  const adapter: TuiResourceAdapter = {
    read,
    async watch(request, publish) {
      try {
        while (!request.signal.aborted) {
          const page = await read(request);
          if (request.signal.aborted) return;
          publish(page);
          if (!page.canFollow) return;
          await pause(intervalMs, request.signal);
        }
      } catch (error) { if (!request.signal.aborted) throw error; }
    },
  };
  return { resource, adapter };
}
