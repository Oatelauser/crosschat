import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

export function parseDesktopServiceRegistration(value, expectedPort) {
  if (!value || typeof value !== 'object' || typeof value.url !== 'string' || typeof value.password !== 'string'
    || !Number.isSafeInteger(value.pid) || value.pid < 1) throw new Error('Invalid isolated desktop service registration');
  const endpoint = new URL(value.url);
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)
    || Number(endpoint.port) !== expectedPort || endpoint.username || endpoint.password) throw new Error('Desktop registration points outside its owned loopback service');
  return value;
}

/** One isolated registration/info probe; the fixture owns retry and process readiness. */
export async function probeDesktopService(registrationFile, expectedPort, options = {}) {
  const info = parseDesktopServiceRegistration(JSON.parse(await readFile(registrationFile, 'utf8')), expectedPort);
  const response = await globalThis.fetch(new URL('/api/info', info.url), {
    headers: { authorization: `Basic ${Buffer.from(`opencode:${info.password}`).toString('base64')}` },
    signal: options.signal ?? globalThis.AbortSignal.timeout(500),
  });
  if (!response.ok) throw new Error(`Desktop service GET /api/info: HTTP ${response.status}`);
  const health = await response.json();
  if (health.pid !== info.pid || typeof health.version !== 'string') throw new Error('Desktop service info does not match its registration');
  return { ...info, version: health.version };
}
