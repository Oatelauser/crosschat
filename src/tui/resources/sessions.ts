import { parseDiscoveryResponse } from '../../application/discovery/index.js';
import type { DiscoveryEndpoint, DiscoveryProvider, DiscoverySession } from '../../application/discovery/index.js';
import { sessionKey } from '../../application/sessions/model.js';
import type { Completeness, SourceError } from '../../application/sessions/model.js';
import { untilAborted } from '../../application/sessions/reading.js';
import { resolveTargetByName } from '../../resolve.js';
import type { MembershipRequest, MembershipTargets, SessionMembershipService } from '../../application/session-membership/index.js';
import type { TuiAction, TuiActionAvailability, TuiActionRequest, TuiFormField, TuiPage, TuiReadonlyView, TuiResource, TuiResourceAdapter, TuiRow } from '../model.js';
import { createStatusRegistry } from './status.js';
import type { StatusRegistry } from './status.js';

export type NativeSessionGuide = (session: DiscoverySession) => TuiReadonlyView;
export interface SessionsResourceOptions {
  discovery: DiscoveryEndpoint;
  statusRegistry?: StatusRegistry;
  nativeGuides?: Readonly<Record<string, NativeSessionGuide>>;
  membership?: SessionMembershipService;
  pageSize?: number;
  now?: () => number;
  /** Links are available only when their readonly resources are installed. */
  relatedResources?: readonly ('deliveries' | 'logs')[];
  /** A context adapter supplies matching discovery; the default stays local-only. */
  contextKinds?: readonly string[];
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
function hasTerminalControls(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || (code >= 127 && code <= 159);
  });
}
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
  // Discovery reads all pages, whereas the existing local send selector sees
  // only the first 20 Codex entries in source order. Do not widen that contract.
  if (session.ref.providerId === 'codex' && items.filter((item) => item.ref.providerId === 'codex').findIndex((item) => sessionKey(item.ref) === sessionKey(session.ref)) >= 20) {
    return { unavailable: unavailable('此会话超出现有本机发送的 Codex 20 条选择范围。', 'Y 可复制完整会话引用；在原生工具核对目标，收编可使用精确会话引用。') };
  }
  if (session.name !== null && session.name !== '') {
    if (hasTerminalControls(session.name)) return { unavailable: unavailable('会话名称包含终端控制字符，不能作为可粘贴地址。', '请在原生工具更名或核对身份；Y 可复制安全编码的完整会话引用。') };
    if (items.filter((item) => item.name === session.name).length === 1) return { value: session.name };
  }
  if (session.ref.providerId === 'codex' && uuid.test(session.ref.nativeId)) {
    const value = `codex/${session.ref.nativeId}`;
    try {
      const resolved = resolveTargetByName(value,
        items.filter((item) => item.ref.providerId === 'claude' && item.ref.referenceKind !== 'process').map((item) => ({ sessionId: item.ref.nativeId, name: item.name ?? undefined })),
        items.filter((item) => item.ref.providerId === 'codex').map((item) => ({ id: item.ref.nativeId, name: item.name })));
      if (resolved.side === 'codex' && resolved.thread.id === session.ref.nativeId) return { value };
    } catch { /* Names and their prefixes precede UUID matching in the selector. */ }
    return { unavailable: unavailable('完整 ID 地址与现有名称或名称前缀匹配冲突。', '在原生工具核对并处理冲突；Y 可复制完整会话引用。') };
  }
  if (session.name) return { unavailable: unavailable('发现同名会话，裸名称地址有歧义。', '在原生工具核对身份并处理重名；Y 可复制完整会话引用。') };
  return { unavailable: unavailable('此匿名会话没有现有本机寻址支持。', '在原生工具确认身份与名称；Y 可复制完整会话引用。') };
}

