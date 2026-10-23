import type { ChildProcess, ForkOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createConnection } from 'node:net';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { isProcessAlive } from '../../platform/process-inspector.js';
import { DEFAULT_PORT } from '../../serve/broker.js';
import { removeCredentialExactFor, removeMachineExactFor, removeStarExactFrom } from '../../serve/registry.js';
import { addStar, generateAdminKey, generateKeys, removeAdminKey, removeNode, removeStar, renameStar, setDisplayName } from '../management/local.js';
import type { ManagementDeps, ManagementRequest, ManagementResult } from '../management/local.js';
import { sendAdminRequest } from '../management/transport.js';
import type { AdminOutcome, AdminSocket } from '../management/transport.js';
import { isRecord } from '../queries/reading.js';
import { readMembershipMachineId } from '../session-membership/machine.js';
import { runOwnedServiceProcess } from '../services/owned-process.js';
import { listServeProcesses } from '../services/processes.js';
import type { ProcInfo } from '../services/processes.js';
import { fullTcpMachineId, readTcpConfiguration, readTcpText } from './reading.js';

export interface LocalManagementOptions {
  baseDir: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  createProcess?(entry: URL, settings: ForkOptions): ChildProcess;
}
const failed = (): ManagementResult<never> => ({ kind: 'failed', error: '本机管理未取得可核实的完成回执；已发生的修改不会回滚，请核实。' });

/** Keep the existing transport semantics while bounding the new TUI receipt channel. */
function connectManagementPipe(pipe: string, onConnect: () => void): AdminSocket {
  const socket = createConnection({ path: pipe }, onConnect);
  const channel = Object.assign(new EventEmitter(), { write: (text: string) => socket.write(text), destroy: () => socket.destroy() });
  let received = 0;
  let oversized = false;
  socket.on('data', (chunk) => {
    if (oversized) return;
    received += chunk.length;
    if (received > 2 * 1024 * 1024) {
      oversized = true; socket.destroy(); channel.emit('error', new Error('本机管理回执超过读取上限。'));
    } else channel.emit('data', chunk);
  });
  socket.on('error', () => channel.emit('error', new Error('本机管理连接未确认。')));
  socket.on('close', () => channel.emit('close'));
  return channel;
}

/** Owns all blocking OS probes and synchronous writes outside the TUI input loop. */
export async function executeLocalManagement(request: ManagementRequest, options: LocalManagementOptions): Promise<ManagementResult<unknown>> {
  try {
    const value = await runOwnedServiceProcess({ baseDir: options.baseDir, request }, { entry: new URL('./local-management-process.js', import.meta.url),
      signal: options.signal, timeoutMs: options.timeoutMs ?? 25_000, createProcess: options.createProcess });
    if (!isRecord(value) || Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 * 1024) return failed();
    if (value.kind === 'applied' && (value.mode === 'hot' || value.mode === 'cold')) return { kind: 'applied', mode: value.mode, value: value.value };
    if (value.kind === 'rejected') return { kind: 'rejected', error: '本机管理拒绝此次操作，请核对目标和配置。' };
    return failed();
  } catch { return failed(); }
}

