import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { selectConnectEntry } from '../../serve/connect-selector.js';
import { parseNodeConfig } from '../../serve/node-config.js';
import type { BrokerEntry, NodeConfig } from '../../serve/node-config.js';
import { DEFAULT_PORT } from '../../serve/broker.js';
import { queryBroker } from '../queries/broker.js';
import type { BrokerSummary } from '../queries/broker.js';
import { checkAbort, readParsed } from '../queries/reading.js';
import type { QueryError, ReadResult } from '../queries/reading.js';
import { queryServiceStatuses } from '../queries/services.js';
import type { CollectionResult, ServiceSnapshot } from '../queries/services.js';
import { untilAborted } from '../sessions/reading.js';
import { stopServicesInBackground } from './background.js';
import { checkServiceGuard, inspectServiceProcesses } from './inspection.js';
import type { ServiceGuard, ServiceInspection, ServiceProcess } from './inspection.js';
import { startDetachedService, waitForServiceReady } from './local.js';
import type { ServiceFailed, ServiceReady, ServiceStarting, ServiceStopRequest, ServiceStopResult } from './local.js';
export type { ServiceInspection } from './inspection.js';

export type LocalServiceOperation = 'start' | 'stop';
export interface ServiceActionCheck { allowed: boolean; reason?: string; nextStep?: string; impact: readonly string[] }
export interface LocalService {
  id: string; revision: string; kind: 'broker' | 'node'; label: string; state: string; target: string;
  selector?: string; pid?: number; sourceId?: string;
  start: ServiceActionCheck; stop: ServiceActionCheck;
  detail: readonly { label: string; value: string }[];
}
export interface LocalServiceRead { contextId: string; signal?: AbortSignal }
export interface LocalServiceRequest extends LocalServiceRead { id: string; revision: string; operation: LocalServiceOperation }
export interface LocalServiceOutcome { state: 'ready' | 'failed' | 'unconfirmed' | 'cancelled'; message: string; id?: string; pid?: number }
export interface LocalServices {
  read(request: LocalServiceRead): Promise<CollectionResult<LocalService>>;
  check(request: LocalServiceRequest): Promise<ServiceActionCheck>;
  execute(request: LocalServiceRequest): Promise<LocalServiceOutcome>;
}
export interface LocalServicesOptions {
  baseDir: string; env: NodeJS.ProcessEnv; entryPath: string; now?(): number;
  readStatuses?(signal?: AbortSignal): Promise<CollectionResult<ServiceSnapshot>>;
  readConfig?(signal?: AbortSignal): Promise<ReadResult<NodeConfig>>;
  readBroker?(signal?: AbortSignal): Promise<ReadResult<BrokerSummary>>;
  inspect?(signal?: AbortSignal): Promise<ServiceInspection>;
  guard?(selector: string, signal?: AbortSignal): Promise<ServiceGuard>;
  launch?(request: { extraArgs: string[]; logName: string; port?: number }): ServiceStarting | ServiceFailed;
  waitReady?(started: ServiceStarting, signal?: AbortSignal): Promise<ServiceReady | ServiceFailed>;
  stop?(request: ServiceStopRequest): Promise<ServiceStopResult>;
}

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const denied = (reason: string, nextStep = '核对本机服务和配置后刷新，再从服务列表重新选择。'): ServiceActionCheck => ({ allowed: false, reason, nextStep, impact: [] });
const issue = (source: string, message: string): QueryError => ({ source, kind: 'unavailable', message, nextStep: '核对文件格式、读取权限和本机服务进程后刷新。' });
function safeLabel(value: string): boolean { return value !== '' && !value.startsWith('-') && !/[\s<>:"/\\|?*]/u.test(value) && !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127); }
async function readMetadata(path: string, signal?: AbortSignal): Promise<string> {
  checkAbort(signal);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Error('服务来源不是有界普通文件');
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error('服务来源超过读取上限');
    const buffer = Buffer.alloc(Math.min(info.size + 1, 2 * 1024 * 1024 + 1));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0); checkAbort(signal);
    if (bytesRead > 2 * 1024 * 1024) throw new Error('服务来源超过读取上限');
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await file.close(); }
}
function selector(entry: BrokerEntry, config: NodeConfig): string | undefined {
  for (const value of [entry.name, entry.starId]) {
    if (!value || !safeLabel(value)) continue;
    try { if (selectConnectEntry(value, config).entry === entry) return value; } catch { /* Try the other existing selector. */ }
  }
  if (config.entries.length === 1 && !entry.name && !entry.starId) return '';
  return undefined;
}
function matches(process: ServiceProcess, entry: BrokerEntry, config: NodeConfig): boolean {
  if (process.kind !== 'node') return false;
  try { return selectConnectEntry(process.selector ?? '', config).entry === entry; } catch { return false; }
}
function logSource(label: string): string | undefined { return label === '' ? 'node:node.log' : safeLabel(label) ? `node:node-${label}.log` : undefined; }

