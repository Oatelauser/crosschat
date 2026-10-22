import { parseDiscoveryResponse } from '../../application/discovery/index.js';
import type { DiscoveryEndpoint, DiscoveryProvider, DiscoverySession } from '../../application/discovery/index.js';
import { sessionKey } from '../../application/sessions/model.js';
import type { Completeness, SourceError } from '../../application/sessions/model.js';
import { untilAborted } from '../../application/sessions/reading.js';
import type { TuiAction, TuiActionAvailability, TuiPage, TuiReadonlyView, TuiResource, TuiResourceAdapter, TuiRow } from '../model.js';
import { createStatusRegistry } from './status.js';
import type { StatusRegistry } from './status.js';

export type NativeSessionGuide = (session: DiscoverySession) => TuiReadonlyView;
export interface SessionsResourceOptions {
  discovery: DiscoveryEndpoint;
  statusRegistry?: StatusRegistry;
  nativeGuides?: Readonly<Record<string, NativeSessionGuide>>;
  pageSize?: number;
  now?: () => number;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const nativeGuides: Readonly<Record<string, NativeSessionGuide>> = {
  claude: (session) => ({ title: 'Claude Code 原生操作', fields: [
    { label: '继续聊天', value: '请回到此会话的 Claude Code 原生窗口；TUI 不代替会话发言。' },
    { label: '恢复指引', value: session.ref.referenceKind !== 'process' && uuid.test(session.ref.nativeId)
      ? `需要恢复时，由用户确认原窗口和会话状态后在终端执行：claude --resume ${session.ref.nativeId}`
      : '此引用不能生成可靠的原生恢复命令，请在 Claude Code 中选择对应会话。' },
  ] }),
  codex: (session) => ({ title: 'Codex 原生操作', fields: [
    { label: '继续聊天', value: session.attributes.transport === 'desktop'
      ? '此会话由 Codex 桌面窗口持有，请返回原桌面聊天；不要另开 CLI 冒充当前窗口。'
      : '请回到此会话的 Codex 原生窗口；TUI 不代替会话发言。' },
    { label: '恢复指引', value: session.attributes.transport !== 'desktop' && session.ref.referenceKind !== 'process' && uuid.test(session.ref.nativeId)
      ? `需要恢复时，由用户确认原窗口和会话状态后在终端执行：codex resume ${session.ref.nativeId}`
      : '请在原生 Codex 窗口中选择此会话。' },
  ] }),
};

function action(id: string, label: string, shortcut: string, extra: Partial<TuiAction> = {}): TuiAction {
  return { id, label, shortcut, ownerResourceId: 'sessions', selectionPolicy: 'required', mutation: false, kind: 'command', returnPolicy: 'restore', ...extra };
}

const resource: TuiResource = {
  id: 'sessions', label: '会话', aliases: ['session'], description: '本机可发现会话、匿名、筛选与只读详情',
  columns: [
    { id: 'name', label: '名称', width: 24, priority: 100 }, { id: 'provider', label: '工具', width: 12, priority: 90 },
    { id: 'status', label: '原生状态', width: 26, priority: 80 }, { id: 'id', label: 'ID', width: 12, priority: 70 },
    { id: 'directory', label: '目录', width: 28, priority: 30 },
  ],
  actions: [
    action('filter-provider', '工具筛选', 't', { kind: 'filter', filterId: 'provider', selectionPolicy: 'none' }),
    action('filter-status', '原生状态筛选', 's', { kind: 'filter', filterId: 'status', selectionPolicy: 'none' }),
    action('filter-named', '所有会话 / 仅命名', 'u', { kind: 'filter', filterId: 'named', selectionPolicy: 'none' }),
    action('filter-scope', '会话范围', 'b', { kind: 'filter', filterId: 'scope', selectionPolicy: 'none' }),
    action('adopt', '收编已有会话', 'a', { kind: 'form', mutation: true }),
    action('remove-member', '删除星册位', 'Ctrl+D', { kind: 'form', mutation: true }),
    action('native-guide', '原生工具指引', 'g', { kind: 'detail', viewId: 'native-guide' }),
    action('read-summary', '读取信息', 'i', { kind: 'detail', viewId: 'read-summary', selectionPolicy: 'none' }),
    action('copy-ref', '复制完整会话引用', 'Y', { kind: 'copy', copyKey: 'ref' }),
    action('deliveries', '相关投递记录', 'o', { enabled: false, unavailableReason: '相关投递记录尚未接入。', nextStep: '可在原生会话使用 crosschat status 查看已知投递元数据。' }),
    action('logs', '相关日志', 'l', { enabled: false, unavailableReason: '会话相关日志尚未接入。', nextStep: '可在原生终端查看 crosschat 日志。' }),
  ],
};

function unavailable(reason: string, nextStep = '请返回连接列表选择本机连接。'): TuiActionAvailability {
  return { enabled: false, reason, nextStep };
}

function json(value: unknown): string { return JSON.stringify(value, null, 2) ?? 'null'; }
function rawFacet(value: unknown): string { return JSON.stringify(value) ?? 'null'; }
function sourceError(contextId: string, message: string, kind: SourceError['kind'] = 'unavailable'): SourceError {
  return { source: { contextId, providerId: 'discovery' }, kind, message, nextStep: '检查对应工具来源后按 r 从第一页刷新。' };
}
function errorText(error: SourceError): string {
  return `${error.source.providerId}${error.source.path === undefined ? '' : ` / ${error.source.path}`} <${error.kind}>：${error.message}${error.nextStep === undefined ? '' : `\n下一步：${error.nextStep}`}`;
}
function addErrors(target: SourceError[], incoming: readonly SourceError[]): void {
  const seen = new Set(target.map((error) => JSON.stringify(error)));
  for (const error of incoming) if (!seen.has(JSON.stringify(error))) { target.push(error); seen.add(JSON.stringify(error)); }
}

function address(session: DiscoverySession, items: readonly DiscoverySession[], completeness: Completeness): { value?: string; unavailable?: TuiActionAvailability } {
  if (completeness !== 'complete') return { unavailable: unavailable('来源读取不完整，尚不能确认地址唯一。', '按 r 完整刷新；Y 可复制完整会话引用。') };
  if (session.ref.referenceKind === 'process') return { unavailable: unavailable('进程引用不能作为完整会话地址。', '在原生工具中核对会话身份；Y 可复制临时进程引用。') };
  if (!session.capabilities.delivery) return { unavailable: unavailable('此会话来源未声明投递能力。', '回到原生工具操作；Y 可复制完整会话引用。') };
  if (session.ref.providerId !== 'claude' && session.ref.providerId !== 'codex') return { unavailable: unavailable('此工具尚未声明现有本机发送地址能力。', '回到原生工具操作；Y 可复制完整会话引用。') };
  if (session.name !== null && session.name !== '') {
    if (items.filter((item) => item.name === session.name).length === 1) return { value: session.name };
    return { unavailable: unavailable('发现同名会话，裸名称地址有歧义。', '在原生工具核对身份并处理重名；Y 可复制完整会话引用。') };
  }
  if (session.ref.providerId === 'codex' && uuid.test(session.ref.nativeId)) {
    const value = `codex/${session.ref.nativeId}`;
    if (!items.some((item) => item.name === value)) return { value };
    return { unavailable: unavailable('完整 ID 地址与另一会话精确名称冲突。', '在原生工具核对并处理冲突；Y 可复制完整会话引用。') };
  }
  return { unavailable: unavailable('此匿名会话没有现有本机寻址支持。', '在原生工具确认身份与名称；Y 可复制完整会话引用。') };
}

/** Read-only discovery DTOs become UI data; provider and context execution stays outside the page. */
export function createSessionsResource(options: SessionsResourceOptions): { resource: TuiResource; adapter: TuiResourceAdapter } {
  const statuses = options.statusRegistry ?? createStatusRegistry();
  const guides = new Map<string, NativeSessionGuide>(Object.entries({ ...nativeGuides, ...options.nativeGuides }));
  const now = options.now ?? Date.now;
  const limit = options.pageSize ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Session page size must be between 1 and 1000.');

  function page(items: readonly DiscoverySession[], providers: readonly DiscoveryProvider[], completeness: Completeness, observedAt: number, errors: readonly SourceError[], contextId: string): TuiPage {
    const rows: TuiRow[] = items.map((item) => {
      const reference = json(item.ref);
      const target = address(item, items, completeness);
      const rowAvailability: Readonly<Record<string, TuiActionAvailability>> = target.unavailable ? { copy: target.unavailable } : {};
      const originalGuide = guides.get(item.ref.providerId)?.(item) ?? { title: `${item.ref.providerId} 原生操作`, fields: [{ label: '下一步', value: `此工具未登记专用操作指引，请回到 ${item.ref.providerId} 原生界面操作。` }] };
      return {
        id: sessionKey(item.ref), contextId, cells: { name: item.name || '匿名', provider: item.ref.providerId, status: statuses.format(item.ref.providerId, item.rawStatus), id: item.ref.referenceKind === 'process' ? `PID ${item.ref.nativeId}` : item.ref.nativeId, directory: typeof item.attributes.cwd === 'string' ? item.attributes.cwd : '—' },
        searchText: json(item), facets: { provider: item.ref.providerId, status: rawFacet(item.rawStatus), named: item.name ? 'named' : 'anonymous', scope: 'discovered' },
        detail: [{ label: '名称', value: item.name || '匿名' }, { label: '原生引用', value: reference }, { label: '原生状态', value: json(item.rawStatus) }, { label: '能力', value: json(item.capabilities) }, { label: '属性', value: json(item.attributes) }, { label: '采样时间', value: new Date(observedAt).toISOString() }],
        copyValues: { ref: reference }, ...(target.value === undefined ? {} : { copyValue: target.value }),
        actionAvailability: rowAvailability,
        detailViews: { 'native-guide': { ...originalGuide, fields: [...originalGuide.fields, { label: '寻址指引', value: target.value === undefined ? `${target.unavailable?.reason ?? '地址不可用'}\n${target.unavailable?.nextStep ?? ''}` : `本机完整地址：${target.value}\n本界面只复制地址，不代表该会话发送消息。` }, { label: '完整会话引用', value: reference }] } },
      };
    });
    const providerIds = [...new Set([...providers.map((provider) => provider.providerId), ...items.map((item) => item.ref.providerId)])].sort();
    const stateOptions = new Map<string, string>();
    for (const item of items) if (!stateOptions.has(rawFacet(item.rawStatus))) stateOptions.set(rawFacet(item.rawStatus), statuses.format(item.ref.providerId, item.rawStatus));
    return {
      rows, completeness, sampledAt: observedAt,
      notice: `${items.length} 个可发现会话（含匿名）；${completeness === 'complete' ? '读取完整' : completeness === 'cancelled' ? '读取已取消，结果不完整' : completeness === 'unavailable' ? '来源不可用' : '部分结果'}${errors.length ? `；${errors.length} 个来源问题，按 i 查看` : ''}。`,
      filters: [
        { id: 'provider', label: '工具', mode: 'select', defaultValue: '', options: [{ value: '', label: '所有工具' }, ...providerIds.map((providerId) => ({ value: providerId, label: providerId }))] },
        { id: 'status', label: '原生状态', mode: 'select', defaultValue: '', options: [{ value: '', label: '所有状态' }, ...[...stateOptions].map(([value, label]) => ({ value, label }))] },
        { id: 'named', label: '匿名', mode: 'toggle', defaultValue: '', options: [{ value: '', label: '所有会话（含匿名）' }, { value: 'named', label: '仅命名会话' }] },
      ],
      actionAvailability: { adopt: unavailable('当前尚未提供本机收编能力。', '可在原生终端使用现有 crosschat serve --connect <星> --adopt <名称>。'), 'remove-member': unavailable('当前页面没有已核实的星册位身份。', '请选择星上下文后核对目标册位；删除册位不会删除原生会话。'), 'filter-scope': unavailable('本机发现没有当前星范围。', '选择 TCP 星连接后可切换星内成员与节点发现范围。') },
      detailViews: { 'read-summary': { title: '会话读取信息', fields: [
        { label: '连接上下文', value: contextId }, { label: '完整性', value: completeness }, { label: '采样时间', value: new Date(observedAt).toISOString() },
        { label: '发现会话数', value: String(items.length) }, { label: 'Provider 能力', value: json(providers) },
        { label: '来源问题与下一步', value: errors.length ? errors.map(errorText).join('\n\n') : '无来源错误。' },
      ] } },
    };
  }

  const adapter: TuiResourceAdapter = {
    async read(request) {
      if (!request.context || request.context.kind !== 'local') return page([], [], 'unavailable', now(), [sourceError(request.context?.id ?? 'unselected', '请先选择本机上下文，未执行会话扫描。', 'unsupported')], request.context?.id ?? 'unselected');
      const contextId = request.context.id;
      if (request.signal.aborted) return page([], [], 'cancelled', now(), [], contextId);
      const items = new Map<string, DiscoverySession>();
      const providers = new Map<string, DiscoveryProvider>();
      const errors: SourceError[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      let observedAt = now();
      let completeness: Completeness = 'complete';
      for (;;) {
        if (request.signal.aborted) { completeness = 'cancelled'; break; }
        try {
          const result = parseDiscoveryResponse(await untilAborted(options.discovery.execute({ op: 'list', ...(cursor === undefined ? {} : { cursor }), limit }, { contextId, signal: request.signal }), request.signal));
          if (result.op !== 'list' || result.page.items.some((item) => item.ref.contextId !== contextId)) throw new Error('Wrong discovery scope.');
          const current = result.page;
          observedAt = current.observedAt;
          for (const provider of result.providers) providers.set(provider.providerId, provider);
          for (const item of current.items) items.set(sessionKey(item.ref), item);
          addErrors(errors, current.errors);
          if (request.signal.aborted || current.completeness === 'cancelled') { completeness = 'cancelled'; break; }
          if (current.nextCursor === null || current.completeness === 'unavailable') {
            completeness = current.completeness === 'complete' && errors.length ? 'partial' : current.completeness;
            if (completeness === 'unavailable' && items.size > 0) completeness = 'partial';
            break;
          }
          if (seen.has(current.nextCursor)) {
            errors.push(sourceError(contextId, '会话来源返回重复分页游标，已停止读取。', 'malformed'));
            completeness = 'partial'; break;
          }
          seen.add(current.nextCursor);
          cursor = current.nextCursor;
        } catch {
          if (request.signal.aborted) completeness = 'cancelled';
          else { errors.push(sourceError(contextId, '会话来源无法读取或返回了无效的发现结果。', 'malformed')); completeness = items.size ? 'partial' : 'unavailable'; }
          break;
        }
      }
      return page([...items.values()], [...providers.values()], completeness, observedAt, errors, contextId);
    },
  };
  return { resource, adapter };
}
