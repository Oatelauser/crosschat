import type { SshApplication, SshInspection } from '../../application/ssh/index.js';
import { doctorObservation } from '../../application/observations/overview.js';
import { parseDiagnosticResult } from '../../application/diagnostics/query.js';
import { untilAborted } from '../../application/sessions/reading.js';
import { validateRemoteFlagValues } from '../../federation.js';
import type { TuiAction, TuiActionAvailability, TuiField, TuiPage, TuiReadRequest, TuiReadonlyView, TuiResource, TuiResourceAdapter, TuiRow } from '../model.js';
import { doctorPage, doctorResource } from './overview.js';
import { createSessionsResource } from './sessions.js';
import type { SessionsResourceOptions } from './sessions.js';

interface SshResourceOptions { ssh: SshApplication }
const validHost = (host: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(host);
function disabled(reason: string, nextStep = '返回 :ctx 或 :ssh 选择已配置 SSH Host；不会回退本机。'): TuiActionAvailability { return { enabled: false, reason, nextStep }; }
function action(id: string, label: string, shortcut: string, kind: TuiAction['kind'], extra: Partial<TuiAction> = {}): TuiAction {
  return { id, label, shortcut, kind, ownerResourceId: 'ssh', selectionPolicy: 'required', mutation: false, returnPolicy: 'restore', ...extra };
}
const resource: TuiResource = { id: 'ssh', label: 'SSH 对端', aliases: [], description: '已有 Host、同用户远端会话和按需只读检测',
  columns: [{ id: 'name', label: 'SSH Host', width: 24, priority: 100 }, { id: 'state', label: '读取状态', width: 30, priority: 90 }, { id: 'description', label: '身份与范围', width: 52, priority: 50 }],
  actions: [action('sessions', '进入远机会话', 'Enter', 'navigate'), action('detail', '只读对端详情', 'd', 'detail'),
    action('aliases', '选择已有 SSH Host', 'a', 'route-choice', { selectionPolicy: 'none' }), action('check', '检测选中对端', 't', 'navigate'),
    action('doctor', '对端体检', 'D', 'navigate'), action('guide', '配置与回程指引', 'g', 'detail', { viewId: 'guide' }),
    action('copy', '复制 SSH Host', 'y', 'copy'), action('info', '读取信息', 'i', 'detail', { selectionPolicy: 'none', viewId: 'info' })] };

function guide(host: string): TuiReadonlyView {
  return { title: 'SSH 配置与回程指引', fields: [
    { label: '当前目标', value: host }, { label: '配置来源', value: '自动读取本机 ~/.ssh/config 中明确的 Host 别名；不编辑配置，不保存密码或私钥。' },
    { label: '同一用户', value: `会话发现与 doctor 都由 SSH Host ${host} 当前配置选定的远端用户执行；不会改用本机或其他用户的数据。` },
    { label: '检测范围', value: 't 只验证一次远端只读 discover 接口；不运行有补投副作用的 status，不说明全部会话已读取，也不证明反向回程可达。' },
    { label: '原生操作', value: '需要聊天或恢复会话时，请回到目标原生窗口；需要命令时先在原生终端选择此已配置 Host 登录同一用户，再核对目标会话。TUI 不代替任何原生会话聊天。' },
    { label: '回程', value: '双向通信还需对端能够通过发送方 hostname 对应的 SSH Host 免密返回；TUI 不自动探测回程。单向 NAT 情况请参阅 docs/federation.md。' },
    { label: '接口不支持', value: '在同一 SSH 用户下升级 crosschat，以支持 discover 与 doctor --json；无旧端文本降级。' },
  ] };
}
function invalid(message: string, cancelled = false): TuiPage {
  return { rows: [], completeness: cancelled ? 'cancelled' : 'unavailable', notice: message,
    detailViews: { info: { title: 'SSH 读取信息', fields: [{ label: '原因', value: message }, { label: '下一步', value: '返回 :ctx 或 :ssh 核对已配置的 Host 后重新选择；不会读取本机作为替代。' }] } } };
}
function routes(contextId: string) {
  return { sessions: { resourceId: 'sessions', contextId }, check: { resourceId: 'ssh', contextId, query: { operation: 'check' } }, doctor: { resourceId: 'doctor', contextId } };
}
function errorsInfo(completeness: TuiPage['completeness'], errors: readonly { source: string; kind: string; message: string; nextStep: string }[], extra: readonly TuiField[] = []): TuiReadonlyView {
  return { title: 'SSH 读取信息', fields: [{ label: '完整性', value: completeness }, ...extra,
    { label: '来源与下一步', value: errors.length ? errors.map((error) => `${error.source} <${error.kind}>：${error.message}\n${error.nextStep}`).join('\n\n') : '无来源错误；配置记录不代表已经认证，检测也不证明反向回程。' }] };
}
function inspectionPage(result: SshInspection): TuiPage {
  const details: TuiField[] = [{ label: '连接上下文', value: result.contextId }, { label: '目标 Host', value: result.host },
    { label: '检测范围', value: `只读接口单页采样 ${result.sampleCount} 个会话；没有宣称全量发现；未检测反向回程。` },
    { label: '工具能力', value: JSON.stringify(result.providers, null, 2) }, { label: '采样时间', value: new Date(result.observedAt).toISOString() }];
  const ok = result.completeness === 'complete' || result.completeness === 'partial';
  return { rows: result.completeness === 'cancelled' ? [] : [{ id: `ssh-inspection:${result.contextId}`, contextId: result.contextId,
    cells: { name: result.host, state: ok ? `只读接口有响应<${result.completeness}>` : `检测未完成<${result.completeness}>`, description: '当前 SSH 用户；单页采样；回程未检测' },
    copyValue: result.host, detail: details, detailViews: { guide: guide(result.host) }, actionRoutes: routes(result.contextId) }],
    completeness: result.completeness, sampledAt: result.observedAt, notice: '仅检测选中 Host 的只读接口；Enter 查看全量远机会话，D 体检；回程未检测。',
    actionAvailability: { aliases: disabled('此页是选中 Host 的检测结果。', 'Esc 返回 SSH 对端列表，再按 a 选择其他已有 Host。') }, detailViews: { info: errorsInfo(result.completeness, result.errors, details) } };
}

/** SSH execution is injected; listing configuration itself never probes a remote machine. */
export function createSshResource(options: SshResourceOptions): { resource: TuiResource; adapter: TuiResourceAdapter } {
  return { resource, adapter: { async read(request) {
    const query = request.route?.query ?? {};
    if (Object.keys(query).some((key) => key !== 'operation') || (query.operation !== undefined && query.operation !== 'check')) return invalid('SSH 路由无效，未执行读取。');
    if (request.signal.aborted) return invalid('SSH 读取已取消。', true);
    try {
      if (query.operation === 'check') {
        if (!request.context || request.context.kind !== 'ssh' || (request.route?.contextId !== undefined && request.route.contextId !== request.context.id)) return invalid('检测目标不是有效的所选 SSH 上下文，未执行读取。');
        const result = await untilAborted(options.ssh.inspect({ contextId: request.context.id, signal: request.signal }), request.signal);
        return request.signal.aborted ? invalid('SSH 检测已取消。', true) : inspectionPage(result);
      }
      const listed = await untilAborted(options.ssh.list(request.signal), request.signal);
      if (request.signal.aborted) return invalid('SSH 列表读取已取消。', true);
      const completeness = listed.errors.length ? listed.items.length ? 'partial' : 'unavailable' : 'complete';
      const rows: TuiRow[] = listed.items.map((item) => {
        const safe = validHost(item.target) && item.id === `ssh:${encodeURIComponent(item.target)}`;
        const availability = safe ? {} : Object.fromEntries(['sessions', 'check', 'doctor', 'copy'].map((id) => [id, disabled('Host 别名不符合现有安全执行规则。', '在原生 SSH 配置中改用字母、数字、点、下划线、连字符组成的 Host 别名。')]));
        return { id: item.id, contextId: item.id, cells: { name: item.name, state: '已配置，尚未检测<configured>', description: item.identityHint },
          searchText: `${item.name} ${item.target} ${item.identityHint}`, copyValue: safe ? item.target : undefined,
          detail: [{ label: 'Host 别名', value: item.target }, { label: '连接上下文', value: item.id }, { label: '身份提示', value: item.identityHint }, { label: '来源', value: typeof item.attributes.source === 'string' ? item.attributes.source : '~/.ssh/config' }],
          detailViews: { guide: guide(item.target) }, actionRoutes: safe ? routes(item.id) : {}, actionAvailability: availability };
      });
      return { rows, completeness, sampledAt: listed.observedAt, notice: completeness === 'unavailable' ? 'SSH 配置来源不可用，尚不能确认已有 Host；i 查看原因与下一步。' : `${rows.length} 个已有 SSH Host；未执行网络检测。a 选择已有 Host；不改写 SSH 配置。`,
        routeChoices: { aliases: { title: '选择已有 SSH Host（当前配置已自动包含）', options: listed.items.map((item) => {
          const enabled = validHost(item.target) && item.id === `ssh:${encodeURIComponent(item.target)}`;
          return { value: item.id, label: `${item.name} · ${item.identityHint}`, enabled, ...(!enabled ? { reason: 'Host 不符合现有安全别名规则' } : {}), route: { resourceId: 'sessions', contextId: item.id } };
        }) } },
        detailViews: { info: errorsInfo(completeness, listed.errors) } };
    } catch { return invalid(request.signal.aborted ? 'SSH 读取已取消。' : 'SSH 来源无法读取，请核对配置和对应接口。', request.signal.aborted); }
  } } };
}

export function createSshDoctorResource(options: SshResourceOptions): { resource: TuiResource; adapter: TuiResourceAdapter } {
  return { resource: doctorResource, adapter: { async read(request) {
    if (!request.context || request.context.kind !== 'ssh' || (request.route?.contextId !== undefined && request.route.contextId !== request.context.id) || Object.keys(request.route?.query ?? {}).length) return invalid('远端体检需要有效的所选 SSH 上下文。');
    if (request.signal.aborted) return invalid('SSH 体检已取消。', true);
    try {
      const result = await untilAborted(options.ssh.doctor({ contextId: request.context.id, signal: request.signal }), request.signal);
      if (request.signal.aborted) return invalid('SSH 体检已取消。', true);
      const location = `远端 SSH Host ${result.host} 的同一 SSH 用户；TUI 不自动执行处理指引`;
      const observed = result.result === null ? { checks: [], summary: null, completeness: result.completeness, observedAt: result.observedAt, errors: result.errors }
        : doctorObservation(parseDiagnosticResult(result.result), result.observedAt);
      const page = doctorPage({ ...observed, checks: observed.checks.map((check) => ({ ...check, guidance: `执行位置：远端 SSH Host ${result.host} 的同一 SSH 用户。\n${check.guidance}` })) }, location);
      return { ...page, rows: page.rows.map((row) => ({ ...row, contextId: request.context!.id })),
        detailViews: { info: { ...page.detailViews!.info, fields: [{ label: '连接上下文', value: request.context.id }, { label: '执行位置', value: location }, { label: '远端退出码', value: result.exitCode === null ? '未知' : String(result.exitCode) }, ...page.detailViews!.info.fields] } } };
    } catch { return invalid(request.signal.aborted ? 'SSH 体检已取消。' : 'SSH 体检未完成或结果无效；不会解析旧文本或回退本机。', request.signal.aborted); }
  } } };
}

function sshContext(request: TuiReadRequest): boolean {
  const context = request.context;
  return context?.kind === 'ssh' && context.target !== undefined && validHost(context.target) && context.id === `ssh:${encodeURIComponent(context.target)}`
    && (request.route?.contextId === undefined || request.route.contextId === context.id) && Object.keys(request.route?.query ?? {}).length === 0;
}

/** Reuse provider-neutral pagination/facets while retaining the SSH context and disabling local-only actions. */
export function createSshSessionsResource(options: SshResourceOptions & Pick<SessionsResourceOptions, 'statusRegistry' | 'nativeGuides' | 'pageSize' | 'now'>): { resource: TuiResource; adapter: TuiResourceAdapter } {
  const sessions = createSessionsResource({ ...options, discovery: options.ssh.discovery, contextKinds: ['ssh'] });
  const localOnly = disabled('此动作只支持本机对应资源；SSH 读取不修改本机册位或关联本机记录。', '返回本机上下文操作；远端原生操作请在所选 Host 的同一 SSH 用户下执行。');
  return { resource: { ...sessions.resource, description: '同一 SSH 用户的完整可发现会话、匿名、筛选与只读详情' }, adapter: { async read(request) {
    if (!sshContext(request)) return invalid('远机会话需要完整且有效的已配置 SSH 上下文。');
    const page = await sessions.adapter.read(request);
    const host = request.context!.target!;
    return { ...page, actionAvailability: { ...page.actionAvailability, adopt: localOnly, 'remove-member': localOnly, deliveries: localOnly, logs: localOnly,
      'filter-scope': disabled('SSH 发现没有可核验的当前星成员范围。', '本页展示此 SSH 用户可发现的会话；TCP 星范围在对应 TCP 上下文查看。') },
      rows: page.rows.map((row) => {
        const address = row.copyValue;
        let copyValue: string | undefined;
        if (address && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(address)) {
          try { validateRemoteFlagValues({ to: address }); copyValue = `crosschat send --via ssh:${host} --to ${address}`; } catch { /* Existing remote selector cannot accept this address. */ }
        }
        const original = row.detailViews?.['native-guide'];
        const fields = (original?.fields ?? []).filter((field) => field.label !== '寻址指引');
        return { ...row, copyValue, actionRoutes: {},
          actionAvailability: { ...row.actionAvailability, adopt: localOnly, 'remove-member': localOnly, deliveries: localOnly, logs: localOnly,
            ...(!copyValue ? { copy: disabled('此目标尚无可安全复制且无歧义的现有 SSH 发送地址。', 'Y 复制完整会话引用；g 核对原生窗口、SSH 用户与寻址范围。') } : {}) },
          detailViews: { ...row.detailViews, 'native-guide': { title: original?.title ?? '远端原生操作', fields: [
            { label: '执行位置', value: `远端 SSH Host ${host}，与发现时相同的 SSH 用户；请先回到对应原生窗口。任何恢复命令都不得在本机执行。` }, ...fields,
            { label: '寻址指引', value: copyValue ? `可复制命令模板：${copyValue}\n只供当前用户在原生终端核对目标并自行补充正文；不代表选中原生会话发言。` : '没有可确认的跨机发送地址；完整引用用于核对身份，不冒充可直接发送地址。' },
          ] } },
        };
      }), notice: `${page.notice ?? ''} 当前读取远端 Host ${host} 的同一 SSH 用户；原生聊天在原窗口继续。` };
  } } };
}
