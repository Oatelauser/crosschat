import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isProcessAlive } from '../../platform/process-inspector.js';
import { TCP_STATUS_FRESH_MS, nodeStatusSelector } from '../status/status-files.js';
import { checkAbort, isRecord, optionalString, queryError, readParsed } from './reading.js';
import type { QueryError, TextOptions } from './reading.js';

export interface ServiceSnapshot {
  file: string;
  kind: 'broker' | 'node';
  selector: string;
  state: string;
  lastUpdated: string;
  freshness: 'fresh' | 'stale';
  readiness: 'ready' | 'starting' | 'waiting' | 'stopped' | 'unknown';
  pid?: number;
  processAlive?: boolean;
  version?: string;
  brokerAlias?: string;
  port?: number;
  onlineNodes?: string[];
  stars?: { starId: string; name?: string }[];
}
export interface CollectionResult<T> {
  items: T[];
  completeness: 'complete' | 'partial' | 'unavailable' | 'cancelled';
  observedAt: number;
  errors: QueryError[];
}

function parseSnapshot(raw: string, file: string, observedAt: number): ServiceSnapshot {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || typeof value.state !== 'string' || typeof value.lastUpdated !== 'string' || !Number.isFinite(Date.parse(value.lastUpdated))) {
    throw new Error('Invalid snapshot');
  }
  const kind = file === 'status-broker.json' ? 'broker' : 'node';
  const freshness = observedAt - Date.parse(value.lastUpdated) < TCP_STATUS_FRESH_MS ? 'fresh' : 'stale';
  const readiness = value.state === 'stopped' ? 'stopped' : 'unknown';
  return {
    file, kind, selector: kind === 'node' ? nodeStatusSelector(file) : '',
    state: value.state, lastUpdated: value.lastUpdated, freshness, readiness,
    pid: typeof value.pid === 'number' && Number.isInteger(value.pid) && value.pid > 0 ? value.pid : undefined,
    version: optionalString(value.version), brokerAlias: optionalString(value.brokerAlias),
    port: typeof value.port === 'number' ? value.port : undefined,
    onlineNodes: Array.isArray(value.onlineNodes) ? value.onlineNodes.filter((item): item is string => typeof item === 'string') : undefined,
    stars: Array.isArray(value.stars) ? value.stars.flatMap((star) => isRecord(star) && typeof star.starId === 'string'
      ? [{ starId: star.starId, name: optionalString(star.name) }] : []) : undefined,
  };
}

/** Reads snapshots plus a signal-0 PID probe; never scans processes or writes state. */
export async function queryServiceStatuses(options: TextOptions & { tcpDir: string; isProcessAlive?: (pid: number) => boolean }): Promise<CollectionResult<ServiceSnapshot>> {
  const observedAt = (options.now ?? Date.now)();
  const items: ServiceSnapshot[] = [];
  const errors: QueryError[] = [];
  try {
    checkAbort(options.signal);
    const files = (await readdir(options.tcpDir)).filter((file) => /^status-(broker|node(-.*)?)\.json$/.test(file)).sort();
    for (const file of files) {
      checkAbort(options.signal);
      const result = await readParsed(join(options.tcpDir, file), (raw) => parseSnapshot(raw, file, observedAt), { ...options, now: () => observedAt });
      if (result.state === 'cancelled') return { items: [], completeness: 'cancelled', observedAt, errors: result.errors };
      if (result.value !== null) {
        const snapshot = result.value;
        if (snapshot.pid !== undefined) snapshot.processAlive = (options.isProcessAlive ?? isProcessAlive)(snapshot.pid);
        if (snapshot.freshness === 'fresh' && snapshot.processAlive === true && snapshot.state !== 'stopped') {
          snapshot.readiness = snapshot.state === 'running' || snapshot.state === 'online' ? 'ready'
            : snapshot.state === 'connecting' ? 'starting'
              : snapshot.state === 'reconnect-wait' ? 'waiting' : 'unknown';
        }
        items.push(snapshot);
      }
      errors.push(...result.errors);
    }
  } catch (error) {
    const issue = queryError(options.tcpDir, error);
    return { items: [], completeness: issue.kind === 'cancelled' ? 'cancelled' : 'unavailable', observedAt, errors: [issue] };
  }
  return { items, completeness: errors.length === 0 ? 'complete' : items.length === 0 ? 'unavailable' : 'partial', observedAt, errors };
}
