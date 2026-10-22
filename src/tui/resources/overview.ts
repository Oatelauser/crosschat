import type { DoctorObservation, LocalOverview, OverviewResult, ServiceObservation, StatusOverview, WatchdogObservation } from '../../application/observations/overview.js';
import type { TuiAction, TuiField, TuiPage, TuiReadonlyView, TuiResource, TuiResourceAdapter, TuiRow } from '../model.js';

interface OverviewResourceOptions { overview: LocalOverview }
const levels = { pass: '通过', warn: '警告', error: '错误', info: '提示' };

function info(page: OverviewResult): TuiReadonlyView {
  return { title: '完整读取信息', fields: [
    { label: '完整性', value: page.completeness }, { label: '采样时间', value: new Date(page.observedAt).toISOString() },
    ...page.errors.map((error) => ({ label: `${error.source} <${error.kind}>`, value: `${error.message}\n下一步：${error.nextStep}` })),
  ] };
}
function infoAction(resourceId: string): TuiAction {
  return { id: 'info', label: '读取信息', shortcut: 'i', ownerResourceId: resourceId, selectionPolicy: 'none', mutation: false, kind: 'detail', viewId: 'info', returnPolicy: 'restore' };
}
function unavailable(): TuiPage {
  return { rows: [], completeness: 'unavailable', notice: '此观察资源仅支持已选本机连接；请返回 :ctx 选择本机。' };
}
function serviceState(service: ServiceObservation): string {
  if (service.state === 'revoked') return service.pause?.state === 'revoked' ? '凭证已撤销，重连已暂停<revoked>' : '暂停状态未知<unknown>；快照<revoked>';
  const readiness = { ready: '就绪', starting: '启动中', waiting: '等待重连', stopped: '已停止', unknown: '未知' };
  return `${readiness[service.readiness]}<${service.readiness}>；快照<${service.state}>`;
}
function watchdogState(value: WatchdogObservation): string {
  return value.running === null ? '未知<unknown>' : value.running ? `运行迹象<${value.evidence}>` : `未运行<${value.evidence}>`;
}

function statusRows(page: StatusOverview, contextId: string): TuiRow[] {
  const row = (id: string, scope: string, name: string, state: string, target: string, fields: readonly TuiField[]): TuiRow => ({
    id: `overview:${id}`, cells: { name, scope, state }, navigate: { resourceId: target, contextId },
    copyValue: `${name}：${state}`, searchText: [name, scope, state, ...fields.map((field) => `${field.label} ${field.value}`)].join(' '),
    detail: [{ label: '项目', value: name }, { label: '结果', value: state }, { label: '采样时间', value: new Date(page.observedAt).toISOString() }, ...fields],
  });
  const ssh = page.connections.filter((item) => item.kind === 'ssh');
  const tcp = page.connections.filter((item) => item.kind === 'tcp');
  const connectionFields = (items: typeof ssh): TuiField[] => items.map((item) => ({ label: item.name, value: `${item.target}\n配置引用：${item.id}\n配置不代表已认证或在线` }));
  const latest = page.lastDoctor;
  const doctorState = latest?.summary ? `${latest.summary.pass} 项通过，${latest.summary.warn} 项警告，${latest.summary.error} 项错误` : '尚未体检<not_run>';
  return [
    row('sessions', '本机会话', '原生会话来源', page.providers.length ? page.providers.map((provider) => `${provider.providerId} ${provider.count}（匿名 ${provider.anonymous}）${provider.completeness === 'complete' ? '' : `；不完整<${provider.completeness}>`}`).join(' / ') : '会话来源尚无可确认结果', 'sessions',
      page.providers.map((provider) => ({ label: provider.providerId, value: `已观察 ${provider.count}；匿名 ${provider.anonymous}；完整性 ${provider.completeness}` }))),
    row('ssh', '连接配置', 'SSH 目标', `${ssh.length} 个已配置；未执行连接检测`, 'ctx', connectionFields(ssh)),
    row('tcp', '连接配置', 'TCP 关联配置', `${tcp.length} 个配置连接；认证与在线状态未核实`, 'ctx', connectionFields(tcp)),
    row('services', '本机服务', 'broker / 节点快照', page.services.length ? page.services.map((service) => `${(service.brokerAlias ?? service.selector) || service.kind}：${serviceState(service)}`).join(' / ') : '未观察到服务快照', 'services',
      page.services.map((service) => ({ label: service.file, value: `${serviceState(service)}\n时效 ${service.freshness}；更新时间 ${service.lastUpdated}；PID ${service.pid ?? '未提供'}；PID 活性 ${service.processAlive === undefined ? '未知' : service.processAlive}\n${service.pause?.message ?? ''}` }))),
    row('outbox', '投递', '发件箱 / 看门狗', `${page.outbox.items === null ? '条数未知<unknown>' : `${page.outbox.items} 条暂存`}；看门狗${watchdogState(page.watchdog)}`, 'outbox', [
      { label: '队列线程', value: String(page.outbox.threads) }, { label: '暂存条数', value: page.outbox.items === null ? '未知<unknown>' : String(page.outbox.items) },
      { label: '看门狗证据', value: JSON.stringify(page.watchdog) },
    ]),
    row('doctor', '诊断', '本次 TUI 最近体检', doctorState, 'doctor', latest ? [
      { label: '体检采样时间', value: new Date(latest.observedAt).toISOString() }, { label: '体检完整性', value: latest.completeness },
      { label: '缓存范围', value: '仅本次 TUI；查看总览不会重新运行体检' },
    ] : [{ label: '下一步', value: '按 Enter 进入 doctor 按需体检；总览不会自动运行体检' }]),
  ];
}

