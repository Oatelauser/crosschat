import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { normalizeMid } from '../../platform/machine-id.js';
import { ensureAggregator, queryAttachStatus, spawnServeDetachReal } from '../../serve/attach-client.js';
import type { AttachPipeClient } from '../../serve/attach-client.js';
import { parseNodeConfig } from '../../serve/node-config.js';
import type { BrokerEntry } from '../../serve/node-config.js';
import { sanitizeTool } from '../../serve/protocol.js';
import { tcpDir } from '../../serve/registry.js';
import { assertNodeNotRevoked } from '../../serve/revocation.js';
import { requestAdminOp, requestMemberRemoveExact, selectBrokerEntry, SenderConn } from '../../serve/via-tcp.js';
import { parseDiscoveryResponse } from '../discovery/boundary.js';
import type { DiscoveryRequest, DiscoveryResponse, DiscoverySession } from '../discovery/model.js';
import { checkAbort, readParsed } from '../queries/reading.js';
import { isRecord, untilAborted } from '../sessions/reading.js';
import { sessionKey } from '../sessions/model.js';
import type { SourceError } from '../sessions/model.js';
import { defaultMembershipProviders } from './providers.js';
import { readMembershipMachineId } from './machine.js';
import type { MembershipCheck, MembershipProvider, MembershipRequest, MembershipResult, MembershipTargets, SessionMembershipOptions, SessionMembershipService } from './types.js';

export type {
  MembershipCheck,
  MembershipRequest,
  MembershipProvider,
  MembershipResult,
  MembershipTargets,
  SessionMembershipOptions,
  SessionMembershipService,
} from './types.js';

class Rejected extends Error {
  constructor(message: string, readonly nextStep = '刷新列表并重新确认目标后再操作') { super(message); }
}

interface Owner { connection?: SenderConn; pipe?: AttachPipeClient }
interface ExactMember { sessionId: string; machine: string; tool?: string }
interface Target { entry: BrokerEntry; machine: string; provider: MembershipProvider; connection: SenderConn; item?: DiscoverySession }

function fullMachine(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^[0-9a-fA-F-]+$/.test(value)) return undefined;
  const machine = normalizeMid(value);
  return machine.length === 32 ? machine : undefined;
}

async function bounded<T>(work: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Membership request timed out.')), timeoutMs); });
  try { return await untilAborted(Promise.race([work, timeout]), signal); }
  finally { clearTimeout(timer); }
}

async function withOwner<T>(signal: AbortSignal | undefined, work: (owner: Owner) => Promise<T>): Promise<T> {
  const owner: Owner = {};
  const close = () => { owner.pipe?.close(); owner.connection?.close(); };
  signal?.addEventListener('abort', close, { once: true });
  try { checkAbort(signal); return await work(owner); }
  finally { signal?.removeEventListener('abort', close); close(); }
}

function rejected(error: unknown, signal?: AbortSignal): MembershipCheck {
  if (signal?.aborted) return { allowed: false, reason: '操作核验已取消', nextStep: '需要时重新发起操作' };
  return error instanceof Rejected ? { allowed: false, reason: error.message, nextStep: error.nextStep }
    : { allowed: false, reason: '无法完成目标或权限核验，未发出修改请求', nextStep: '检查所选星的连接和本机会话来源，再刷新重试' };
}

function assertRoster(request: MembershipRequest, target: Pick<Target, 'machine' | 'provider'>, members: readonly ExactMember[]): void {
  const matches = members.filter((member) => member.sessionId === request.ref.nativeId);
  if (matches.length > 1) throw new Rejected('完整会话 ID 命中多个册位，不能安全确认目标');
  const member = matches[0];
  if (member === undefined) {
    if (request.op === 'remove') throw new Rejected('目标完整会话 ID 当前不在所选星的册内');
    return;
  }
  if (member.tool === undefined) throw new Rejected('该册位缺少已核实的工具身份，不能安全修改');
  if (member.tool !== target.provider.tool) throw new Rejected('同一完整会话 ID 已绑定其他工具，不能覆盖或删除');
  if (member.machine !== target.machine) throw new Rejected('该册位绑定其他机器，不能按本机会话修改');
}

