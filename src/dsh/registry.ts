import { lstat, readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { MultichatError } from '../errors.js';
import { stateRoot } from '../state-root.js';
import type { DshOptions } from './client.js';

export interface DshRegistration {
  schema: 1;
  protocol: 1;
  provider: 'dsh';
  instanceId: string;
  pid: number;
  url: string;
  token: string;
  runtimeVersion: string;
  createdAt: number;
}

export const DSH_INSTANCE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function isDshRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
export function dshError(code: string, message: string): MultichatError { return new MultichatError(`DSH_${code}`, message); }
export function dshInstancesDirectory(options: DshOptions = {}): string {
  const directory = options.instancesDir ?? join(stateRoot(options.home), 'dsh', 'instances');
  if (!isAbsolute(directory)) throw dshError('REGISTRATION_MALFORMED', 'Harness instance directory must be absolute.');
  return directory;
}

export function validateDshEndpoint(input: string): void {
  let url: URL;
  try { url = new URL(input); } catch { throw dshError('INVALID_ENDPOINT', 'Harness bridge must advertise a loopback HTTP origin.'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port === '' || url.port === '0'
    || url.pathname !== '/' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw dshError('INVALID_ENDPOINT', 'Harness bridge must advertise an exact 127.0.0.1 HTTP origin with a port.');
  }
}

export function assertDshActive(signal: AbortSignal): void { signal.throwIfAborted(); }

function ownerIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (isDshRecord(error) && error.code === 'ESRCH') return false;
    throw dshError('REGISTRATION_UNREADABLE', 'Harness owner process could not be checked.');
  }
}

/** Read-only: expired registrations are retained, never repaired or removed. */
export async function readDshRegistrations(options: DshOptions, signal: AbortSignal): Promise<DshRegistration[]> {
  const directory = dshInstancesDirectory(options);
  assertDshActive(signal);
  let files: string[];
  try {
    const details = await lstat(directory);
    if (!details.isDirectory() || details.isSymbolicLink()) throw dshError('REGISTRATION_MALFORMED', 'Harness instance directory is not a regular directory.');
    files = (await readdir(directory)).filter((file) => file.endsWith('.json')).sort();
  } catch (error) {
    assertDshActive(signal);
    if (error instanceof MultichatError) throw error;
    if (isDshRecord(error) && error.code === 'ENOENT') throw dshError('NOT_CONFIGURED', 'No Harness bridge is registered. Install and enable the crosschat Host bundle, then refresh.');
    throw dshError('REGISTRATION_UNREADABLE', 'Harness instance directory could not be read.');
  }
  if (files.length > 100) throw dshError('REGISTRATION_MALFORMED', 'Harness instance directory exceeds the bounded record count.');
  const registrations: DshRegistration[] = [];
  for (const file of files) {
    assertDshActive(signal);
    if (!DSH_INSTANCE_ID.test(file.slice(0, -5))) throw dshError('REGISTRATION_MALFORMED', 'Harness registration filename has an invalid instance identity.');
    let value: unknown;
    try {
      const path = join(directory, file);
      const details = await lstat(path);
      if (!details.isFile() || details.isSymbolicLink() || details.size > 64 * 1024
        || (process.platform !== 'win32' && ((details.mode & 0o077) !== 0 || details.uid !== process.getuid?.()))) {
        throw dshError('REGISTRATION_MALFORMED', 'Harness registration must be a private bounded regular file.');
      }
      value = JSON.parse(await readFile(path, { encoding: 'utf8', signal }));
    } catch (error) {
      assertDshActive(signal);
      if (error instanceof MultichatError) throw error;
      if (error instanceof SyntaxError) throw dshError('REGISTRATION_MALFORMED', 'Harness registration contains malformed JSON.');
      throw dshError('REGISTRATION_UNREADABLE', 'Harness registration could not be read.');
    }
    if (!isDshRecord(value) || value.schema !== 1 || value.provider !== 'dsh' || value.instanceId !== file.slice(0, -5)
      || typeof value.pid !== 'number' || !Number.isSafeInteger(value.pid) || value.pid <= 0
      || typeof value.url !== 'string' || typeof value.token !== 'string' || !/^[a-f0-9]{64}$/.test(value.token)
      || typeof value.runtimeVersion !== 'string' || typeof value.createdAt !== 'number' || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) {
      throw dshError('REGISTRATION_MALFORMED', 'Harness registration has invalid identity or credential fields.');
    }
    if (value.protocol !== 1) throw dshError('UNSUPPORTED_PROTOCOL', 'Harness bridge protocol is not supported.');
    validateDshEndpoint(value.url);
    if (ownerIsAlive(value.pid)) registrations.push({ schema: 1, protocol: 1, provider: 'dsh', instanceId: value.instanceId,
      pid: value.pid, url: value.url, token: value.token, runtimeVersion: value.runtimeVersion, createdAt: value.createdAt });
  }
  if (registrations.length === 0) throw dshError('NOT_CONFIGURED', 'No live Harness bridge is registered. Open Harness with the crosschat Host bundle enabled, then refresh.');
  return registrations;
}
