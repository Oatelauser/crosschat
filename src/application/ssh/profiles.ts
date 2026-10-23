import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { TuiConnection } from '../contexts/index.js';
import { checkAbort, isRecord } from '../queries/reading.js';

export interface SshManagedProfile { id: string; name: string; host: string; user?: string; port: number; keyFile?: string }
export interface SshProfileRequest { operation: 'create' | 'update' | 'delete'; contextId?: string; profile?: unknown; signal?: AbortSignal }
export interface SshProfilePreview { enabled: boolean; revision: string; impact: string[]; reason?: string }
export interface SshProfileResult { status: 'applied' | 'blocked' | 'changed' | 'cancelled' | 'failed'; message: string; contextId?: string }
export interface SshProfileConfiguration {
  preview(request: SshProfileRequest): Promise<SshProfilePreview>;
  apply(request: SshProfileRequest & { expectedRevision: string }): Promise<SshProfileResult>;
}
interface ProfileDocument { version: 1; profiles: SshManagedProfile[] }
interface ProfileSnapshot { document: ProfileDocument; revision: string }
const MAX_BYTES = 256 * 1024;
const forbiddenText = (text: string) => [...text].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const missing = (error: unknown) => isRecord(error) && error.code === 'ENOENT';
function invalid(): never { throw new Error('Invalid managed SSH configuration.'); }
export const sshProfileContextId = (id: string): string => `ssh:profile:${id}`;
/** Managed identities cannot collide with external aliases, even when their SSH argv target is identical. */
export function sshContextMatchesTarget(id: string, target: string): boolean {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(target)) return false;
  const managed = /^ssh:profile:([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.exec(id);
  return managed ? target === `cc-${managed[1]}` : id === `ssh:${encodeURIComponent(target)}`;
}
export const sshProfilesFile = (home: string = homedir()): string => join(home, '.crosschat', 'ssh-connections.json');

function string(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max && !forbiddenText(value); }
function profile(input: unknown, id: string, home: string): SshManagedProfile {
  if (!isRecord(input) || Object.keys(input).some((key) => !['id', 'name', 'host', 'user', 'port', 'keyFile'].includes(key))) invalid();
  if (!string(input.name, 120) || !string(input.host, 253) || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(input.host)
    || typeof input.port !== 'number' || !Number.isSafeInteger(input.port) || input.port < 1 || input.port > 65535
    || (input.user !== undefined && (!string(input.user, 256) || !/^[A-Za-z0-9_][A-Za-z0-9_.@\\-]*$/.test(input.user)))
    || (input.keyFile !== undefined && (!string(input.keyFile, 4096) || (!isAbsolute(input.keyFile) && !/^~[\\/]/.test(input.keyFile))))) invalid();
  const keyFile = typeof input.keyFile === 'string' ? /^~[\\/]/.test(input.keyFile) ? join(home, input.keyFile.slice(2)) : input.keyFile : undefined;
  return { id, name: input.name, host: input.host, port: input.port,
    ...(typeof input.user === 'string' ? { user: input.user } : {}), ...(keyFile ? { keyFile } : {}) };
}

export function parseSshProfiles(raw: string, home: string): ProfileDocument {
  if (Buffer.byteLength(raw) > MAX_BYTES) invalid();
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.profiles) || parsed.profiles.length > 500
    || Object.keys(parsed).some((key) => !['version', 'profiles'].includes(key))) invalid();
  const ids = new Set<string>();
  return { version: 1, profiles: parsed.profiles.map((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(entry.id) || ids.has(entry.id)) invalid();
    ids.add(entry.id);
    return profile(entry, entry.id, home);
  }) };
}

/** Safe metadata only: password and key contents have no representation in this document. */
export function sshManagedContexts(raw: string, home: string): TuiConnection[] {
  const configurationRevision = createHash('sha256').update(raw).digest('hex');
  return parseSshProfiles(raw, home).profiles.map((entry) => ({
    id: sshProfileContextId(entry.id), kind: 'ssh', name: entry.name, target: `cc-${entry.id}`,
    identityHint: `TUI 管理 · ${entry.user ? `${entry.user}@` : ''}${entry.host}:${entry.port}；身份尚未核实`,
    attributes: { source: sshProfilesFile(home), managed: true, profileId: entry.id, host: entry.host, port: entry.port,
      ...(entry.user ? { user: entry.user } : {}), ...(entry.keyFile ? { keyFile: entry.keyFile } : {}), configurationRevision },
  }));
}

/** Refuse linked storage before opening its contents; the configured home itself may be a canonical OS alias. */
async function parent(home: string, create = false): Promise<boolean> {
  const directory = dirname(sshProfilesFile(home));
  try {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) invalid();
    return true;
  } catch (error) {
    if (!missing(error)) throw error;
    if (!create) return false;
    await mkdir(directory, { mode: 0o700 });
    return parent(home);
  }
}

