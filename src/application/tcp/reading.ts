import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeMid } from '../../platform/machine-id.js';
import { parseNodeConfig } from '../../serve/node-config.js';
import type { BrokerEntry, NodeConfig } from '../../serve/node-config.js';
import type { BrokerFile, NodeEntry, RosterEntry, StarRecord } from '../../serve/registry.js';
import { checkAbort, isRecord, readParsed } from '../queries/reading.js';
import type { ReadResult, TextOptions } from '../queries/reading.js';
import type { TcpRole } from './model.js';

export interface TcpConfigurationOptions extends TextOptions { baseDir: string }
export interface TcpConfiguration { broker: ReadResult<BrokerFile>; node: ReadResult<NodeConfig> }
/** Private application target: never return this credential-bearing object to a resource page. */
export interface TcpResolvedContext {
  contextId: string;
  kind: 'local' | 'tcp';
  revision: string;
  broker: BrokerFile | null;
  nodeConfig: NodeConfig | null;
  entry?: BrokerEntry;
  role: TcpRole;
}
export interface TcpResolvedTarget extends TcpResolvedContext { starId?: string; star?: StarRecord }
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function fullTcpMachineId(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^[0-9a-fA-F-]+$/.test(value)) return undefined;
  const machine = normalizeMid(value);
  return machine.length === 32 ? machine : undefined;
}
/** Same stable context identity as the existing read-only connection catalog. */
export function tcpContextId(entry: BrokerEntry): string {
  const host = entry.host.includes(':') && !entry.host.startsWith('[') ? `[${entry.host}]` : entry.host;
  const endpoint = `${host}:${entry.port}`;
  return entry.starId ? `tcp:star:${encodeURIComponent(entry.starId)}:${encodeURIComponent(endpoint)}`
    : `tcp:endpoint:${encodeURIComponent(endpoint)}:${createHash('sha256').update(entry.key).digest('hex')}`;
}
export function tcpNodeContextId(contextId: string, starId: string, machineId: string): string {
  const full = fullTcpMachineId(machineId);
  if (!full) throw new Error('A complete machine identity is required');
  return JSON.stringify(['tcp-node', contextId, starId, full]);
}
function optionalText(value: unknown): boolean { return value === undefined || typeof value === 'string'; }
function invalid(): never { throw new Error('Invalid TCP configuration'); }
function parseNode(value: unknown): NodeEntry {
  if (!isRecord(value) || typeof value.label !== 'string' || !value.label || typeof value.addedAt !== 'string' || !Number.isFinite(Date.parse(value.addedAt))) invalid();
  const member = typeof value.key === 'string' && value.key !== '';
  const admin = typeof value.adminKey === 'string' && value.adminKey !== '';
  if (member === admin || !optionalText(value.machineName) || !optionalText(value.machineId)
    || (value.machineId !== undefined && value.machineId !== '' && fullTcpMachineId(value.machineId) === undefined)
    || (admin && typeof value.machineId === 'string' && value.machineId !== '')) invalid();
  return { ...value, label: value.label, addedAt: value.addedAt,
    ...(member ? { key: value.key as string } : {}), ...(admin ? { adminKey: value.adminKey as string } : {}),
    ...(typeof value.machineId === 'string' ? { machineId: value.machineId } : {}), ...(typeof value.machineName === 'string' ? { machineName: value.machineName } : {}) };
}
function parseMember(value: unknown): RosterEntry {
  if (!isRecord(value) || typeof value.sessionId !== 'string' || !value.sessionId || fullTcpMachineId(value.machine) === undefined
    || !['name', 'tool', 'machineName', 'extendsName', 'extendsMachine'].every((field) => optionalText(value[field]))
    || (value.temporary !== undefined && typeof value.temporary !== 'boolean')) invalid();
  const copy: Record<string, unknown> = { ...value };
  delete copy.online;
  return { ...copy, sessionId: value.sessionId, machine: value.machine as string,
    ...(typeof value.name === 'string' ? { name: value.name } : {}), ...(typeof value.tool === 'string' ? { tool: value.tool } : {}),
    ...(typeof value.machineName === 'string' ? { machineName: value.machineName } : {}), ...(typeof value.extendsName === 'string' ? { extendsName: value.extendsName } : {}),
    ...(typeof value.extendsMachine === 'string' ? { extendsMachine: value.extendsMachine } : {}), ...(typeof value.temporary === 'boolean' ? { temporary: value.temporary } : {}) };
}
function parseBroker(raw: string): BrokerFile {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || !Array.isArray(value.stars) || (value.port !== undefined && (!Number.isInteger(value.port) || Number(value.port) < 1 || Number(value.port) > 65535))) invalid();
  const ids = new Set<string>();
  const stars = value.stars.map((star): StarRecord => {
    if (!isRecord(star) || typeof star.starId !== 'string' || !star.starId || ids.has(star.starId) || !optionalText(star.name)
      || !Array.isArray(star.nodes) || (star.roster !== undefined && !Array.isArray(star.roster))) invalid();
    ids.add(star.starId);
    const nodes = star.nodes.map(parseNode);
    if (new Set(nodes.map((node) => node.label)).size !== nodes.length) invalid();
    const roster = (star.roster ?? []).map(parseMember);
    if (new Set(roster.map((member) => member.sessionId)).size !== roster.length) invalid();
    return { ...star, starId: star.starId, ...(typeof star.name === 'string' ? { name: star.name } : {}), nodes, roster };
  });
  return { ...value, ...(typeof value.port === 'number' ? { port: value.port } : {}), stars };
}

