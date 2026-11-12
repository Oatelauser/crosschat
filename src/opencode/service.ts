import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { MultichatError } from '../errors.js';

/** Explicit endpoints use the native service password, never a model API key. */
export interface OpenCodeEndpoint {
  url: string;
  token?: string;
  username?: string;
}

export interface OpenCodeOptions {
  endpoint?: OpenCodeEndpoint;
  registrationFile?: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface OpenCodeRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  response?: 'json' | 'empty';
}

interface Registration {
  id?: string;
  url: string;
  pid: number;
  password?: string;
  version?: string;
}

export interface OpenCodeConnection {
  serviceIdentity?: { registrationId?: string; pid: number; version: string; url: string };
  request(path: string, body?: unknown, options?: OpenCodeRequestOptions): Promise<unknown>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function openCodeError(code: string, message: string): MultichatError {
  return new MultichatError(`OPENCODE_${code}`, message);
}

function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw openCodeError('CANCELLED', 'OpenCode operation cancelled before writing.');
}

/** Mirrors @opencode/client/service's XDG path on every supported platform. */
export function openCodeRegistrationPath(options: OpenCodeOptions = {}): string {
  const env = options.env ?? process.env;
  return options.registrationFile ?? env.CROSSCHAT_OPENCODE_SERVICE_FILE
    ?? join(env.XDG_STATE_HOME ?? join(options.home ?? env.HOME ?? env.USERPROFILE ?? homedir(), '.local', 'state'), 'opencode', 'service.json');
}

function endpointUrl(input: string, registered: boolean): URL {
  let url: URL;
  try { url = new URL(input); }
  catch { throw openCodeError('INVALID_ENDPOINT', 'OpenCode endpoint must be an HTTP or HTTPS service URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== ''
    || url.search !== '' || url.hash !== '' || url.pathname !== '/') {
    throw openCodeError('INVALID_ENDPOINT', 'OpenCode endpoint must be an HTTP or HTTPS origin without credentials or a path.');
  }
  if (registered && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw openCodeError('INVALID_ENDPOINT', 'OpenCode local service registration must advertise a loopback endpoint.');
  }
  return url;
}

async function readRegistration(options: OpenCodeOptions): Promise<Registration> {
  const file = openCodeRegistrationPath(options);
  if (!isAbsolute(file)) throw openCodeError('REGISTRATION_MALFORMED', 'OpenCode registration file must have an absolute path.');
  let text: string;
  try {
    const details = await stat(file);
    if (!details.isFile() || details.size > 64 * 1024) throw openCodeError('REGISTRATION_MALFORMED', 'OpenCode registration is not a bounded service record.');
    text = await readFile(file, { encoding: 'utf8', signal: options.signal });
  } catch (error) {
    cancelled(options.signal);
    if (error instanceof MultichatError) throw error;
    if (isRecord(error) && error.code === 'ENOENT') throw openCodeError('NOT_CONFIGURED', 'No running OpenCode service is registered. Open OpenCode CLI or Desktop, then refresh.');
    throw openCodeError('REGISTRATION_UNREADABLE', 'OpenCode service registration could not be read.');
  }
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw openCodeError('REGISTRATION_MALFORMED', 'OpenCode service registration is malformed.'); }
  if (text.length > 64 * 1024 || !isRecord(value) || typeof value.url !== 'string'
    || typeof value.pid !== 'number' || !Number.isInteger(value.pid) || value.pid <= 0
    || (value.version !== undefined && typeof value.version !== 'string')
    || (value.password !== undefined && typeof value.password !== 'string')
    || (value.id !== undefined && (typeof value.id !== 'string' || value.id === ''))) {
    throw openCodeError('REGISTRATION_MALFORMED', 'OpenCode service registration has invalid fields.');
  }
  return { id: value.id, url: value.url, pid: value.pid, password: value.password, version: value.version };
}