/** Read-only discovery DTOs become UI data; provider and context execution stays outside the page. */
export function createSessionsResource(options: SessionsResourceOptions): { resource: TuiResource; adapter: TuiResourceAdapter } {
  const related = new Set(options.relatedResources ?? []);
  const activeResource: TuiResource = { ...resource, actions: resource.actions.map((entry) => (entry.id === 'deliveries' || entry.id === 'logs') && related.has(entry.id)
    ? { ...entry, kind: 'navigate', enabled: true, unavailableReason: undefined, nextStep: undefined } : entry) };
  const statuses = options.statusRegistry ?? createStatusRegistry();
  const guides = new Map<string, NativeSessionGuide>(Object.entries({ ...nativeGuides, ...options.nativeGuides }));
  const now = options.now ?? Date.now;
  const limit = options.pageSize ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Session page size must be between 1 and 1000.');

  async function targets(contextId: string, signal: AbortSignal): Promise<MembershipTargets | undefined> {
    if (!options.membership || signal.aborted) return undefined;
    try { return await untilAborted(options.membership.listTargets({ contextId, signal }), signal); }
    catch {
      return { stars: [], completeness: signal.aborted ? 'cancelled' : 'unavailable', observedAt: now(), errors: signal.aborted ? [] : [sourceError(contextId, '无法读取本机已配置的目标星；未执行任何星管理请求。')] };
    }
  }

  function membershipFields(configured: MembershipTargets): readonly TuiFormField[] {
    const enabled = configured.stars.filter((star) => star.eligible);
    return [{ id: 'starId', label: '目标星', required: true, initialValue: enabled.length === 1 ? enabled[0].id : '', options: [
      ...(enabled.length === 1 ? [] : [{ value: '', label: '请选择目标星', enabled: true }]),
      ...configured.stars.map((star) => ({ value: star.id, label: star.label, enabled: star.eligible, ...(star.reason ? { reason: star.reason } : {}) })),
    ] }];
  }

  function membershipAvailability(configured?: MembershipTargets): TuiActionAvailability {
    if (!options.membership) return unavailable('当前尚未提供本机册位操作能力。', '可在原生终端使用已有 crosschat serve 命令管理已知星册位。');
    if (!configured?.stars.some((star) => star.eligible)) return unavailable('没有身份完整且可选择的已配置星。', '先核对本机 TCP 星配置；按 r 刷新，i 可查看读取原因。');
    return { enabled: true, fields: membershipFields(configured), impact: ['只操作明确选中的星册位；不结束、删除或代替原生会话聊天。'] };
  }

  function membershipRequest(request: TuiActionRequest): MembershipRequest | undefined {
    if (!request.context || request.context.kind !== 'local' || request.action.ownerResourceId !== 'sessions' || !['adopt', 'remove-member'].includes(request.action.id) || !request.target?.copyValues?.ref) return undefined;
    try {
      const ref: unknown = JSON.parse(request.target.copyValues.ref);
      if (typeof ref !== 'object' || ref === null || Array.isArray(ref)
        || !('contextId' in ref) || ref.contextId !== request.context.id
        || !('providerId' in ref) || typeof ref.providerId !== 'string' || !ref.providerId
        || !('nativeId' in ref) || typeof ref.nativeId !== 'string' || !ref.nativeId
        || ('referenceKind' in ref && ref.referenceKind !== 'native')
        || Object.keys(ref).some((key) => !['contextId', 'providerId', 'nativeId', 'referenceKind'].includes(key))) return undefined;
      const exactRef = { contextId: request.context.id, providerId: ref.providerId, nativeId: ref.nativeId, ...('referenceKind' in ref ? { referenceKind: 'native' as const } : {}) };
      if (request.target.id !== sessionKey(exactRef)) return undefined;
      return { op: request.action.id === 'adopt' ? 'adopt' : 'remove', ref: exactRef, starId: request.values.starId ?? '', signal: request.signal };
    } catch { return undefined; }
  }

  function page(items: readonly DiscoverySession[], providers: readonly DiscoveryProvider[], completeness: Completeness, observedAt: number, errors: readonly SourceError[], contextId: string, configured?: MembershipTargets): TuiPage {
    const rows: TuiRow[] = items.map((item) => {
      const reference = json(item.ref);
      const target = address(item, items, completeness);
      const rowAvailability: Record<string, TuiActionAvailability> = target.unavailable ? { copy: target.unavailable } : {};
      if (item.ref.referenceKind === 'process') {
        rowAvailability.adopt = rowAvailability['remove-member'] = unavailable('临时进程引用没有核实的原生会话 ID，不能修改星册位。', '在原生工具确认完整会话身份后刷新。');
        rowAvailability.deliveries = rowAvailability.logs = unavailable('临时进程引用不能精确关联传输记录。', '在原生工具确认完整会话身份后刷新。');
      }
      const originalGuide = guides.get(item.ref.providerId)?.(item) ?? { title: `${item.ref.providerId} 原生操作`, fields: [{ label: '下一步', value: `此工具未登记专用操作指引，请回到 ${item.ref.providerId} 原生界面操作。` }] };
      return {
        id: sessionKey(item.ref), contextId, cells: { name: item.name || '匿名', provider: item.ref.providerId, status: statuses.format(item.ref.providerId, item.rawStatus), id: item.ref.referenceKind === 'process' ? `PID ${item.ref.nativeId}` : item.ref.nativeId, directory: typeof item.attributes.cwd === 'string' ? item.attributes.cwd : '—' },
        searchText: json(item), facets: { provider: item.ref.providerId, status: rawFacet(item.rawStatus), named: item.name ? 'named' : 'anonymous', scope: 'discovered' },
        detail: [{ label: '名称', value: item.name || '匿名' }, { label: '原生引用', value: reference }, { label: '原生状态', value: json(item.rawStatus) }, { label: '能力', value: json(item.capabilities) }, { label: '属性', value: json(item.attributes) }, { label: '采样时间', value: new Date(observedAt).toISOString() }],
        copyValues: { ref: reference }, ...(target.value === undefined ? {} : { copyValue: target.value }),
        actionAvailability: rowAvailability,
        actionRoutes: item.ref.referenceKind === 'process' ? undefined : Object.fromEntries([...related].map((id) => [id, { resourceId: id, contextId, query: { sessionRef: reference, ...(id === 'logs' ? { source: 'send-log' } : {}) } }])),
        detailViews: { 'native-guide': { ...originalGuide, fields: [...originalGuide.fields, { label: '寻址指引', value: target.value === undefined ? `${target.unavailable?.reason ?? '地址不可用'}\n${target.unavailable?.nextStep ?? ''}` : `本机完整地址：${target.value}\n本界面只复制地址，不代表该会话发送消息。` }, { label: '完整会话引用', value: reference }] } },
      };
    });
    const providerIds = [...new Set([...providers.map((provider) => provider.providerId), ...items.map((item) => item.ref.providerId)])].sort();
    const stateOptions = new Map<string, string>();
    for (const item of items) if (!stateOptions.has(rawFacet(item.rawStatus))) stateOptions.set(rawFacet(item.rawStatus), statuses.format(item.ref.providerId, item.rawStatus));
    const allErrors = [...errors];
    addErrors(allErrors, configured?.errors ?? []);
    const overall = completeness === 'complete' && configured !== undefined && configured.completeness !== 'complete' ? 'partial' : completeness;
    return {
      rows, completeness: overall, sampledAt: observedAt,
      notice: `${items.length} 个可发现会话（含匿名）；${overall === 'complete' ? '读取完整' : overall === 'cancelled' ? '读取已取消，结果不完整' : overall === 'unavailable' ? '来源不可用' : '部分结果'}${allErrors.length ? `；${allErrors.length} 个来源问题，按 i 查看` : ''}。`,
      filters: [
        { id: 'provider', label: '工具', mode: 'select', defaultValue: '', options: [{ value: '', label: '所有工具' }, ...providerIds.map((providerId) => ({ value: providerId, label: providerId }))] },
        { id: 'status', label: '原生状态', mode: 'select', defaultValue: '', options: [{ value: '', label: '所有状态' }, ...[...stateOptions].map(([value, label]) => ({ value, label }))] },
        { id: 'named', label: '匿名', mode: 'toggle', defaultValue: '', options: [{ value: '', label: '所有会话（含匿名）' }, { value: 'named', label: '仅命名会话' }] },
      ],
      actionAvailability: { adopt: membershipAvailability(configured), 'remove-member': membershipAvailability(configured), 'filter-scope': unavailable('本机发现没有当前星范围。', '选择 TCP 星连接后可切换星内成员与节点发现范围。') },
      detailViews: { 'read-summary': { title: '会话读取信息', fields: [
        { label: '连接上下文', value: contextId }, { label: '完整性', value: overall }, { label: '会话发现完整性', value: completeness }, { label: '采样时间', value: new Date(observedAt).toISOString() },
        { label: '发现会话数', value: String(items.length) }, { label: 'Provider 能力', value: json(providers) },
        ...(configured === undefined ? [] : [{ label: '已配置目标星（未连接核验册位）', value: json(configured.stars) }]),
        { label: '来源问题与下一步', value: allErrors.length ? allErrors.map(errorText).join('\n\n') : '无来源错误。' },
      ] } },
    };
  }

  const adapter: TuiResourceAdapter = {
    async read(request) {
      if (!request.context || !(options.contextKinds ?? ['local']).includes(request.context.kind)) return page([], [], 'unavailable', now(), [sourceError(request.context?.id ?? 'unselected', '所选上下文未接入此会话来源，未执行会话扫描。', 'unsupported')], request.context?.id ?? 'unselected');
      const contextId = request.context.id;
      if (request.signal.aborted) return page([], [], 'cancelled', now(), [], contextId);
      const configured = targets(contextId, request.signal);
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
      const targetPage = await configured;
      return page([...items.values()], [...providers.values()], request.signal.aborted ? 'cancelled' : completeness, observedAt, errors, contextId, targetPage);
    },
    async checkAction(request) {
      const exact = membershipRequest(request);
      if (!exact || !options.membership || request.signal.aborted) return unavailable('当前目标没有可核实的本机完整会话身份。', '请回到本机会话列表刷新并重新选择。');
      const configured = await targets(exact.ref.contextId, request.signal);
      const availability = membershipAvailability(configured);
      if (!availability.enabled || !configured) return availability;
      if (!exact.starId) return availability;
      if (!configured.stars.some((star) => star.id === exact.starId && star.eligible)) return { ...availability, enabled: false, reason: '所选星已不可用或身份发生变化。', nextStep: '核对目标星配置后重新选择。' };
      const checked = await untilAborted(options.membership.check(exact), request.signal);
      return { enabled: checked.allowed, fields: availability.fields, reason: checked.reason, nextStep: checked.nextStep, impact: [
        `完整会话引用：${json(exact.ref)}`, `目标星：${configured.stars.find((star) => star.id === exact.starId)?.label ?? ''}（${exact.starId}）`, ...(checked.impact ?? []),
      ] };
    },
    async mutate(request) {
      const exact = membershipRequest(request);
      if (!exact || !exact.starId || !options.membership || request.signal.aborted) throw new Error('目标身份或目标星无效，未执行册位操作。');
      const configured = await targets(exact.ref.contextId, request.signal);
      if (!configured?.stars.some((star) => star.id === exact.starId && star.eligible)) throw new Error('所选星已不可用或身份发生变化，未执行册位操作。');
      const result = await options.membership.apply(exact);
      if (result.kind !== 'applied') throw new Error(result.message);
      return { selectedId: request.target?.id, message: result.message };
    },
  };
  return { resource: activeResource, adapter };
}