/** Bounded ordinary-file reads; the UI cannot supply arbitrary paths or follow linked directories. */
export async function readTcpText(baseDir: string, file: string, signal?: AbortSignal): Promise<string> {
  checkAbort(signal);
  for (const directory of [baseDir, join(baseDir, 'tcp')]) {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('TCP metadata directory is not ordinary');
  }
  const before = await lstat(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(MAX_FILE_BYTES)) throw new Error('TCP metadata is not a bounded ordinary file');
  checkAbort(signal);
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || stat.size > BigInt(MAX_FILE_BYTES)) throw new Error('TCP metadata changed while opening');
    const buffer = Buffer.alloc(Math.min(Number(stat.size) + 1, MAX_FILE_BYTES + 1));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    checkAbort(signal);
    if (bytesRead > MAX_FILE_BYTES) throw new Error('TCP metadata exceeds its read limit');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead));
  } finally { await handle.close(); }
}
export async function readTcpConfiguration(options: TcpConfigurationOptions): Promise<TcpConfiguration> {
  const readText = options.readText ?? ((file, signal) => readTcpText(options.baseDir, file, signal));
  const settings = { ...options, readText };
  const [broker, node] = await Promise.all([
    readParsed(join(options.baseDir, 'tcp', 'broker.json'), parseBroker, settings),
    readParsed(join(options.baseDir, 'tcp', 'node.json'), (raw) => {
      const parsed = parseNodeConfig(raw, 'node.json');
      if (parsed.entries.some((entry) => !entry.host || /[\s/\\@?#]/.test(entry.host) || entry.port < 1 || entry.port > 65535)) invalid();
      return parsed;
    }, settings),
  ]);
  return { broker, node };
}
export async function resolveTcpContext(options: TcpConfigurationOptions & { contextId: string }): Promise<ReadResult<TcpResolvedContext>> {
  const observedAt = (options.now ?? Date.now)();
  const configuration = await readTcpConfiguration(options);
  const failure = (state: ReadResult<TcpResolvedContext>['state'], errors: ReadResult<TcpResolvedContext>['errors']): ReadResult<TcpResolvedContext> => ({ state, value: null, observedAt, errors });
  if (options.signal?.aborted) return failure('cancelled', [{ source: options.contextId, kind: 'cancelled', message: 'TCP 读取已取消。', nextStep: '需要时重新读取。' }]);
  if (options.contextId === 'local') {
    if (configuration.broker.value === null && configuration.broker.state !== 'missing') return failure(configuration.broker.state, configuration.broker.errors);
    return { state: 'ready', value: { contextId: 'local', kind: 'local', role: 'broker-owner', revision: digest(configuration.broker.value), broker: configuration.broker.value, nodeConfig: configuration.node.value }, observedAt, errors: [] };
  }
  if (!options.contextId.startsWith('tcp:')) return failure('unavailable', [{ source: options.contextId, kind: 'unavailable', message: '此上下文不是可核验的 TCP 连接。', nextStep: '返回连接列表选择已配置的星。' }]);
  if (configuration.node.value === null) return failure(configuration.node.state, configuration.node.errors);
  if (configuration.node.value.entries.length === 0) return failure('missing', [{ source: 'node.json', kind: 'missing', message: '本机尚未配置 TCP 连接。', nextStep: '从连接列表添加已有星的配置，再选择明确连接。' }]);
  const entries = configuration.node.value.entries.filter((entry) => tcpContextId(entry) === options.contextId);
  if (entries.length !== 1) return failure('unavailable', [{ source: options.contextId, kind: 'unavailable', message: '所选 TCP 配置已不存在或对应多个凭证，不能确定唯一连接。', nextStep: '核对 node.json 后返回连接列表刷新；不会改用本机数据。' }]);
  const entry = entries[0];
  return { state: 'ready', value: { contextId: options.contextId, kind: 'tcp', role: entry.adminKey ? 'star-admin' : 'member', revision: digest(entry), broker: null, nodeConfig: configuration.node.value, entry }, observedAt, errors: [] };
}
