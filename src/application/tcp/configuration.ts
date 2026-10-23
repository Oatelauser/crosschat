export interface TcpConfigurationTarget {
  contextId: string;
  starId: string;
  name: string | null;
  host: string;
  port: number;
}
export interface TcpConfigurationPreview {
  enabled: boolean;
  revision: string;
  targets: TcpConfigurationTarget[];
  impact: string[];
  message: string;
  reason?: string;
}
export interface TcpConfigurationResult {
  status: 'applied' | 'blocked' | 'changed' | 'cancelled' | 'failed';
  message: string;
  targets: TcpConfigurationTarget[];
  contextId?: string;
}
export interface TcpConfigurationImportOptions {
  baseDir: string;
  /** Atomic replacement seam for isolated filesystem failures. */
  renameFile?: (from: string, to: string) => void;
}
export interface TcpConfigurationImport {
  preview(request: { content: string; signal?: AbortSignal }): Promise<TcpConfigurationPreview>;
  apply(request: { content: string; expectedRevision: string; signal?: AbortSignal }): Promise<TcpConfigurationResult>;
}
export interface TcpConfigurationItem extends TcpConfigurationTarget { revision: string }
export interface TcpConfigurationList {
  targets: TcpConfigurationItem[];
  completeness: 'complete' | 'unavailable' | 'cancelled';
  observedAt: number;
  message?: string;
}
export interface TcpConfigurationChange {
  operation: 'edit' | 'remove';
  contextId: string;
  targetRevision: string;
  values: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}
export interface TcpConfigurationManager extends TcpConfigurationImport {
  list(request?: { signal?: AbortSignal }): Promise<TcpConfigurationList>;
  previewChange(request: TcpConfigurationChange): Promise<TcpConfigurationPreview>;
  applyChange(request: TcpConfigurationChange & { expectedRevision: string }): Promise<TcpConfigurationResult>;
}

const MAX_BYTES = 2 * 1024 * 1024;
interface CurrentConfiguration { raw: string | null; identity: string }
interface ConfigurationDocument { raw: Record<string, unknown>; brokers: Array<Record<string, unknown>>; targets: TcpConfigurationTarget[] }
interface ConfigurationPlan { preview: TcpConfigurationPreview; previous: CurrentConfiguration; text: string; input: string }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const missing = (error: unknown) => isRecord(error) && error.code === 'ENOENT';
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 65_536;
function invalid(): never { throw new Error('Invalid current TCP configuration'); }

/** Validate the current format without normalizing away unknown fields or rewriting legacy shapes. */
function document(content: string, allowEmpty = false): ConfigurationDocument {
  if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_BYTES) invalid();
  const raw: unknown = JSON.parse(content);
  if (!isRecord(raw) || !Array.isArray(raw.brokers) || (!allowEmpty && !raw.brokers.length) || (raw.showName !== undefined && !text(raw.showName))) invalid();
  const ids = new Set<string>();
  const brokers: Array<Record<string, unknown>> = [];
  const targets = raw.brokers.map((entry): TcpConfigurationTarget => {
    if (!isRecord(entry) || !text(entry.host) || !entry.host || /[\s/\\@?#]/.test(entry.host)
      || [...entry.host].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      || typeof entry.port !== 'number' || !Number.isSafeInteger(entry.port) || entry.port < 1 || entry.port > 65535
      || !text(entry.starId) || !entry.starId || ids.has(entry.starId) || !text(entry.key) || !entry.key
      || (entry.adminKey !== undefined && (!text(entry.adminKey) || !entry.adminKey))
      || (entry.name !== undefined && !text(entry.name)) || (entry.showName !== undefined && !text(entry.showName))) invalid();
    ids.add(entry.starId); brokers.push(entry);
    return { contextId: tcpContextId({ host: entry.host, port: entry.port, starId: entry.starId, key: entry.key }),
      starId: entry.starId, name: typeof entry.name === 'string' ? entry.name : null, host: entry.host, port: entry.port };
  });
  return { raw, brokers, targets };
}

