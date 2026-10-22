import { closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import type { NodeEntry, RosterEntry, StarRecord } from './registry.js';

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function optionalText(value: unknown): value is string | undefined { return value === undefined || typeof value === 'string'; }
function node(value: unknown): value is NodeEntry {
  return record(value) && typeof value.label === 'string' && value.label.length > 0 && typeof value.addedAt === 'string'
    && optionalText(value.key) && optionalText(value.adminKey) && optionalText(value.machineId) && optionalText(value.machineName)
    && (typeof value.key === 'string' && value.key.length > 0 || typeof value.adminKey === 'string' && value.adminKey.length > 0);
}
function member(value: unknown): value is RosterEntry {
  return record(value) && typeof value.sessionId === 'string' && value.sessionId.length > 0 && typeof value.machine === 'string' && value.machine.length > 0
    && ['name', 'tool', 'machineName', 'extendsName', 'extendsMachine'].every((key) => optionalText(value[key]))
    && (value.temporary === undefined || typeof value.temporary === 'boolean');
}

/** A new read request must not invoke the legacy registry reader's backup/repair path. */
export function readSnapshotStar(file: string, starId: string): StarRecord {
  const limit = 2 * 1024 * 1024;
  const path = lstatSync(file);
  if (path.isSymbolicLink() || !path.isFile()) throw new Error('星快照台账不可读取');
  const fd = openSync(file, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.dev !== path.dev || stat.ino !== path.ino || stat.size > limit) throw new Error('星快照台账不可核验');
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    for (;;) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
      if (length > limit) throw new Error('星快照台账超过读取上限');
    }
    const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
    if (!record(raw) || !Array.isArray(raw.stars)) throw new Error('星快照台账形状无效');
    const matches = raw.stars.filter((value: unknown) => record(value) && value.starId === starId);
    const star: unknown = matches[0];
    if (matches.length !== 1 || !record(star) || !optionalText(star.name) || !Array.isArray(star.nodes) || !star.nodes.every(node)
      || !Array.isArray(star.roster) || !star.roster.every(member)) throw new Error('星快照目标缺失或形状无效');
    return { starId, ...(typeof star.name === 'string' ? { name: star.name } : {}), nodes: star.nodes, roster: star.roster };
  } finally { closeSync(fd); }
}
