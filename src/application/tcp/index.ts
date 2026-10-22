import { buildStarSnapshot } from '../../serve/star-snapshot.js';
import type { StarSnapshot } from '../../serve/star-snapshot.js';
import { createTcpDiscoveryClient } from '../remote-discovery/tcp.js';
import { parseDiscoveryResponse } from '../discovery/boundary.js';
import type { DiscoveryEndpoint, DiscoverySession } from '../discovery/model.js';
import { selectBrokerEntry } from '../../serve/via-tcp.js';
import { untilAborted } from '../sessions/reading.js';
import { checkAbort } from '../queries/reading.js';
import { sessionKey } from '../sessions/model.js';
import type { QueryError } from '../queries/reading.js';
import { fullTcpMachineId, resolveTcpContext, tcpNodeContextId } from './reading.js';
import type { TcpConfigurationOptions, TcpResolvedContext, TcpResolvedTarget } from './reading.js';
import { parseStarSnapshot } from './snapshot.js';
import { readTcpStarSnapshot } from './transport.js';
import type { TcpApplication, TcpContextRequest, TcpCredential, TcpMachine, TcpMember, TcpReadResult, TcpSession, TcpSessionNodeResult, TcpSessionsRequest, TcpSessionsResult, TcpStar, TcpStarRequest, TcpStarResult, TcpStarsResult } from './model.js';

export type * from './model.js';
export { tcpNodeContextId } from './reading.js';
export interface TcpApplicationOptions extends TcpConfigurationOptions {
  timeoutMs?: number;
  concurrency?: number;
  readSnapshot?(target: TcpResolvedTarget, signal: AbortSignal): Promise<unknown>;
  discovery?(target: TcpResolvedTarget, machineId: string): DiscoveryEndpoint;
}
const DEFAULT_PORT = 7260;
const issue = (source: string, message: string, kind: QueryError['kind'] = 'unavailable', nextStep = '核对所选星、配置与节点连接后刷新；不会读取本机作为替代。'): QueryError => ({ source, kind, message, nextStep });
const itemId = (...parts: string[]) => JSON.stringify(parts);
async function pool<T, U>(items: readonly T[], concurrency: number, signal: AbortSignal | undefined, work: (item: T) => Promise<U>): Promise<U[]> {
  const results: U[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!signal?.aborted) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await work(items[index]);
    }
  }));
  return results.filter((value) => value !== undefined);
}
async function bounded<T>(signal: AbortSignal | undefined, timeoutMs: number, task: (owned: AbortSignal) => Promise<T>): Promise<T> {
  checkAbort(signal);
  const owner = new AbortController();
  const abort = () => owner.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    checkAbort(signal);
    return await untilAborted(task(owner.signal), owner.signal);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); owner.abort(); }
}

