import { createHash } from 'node:crypto';
import type { TcpConfigurationImport } from '../../application/tcp/configuration.js';
import { untilAborted } from '../../application/sessions/reading.js';
import type { TuiAction, TuiActionRequest, TuiFormField, TuiPage, TuiReadRequest, TuiResource, TuiResourceAdapter, TuiRoute } from '../model.js';

export interface ConnectionsResourceOptions { configuration: TcpConfigurationImport }
const targetId = 'import-tcp';
const fields: readonly TuiFormField[] = [{ id: 'content', label: '现有 TCP 配置 JSON（私密）', required: true, secret: true }];
const guidance = '使用当前用户已有的 node.json 完整 JSON（brokers 数组与完整 starId）。只追加本机尚未关联的星，不替换现有凭证或地址；保存配置不会启动 broker、节点或原生会话。';
const importAction = (shortcut: string): TuiAction => ({ id: targetId, label: '导入现有 TCP 配置', shortcut, ownerResourceId: 'connect', selectionPolicy: 'required', mutation: true, kind: 'form', fields, returnPolicy: 'select-result' });
const detailAction: TuiAction = { id: 'detail', label: '只读操作说明', shortcut: 'd', ownerResourceId: 'connect', selectionPolicy: 'required', mutation: false, kind: 'detail', returnPolicy: 'restore' };
const openAction: TuiAction = { id: 'open', label: '选择连接方式', shortcut: 'Enter', ownerResourceId: 'connect', selectionPolicy: 'required', mutation: false, kind: 'navigate', returnPolicy: 'restore' };
function valid(request: TuiReadRequest): boolean {
  const route = request.route;
  return (route?.resourceId === undefined || route.resourceId === 'connect')
    && (route?.contextId === undefined || route.contextId === request.context?.id)
    && !Object.keys(route?.query ?? {}).some((key) => key !== 'operation')
    && (route?.query?.operation === undefined || route.query.operation === targetId);
}
function invalid(cancelled = false): TuiPage {
  return { rows: [], completeness: cancelled ? 'cancelled' : 'unavailable', notice: cancelled ? '连接选择已取消。' : '连接选择范围无效；请返回 :ctx 重新开始。' };
}
function linkedRoute(resourceId: string, request: TuiReadRequest, importing = false): TuiRoute {
  return { resourceId, ...(request.context ? { contextId: request.context.id } : {}), ...(importing ? { query: { operation: targetId } } : {}) };
}
function contentOf(request: TuiActionRequest): string | undefined {
  const content = request.values.content;
  if (!valid(request) || request.action.ownerResourceId !== 'connect' || request.action.id !== targetId || request.target?.id !== targetId
    || Object.keys(request.values).some((key) => key !== 'content') || typeof content !== 'string' || !content.trim() || Buffer.byteLength(content, 'utf8') > 1024 * 1024) return undefined;
  return content;
}
function privateKey(request: TuiActionRequest, content: string): string {
  return JSON.stringify([request.context?.id ?? null, request.route?.query?.operation ?? null, createHash('sha256').update(content, 'utf8').digest('hex')]);
}

