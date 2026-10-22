import type { CommunicationSummary, CommunicationsResult, OutboxMetadataResult, OutboxThreadMetadata } from '../../application/observations/communications.js';
import { cancellable } from '../../application/queries/reading.js';
import type { QueryError } from '../../application/queries/reading.js';
import { sessionKey } from '../../application/sessions/model.js';
import type { SessionRef } from '../../application/sessions/model.js';
import type { TuiAction, TuiActionAvailability, TuiPage, TuiReadRequest, TuiResource, TuiResourceAdapter, TuiRow } from '../model.js';

export interface CommunicationResourceOptions {
  readCommunications(request: { contextId: string; signal: AbortSignal }): Promise<CommunicationsResult>;
  readOutbox(request: { contextId: string; signal: AbortSignal }): Promise<OutboxMetadataResult>;
}

interface Scope { session?: SessionRef; pairId?: string }
function action(ownerResourceId: string, id: string, label: string, shortcut: string, extra: Partial<TuiAction> = {}): TuiAction {
  return { id, label, shortcut, ownerResourceId, kind: 'command', selectionPolicy: 'required', mutation: false, returnPolicy: 'restore', ...extra };
}
const summaryAction = (id: string) => action(id, 'read-summary', '读取信息', 'i', { kind: 'detail', viewId: 'read-summary', selectionPolicy: 'none' });
const deliveries: TuiResource = {
  id: 'deliveries', label: '投递记录', aliases: ['delivery'], description: '已记录通信对与最近投递元数据',
  columns: [{ id: 'name', label: '通信端点', width: 32, priority: 100 }, { id: 'channel', label: '通道', width: 8, priority: 80 }, { id: 'turn', label: '轮次', width: 6, priority: 60 }, { id: 'status', label: '投递状态', width: 22, priority: 90 }, { id: 'updatedAt', label: '记录时间', width: 24, priority: 30 }, { id: 'parked', label: '滞留', width: 8, priority: 70 }],
  actions: [action('deliveries', 'outbox', '相关滞留', 'w', { kind: 'navigate' }), action('deliveries', 'logs', '相关投递审计', 'l', { kind: 'navigate' }), summaryAction('deliveries')],
};
const outbox: TuiResource = {
  id: 'outbox', label: '滞留', aliases: [], description: '已有滞留队列的只读元数据',
  columns: [{ id: 'name', label: '目标', width: 24, priority: 100 }, { id: 'provider', label: '工具', width: 12, priority: 60 }, { id: 'count', label: '暂存条数', width: 12, priority: 90 }, { id: 'oldest', label: '最早暂存', width: 24, priority: 40 }, { id: 'state', label: '记录状态', width: 26, priority: 80 }],
  actions: [action('outbox', 'deliveries', '相关投递记录', 'o', { kind: 'navigate' }), action('outbox', 'logs', '看门狗日志', 'l', { enabled: false, unavailableReason: '现有看门狗没有独立日志文件。', nextStep: '按 i 查看读取信息，或返回投递记录查看已有审计；此处不启动看门狗。' }), summaryAction('outbox')],
};