/** Test seam for the owned helper; defaults may block and must not run in a UI loop. */
export interface LocalManagementHelperOptions {
  baseDir: string;
  readStatus?(): Promise<unknown>;
  processes?(): ProcInfo[];
  alive?(pid: number): boolean;
  transport?(request: ManagementRequest, status: unknown): Promise<AdminOutcome>;
  machineId?(): Promise<string | undefined>;
}
export function isLocalManagementRequest(value: unknown): value is ManagementRequest {
  if (!isRecord(value)) return false;
  switch (value.op) {
    case 'add-star': return typeof value.name === 'string';
    case 'set-name': return typeof value.starId === 'string' && typeof value.name === 'string';
    case 'set-showname': return (value.starId === undefined || typeof value.starId === 'string') && typeof value.name === 'string';
    case 'rename-node': return typeof value.starId === 'string' && typeof value.machineId === 'string' && fullTcpMachineId(value.machineId) === value.machineId && typeof value.name === 'string' && value.name.length <= 32;
    case 'remove-machine': return typeof value.starId === 'string' && typeof value.machineId === 'string' && fullTcpMachineId(value.machineId) === value.machineId && isRecord(value.expected) && typeof value.expected.machineRevision === 'string' && /^[a-f0-9]{64}$/.test(value.expected.machineRevision);
    case 'remove-star': return typeof value.starId === 'string' && (value.expected === undefined || (isRecord(value.expected) && typeof value.expected.starRevision === 'string'));
    case 'gen-key': return typeof value.starId === 'string' && typeof value.host === 'string' && typeof value.n === 'number' && Number.isInteger(value.n) && value.n >= 1 && value.n <= 10 && typeof value.port === 'number' && Number.isInteger(value.port) && value.port >= 1 && value.port <= 65535;
    case 'gen-admin-key': return typeof value.starId === 'string' && typeof value.label === 'string';
    case 'remove-node': case 'remove-admin-key': return typeof value.starId === 'string' && typeof value.label === 'string' && (value.expected === undefined || (isRecord(value.expected) && typeof value.expected.credentialRevision === 'string' && (value.expected.machineId === null || typeof value.expected.machineId === 'string')));
    default: return false;
  }
}

