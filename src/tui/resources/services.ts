import type { LocalServiceRequest, LocalServices, ServiceActionCheck } from '../../application/services/managed.js';
import { isRecord, untilAborted } from '../../application/sessions/reading.js';
import type { TuiAction, TuiActionAvailability, TuiActionRequest, TuiPage, TuiReadRequest, TuiResource, TuiResourceAdapter } from '../model.js';

export interface ServicesResourceOptions { service: LocalServices }
function action(id: string, label: string, shortcut: string, extra: Partial<TuiAction> = {}): TuiAction {
  return { id, label, shortcut, ownerResourceId: 'services', selectionPolicy: 'required', mutation: false, kind: 'command', returnPolicy: 'restore', ...extra };
}
const resource: TuiResource = { id: 'services', label: '本机服务', aliases: ['service'], description: '本机 broker / 节点服务，就绪确认与起停影响',
  columns: [{ id: 'name', label: '服务', width: 24, priority: 100 }, { id: 'kind', label: '类型', width: 10, priority: 60 }, { id: 'state', label: '进程', width: 24, priority: 85 }, { id: 'readiness', label: '就绪', width: 20, priority: 90 }, { id: 'pid', label: 'PID', width: 12, priority: 50 }, { id: 'target', label: '目标', width: 30, priority: 70 }],
  actions: [action('start', '启动所选服务', 'a', { mutation: true, kind: 'form' }), action('stop', '停止所选服务', 'Ctrl+D', { mutation: true, kind: 'form' }), action('logs', '服务日志', 'l', { kind: 'navigate' }), action('read-summary', '读取信息', 'i', { kind: 'detail', viewId: 'read-summary', selectionPolicy: 'none' })] };
const states: Readonly<Record<string, string>> = { 'not-running': '未运行', running: '进程运行', hosted: 'broker内挂', unknown: '未知' };
const readinessStates: Readonly<Record<string, string>> = { ready: '已就绪', starting: '启动中', waiting: '等待重连', stopped: '未运行', unknown: '未核实' };
function availability(check: ServiceActionCheck): TuiActionAvailability { return { enabled: check.allowed, reason: check.reason, nextStep: check.nextStep, impact: check.impact }; }
function unavailable(message: string, completeness: TuiPage['completeness'] = 'unavailable'): TuiPage {
  return { rows: [], completeness, notice: message, detailViews: { 'read-summary': { title: '服务读取信息', fields: [{ label: '原因', value: message }, { label: '下一步', value: '返回 :ctx 选择本机，按 r 重新读取；不会回落操作本机服务。' }] } } };
}
function local(request: TuiReadRequest): boolean { return request.context?.kind === 'local' && request.context.id === 'local' && (request.route?.contextId === undefined || request.route.contextId === 'local') && !Object.keys(request.route?.query ?? {}).length; }
function mutation(request: TuiActionRequest): LocalServiceRequest | undefined {
  if (request.context?.kind !== 'local' || request.context.id !== 'local' || request.action.ownerResourceId !== 'services' || !['start', 'stop'].includes(request.action.id) || !request.target?.copyValues?.target) return undefined;
  try {
    const token: unknown = JSON.parse(request.target.copyValues.target);
    if (!isRecord(token) || token.id !== request.target.id || typeof token.revision !== 'string' || !token.revision || Object.keys(token).some((key) => !['id', 'revision'].includes(key))) return undefined;
    return { contextId: 'local', id: request.target.id, revision: token.revision, operation: request.action.id === 'start' ? 'start' : 'stop', signal: request.signal };
  } catch { return undefined; }
}

/** Service pages only display safe DTOs and delegate revalidation and execution to the application. */
export function createServicesResource(options: ServicesResourceOptions): { resource: TuiResource; adapter: TuiResourceAdapter } {
  return { resource, adapter: {
    async read(request) {
      if (!local(request)) return unavailable('服务上下文或路由无效；未读取或操作本机服务。');
      if (request.signal.aborted) return unavailable('服务读取已取消。', 'cancelled');
      const page = await untilAborted(options.service.read({ contextId: 'local', signal: request.signal }), request.signal);
      if (request.signal.aborted) return unavailable('服务读取已取消。', 'cancelled');
      return { rows: page.items.map((item) => ({ id: item.id, contextId: 'local', cells: { name: item.label, kind: item.kind, state: `${states[item.state] ?? '未识别'}<${item.state}>`, readiness: `${readinessStates[item.readiness ?? 'unknown'] ?? '未识别'}<${item.readiness ?? 'unknown'}>`, pid: item.pid === undefined ? '—' : String(item.pid), target: item.target },
        searchText: JSON.stringify([item.id, item.label, item.selector, item.state, item.target, item.detail]), copyValue: item.id, copyValues: { target: JSON.stringify({ id: item.id, revision: item.revision }) },
        detail: [{ label: '服务标识', value: item.id }, { label: '进程状态', value: `${states[item.state] ?? '未识别'}<${item.state}>` }, { label: '实际就绪', value: `${readinessStates[item.readiness ?? 'unknown'] ?? '未识别'}<${item.readiness ?? 'unknown'}>` }, ...item.detail],
        actionAvailability: { start: availability(item.start), stop: availability(item.stop), logs: item.sourceId ? { enabled: true } : { enabled: false, reason: '尚不能安全确定此服务的日志来源。', nextStep: '查看完整服务配置和进程归属，再使用 :logs 选择已知来源。' } },
        ...(item.sourceId ? { actionRoutes: { logs: { resourceId: 'logs', contextId: 'local', query: { source: item.sourceId } } } } : {}) })),
        completeness: page.completeness, sampledAt: page.observedAt, notice: `仅管理本机 broker / 节点守护；不会结束原生工具会话。${page.errors.length ? '来源读取不完整，按 i 查看原因。' : '起停前会重新核验固定目标和影响。'}`,
        detailViews: { 'read-summary': { title: '服务读取信息', fields: [{ label: '完整性', value: page.completeness }, { label: '范围', value: '当前本机配置、状态快照和专属后台进程核验；不会起停服务或启动原生会话。' }, { label: '来源问题', value: page.errors.length ? page.errors.map((entry) => `${entry.source} <${entry.kind}>：${entry.message}\n${entry.nextStep}`).join('\n\n') : '无来源错误' }, { label: '操作边界', value: 'launcher 与原生工具不是可独立起停的 crosschat 服务；内挂聚合器随 broker 生命周期管理。' }] } } };
    },
    async checkAction(request) {
      const selected = mutation(request);
      if (!selected || request.signal.aborted) return { enabled: false, reason: request.signal.aborted ? '服务核验已取消。' : '固定服务目标无效，请从本机服务列表重新选择。' };
      return availability(await untilAborted(options.service.check(selected), request.signal));
    },
    async mutate(request) {
      const selected = mutation(request);
      if (!selected || request.signal.aborted) throw new Error('固定服务目标无效或操作已取消。');
      const result = await options.service.execute(selected);
      if (result.state !== 'ready') throw new Error(result.message);
      return { selectedId: result.id ?? selected.id, message: result.message };
    },
  } };
}
