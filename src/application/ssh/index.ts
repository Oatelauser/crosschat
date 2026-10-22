import { spawn as nodeSpawn } from 'node:child_process';
import type { SpawnOptionsWithoutStdio } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { listTuiContexts } from '../contexts/index.js';
import type { TuiConnection, TuiContextsResult } from '../contexts/index.js';
import { parseDiagnosticResult } from '../diagnostics/query.js';
import type { DiagnosticResult } from '../diagnostics/model.js';
import { parseDiscoveryRequest } from '../discovery/boundary.js';
import { createSshDiscoveryClient } from '../discovery/ssh.js';
import type { DiscoverySshChild } from '../discovery/ssh.js';
import type { SshDiscoveryFailure } from '../discovery/ssh.js';
import type { DiscoveryEndpoint, DiscoveryProvider, DiscoveryRequest, DiscoveryResponse } from '../discovery/model.js';
import { discoveryFailure } from '../discovery/service.js';
import type { QueryError } from '../queries/reading.js';
import { isRecord, untilAborted } from '../sessions/reading.js';
import type { Completeness } from '../sessions/model.js';

export interface SshReadRequest { contextId: string; signal?: AbortSignal }
interface SshObservation { contextId: string; host: string; completeness: Completeness; observedAt: number; errors: QueryError[] }
export interface SshInspection extends SshObservation { providers: readonly DiscoveryProvider[]; sampleCount: number }
export interface SshDoctorReport extends SshObservation { result: DiagnosticResult | null; exitCode: number | null }
export interface SshApplication {
  list(signal?: AbortSignal): Promise<TuiContextsResult>;
  discovery: DiscoveryEndpoint;
  inspect(request: SshReadRequest): Promise<SshInspection>;
  doctor(request: SshReadRequest): Promise<SshDoctorReport>;
}
export interface SshApplicationOptions {
  home?: string;
  /** Set only for an explicitly isolated context; default SSH configuration semantics stay unchanged. */
  configFile?: string;
  env?: NodeJS.ProcessEnv;
  readContexts?(signal?: AbortSignal): Promise<TuiContextsResult>;
  spawn?(command: string, args: string[], options: SpawnOptionsWithoutStdio): DiscoverySshChild;
  timeoutMs?: number;
  maxOutputBytes?: number;
  now?(): number;
}

const safeHost = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const STDERR_BYTES = 16 * 1024;

function failure(contextId: string, message: string, kind: QueryError['kind'] = 'unavailable', nextStep = '核对 SSH Host、免密认证、远端 crosschat 安装及非交互 PATH，然后按 r 重试。'): QueryError {
  return { source: contextId, kind, message, nextStep };
}
function executionFailure(contextId: string, stderr: string, code: number | null): QueryError {
  if (/permission denied|authentication failed|publickey/i.test(stderr)) return failure(contextId, 'SSH 认证未通过。', 'unavailable', '在原生终端核对该 Host 的用户、免密密钥与认证权限；TUI 不提示或保存密码。');
  if (/host key verification failed|remote host identification has changed/i.test(stderr)) return failure(contextId, 'SSH 主机身份核验未通过。', 'unavailable', '在原生终端人工核对主机指纹及 known_hosts；不要跳过主机身份校验。');
  if (code === 127 || /command not found|not recognized|无法将.*crosschat|crosschat.*找不到/i.test(stderr)) return failure(contextId, '远端 crosschat 命令不可用。', 'unavailable', '用同一 SSH Host 与用户核对 crosschat 安装及非交互 shell 的 PATH，再重新检测。');
  return failure(contextId, 'SSH 远端只读执行未完成。');
}

