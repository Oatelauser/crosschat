import { createHash } from 'node:crypto';
import { parseNodeConfig } from '../../serve/node-config.js';
import { STAR_NAME_RE, sanitizeName } from '../../serve/registry.js';
import { machineCredentialRevision } from '../../serve/management-state.js';
import { sanitizeTool } from '../../serve/protocol.js';
import { requestAdminOp, requestMemberRemoveExact, SenderConn } from '../../serve/via-tcp.js';
import { parseDiscoveryResponse } from '../discovery/boundary.js';
import { createLocalDiscoveryService } from '../discovery/local.js';
import type { DiscoveryEndpoint, DiscoverySession } from '../discovery/model.js';
import { createSessionMembershipService } from '../session-membership/index.js';
import type { SessionMembershipService } from '../session-membership/index.js';
import { readMembershipMachineId } from '../session-membership/machine.js';
import { checkAbort, isRecord } from '../queries/reading.js';
import { untilAborted } from '../sessions/reading.js';
import { sessionKey } from '../sessions/model.js';
import type { SessionRef } from '../sessions/model.js';
import type { TcpApplication, TcpReadResult, TcpRole, TcpStar, TcpStarResult } from './model.js';
import { fullTcpMachineId, resolveTcpContext } from './reading.js';
import { executeLocalManagement } from './local-management.js';
import type { ManagementRequest, ManagementResult } from '../management/local.js';
import type { MemberRemoveExactResultFrame } from '../../serve/protocol.js';

export type TcpManagementAction = 'add-star' | 'rename-star' | 'remove-star' | 'set-show-name' | 'rename-node'
  | 'generate-node-key' | 'generate-admin-key' | 'remove-node' | 'revoke-credential' | 'remove-member' | 'adopt-session';
export interface TcpManagementField {
  id: string;
  label: string;
  required?: boolean;
  initialValue?: string;
  options?: readonly { value: string; label: string; enabled?: boolean; reason?: string }[];
}
export interface TcpManagementRequest {
  contextId: string;
  action: TcpManagementAction;
  starId?: string;
  targetId?: string;
  targetRevision?: string;
  values: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}
export interface TcpManagementPreview {
  enabled: boolean;
  reason?: string;
  nextStep?: string;
  revision: string;
  fields: readonly TcpManagementField[];
  impact: readonly { label: string; value: string }[];
}
/** Deliberate, one-use result material. Never put this field in ordinary pages, notices or history. */
export interface TcpManagementSecret {
  kind: 'node-configs' | 'admin-fragment';
  title: string;
  materials: readonly { label: string; content: string; connectCommand?: string }[];
  notice: string;
}
export interface TcpManagementResult {
  kind: 'applied' | 'rejected' | 'uncertain';
  message: string;
  selectedId?: string;
  mode?: 'hot' | 'cold';
  secret?: TcpManagementSecret;
}
export interface TcpManagement {
  preview(request: TcpManagementRequest): Promise<TcpManagementPreview>;
  apply(request: TcpManagementRequest & { expectedPreviewRevision: string }): Promise<TcpManagementResult>;
}
export interface TcpManagementOptions {
  baseDir: string;
  catalog: Pick<TcpApplication, 'readStars' | 'readStar'>;
  membership?: SessionMembershipService;
  discovery?: DiscoveryEndpoint;
  now?(): number;
  executeLocal?(request: ManagementRequest, signal?: AbortSignal): Promise<ManagementResult<unknown>>;
  openRemote?(request: { contextId: string; starId: string; identity: 'member' | 'admin'; signal?: AbortSignal }): Promise<TcpManagementConnection>;
  machineId?(): string | undefined | Promise<string | undefined>;
}
export interface TcpManagementConnection {
  starId?: string;
  request(action: string, params: Readonly<Record<string, unknown>>): Promise<unknown>;
  removeMember(target: { sessionId: string; machine: string; tool: string }): Promise<MemberRemoveExactResultFrame>;
  close(): void;
}

