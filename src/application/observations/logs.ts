import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { communicationPairId } from './communications.js';
import { decodeRef } from '../../ref.js';
import { queryLogWindow } from '../queries/logs.js';
import type { LogCursor } from '../queries/logs.js';
import { checkAbort, isRecord, queryError } from '../queries/reading.js';
import type { QueryError } from '../queries/reading.js';
import type { CollectionResult } from '../queries/services.js';
import type { SessionRef } from '../sessions/model.js';

export interface ManagedLogSource { id: string; label: string; path: string }
export interface ManagedLogLine { id: string; offset: number; text: string; terminated: boolean }
export interface LogCheckpoint { cursor: LogCursor; epoch: number }
export interface ManagedLogResult extends CollectionResult<ManagedLogLine> {
  source: ManagedLogSource | null;
  sources: readonly ManagedLogSource[];
  checkpoint?: LogCheckpoint;
  bytesRead: number;
  truncated: boolean;
  omittedLeadingLine: boolean;
  rotated: boolean;
}
export interface ManagedLogOptions {
  baseDir: string;
  sourceId?: string;
  signal?: AbortSignal;
  now?: () => number;
  maxBytes?: number;
  previous?: LogCheckpoint;
  sessionRef?: SessionRef;
  pairId?: string;
  contextId?: string;
}

const secretKey = /^(?:key|adminkey|auth|proof|nonce|token|peertoken|envelope|body|content|messages|adminpipe|messagingsocketpath|socketpath)$/i;

/** Only these local files are selectable. A route never supplies an arbitrary path. */
async function sources(baseDir: string, signal?: AbortSignal): Promise<{ items: ManagedLogSource[]; errors: QueryError[] }> {
  checkAbort(signal);
  const tcp = join(baseDir, 'tcp');
  const known = [
    { id: 'send-log', label: '投递日志', path: join(baseDir, 'send-log.jsonl') },
    { id: 'broker', label: 'broker日志', path: join(tcp, 'broker.log') },
    { id: 'launcher', label: '会话接入日志', path: join(tcp, 'launcher.log') },
  ];
  let names: string[];
  const errors: QueryError[] = [];
  try { names = await readdir(tcp); }
  catch (error) {
    if (!isRecord(error) || error.code !== 'ENOENT') errors.push(queryError(tcp, error));
    names = [];
  }
  checkAbort(signal);
  for (const name of names.sort()) if (/^node(?:-[^/\\\0]+)?\.log(?:\.old)?$/.test(name)) known.push({ id: `node:${name}`, label: `节点日志 ${name}`, path: join(tcp, name) });
  const all = [...known, ...known.filter((source) => !source.id.endsWith('.old')).map((source) => ({ id: `${source.id}.old`, label: `${source.label}（轮转副本）`, path: `${source.path}.old` }))];
  return { items: [...new Map(all.map((source) => [source.id, source])).values()], errors };
}