/** Stop at a linked ancestor before inspecting any child or reading linked content. */
function directories(baseDir: string): string[] {
  const directory = join(baseDir, 'tcp');
  const root = parse(directory).root;
  let current = root;
  const absent: string[] = [];
  for (const part of relative(root, directory).split(sep)) {
    current = join(current, part);
    if (absent.length) { absent.push(current); continue; }
    try {
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) invalid();
    } catch (error) {
      if (!missing(error)) throw error;
      absent.push(current);
    }
  }
  if (absent.some((path) => path !== baseDir && path !== directory)) invalid();
  return absent;
}

/** Bounded EOF read with identity checks; linked or multiply-owned credentials are never opened. */
function original(baseDir: string): CurrentConfiguration {
  if (directories(baseDir).length) return { raw: null, identity: 'missing' };
  const file = join(baseDir, 'tcp', 'node.json');
  let before;
  try { before = lstatSync(file, { bigint: true }); } catch (error) { if (missing(error)) return { raw: null, identity: 'missing' }; throw error; }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(MAX_BYTES)) invalid();
  const descriptor = openSync(file, 'r');
  try {
    const stat = fstatSync(descriptor, { bigint: true });
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || stat.nlink !== 1n || stat.size > BigInt(MAX_BYTES)) invalid();
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = readSync(descriptor, buffer, bytes, buffer.length - bytes, null);
      if (!count) break;
      bytes += count;
    }
    if (bytes > MAX_BYTES) invalid();
    directories(baseDir);
    const after = lstatSync(file, { bigint: true });
    const opened = fstatSync(descriptor, { bigint: true });
    if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1n || after.dev !== stat.dev || after.ino !== stat.ino
      || opened.size !== stat.size || opened.mtimeNs !== stat.mtimeNs || opened.ctimeNs !== stat.ctimeNs
      || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) invalid();
    return { raw: new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes)),
      identity: JSON.stringify([stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String)) };
  } finally { closeSync(descriptor); }
}

const blocked = (cancelled: boolean): TcpConfigurationPreview => ({ enabled: false, revision: '', targets: [], impact: [],
  message: cancelled ? '配置导入预览已取消。' : '未能生成安全的配置追加预览。',
  reason: cancelled ? '需要时重新预览。' : '仅支持有完整星 ID 的当前 brokers[] 配置；请核对格式、重复星、现有文件和目录权限。不会替换已有凭证或修复文件。' });