/** Selection is readonly; secret import input stays in the active form and application call. */
export function createConnectionsResource(options: ConnectionsResourceOptions): { resource: TuiResource; adapter: TuiResourceAdapter } {
  let generation = 0;
  let accepted: { key: string; revision: string } | undefined;
  const resource: TuiResource = { id: 'connect', label: '添加已有连接', aliases: [], description: '选择已有 SSH 别名或导入现有 TCP 配置', columns: [
    { id: 'name', label: '连接方式', width: 28, priority: 100 }, { id: 'scope', label: '操作范围', width: 54, priority: 80 },
  ], actions: [openAction, importAction('a'), detailAction] };
  const adapter: TuiResourceAdapter = {
    async read(request) {
      generation++; accepted = undefined;
      if (!valid(request)) return invalid();
      if (request.signal.aborted) return invalid(true);
      const importing = request.route?.query?.operation === targetId;
      const tcp = { id: targetId, cells: { name: '导入现有 TCP 配置', scope: '追加本机当前用户连接；不启动服务' }, copyValue: guidance, searchText: 'tcp node.json 现有配置 导入 追加 本机 当前用户',
        detail: [{ label: '操作', value: guidance }, { label: '执行位置', value: '当前运行 TUI 的本机用户配置。所选 SSH/TCP 连接不会改变写入位置。' }, { label: '确认', value: '在本列表按 a，或 Enter 进入导入任务列表后再次 Enter。粘贴内容始终遮盖；确认默认取消，提交前重新校验原文件与输入。' }, { label: '保存之后', value: '返回连接列表并重新读取真实配置。由用户选择目标并按需检测，导入不代表认证通过或机器已上线。' }],
        actionRoutes: { open: linkedRoute('connect', request, true) } };
      return { rows: importing ? [tcp] : [{ id: 'existing-ssh', cells: { name: '选择已有 SSH Host', scope: '当前用户已配置的 SSH 别名' }, copyValue: '从已有 SSH Host 别名选择；不编辑 SSH 配置，不自动连接。',
        detail: [{ label: '已有 SSH', value: '进入 SSH 别名列表选择对端。检测、发现与体检按需执行，不新增持久连接清单、不编辑 SSH 配置。' }], actionRoutes: { open: linkedRoute('ssh', request) },
        actionAvailability: { [targetId]: { enabled: false, reason: '此行是已有 SSH 选择；请按 Enter。', nextStep: '若要导入 TCP 配置，选择 TCP 导入行再按 a。' } } }, tcp], completeness: 'complete',
        contextSummary: { label: importing ? '本机 · 导入现有 TCP 配置' : '本机 · 添加已有连接', permissionLabel: '当前本机用户配置' },
        ...(importing ? { presentation: { actions: [importAction('Enter / a'), detailAction] } } : {}),
        notice: importing ? 'Enter/a 打开私密输入与确认；读取页面不会保存配置。' : 'Enter 选择已有 SSH 或 TCP 导入任务；a 可直接导入所选 TCP 配置。' };
    },
    async checkAction(request) {
      const turn = ++generation; accepted = undefined;
      const content = contentOf(request);
      if (content === undefined || request.signal.aborted) return { enabled: false, reason: '请在 TCP 导入任务中粘贴有效的现有 JSON（最多 1 MiB）；未保存配置。', fields };
      try {
        const preview = await untilAborted(options.configuration.preview({ content, signal: request.signal }), request.signal);
        if (turn !== generation || request.signal.aborted) return { enabled: false, reason: '导入预览已取消或已离开来源列表。', fields };
        if (preview.enabled) accepted = { key: privateKey(request, content), revision: preview.revision };
        return { enabled: preview.enabled, reason: preview.reason, fields,
          impact: [...preview.impact, ...preview.targets.map((target) => `新增连接：${target.name ?? '未命名'}\n完整 starId：${target.starId}\n地址：${target.host}:${target.port}\n连接标识：${target.contextId}`)] };
      } catch { return { enabled: false, reason: request.signal.aborted ? '导入预览已取消。' : '配置预览未完成；核对 JSON 格式与本机配置权限后重新预览。', fields }; }
    },
    async mutate(request) {
      const content = contentOf(request);
      const preview = accepted; accepted = undefined;
      if (content === undefined || request.signal.aborted || !preview || preview.key !== privateKey(request, content)) throw new Error('没有与当前私密输入和来源匹配的已核验预览；请重新确认。');
      let result;
      try { result = await untilAborted(options.configuration.apply({ content, expectedRevision: preview.revision, signal: request.signal }), request.signal); }
      catch { throw new Error('配置保存未取得有效回执，结果待核实；返回连接列表刷新核对，不自动重试。'); }
      if (result.status !== 'applied') throw new Error(result.message);
      if (!result.contextId || !result.targets.some((target) => target.contextId === result.contextId)) throw new Error('保存回执未提供可核实的新连接；请返回 :ctx 刷新核对。');
      return { navigate: { resourceId: 'ctx' }, selectedId: result.contextId, message: '已追加本机配置；选择新连接后可按需检测，尚未启动服务。' };
    },
  };
  return { resource, adapter };
}
