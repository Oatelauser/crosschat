import type { TcpApplication, TcpCredential, TcpMember, TcpReadResult, TcpRole, TcpSession, TcpStar, TcpStarResult } from '../../application/tcp/model.js';
import type { TcpManagement, TcpManagementAction, TcpManagementRequest, TcpManagementSecret } from '../../application/tcp/management.js';
import { isRecord, untilAborted } from '../../application/sessions/reading.js';
import type { TuiAction, TuiActionAvailability, TuiActionRequest, TuiColumn, TuiField, TuiFilter, TuiMutationResult, TuiPage, TuiReadRequest, TuiReadonlyView, TuiResource, TuiResourceAdapter, TuiRoute, TuiRow, TuiSensitiveResult } from '../model.js';
import { createStatusRegistry } from './status.js';
import type { StatusRegistry } from './status.js';

export interface TcpResourcesOptions { tcp: TcpApplication; management?: TcpManagement; statusRegistry?: StatusRegistry }
type ResourceId = 'stars' | 'machines' | 'members' | 'keys' | 'sessions';
interface ResourceBinding { resource: TuiResource; adapter: TuiResourceAdapter }
interface RowTarget { rowId: string; targetId: string; starId: string; revision?: string }
const roleLabels: Record<TcpRole, string> = { 'broker-owner': '本机 broker 主', 'star-admin': '星管理员', member: '普通成员' };
const presenceLabels = { online: '在线', offline: '下线', unknown: '未知' };
const mutationActions = new Set<TcpManagementAction>(['add-star', 'rename-star', 'remove-star', 'set-show-name', 'generate-node-key', 'generate-admin-key', 'remove-node', 'revoke-credential', 'remove-member', 'adopt-session']);
const json = (value: unknown): string => JSON.stringify(value, null, 2) ?? 'null';
const disabled = (reason: string, nextStep = '核对所选星与本次权限；在对应资源列表重新开始。'): TuiActionAvailability => ({ enabled: false, reason, nextStep });
const currentPresence = (presence: keyof typeof presenceLabels): string => `${presenceLabels[presence]}<${presence}>`;
function action(ownerResourceId: ResourceId, id: string, label: string, shortcut: string, kind: TuiAction['kind'], extra: Partial<TuiAction> = {}): TuiAction {
  return { id, label, shortcut, kind, ownerResourceId, selectionPolicy: 'required', mutation: false, returnPolicy: 'restore', ...extra };
}
function mutation(owner: ResourceId, id: TcpManagementAction, label: string, shortcut: string, none = false): TuiAction {
  return action(owner, id, label, shortcut, 'form', { mutation: true, selectionPolicy: none ? 'none' : 'required', ...(id === 'add-star' ? { returnPolicy: 'select-result' } : {}) });
}
function infoAction(owner: ResourceId): TuiAction { return action(owner, 'info', '读取信息', 'i', 'detail', { selectionPolicy: 'none', viewId: 'info' }); }
function detailAction(owner: ResourceId, shortcut = 'Enter / d'): TuiAction { return action(owner, 'detail', '只读详情', shortcut, 'detail'); }
function copyAction(owner: ResourceId, label: string): TuiAction { return action(owner, 'copy', label, 'y', 'copy'); }
const columns: Record<ResourceId, readonly TuiColumn[]> = {
  stars: [{ id: 'name', label: '星名', width: 24, priority: 100 }, { id: 'starId', label: 'starId', width: 14, priority: 70 }, { id: 'nodes', label: '在线节点', width: 12, priority: 90 }, { id: 'health', label: '读取状态', width: 26, priority: 80 }],
  machines: [{ id: 'name', label: '节点名称', width: 26, priority: 100 }, { id: 'mid8', label: 'mid8', width: 8, priority: 95 }, { id: 'presence', label: '机器连接', width: 20, priority: 90 }, { id: 'online', label: '在线册位', width: 12, priority: 70 }, { id: 'offline', label: '下线册位', width: 12, priority: 65 }],
  members: [{ id: 'name', label: '名称', width: 24, priority: 100 }, { id: 'provider', label: '工具', width: 12, priority: 80 }, { id: 'machine', label: '所属节点', width: 26, priority: 90 }, { id: 'presence', label: '星籍状态', width: 20, priority: 95 }, { id: 'succession', label: '接任关系', width: 26, priority: 60 }],
  keys: [{ id: 'name', label: '凭证 label', width: 24, priority: 100 }, { id: 'kind', label: '凭证用途', width: 18, priority: 95 }, { id: 'machine', label: '绑定节点', width: 26, priority: 90 }, { id: 'mid8', label: 'mid8', width: 8, priority: 80 }, { id: 'addedAt', label: '登记时间', width: 24, priority: 60 }],
  sessions: [{ id: 'name', label: '名称', width: 24, priority: 100 }, { id: 'provider', label: '工具', width: 12, priority: 80 }, { id: 'machine', label: '所属节点', width: 26, priority: 95 }, { id: 'mid8', label: 'mid8', width: 8, priority: 90 }, { id: 'status', label: '原生状态', width: 26, priority: 85 }, { id: 'membership', label: '星籍', width: 24, priority: 88 }, { id: 'directory', label: '目录', width: 28, priority: 40 }],
};
function definitions(owner: ResourceId, nodeSessions = false): readonly TuiAction[] {
  if (owner === 'stars') return [action(owner, 'open', '进入星的节点列表', 'Enter', 'navigate'), detailAction(owner, 'd'), mutation(owner, 'add-star', '新增星', 'a', true), mutation(owner, 'rename-star', '修改星名', 'e'), mutation(owner, 'remove-star', '删除星', 'Ctrl+D'), action(owner, 'keys', '接入凭证', 'p', 'navigate'), action(owner, 'logs', 'broker 管理审计', 'l', 'navigate'), copyAction(owner, '复制完整 starId'), infoAction(owner)];
  if (owner === 'machines') return [action(owner, 'open', '进入节点会话', 'Enter', 'navigate'), detailAction(owner, 'd'), action(owner, 'sessions', '全星会话', 'v', 'navigate', { selectionPolicy: 'none' }), mutation(owner, 'generate-node-key', '让新机器接入', 'a', true), mutation(owner, 'set-show-name', '修改当前本机显示名', 'e', true), mutation(owner, 'remove-node', '移除所选节点', 'Ctrl+D'), action(owner, 'members', '成员册', 'm', 'navigate', { selectionPolicy: 'none' }), action(owner, 'keys', '接入凭证', 'p', 'navigate', { selectionPolicy: 'none' }), action(owner, 'logs', '节点 crosschat 日志', 'l', 'navigate'), copyAction(owner, '复制完整机器标识'), infoAction(owner)];
  if (owner === 'keys') return [detailAction(owner), mutation(owner, 'generate-node-key', '发节点钥匙', 'a', true), mutation(owner, 'generate-admin-key', '发星管理钥', 'A', true), mutation(owner, 'revoke-credential', '撤销所选凭证', 'Ctrl+D'), copyAction(owner, '复制凭证 label'), infoAction(owner)];
  const provider = action(owner, 'filter-provider', '工具筛选', 't', 'filter', { filterId: 'provider', selectionPolicy: 'none' });
  const named = action(owner, 'filter-named', '所有会话 / 仅命名', 'u', 'filter', { filterId: 'named', selectionPolicy: 'none' });
  if (owner === 'members') return [detailAction(owner), mutation(owner, 'adopt-session', '收编本机现有会话', 'a', true), mutation(owner, 'remove-member', '删除所选册位', 'Ctrl+D'), provider, named, action(owner, 'filter-presence', '星籍状态筛选', 's', 'filter', { filterId: 'presence', selectionPolicy: 'none' }), copyAction(owner, '复制可用成员地址'), infoAction(owner)];
  return [nodeSessions ? detailAction(owner) : action(owner, 'open', '进入所属节点会话', 'Enter', 'navigate'), ...(!nodeSessions ? [detailAction(owner, 'd')] : []),
    action(owner, 'machines', '切回节点列表', 'v', 'navigate', { selectionPolicy: 'none' }), action(owner, 'scope', '星内成员 / 可发现会话', 'b', 'route-choice', { selectionPolicy: 'none' }), provider, named,
    action(owner, 'filter-status', '原生状态筛选', 's', 'filter', { filterId: 'status', selectionPolicy: 'none' }), mutation(owner, 'adopt-session', '收编本机现有会话', 'a', true), mutation(owner, 'remove-member', '删除所选册位', 'Ctrl+D'),
    action(owner, 'deliveries', '本机已知的相关投递', 'o', 'navigate'), action(owner, 'guide', '原生工具 / 寻址指引', 'g', 'detail', { viewId: 'guide' }), action(owner, 'logs', '相关 crosschat 日志', 'l', 'navigate'), copyAction(owner, '复制可用会话地址'),
    action(owner, 'copy-ref', '复制完整会话引用', 'Y', 'copy', { copyKey: 'ref' }), infoAction(owner)];
}
function route(resourceId: ResourceId | 'logs', contextId: string, starId?: string, extra: Record<string, string> = {}): TuiRoute {
  return { resourceId, contextId, query: { ...(starId ? { starId } : {}), ...extra } };
}
function valid(request: TuiReadRequest, owner: ResourceId): boolean {
  if (!request.context || !['local', 'tcp'].includes(request.context.kind) || (request.context.kind === 'local' && request.context.id !== 'local')
    || (request.route?.resourceId !== undefined && request.route.resourceId !== owner) || (request.route?.contextId !== undefined && request.route.contextId !== request.context.id)) return false;
  const query = request.route?.query ?? {};
  const allowed = owner === 'stars' ? [] : owner === 'sessions' ? ['starId', 'machineId', 'scope'] : ['starId'];
  return !Object.keys(query).some((key) => !allowed.includes(key)) && !Object.values(query).some((value) => !value || value.length > 65_536)
    && (query.scope === undefined || query.scope === 'members' || query.scope === 'discoverable');
}
function invalid(message: string, cancelled = false): TuiPage {
  return { rows: [], completeness: cancelled ? 'cancelled' : 'unavailable', notice: message,
    detailViews: { info: { title: 'TCP 读取信息', fields: [{ label: '原因', value: message }, { label: '下一步', value: '从 :ctx 或 :stars 重新选择明确的星；不会回落读取或修改其他上下文。' }] } } };
}
function readInfo(result: TcpReadResult, additional: readonly TuiField[] = []): TuiReadonlyView {
  return { title: 'TCP 读取信息', fields: [{ label: '连接上下文', value: result.contextId }, { label: '完整性', value: result.completeness }, { label: '采样时间', value: new Date(result.observedAt).toISOString() }, ...additional,
    { label: '来源与下一步', value: result.errors.length ? result.errors.map((error) => `${error.source} <${error.kind}>：${error.message}\n${error.nextStep}`).join('\n\n') : '无来源错误。' }] };
}
function target(rowId: string, targetId: string, starId: string, revision?: string): string { return json({ rowId, targetId, starId, ...(revision ? { revision } : {}) }); }
function memberDetails(member: TcpMember): TuiField[] {
  return [{ label: '完整册位标识', value: member.id }, { label: '星标识', value: member.starId }, { label: '完整机器标识', value: member.machineId }, { label: '所属节点', value: member.machineName ?? '未提供' },
    { label: '完整原生 ID', value: member.nativeId }, { label: '工具来源', value: member.providerId ?? '未提供' }, { label: '星籍状态', value: currentPresence(member.presence) }, { label: '临时册位', value: member.temporary ? '是' : '否' },
    { label: '接任旧名', value: member.extendsName ?? '未声明' }, { label: '旧名归属机器', value: member.extendsMachine ?? '未提供' }, { label: '原生状态', value: '成员册不提供原生忙闲；星籍在线不代表 idle/busy。' }];
}
function credentialDetails(item: TcpCredential): TuiField[] {
  return [{ label: '完整凭证标识', value: item.id }, { label: 'label', value: item.label }, { label: '用途', value: item.kind === 'admin' ? '星管理钥' : '节点钥匙' }, { label: '目标星', value: item.starId },
    { label: '绑定机器', value: item.machineId ?? '尚未绑定' }, { label: '节点名称', value: item.machineName ?? '未提供' }, { label: '登记时间', value: item.addedAt }, { label: '秘密', value: '列表与详情不回显 key/adminKey；仅显式发钥结果提供一次性材料。' }];
}
function copyAvailability(address?: string, reason?: string): Record<string, TuiActionAvailability> {
  return address ? {} : { copy: disabled(reason ?? '此条记录没有可核实的现有发送地址。', '使用完整标识在对应原生工具核对身份；不把裸名称或短 ID 当成唯一地址。') };
}
function groupPresence<T extends { presence: keyof typeof presenceLabels }>(items: readonly T[]): T[] {
  const order = { online: 0, offline: 1, unknown: 2 };
  return items.toSorted((left, right) => order[left.presence] - order[right.presence]);
}
function refreshPause(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, 2000);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}
function filters(items: readonly { providerId: string | null; name: string | null }[], presence = false): TuiFilter[] {
  return [
    { id: 'provider', label: '工具', mode: 'select', defaultValue: '', options: [{ value: '', label: '所有工具' }, ...[...new Set(items.flatMap((item) => item.providerId === null ? [] : [item.providerId]))].sort().map((providerId) => ({ value: providerId, label: providerId }))] },
    { id: 'named', label: '匿名', mode: 'toggle', defaultValue: '', options: [{ value: '', label: '所有会话（含匿名）' }, { value: 'named', label: '仅命名会话' }] },
    ...(presence ? [{ id: 'presence', label: '星籍状态', mode: 'select' as const, defaultValue: '', options: [{ value: '', label: '全部星籍状态' }, ...Object.entries(presenceLabels).map(([value, label]) => ({ value, label }))] }] : []),
  ];
}
function roleAvailability(role: TcpRole | null, entries: readonly TuiAction[], management: boolean, local: boolean): Record<string, TuiActionAvailability> {
  return Object.fromEntries(entries.filter((entry) => entry.mutation).map((entry) => {
    if (!management) return [entry.id, disabled('当前未提供此星的管理应用接口。')];
    if (role === null) return [entry.id, disabled('尚未取得当前星的有效权限与完整身份。')];
    const ownerOnly = ['add-star', 'rename-star', 'remove-star', 'set-show-name', 'generate-admin-key'].includes(entry.id);
    if (ownerOnly && (role !== 'broker-owner' || !local)) return [entry.id, disabled('此操作需要 broker 所在机器的本机管理权限。', '切到 broker 本机上下文；SSH 管理尚未提供，不能用当前星管理钥代替。')];
    if (role === 'member' && ['generate-node-key', 'remove-node', 'revoke-credential'].includes(entry.id)) return [entry.id, disabled('普通成员没有发钥或撤销节点凭证的权限。', '请在本星星管理员或 broker 主上下文操作。')];
    return [entry.id, { enabled: true }];
  }));
}
function sensitiveResult(secret: TcpManagementSecret): TuiSensitiveResult {
  const fields: TuiField[] = [];
  const copies: TuiSensitiveResult['copies'][number][] = [];
  secret.materials.forEach((item, index) => {
    const shortcut = index === 0 ? 'y' : index === 9 ? '0' : String(index + 1);
    fields.push({ label: `第${index + 1}份 · ${item.label}`, value: item.content });
    copies.push({ id: `configuration-${index + 1}`, label: `复制第${index + 1}份配置 · ${item.label}`, shortcut, value: item.content });
    if (item.connectCommand) fields.push({ label: `第${index + 1}份启动指引`, value: item.connectCommand });
    if (index === 0 && item.connectCommand) copies.push({ id: 'connect-command', label: '复制启动命令（在目标机器核对配置后执行）', shortcut: 'c', value: item.connectCommand });
  });
  fields.push({ label: '执行边界', value: '把每份配置分别交给对应机器；本界面不安装远端配置、不启动原生会话，也不把发钥回执当作机器已经上线。' });
  return { title: secret.title, fields, copies, notice: `${secret.notice}\nEsc/Ctrl+C 隐藏并清屏；离开后无法从普通列表再次查看。OS 剪贴板中的副本需自行覆盖。` };
}