/** SSH configuration remains authoritative; every operation rebinds the current alias before starting IO. */
export function createSshApplication(options: SshApplicationOptions = {}): SshApplication {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > MAX_OUTPUT_BYTES) throw new Error('Invalid SSH read bounds.');
  if (options.configFile !== undefined && !isAbsolute(options.configFile)) throw new Error('SSH configuration needs an absolute path.');
  const launch = options.spawn ?? nodeSpawn;
  const spawn = (command: string, args: string[], settings: SpawnOptionsWithoutStdio): DiscoverySshChild => launch(command,
    options.configFile === undefined ? args : ['-F', options.configFile, ...args],
    { ...settings, ...(options.env === undefined ? {} : { env: options.env }) });
  async function list(signal?: AbortSignal): Promise<TuiContextsResult> {
    try {
      const result = await untilAborted(options.readContexts ? options.readContexts(signal) : listTuiContexts({ home: options.home, signal }), signal);
      if (signal?.aborted) throw new Error('Cancelled');
      return { ...result, items: result.items.filter((item) => item.kind === 'ssh') };
    } catch {
      return { items: [], observedAt: now(), errors: [failure('ssh:config', signal?.aborted ? 'SSH 配置读取已取消。' : 'SSH 配置无法读取。', signal?.aborted ? 'cancelled' : 'unavailable', '核对本机 SSH 配置的路径、格式与读取权限后刷新；不会改写配置。')] };
    }
  }
  async function target(request: SshReadRequest): Promise<{ connection?: TuiConnection; errors: QueryError[] }> {
    if (request.signal?.aborted) return { errors: [failure(request.contextId, 'SSH 读取已取消。', 'cancelled')] };
    const configured = await list(request.signal);
    if (request.signal?.aborted) return { errors: [failure(request.contextId, 'SSH 读取已取消。', 'cancelled')] };
    const connection = configured.items.find((item) => item.id === request.contextId);
    if (!connection) return { errors: [...configured.errors, failure(request.contextId, '所选 SSH Host 已不存在或未配置。', 'unavailable', '返回 :ctx 或 :ssh 刷新已配置 Host；不会回退读取本机。')] };
    if (!safeHost(connection.target) || connection.id !== `ssh:${encodeURIComponent(connection.target)}`) return { errors: [failure(request.contextId, '所选 SSH Host 不符合现有安全别名规则。', 'unavailable', '在原生 SSH 配置中使用字母、数字、点、下划线、连字符组成的明确 Host 别名，然后刷新。')] };
    return { connection, errors: [] };
  }
  function failedDiscovery(request: DiscoveryRequest, contextId: string, errors: QueryError[]): DiscoveryResponse {
    const first = errors[0] ?? failure(contextId, 'SSH 来源不可用。');
    const result = discoveryFailure(request, contextId, first.kind === 'cancelled' ? 'cancelled' : first.kind === 'malformed' ? 'malformed' : 'unavailable', first.message, now());
    const target = result.op === 'list' ? result.page : result.detail;
    target.errors = errors.map((error) => ({ source: { contextId, providerId: 'ssh' }, kind: error.kind, message: error.message, nextStep: error.nextStep }));
    return result;
  }
  const discovery: DiscoveryEndpoint = { async execute(input, execution = {}) {
    const request = parseDiscoveryRequest(input);
    const contextId = execution.contextId ?? 'unselected';
    const selected = await target({ contextId, signal: execution.signal });
    if (!selected.connection) return failedDiscovery(request, contextId, selected.errors);
    const revision = selected.connection.attributes.configurationRevision;
    let remoteRequest = request;
    if (request.op === 'list' && request.cursor !== undefined) {
      try {
        const cursor: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(request.cursor, 'base64url')));
        if (!isRecord(cursor) || typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision) || cursor.configurationRevision !== revision || typeof cursor.cursor !== 'string' || !cursor.cursor) throw new Error('Changed SSH config.');
        remoteRequest = parseDiscoveryRequest({ ...request, cursor: cursor.cursor });
      } catch {
        const failure = discoveryFailure(request, contextId, 'invalid-cursor', 'SSH 配置已经变化或分页上下文无效；已停止继续读取。', now());
        if (failure.op === 'list') failure.page.errors[0].nextStep = '按 r 从第一页刷新，重新使用当前 Host 配置；不会合并不同配置的分页结果。';
        return failure;
      }
    }
    let stderr = Buffer.alloc(0);
    const onStderr = (chunk: Buffer | string) => { if (stderr.length < STDERR_BYTES) stderr = Buffer.concat([stderr, Buffer.from(chunk).subarray(0, STDERR_BYTES - stderr.length)]); };
    let child: DiscoverySshChild | undefined;
    let transportFailure: SshDiscoveryFailure | undefined;
    try {
      const endpoint = createSshDiscoveryClient({ host: selected.connection.target, timeoutMs, now, onFailure: (reason) => { transportFailure = reason; }, spawn: (command, args, spawnOptions) => {
        child = spawn(command, args, spawnOptions); child.stderr.on('data', onStderr); return child;
      } });
      const response = await endpoint.execute(remoteRequest, execution);
      const result = response.op === 'list' ? response.page : response.detail;
      if (result.completeness === 'unavailable') {
        const problem = result.errors.find((error) => error.kind === 'malformed');
        const issue = transportFailure === 'timeout' ? failure(contextId, 'SSH 只读发现超时。')
          : problem ? failure(contextId, '远端发现接口返回无效结果。', 'malformed', '在同一 SSH 用户下升级并核对 crosschat discover 接口；不会回退执行 status。')
          : executionFailure(contextId, stderr.toString('utf8'), null);
        result.errors = result.errors.map((error) => error.kind === 'invalid-cursor' ? error : { source: { contextId, providerId: 'ssh' }, kind: issue.kind, message: issue.message, nextStep: issue.nextStep });
      }
      if (response.op === 'list' && response.page.nextCursor !== null) {
        if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) return failedDiscovery(request, contextId, [failure(contextId, 'SSH 配置读取没有提供可绑定的分页版本。', 'unavailable', '核对当前 SSH 配置来源后从第一页刷新；不会在未知配置版本间拼接分页。')]);
        const cursor = Buffer.from(JSON.stringify({ configurationRevision: revision, cursor: response.page.nextCursor })).toString('base64url');
        try { parseDiscoveryRequest({ op: 'list', cursor }); }
        catch { return failedDiscovery(request, contextId, [failure(contextId, 'SSH 分页游标超过读取限额。', 'malformed', '核对远端 discover 分页来源后从第一页刷新。')]); }
        response.page.nextCursor = cursor;
      }
      return response;
    } finally { child?.stderr.off('data', onStderr); }
  } };

  async function inspect(request: SshReadRequest): Promise<SshInspection> {
    const response = await discovery.execute({ op: 'list', limit: 1 }, request);
    if (response.op !== 'list') throw new Error('Unexpected SSH inspection response.');
    let host = '';
    try { if (request.contextId.startsWith('ssh:')) host = decodeURIComponent(request.contextId.slice(4)); } catch { /* Invalid context identity remains unavailable. */ }
    return { contextId: request.contextId, host, providers: response.providers, sampleCount: response.page.items.length,
      completeness: response.page.completeness, observedAt: response.page.observedAt,
      errors: response.page.errors.map((error) => failure(request.contextId, error.message, ['missing', 'unreadable', 'malformed', 'unavailable', 'cancelled'].includes(error.kind) ? error.kind as QueryError['kind'] : 'unavailable', error.nextStep)) };
  }

  async function doctor(request: SshReadRequest): Promise<SshDoctorReport> {
    const selected = await target(request);
    const base = { contextId: request.contextId, host: selected.connection?.target ?? '', result: null, exitCode: null };
    if (!selected.connection) return { ...base, completeness: request.signal?.aborted ? 'cancelled' : 'unavailable', observedAt: now(), errors: selected.errors };
    return new Promise((resolve) => {
      let child: DiscoverySshChild;
      try { child = spawn('ssh', ['-T', '-o', 'BatchMode=yes', '--', selected.connection!.target, 'crosschat', 'doctor', '--json'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); }
      catch { resolve({ ...base, completeness: 'unavailable', observedAt: now(), errors: [failure(request.contextId, 'SSH 进程无法启动。')] }); return; }
      let finished = false;
      let bytes = 0;
      let stderr = Buffer.alloc(0);
      const chunks: Buffer[] = [];
      const cleanup = () => { clearTimeout(timer); request.signal?.removeEventListener('abort', onAbort); child.stdout.off('data', onData); child.stderr.off('data', onStderr); };
      const release = () => { child.off('close', onClose); child.off('error', onError); child.stdin.off('error', onError); child.stdout.off('error', onError); child.stderr.off('error', onError); };
      const finish = (result: Omit<SshDoctorReport, 'contextId' | 'host' | 'observedAt'>, kill = false) => {
        if (finished) return;
        finished = true; cleanup();
        if (kill) { child.kill('SIGKILL'); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); }
        resolve({ ...base, ...result, observedAt: now() });
      };
      const failed = (issue: QueryError, kill = false, code: number | null = null) => finish({ result: null, exitCode: code, errors: [issue], completeness: issue.kind === 'cancelled' ? 'cancelled' : 'unavailable' }, kill);
      const onAbort = () => failed(failure(request.contextId, 'SSH 体检已取消。', 'cancelled'), true);
      const onError = () => failed(failure(request.contextId, 'SSH 体检进程执行失败。'), true);
      const onData = (chunk: Buffer | string) => {
        const buffer = Buffer.from(chunk); bytes += buffer.length;
        if (bytes > maxOutputBytes) { failed(failure(request.contextId, '远端体检输出超过读取限额。', 'malformed', '核对远端 crosschat doctor --json；不会展示或解析截断结果。'), true); return; }
        chunks.push(buffer);
      };
      const onStderr = (chunk: Buffer | string) => { if (stderr.length < STDERR_BYTES) stderr = Buffer.concat([stderr, Buffer.from(chunk).subarray(0, STDERR_BYTES - stderr.length)]); };
      const onClose = (code: number | null) => {
        release(); if (finished) return;
        if (code !== 0 && code !== 1) { failed(executionFailure(request.contextId, stderr.toString('utf8'), code), false, code); return; }
        try {
          const result = parseDiagnosticResult(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
          if ((code === 1) !== result.summary.failed) throw new Error('Mismatched doctor exit.');
          finish({ result, exitCode: code, completeness: 'complete', errors: [] });
        } catch { failed(failure(request.contextId, '远端体检接口返回无效结果。', 'malformed', '在同一 SSH 用户下升级并核对 crosschat doctor --json；不会解析旧文本或回退本机。'), false, code); }
      };
      const timer = setTimeout(() => failed(failure(request.contextId, 'SSH 体检超时。'), true), timeoutMs);
      child.stdout.on('data', onData); child.stderr.on('data', onStderr); child.on('error', onError); child.stdin.on('error', onError); child.stdout.on('error', onError); child.stderr.on('error', onError); child.once('close', onClose);
      request.signal?.addEventListener('abort', onAbort, { once: true });
      if (request.signal?.aborted) onAbort(); else { try { child.stdin.end(); } catch { onError(); } }
    });
  }
  return { list, discovery, inspect, doctor };
}