/** Complete TCP observations with bounded fan-out and no writes, native starts or audit list polling. */
export function createTcpApplication(options: TcpApplicationOptions): TcpApplication {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const concurrency = options.concurrency ?? 3;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('Invalid TCP read bounds');
  const base = (request: TcpContextRequest, completeness: TcpReadResult['completeness'], errors: QueryError[] = []): TcpReadResult => ({ contextId: request.contextId, completeness, errors, observedAt: now() });
  const empty = (request: TcpStarRequest, completeness: TcpReadResult['completeness'], errors: QueryError[] = []): TcpStarResult => ({ ...base(request, completeness, errors), star: null, machines: [], members: [], credentials: [] });
  const cancelled = (request: TcpContextRequest) => issue(request.contextId, 'TCP 读取已取消。', 'cancelled', '需要时重新读取。');

  function project(snapshot: StarSnapshot, target: TcpResolvedTarget): TcpStarResult {
    const contextId = target.contextId;
    const starId = snapshot.starId;
    const star: TcpStar = { id: itemId('star', contextId, starId), contextId, starId, name: snapshot.name ?? null, revision: snapshot.revision, role: snapshot.role,
      host: target.entry?.host ?? '127.0.0.1', port: target.entry?.port ?? target.broker?.port ?? DEFAULT_PORT,
      health: snapshot.live ? 'reachable' : 'unknown', onlineNodes: snapshot.live ? snapshot.machines.filter((item) => item.online).length : null };
    const credentials: TcpCredential[] = snapshot.nodes.map((node) => ({ id: itemId('credential', contextId, starId, node.kind, node.label), contextId, starId,
      kind: node.kind, label: node.label, revision: node.revision, machineId: node.machineId ?? null, machineName: node.machineName ?? null, addedAt: node.addedAt }));
    const machines: TcpMachine[] = snapshot.machines.map((machine) => {
      const keys = credentials.filter((credential) => credential.kind === 'node' && credential.machineId === machine.machineId);
      return { id: itemId('machine', contextId, starId, machine.machineId), contextId, starId, machineId: machine.machineId, mid8: machine.machineId.slice(0, 8), name: machine.name ?? null,
        labels: keys.map((key) => key.label), presence: snapshot.live ? machine.online ? 'online' : 'offline' : 'unknown', addedAt: keys.map((key) => key.addedAt).sort()[0] ?? null };
    });
    const members: TcpMember[] = snapshot.members.map((member) => ({ id: itemId('member', contextId, starId, member.machine, member.tool ?? '', member.sessionId), contextId, starId,
      machineId: member.machine, machineName: member.machineName ?? machines.find((machine) => machine.machineId === member.machine)?.name ?? null,
      nativeId: member.sessionId, providerId: member.tool || null, name: member.name ?? null, presence: snapshot.live ? member.online ? 'online' : 'offline' : 'unknown', temporary: member.temporary === true,
      ...(member.extendsName === undefined ? {} : { extendsName: member.extendsName }), ...(member.extendsMachine === undefined ? {} : { extendsMachine: member.extendsMachine }) }));
    for (const member of members) {
      let address: string | undefined;
      try {
        if (!member.providerId || member.providerId.length > 16 || !/^[a-z0-9]+$/.test(member.providerId) || !/^[A-Za-z0-9._:/-]+$/.test(member.nativeId)
          || !/^[A-Za-z0-9._-]+$/.test(starId) || !target.nodeConfig || selectBrokerEntry(target.nodeConfig.entries, starId, undefined).starId !== starId) throw new Error('No safe selector');
        const exact = members.filter((other) => other.machineId === member.machineId && (other.name === member.nativeId || other.nativeId === member.nativeId));
        if (exact.length !== 1 || exact[0].id !== member.id || credentials.filter((credential) => credential.kind === 'node' && credential.machineId === member.machineId).length !== 1) throw new Error('Ambiguous member address');
        address = `tcp:${starId}:${member.machineId}:${member.nativeId}`;
      } catch { /* Full metadata remains available even when old selectors cannot safely address it. */ }
      if (address) member.address = address;
      else member.addressReason = '现有选择器不能确认无歧义的完整成员地址；请核对完整引用、机器和工具。';
    }
    return { ...base(target, snapshot.live ? 'complete' : 'partial', snapshot.live ? [] : [issue(starId, '仅取得本机静态台账，机器与成员活性未知。', 'unavailable', '启动或核对本机 broker 后刷新；静态台账不代表下线。')]), star, machines, credentials, members };
  }

  async function observe(target: TcpResolvedTarget, request: TcpStarRequest): Promise<TcpStarResult> {
    let invalidMetadata = false;
    try {
      const raw = await bounded(request.signal, timeoutMs, (signal) => options.readSnapshot ? options.readSnapshot(target, signal) : readTcpStarSnapshot(target, signal, { ...options, timeoutMs }));
      invalidMetadata = true;
      const snapshot = parseStarSnapshot(raw);
      if ((request.starId !== undefined && snapshot.starId !== request.starId) || (target.starId !== undefined && snapshot.starId !== target.starId)
        || snapshot.role !== target.role || (target.kind === 'tcp' && !snapshot.live)) throw new Error('Wrong star snapshot scope');
      return project(snapshot, target);
    } catch {
      if (request.signal?.aborted) return empty(request, 'cancelled', [cancelled(request)]);
      const kind = invalidMetadata ? 'malformed' : 'unavailable';
      if (target.kind === 'local' && target.star) {
        const result = project(buildStarSnapshot(target.star, { role: 'broker-owner', onlineMachines: new Set(), live: false }), target);
        if (result.star) result.star.health = 'unavailable';
        result.errors.push(issue(target.star.starId ?? request.contextId, '本机 broker 实时快照不可用；仅保留静态信息，活性未知。', kind));
        return result;
      }
      return empty(request, 'unavailable', [issue(request.contextId, '无法读取所选星的有效完整快照；权限、身份或接口尚未核实。', kind)]);
    }
  }
  async function resolve(request: TcpContextRequest) {
    return resolveTcpContext({ ...options, contextId: request.contextId, signal: request.signal });
  }
  function target(context: TcpResolvedContext, starId?: string): TcpResolvedTarget | undefined {
    if (context.kind === 'local') {
      const star = context.broker?.stars.find((item) => item.starId === starId);
      return star ? { ...context, starId, star } : undefined;
    }
    if (starId !== undefined && context.entry?.starId !== undefined && context.entry.starId !== starId) return undefined;
    return { ...context, starId: starId ?? context.entry?.starId };
  }
  async function readStarOwned(request: TcpStarRequest): Promise<{ page: TcpStarResult; target?: TcpResolvedTarget }> {
    if (request.signal?.aborted) return { page: empty(request, 'cancelled', [cancelled(request)]) };
    if (request.contextId === 'local' && !request.starId) return { page: empty(request, 'unavailable', [issue('local', '本机有多星语义，请从星列表选择完整星 ID；不会默认第一颗星。')]) };
    const context = await resolve(request);
    if (!context.value) return { page: empty(request, context.state === 'cancelled' ? 'cancelled' : 'unavailable', context.errors) };
    const selected = target(context.value, request.starId);
    if (!selected) return { page: empty(request, 'unavailable', [issue(request.contextId, '所选完整星已不在当前上下文，未读取其他星。')]) };
    const page = await observe(selected, request);
    return { page, target: page.star ? { ...selected, starId: page.star.starId } : undefined };
  }
  async function readStar(request: TcpStarRequest): Promise<TcpStarResult> { return (await readStarOwned(request)).page; }
  async function readStars(request: TcpContextRequest): Promise<TcpStarsResult> {
    if (request.signal?.aborted) return { ...base(request, 'cancelled', [cancelled(request)]), configured: false, role: null, items: [] };
    const context = await resolve(request);
    if (!context.value) return { ...base(request, context.state === 'cancelled' ? 'cancelled' : 'unavailable', context.errors), configured: true, role: null, items: [] };
    if (context.value.kind === 'tcp') {
      const page = await observe(target(context.value)!, request);
      return { ...base(request, page.completeness, page.errors), configured: true, role: page.star?.role ?? null, items: page.star ? [page.star] : [] };
    }
    const pages = await pool(context.value.broker?.stars ?? [], concurrency, request.signal, (star) => observe({ ...context.value!, starId: star.starId, star }, { ...request, starId: star.starId }));
    if (request.signal?.aborted) return { ...base(request, 'cancelled', [cancelled(request)]), configured: context.value.broker !== null, role: 'broker-owner', items: [] };
    const errors = pages.flatMap((page) => page.errors);
    return { ...base(request, errors.length ? 'partial' : 'complete', errors), configured: context.value.broker !== null, role: 'broker-owner', items: pages.flatMap((page) => page.star ? [page.star] : []) };
  }

  function memberSession(member: TcpMember): TcpSession {
    const ref = member.providerId ? { contextId: tcpNodeContextId(member.contextId, member.starId, member.machineId), providerId: member.providerId, nativeId: member.nativeId } : null;
    return { id: member.id, contextId: member.contextId, starId: member.starId, machineId: member.machineId, mid8: member.machineId.slice(0, 8), machineName: member.machineName,
      nativeId: member.nativeId, providerId: member.providerId, name: member.name, ref, rawStatus: null, capabilities: null, attributes: {},
      member, membership: 'member', presence: member.presence, discovered: false, ...(member.address ? { address: member.address } : { addressReason: member.addressReason }) };
  }
  function nativeSession(item: DiscoverySession, machine: TcpMachine, page: TcpStarResult): TcpSession {
    const exact = page.members.filter((member) => member.machineId === machine.machineId && member.nativeId === item.ref.nativeId && member.providerId === item.ref.providerId && item.ref.referenceKind !== 'process');
    const uncertain = page.members.some((member) => member.machineId === machine.machineId && member.nativeId === item.ref.nativeId && member.providerId === null);
    const member = exact.length === 1 ? exact[0] : null;
    return { id: sessionKey(item.ref), contextId: machine.contextId, starId: machine.starId, machineId: machine.machineId, mid8: machine.mid8, machineName: machine.name,
      nativeId: item.ref.nativeId, providerId: item.ref.providerId, name: item.name, ref: item.ref, rawStatus: item.rawStatus, capabilities: item.capabilities, attributes: item.attributes,
      member, membership: member ? 'member' : uncertain || page.completeness !== 'complete' ? 'unknown' : 'not-member', presence: member?.presence ?? 'unknown', discovered: true,
      ...(member?.address ? { address: member.address } : { addressReason: '仅有原生发现不能证明已入星；没有可核验的现有三段成员地址。' }) };
  }
  function discovery(selected: TcpResolvedTarget, machineId: string): DiscoveryEndpoint {
    if (options.discovery) return options.discovery(selected, machineId);
    const entry = selected.entry ?? selected.nodeConfig?.entries.find((item) => item.starId === selected.starId);
    const credential = selected.star?.nodes.find((item) => item.key) ?? selected.star?.nodes.find((item) => item.adminKey);
    const broker = entry ?? (credential ? { host: '127.0.0.1', port: selected.broker?.port ?? DEFAULT_PORT, starId: selected.starId, key: credential.key ?? '', adminKey: credential.adminKey } : undefined);
    if (!broker) throw new Error('No readonly discovery credential');
    return createTcpDiscoveryClient({ broker, targetMachine: machineId, admin: broker.adminKey !== undefined, timeoutMs });
  }
  async function readSessions(request: TcpSessionsRequest): Promise<TcpSessionsResult> {
    const { page, target: selected } = await readStarOwned(request);
    const result = (items: TcpSession[], nodes: TcpSessionNodeResult[], completeness = page.completeness, errors = page.errors): TcpSessionsResult => ({ ...base(request, completeness, errors), star: page.star, scope: request.scope, items, nodes });
    if (!page.star || !selected || page.completeness === 'cancelled') return result([], []);
    const fullMachine = request.machineId === undefined ? undefined : fullTcpMachineId(request.machineId);
    if ((request.machineId !== undefined && !fullMachine) || (fullMachine && !page.machines.some((machine) => machine.machineId === fullMachine))) return result([], [], 'unavailable', [issue(request.contextId, '节点身份不是所选星内的完整机器 ID；未按名字或短前缀改读其他节点。')]);
    if (request.scope === 'members') return result(page.members.filter((member) => fullMachine === undefined || member.machineId === fullMachine).map(memberSession), []);
    if (request.scope !== 'discoverable') return result([], [], 'unavailable', [issue(request.contextId, '未知的会话读取范围，未执行原生发现。')]);
    const machines = page.machines.filter((machine) => fullMachine === undefined || machine.machineId === fullMachine);
    const observed = await pool(machines, concurrency, request.signal, async (machine) => {
      const errors: QueryError[] = [];
      const items = new Map<string, TcpSession>();
      let completeness: TcpReadResult['completeness'] = 'complete';
      if (machine.presence !== 'online') return { items: [], node: { machineId: machine.machineId, observedAt: now(), completeness: 'unavailable' as const, errors: [issue(machine.machineId, '节点未确认在线，尚无可核验的原生会话结果。')] } };
      try {
        await bounded(request.signal, timeoutMs, async (signal) => {
          const endpoint = discovery(selected, machine.machineId);
          const contextId = tcpNodeContextId(request.contextId, page.star!.starId, machine.machineId);
          const seen = new Set<string>();
          let cursor: string | undefined;
          for (;;) {
            checkAbort(signal);
            const response = parseDiscoveryResponse(await untilAborted(endpoint.execute({ op: 'list', limit: 100, ...(cursor === undefined ? {} : { cursor }) }, { contextId, signal }), signal));
            if (response.op !== 'list' || response.page.items.some((item) => item.ref.contextId !== contextId)) throw new Error('Wrong native discovery scope');
            for (const item of response.page.items) items.set(sessionKey(item.ref), nativeSession(item, machine, page));
            errors.push(...response.page.errors.map((error) => issue(machine.machineId, '此节点的原生来源读取不完整。', error.kind === 'malformed' ? 'malformed' : 'unavailable')));
            if (response.page.completeness === 'cancelled') throw new Error('Native source cancelled');
            if (response.page.nextCursor === null || response.page.completeness === 'unavailable') {
              completeness = response.page.completeness; break;
            }
            if (seen.has(response.page.nextCursor)) { errors.push(issue(machine.machineId, '节点返回重复分页游标，已停止继续读取。', 'malformed')); completeness = 'partial'; break; }
            seen.add(response.page.nextCursor); cursor = response.page.nextCursor;
          }
        });
      } catch { completeness = request.signal?.aborted ? 'cancelled' : items.size ? 'partial' : 'unavailable'; errors.push(issue(machine.machineId, request.signal?.aborted ? '节点读取已取消。' : '节点发现失败、超时或返回无效数据。', request.signal?.aborted ? 'cancelled' : 'unavailable')); }
      if (errors.length && completeness === 'complete') completeness = 'partial';
      return { items: [...items.values()], node: { machineId: machine.machineId, completeness, observedAt: now(), errors } };
    });
    if (request.signal?.aborted) return result([], [], 'cancelled', [cancelled(request)]);
    const nodes = observed.map((entry) => entry.node);
    const errors = [...page.errors, ...nodes.flatMap((node) => node.errors)];
    const items = observed.flatMap((entry) => entry.items);
    const completeness = page.completeness !== 'complete' || nodes.some((node) => node.completeness !== 'complete') ? 'partial' : 'complete';
    return result(items, nodes, completeness, errors);
  }
  return { readStars, readStar, readSessions };
}
