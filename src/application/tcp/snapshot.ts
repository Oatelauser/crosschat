import { fullTcpMachineId } from './reading.js';
import { isRecord } from '../queries/reading.js';
import type { StarSnapshot, StarSnapshotMachine, StarSnapshotMember, StarSnapshotNode } from '../../serve/star-snapshot.js';

const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 65_536;
const revision = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function invalid(): never { throw new Error('Invalid authoritative star snapshot'); }
function machine(value: unknown): string {
  const full = fullTcpMachineId(value);
  if (!full) invalid();
  return full;
}
/** Validate the new snapshot contract; old mid8-only payloads never become complete identities. */
export function parseStarSnapshot(input: unknown): StarSnapshot {
  if (!isRecord(input) || Buffer.byteLength(JSON.stringify(input)) > 2 * 1024 * 1024 || !text(input.starId) || !input.starId
    || (input.name !== undefined && !text(input.name)) || !revision(input.revision) || typeof input.live !== 'boolean'
    || (input.role !== 'broker-owner' && input.role !== 'star-admin' && input.role !== 'member')
    || !Array.isArray(input.nodes) || !Array.isArray(input.machines) || !Array.isArray(input.members)) invalid();
  const labels = new Set<string>();
  const nodes = input.nodes.map((value): StarSnapshotNode => {
    if (!isRecord(value) || !text(value.label) || !value.label || labels.has(value.label) || (value.kind !== 'node' && value.kind !== 'admin')
      || !revision(value.revision) || !text(value.addedAt) || !Number.isFinite(Date.parse(value.addedAt))
      || (value.machineName !== undefined && !text(value.machineName)) || (value.kind === 'admin' && value.machineId !== undefined)) invalid();
    labels.add(value.label);
    return { label: value.label, kind: value.kind, revision: value.revision, addedAt: value.addedAt,
      ...(value.machineId === undefined ? {} : { machineId: machine(value.machineId) }), ...(value.machineName === undefined ? {} : { machineName: value.machineName }) };
  });
  const machines = input.machines.map((value): StarSnapshotMachine => {
    if (!isRecord(value) || typeof value.online !== 'boolean' || (value.name !== undefined && !text(value.name))) invalid();
    const machineId = machine(value.machineId);
    if (!nodes.some((node) => node.kind === 'node' && node.machineId === machineId)) invalid();
    return { machineId, online: value.online, ...(value.name === undefined ? {} : { name: value.name }) };
  });
  if (new Set(machines.map((item) => item.machineId)).size !== machines.length || nodes.some((node) => node.machineId !== undefined && !machines.some((item) => item.machineId === node.machineId))) invalid();
  const members = input.members.map((value): StarSnapshotMember => {
    if (!isRecord(value) || !text(value.sessionId) || !value.sessionId || typeof value.online !== 'boolean'
      || !['name', 'tool', 'machineName', 'extendsName', 'extendsMachine'].every((key) => value[key] === undefined || text(value[key]))
      || (value.temporary !== undefined && typeof value.temporary !== 'boolean')) invalid();
    return { sessionId: value.sessionId, machine: machine(value.machine), online: value.online,
      ...(typeof value.name === 'string' ? { name: value.name } : {}), ...(typeof value.tool === 'string' ? { tool: value.tool } : {}),
      ...(typeof value.machineName === 'string' ? { machineName: value.machineName } : {}), ...(typeof value.extendsName === 'string' ? { extendsName: value.extendsName } : {}),
      ...(typeof value.extendsMachine === 'string' ? { extendsMachine: value.extendsMachine } : {}), ...(typeof value.temporary === 'boolean' ? { temporary: value.temporary } : {}) };
  });
  if (new Set(members.map((item) => item.sessionId)).size !== members.length) invalid();
  return { starId: input.starId, ...(input.name === undefined ? {} : { name: input.name }), revision: input.revision, role: input.role, live: input.live, nodes, machines, members };
}
