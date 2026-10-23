import { MultichatError } from '../errors.js';
import { dshError, isDshRecord, readDshRegistrations } from './registry.js';
import type { DshRegistration } from './registry.js';
import type { DshOptions } from './client.js';

export interface DshConnection { registration: DshRegistration; request(path: string, body?: unknown): Promise<unknown> }
export interface DshOperation { connections(): Promise<DshConnection[]>; check(): void }

/** Experimental window mirrors engines.dsh with includePrerelease enabled. */
export function supportsDshVersion(version: string): boolean {
  const match = /^(0)\.(2)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  if (match === null || !Number.isSafeInteger(Number(match[3]))) return false;
  const identifiers = match[4]?.split('.');
  if (identifiers?.some((id) => /^\d+$/.test(id) && !/^(0|[1-9]\d*)$/.test(id))) return false;
  const patch = Number(match[3]);
  if (patch < 1) return false;
  if (patch > 1 || identifiers === undefined) return true;
  const first = identifiers[0];
  if (/^\d+$/.test(first) || first < 'rc') return false;
  if (first > 'rc') return true;
  if (identifiers.length < 2) return false;
  const second = identifiers[1];
  return !/^\d+$/.test(second) || Number(second) >= 2;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (response.body === null) throw dshError('PROTOCOL_ERROR', 'Harness bridge returned an empty response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1024 * 1024) throw dshError('PROTOCOL_ERROR', 'Harness bridge response exceeded the adapter read budget.');
      chunks.push(part.value);
    }
    try { const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8')); return value; }
    catch { throw dshError('PROTOCOL_ERROR', 'Harness bridge returned malformed JSON.'); }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

/** One shared deadline covers discovery, all handshakes, target lookup and admission. */
export async function withDshOperation<T>(options: DshOptions, use: (operation: DshOperation) => Promise<T>): Promise<T> {
  if (options.signal?.aborted) throw dshError('CANCELLED', 'Harness operation cancelled before I/O.');
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw dshError('INPUT_REJECTED', 'Harness operation timeout must be positive.');
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const check = () => {
    if (options.signal?.aborted) throw dshError('CANCELLED', 'Harness operation cancelled before writing.');
    if (timedOut) throw dshError('TIMEOUT', 'Harness operation exceeded its shared timeout budget.');
  };
  let connections: Promise<DshConnection[]> | undefined;
  const connect = async (): Promise<DshConnection[]> => {
    const registrations = await readDshRegistrations(options, controller.signal);
    const results: DshConnection[] = [];
    for (const registration of registrations) {
      check();
      const connection: DshConnection = { registration,
        async request(path, body) {
          check();
          const write = body !== undefined;
          try {
            const response = await fetch(new URL(path, registration.url), { method: write ? 'POST' : 'GET',
              headers: { accept: 'application/json', authorization: `Bearer ${registration.token}`, ...(write ? { 'content-type': 'application/json' } : {}) },
              ...(write ? { body: JSON.stringify(body) } : {}), signal: controller.signal, redirect: 'manual' });
            if (!response.ok) {
              if (response.status === 404 && write) {
                const detail = await boundedJson(response);
                const target = /^\/v1\/sessions\/([^/]+)\/messages$/.exec(path);
                if (target !== null && isDshRecord(detail) && isDshRecord(detail.error)
                  && detail.error.code === 'DSH_SESSION_NOT_FOUND' && detail.error.sessionId === decodeURIComponent(target[1])) {
                  throw dshError('SESSION_NOT_FOUND', 'The exact live Harness root session no longer exists.');
                }
              } else { await response.body?.cancel().catch(() => undefined); }
              if (response.status === 401 || response.status === 403) throw dshError('AUTH_REQUIRED', 'Harness bridge refused instance authentication. Refresh the source after Harness restarts.');
              if (write) {
                if (response.status === 400 || response.status === 413 || response.status === 415) throw dshError('INPUT_REJECTED', 'Harness bridge rejected the message before admission.');
                throw dshError('WRITE_UNCERTAIN', 'Harness message admission could not be confirmed; the write was not retried.');
              }
              throw dshError(response.status >= 500 ? 'UNAVAILABLE' : 'PROTOCOL_ERROR', 'Harness bridge did not return a successful response.');
            }
            return await boundedJson(response);
          } catch (error) {
            if (error instanceof MultichatError) {
              if (write && error.code === 'DSH_PROTOCOL_ERROR') throw dshError('WRITE_UNCERTAIN', 'Harness returned an unconfirmed admission receipt; the write was not retried.');
              throw error;
            }
            if (write) throw dshError('WRITE_UNCERTAIN', 'Harness message admission could not be confirmed; the write was not retried.');
            check();
            throw dshError('UNAVAILABLE', 'The registered live Harness bridge could not be reached.');
          }
        },
      };
      const info = await connection.request('/v1/info');
      if (!isDshRecord(info) || info.schema !== 1 || info.provider !== 'dsh' || typeof info.pid !== 'number'
        || !Number.isSafeInteger(info.pid) || info.pid <= 0 || typeof info.instanceId !== 'string' || typeof info.runtimeVersion !== 'string') {
        throw dshError('PROTOCOL_ERROR', 'Harness bridge identity response is malformed.');
      }
      if (info.protocol !== 1) throw dshError('UNSUPPORTED_PROTOCOL', 'Harness bridge protocol is not supported.');
      if (info.pid !== registration.pid || info.instanceId !== registration.instanceId || info.runtimeVersion !== registration.runtimeVersion) {
        throw dshError('OWNER_MISMATCH', 'Harness instance registration no longer matches the responding owner. Refresh after Harness restarts.');
      }
      if (!supportsDshVersion(info.runtimeVersion)) throw dshError('UNSUPPORTED_VERSION', 'Harness runtime is outside the experimental >=0.2.1-rc.2 <0.3.0-0 support window.');
      results.push(connection);
    }
    return results;
  };
  try {
    return await use({ check, connections: () => connections ??= connect() });
  } catch (error) {
    if (error instanceof MultichatError) throw error;
    check();
    throw dshError('UNAVAILABLE', 'Harness bridge operation could not be completed.');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    controller.abort();
  }
}
