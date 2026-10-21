import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { isProcessAlive } from '../../platform/process-inspector.js';
import { DEFAULT_PORT } from '../../serve/broker.js';
import { loadBrokerFile, registryFileOf, tcpDir } from '../../serve/registry.js';
import { listNodeStatusFiles } from '../status/status-files.js';
import { connectValueOf, killPid, listServeProcesses, pidsOnPort } from './processes.js';
import type { ProcInfo } from './processes.js';

interface DetachedChild {
  pid?: number;
  unref(): void;
  on?(event: 'error', listener: (error: Error) => void): unknown;
}

export interface ServiceLaunchDeps {
  baseDir: string;
  env: NodeJS.ProcessEnv;
  entryPath: string;
  spawn?(command: string, args: string[], options: SpawnOptions): DetachedChild;
  now?(): number;
}

export interface ServiceStarting {
  state: 'starting';
  target: 'broker' | 'node';
  pid: number;
  logFile: string;
  statusFile: string;
  requestedAt: number;
  port?: number;
}

export type ServiceReady = Omit<ServiceStarting, 'state'> & { state: 'ready' };
export interface ServiceFailed {
  state: 'failed';
  reason: 'launch-failed' | 'process-exited' | 'readiness-timeout' | 'cancelled';
  error: string;
  cause?: unknown;
  pid?: number;
}

/** Spawn starts the request; the status reader below supplies readiness evidence. */
export function startDetachedService(
  request: { extraArgs: string[]; logName: string; port?: number },
  deps: ServiceLaunchDeps,
): ServiceStarting | ServiceFailed {
  try {
    const dir = tcpDir(deps.baseDir);
    mkdirSync(dir, { recursive: true });
    const logFile = join(dir, request.logName);
    const fd = openSync(logFile, 'a');
    const requestedAt = (deps.now ?? Date.now)();
    let child: DetachedChild;
    try {
      child = (deps.spawn ?? spawn)(process.execPath, [realpathSync(deps.entryPath), 'serve', ...request.extraArgs], {
        detached: true, stdio: ['ignore', fd, fd], env: { ...deps.env, CROSSCHAT_SERVE_DETACHED: '1' },
      });
      child.on?.('error', () => {});
      child.unref();
    } finally {
      closeSync(fd);
    }
    if (child.pid === undefined) return { state: 'failed', reason: 'launch-failed', error: '后台服务未取得进程 ID' };
    const target = request.logName.startsWith('node') ? 'node' : 'broker';
    return {
      state: 'starting', target, pid: child.pid, logFile, requestedAt,
      statusFile: join(dir, `status-${request.logName.replace(/\.log$/, '.json')}`),
      ...(request.port === undefined ? {} : { port: request.port }),
    };
  } catch (cause) {
    return { state: 'failed', reason: 'launch-failed', error: cause instanceof Error ? cause.message : String(cause), cause };
  }
}

export interface ServiceReadinessDeps {
  readStatus?(file: string): unknown;
  isProcessAlive?(pid: number): boolean;
  now?(): number;
  wait?(ms: number, signal?: AbortSignal): Promise<void>;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
    if (signal?.aborted) finish();
  });
}

export async function waitForServiceReady(
  started: ServiceStarting,
  deps: ServiceReadinessDeps = {},
  options: { timeoutMs?: number; pollMs?: number; signal?: AbortSignal } = {},
): Promise<ServiceReady | ServiceFailed> {
  const now = deps.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? 10_000);
  for (;;) {
    if (options.signal?.aborted) return { state: 'failed', reason: 'cancelled', pid: started.pid, error: '已停止等待服务就绪；已发出的启动请求未撤销' };
    if (!(deps.isProcessAlive ?? isProcessAlive)(started.pid)) return { state: 'failed', reason: 'process-exited', pid: started.pid, error: '服务进程已退出，未确认就绪' };
    try {
      const value: unknown = deps.readStatus === undefined
        ? JSON.parse(readFileSync(started.statusFile, 'utf8')) : deps.readStatus(started.statusFile);
      if (value !== null && typeof value === 'object') {
        const status = value as Record<string, unknown>;
        if (status.pid === started.pid && status.state === (started.target === 'broker' ? 'running' : 'online') &&
          typeof status.lastUpdated === 'string' && Date.parse(status.lastUpdated) >= started.requestedAt) {
          return { ...started, state: 'ready' };
        }
      }
    } catch {
      // A missing or partial status file is not readiness evidence.
    }
    const left = deadline - now();
    if (left <= 0) return { state: 'failed', reason: 'readiness-timeout', pid: started.pid, error: '等待服务就绪超时；进程可能仍在启动，请核对状态与日志' };
    await (deps.wait ?? wait)(Math.min(options.pollMs ?? 100, left), options.signal);
  }
}