export function createStatusResource(options: OverviewResourceOptions): { resource: TuiResource; adapter: TuiResourceAdapter } {
  const resource: TuiResource = { id: 'status', label: '状态总览', aliases: [], description: '本机只读状态与来源证据', columns: [
    { id: 'name', label: '项目', width: 26, priority: 2 }, { id: 'scope', label: '范围', width: 14 }, { id: 'state', label: '结果', width: 58, priority: 1 },
  ], actions: [
    { id: 'overview-open', label: '进入对应资源', shortcut: 'Enter', ownerResourceId: 'status', selectionPolicy: 'required', mutation: false, kind: 'navigate', returnPolicy: 'restore' },
    { id: 'detail', label: '只读详情', shortcut: 'd', ownerResourceId: 'status', selectionPolicy: 'required', mutation: false, kind: 'detail', returnPolicy: 'restore' }, infoAction('status'),
  ] };
  return { resource, adapter: { async read(request) {
    if (request.context?.kind !== 'local') return unavailable();
    const page = await options.overview.readStatus({ contextId: request.context.id, signal: request.signal });
    return { rows: page.completeness === 'cancelled' ? [] : statusRows(page, request.context.id), completeness: page.completeness, sampledAt: page.observedAt,
      detailViews: { info: info(page) }, ...(page.errors.length ? { notice: '部分读取需关注；i 查看完整来源与下一步' } : {}) };
  } } };
}

function doctorPage(page: DoctorObservation): TuiPage {
  return { rows: page.checks.map((check) => ({ id: check.id, cells: { name: check.label, group: check.group, state: `${levels[check.level]}<${check.level}>`, description: check.description },
    copyValue: check.guidance, searchText: `${check.group} ${check.code} ${check.label} ${check.level} ${check.description} ${check.guidance}`,
    detail: [{ label: '检查项', value: check.label }, { label: '分组', value: check.group }, { label: '原始检查码', value: check.code },
      { label: '结果', value: `${levels[check.level]}<${check.level}>` }, { label: '说明', value: check.description }, { label: '处理指引', value: check.guidance },
      { label: '执行位置', value: '当前本机；TUI 不自动执行处理指引' }, { label: '采样时间', value: new Date(page.observedAt).toISOString() }, ...check.facts],
  })), completeness: page.completeness, sampledAt: page.observedAt, detailViews: { info: info(page) },
    notice: page.summary ? `${page.summary.pass} 项通过，${page.summary.warn} 项警告，${page.summary.error} 项错误；y 复制指引，由用户执行` : '体检未完成；i 查看读取信息与下一步' };
}
export function createDoctorResource(options: OverviewResourceOptions): { resource: TuiResource; adapter: TuiResourceAdapter } {
  const resource: TuiResource = { id: 'doctor', label: '体检', aliases: [], description: '按需检查与只读处理指引', columns: [
    { id: 'name', label: '检查项', width: 24, priority: 2 }, { id: 'group', label: '分组', width: 18 }, { id: 'state', label: '结果', width: 14, priority: 1 }, { id: 'description', label: '说明', width: 52 },
  ], actions: [infoAction('doctor')] };
  return { resource, adapter: { async read(request) {
    if (request.context?.kind !== 'local') return unavailable();
    return doctorPage(await options.overview.readDoctor({ contextId: request.context.id, signal: request.signal }));
  } } };
}
