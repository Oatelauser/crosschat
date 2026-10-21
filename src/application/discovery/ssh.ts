import { spawn as nodeSpawn } from 'node:child_process';
import type { SpawnOptionsWithoutStdio } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { DISCOVERY_MAX_BYTES, parseDiscoveryRequest } from './boundary.js';
import type { DiscoveryEndpoint, DiscoveryOptions, DiscoveryRequest, DiscoveryResponse } from './model.js';
import { completeRemoteDiscoveryResponse, prepareRemoteDiscoveryRequest } from './remote.js';
import { discoveryFailure } from './service.js';

export interface DiscoverySshChild extends EventEmitter {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface SshDiscoveryOptions {
  host: string;
  timeoutMs?: number;
  spawn?: (command: string, args: string[], options: SpawnOptionsWithoutStdio) => DiscoverySshChild;
  now?: () => number;
}

export function createSshDiscoveryClient(options: SshDiscoveryOptions): DiscoveryEndpoint {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.host)) throw new Error('SSH discovery requires a safe configured host alias.');
  const timeoutMs = options.timeoutMs ?? 15000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('Invalid SSH discovery timeout.');
  const now = options.now ?? Date.now;
  return {
    execute(input, execution = {}) {
      const request = parseDiscoveryRequest(input);
      return executeSsh(request, execution);
    },
  };

  function executeSsh(request: DiscoveryRequest, execution: DiscoveryOptions): Promise<DiscoveryResponse> {
    const contextId = execution.contextId ?? `ssh:${options.host}`;
    const scope = { contextId, target: `ssh:${options.host}` };
    const fail = (kind: Parameters<typeof discoveryFailure>[2], message: string) => discoveryFailure(request, contextId, kind, message, now());
    if (execution.signal?.aborted) return Promise.resolve(fail('cancelled', 'SSH discovery cancelled.'));
    let remoteRequest: DiscoveryRequest;
    try { remoteRequest = prepareRemoteDiscoveryRequest(request, scope); }
    catch { return Promise.resolve(fail('invalid-cursor', 'Discovery cursor does not match this SSH target and query. Refresh from the first page.')); }
    return new Promise((resolve) => {
      let child: DiscoverySshChild;
      try {
        child = (options.spawn ?? nodeSpawn)('ssh', ['-T', '-o', 'BatchMode=yes', '--', options.host, 'crosschat', 'discover'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      } catch { resolve(fail('unavailable', 'SSH discovery could not start. Check the configured host.')); return; }
      let finished = false;
      let bytes = 0;
      const chunks: Buffer[] = [];
      const cleanup = () => {
        clearTimeout(timer);
        execution.signal?.removeEventListener('abort', onAbort);
        child.stdout.off('data', onData);
        child.stderr.off('data', onStderr);
      };
      const release = () => {
        child.off('close', onClose);
        child.off('error', onError);
        child.stdin.off('error', onError);
        child.stdout.off('error', onError);
        child.stderr.off('error', onError);
      };
      const finish = (result: DiscoveryResponse, kill = false) => {
        if (finished) return;
        finished = true;
        cleanup();
        if (kill) {
          child.kill('SIGKILL');
          child.stdin.destroy();
          child.stdout.destroy();
          child.stderr.destroy();
        }
        resolve(result);
      };
      const onAbort = () => finish(fail('cancelled', 'SSH discovery cancelled.'), true);
      const onError = () => finish(fail('unavailable', 'SSH discovery failed. Check the configured host and installed crosschat command.'), true);
      const onData = (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > DISCOVERY_MAX_BYTES) { finish(fail('malformed', 'SSH discovery response exceeded its size limit.'), true); return; }
        chunks.push(buffer);
      };
      const onStderr = () => undefined;
      const onClose = (code: number | null) => {
        release();
        if (finished) return;
        if (code !== 0) { finish(fail('unavailable', 'SSH discovery failed. Check the configured host and installed crosschat command.')); return; }
        try { finish(completeRemoteDiscoveryResponse(JSON.parse(Buffer.concat(chunks).toString('utf8')), request, scope)); }
        catch { finish(fail('malformed', 'SSH command returned invalid discovery JSON.')); }
      };
      const timer = setTimeout(() => finish(fail('unavailable', 'SSH discovery timed out.'), true), timeoutMs);
      child.stdout.on('data', onData);
      child.stderr.on('data', onStderr);
      child.on('error', onError);
      child.stdin.on('error', onError);
      child.stdout.on('error', onError);
      child.stderr.on('error', onError);
      child.once('close', onClose);
      execution.signal?.addEventListener('abort', onAbort, { once: true });
      if (execution.signal?.aborted) onAbort();
      else {
        try { child.stdin.end(JSON.stringify(remoteRequest)); }
        catch { onError(); }
      }
    });
  }
}
