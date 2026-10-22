import { normalizeMid } from '../platform/machine-id.js';
import { credentialRevision, starRevision } from './management-state.js';
import type { StarRecord } from './registry.js';

export type StarSnapshotRole = 'broker-owner' | 'star-admin' | 'member';
export interface StarSnapshotNode {
  label: string;
  kind: 'node' | 'admin';
  revision: string;
  machineId?: string;
  machineName?: string;
  addedAt: string;
}
export interface StarSnapshotMachine { machineId: string; name?: string; online: boolean }
export interface StarSnapshotMember {
  sessionId: string;
  machine: string;
  name?: string;
  tool?: string;
  machineName?: string;
  online: boolean;
  extendsName?: string;
  extendsMachine?: string;
  temporary?: boolean;
}
export interface StarSnapshot {
  starId: string;
  name?: string;
  revision: string;
  role: StarSnapshotRole;
  /** False only for an explicit local static-file observation while broker is cold. */
  live: boolean;
  nodes: StarSnapshotNode[];
  machines: StarSnapshotMachine[];
  members: StarSnapshotMember[];
}

/** Pure projection. The broker supplies its live roster and exact online machine set. */
export function buildStarSnapshot(star: StarRecord, options: { role: StarSnapshotRole; onlineMachines: ReadonlySet<string>; live?: boolean }): StarSnapshot {
  if (!star.starId) throw new Error('Star snapshot requires a complete star identity');
  const online = new Set([...options.onlineMachines].map(normalizeMid));
  const machines = new Map<string, StarSnapshotMachine>();
  const nodes = star.nodes.map((node): StarSnapshotNode => {
    const machineId = node.machineId ? normalizeMid(node.machineId) : undefined;
    const kind = node.adminKey ? 'admin' : 'node';
    if (kind === 'node' && machineId) machines.set(machineId, { machineId, ...(node.machineName === undefined ? {} : { name: node.machineName }), online: online.has(machineId) });
    return { label: node.label, kind, revision: credentialRevision(node), addedAt: node.addedAt,
      ...(kind === 'node' && machineId ? { machineId } : {}), ...(kind === 'node' && node.machineName !== undefined ? { machineName: node.machineName } : {}) };
  });
  const members = star.roster.map((member): StarSnapshotMember => ({ sessionId: member.sessionId, machine: normalizeMid(member.machine), online: member.online === true,
    ...(member.name === undefined ? {} : { name: member.name }), ...(member.tool === undefined ? {} : { tool: member.tool }),
    ...(member.machineName === undefined ? {} : { machineName: member.machineName }), ...(member.extendsName === undefined ? {} : { extendsName: member.extendsName }),
    ...(member.extendsMachine === undefined ? {} : { extendsMachine: member.extendsMachine }), ...(member.temporary === undefined ? {} : { temporary: member.temporary }) }));
  return { starId: star.starId, ...(star.name === undefined ? {} : { name: star.name }), revision: starRevision(star), role: options.role,
    live: options.live !== false, nodes, machines: [...machines.values()], members };
}
