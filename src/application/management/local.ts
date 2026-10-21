import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PORT } from '../../serve/broker.js';
import {
  addStarTo, genAdminKeyFor, genKeysFor, loadBrokerFile, registryFileOf,
  removeAdminKeyFor, removeNodeFor, removeStarFrom, setNameFor,
  setShowNameFor, setStarShowNameFor, tcpDir,
} from '../../serve/registry.js';
import type { GenAdminKeyResult, GenKeyResult, RemovedStarInfo } from '../../serve/registry.js';
import type { AdminReply } from '../../serve/broker.js';
import { sendAdminRequest } from './transport.js';
import type { AdminOutcome } from './transport.js';

export type ManagementRequest =
  | { op: 'set-name'; starId: string; name: string }
  | { op: 'add-star'; name: string }
  | { op: 'remove-star'; starId: string }
  | { op: 'set-showname'; starId?: string; name: string }
  | { op: 'gen-key'; starId: string; n: number; host: string; port: number }
  | { op: 'remove-node'; starId: string; label: string }
  | { op: 'gen-admin-key'; starId: string; label: string }
  | { op: 'remove-admin-key'; starId: string; label: string };

export interface ManagementDeps {
  baseDir: string;
  machineId(): string | undefined;
  hostname(): string;
  adminTransport?(request: ManagementRequest): Promise<AdminOutcome>;
}

export type ManagementResult<T> =
  | { kind: 'applied'; mode: 'hot' | 'cold'; value: T }
  | { kind: 'rejected'; error: string; mode?: 'hot' | 'cold'; reason?: 'not-configured' }
  | { kind: 'failed'; error: string };