const channels: Readonly<Record<CommunicationSummary['channel'], string>> = { local: '本机', ssh: 'SSH', tcp: 'TCP', unknown: '未知' };
const labels: Readonly<Record<string, string>> = { delivered: '已投递', queued: '已排队', parked: '已暂存', failed: '失败' };
function json(value: unknown): string { return JSON.stringify(value, null, 2) ?? 'null'; }
function time(value: number | null): string {
  if (value === null) return '未知';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value);
}
function disabled(reason: string, nextStep: string): TuiActionAvailability { return { enabled: false, reason, nextStep }; }
function scope(request: TuiReadRequest): Scope | undefined {
  if (!request.context || request.context.kind !== 'local') return undefined;
  const query = request.route?.query;
  let session: SessionRef | undefined;
  if (query?.sessionRef !== undefined) {
    try {
      const ref: unknown = JSON.parse(query.sessionRef);
      if (typeof ref !== 'object' || ref === null || Array.isArray(ref) || !('contextId' in ref) || ref.contextId !== request.context.id
        || !('providerId' in ref) || typeof ref.providerId !== 'string' || !ref.providerId || !('nativeId' in ref) || typeof ref.nativeId !== 'string' || !ref.nativeId
        || ('referenceKind' in ref && ref.referenceKind !== 'native') || Object.keys(ref).some((key) => !['contextId', 'providerId', 'nativeId', 'referenceKind'].includes(key))) return undefined;
      session = { contextId: request.context.id, providerId: ref.providerId, nativeId: ref.nativeId };
    } catch { return undefined; }
  }
  if (query?.pairId !== undefined && (query.pairId.split('\n').length !== 2 || query.pairId.split('\n').some((identity) => !identity))) return undefined;
  return { session, pairId: query?.pairId };
}
function failure(message: string, completeness: TuiPage['completeness'] = 'unavailable'): TuiPage {
  return { rows: [], completeness, notice: message, detailViews: { 'read-summary': { title: '读取信息', fields: [{ label: '原因与下一步', value: message }] } } };
}
function summary(page: Pick<TuiPage, 'rows' | 'completeness' | 'sampledAt'>, errors: readonly QueryError[], scopeValue: Scope): TuiPage {
  return { ...page, detailViews: { 'read-summary': { title: '通信元数据读取信息', fields: [
    { label: '范围', value: scopeValue.pairId ?? (scopeValue.session ? json(scopeValue.session) : '本机已有通信元数据') },
    { label: '完整性', value: page.completeness }, { label: '采样时间', value: time(page.sampledAt ?? null) }, { label: '匹配条数', value: String(page.rows.length) },
    { label: '含义', value: '投递状态、回执和暂存仅表示传输记录，不代表任务完成或原生聊天历史；刷新不会补投或修复。' },
    { label: '来源问题与下一步', value: errors.length ? errors.map((error) => `${error.source} <${error.kind}>：${error.message}\n下一步：${error.nextStep}`).join('\n\n') : '无读取错误。' },
  ] } }, notice: '仅传输元数据，不代表任务完成；刷新不会重发。' };
}

function deliveryRow(item: CommunicationSummary): TuiRow {
  const status = item.status === null ? '无审计状态' : `${Object.hasOwn(labels, item.status) ? labels[item.status] : '未识别'}<${item.status}>`;
  return { id: item.id, contextId: item.contextId, cells: { name: `${item.names[0]} → ${item.names[1]}`, channel: channels[item.channel], turn: item.turn === null ? '未知' : String(item.turn), status, updatedAt: time(item.updatedAt), parked: item.parked === null ? '未知' : String(item.parked) },
    searchText: json(item), ...(item.ref === null ? {} : { copyValue: item.ref }),
    actionAvailability: item.ref === null ? { copy: disabled('没有已保存且可核验的完整续话引用。', '请回原生会话核对已知投递信息；此处不会生成新引用。') } : undefined,
    actionRoutes: { outbox: { resourceId: 'outbox', contextId: item.contextId, query: { pairId: item.pairId } }, logs: { resourceId: 'logs', contextId: item.contextId, query: { source: 'send-log', pairId: item.pairId } } },
    detail: [{ label: '通信对完整标识', value: item.pairId }, { label: '完整端点', value: json(item.endpoints) }, { label: '通道', value: channels[item.channel] }, { label: '投递状态', value: status }, { label: '回执原值', value: item.receipt ?? '未记录' }, { label: '已保存续话引用', value: item.ref ?? '没有可核验引用' }, { label: '暂存条数', value: item.parked === null ? '未知（读取不完整）' : String(item.parked) }, { label: '记录时间', value: time(item.updatedAt) }, { label: '边界', value: '只展示传输元数据，不代表任务完成，不代替任何原生会话聊天。' }],
  };
}
function itemPair(thread: OutboxThreadMetadata, callerKey?: string): string { return [callerKey ?? 'human', `${thread.providerId}:${thread.threadId}`].sort().join('\n'); }
function queueRow(item: OutboxThreadMetadata): TuiRow {
  const pairs = [...new Set(item.items.map((entry) => itemPair(item, entry.callerKey)))];
  const query: Readonly<Record<string, string>> = pairs.length === 1 ? { pairId: pairs[0] } : { sessionRef: JSON.stringify({ contextId: item.contextId, providerId: item.providerId, nativeId: item.threadId }) };
  const uncertain = item.items.some((entry) => entry.deliveryState === 'uncertain');
  const state = item.state !== 'ready' ? `读取不完整<${item.state}>` : uncertain ? '写入待核实<uncertain>' : item.items.some((entry) => entry.deliveryState === 'in-flight') ? '已有写入尝试<in-flight>' : '已暂存，未确认送达';
  return { id: item.id, contextId: item.contextId, cells: { name: item.toName || item.threadId, provider: item.providerId, count: item.count === null ? '未知' : String(item.count), oldest: time(item.oldestParkedAt), state }, searchText: json(item), copyValue: item.mailboxFile,
    actionRoutes: { deliveries: { resourceId: 'deliveries', contextId: item.contextId, query } },
    actionAvailability: { logs: disabled('现有看门狗没有独立日志文件。', '查看已有投递审计并核对本机滞留镜像；本界面不启动或重复投递。') },
    detail: [{ label: '完整会话引用', value: json({ contextId: item.contextId, providerId: item.providerId, nativeId: item.threadId }) }, { label: '暂存条数', value: item.count === null ? '未知（读取不完整）' : String(item.count) }, { label: '最早暂存时间', value: time(item.oldestParkedAt) }, { label: '当前记录状态', value: state }, { label: '条目元数据', value: json(item.items) }, { label: '本机镜像路径', value: item.mailboxFile }, { label: '边界', value: '暂存不代表已送达；待核实写入不能自动重试。此处不展示消息正文、不改变原有补投规则。' }],
  };
}