/** Strict metadata before existing business functions; known live brokers never fall back cold. */
export async function performLocalManagement(request: ManagementRequest, options: LocalManagementHelperOptions): Promise<ManagementResult<unknown>> {
  try {
    const config = await readTcpConfiguration({ baseDir: options.baseDir });
    if (config.broker.value === null && config.broker.state !== 'missing') return failed();
    let emptyNodeConfiguration = false;
    if (request.op === 'add-star' && config.node.state === 'malformed') {
      const raw: unknown = JSON.parse(await readTcpText(options.baseDir, join(options.baseDir, 'tcp', 'node.json')));
      emptyNodeConfiguration = isRecord(raw) && Array.isArray(raw.brokers) && raw.brokers.length === 0 && (raw.showName === undefined || typeof raw.showName === 'string');
    }
    if ((request.op === 'add-star' || request.op === 'set-showname') && config.node.value === null && config.node.state !== 'missing' && !emptyNodeConfiguration) return failed();
    if (request.op !== 'add-star' && request.op !== 'set-showname'
      && (!('starId' in request) || !config.broker.value?.stars.some((star) => star.starId === request.starId))) return { kind: 'rejected', error: '所选完整星 ID 不在本机台账。' };
    if (request.op === 'set-showname' && (config.node.value === null || (request.starId !== undefined && config.node.value.entries.filter((entry) => entry.starId === request.starId).length !== 1))) return { kind: 'rejected', error: '本机未配置所选星，不能修改显示名。' };
    if (request.op === 'set-showname') {
      const raw: unknown = JSON.parse(await readTcpText(options.baseDir, join(options.baseDir, 'tcp', 'node.json')));
      if (!isRecord(raw) || !Array.isArray(raw.brokers)) return { kind: 'rejected', error: '当前本机配置形状不能由现有显示名写入器修改，请先核对配置。' };
    }
    let status: unknown;
    try { status = await (options.readStatus?.() ?? readTcpText(options.baseDir, join(options.baseDir, 'tcp', 'status-broker.json')).then((text): unknown => JSON.parse(text))); }
    catch (error) {
      if (!isRecord(error) || error.code !== 'ENOENT') return failed();
    }
    if (status !== undefined && (!isRecord(status) || !['running', 'stopped'].includes(String(status.state))
      || typeof status.pid !== 'number' || !Number.isSafeInteger(status.pid) || status.pid <= 0)) return failed();
    const brokers = (options.processes ?? listServeProcesses)().filter((item) => !item.cmdline.includes('--connect'));
    const alive = options.alive ?? isProcessAlive;
    const hot = isRecord(status) && status.state === 'running' && typeof status.pid === 'number' && Number.isSafeInteger(status.pid) && status.pid > 0 && alive(status.pid);
    if ((brokers.length > 0 && !hot) || (hot && (!isRecord(status) || !brokers.some((item) => item.pid === status.pid)
      || typeof status.adminPipe !== 'string' || status.adminPipe === '' || status.port !== (config.broker.value?.port ?? DEFAULT_PORT)))) return failed();
    const deps: ManagementDeps = { baseDir: options.baseDir, machineId: () => machine, hostname,
      adminTransport: async (operation) => {
        if (!hot) return { kind: 'cold' };
        const result = await (options.transport?.(operation, status) ?? sendAdminRequest({ baseDir: options.baseDir, readStatus: () => status, isProcessAlive: alive, connect: connectManagementPipe }, operation));
        if (result.kind === 'hot' && result.reply.uncertain === true) return { kind: 'failed', error: 'broker 未确认完整事务，结果待核实。' };
        return result.kind === 'cold' ? { kind: 'failed', error: '已核实的热态管理连接失败，禁止直写台账。' } : result;
      } };
    const machine = request.op === 'add-star' ? fullTcpMachineId(await (options.machineId?.() ?? readMembershipMachineId())) : undefined;
    if (request.op === 'rename-node' || request.op === 'remove-machine') {
      if (hot) {
        const outcome = await deps.adminTransport!(request);
        if (outcome.kind !== 'hot') return failed();
        if (outcome.reply.uncertain === true) return failed();
        return outcome.reply.ok ? { kind: 'applied', mode: 'hot', value: outcome.reply } : { kind: 'rejected', mode: 'hot', error: '目标已变化、未在线或管理请求被拒绝。' };
      }
      if (request.op === 'rename-node') return { kind: 'rejected', mode: 'cold', error: 'broker 未运行，不能在线核实对端保存及生效；不会冷写本机代替。' };
      const result = removeMachineExactFor(join(options.baseDir, 'tcp', 'broker.json'), request.starId, request.machineId, request.expected);
      return result.kind === 'removed' ? { kind: 'applied', mode: 'cold', value: { removed: true, machineId: result.machineId, removedLabels: result.credentials.map((credential) => credential.label) } }
        : { kind: 'rejected', mode: 'cold', error: '所选机器的完整节点凭证集合已变化，未执行移除。' };
    }
    if ((request.op === 'remove-node' || request.op === 'remove-admin-key' || request.op === 'remove-star') && request.expected !== undefined) {
      if (hot) {
        const outcome = await deps.adminTransport!(request);
        if (outcome.kind !== 'hot') return failed();
        return outcome.reply.ok ? { kind: 'applied', mode: 'hot', value: outcome.reply }
          : { kind: 'rejected', mode: 'hot', error: 'broker 拒绝精确删除，目标或权限已变化。' };
      }
      const file = join(options.baseDir, 'tcp', 'broker.json');
      if (request.op === 'remove-star') {
        const result = removeStarExactFrom(file, request.starId, request.expected);
        return result.kind === 'removed' ? result.cleanupFailed ? failed() : { kind: 'applied', mode: 'cold', value: { removed: result.removed } }
          : { kind: 'rejected', mode: 'cold', error: '完整星及其静态影响已变化，未执行删除。' };
      }
      const result = removeCredentialExactFor(file, request.starId, request.label, request.op === 'remove-admin-key' ? 'admin' : 'node', request.expected);
      return result.kind === 'removed' ? { kind: 'applied', mode: 'cold', value: { removed: request.op === 'remove-admin-key' ? result.credential.label : true } }
        : { kind: 'rejected', mode: 'cold', error: '完整凭证或机器绑定已变化，未执行撤销。' };
    }
    switch (request.op) {
      case 'add-star': return await addStar({ name: request.name }, deps);
      case 'set-name': return await renameStar({ starId: request.starId, name: request.name }, deps);
      case 'set-showname': return await setDisplayName({ name: request.name, ...(request.starId === undefined ? {} : { starId: request.starId }) }, deps);
      case 'gen-key': return await generateKeys({ starId: request.starId, n: request.n, host: request.host, port: request.port }, deps);
      case 'gen-admin-key': return await generateAdminKey({ starId: request.starId, label: request.label }, deps);
      // These operations retain the existing CLI contract; TUI enables them only after its atomic target guard exists.
      case 'remove-node': return await removeNode({ starId: request.starId, label: request.label }, deps);
      case 'remove-admin-key': return await removeAdminKey({ starId: request.starId, label: request.label }, deps);
      case 'remove-star': return await removeStar({ starId: request.starId }, deps);
    }
  } catch { return failed(); }
}
