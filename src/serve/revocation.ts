/** Per-star, per-credential pause evidence; user configuration is never changed. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MultichatError } from '../errors.js';
import { readNodeConfig } from './node-config.js';
import type { BrokerEntry } from './node-config.js';

export interface NodeRevocation {
  starId: string;
  credentialFingerprint: string;
  host: string;
  port: number;
  reason: 'node-removed';
  pausedAt: string;
}

const fingerprint = (value: string): string => createHash('sha256').update(value).digest('hex');

function markerPath(configFile: string, entry: BrokerEntry, starId: string): string {
  return join(dirname(configFile), `revoked-${fingerprint(entry.key)}-${fingerprint(starId)}.json`);
}

function unreadable(): MultichatError {
  return new MultichatError('REVOCATION_STATE_UNREADABLE', '撤权暂停记录不可读，已停止自动连接；请检查 ~/.crosschat/tcp/revoked-*.json');
}

function isMissing(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

function readMarker(file: string, entry: BrokerEntry, starId?: string): NodeRevocation | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw unreadable();
  }
  if (raw === null || typeof raw !== 'object'
    || !('starId' in raw) || typeof raw.starId !== 'string' || raw.starId === ''
    || !('credentialFingerprint' in raw) || raw.credentialFingerprint !== fingerprint(entry.key)
    || !('host' in raw) || typeof raw.host !== 'string'
    || !('port' in raw) || typeof raw.port !== 'number' || !Number.isInteger(raw.port)
    || !('reason' in raw) || raw.reason !== 'node-removed'
    || !('pausedAt' in raw) || typeof raw.pausedAt !== 'string' || !Number.isFinite(Date.parse(raw.pausedAt))) {
    throw unreadable();
  }
  if (starId !== undefined && raw.starId !== starId) throw unreadable();
  if (starId === undefined && (raw.host !== entry.host || raw.port !== entry.port)) return undefined;
  return {
    starId: raw.starId,
    credentialFingerprint: raw.credentialFingerprint,
    host: raw.host,
    port: raw.port,
    reason: raw.reason,
    pausedAt: raw.pausedAt,
  };
}

/** Atomic, owner-readable evidence. Names and payloads contain no credential value. */
export function writeNodeRevocation(configFile: string, entry: BrokerEntry, starId: string, now: number): void {
  const marker: NodeRevocation = {
    starId, credentialFingerprint: fingerprint(entry.key), host: entry.host, port: entry.port,
    reason: 'node-removed', pausedAt: new Date(now).toISOString(),
  };
  const file = markerPath(configFile, entry, starId);
  const temporary = `${file}.${randomUUID()}.tmp`;
  mkdirSync(dirname(file), { recursive: true });
  try {
    writeFileSync(temporary, `${JSON.stringify(marker, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Also finds a handshake-time pause before the broker could fill in starId. */
export function readNodeRevocation(configFile: string, entry: BrokerEntry): NodeRevocation | undefined {
  let starId = entry.starId;
  if (starId === undefined) {
    try {
      starId = readNodeConfig(configFile).entries.find((candidate) =>
        candidate.host === entry.host && candidate.port === entry.port && candidate.key === entry.key)?.starId;
    } catch {
      // An injected client may not have a config file; credential-bound evidence remains authoritative.
    }
  }
  if (starId !== undefined) return readMarker(markerPath(configFile, entry, starId), entry, starId);
  let files: string[];
  try {
    files = readdirSync(dirname(configFile));
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw unreadable();
  }
  const prefix = `revoked-${fingerprint(entry.key)}-`;
  for (const file of files) {
    if (!file.startsWith(prefix) || !/^[a-f0-9]{64}\.json$/.test(file.slice(prefix.length))) continue;
    const marker = readMarker(join(dirname(configFile), file), entry);
    if (marker !== undefined) return marker;
  }
  return undefined;
}

export function assertNodeNotRevoked(configFile: string, entry: BrokerEntry): void {
  if (readNodeRevocation(configFile, entry) !== undefined) {
    throw new MultichatError('CREDENTIAL_REVOKED', `星 ${entry.name ?? entry.starId ?? entry.host} 的节点凭证已撤销，自动重连已暂停；换钥后显式重新连接`);
  }
}
