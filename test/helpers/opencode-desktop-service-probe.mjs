import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

export function desktopStartupFailure(check, message, options = {}) {
  return Object.assign(new Error(message, options.cause ? { cause: options.cause } : undefined), {
    category: options.category ?? 'infrastructure', stage: 'setup', check, retry: options.retry ?? false,
  });
}

export function parseDesktopServiceRegistration(value, expectedPort) {
  if (!value || typeof value !== 'object' || typeof value.url !== 'string' || typeof value.password !== 'string'
    || !Number.isSafeInteger(value.pid) || value.pid < 1) throw desktopStartupFailure('service-registration-schema', 'Invalid isolated desktop service registration', { category: 'compatibility' });
  let endpoint;
  try { endpoint = new URL(value.url); }
  catch { throw desktopStartupFailure('service-registration-schema', 'Invalid desktop service endpoint', { category: 'compatibility' }); }
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)
    || Number(endpoint.port) !== expectedPort || endpoint.username || endpoint.password) throw desktopStartupFailure('service-registration-schema', 'Desktop registration points outside its owned loopback service', { category: 'compatibility' });
  return value;
}

/** One isolated registration/info probe; the fixture owns retry and process readiness. */
export async function probeDesktopService(registrationFile, expectedPort, options = {}) {
  let text;
  try { text = await readFile(registrationFile, 'utf8'); }
  catch (cause) { throw desktopStartupFailure('service-registration-unavailable', 'Desktop service registration is unavailable', { retry: true, cause }); }
  let registration;
  try { registration = JSON.parse(text); }
  catch (cause) { throw desktopStartupFailure('service-registration-schema', 'Desktop service registration is not valid JSON', { category: 'compatibility', cause }); }
  const info = parseDesktopServiceRegistration(registration, expectedPort);
  let response;
  try {
    response = await globalThis.fetch(new URL('/api/info', info.url), {
      headers: { authorization: `Basic ${Buffer.from(`opencode:${info.password}`).toString('base64')}` },
      signal: options.signal ?? globalThis.AbortSignal.timeout(500), redirect: 'manual',
    });
  } catch (cause) { throw desktopStartupFailure('service-readiness', 'Desktop service health request is unavailable', { retry: true, cause }); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403) throw desktopStartupFailure('service-authentication', `Desktop service rejected its registered credentials (HTTP ${response.status})`, { category: 'compatibility' });
    if (response.status === 404 || response.status === 405) throw desktopStartupFailure('service-info-route', `Desktop service info route changed (HTTP ${response.status})`, { category: 'compatibility' });
    if (response.status === 429 || response.status >= 500) throw desktopStartupFailure('service-readiness', `Desktop service is not ready (HTTP ${response.status})`, { retry: true });
    throw desktopStartupFailure('service-info-response', `Desktop service info returned HTTP ${response.status}`, { category: 'compatibility' });
  }
  let health;
  try { health = await response.json(); }
  catch (cause) {
    if (!(cause instanceof SyntaxError)) throw desktopStartupFailure('service-readiness', 'Desktop service health response was interrupted', { retry: true, cause });
    throw desktopStartupFailure('service-info-schema', 'Desktop service info is not valid JSON', { category: 'compatibility', cause });
  }
  if (!health || typeof health !== 'object' || health.pid !== info.pid || typeof health.version !== 'string') throw desktopStartupFailure('service-info-schema', 'Desktop service info does not match its registration', { category: 'compatibility' });
  return { ...info, version: health.version };
}