async function responseJson(response: Response): Promise<unknown> {
  if (response.body === null) throw openCodeError('PROTOCOL_ERROR', 'OpenCode returned an empty response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 8 * 1024 * 1024) throw openCodeError('PROTOCOL_ERROR', 'OpenCode response exceeded the read limit.');
      chunks.push(part.value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return value;
  } catch (error) {
    if (error instanceof MultichatError) throw error;
    if (error instanceof SyntaxError) throw openCodeError('PROTOCOL_ERROR', 'OpenCode returned malformed JSON.');
    throw error;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Read-only discovery: never spawns, resumes, repairs or stops any native process. */
export async function connectOpenCode(options: OpenCodeOptions = {}): Promise<OpenCodeConnection> {
  cancelled(options.signal);
  const env = options.env ?? process.env;
  const explicit = options.endpoint ?? (env.CROSSCHAT_OPENCODE_URL === undefined ? undefined : {
    url: env.CROSSCHAT_OPENCODE_URL, token: env.CROSSCHAT_OPENCODE_TOKEN,
  });
  const registration = explicit === undefined ? await readRegistration(options) : undefined;
  const endpoint = explicit ?? { url: registration!.url, token: registration!.password };
  const base = endpointUrl(endpoint.url, registration !== undefined);
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw openCodeError('PROTOCOL_ERROR', 'OpenCode request timeout must be positive.');
  const authorization = endpoint.token === undefined ? undefined
    : `Basic ${Buffer.from(`${endpoint.username ?? 'opencode'}:${endpoint.token}`).toString('base64')}`;

  const connection: OpenCodeConnection = {
    async request(path, body, requestOptions = {}) {
      cancelled(options.signal);
      const method = requestOptions.method ?? (body === undefined ? 'GET' : 'POST');
      const write = method !== 'GET';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = () => controller.abort();
      options.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const response = await fetch(new URL(path, base), {
          method,
          headers: { accept: 'application/json', ...(write ? { 'content-type': 'application/json' } : {}), ...(authorization === undefined ? {} : { authorization }) },
          ...(write ? { body: JSON.stringify(body) } : {}),
          signal: controller.signal,
          redirect: 'manual',
        });
        if (!response.ok) {
          if (response.status === 404) {
            const detail = await responseJson(response);
            const target = /^\/api\/session\/([^/]+)(?:\/prompt)?$/.exec(path);
            if (target !== null && isRecord(detail) && detail._tag === 'SessionNotFoundError'
              && detail.sessionID === decodeURIComponent(target[1])) {
              throw openCodeError('SESSION_NOT_FOUND', 'The exact OpenCode target session no longer exists.');
            }
            if (target !== null && isRecord(detail) && detail._tag === 'LocationNotFoundError') {
              throw openCodeError('LOCATION_NOT_FOUND', 'OpenCode could not resolve the target session location. Check its workspace configuration.');
            }
            throw openCodeError('PROTOCOL_ERROR', 'OpenCode required API route did not return a recognized target error.');
          }
          await response.body?.cancel().catch(() => undefined);
          if (response.status === 401 || response.status === 403) throw openCodeError('AUTH_REQUIRED', 'OpenCode rejected service authentication. Check the selected service configuration.');
          if (response.status === 400) throw openCodeError(write ? 'INPUT_REJECTED' : 'INVALID_CURSOR', 'OpenCode rejected the request. Refresh the session source before retrying.');
          if (response.status === 409 || response.status === 422 || response.status === 429) throw openCodeError('INPUT_REJECTED', 'OpenCode rejected this input without an admission receipt.');
          if (write) throw openCodeError('WRITE_UNCERTAIN', 'OpenCode input acceptance could not be confirmed; the write was not retried.');
          throw openCodeError(response.status >= 500 ? 'UNAVAILABLE' : 'PROTOCOL_ERROR', 'OpenCode service did not return a successful API response.');
        }
        if (requestOptions.response === 'empty') {
          if (response.status !== 204) {
            await response.body?.cancel().catch(() => undefined);
            throw openCodeError('PROTOCOL_ERROR', 'OpenCode returned an unexpected response to the write.');
          }
          return undefined;
        }
        return await responseJson(response);
      } catch (error) {
        // Never attach upstream errors or response bodies: they can contain credentials.
        if (error instanceof MultichatError) {
          if (write && error.code === 'OPENCODE_PROTOCOL_ERROR') throw openCodeError('WRITE_UNCERTAIN', 'OpenCode returned an unconfirmed input receipt; the write was not retried.');
          throw error;
        }
        if (write) throw openCodeError('WRITE_UNCERTAIN', 'OpenCode input acceptance could not be confirmed; the write was not retried.');
        if (options.signal?.aborted) throw openCodeError('CANCELLED', 'OpenCode read cancelled.');
        if (controller.signal.aborted) throw openCodeError('TIMEOUT', 'OpenCode service did not answer within the request timeout.');
        throw openCodeError('UNAVAILABLE', 'OpenCode service could not be reached.');
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
      }
    },
  };
  const info = await connection.request('/api/info');
  if (!isRecord(info) || typeof info.version !== 'string' || typeof info.pid !== 'number' || !Number.isInteger(info.pid) || info.pid < 0) {
    throw openCodeError('PROTOCOL_ERROR', 'OpenCode service identity response is malformed.');
  }
  if (!/^2\./.test(info.version)) throw openCodeError('UNSUPPORTED_VERSION', 'This adapter requires an OpenCode V2 service.');
  if (registration !== undefined && (registration.pid !== info.pid || (registration.version !== undefined && registration.version !== info.version))) {
    throw openCodeError('OWNER_MISMATCH', 'OpenCode registration no longer matches the responding service. Refresh after OpenCode has finished restarting.');
  }
  connection.serviceIdentity = { ...(registration?.id === undefined ? {} : { registrationId: registration.id }),
    pid: info.pid, version: info.version, url: base.origin };
  return connection;
}