async function apply<T>(
  deps: ManagementDeps,
  request: ManagementRequest,
  cold: () => T,
  decode: (reply: AdminReply) => T,
): Promise<ManagementResult<T>> {
  const outcome = await (deps.adminTransport?.(request) ?? sendAdminRequest(deps, request));
  if (outcome.kind === 'failed') return outcome;
  if (outcome.kind === 'cold') return { kind: 'applied', mode: 'cold', value: cold() };
  if (!outcome.reply.ok) return { kind: 'rejected', error: outcome.reply.error ?? '未知错误' };
  try {
    return { kind: 'applied', mode: 'hot', value: decode(outcome.reply) };
  } catch (error) {
    return { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}

/** A standalone rename never enters the service startup command. */
export function renameStar(request: { starId: string; name: string }, deps: ManagementDeps): Promise<ManagementResult<void>> {
  return apply(deps, { op: 'set-name', ...request },
    () => setNameFor(registryFileOf(deps.baseDir), request.starId, request.name), () => undefined);
}

export function addStar(request: { name: string }, deps: ManagementDeps): Promise<ManagementResult<{ starId?: string; stars: number }>> {
  const file = registryFileOf(deps.baseDir);
  return apply(deps, { op: 'add-star', ...request }, () => {
    const count = loadBrokerFile(file).stars.length;
    const starId = addStarTo(file, request.name, {
      machineId: deps.machineId(), hostname: deps.hostname(), port: loadBrokerFile(file).port ?? DEFAULT_PORT,
    });
    return { starId, stars: count + 1 };
  }, (reply) => ({
    ...(typeof reply.starId === 'string' ? { starId: reply.starId } : {}),
    stars: typeof reply.stars === 'number' ? reply.stars : loadBrokerFile(file).stars.length,
  }));
}

function isRemovedStar(value: unknown): value is RemovedStarInfo {
  if (value === null || typeof value !== 'object') return false;
  const fields = value as Record<string, unknown>;
  return typeof fields.nodes === 'number' && typeof fields.roster === 'number' &&
    (fields.name === undefined || typeof fields.name === 'string');
}

export function removeStar(request: { starId: string }, deps: ManagementDeps): Promise<ManagementResult<{ removed?: RemovedStarInfo }>> {
  return apply(deps, { op: 'remove-star', ...request },
    () => ({ removed: removeStarFrom(registryFileOf(deps.baseDir), request.starId) }),
    (reply) => ({ removed: isRemovedStar(reply.removed) ? reply.removed : undefined }));
}

export async function setDisplayName(request: { name: string; starId?: string }, deps: ManagementDeps): Promise<ManagementResult<void>> {
  const result = await apply<{ configured: boolean; error?: string }>(deps, { op: 'set-showname', ...request }, () => {
    const nodeJson = join(tcpDir(deps.baseDir), 'node.json');
    if (!existsSync(nodeJson)) return { configured: false };
    if (request.starId === undefined) setShowNameFor(nodeJson, request.name);
    else {
      try { setStarShowNameFor(nodeJson, request.starId, request.name); }
      catch (error) { return { configured: true, error: error instanceof Error ? error.message : String(error) }; }
    }
    return { configured: true };
  }, () => ({ configured: true }));
  if (result.kind !== 'applied') return result;
  if (!result.value.configured) {
    return { kind: 'rejected', mode: 'cold', reason: 'not-configured', error: '本机尚无 node.json（未入任何星）' };
  }
  if (result.value.error !== undefined) return { kind: 'rejected', mode: 'cold', error: result.value.error };
  return { kind: 'applied', mode: result.mode, value: undefined };
}

function isGeneratedKey(value: unknown): value is GenKeyResult {
  if (value === null || typeof value !== 'object') return false;
  const fields = value as Record<string, unknown>;
  return typeof fields.label === 'string' && typeof fields.key === 'string' && typeof fields.nodeJsonContent === 'string';
}

export function generateKeys(request: { starId: string; n: number; host: string; port: number }, deps: ManagementDeps): Promise<ManagementResult<{ results: GenKeyResult[] }>> {
  const file = registryFileOf(deps.baseDir);
  return apply(deps, { op: 'gen-key', ...request }, () => {
    const star = loadBrokerFile(file).stars.find((entry) => entry.starId === request.starId);
    return { results: genKeysFor(file, request.starId, request.n, {
      host: request.host, port: request.port, ...(star?.name === undefined ? {} : { name: star.name }),
    }) };
  }, (reply) => {
    if (!Array.isArray(reply.results) || !reply.results.every(isGeneratedKey)) throw new Error('管理插座回执缺 results（形状异常）');
    return { results: reply.results };
  });
}

export function removeNode(request: { starId: string; label: string }, deps: ManagementDeps): Promise<ManagementResult<{ removed: boolean }>> {
  return apply(deps, { op: 'remove-node', ...request },
    () => ({ removed: removeNodeFor(registryFileOf(deps.baseDir), request.starId, request.label) }),
    (reply) => ({ removed: reply.removed === true }));
}

export function generateAdminKey(request: { starId: string; label: string }, deps: ManagementDeps): Promise<ManagementResult<{ result: GenAdminKeyResult }>> {
  return apply(deps, { op: 'gen-admin-key', ...request },
    () => ({ result: genAdminKeyFor(registryFileOf(deps.baseDir), request.starId, request.label) }),
    (reply) => {
      const result = reply.result;
      if (result === null || typeof result !== 'object' || !('adminKey' in result) || typeof result.adminKey !== 'string') {
        throw new Error('管理插座回执缺 result（形状异常）');
      }
      return { result: { label: 'label' in result && typeof result.label === 'string' ? result.label : request.label, adminKey: result.adminKey } };
    });
}

export function removeAdminKey(request: { starId: string; label: string }, deps: ManagementDeps): Promise<ManagementResult<{ removed?: string }>> {
  return apply(deps, { op: 'remove-admin-key', ...request },
    () => ({ removed: removeAdminKeyFor(registryFileOf(deps.baseDir), request.starId, request.label) }),
    (reply) => ({ removed: typeof reply.removed === 'string' ? reply.removed : undefined }));
}