interface Prepared {
  preview: TcpManagementPreview;
  star?: TcpStar;
  local?: ManagementRequest;
  member?: { sessionId: string; machine: string; tool: string };
  adopt?: SessionRef;
  machine?: { machineId: string; labels: string[] };
  values: Readonly<Record<string, string>>;
}
class Denied extends Error {}
const secretNotice = '仅在此结果页展示新钥匙。复制后清屏；不要粘贴到聊天、普通日志或版本库。关闭后不能重新查看。';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uncertain = (): TcpManagementResult => ({ kind: 'uncertain', message: '修改请求未取得可核实的完成回执；可能已经生效，请刷新并核实目标，不要直接重复执行。' });
function destination(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase();
  return host.length > 0 && host.length <= 253 && !/[\s/\\@?#]/.test(host) && ![...host].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    && !['0.0.0.0', '::', '::1', 'localhost'].includes(bare) && !/^127\./.test(bare)
    && !bare.endsWith('.localhost');
}
function managementMetadata(current: TcpReadResult & { staticComplete?: boolean }, contextId: string, role: TcpRole | null): boolean {
  if (current.contextId !== contextId) return false;
  if (current.completeness === 'complete' && current.errors.length === 0) return true;
  return contextId === 'local' && role === 'broker-owner' && current.completeness === 'partial' && current.staticComplete === true;
}
function selectedStar(current: TcpStarResult, request: TcpManagementRequest): TcpStar {
  if (current.star === null || !managementMetadata(current, request.contextId, current.star.role)
    || current.star.contextId !== request.contextId || current.star.starId !== request.starId) throw new Denied('当前星的完整目标和权限未能核实，请刷新后重新选择。');
  return current.star;
}
function defaultValues(request: TcpManagementRequest, star?: TcpStar): Readonly<Record<string, string>> {
  const initial: Record<string, string> = request.action === 'generate-node-key' ? { count: '1', host: star !== undefined && destination(star.host) ? star.host : '' }
    : request.action === 'set-show-name' ? { scope: 'star', name: '' } : {};
  return { ...initial, ...request.values };
}
function shellConnect(starId: string): string | undefined {
  return /^[A-Za-z0-9._-]+$/.test(starId) ? `crosschat serve --connect ${starId}` : undefined;
}
function nodeSecret(value: unknown, star: TcpStar, values: Readonly<Record<string, string>>): TcpManagementSecret | undefined {
  if (!isRecord(value) || !Array.isArray(value.results) || value.results.length !== Number(values.count)) return undefined;
  const labels = new Set<string>();
  const materials: TcpManagementSecret['materials'][number][] = [];
  for (const item of value.results) {
    if (!isRecord(item) || typeof item.label !== 'string' || !STAR_NAME_RE.test(item.label) || labels.has(item.label)
      || typeof item.key !== 'string' || item.key === '' || typeof item.nodeJsonContent !== 'string' || Buffer.byteLength(item.nodeJsonContent) > 64 * 1024) return undefined;
    labels.add(item.label);
    try {
      const config = parseNodeConfig(item.nodeJsonContent);
      const entry = config.entries[0];
      if (config.entries.length !== 1 || entry.starId !== star.starId || entry.host !== values.host || entry.port !== star.port || entry.key !== item.key || entry.adminKey !== undefined) return undefined;
    } catch { return undefined; }
    materials.push({ label: item.label, content: item.nodeJsonContent, ...(shellConnect(star.starId) === undefined ? {} : { connectCommand: shellConnect(star.starId) }) });
  }
  return { kind: 'node-configs', title: '新节点配置', materials, notice: secretNotice };
}
function adminSecret(value: unknown, label: string): TcpManagementSecret | undefined {
  if (!isRecord(value) || !isRecord(value.result) || value.result.label !== label || typeof value.result.adminKey !== 'string' || value.result.adminKey === '') return undefined;
  return { kind: 'admin-fragment', title: '新星管理钥', materials: [{ label, content: JSON.stringify({ adminKey: value.result.adminKey }, null, 2) }],
    notice: `${secretNotice} 将此字段加入所选星已有的 node.json 条目；它不替代节点入星配置。` };
}

/** Domain-only management: fixed full identities, fresh previews and owned effects. */
export function createTcpManagement(options: TcpManagementOptions): TcpManagement {
  let discovery: DiscoveryEndpoint | undefined = options.discovery;
  let membership: SessionMembershipService | undefined = options.membership;
  const nativeServices = () => {
    discovery ??= createLocalDiscoveryService();
    membership ??= createSessionMembershipService({ baseDir: options.baseDir, discovery, now: options.now, machineId: options.machineId });
    return { discovery, membership };
  };
  async function localCandidates(signal?: AbortSignal): Promise<DiscoverySession[]> {
    const service = nativeServices().discovery;
    const result: DiscoverySession[] = [];
    const cursors = new Set<string>();
    const refs = new Set<string>();
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
      checkAbort(signal);
      const response = parseDiscoveryResponse(await untilAborted(service.execute({ op: 'list', limit: 100, ...(cursor === undefined ? {} : { cursor }) }, { contextId: 'local', signal }), signal));
      if (response.op !== 'list' || response.page.completeness !== 'complete' || response.page.errors.length > 0) throw new Denied('本机会话来源未完整读取，暂不能选择收编目标。');
      for (const item of response.page.items) {
        if (item.ref.contextId !== 'local') throw new Denied('本机会话来源返回了其他连接的引用，不能收编。');
        if (item.ref.referenceKind === 'process') continue;
        const key = sessionKey(item.ref);
        if (refs.has(key)) throw new Denied('本机会话来源重复了完整引用，不能确定唯一目标。');
        refs.add(key); result.push(item);
        if (result.length > 5_000) throw new Denied('本机会话选择范围超过安全读取上限，请先缩小本机来源。');
      }
      if (response.page.nextCursor === null) return result;
      if (cursors.has(response.page.nextCursor)) throw new Denied('本机会话来源重复分页，不能确定完整候选。');
      cursors.add(response.page.nextCursor); cursor = response.page.nextCursor;
    }
    throw new Denied('本机会话候选超过分页上限，暂不能安全选择。');
  }
  async function prepare(request: TcpManagementRequest): Promise<Prepared> {
    let star: TcpStar | undefined;
    const fields: TcpManagementField[] = [];
    const impact: TcpManagementPreview['impact'][number][] = [{ label: '连接', value: request.contextId }];
    let local: ManagementRequest | undefined;
    let member: Prepared['member'];
    let adopt: SessionRef | undefined;
    let machine: Prepared['machine'];
    let state: unknown;
    let values = defaultValues(request);
    let reason: string | undefined;
    let nextStep: string | undefined;
    try {
      checkAbort(request.signal);
      if (request.action === 'add-star') {
        const stars = await options.catalog.readStars({ contextId: request.contextId, signal: request.signal });
        state = stars.items.map((item) => [item.starId, item.revision]);
        fields.push({ id: 'name', label: '星名', required: true });
        if (request.contextId !== 'local' || stars.role !== 'broker-owner' || !managementMetadata(stars, request.contextId, stars.role)) throw new Denied('加星只支持已核实的本机 broker 主身份。');
        if (values.name !== undefined && (!STAR_NAME_RE.test(values.name) || stars.items.some((item) => item.name?.toLowerCase() === values.name.toLowerCase() || item.starId === values.name))) throw new Denied('星名须为 1–32 个字母、数字、点、下划线或短横线，并且不能与现有星冲突。');
        impact.push({ label: '操作', value: '新建星；沿用现有 broker 管理冷热路径。' });
        local = { op: 'add-star', name: values.name ?? '' };
      } else {
        if (!request.starId) throw new Denied('缺少所选星的完整 ID，请回列表重新选择。');
        const current = await options.catalog.readStar({ contextId: request.contextId, starId: request.starId, signal: request.signal });
        star = selectedStar(current, request); state = { revision: star.revision, role: star.role };
        values = defaultValues(request, star);
        impact.push({ label: '星', value: `${star.name ?? '未命名'} · ${star.starId}` });
        if (request.targetRevision !== undefined && request.targetId === star.id && request.targetRevision !== star.revision) throw new Denied('所选星已变化，请刷新列表重新确认。');
        const owner = request.contextId === 'local' && star.role === 'broker-owner';
        switch (request.action) {
          case 'rename-star':
            fields.push({ id: 'name', label: '新星名', required: true, initialValue: star.name ?? '' });
            if (!owner) throw new Denied('改星名仅限本机 broker 主。');
            if (request.targetId !== undefined && request.targetId !== star.id) throw new Denied('所选星行已变化，请重新选择。');
            if (values.name !== undefined && !STAR_NAME_RE.test(values.name)) throw new Denied('星名须为 1–32 个字母、数字、点、下划线或短横线。');
            local = { op: 'set-name', starId: star.starId, name: values.name ?? '' };
            impact.push({ label: '操作', value: '修改此完整星 ID 的显示名，保留星身份。' });
            break;
          case 'generate-node-key': {
            fields.push({ id: 'count', label: '数量（1–10）', required: true, initialValue: '1' }, { id: 'host', label: '接收机器可达的 broker 地址', required: true, initialValue: destination(star.host) ? star.host : '' });
            if (!owner && star.role !== 'star-admin') throw new Denied('发节点钥需要本机 broker 主或当前星管理身份。');
            if (!/^([1-9]|10)$/.test(values.count) || (values.host !== '' && !destination(values.host))) throw new Denied('数量须为 1–10；地址须可供接收机器访问，不能填本机或通配监听地址。');
            local = { op: 'gen-key', starId: star.starId, n: Number(values.count), host: values.host, port: star.port };
            impact.push({ label: '发放', value: `${values.count} 份新节点配置；地址 ${values.host || '待填写'}:${star.port}` }, { label: '钥匙', value: '生成后仅在独立结果页显示一次，退出结果页即清除。' });
            break;
          }
          case 'generate-admin-key':
            fields.push({ id: 'label', label: '管理钥标签', required: true });
            if (!owner) throw new Denied('发星管理钥仅限本机 broker 主。');
            if (values.label !== undefined && (!STAR_NAME_RE.test(values.label) || current.credentials.some((item) => item.label === values.label))) throw new Denied('标签须为 1–32 个字母、数字、点、下划线或短横线，且不能复用任何现有凭证标签。');
            local = { op: 'gen-admin-key', starId: star.starId, label: values.label ?? '' };
            impact.push({ label: '权限', value: '新管理钥可为此星发节点钥、撤节点凭证；不获得 broker 主权限。' });
            break;
          case 'set-show-name': {
            fields.push({ id: 'scope', label: '范围', initialValue: 'star', required: true, options: [{ value: 'star', label: '仅此星覆盖' }, { value: 'global', label: '本机全局默认' }] }, { id: 'name', label: '本机显示名（留空清除覆盖）' });
            const own = fullTcpMachineId(await (options.machineId?.() ?? readMembershipMachineId({ signal: request.signal })));
            const matches = current.machines.filter((item) => request.targetId === undefined ? item.machineId === own : item.id === request.targetId);
            if (matches.length !== 1 || own === undefined || matches[0].machineId !== own) throw new Denied('只可修改已核实为本机完整 machine ID 的机器行，不能代替远端机器改名。');
            if (values.scope !== 'star' && values.scope !== 'global') throw new Denied('显示名范围须为本机全局或仅此星。');
            state = { state, machineId: own };
            local = { op: 'set-showname', name: sanitizeName(values.name) ?? '', ...(values.scope === 'star' ? { starId: star.starId } : {}) };
            impact.push({ label: '本机', value: own }, { label: '范围', value: values.scope === 'star' ? '仅所选星；空名清除条目覆盖，恢复全局默认。' : '本机全局默认；已有星级覆盖保留。' }, { label: '生效', value: '更新本机配置；热态请求现有聚合器重挂，冷态需重连后才更新运行显示名。' });
            break;
          }
          case 'rename-node': {
            const item = current.machines.find((item) => item.id === request.targetId);
            if (!owner && star.role !== 'star-admin') throw new Denied('修改对端节点名称需要本机 broker 主或当前星管理身份。');
            if (!item || fullTcpMachineId(item.machineId) !== item.machineId) throw new Denied('所选完整机器已变化，请重新选择。');
            if (item.presence !== 'online') throw new Denied('对端节点未在线，不能保存并确认名称生效；不会排队或自动重试。');
            if (Object.keys(request.values).some((key) => key !== 'name')) throw new Denied('远程改名只允许修改当前星名称，不接受全局范围。');
            fields.push({ id: 'name', label: '当前星节点名称（留空恢复对端全局默认）', initialValue: item.name ?? '' });
            values = { name: request.values.name ?? item.name ?? '' };
            if (values.name.length > 32 || (values.name !== '' && sanitizeName(values.name) !== values.name)) throw new Denied('节点名称最多 32 字符，不能含控制符或前后空白。');
            state = { state, machineId: item.machineId, name: item.name, presence: item.presence };
            local = { op: 'rename-node', starId: star.starId, machineId: item.machineId, name: values.name };
            impact.push({ label: '完整机器', value: item.machineId }, { label: '范围', value: '只修改对端当前星的节点名称；保留全局默认、其他星与原生会话名称。' }, { label: '完成条件', value: '对端确认保存配置并立即生效；无需重启，缺少完成回执时请先核实。' });
            break;
          }
          case 'remove-member': {
            const item = current.members.find((candidate) => candidate.id === request.targetId);
            if (item === undefined || !item.nativeId || fullTcpMachineId(item.machineId) !== item.machineId || item.providerId === null || sanitizeTool(item.providerId) !== item.providerId) throw new Denied('所选册位缺少可核实的完整会话、机器或工具身份，不能精确删册。');
            member = { sessionId: item.nativeId, machine: item.machineId, tool: item.providerId };
            state = { state, member };
            impact.push({ label: '完整会话', value: item.nativeId }, { label: '机器', value: item.machineId }, { label: '工具', value: item.providerId }, { label: '操作', value: '仅删除此精确册位；不删除原生会话、不结束原生工具。' });
            break;
          }
          case 'adopt-session': {
            const services = nativeServices();
            const targets = await services.membership.listTargets({ contextId: 'local', signal: request.signal });
            const target = targets.stars.find((item) => item.id === star!.starId);
            if (targets.completeness !== 'complete' || targets.errors.length > 0 || target?.eligible !== true) throw new Denied('本机没有此完整星 ID 的唯一可用入星配置，不能代替远端机器收编。');
            const candidates = await localCandidates(request.signal);
            fields.push({ id: 'sessionRef', label: '本机现有会话', required: true, options: candidates.map((item) => ({ value: JSON.stringify(item.ref), label: `${item.name ?? '匿名'} · ${item.ref.providerId} · ${item.ref.nativeId}` })) });
            state = { state, candidates: candidates.map((item) => sessionKey(item.ref)) };
            if (values.sessionRef) {
              const candidate = candidates.find((item) => JSON.stringify(item.ref) === values.sessionRef);
              if (candidate === undefined) throw new Denied('所选本机会话完整引用已不存在，请刷新候选后重新选择。');
              const checked = await services.membership.check({ op: 'adopt', ref: candidate.ref, starId: star.starId, signal: request.signal });
              if (!checked.allowed) throw new Denied('所选本机会话当前不满足此星的收编条件，请核对本机来源、工具支持及入星权限。');
              adopt = candidate.ref;
            }
            impact.push({ label: '操作', value: '将所选本机现有会话收编到此星；可能按现有流程启动本机聚合器，不创建原生聊天会话。' });
            break;
          }
          case 'remove-star':
            impact.push({ label: '将失效的节点凭证', value: String(current.credentials.filter((item) => item.kind === 'node').length) }, { label: '将失效的管理凭证', value: String(current.credentials.filter((item) => item.kind === 'admin').length) }, { label: '将移除的册位', value: String(current.members.length) },
              ...current.credentials.map((item) => ({ label: item.kind === 'admin' ? '将撤管理钥' : '将撤节点钥', value: `${item.label} · ${item.machineId ?? '未绑定机器'}` })),
              ...current.members.map((item) => ({ label: '将删册位', value: `${item.machineId} · ${item.providerId ?? '未知工具'} · ${item.nativeId}` })),
              { label: '后果', value: '立即撤销此星全部权限、断开连接并移除册位；原生会话和其他星保留。' });
            if (!owner) throw new Denied('删星仅限本机 broker 主。');
            if (request.targetId !== undefined && request.targetId !== star.id) throw new Denied('所选星行已变化，请重新选择。');
            local = { op: 'remove-star', starId: star.starId, expected: { starRevision: star.revision } };
            break;
          case 'remove-node': {
            if (!owner && star.role !== 'star-admin') throw new Denied('移除节点需要本机 broker 主或当前星管理身份。');
            const item = current.machines.find((item) => item.id === request.targetId);
            if (!item || fullTcpMachineId(item.machineId) !== item.machineId) throw new Denied('所选完整机器行已不存在，请刷新后重新选择。');
            const credentials = current.credentials.filter((credential) => credential.kind === 'node' && credential.machineId === item.machineId);
            if (credentials.length === 0) throw new Denied('此机器没有可核实的绑定节点凭证，请刷新后重新选择。');
            const machineRevision = machineCredentialRevision(item.machineId, credentials);
            machine = { machineId: item.machineId, labels: credentials.map((credential) => credential.label).sort() };
            state = { state, machineId: item.machineId, machineRevision };
            local = { op: 'remove-machine', starId: star.starId, machineId: item.machineId, expected: { machineRevision } };
            impact.push({ label: '完整机器', value: item.machineId }, ...credentials.map((credential) => ({ label: '将撤节点凭证', value: credential.label })), { label: '后果', value: '原子撤销本星该机器全部绑定节点凭证并立即断开连接；永久成员册和原生会话保留。' });
            break;
          }
          default: throw new Denied('未登记的管理操作，未执行修改。');
          case 'revoke-credential': {
            const credential = current.credentials.find((item) => item.id === request.targetId);
            if (!credential || (request.targetRevision !== undefined && request.targetRevision !== credential.revision)) throw new Denied('所选凭证已变化，请刷新后重新选择。');
            if (!owner && (star.role !== 'star-admin' || credential.kind === 'admin')) throw new Denied(credential.kind === 'admin' ? '撤销星管理钥仅限本机 broker 主。' : '撤节点钥需要本机 broker 主或当前星管理身份。');
            impact.push({ label: '凭证', value: credential.label }, { label: '类型', value: credential.kind === 'admin' ? '星管理钥' : '节点钥' });
            state = { state, credential: [credential.id, credential.revision, credential.machineId] };
            local = { op: credential.kind === 'admin' ? 'remove-admin-key' : 'remove-node', starId: star.starId, label: credential.label, expected: { credentialRevision: credential.revision, machineId: credential.machineId } };
            impact.push({ label: '后果', value: '立即撤销此完整凭证并断开使用它的连接；其他凭证、册位和原生会话保留。' });
            break;
          }
        }
      }
      checkAbort(request.signal);
    } catch (error) {
      reason = request.signal?.aborted ? '操作核验已取消，未发出修改请求。' : error instanceof Denied ? error.message : '无法完整核验当前目标或权限，未发出修改请求。';
      nextStep = '刷新当前资源并核对完整目标后重新操作。';
    }
    const revision = hash([request.contextId, request.action, request.starId, request.targetId, request.targetRevision, state, values, fields, impact, reason]);
    return { preview: { enabled: reason === undefined, ...(reason === undefined ? {} : { reason, nextStep }), revision, fields, impact }, star, local, member, adopt, machine, values };
  }

  async function openDefault(request: { contextId: string; starId: string; identity: 'member' | 'admin'; signal?: AbortSignal }): Promise<TcpManagementConnection> {
    const target = await resolveTcpContext({ baseDir: options.baseDir, contextId: request.contextId, signal: request.signal });
    if (target.value === null || target.value.nodeConfig === null) throw new Denied('无法核实所选星的本机连接配置。');
    const entries = target.value.kind === 'local' ? target.value.nodeConfig.entries.filter((entry) => entry.starId === request.starId) : target.value.entry ? [target.value.entry] : [];
    if (entries.length !== 1 || entries[0].starId !== request.starId) throw new Denied('所选星的连接配置不唯一或已变化。');
    const entry = entries[0];
    const host = entry.host.includes(':') && !entry.host.startsWith('[') ? `[${entry.host}]` : entry.host;
    const url = `ws://${host}:${entry.port}`;
    const conn = request.identity === 'admin'
      ? entry.adminKey ? await SenderConn.openAdmin(url, entry.adminKey, 8_000, request.signal) : undefined
      : await SenderConn.open(url, entry.key, undefined, 8_000, request.signal);
    if (!conn) throw new Denied('当前星没有管理挑战应答凭证。');
    return { starId: conn.starId, request: (action, params) => requestAdminOp(conn, action, params), removeMember: (member) => requestMemberRemoveExact(conn, member), close: () => conn.close() };
  }
  async function apply(request: TcpManagementRequest & { expectedPreviewRevision: string }): Promise<TcpManagementResult> {
    const prepared = await prepare(request);
    if (!prepared.preview.enabled) return { kind: 'rejected', message: prepared.preview.reason ?? '目标无法核验。' };
    if (!request.expectedPreviewRevision || request.expectedPreviewRevision !== prepared.preview.revision) return { kind: 'rejected', message: '确认内容或目标状态已变化，请重新查看影响并确认。' };
    if (prepared.preview.fields.some((field) => field.required && !prepared.values[field.id])) return { kind: 'rejected', message: '请填写全部必填项后重新核验并确认。' };
    if (request.signal?.aborted) return { kind: 'rejected', message: '操作已取消，未发出修改请求。' };
    let issued = false;
    let connection: TcpManagementConnection | undefined;
    const close = () => connection?.close();
    request.signal?.addEventListener('abort', close, { once: true });
    try {
      if (prepared.adopt && prepared.star) {
        issued = true;
        return await nativeServices().membership.apply({ op: 'adopt', ref: prepared.adopt, starId: prepared.star.starId, signal: request.signal });
      }
      let value: unknown;
      let mode: 'hot' | 'cold' | undefined;
      if (prepared.member || (request.contextId !== 'local' && (request.action === 'generate-node-key' || ['remove-node', 'remove-machine', 'rename-node'].includes(prepared.local?.op ?? '')))) {
        const opening = (options.openRemote ?? openDefault)({ contextId: request.contextId, starId: prepared.star!.starId, identity: prepared.member ? 'member' : 'admin', signal: request.signal });
        void opening.then((late) => { if (request.signal?.aborted) late.close(); }, () => {});
        connection = await untilAborted(opening, request.signal);
        checkAbort(request.signal);
        if (connection.starId !== prepared.star!.starId) return { kind: 'rejected', message: '已连接的完整星 ID 与确认目标不同，未发出修改请求。' };
        issued = true;
        if (prepared.member) {
          const receipt = await untilAborted(connection.removeMember(prepared.member), request.signal);
          if (receipt.op !== 'member-remove-exact-result' || typeof receipt.ok !== 'boolean' || typeof receipt.removed !== 'boolean') return uncertain();
          if (receipt.ok && receipt.removed) return { kind: 'applied', message: '已删除所选精确册位；原生会话保留。' };
          return receipt.removed ? uncertain() : { kind: 'rejected', message: 'broker 未删除该精确册位；请刷新核对目标和权限。' };
        }
        const operation = prepared.local;
        const response = operation?.op === 'remove-node' ? connection.request('remove-node', { label: operation.label, expected: operation.expected })
          : operation?.op === 'remove-machine' ? connection.request('remove-machine', { machineId: operation.machineId, expected: operation.expected })
            : operation?.op === 'rename-node' ? connection.request('rename-node', { machineId: operation.machineId, name: operation.name })
              : connection.request('gen-key', { n: Number(prepared.values.count), host: prepared.values.host });
        const receipt = await untilAborted(response, request.signal);
        if (!isRecord(receipt) || typeof receipt.ok !== 'boolean') return uncertain();
        if (receipt.uncertain === true) return uncertain();
        if (!receipt.ok) return { kind: 'rejected', message: 'broker 拒绝此次修改，请刷新核对当前星管理权限和完整目标。' };
        value = receipt;
        mode = 'hot';
      } else if (prepared.local) {
        issued = true;
        const result = await (options.executeLocal ?? ((operation, signal) => executeLocalManagement(operation, { baseDir: options.baseDir, signal })))(prepared.local, request.signal);
        if (result.kind === 'failed') return uncertain();
        if (result.kind === 'rejected') return { kind: 'rejected', message: '管理操作未获确认，请刷新核对所选目标、权限和输入。' };
        value = result.value; mode = result.mode;
      } else return { kind: 'rejected', message: '当前操作尚未具备安全执行接口。' };
      if (request.signal?.aborted) return uncertain();
      if (request.action === 'generate-node-key' || request.action === 'generate-admin-key') {
        const secret = request.action === 'generate-node-key' ? nodeSecret(value, prepared.star!, prepared.values) : adminSecret(value, prepared.values.label);
        return secret === undefined ? uncertain() : { kind: 'applied', message: '新凭证已生成，请在当前结果页复制并清屏。', ...(mode === undefined ? {} : { mode }), secret };
      }
      if (request.action === 'add-star') {
        if (!isRecord(value) || typeof value.starId !== 'string' || value.starId === '') return uncertain();
        const starId = value.starId;
        let selectedId: string | undefined;
        try {
          const created = await options.catalog.readStar({ contextId: request.contextId, starId, signal: request.signal });
          if (created.contextId === request.contextId && created.star?.contextId === request.contextId && created.star.starId === starId) selectedId = created.star.id;
        } catch { /* The applied receipt remains authoritative if the follow-up selection cannot be read. */ }
        return { kind: 'applied', mode, ...(selectedId === undefined ? {} : { selectedId }), message: `新星 ${starId} 已创建，请在星列表核对。` };
      }
      if (prepared.local?.op === 'remove-node' || prepared.local?.op === 'remove-admin-key') {
        if (!isRecord(value) || (prepared.local.op === 'remove-node' ? value.removed !== true : value.removed !== prepared.local.label)) return uncertain();
        return { kind: 'applied', mode, message: '已撤销所选精确凭证；请刷新核对连接状态。' };
      }
      if (prepared.local?.op === 'remove-machine' && prepared.machine) {
        if (!isRecord(value) || value.removed !== true || value.machineId !== prepared.machine.machineId || !Array.isArray(value.removedLabels)
          || value.removedLabels.some((label) => typeof label !== 'string') || JSON.stringify([...value.removedLabels].sort()) !== JSON.stringify(prepared.machine.labels)) return uncertain();
        return { kind: 'applied', mode, message: '已移除该星所选机器的全部绑定节点凭证并断开连接；永久成员册和原生会话保留。' };
      }
      if (prepared.local?.op === 'rename-node') {
        const selected = prepared.local;
        if (!isRecord(value) || value.renamed !== true || value.saved !== true || value.applied !== true || value.starId !== selected.starId || value.machineId !== selected.machineId || value.showName !== selected.name) return uncertain();
        return { kind: 'applied', mode, selectedId: request.targetId, message: '对端当前星节点名称已保存并生效；其他星与全局默认保持。' };
      }
      if (prepared.local?.op === 'remove-star') {
        if (!isRecord(value) || !isRecord(value.removed) || !Number.isInteger(value.removed.nodes) || !Number.isInteger(value.removed.roster)) return uncertain();
        return { kind: 'applied', mode, message: '所选完整星已删除，相关权限和连接已失效。' };
      }
      return { kind: 'applied', mode, ...(request.targetId === undefined ? {} : { selectedId: request.targetId }), message: request.action === 'set-show-name'
        ? mode === 'cold' ? '本机显示名配置已保存；重连对应聚合器后生效，请刷新核对运行名称。' : '本机显示名配置已保存并请求重挂；请刷新核对运行名称。'
        : '所选星名已修改。' };
    } catch { return issued ? uncertain() : { kind: 'rejected', message: '无法核实所选连接或权限，未发出修改请求。' }; }
    finally { request.signal?.removeEventListener('abort', close); close(); }
  }
  return { preview: async (request) => (await prepare(request)).preview, apply };
}
