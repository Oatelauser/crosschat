import { createHash } from 'node:crypto';
import { dshError, isDshRecord } from './registry.js';
import { withDshOperation } from './service.js';
import type { DshConnection, DshOperation } from './service.js';
import { nativeTargetKey } from '../tool-types.js';

export interface DshOptions {
  /** Exact bridge selected by the native per-execution contributor, never a candidate guess. */
  instanceId?: string;
  endpointType?: string;
  home?: string;
  instancesDir?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface DshThread {
  id: string;
  endpointType?: string;
  name: string | null;
  cwd: string;
  rawStatus: { type: 'idle' | 'running' };
  attributes: Readonly<Record<string, unknown>>;
}

export interface DshPageOptions extends DshOptions { cursor?: string; limit?: number }
export interface DshThreadPage { data: DshThread[]; nextCursor: string | null; completeness: 'complete' | 'partial' }

export function dshSessionPath(id: string): string {
  if (typeof id !== 'string' || id === '' || id === '.' || id === '..' || Buffer.byteLength(id) > 16 * 1024) throw dshError('INPUT_REJECTED', 'An exact bounded Harness native session ID is required.');
  return `/v1/sessions/${encodeURIComponent(id)}`;
}

function thread(value: unknown, connection: DshConnection): DshThread {
  if (!isDshRecord(value) || typeof value.id !== 'string' || value.id === '' || Buffer.byteLength(value.id) > 16 * 1024
    || (value.name !== null && typeof value.name !== 'string') || (value.cwd !== null && typeof value.cwd !== 'string')
    || (value.originalCwd !== null && typeof value.originalCwd !== 'string') || (value.status !== 'idle' && value.status !== 'running')
    || typeof value.createdAt !== 'number' || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) {
    throw dshError('PROTOCOL_ERROR', 'Harness bridge returned malformed root session fields.');
  }
  return { id: value.id, ...(connection.registration.endpointType === undefined ? {} : { endpointType: connection.registration.endpointType }),
    name: typeof value.name === 'string' && value.name !== '' ? value.name : null,
    cwd: typeof value.cwd === 'string' ? value.cwd : '', rawStatus: { type: value.status },
    attributes: { instanceId: connection.registration.instanceId, runtimeVersion: connection.registration.runtimeVersion,
      ...(connection.registration.profile === undefined ? {} : { profile: connection.registration.profile }),
      scope: 'live-root-agents', currentCwd: value.cwd, originalCwd: value.originalCwd, createdAt: value.createdAt } };
}

async function allThreads(operation: DshOperation): Promise<DshThread[]> {
  const result: DshThread[] = [];
  const ids = new Set<string>();
  for (const connection of await operation.connections()) {
    const response = await connection.request('/v1/sessions');
    if (!isDshRecord(response) || !Array.isArray(response.items)) throw dshError('PROTOCOL_ERROR', 'Harness bridge returned a malformed root-session list.');
    for (const item of response.items) {
      const current = thread(item, connection);
      const key = nativeTargetKey({ providerId: 'dsh', nativeId: current.id, endpointType: current.endpointType });
      if (ids.has(key)) throw dshError('AMBIGUOUS_SESSION', 'The same native Harness session ID and endpoint type are live in multiple source entries; no instance was selected.');
      ids.add(key); result.push(current);
    }
  }
  return result;
}

export async function listDshThreads(options: DshOptions = {}): Promise<DshThread[]> { return withDshOperation(options, allThreads); }

export async function listDshThreadPage(options: DshPageOptions = {}): Promise<DshThreadPage> {
  const limit = options.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw dshError('INVALID_CURSOR', 'Harness page limit must be between 1 and 1000.');
  let cursor: { offset: number; membership: string } | undefined;
  if (options.cursor !== undefined) {
    try {
      if (typeof options.cursor !== 'string' || options.cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(options.cursor)) throw new Error('Invalid cursor');
      const value: unknown = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8'));
      if (!isDshRecord(value) || value.schema !== 1 || typeof value.offset !== 'number' || !Number.isSafeInteger(value.offset) || value.offset < 1
        || typeof value.membership !== 'string' || !/^[a-f0-9]{64}$/.test(value.membership)) throw new Error('Invalid cursor');
      cursor = { offset: value.offset, membership: value.membership };
    } catch { throw dshError('INVALID_CURSOR', 'Harness page cursor is invalid. Refresh the session source.'); }
  }
  const items = await listDshThreads(options);
  const membership = createHash('sha256').update(JSON.stringify([options.endpointType ?? null,
    items.map((item) => [item.attributes.instanceId, item.endpointType ?? null, item.id])])).digest('hex');
  if (cursor !== undefined && (cursor.membership !== membership || cursor.offset >= items.length)) throw dshError('INVALID_CURSOR', 'Harness source membership changed; refresh before paging.');
  const offset = cursor?.offset ?? 0;
  const next = offset + limit;
  const nextCursor = next < items.length ? Buffer.from(JSON.stringify({ schema: 1, offset: next, membership })).toString('base64url') : null;
  return { data: items.slice(offset, next), nextCursor, completeness: nextCursor === null ? 'complete' : 'partial' };
}

/** Exact lookup across every live instance: never picks an ambiguous writer. */
export async function findDshTarget(id: string, operation: DshOperation, endpointType?: string): Promise<{ connection: DshConnection; thread: DshThread } | null> {
  const path = dshSessionPath(id);
  let target: { connection: DshConnection; thread: DshThread } | null = null;
  for (const connection of await operation.connections()) {
    if (endpointType !== undefined && connection.registration.endpointType !== endpointType) continue;
    const response = await connection.request(path);
    if (!isDshRecord(response) || !Object.hasOwn(response, 'item')) throw dshError('PROTOCOL_ERROR', 'Harness bridge returned a malformed exact-session response.');
    if (response.item === null) continue;
    const current = thread(response.item, connection);
    if (current.id !== id) throw dshError('PROTOCOL_ERROR', 'Harness bridge did not return the requested native session ID.');
    if (target !== null) throw dshError('AMBIGUOUS_SESSION', 'The native Harness session ID is live in multiple instances; no message was sent.');
    target = { connection, thread: current };
  }
  return target;
}

export async function getDshThread(id: string, options: DshOptions = {}): Promise<DshThread | null> {
  dshSessionPath(id);
  return withDshOperation(options, async (operation) => (await findDshTarget(id, operation, options.endpointType))?.thread ?? null);
}
