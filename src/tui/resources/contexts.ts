import type { TuiAction, TuiContext, TuiReadonlyView, TuiResource } from '../model.js';

function action(id: string, label: string, shortcut: string, kind: TuiAction['kind'], extra: Partial<TuiAction> = {}): TuiAction {
  return { id, label, shortcut, kind, ownerResourceId: 'ctx', selectionPolicy: 'required', mutation: false, returnPolicy: 'restore', ...extra };
}

export const contextsResource: TuiResource = {
  id: 'ctx', label: '连接上下文', aliases: ['contexts', 'connections'], description: '选择已有连接、按需检测与同用户操作指引',
  columns: [{ id: 'name', label: '连接', width: 24 }, { id: 'kind', label: '类型', width: 10 }, { id: 'target', label: '目标', width: 30 }],
  actions: [
    action('enter-context', '进入连接', 'Enter', 'navigate'), action('detail', '只读连接详情', 'd', 'detail'),
    action('choose-connection', '添加已有连接', 'a', 'navigate', { selectionPolicy: 'none', navigateTo: 'connect' }),
    action('connection-guide', '配置与回程指引', 'g', 'detail', { viewId: 'connection-guide' }),
    action('test-context', '检测所选连接', 't', 'navigate'),
  ],
};

/** Context adapters declare their row presentation; the controller stays transport agnostic. */
export function presentContext(context: TuiContext): TuiContext {
  const guide: TuiReadonlyView = { title: '连接配置与执行位置', fields: [
    { label: '目标', value: `${context.label}\n${context.target ?? context.id}` },
    { label: '身份提示', value: context.identityHint ?? '尚未核实；配置不代表当前认证' },
  ] };
  if (context.kind === 'local') {
    guide.fields = [...guide.fields, { label: '本机', value: '使用当前用户的本机环境。t读取本机状态，不自动执行doctor；需要完整检查时进入 :doctor。' }];
    return { ...context, actionRoutes: { ...context.actionRoutes, 'test-context': { resourceId: 'status', contextId: context.id } }, detailViews: { ...context.detailViews, 'connection-guide': guide } };
  }
  if (context.kind === 'ssh') {
    guide.fields = [...guide.fields,
      { label: '配置', value: '从当前用户 SSH 配置中的明确 Host 别名自动读取。a选择已有连接方式；不另建SSH连接清单，不编辑 SSH 配置。' },
      { label: '同一用户', value: '发现、检测与体检均在所选 SSH 别名对应的同一远端用户下执行。原生聊天与恢复请回目标机器的该用户环境。' },
      { label: '回程', value: 't只验证本次远端读取能力，不代表反向回程已通。需要回程时在目标用户环境配置指向本机的连接，再分别检测。' },
      { label: '失败处理', value: '认证失败请核对SSH别名、密钥和known_hosts；PATH或接口缺失请在目标用户环境安装本轮crosschat。失败不会改读本机会话。' },
    ];
    return { ...context, actionRoutes: { ...context.actionRoutes, 'test-context': { resourceId: 'ssh', contextId: context.id, query: { operation: 'check' } } }, detailViews: { ...context.detailViews, 'connection-guide': guide } };
  }
  if (context.kind === 'tcp') {
    guide.fields = [...guide.fields,
      { label: '配置', value: '来自当前用户已有TCP配置；a可导入完整现有配置，只追加新星、不替换凭证、不启动服务。' },
      { label: '权限与检测', value: 't仅认证并读取所选星的只读快照，不批量扫描原生会话。本次权限以返回结果为准；配置身份不代表已认证。' },
      { label: '原生会话与回程', value: '进入后默认节点列表，v查看星内成员，b才切完整发现范围。原生聊天在对应机器工具中进行；回程需目标配置并单独核对。' },
    ];
    return { ...context, actionRoutes: { ...context.actionRoutes, 'test-context': { resourceId: 'machines', contextId: context.id } }, detailViews: { ...context.detailViews, 'connection-guide': guide } };
  }
  const reason = '此连接类型尚未登记检测能力。';
  guide.fields = [...guide.fields, { label: '下一步', value: `${reason}当前可查看已配置目标；不要把配置身份当作已认证权限。` }];
  return { ...context, actionAvailability: { ...context.actionAvailability, 'test-context': { enabled: false, reason, nextStep: '使用已支持的本机或SSH连接；TCP资源按后续任务接入。' } }, detailViews: { ...context.detailViews, 'connection-guide': guide } };
}