/** Declarative TCP lists consume safe application DTOs and keep writes at the fixed list owner. */
export function createTcpResources(options: TcpResourcesOptions): Record<ResourceId, ResourceBinding> {
  const statuses = options.statusRegistry ?? createStatusRegistry();
  function binding(owner: ResourceId): ResourceBinding {
    const resource: TuiResource = { id: owner, label: { stars: '星', machines: '星内节点', sessions: '会话', members: '成员册', keys: '接入凭证' }[owner], aliases: { stars: ['star'], machines: ['nodes'], sessions: ['session'], members: ['roster'], keys: ['credentials', 'node-keys'] }[owner], description: '明确连接上下文的 TCP 星资源与列表操作', columns: columns[owner], actions: definitions(owner) };
    let generation = 0;
    let accepted: { key: string; revision: string } | undefined;
    function managementRequest(request: TuiActionRequest): TcpManagementRequest | undefined {
      const selected: TuiReadRequest = { context: request.context, route: request.route, signal: request.signal };
      if (!valid(selected, owner) || request.action.ownerResourceId !== owner || !mutationActions.has(request.action.id as TcpManagementAction)
        || !definitions(owner).some((entry) => entry.id === request.action.id && entry.mutation)) return undefined;
      let rowTarget: RowTarget | undefined;
      if (request.action.selectionPolicy !== 'none') {
        try {
          const value: unknown = JSON.parse(request.target?.copyValues?.target ?? '');
          if (!isRecord(value) || typeof value.rowId !== 'string' || value.rowId !== request.target?.id || typeof value.targetId !== 'string' || !value.targetId || typeof value.starId !== 'string' || !value.starId
            || (value.revision !== undefined && typeof value.revision !== 'string') || Object.keys(value).some((key) => !['rowId', 'targetId', 'starId', 'revision'].includes(key))) return undefined;
          rowTarget = { rowId: value.rowId, targetId: value.targetId, starId: value.starId, ...(typeof value.revision === 'string' ? { revision: value.revision } : {}) };
        } catch { return undefined; }
      }
      const starId = request.route?.query?.starId ?? rowTarget?.starId;
      if (rowTarget && starId !== rowTarget.starId) return undefined;
      return { contextId: request.context!.id, action: request.action.id as TcpManagementAction, ...(starId ? { starId } : {}), ...(rowTarget ? { targetId: rowTarget.targetId, ...(rowTarget.revision ? { targetRevision: rowTarget.revision } : {}) } : {}), values: { ...request.values }, signal: request.signal };
    }
    const operationKey = (request: TcpManagementRequest): string => JSON.stringify([request.contextId, owner, request.action, request.starId ?? null, request.targetId ?? null, request.targetRevision ?? null, Object.entries(request.values).sort(([left], [right]) => left.localeCompare(right))]);
    const adapter: TuiResourceAdapter = {
      async read(request) {
        generation++; accepted = undefined;
        if (!valid(request, owner)) return invalid('TCP 连接或资源范围无效；未执行查询。');
        if (request.signal.aborted) return invalid('TCP 读取已取消。', true);
        const contextId = request.context!.id;
        const query = request.route?.query ?? {};
        const local = request.context!.kind === 'local';
        try {
          if (owner === 'stars') {
            const result = await untilAborted(options.tcp.readStars({ contextId, signal: request.signal }), request.signal);
            if (request.signal.aborted) return invalid('TCP 读取已取消。', true);
            if (result.contextId !== contextId || result.items.some((item) => item.contextId !== contextId)) return invalid('星来源返回了其他连接的结果，已拒绝显示。');
            const entries = definitions(owner);
            return { rows: result.items.map((item) => ({ id: item.id, contextId, cells: { name: item.name ?? '未命名', starId: item.starId, nodes: item.onlineNodes === null ? '未知' : String(item.onlineNodes), health: item.health === 'reachable' ? '可读取<reachable>' : item.health === 'unavailable' ? '不可达<unavailable>' : '尚未核实<unknown>' },
              copyValue: item.starId, copyValues: { target: target(item.id, item.id, item.starId, item.revision) }, searchText: `${item.name ?? ''} ${item.starId} ${item.host} ${item.port}`,
              detail: [{ label: '星名', value: item.name ?? '未命名' }, { label: '完整 starId', value: item.starId }, { label: 'broker 地址', value: `${item.host}:${item.port}` }, { label: '本次权限', value: roleLabels[item.role] }, { label: '读取状态', value: item.health }],
              actionRoutes: { open: route('machines', contextId, item.starId), keys: route('keys', contextId, item.starId), ...(local ? { logs: { resourceId: 'logs', contextId, query: { source: 'broker', audit: 'admin-op', starId: item.starId } } } : {}) },
              actionAvailability: { ...roleAvailability(item.role, entries, !!options.management, local), ...(!local ? { logs: disabled('TCP 未提供 broker 审计读取接口。', '切到 broker 本机上下文读取管理审计；不能把当前机器日志当作远端日志。') } : {}) } })),
              completeness: result.completeness, sampledAt: result.observedAt, presentation: { columns: columns[owner], actions: entries }, contextSummary: { label: local ? '本机 broker 托管星' : '当前已关联的 TCP 星', permissionLabel: result.role ? roleLabels[result.role] : '权限尚未核实' },
              actionAvailability: roleAvailability(result.role, entries, !!options.management, local), detailViews: { info: readInfo(result) }, notice: 'Enter 进入星的节点列表；增删改从本列表发起。l 按完整 starId 读取本机 broker 管理审计。' };
          }
          if (owner === 'sessions') {
            const result = await untilAborted(options.tcp.readSessions({ contextId, ...(query.starId ? { starId: query.starId } : {}), ...(query.machineId ? { machineId: query.machineId } : {}), scope: query.scope === 'discoverable' ? 'discoverable' : 'members', signal: request.signal }), request.signal);
            if (request.signal.aborted) return invalid('TCP 会话读取已取消。', true);
            if (result.contextId !== contextId || result.items.some((item) => item.contextId !== contextId) || (query.starId && result.star?.starId !== query.starId)) return invalid('会话来源返回了其他连接或星的结果，已拒绝显示。');
            if (!result.star) return { ...invalid('未取得明确的目标星；从 :stars 或 :ctx 重新选择。'), completeness: result.completeness, detailViews: { info: readInfo(result) } };
            const current = result.star;
            const entries = definitions(owner, query.machineId !== undefined);
            const stateOptions = new Map<string, string>();
            for (const item of result.items) stateOptions.set(JSON.stringify(item.rawStatus), statuses.format(item.providerId ?? '', item.rawStatus));
            return { rows: groupPresence(result.items).map((item) => sessionRow(item, current, contextId)), completeness: result.completeness, sampledAt: result.observedAt,
              presentation: { columns: query.machineId ? columns[owner].filter((column) => !['machine', 'mid8'].includes(column.id)) : columns[owner], actions: entries }, contextSummary: { label: `${current.name ?? current.starId}${query.machineId ? ` / ${query.machineId}` : ' / 全星会话'}`, permissionLabel: roleLabels[current.role] },
              filters: [...filters(result.items), { id: 'status', label: '原生状态', mode: 'select', defaultValue: '', options: [{ value: '', label: '所有原生状态' }, ...[...stateOptions].map(([value, label]) => ({ value, label }))] }],
              actionRoutes: { machines: route('machines', contextId, current.starId) }, routeChoices: { scope: { title: '会话来源范围（显式读取所选范围）', options: ['members', 'discoverable'].map((scope) => ({ value: scope, label: scope === 'members' ? '当前星成员册（不扫描所有机器）' : '所选节点可发现会话（可能出现逐节点部分结果）', route: route('sessions', contextId, current.starId, { ...(query.machineId ? { machineId: query.machineId } : {}), scope }) })) } },
              actionAvailability: { ...roleAvailability(current.role, entries, !!options.management, local), logs: disabled('TCP 未提供原生节点日志读取接口。', '切到所选节点的本机或 SSH 连接读取其 crosschat 日志。'), deliveries: disabled('尚无可验证的本机通信对关联，未读取本机投递记录。', '切到本机连接，在投递记录资源核对完整通信对。') },
              detailViews: { info: readInfo(result, [{ label: '读取范围', value: result.scope === 'members' ? '当前星成员册；不虚构原生忙闲，不扫描所有机器。' : '节点完整只读发现；没有入星的会话另列星籍。' }, ...result.nodes.map((node) => ({ label: `节点 ${node.machineId} <${node.completeness}>`, value: `${new Date(node.observedAt).toISOString()}\n${node.errors.map((error) => `${error.message}\n${error.nextStep}`).join('\n')}` }))]) },
              notice: `${result.items.length} 个已读取会话（默认含匿名）；${result.scope === 'members' ? '星内成员册' : '节点可发现范围'}；星籍在线不代表原生忙闲。` };
          }
          const result = await untilAborted(options.tcp.readStar({ contextId, ...(query.starId ? { starId: query.starId } : {}), signal: request.signal }), request.signal);
          if (request.signal.aborted) return invalid('TCP 读取已取消。', true);
          if (result.contextId !== contextId || (query.starId && result.star?.starId !== query.starId)) return invalid('星来源返回了其他连接或目标，已拒绝显示。');
          if (!result.star) return { ...invalid('未取得明确的目标星；从 :stars 或 :ctx 重新选择。'), completeness: result.completeness, detailViews: { info: readInfo(result) } };
          return starPage(owner, result, contextId, local);
        } catch { return invalid(request.signal.aborted ? 'TCP 读取已取消。' : 'TCP 来源未完成或结果无效；请查看连接后按 r 重试。', request.signal.aborted); }
      },
      async checkAction(request) {
        const turn = ++generation; accepted = undefined;
        const selected = managementRequest(request);
        if (!selected || !options.management || request.signal.aborted) return disabled('管理目标、来源或权限核验无效；未发送写请求。');
        try {
          const preview = await untilAborted(options.management.preview(selected), request.signal);
          if (turn !== generation || request.signal.aborted) return disabled('本次预览已取消或来源发生变化。');
          if (preview.enabled) accepted = { key: operationKey(selected), revision: preview.revision };
          return { enabled: preview.enabled, reason: preview.reason, nextStep: preview.nextStep, fields: preview.fields.map((field) => ({ ...field, options: field.options?.map((option) => ({ ...option })) })), impact: preview.impact.map((field) => `${field.label}：${field.value}`) };
        } catch { return disabled(request.signal.aborted ? '管理预览已取消。' : '无法取得有效管理预览；未发送写请求。'); }
      },
      async mutate(request): Promise<TuiMutationResult> {
        const selected = managementRequest(request);
        const preview = accepted; accepted = undefined;
        if (!selected || !options.management || request.signal.aborted || !preview || preview.key !== operationKey(selected)) throw new Error('缺少与固定目标和输入匹配的已核验预览；请重新确认。');
        let result;
        try { result = await options.management.apply({ ...selected, expectedPreviewRevision: preview.revision }); }
        catch { throw new Error('管理请求未取得有效回执，结果待核实；已发出的操作未撤销，不会自动重试。'); }
        if (result.kind !== 'applied') throw new Error(result.kind === 'uncertain' ? '请求已发出，结果待核实；核对目标现状后再操作，不会自动重试。' : result.message);
        return { selectedId: result.selectedId, message: result.secret ? '凭证已生成；请在一次性结果中分发，离开后不再回显。' : result.message, ...(result.secret ? { result: sensitiveResult(result.secret) } : {}) };
      },
    };
    if (owner === 'machines') adapter.watch = async (request, publish) => {
      while (!request.signal.aborted) {
        const page = await adapter.read(request);
        if (request.signal.aborted) return;
        publish(page);
        if (!page.autoRefresh) return;
        await refreshPause(request.signal);
      }
    };
    return { resource, adapter };
  }
  function sessionRow(item: TcpSession, current: TcpStar, contextId: string): TuiRow {
    const ref = item.ref ? json(item.ref) : undefined;
    const scope = `${current.name ?? current.starId} / ${item.machineName ?? item.mid8} (${item.machineId})`;
    const memberState = item.membership === 'member' ? `成员 · ${currentPresence(item.presence)}` : item.membership === 'not-member' ? '未入星<not-member>' : '星籍未核实<unknown>';
    return { id: item.id, contextId, cells: { name: item.name || '匿名', provider: item.providerId ?? '未提供', machine: item.machineName ?? item.mid8, mid8: item.mid8, status: statuses.format(item.providerId ?? '', item.rawStatus), membership: memberState, directory: typeof item.attributes.cwd === 'string' ? item.attributes.cwd : '—' },
      facets: { provider: item.providerId ?? '', named: item.name ? 'named' : 'anonymous', status: JSON.stringify(item.rawStatus), presence: item.presence },
      searchText: `${item.name ?? ''} ${item.providerId ?? ''} ${item.nativeId} ${item.machineId} ${item.machineName ?? ''} ${json(item.rawStatus)} ${item.presence} ${item.membership}`,
      copyValue: item.address, copyValues: { ...(ref ? { ref } : {}), ...(item.member ? { target: target(item.id, item.member.id, current.starId) } : {}) },
      actionAvailability: { ...copyAvailability(item.address, item.addressReason), ...(!item.member ? { 'remove-member': disabled('此行没有可核验的星册位；不会删除原生会话。') } : {}), ...(!ref ? { 'copy-ref': disabled('成员册未提供足够信息来构造完整原生会话引用。') } : {}) },
      actionRoutes: { open: route('sessions', contextId, current.starId, { machineId: item.machineId, scope: 'members' }) },
      detail: [{ label: '名称', value: item.name || '匿名' }, { label: '星 / 所属节点', value: scope }, { label: '完整原生 ID', value: item.nativeId }, { label: '完整会话引用', value: ref ?? '来源不足；未伪造引用' }, { label: '原生状态', value: json(item.rawStatus) }, { label: '星籍', value: memberState }, { label: '目录', value: typeof item.attributes.cwd === 'string' ? item.attributes.cwd : '未提供' }, ...(item.member ? memberDetails(item.member) : [])],
      detailViews: { guide: { title: '原生工具与寻址指引', fields: [{ label: '目标', value: scope }, { label: '原生操作', value: `请回到该节点同一用户的 ${item.providerId ?? '对应工具'} 原生窗口继续聊天。若要恢复，在该节点原生工具中按完整 ID 核对；不要在本机另开窗口冒充该会话。` },
        { label: '现有地址', value: item.address ?? item.addressReason ?? '此来源没有可核验的现有地址；完整标识仅用于核对身份。' }, { label: '完整原生 ID', value: item.nativeId }, { label: 'TUI 边界', value: '只读与管理明确册位；不代任何原生会话发言、不结束原生进程。' }] } },
    };
  }
  function starPage(owner: 'machines' | 'members' | 'keys', result: TcpStarResult, contextId: string, local: boolean): TuiPage {
    const current = result.star!;
    const entries = definitions(owner);
    let rows: TuiRow[];
    if (owner === 'machines') rows = result.machines.map((item) => {
      const members = result.members.filter((member) => member.machineId === item.machineId);
      return { id: item.id, contextId, cells: { name: item.name ?? item.mid8, mid8: item.mid8, presence: currentPresence(item.presence), online: String(members.filter((member) => member.presence === 'online').length), offline: String(members.filter((member) => member.presence === 'offline').length) },
        searchText: `${item.name ?? ''} ${item.machineId} ${item.labels.join(' ')} ${item.presence}`, copyValue: item.machineId, copyValues: { target: target(item.id, item.id, current.starId) },
        actionRoutes: { open: route('sessions', contextId, current.starId, { machineId: item.machineId, scope: 'members' }) },
        detail: [{ label: '所属星', value: `${current.name ?? current.starId} (${current.starId})` }, { label: '完整机器标识', value: item.machineId }, { label: '节点名称', value: item.name ?? '未提供' }, { label: '节点凭证 label', value: item.labels.join('\n') }, { label: '机器连接', value: currentPresence(item.presence) }, { label: '登记时间', value: item.addedAt ?? '未提供' }] };
    });
    else if (owner === 'members') rows = groupPresence(result.members).map((item) => ({ id: item.id, contextId, cells: { name: item.name || '匿名', provider: item.providerId ?? '未提供', machine: item.machineName ?? item.machineId.slice(0, 8), presence: currentPresence(item.presence), succession: item.extendsName ? `接任 ${item.extendsName}` : '—' }, facets: { provider: item.providerId ?? '', named: item.name ? 'named' : 'anonymous', presence: item.presence },
      copyValue: item.address, copyValues: { target: target(item.id, item.id, current.starId) }, actionAvailability: copyAvailability(item.address, item.addressReason), searchText: `${item.name ?? ''} ${item.providerId ?? ''} ${item.machineId} ${item.nativeId} ${item.presence} ${item.extendsName ?? ''} ${item.extendsMachine ?? ''}`, detail: memberDetails(item) }));
    else rows = result.credentials.map((item): TuiRow => ({ id: item.id, contextId, cells: { name: item.label, kind: item.kind === 'admin' ? '星管理钥<admin>' : '节点钥匙<node>', machine: item.kind === 'admin' ? '管理权限（非机器）' : item.machineName ?? (item.machineId === null ? '尚未绑定机器' : item.machineId.slice(0, 8)), mid8: item.machineId?.slice(0, 8) ?? '—', addedAt: item.addedAt },
      copyValue: item.label, copyValues: { target: target(item.id, item.id, current.starId, item.revision) }, searchText: `${item.label} ${item.kind} ${item.machineId ?? ''} ${item.machineName ?? ''} ${item.addedAt}`,
      actionAvailability: item.kind === 'admin' && current.role !== 'broker-owner' ? { 'revoke-credential': disabled('星管理员不能撤销同侪管理钥。', '请 broker 主在本机接入凭证列表撤销该管理钥。') } : {}, detail: credentialDetails(item) }));
    return { rows, completeness: result.completeness, sampledAt: result.observedAt, ...(owner === 'machines' ? { autoRefresh: true } : {}), presentation: { columns: columns[owner], actions: entries }, contextSummary: { label: `${current.name ?? current.starId} (${current.starId})`, permissionLabel: roleLabels[current.role] },
      ...(owner === 'members' ? { filters: filters(result.members, true) } : {}), actionAvailability: { ...roleAvailability(current.role, entries, !!options.management, local), ...(owner === 'machines' ? { logs: disabled('TCP 节点没有提供可读取的日志来源。', '切到该节点本机或 SSH 连接查看 crosschat 日志。') } : {}) },
      actionRoutes: { sessions: route('sessions', contextId, current.starId, { scope: 'members' }), members: route('members', contextId, current.starId), keys: route('keys', contextId, current.starId) },
      detailViews: { info: readInfo(result, [{ label: '当前星', value: `${current.name ?? '未命名'} (${current.starId})` }, { label: '本次权限', value: roleLabels[current.role] }, { label: '机器与凭证', value: '已绑定机器、未使用节点钥匙与管理钥分开显示；只读页不会生成或回显秘密。' }]) },
      notice: owner === 'machines' ? 'Enter 节点会话；v 全星会话；等待使用的钥匙在 p 凭证表。e 只修改当前本机显示名，不改选中的远机。' : owner === 'members' ? '按在线 / 下线分组；a 选择本机现存会话收编，Ctrl+D 仅删所选册位，不终止原生进程。' : '仅凭证元数据；y 复制 label，不复制 key/adminKey。发钥结果仅一次性显示。' };
  }
  return { stars: binding('stars'), machines: binding('machines'), members: binding('members'), keys: binding('keys'), sessions: binding('sessions') };
}