function safeLine(raw: string): string {
  const sanitize = (input: unknown, depth = 0): unknown => {
    if (depth > 32) return '[深层内容已隐藏]';
    if (Array.isArray(input)) return input.map((item: unknown) => sanitize(item, depth + 1));
    if (!isRecord(input)) return input;
    return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, secretKey.test(key) ? '[已隐藏]' : sanitize(value, depth + 1)]));
  };
  let safe = raw;
  try {
    const value: unknown = JSON.parse(raw);
    const normalized = JSON.stringify(sanitize(value));
    if (normalized !== JSON.stringify(value)) safe = normalized;
  } catch { /* Plain resident events are still useful; handle named secrets below. */ }
  safe = safe.replace(/((?:["']?)(?:adminKey|key|auth|proof|nonce|token|peerToken|envelope|body|adminPipe|messagingSocketPath|socketPath)(?:["']?)\s*[:=]\s*)("(?:\\.|[^"\\])*"|'[^']*'|[^\s,;]+)/gi, '$1[已隐藏]');
  return safe.replace(/(?:admin\s*插座|attach\s*管道).*$/i, '[本机插座信息已隐藏]');
}

function matches(raw: string, options: ManagedLogOptions): boolean {
  if (!options.sessionRef && !options.pairId) return true;
  let entry: unknown;
  try { entry = JSON.parse(raw); } catch { return false; }
  if (!isRecord(entry) || typeof entry.target !== 'string') return false;
  const from = typeof entry.from === 'string' ? entry.from : undefined;
  const replyRef = typeof entry.replyRef === 'string' ? entry.replyRef : undefined;
  if (options.pairId && communicationPairId({ target: entry.target, from, replyRef }) !== options.pairId) return false;
  const ref = options.sessionRef;
  if (!ref) return true;
  if (ref.referenceKind === 'process' || ref.contextId !== (options.contextId ?? 'local')) return false;
  if (replyRef) {
    try {
      const decoded = decodeRef(replyRef);
      return [decoded.f, decoded.t].some((endpoint) => endpoint.p !== 'human' && !endpoint.m && !endpoint.mid && endpoint.p === ref.providerId && endpoint.id === ref.nativeId);
    } catch { return false; }
  }
  const identity = `${ref.providerId}:${ref.nativeId}`;
  // Receiver-side logs may record a remote sender with the same opaque native ID.
  // Without a reply reference, only a direct local target proves this scope.
  return entry.target === identity;
}

/** Bounded metadata-only log windows; no service, receipt or queue processing. */
export async function queryManagedLog(options: ManagedLogOptions): Promise<ManagedLogResult> {
  const empty: ManagedLogResult = { items: [], source: null, sources: [], completeness: 'unavailable', observedAt: (options.now ?? Date.now)(), errors: [], bytesRead: 0, truncated: false, omittedLeadingLine: false, rotated: false };
  try {
    checkAbort(options.signal);
    const listing = await sources(options.baseDir, options.signal);
    const catalog = listing.items;
    const source = catalog.find((entry) => entry.id === (options.sourceId ?? 'send-log'));
    if (!source) return { ...empty, sources: catalog, errors: [{ source: 'logs', kind: 'unavailable', message: '此日志来源未登记', nextStep: '按 t 选择已登记的本机日志来源' }] };
    if ((options.sessionRef || options.pairId) && !source.id.startsWith('send-log')) return { ...empty, source, sources: catalog, errors: [{ source: source.path, kind: 'unavailable', message: '此来源没有可验证的会话或通信对元数据', nextStep: '切换到投递日志查看精确关联，或从 :logs 查看该来源全部内容' }] };
    const page = await queryLogWindow({ file: source.path, maxBytes: options.maxBytes, signal: options.signal, now: options.now, previous: options.previous?.cursor });
    checkAbort(options.signal);
    const epoch = (options.previous?.epoch ?? 0) + (page.rotated ? 1 : 0);
    const errors: QueryError[] = [...listing.errors, ...page.errors];
    if (page.omittedLeadingLine) errors.push({ source: source.path, kind: 'unavailable', message: '尾窗开头有一行未完整读取，已隐藏片段且不可复制', nextStep: '按 t 查看轮转来源；超出窗口的内容请在原生终端检查完整文件' });
    const rowLimit = page.entries.length > 1000;
    if (rowLimit) errors.push({ source: source.path, kind: 'unavailable', message: '只显示最近1000个完整起始行', nextStep: '筛选当前有界窗口；更早内容可在原生终端查看完整文件' });
    return { source, sources: catalog, items: page.entries.slice(-1000).filter((entry) => matches(entry.text, options)).map((entry) => ({ ...entry, text: safeLine(entry.text), id: JSON.stringify([source.id, page.cursor?.identity, epoch, entry.offset]) })),
      completeness: page.state === 'ready' ? page.truncated || errors.length ? 'partial' : 'complete' : page.state === 'cancelled' ? 'cancelled' : 'unavailable',
      observedAt: page.observedAt, errors, checkpoint: page.cursor ? { cursor: page.cursor, epoch } : undefined,
      bytesRead: page.bytesRead, truncated: page.truncated || rowLimit, omittedLeadingLine: page.omittedLeadingLine, rotated: page.rotated };
  } catch (error) {
    const issue = queryError('logs', error);
    return { ...empty, completeness: issue.kind === 'cancelled' ? 'cancelled' : 'unavailable', errors: [issue] };
  }
}