/** Composition of existing service operations. Reads never run launch, stop, guard or registry writers. */
export function createLocalServices(options: LocalServicesOptions): LocalServices {
  const tcpDir = join(options.baseDir, 'tcp');
  const configPath = join(tcpDir, 'node.json');
  const now = options.now ?? Date.now;
  const inspect = options.inspect ?? ((signal) => inspectServiceProcesses({ baseDir: options.baseDir, signal }));
  const guard = options.guard ?? ((value, signal) => checkServiceGuard(value, { baseDir: options.baseDir, signal }));
  const launch = options.launch ?? ((request) => startDetachedService(request, { baseDir: options.baseDir, env: options.env, entryPath: options.entryPath, now }));
  const waitReady = options.waitReady ?? ((started, signal) => waitForServiceReady(started, {
    readStatus: async (path) => JSON.parse(await readMetadata(path, signal)) as unknown,
  }, { signal }));
  const stop = options.stop ?? ((request) => stopServicesInBackground(request, { baseDir: options.baseDir }));
  // Prepared operations belong to a particular observation, so concurrent reads cannot replace a confirmed plan.
  const launchRequests = new WeakMap<LocalService, { extraArgs: string[]; logName: string; port?: number }>();
  const stopRequests = new WeakMap<LocalService, ServiceStopRequest>();

  async function read(request: LocalServiceRead): Promise<CollectionResult<LocalService>> {
    const empty = (completeness: CollectionResult<LocalService>['completeness'], errors: QueryError[] = []): CollectionResult<LocalService> => ({ items: [], completeness, observedAt: now(), errors });
    if (request.contextId !== 'local') return empty('unavailable', [issue('services', '服务操作仅支持明确选中的本机上下文；未读取或操作本机服务。')]);
    if (request.signal?.aborted) return empty('cancelled');
    try {
      const [statuses, config, broker, processes] = await untilAborted(Promise.all([
        options.readStatuses?.(request.signal) ?? queryServiceStatuses({ tcpDir, signal: request.signal, now, readText: readMetadata }),
        options.readConfig?.(request.signal) ?? readParsed(configPath, (raw) => parseNodeConfig(raw, configPath), { signal: request.signal, now, readText: readMetadata }),
        options.readBroker?.(request.signal) ?? queryBroker({ tcpDir, signal: request.signal, now, readText: readMetadata }),
        inspect(request.signal),
      ]), request.signal);
      checkAbort(request.signal);
      const errors = [...statuses.errors, ...config.errors, ...broker.errors].filter((entry) => entry.kind !== 'missing');
      if (processes.state !== 'ready') errors.push(issue('services:processes', processes.message ?? '无法核验服务进程，起停已禁用。'));
      const sourcesOK = processes.state === 'ready';
      const snapshotsOK = statuses.completeness === 'complete' || statuses.errors.every((entry) => entry.kind === 'missing');
      const brokerSnapshot = statuses.items.find((item) => item.kind === 'broker');
      const brokerProcesses = processes.processes.filter((item) => item.kind === 'broker');
      const port = broker.value?.port ?? DEFAULT_PORT;
      const brokerId = 'service:broker';
      const brokerRevision = digest([brokerId, port, broker.value?.stars.map((star) => star.starId), brokerProcesses]);
      const brokerRunning = brokerProcesses.length > 0;
      const brokerUncertain = !sourcesOK || !snapshotsOK || (!brokerRunning && brokerSnapshot?.processAlive === true);
      const brokerImpact = [`当前本机 broker，端口 ${port}；托管 ${broker.value?.stars.length ?? 0} 颗星。`, '停止会断开这些星的机器连接及内挂聚合器；不终止原生工具会话。', ...brokerProcesses.map((item) => `当前 broker PID ${item.pid}`)];
      const brokerRow: LocalService = { id: brokerId, revision: brokerRevision, kind: 'broker', label: 'broker', target: `本机:${port}`,
        state: brokerUncertain ? 'unknown' : brokerRunning ? 'running' : 'not-running', ...(brokerProcesses.length === 1 ? { pid: brokerProcesses[0].pid } : {}), sourceId: 'broker',
        start: !sourcesOK || !snapshotsOK ? denied('服务进程或状态来源不完整，不能确认可安全启动。') : brokerUncertain ? denied('快照仍指向活进程，尚不能确认 broker 已停止。')
          : brokerRunning ? denied('已有 broker 服务在运行。') : broker.state !== 'ready' && broker.state !== 'missing' ? denied('broker 配置不可读或损坏；不会在查看或起停时自动重建。') : { allowed: true, impact: [brokerImpact[0], '会启动后台 broker，并按既有规则自登记、挂接本机聚合器；不会新建星。'] },
        stop: !sourcesOK ? denied('无法核验当前 broker 进程。') : brokerProcesses.length !== 1 ? denied(brokerProcesses.length ? '发现多个 broker 进程，不能将所选服务安全对应到唯一进程。' : '未发现运行中的 broker 进程。')
          : !processes.confirmedBrokerPids.includes(brokerProcesses[0].pid) ? denied('当前 broker PID 未通过配置端口的双重确认。') : { allowed: true, impact: brokerImpact },
        detail: [{ label: '服务范围', value: '本机 broker；内挂聚合器随其生命周期管理。' }, { label: '监听端口', value: String(port) }, { label: '托管星', value: broker.value?.stars.map((star) => `${star.name ?? '未命名'} (${star.starId ?? '未提供'})`).join('\n') || '尚无已配置星' }, { label: '快照', value: brokerSnapshot ? JSON.stringify(brokerSnapshot, null, 2) : '尚无快照' }] };
      const items: LocalService[] = [brokerRow];
      launchRequests.set(brokerRow, { extraArgs: [], logName: 'broker.log', port }); stopRequests.set(brokerRow, { target: 'broker', expectedPids: brokerProcesses.map((item) => item.pid) });
      const nodeConfig = config.value;
      const mapped = new Set<number>();
      const occurrences = new Map<string, number>();
      if (nodeConfig) for (const entry of nodeConfig.entries) {
        const identity = digest([entry.host, entry.port, entry.starId ?? null, entry.key]);
        const occurrence = occurrences.get(identity) ?? 0; occurrences.set(identity, occurrence + 1);
        const id = `service:node:${identity}${occurrence ? `:${occurrence}` : ''}`;
        const current = processes.processes.filter((item) => matches(item, entry, nodeConfig)); current.forEach((item) => mapped.add(item.pid));
        const selected = selector(entry, nodeConfig);
        const label = entry.name ?? entry.starId ?? `${entry.host}:${entry.port}`;
        const fileLabel = selected === '' ? '' : entry.name ?? selected;
        const snapshot = statuses.items.find((item) => item.kind === 'node' && current.length === 1 && item.pid === current[0].pid)
          ?? statuses.items.find((item) => item.kind === 'node' && item.file === `status-node${fileLabel ? `-${fileLabel}` : ''}.json`);
        const sourceId = snapshot && /^status-node(?:-.*)?\.json$/.test(snapshot.file)
          ? `node:${snapshot.file.slice('status-'.length, -'.json'.length)}.log` : fileLabel === undefined ? undefined : logSource(fileLabel);
        const hosted = brokerProcesses.length === 1 && brokerSnapshot?.processAlive === true && brokerSnapshot.state === 'running'
          && brokerSnapshot.stars?.some((star) => entry.starId ? star.starId === entry.starId : entry.name !== undefined && star.name === entry.name);
        const uncertain = !sourcesOK || !snapshotsOK || (!current.length && !hosted && snapshot?.processAlive === true);
        const duplicate = nodeConfig.entries.filter((other) => (entry.name !== undefined && other.name === entry.name) || (entry.starId !== undefined && other.starId === entry.starId)).length > 1;
        const start = !sourcesOK || !snapshotsOK ? denied('服务进程或状态来源不完整，不能确认可安全启动。') : uncertain ? denied('当前快照仍有活进程，不能确认服务已停止。')
          : duplicate ? denied('配置中的星名或完整星标识重复，不能唯一选择服务。') : selected === undefined || !sourceId ? denied('现有选择器或日志文件名不能安全对应到此条配置。')
          : current.length ? denied('此星已有节点守护运行，不能重复启动。') : hosted ? denied('本机 broker 已内挂此星的聚合器，无需另起节点守护。')
          : { allowed: true, impact: [`启动本机节点守护：${label}，目标 ${entry.host}:${entry.port}。`, '按现有配置连接所选星，并按既有规则维护聚合器与会话登记；不启动原生工具。'] };
        const stoppable = current.length === 1 ? current[0].selector : undefined;
        const stopping = !sourcesOK ? denied('无法核验当前节点守护进程。') : hosted && !current.length ? denied('此聚合器内挂于 broker，不能单独停止；请从 broker 服务查看整体影响。')
          : current.length !== 1 ? denied(current.length ? '多个守护映射到同一服务，无法安全确认唯一目标。' : '没有匹配运行进程。') : !stoppable ? denied('裸默认 --connect 只能通过旧命令停止全部节点；所选行不执行扩大范围的停机。', '需停止全部节点时，在终端核对影响后执行 crosschat serve --stop node。')
          : { allowed: true, impact: [`仅停止本机 PID ${current[0].pid} 的节点守护，原选择器 ${stoppable}。`, `目标星：${label} (${entry.starId ?? '未提供完整星标识'})；该星的本机机器连接和聚合器将停止。`, '不撤销节点钥匙、不删除星册位、不终止原生工具会话。'] };
        const revision = digest([id, entry.name, selected, current, hosted ? brokerProcesses[0].pid : null]);
        const row: LocalService = { id, revision, kind: 'node', label, target: `${entry.host}:${entry.port}`, ...(selected === undefined ? {} : { selector: selected }), ...(current.length === 1 ? { pid: current[0].pid } : hosted ? { pid: brokerProcesses[0].pid } : {}),
          state: uncertain ? 'unknown' : current.length ? 'running' : hosted ? 'hosted' : 'not-running', ...(hosted ? { sourceId: 'broker' } : sourceId ? { sourceId } : {}), start, stop: stopping,
          detail: [{ label: '完整星标识', value: entry.starId ?? '未提供' }, { label: '目标', value: `${entry.host}:${entry.port}` }, { label: '启动选择器', value: selected ?? '无法唯一选择' }, { label: '实际运行选择器', value: current.map((item) => `${item.selector || '(裸默认)'} · PID ${item.pid}`).join('\n') || (hosted ? 'broker 内挂聚合器' : '未发现') }, { label: '快照', value: snapshot ? JSON.stringify(snapshot, null, 2) : '尚无快照' }] };
        items.push(row);
        if (selected !== undefined && fileLabel !== undefined && sourceId) launchRequests.set(row, { extraArgs: ['--connect', ...(selected === '' ? [] : [selected])], logName: `node${fileLabel ? `-${fileLabel}` : ''}.log` });
        if (stoppable) stopRequests.set(row, { selector: stoppable, expectedPids: current.map((item) => item.pid) });
      }
      for (const process of processes.processes.filter((item) => item.kind === 'node' && !mapped.has(item.pid))) {
        const id = `service:orphan-node:${process.pid}`;
        const label = process.selector || '(裸默认节点)';
        const sameSelectors = processes.processes.filter((item) => item.kind === 'node' && item.selector === process.selector);
        const allowed = process.selector && sameSelectors.length === 1;
        const row: LocalService = { id, revision: digest([id, process.selector]), kind: 'node', label, target: '配置归属未知', pid: process.pid, state: 'unknown', ...(process.selector ? { selector: process.selector } : {}),
          start: denied('运行进程无法对应当前完整配置，不能启动替代服务。'), stop: allowed ? { allowed: true, impact: [`仅停止本机 PID ${process.pid} 的节点守护；原选择器 ${process.selector}。`, '配置归属未知；不终止原生工具、不修改凭证或星册。'] } : denied('选择器不明确或命中多个进程，不能执行精确停机。'),
          detail: [{ label: '归属', value: '此进程不能对应到当前 node.json 配置；先核对原选择器和进程。' }] };
        items.push(row);
        if (allowed) stopRequests.set(row, { selector: process.selector!, expectedPids: [process.pid] });
      }
      return { items, completeness: errors.length ? 'partial' : 'complete', observedAt: now(), errors };
    } catch { return empty(request.signal?.aborted ? 'cancelled' : 'unavailable', request.signal?.aborted ? [] : [issue('services', '无法完成服务来源读取；没有发出起停请求。')]); }
  }

  async function target(request: LocalServiceRequest): Promise<{ item?: LocalService; check: ServiceActionCheck }> {
    if (!['start', 'stop'].includes(request.operation)) return { check: denied('未知服务操作。') };
    const page = await read(request);
    const item = page.items.find((item) => item.id === request.id && item.revision === request.revision);
    if (!item) return { check: denied('服务配置或运行进程已经变化，原确认目标已失效。') };
    const availability = item[request.operation];
    if (!availability.allowed) return { item, check: availability };
    if (request.operation === 'start' && item.kind === 'node') {
      const result = await untilAborted(guard(item.selector ?? '', request.signal), request.signal);
      if (!result.allowed) return { item, check: denied(result.reason ?? '同星服务占用核验未通过。') };
      const verified = (await read(request)).items.find((candidate) => candidate.id === request.id && candidate.revision === request.revision);
      if (!verified || !verified.start.allowed) return { check: denied('服务配置或运行进程在核验期间已经变化，原确认目标已失效。') };
      checkAbort(request.signal); return { item: verified, check: verified.start };
    }
    checkAbort(request.signal); return { item, check: availability };
  }
  async function check(request: LocalServiceRequest): Promise<ServiceActionCheck> {
    try { return (await target(request)).check; }
    catch { return denied(request.signal?.aborted ? '服务核验已取消。' : '无法核验固定服务目标，未发出起停请求。'); }
  }
  async function execute(request: LocalServiceRequest): Promise<LocalServiceOutcome> {
    let issued = false;
    try {
      checkAbort(request.signal);
      const checked = await target(request);
      if (!checked.item || !checked.check.allowed) return { state: 'failed', message: checked.check.reason ?? '服务操作不可用。', id: request.id };
      checkAbort(request.signal);
      if (request.operation === 'start') {
        const launchRequest = launchRequests.get(checked.item);
        if (!launchRequest) return { state: 'failed', message: '启动目标已失效，请重新选择服务。', id: request.id };
        const started = launch(launchRequest); issued = started.state === 'starting';
        if (started.state === 'failed') return { state: 'failed', message: '后台服务未能启动，请查看服务日志和运行环境。', id: request.id };
        const result = await untilAborted(waitReady(started, request.signal), request.signal);
        if (result.state === 'ready') return { state: 'ready', message: `服务已实际就绪，PID ${result.pid}。`, id: request.id, pid: result.pid };
        return { state: result.reason === 'process-exited' ? 'failed' : 'unconfirmed', message: result.reason === 'cancelled' ? '启动请求未撤销，已停止等待；结果待核实。' : result.reason === 'process-exited' ? '服务进程已退出，未确认就绪；请查看日志。' : '启动请求已发出，尚未确认就绪；请核对状态与日志，勿盲目重试。', id: request.id, pid: started.pid };
      }
      const stopRequest = stopRequests.get(checked.item);
      if (!stopRequest) return { state: 'failed', message: '停止目标已失效，请重新选择服务。', id: request.id };
      issued = true;
      const result = await untilAborted(stop(stopRequest), request.signal);
      const terminated = result.events.filter((event) => event.kind === 'terminated');
      const expected = stopRequest.expectedPids ?? [];
      const success = result.state === 'ready' && expected.length > 0 && terminated.length === expected.length
        && terminated.every((event) => expected.includes(event.pid) && event.target === checked.item!.kind);
      return { state: success ? 'ready' : 'unconfirmed', message: success ? '已确认所选服务进程终止；原生会话未终止。' : '停机未取得完整终止回执，请核对进程和状态；不会自动重试。', id: request.id };
    } catch { return { state: issued ? 'unconfirmed' : request.signal?.aborted ? 'cancelled' : 'failed', message: issued ? '请求已发出，已停止等待；操作未撤销，结果待核实。' : request.signal?.aborted ? '已取消服务操作，尚未发出起停请求。' : '服务操作核验失败，尚未发出起停请求。', id: request.id }; }
  }
  return { read, check, execute };
}
