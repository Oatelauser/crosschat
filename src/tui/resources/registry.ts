import type { TuiAction, TuiMode, TuiResource } from '../model.js';

export interface ResourceRegistry {
  readonly resources: readonly TuiResource[];
  resolve(command: string): TuiResource | undefined;
  candidates(query: string): readonly TuiResource[];
  actions(resourceId: string, mode: TuiMode): readonly TuiAction[];
}

function command(id: string, label: string, shortcut: string, ownerResourceId: string): TuiAction {
  return { id, label, shortcut, ownerResourceId, selectionPolicy: 'none', mutation: false, kind: 'command', returnPolicy: 'restore' };
}

function commonActions(resourceId: string, mode: TuiMode): TuiAction[] {
  const entries = mode === 'list' ? [
    ['previous', '上一项', '↑ / k'], ['next', '下一项', '↓ / j'], ['page-up', '上一页', 'PgUp'], ['page-down', '下一页', 'PgDn'],
    ['first', '首项', 'Home'], ['last', '末项', 'End'], ['command', '资源与筛选', ':'], ['filter', '筛选', '/'],
    ['refresh', '刷新', 'r'], ['sort', '排序字段', 'S'], ['back', '清筛选或返回', 'Esc'], ['help', '全部按键', '?'], ['quit', '退出', 'q'], ['interrupt', '取消读取或退出', 'Ctrl+C'],
  ] : mode === 'detail' ? [
    ['previous', '向上滚动', '↑ / k'], ['next', '向下滚动', '↓ / j'], ['page-up', '上一页', 'PgUp'], ['page-down', '下一页', 'PgDn'],
    ['first', '开头', 'Home'], ['last', '末尾', 'End'], ['filter', '查找详情', '/'], ['command', '资源与筛选', ':'],
    ['back', '返回列表', 'Esc'], ['help', '全部按键', '?'], ['quit', '退出', 'q'], ['interrupt', '取消读取或退出', 'Ctrl+C'],
  ] : mode === 'input' ? [
    ['input-next', '下一候选并补全', 'Tab / ↓'], ['input-previous', '上一候选并补全', 'Shift+Tab / ↑'], ['input-enter', '切资源或保留筛选', 'Enter'], ['input-cancel', '撤销输入', 'Esc'], ['interrupt', '取消读取或退出', 'Ctrl+C'],
  ] : mode === 'form' ? [
    ['field-next', '下一字段或按钮', 'Tab'], ['field-previous', '上一字段或按钮', 'Shift+Tab'], ['field-enter', '下一字段或所选按钮', 'Enter'], ['form-cancel', '取消并返回', 'Esc / Ctrl+C'],
    ['form-page-up', '上滚确认内容', 'PgUp'], ['form-page-down', '下滚确认内容', 'PgDn'], ['form-first', '光标或内容开头', 'Home'], ['form-last', '光标或内容末尾', 'End'],
  ] : [
    ['previous', '向上滚动', '↑ / k'], ['next', '向下滚动', '↓ / j'], ['page-up', '上一页', 'PgUp'], ['page-down', '下一页', 'PgDn'], ['first', '开头', 'Home'], ['last', '末尾', 'End'], ['back', '关闭帮助', 'Esc / ?'], ['interrupt', '取消读取或退出', 'Ctrl+C'],
  ];
  const actions = entries.map(([id, label, shortcut]) => command(id, label, shortcut, resourceId));
  if (mode === 'list' || mode === 'detail') {
    actions.push({ ...command('copy', '复制完整值', 'y', resourceId), kind: 'copy', selectionPolicy: 'required' });
  }
  if (mode === 'list') actions.push({ ...command('detail', '只读详情', 'Enter / d', resourceId), kind: 'detail', selectionPolicy: 'required' });
  return actions;
}

const definitions: ReadonlyArray<[string, string, readonly string[], string]> = [
  ['ctx', '连接上下文', ['contexts', 'connections'], '选择本机、SSH 或 TCP 连接'],
  ['sessions', '会话', ['session'], '会话发现、筛选与只读详情'], ['ssh', 'SSH 对端', [], '已配置 SSH 对端'],
  ['stars', '星', ['star'], '当前连接可管理的星'], ['machines', '节点', ['nodes'], '星内机器'],
  ['members', '成员册', ['roster'], '星内登记成员'], ['keys', '接入凭证', ['credentials', 'node-keys'], '凭证元数据'],
  ['status', '状态总览', [], '当前连接状态'], ['deliveries', '投递记录', ['delivery'], '投递元数据与回执'],
  ['outbox', '滞留', [], '待投递项'], ['doctor', '体检', [], '只读诊断与处理指引'],
  ['services', '服务', ['service'], '本机服务'], ['logs', '日志', ['log'], '有界日志读取'],
  ['files', '文件', ['file'], '收件与断点元数据'], ['maintenance', '维护', ['maint'], '维护任务预览与确认'],
];