/** Explicit star selection and exact references; no name resolution or implicit native writes. */
export function createSessionMembershipService(options: SessionMembershipOptions): SessionMembershipService {
  const contextId = options.contextId ?? 'local';
  const configFile = join(tcpDir(options.baseDir), 'node.json');
  const timeoutMs = options.timeoutMs ?? 8_000;
  const providers = options.providers ?? defaultMembershipProviders;

  const readConfig = (signal?: AbortSignal) => readParsed(configFile, (text) => parseNodeConfig(text, configFile), { signal, readText: options.readText, now: options.now });

  async function readNative(request: DiscoveryRequest, parentSignal?: AbortSignal): Promise<DiscoveryResponse> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    const timer = setTimeout(onAbort, timeoutMs);
    parentSignal?.addEventListener('abort', onAbort, { once: true });
    if (parentSignal?.aborted) controller.abort();
    try {
      checkAbort(controller.signal);
      return parseDiscoveryResponse(await untilAborted(options.discovery.execute(request, { contextId, signal: controller.signal }), controller.signal));
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onAbort);
      controller.abort();
    }
  }

  async function listTargets(request: { contextId: string; signal?: AbortSignal }): Promise<MembershipTargets> {
    const observedAt = (options.now ?? Date.now)();
    if (request.contextId !== contextId) return { stars: [], completeness: 'unavailable', observedAt,
      errors: [{ source: { contextId: request.contextId, providerId: 'membership' }, kind: 'unsupported', message: '此成员操作仅支持已绑定的本机上下文', nextStep: '返回本机连接后操作' }] };
    const config = await readConfig(request.signal);
    if (config.state === 'missing') return { stars: [], completeness: 'complete', observedAt: config.observedAt, errors: [] };
    if (config.value === null) {
      const errors: SourceError[] = config.errors.map((issue) => ({ source: { contextId, providerId: 'membership', path: issue.source },
        kind: issue.kind, message: issue.message, nextStep: issue.nextStep }));
      return { stars: [], completeness: config.state === 'cancelled' ? 'cancelled' : 'unavailable', observedAt: config.observedAt, errors };
    }
    const stars = new Map<string, MembershipTargets['stars'][number]>();
    for (const entry of config.value.entries) {
      const known = typeof entry.starId === 'string' && entry.starId !== '';
      const id = known ? entry.starId! : `unconfigured:${createHash('sha256').update(JSON.stringify([entry.host, entry.port, entry.key])).digest('hex')}`;
      const duplicate = known && config.value.entries.filter((candidate) => candidate.starId === id).length > 1;
      const eligible = known && !duplicate;
      stars.set(id, { id, label: entry.name || (known ? id : '未登记星 ID'), eligible,
        ...(eligible ? {} : { reason: duplicate ? '同一完整星 ID 对应多个配置目标，请先消歧' : '缺少完整星 ID，无法安全绑定目标' }) });
    }
    return { stars: [...stars.values()], completeness: 'complete', observedAt: config.observedAt, errors: [] };
  }

  async function nativeDetail(request: MembershipRequest, provider: MembershipProvider): Promise<DiscoverySession> {
    const response = await readNative({ op: 'detail', providerId: request.ref.providerId,
      nativeId: request.ref.nativeId, referenceKind: request.ref.referenceKind }, request.signal);
    if (response.op !== 'detail' || response.detail.completeness === 'cancelled' || response.detail.completeness === 'unavailable'
      || response.detail.item === null || sessionKey(response.detail.item.ref) !== sessionKey(request.ref)) {
      throw new Rejected('无法重新确认此完整引用对应的现存本机原生会话');
    }
    const item = response.detail.item;
    const eligibility = provider.canAdopt(item);
    if (!eligibility.allowed) throw new Rejected(eligibility.reason ?? '此原生会话当前不符合收编条件', eligibility.nextStep);
    for (const other of response.providers) {
      if (other.providerId === request.ref.providerId) continue;
      const collision = await readNative({ op: 'detail', providerId: other.providerId,
        nativeId: request.ref.nativeId, referenceKind: 'native' }, request.signal);
      if (collision.op !== 'detail') throw new Rejected('无法核验其他工具的完整会话身份');
      if (collision.detail.item !== null && collision.detail.item.ref.nativeId === request.ref.nativeId) {
        throw new Rejected('此完整原生 ID 同时存在于多个工具，当前星册不能安全区分');
      }
      if (collision.detail.item !== null || collision.detail.completeness !== 'complete') {
        throw new Rejected('其他工具的会话来源尚未确认完整缺席，无法排除同 ID 冲突');
      }
    }
    checkAbort(request.signal);
    return item;
  }

  async function readMembers(connection: SenderConn, signal?: AbortSignal, waitMs = timeoutMs): Promise<ExactMember[]> {
    checkAbort(signal);
    const reply: unknown = await bounded(requestAdminOp(connection, 'list-members', {}, waitMs), waitMs, signal);
    if (!isRecord(reply) || reply.ok !== true || !Array.isArray(reply.members)) throw new Rejected('无法读取所选星的完整册位或没有读取权限');
    return reply.members.map((item): ExactMember => {
      if (!isRecord(item) || typeof item.sessionId !== 'string' || item.sessionId === '' || fullMachine(item.machine) === undefined
        || (item.tool !== undefined && (typeof item.tool !== 'string' || sanitizeTool(item.tool) !== item.tool))) {
        throw new Rejected('所选星的册位身份格式不完整，不能安全修改');
      }
      return { sessionId: item.sessionId, machine: fullMachine(item.machine)!, ...(typeof item.tool === 'string' ? { tool: item.tool } : {}) };
    });
  }

  async function prepare(request: MembershipRequest, owner: Owner): Promise<Target> {
    checkAbort(request.signal);
    const ref = request.ref;
    if ((request.op !== 'adopt' && request.op !== 'remove') || !isRecord(ref) || ref.contextId !== contextId
      || typeof ref.providerId !== 'string' || ref.providerId === '' || typeof ref.nativeId !== 'string' || ref.nativeId === ''
      || (ref.referenceKind !== undefined && ref.referenceKind !== 'native')) throw new Rejected('仅可操作本机完整原生会话引用，临时进程引用不能入册或删册');
    const handlers = providers.filter((provider) => provider.providerId === ref.providerId);
    const provider = handlers.length === 1 ? handlers[0] : undefined;
    if (provider === undefined || sanitizeTool(provider.tool) !== provider.tool) throw new Rejected('此工具尚无可核验的星成员能力映射');
    if (typeof request.starId !== 'string' || request.starId === '') throw new Rejected('请选择已配置的完整星 ID');
    const config = await readConfig(request.signal);
    if (config.value === null) throw new Rejected('无法读取已配置的星，请检查本机 node.json', '检查 ~/.crosschat/tcp/node.json 后刷新');
    const entries = config.value.entries.filter((entry) => entry.starId === request.starId);
    if (entries.length !== 1) throw new Rejected('所选完整星 ID 缺失或对应多个配置目标，请先消歧');
    const entry = entries[0];
    if (request.op === 'adopt' && selectBrokerEntry(config.value.entries, request.starId, undefined) !== entry) {
      throw new Rejected('完整星 ID 被其他配置的星名遮蔽，无法安全启动聚合器', '先消除 ~/.crosschat/tcp/node.json 中的星名与完整星 ID 冲突，再刷新');
    }
    const machineRead = options.machineId === undefined
      ? readMembershipMachineId({ signal: request.signal, timeoutMs: Math.min(timeoutMs, 3_000) }) : Promise.resolve(options.machineId());
    const machine = fullMachine(await bounded(machineRead, timeoutMs, request.signal));
    if (machine === undefined) throw new Rejected('无法核实本机完整机器身份，未发出修改请求', '检查操作系统机器标识的读取权限后重新核验');
    const item = request.op === 'adopt' ? await nativeDetail(request, provider) : undefined;
    assertNodeNotRevoked(configFile, entry);
    const host = entry.host.includes(':') && !entry.host.startsWith('[') ? `[${entry.host}]` : entry.host;
    owner.connection = await SenderConn.open(`ws://${host}:${entry.port}`, entry.key, undefined, timeoutMs, request.signal);
    checkAbort(request.signal);
    if (owner.connection.starId !== request.starId) throw new Rejected('实际连接的星与所选完整星 ID 不一致，已停止操作');
    const target = { entry, machine, provider, connection: owner.connection, item };
    assertRoster(request, target, await readMembers(owner.connection, request.signal));
    return target;
  }

  function impact(request: MembershipRequest, target: Target): readonly string[] {
    return [`星：${request.starId}`, `机器：${target.machine}`, `工具：${request.ref.providerId}`, `完整会话 ID：${request.ref.nativeId}`,
      request.op === 'adopt' ? '收编当前原生会话；可能启动该星的本机聚合器，不新建原生会话' : '仅删除该星的册位；不终止或删除原生会话'];
  }

  async function check(request: MembershipRequest): Promise<MembershipCheck> {
    try { return await withOwner(request.signal, async (owner) => ({ allowed: true, impact: impact(request, await prepare(request, owner)) })); }
    catch (error) { return rejected(error, request.signal); }
  }

  async function apply(request: MembershipRequest): Promise<MembershipResult> {
    let writeIssued = false;
    try {
      return await withOwner(request.signal, async (owner) => {
        const target = await prepare(request, owner);
        checkAbort(request.signal);
        if (request.op === 'remove') {
          writeIssued = true;
          const reply = await bounded(requestMemberRemoveExact(target.connection, { sessionId: request.ref.nativeId, machine: target.machine, tool: target.provider.tool }, timeoutMs), timeoutMs, request.signal);
          if (!reply.ok && reply.removed) return { kind: 'uncertain', message: '册位内存已修改，但持久化未确认，请检查所选星并刷新核实，勿自动重试' };
          return reply.ok && reply.removed ? { kind: 'applied', message: '已从所选星精确删除该册位；原生会话不受影响' }
            : { kind: 'rejected', message: '册位身份已改变或目标已不在册，请刷新后重新确认' };
        }
        owner.pipe = await ensureAggregator({ tcpBaseDir: options.baseDir, spawnServeDetach: options.spawnServeDetach ?? spawnServeDetachReal,
          aggregatorTimeoutMs: options.aggregatorTimeoutMs, signal: request.signal, now: options.now }, target.entry, request.starId);
        checkAbort(request.signal);
        const status = await bounded(queryAttachStatus(owner.pipe), timeoutMs, request.signal);
        if (status === undefined || !status.online || !status.brokerCap || status.starId !== request.starId || fullMachine(status.machine) !== target.machine) {
          throw new Rejected('聚合器离线或无法核实所选星与本机完整身份，未发送收编请求');
        }
        const existing = status.members.filter((member) => member.sessionId === request.ref.nativeId);
        if (existing.length > 1 || (existing.length === 1 && existing[0].tool !== target.provider.tool)) {
          throw new Rejected('聚合器中此完整 ID 的工具身份冲突或不明，未发送收编请求');
        }
        const item = await nativeDetail(request, target.provider);
        assertRoster(request, target, await readMembers(target.connection, request.signal));
        checkAbort(request.signal);
        writeIssued = true;
        const reply = await bounded(owner.pipe.send({ op: 'attach', sessionId: request.ref.nativeId, tool: target.provider.tool,
          ...(item.name === null || item.name === '' ? {} : { name: item.name }) }), timeoutMs, request.signal);
        if (!reply.ok) return reply.disconnected || reply.unconfirmed ? { kind: 'uncertain', message: '收编请求已发出但未获有效回执，请刷新星册核实，勿自动重试' }
          : { kind: 'rejected', message: '聚合器拒绝收编，请核对原生会话和所选星后重新确认' };
        const deadline = Date.now() + timeoutMs;
        for (;;) {
          const members = await readMembers(target.connection, request.signal, Math.max(1, deadline - Date.now()));
          const exact = members.filter((member) => member.sessionId === request.ref.nativeId);
          if (exact.length === 1 && exact[0].machine === target.machine && exact[0].tool === target.provider.tool) {
            return { kind: 'applied', message: '所选星已确认该完整会话入册' };
          }
          if (exact.length > 0 || Date.now() >= deadline) return { kind: 'uncertain', message: '聚合器已接收请求，但星册尚未确认精确目标，请刷新核实，勿自动重试' };
          await pause(25, undefined, { signal: request.signal });
        }
      });
    } catch (error) {
      if (writeIssued) return { kind: 'uncertain', message: '修改请求已发出，结果尚未确认；取消或断线不代表撤回，请刷新星册核实，勿自动重试' };
      return { kind: 'rejected', message: rejected(error, request.signal).reason ?? '未通过修改前核验' };
    }
  }

  return { listTargets, check, apply };
}