async function snapshot(home: string): Promise<ProfileSnapshot> {
  if (!await parent(home)) return { document: { version: 1, profiles: [] }, revision: 'missing' };
  const file = sshProfilesFile(home);
  let before;
  try { before = await lstat(file, { bigint: true }); }
  catch (error) { if (missing(error)) return { document: { version: 1, profiles: [] }, revision: 'missing' }; throw error; }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(MAX_BYTES)) invalid();
  const handle = await open(file, 'r');
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1n || opened.size > BigInt(MAX_BYTES)) invalid();
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const result = await handle.read(buffer, bytes, buffer.length - bytes, null);
      if (!result.bytesRead) break;
      bytes += result.bytesRead;
    }
    if (bytes > MAX_BYTES) invalid();
    await parent(home);
    const after = await lstat(file, { bigint: true });
    const final = await handle.stat({ bigint: true });
    const identity = (stat: typeof before) => [stat.dev, stat.ino, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');
    if (!after.isFile() || after.isSymbolicLink() || identity(opened) !== identity(after) || identity(opened) !== identity(final)) invalid();
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes));
    return { document: parseSshProfiles(raw, home), revision: createHash('sha256').update(identity(after)).update(raw).digest('hex') };
  } finally { await handle.close(); }
}

function planned(request: SshProfileRequest, current: ProfileSnapshot, home: string): { document: ProfileDocument; contextId: string; impact: string[] } {
  const entries = [...current.document.profiles];
  let target: SshManagedProfile;
  let contextId = request.contextId ?? '';
  const index = entries.findIndex((entry) => sshProfileContextId(entry.id) === contextId);
  if (request.operation !== 'create' && index < 0) throw new Error('外部 SSH Host 为只读，或所选受管连接已不存在。');
  if (request.operation === 'create') {
    if (entries.length >= 500) invalid();
    const next = profile(request.profile, randomUUID(), home);
    target = next;
    entries.push(next); contextId = sshProfileContextId(next.id);
  } else if (request.operation === 'update') { target = profile(request.profile, entries[index].id, home); entries[index] = target; }
  else if (request.operation === 'delete') { target = entries[index]; entries.splice(index, 1); }
  else invalid();
  return { document: { version: 1, profiles: entries }, contextId,
    impact: [`连接：${target.name} · ${target.user ? `${target.user}@` : ''}${target.host}:${target.port}`,
      request.operation === 'delete' ? '仅移除本机 TUI 保存的 SSH 连接；不删除远端数据或外部 SSH Host。' : '仅保存本机 TUI 管理的连接参数；密码、私钥口令不会写入配置。',
      '不执行远端命令、不安装软件；配置变化后重新认证。'] };
}

/** All TUI writers share an exclusive lock and compare the confirmed revision before atomic installation. */
export function createSshProfileConfiguration(options: { home?: string; renameFile?: (from: string, to: string) => Promise<void> } = {}): SshProfileConfiguration {
  const home = resolve(options.home ?? homedir());
  const file = sshProfilesFile(home);
  async function preview(request: SshProfileRequest): Promise<SshProfilePreview> {
    try {
      checkAbort(request.signal);
      const current = await snapshot(home);
      const next = planned(request, current, home);
      checkAbort(request.signal);
      return { enabled: true, revision: current.revision, impact: next.impact };
    } catch (error) {
      return { enabled: false, revision: '', impact: [], reason: request.signal?.aborted ? 'SSH 配置操作已取消。'
        : request.operation !== 'create' && error instanceof Error && error.message.startsWith('外部 SSH') ? error.message
          : '连接参数或受管配置不可安全读取；核对主机、端口、用户名、密钥路径及文件权限。不会修复或覆盖原文件。' };
    }
  }
  async function apply(request: SshProfileRequest & { expectedRevision: string }): Promise<SshProfileResult> {
    if (request.signal?.aborted) return { status: 'cancelled', message: 'SSH 配置操作已取消。' };
    let initial: ProfileSnapshot;
    try { initial = await snapshot(home); planned(request, initial, home); }
    catch { return { status: 'blocked', message: '连接参数、目标或受管配置不符合安全写入条件；未覆盖原配置。' }; }
    if (initial.revision !== request.expectedRevision) return { status: 'changed', message: 'SSH 配置已变化，请刷新并重新确认。' };
    let lock: Awaited<ReturnType<typeof open>> | undefined;
    let temporary: string | undefined;
    const lockFile = `${file}.lock`;
    try {
      await parent(home, true);
      checkAbort(request.signal);
      lock = await open(lockFile, 'wx', 0o600);
      const current = await snapshot(home);
      if (current.revision !== request.expectedRevision) return { status: 'changed', message: 'SSH 配置在保存前已变化，请刷新并重新确认。' };
      const next = planned(request, current, home);
      const text = `${JSON.stringify(next.document, null, 2)}\n`;
      if (Buffer.byteLength(text) > MAX_BYTES) invalid();
      temporary = join(dirname(file), `.ssh-connections.${randomUUID()}.tmp`);
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      checkAbort(request.signal);
      const latest = await snapshot(home);
      if (latest.revision !== current.revision) return { status: 'changed', message: 'SSH 配置在保存前已变化，请刷新并重新确认。' };
      await parent(home);
      await (options.renameFile ?? rename)(temporary, file);
      temporary = undefined;
      return { status: 'applied', contextId: next.contextId, message: request.operation === 'delete' ? '受管 SSH 连接已移除，远端数据保持。' : '受管 SSH 连接已保存；下一次进入时重新认证。' };
    } catch { return { status: request.signal?.aborted ? 'cancelled' : 'failed', message: request.signal?.aborted ? 'SSH 配置操作已取消。' : 'SSH 配置保存未完成；检查权限或其他正在编辑的 TUI 后重新确认。' }; }
    finally {
      try { if (temporary) await rm(temporary, { force: true }); }
      finally { if (lock) { await lock.close(); await rm(lockFile, { force: true }); } }
    }
  }
  return { preview, apply };
}