export type ServiceStopEvent =
  | { kind: 'none'; target: 'broker' | 'node' }
  | { kind: 'selector-missing'; selector: string }
  | { kind: 'ghost-reset'; target: 'broker' | 'node'; files: string[] }
  | { kind: 'terminated'; target: 'broker' | 'node'; pid: number; selector?: string; port?: number }
  | { kind: 'terminate-failed'; target: 'broker' | 'node'; pid: number }
  | { kind: 'unconfirmed'; pid: number; port: number };

export interface ServiceStopDeps {
  baseDir: string;
  listServeProcesses?(): ProcInfo[];
  killPid?(pid: number): boolean;
  pidsOnPort?(port: number): Set<number>;
}

function resetGhostStatusFiles(dir: string, files: string[], ghostState: string): string[] {
  const reset: string[] = [];
  for (const file of files) {
    try {
      const path = join(dir, file);
      const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (value === null || typeof value !== 'object' || !('state' in value) || value.state !== ghostState) continue;
      writeFileSync(path, `${JSON.stringify({ ...value, state: 'stopped' }, null, 2)}\n`, 'utf8');
      reset.push(file);
    } catch {
      // Ghost cleanup remains best effort.
    }
  }
  return reset;
}

export function stopServices(
  request: { target: 'broker' | 'node' | 'both' } | { selector: string },
  deps: ServiceStopDeps,
): { state: 'ready' | 'failed'; events: ServiceStopEvent[] } {
  const procs = (deps.listServeProcesses ?? listServeProcesses)();
  const kill = deps.killPid ?? killPid;
  const events: ServiceStopEvent[] = [];
  const terminate = (target: 'broker' | 'node', pid: number, metadata: { selector?: string; port?: number } = {}): void => {
    events.push(kill(pid) ? { kind: 'terminated', target, pid, ...metadata } : { kind: 'terminate-failed', target, pid });
  };
  if ('selector' in request) {
    const targets = procs.filter((p) => p.cmdline.includes('--connect') && connectValueOf(p.cmdline) === request.selector);
    if (targets.length === 0) events.push({ kind: 'selector-missing', selector: request.selector });
    for (const node of targets) terminate('node', node.pid, { selector: request.selector });
  } else {
    const brokers = procs.filter((p) => !p.cmdline.includes('--connect'));
    const nodes = procs.filter((p) => p.cmdline.includes('--connect'));
    const dir = tcpDir(deps.baseDir);
    const ghosts = (target: 'node' | 'broker', files: string[], state: string): void => {
      events.push({ kind: 'none', target });
      const reset = resetGhostStatusFiles(dir, files, state);
      if (reset.length > 0) events.push({ kind: 'ghost-reset', target, files: reset });
    };
    if (request.target === 'node' || request.target === 'both') {
      if (nodes.length === 0) ghosts('node', listNodeStatusFiles(dir), 'online');
      for (const node of nodes) terminate('node', node.pid);
    }
    if (request.target === 'broker' || request.target === 'both') {
      if (brokers.length === 0) ghosts('broker', ['status-broker.json'], 'running');
      const port = loadBrokerFile(registryFileOf(deps.baseDir)).port ?? DEFAULT_PORT;
      const confirmed = (deps.pidsOnPort ?? pidsOnPort)(port);
      for (const broker of brokers) {
        if (!confirmed.has(broker.pid)) events.push({ kind: 'unconfirmed', pid: broker.pid, port });
        else terminate('broker', broker.pid, { port });
      }
    }
  }
  const failed = events.some((event) => event.kind === 'terminate-failed' || event.kind === 'unconfirmed' || event.kind === 'selector-missing');
  return { state: failed ? 'failed' : 'ready', events };
}