type PendingAction = readonly [shortcut: string, label: string, mutation?: boolean, kind?: TuiAction['kind']];
const pendingActions: Readonly<Record<string, readonly PendingAction[]>> = {
  ctx: [['a', '添加已有连接', true], ['g', '配置与回程指引'], ['t', '检测选中连接']],
  sessions: [['t', '工具筛选'], ['u', '匿名筛选'], ['s', '状态筛选'], ['b', '会话范围'], ['a', '收编已有会话', true], ['Ctrl+D', '删除星册位', true], ['o', '相关投递记录'], ['g', '原生工具指引'], ['l', '相关日志']],
  stars: [['Enter', '进入星', false, 'navigate'], ['a', '新增星', true], ['e', '修改星名', true], ['Ctrl+D', '删除星', true], ['p', '接入凭证'], ['l', '管理审计']],
  machines: [['Enter', '进入节点会话', false, 'navigate'], ['v', '全星会话'], ['a', '让新机器接入', true], ['e', '修改当前机器显示名', true], ['Ctrl+D', '移除节点', true], ['m', '成员册'], ['p', '接入凭证'], ['l', '节点日志']],
  members: [['a', '收编已有会话', true], ['Ctrl+D', '删除册位', true], ['t', '工具筛选'], ['u', '匿名筛选'], ['s', '星籍筛选']],
  keys: [['a', '发节点钥匙', true], ['A', '发星管理钥', true], ['Ctrl+D', '撤销凭证', true]],
  ssh: [['Enter', '进入远机会话', false, 'navigate'], ['a', '添加已有 SSH 别名', true], ['t', '检测选中对端'], ['D', '对端体检'], ['g', '配置与回程指引']],
  status: [['Enter', '进入对应资源', false, 'navigate']], deliveries: [['w', '相关滞留'], ['l', '相关日志']],
  outbox: [['o', '相关投递记录'], ['l', '看门狗日志']], services: [['a', '启动所选服务', true], ['Ctrl+D', '停止所选服务', true], ['l', '服务日志']],
  logs: [['Space', '暂停或恢复跟随']], files: [['m', '维护清理']], maintenance: [['Enter', '预览维护操作', true]],
};

function resourceActions(id: string): TuiAction[] {
  const actions: TuiAction[] = (pendingActions[id] ?? []).map(([key, label, mutation = false, kind]) => ({
    ...command(`resource-${key}`, label, key, id), selectionPolicy: 'required' as const,
    mutation, kind: kind ?? (mutation ? 'form' as const : 'command' as const), enabled: false,
    unavailableReason: '资源尚未启用，此操作暂不可用。', nextStep: '可查看连接信息；业务资源接入后再执行此操作。',
  }));
  if (id === 'ctx') actions.push(
    { ...command('detail', '只读详情', 'd', id), kind: 'detail', selectionPolicy: 'required' },
    { ...command('enter-context', '进入连接', 'Enter', id), kind: 'navigate', selectionPolicy: 'required' },
  );
  return actions;
}

export const defaultResources: readonly TuiResource[] = definitions.map(([id, label, aliases, description]) => ({
  id, label, aliases, description,
  columns: id === 'ctx' ? [
    { id: 'name', label: '连接', width: 24 }, { id: 'kind', label: '类型', width: 10 }, { id: 'target', label: '目标', width: 30 },
  ] : [{ id: 'name', label: '名称', width: 24 }],
  actions: resourceActions(id),
  ...(id === 'ctx' ? {} : { unavailableReason: '资源尚未启用。当前可使用连接列表和通用交互。' }),
}));

export function createResourceRegistry(resources: readonly TuiResource[] = defaultResources): ResourceRegistry {
  const table = [...resources];
  const byCommand = new Map<string, TuiResource>();
  for (const resource of table) {
    for (const name of [resource.id, ...resource.aliases]) {
      if (!name || byCommand.has(name)) throw new Error(`重复或空资源命令: ${name}`);
      byCommand.set(name, resource);
    }
    if (resource.columns.some((column) => !Number.isInteger(column.width) || column.width < 1)) throw new Error(`资源列宽必须为正整数: ${resource.id}`);
    const actionIds = new Set<string>();
    const shortcuts = new Set<string>();
    for (const action of resource.actions) {
      if (action.ownerResourceId !== resource.id) throw new Error(`操作必须登记在所属资源列表: ${action.id}`);
      if (actionIds.has(action.id)) throw new Error(`重复操作: ${action.id}`);
      actionIds.add(action.id);
      for (const key of action.shortcut.split(' / ')) {
        if (!key || shortcuts.has(key)) throw new Error(`重复或空按键: ${key}`);
        shortcuts.add(key);
      }
    }
  }
  return {
    resources: table,
    resolve: (value) => byCommand.get(value.trim().replace(/^:/, '')),
    candidates: (value) => {
      const query = value.trim().toLocaleLowerCase();
      return table.filter((resource) => [resource.id, ...resource.aliases].some((name) => name.toLocaleLowerCase().startsWith(query)));
    },
    actions: (resourceId, mode) => {
      const common = commonActions(resourceId, mode).filter((action) => !(resourceId === 'logs' && action.id === 'sort'));
      if (mode !== 'list') return common;
      const own = table.find((resource) => resource.id === resourceId)?.actions ?? [];
      const ownKeys = new Set(own.flatMap((action) => action.shortcut.split(' / ')));
      const inherited = common.flatMap((action) => {
        if (own.some((override) => override.id === action.id)) return [];
        const keys = action.shortcut.split(' / ').filter((key) => !ownKeys.has(key));
        return keys.length ? [{ ...action, shortcut: keys.join(' / ') }] : [];
      });
      return [...inherited, ...own];
    },
  };
}