/** Private secret input; the returned plan contains only connection metadata. */
export function createTcpConfiguration(options: TcpConfigurationImportOptions): TcpConfigurationManager {
  const baseDir = resolve(options.baseDir);
  const directory = join(baseDir, 'tcp');
  const file = join(directory, 'node.json');
  function plan(content: string, signal?: AbortSignal): ConfigurationPlan {
    checkAbort(signal);
    const incoming = document(content);
    const previous = original(baseDir);
    const current = previous.raw === null ? undefined : document(previous.raw, true);
    const existing = new Set(current?.targets.map((target) => target.starId));
    if (incoming.targets.some((target) => existing.has(target.starId))) invalid();
    const next = current ? { ...current.raw, brokers: [...current.brokers, ...incoming.brokers] } : incoming.raw;
    const encoded = `${JSON.stringify(next, null, 2)}\n`;
    if (Buffer.byteLength(encoded) > MAX_BYTES) invalid();
    checkAbort(signal);
    return { previous, input: content, text: encoded, preview: { enabled: true, revision: digest([previous, content]), targets: incoming.targets,
      impact: [`向本机 node.json 追加 ${incoming.targets.length} 个新星配置；已有条目与字段保留。`,
        '不替换任何已有星的凭证，不认证、不连接，也不启动服务。'], message: '核对接收星和地址后确认追加配置。' } };
  }
  async function preview(request: { content: string; signal?: AbortSignal }): Promise<TcpConfigurationPreview> {
    try { return plan(request.content, request.signal).preview; } catch { return blocked(request.signal?.aborted === true); }
  }
  async function apply(request: { content: string; expectedRevision: string; signal?: AbortSignal }): Promise<TcpConfigurationResult> {
    if (request.signal?.aborted) return { status: 'cancelled', message: '配置导入已取消，尚未写入。', targets: [] };
    let prepared: ConfigurationPlan;
    try { prepared = plan(request.content, request.signal); }
    catch { return { status: 'blocked', message: blocked(false).reason!, targets: [] }; }
    return replace(prepared, request.expectedRevision, request.signal, '配置已追加；连接身份尚未认证，服务尚未启动。');
  }
  function replace(prepared: ConfigurationPlan, expectedRevision: string, signal: AbortSignal | undefined, message: string): TcpConfigurationResult {
    if (prepared.preview.revision !== expectedRevision) return { status: 'changed', message: '配置或输入内容已变化，请重新预览并确认。', targets: [] };
    let temporary: string | undefined;
    let result: TcpConfigurationResult;
    try {
      // Keep this bounded section synchronous: no in-process writer can interleave after confirmation.
      for (const absent of directories(baseDir)) { mkdirSync(absent, { mode: 0o700 }); directories(baseDir); }
      checkAbort(signal);
      const candidate = join(directory, `.node.import.${randomUUID()}.tmp`);
      const descriptor = openSync(candidate, 'wx', 0o600);
      temporary = candidate;
      try { writeFileSync(descriptor, prepared.text, 'utf8'); } finally { closeSync(descriptor); }
      checkAbort(signal);
      // Existing CLI writers do not share a lock. Recheck immediately before atomic replacement;
      // this detects observed changes, rather than claiming cross-process compare-and-swap.
      const latest = original(baseDir);
      if (digest([latest, prepared.input]) !== prepared.preview.revision) result = { status: 'changed', message: '配置在写入前发生变化，未替换；请重新预览。', targets: [] };
      else {
        (options.renameFile ?? renameSync)(temporary, file); temporary = undefined;
        result = { status: 'applied', message, targets: prepared.preview.targets,
          contextId: prepared.preview.targets[0]?.contextId };
      }
    } catch {
      result = { status: signal?.aborted ? 'cancelled' : 'failed', message: signal?.aborted ? '配置修改已取消，尚未替换配置。' : '配置修改未完成，请检查本机文件权限后重新预览。', targets: [] };
    } finally {
      if (temporary !== undefined) {
        try { unlinkSync(temporary); }
        catch { result = { status: 'failed', message: '导入临时配置未能清理，请检查本机 tcp 目录后再操作。', targets: [] }; }
      }
    }
    return result;
  }
  const itemRevision = (previous: CurrentConfiguration, contextId: string): string => digest([previous, contextId]);
  async function list(request: { signal?: AbortSignal } = {}): Promise<TcpConfigurationList> {
    try {
      checkAbort(request.signal);
      const previous = original(baseDir);
      const current = previous.raw === null ? undefined : document(previous.raw, true);
      checkAbort(request.signal);
      return { targets: (current?.targets ?? []).map((target) => ({ ...target, revision: itemRevision(previous, target.contextId) })), completeness: 'complete', observedAt: Date.now() };
    } catch {
      return { targets: [], completeness: request.signal?.aborted ? 'cancelled' : 'unavailable', observedAt: Date.now(), message: request.signal?.aborted ? '配置读取已取消。' : '本机 TCP 配置无法安全读取；核对文件格式、目录与读取权限后刷新。' };
    }
  }
  function changePlan(request: TcpConfigurationChange): ConfigurationPlan {
    checkAbort(request.signal);
    if (!['edit', 'remove'].includes(request.operation) || !request.contextId || !request.targetRevision) invalid();
    const allowed = request.operation === 'edit' ? ['host', 'port', 'key', 'adminKey', 'adminKeyAction'] : [];
    if (Object.keys(request.values).some((key) => !allowed.includes(key)) || Object.values(request.values).some((value) => !text(value))) invalid();
    const previous = original(baseDir);
    if (previous.raw === null || itemRevision(previous, request.contextId) !== request.targetRevision) invalid();
    const current = document(previous.raw, true);
    const index = current.targets.findIndex((target) => target.contextId === request.contextId);
    if (index < 0) invalid();
    const selected = current.targets[index];
    const brokers = [...current.brokers];
    if (request.operation === 'remove') brokers.splice(index, 1);
    else {
      const value = request.values;
      const replacement = { ...brokers[index] };
      if (value.host !== undefined) replacement.host = value.host;
      if (value.port !== undefined) {
        if (!/^\d+$/.test(value.port)) invalid();
        replacement.port = Number(value.port);
      }
      if (value.key) replacement.key = value.key;
      const adminAction = value.adminKeyAction ?? 'keep';
      if (!['keep', 'replace', 'remove'].includes(adminAction) || (adminAction === 'replace' && !value.adminKey) || (adminAction === 'remove' && value.adminKey)) invalid();
      if (adminAction === 'remove') delete replacement.adminKey;
      else if (value.adminKey) replacement.adminKey = value.adminKey;
      brokers[index] = replacement;
    }
    const encoded = `${JSON.stringify({ ...current.raw, brokers }, null, 2)}\n`;
    const next = document(encoded, true);
    const input = JSON.stringify([request.operation, request.contextId, request.targetRevision, Object.entries(request.values).sort(([left], [right]) => left.localeCompare(right))]);
    const destination = request.operation === 'remove' ? selected : next.targets[index];
    return { previous, input, text: encoded, preview: { enabled: true, revision: digest([previous, input]), targets: [destination],
      message: request.operation === 'remove' ? '核对本机连接后确认移除。' : '核对新的连接配置后确认保存。', impact: [
        `${request.operation === 'remove' ? '移除' : '编辑'}本机连接：${selected.name ?? selected.starId} (${selected.starId})，${selected.host}:${selected.port}。`,
        '只修改当前用户的本机配置；不删除远端星、不撤钥、不停止或重启服务。已有服务可能仍按原配置运行，请到服务列表核实。',
        ...(request.operation === 'remove' ? ['broker 自用条目可能在下次 broker 启动时按既有自登记规则补建；本次移除不表示禁止自登记。'] : [`保存后的地址：${destination.host}:${destination.port}；星身份保持不变，空秘密字段保留原值。`]),
      ] } };
  }
  async function previewChange(request: TcpConfigurationChange): Promise<TcpConfigurationPreview> {
    try { return changePlan(request).preview; }
    catch { return { enabled: false, revision: '', targets: [], impact: [], message: '未保存连接配置。', reason: request.signal?.aborted ? '操作已取消。' : '目标配置已变化或输入无效；刷新后重新选择完整连接并确认。' }; }
  }
  async function applyChange(request: TcpConfigurationChange & { expectedRevision: string }): Promise<TcpConfigurationResult> {
    if (request.signal?.aborted) return { status: 'cancelled', message: '配置修改已取消，尚未写入。', targets: [] };
    let prepared: ConfigurationPlan;
    try { prepared = changePlan(request); }
    catch { return { status: 'blocked', message: '连接或输入已变化，未修改本机配置；请刷新重新确认。', targets: [] }; }
    return replace(prepared, request.expectedRevision, request.signal, request.operation === 'remove' ? '已移除本机连接配置；服务未停止，远端星和钥匙未修改。' : '本机连接配置已保存；已有服务未重启，新连接将使用新配置。');
  }
  return { preview, apply, list, previewChange, applyChange };
}

import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, parse, relative, resolve, sep } from 'node:path';
import { checkAbort, isRecord } from '../queries/reading.js';
import { tcpContextId } from './reading.js';

