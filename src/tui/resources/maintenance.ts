import { cancellable } from '../../application/queries/reading.js';
import { isMaintenanceOperationId } from '../../application/maintenance/model.js';
import type { LocalMaintenance, MaintenancePreview, MaintenanceResult } from '../../application/maintenance/model.js';
import type { TuiActionRequest, TuiField, TuiResource, TuiResourceAdapter } from '../model.js';

interface MaintenanceOptions { maintenance: LocalMaintenance }
function key(contextId: string, operationId: string): string { return JSON.stringify([contextId, operationId]); }
function impact(preview: MaintenancePreview): string[] {
  return [preview.label, ...preview.effects, ...preview.targets.map((target, index) => `${index + 1}. ${target.path}\n${target.label}${target.bytes === undefined ? '' : `；${target.bytes} 字节`}${target.modifiedAt === undefined ? '' : `；修改时间 ${new Date(target.modifiedAt).toISOString()}`}`),
    ...(preview.targets.length ? [] : ['本次没有待处理目标；不会扩大范围。'])];
}
function resultFields(result: MaintenanceResult): TuiField[] {
  return [{ label: '最近执行结果', value: `${result.message}\n状态：${result.status}\n开始：${new Date(result.startedAt).toISOString()}\n结束：${new Date(result.finishedAt).toISOString()}` },
    ...result.items.map((item) => ({ label: `${item.outcome}：${item.path}`, value: item.message ?? item.path })),
    { label: 'npm包', value: '未执行卸载<not-run>；如需卸载包，另行执行 npm uninstall -g @oatelauser/crosschat。' }];
}
/** The selected list task owns its preview and result. Details have no write actions. */
export function createMaintenanceResource(options: MaintenanceOptions): { resource: TuiResource; adapter: TuiResourceAdapter } {
  const accepted = new Map<string, MaintenancePreview>();
  const results = new Map<string, MaintenanceResult>();
  const resource: TuiResource = { id: 'maintenance', label: '维护', aliases: ['maint'], description: '本机维护任务：先预览，再明确确认', columns: [
    { id: 'name', label: '维护任务', width: 28, priority: 100 }, { id: 'scope', label: '范围', width: 54, priority: 60 }, { id: 'state', label: '最近结果', width: 20, priority: 80 },
  ], actions: [
    { id: 'execute', label: '预览 / 确认所选任务', shortcut: 'Enter', ownerResourceId: 'maintenance', selectionPolicy: 'required', mutation: true, kind: 'form', returnPolicy: 'restore' },
    { id: 'detail', label: '只读范围与结果', shortcut: 'd', ownerResourceId: 'maintenance', selectionPolicy: 'required', mutation: false, kind: 'detail', returnPolicy: 'restore' },
  ] };
  const selected = (request: TuiActionRequest) => {
    if (request.action.id !== 'execute' || request.action.ownerResourceId !== 'maintenance' || request.context?.kind !== 'local' || !request.target
      || !isMaintenanceOperationId(request.target.id) || !options.maintenance.list().some((item) => item.id === request.target!.id)) return undefined;
    return { operationId: request.target.id, key: key(request.context.id, request.target.id) };
  };
  const adapter: TuiResourceAdapter = {
    async read(request) {
      if (request.context?.kind !== 'local' || (request.route?.contextId !== undefined && request.route.contextId !== request.context.id)) return { rows: [], completeness: 'unavailable', notice: '维护只支持当前本机连接；返回 :ctx 重新选择。' };
      if (request.signal.aborted) return { rows: [], completeness: 'cancelled', notice: '读取已取消。' };
      const contextId = request.context.id;
      return { rows: options.maintenance.list().map((item) => {
        const result = results.get(key(contextId, item.id));
        const detail = [{ label: '任务', value: item.label }, { label: '操作范围', value: item.description }, { label: '帮助', value: item.guidance },
          { label: '确认规则', value: '仅从本列表发起预览；确认默认取消，提交前重新核对范围。执行后取消只能停止等待，不能保证回滚。' }, ...(result ? resultFields(result) : [])];
        return { id: item.id, cells: { name: item.label, scope: item.description, state: result ? `${result.status === 'complete' ? '完成' : result.status === 'partial' ? '部分失败' : result.status === 'changed' ? '范围变化' : '已阻止'}<${result.status}>` : '尚未执行<not_run>' },
          copyValue: item.guidance, searchText: `${item.id} ${item.label} ${item.description} ${item.guidance} ${result?.message ?? ''}`, detail,
          ...(result ? { detailViews: { result: { title: '维护任务实际结果', fields: resultFields(result) } } } : {}),
        };
      }), completeness: 'complete', notice: 'Enter 只打开预览；d 查看范围与最近实际结果；任何执行都需明确确认。' };
    },
    async checkAction(request) {
      const target = selected(request);
      if (!target || request.signal.aborted) return { enabled: false, reason: '任务或本机上下文无效；请返回列表重新选择。' };
      accepted.delete(target.key);
      const preview = await cancellable(options.maintenance.preview({ operationId: target.operationId, signal: request.signal }), request.signal);
      if (request.signal.aborted || preview.operationId !== target.operationId) return { enabled: false, reason: '维护预览身份不符或已取消；请重新打开任务。' };
      if (preview.enabled) accepted.set(target.key, preview);
      return { enabled: preview.enabled, reason: preview.reason, impact: impact(preview) };
    },
    async mutate(request) {
      const target = selected(request);
      const preview = target ? accepted.get(target.key) : undefined;
      if (!target || !preview || request.signal.aborted) throw new Error('没有与当前任务和本机上下文匹配的已核验预览；未执行维护操作。');
      accepted.delete(target.key);
      const result = await cancellable(options.maintenance.execute({ operationId: target.operationId, expectedFingerprint: preview.fingerprint, signal: request.signal }), request.signal);
      if (result.operationId !== target.operationId) throw new Error('维护回执身份不符，结果待核实；请检查目标后重新预览。');
      results.set(target.key, result);
      if (result.status !== 'complete') throw new Error(result.message);
      return { selectedId: target.operationId, message: result.message };
    },
  };
  return { resource, adapter };
}