/** UI adapters receive safe application DTOs; they perform no file, chat or delivery operations. */
export function createCommunicationResources(options: CommunicationResourceOptions): { deliveries: { resource: TuiResource; adapter: TuiResourceAdapter }; outbox: { resource: TuiResource; adapter: TuiResourceAdapter } } {
  const deliveryAdapter: TuiResourceAdapter = { async read(request) {
    const scoped = scope(request);
    if (!scoped || !request.context) return failure('缺少有效本机上下文或完整关联引用；返回来源列表重新选择。');
    if (request.signal.aborted) return failure('读取已取消。', 'cancelled');
    try {
      const result = await cancellable(options.readCommunications({ contextId: request.context.id, signal: request.signal }), request.signal);
      if (request.signal.aborted) return failure('读取已取消。', 'cancelled');
      const items = result.items.filter((item) => item.contextId === request.context!.id && (scoped.pairId === undefined || item.pairId === scoped.pairId)
        && (!scoped.session || item.localSessionRefs.some((ref) => sessionKey(ref) === sessionKey(scoped.session!))));
      return summary({ rows: items.map(deliveryRow), completeness: result.completeness, sampledAt: result.observedAt }, result.errors, scoped);
    } catch { return failure(request.signal.aborted ? '读取已取消。' : '通信元数据无法读取；按 r 重试并核对来源权限。', request.signal.aborted ? 'cancelled' : 'unavailable'); }
  } };
  const outboxAdapter: TuiResourceAdapter = { async read(request) {
    const scoped = scope(request);
    if (!scoped || !request.context) return failure('缺少有效本机上下文或完整关联引用；返回来源列表重新选择。');
    if (request.signal.aborted) return failure('读取已取消。', 'cancelled');
    try {
      const result = await cancellable(options.readOutbox({ contextId: request.context.id, signal: request.signal }), request.signal);
      if (request.signal.aborted) return failure('读取已取消。', 'cancelled');
      const items = result.items.filter((item) => item.contextId === request.context!.id
        && (!scoped.session || sessionKey({ contextId: item.contextId, providerId: item.providerId, nativeId: item.threadId }) === sessionKey(scoped.session))
        && (scoped.pairId === undefined || item.items.some((entry) => itemPair(item, entry.callerKey) === scoped.pairId)));
      return summary({ rows: items.map(queueRow), completeness: result.completeness, sampledAt: result.observedAt }, result.errors, scoped);
    } catch { return failure(request.signal.aborted ? '读取已取消。' : '滞留元数据无法读取；按 r 重试并核对来源权限。', request.signal.aborted ? 'cancelled' : 'unavailable'); }
  } };
  return { deliveries: { resource: deliveries, adapter: deliveryAdapter }, outbox: { resource: outbox, adapter: outboxAdapter } };
}
