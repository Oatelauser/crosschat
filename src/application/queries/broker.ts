import { join } from 'node:path';
import { parseNodeConfig } from '../../serve/node-config.js';
import { isRecord, optionalString, readParsed } from './reading.js';
import type { TextOptions } from './reading.js';

export interface CredentialSummary {
  label: string;
  credential: 'member' | 'admin' | 'unknown';
  machineId?: string;
  machineName?: string;
  addedAt?: string;
}
export interface MemberSummary {
  sessionId: string;
  machine?: string;
  name?: string;
  tool?: string;
  machineName?: string;
  extendsName?: string;
  extendsMachine?: string;
  temporary?: boolean;
}
export interface StarSummary {
  starId?: string;
  name?: string;
  nodes: CredentialSummary[];
  roster: MemberSummary[];
}
export interface BrokerSummary {
  port?: number;
  stars: StarSummary[];
}

function parseBroker(raw: string): BrokerSummary {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || !Array.isArray(value.stars)) throw new Error('Invalid broker file');
  const stars = value.stars.map((star): StarSummary => {
    if (!isRecord(star) || !Array.isArray(star.nodes)) throw new Error('Invalid star');
    const nodes = star.nodes.map((node): CredentialSummary => {
      if (!isRecord(node) || typeof node.label !== 'string') throw new Error('Invalid credential');
      return {
        label: node.label,
        credential: typeof node.adminKey === 'string' && node.adminKey !== '' ? 'admin'
          : typeof node.key === 'string' && node.key !== '' ? 'member' : 'unknown',
        machineId: optionalString(node.machineId), machineName: optionalString(node.machineName), addedAt: optionalString(node.addedAt),
      };
    });
    // Match the legacy reader's optional roster and entry filtering, without .bak or secrets.
    const roster = (Array.isArray(star.roster) ? star.roster : []).flatMap((entry): MemberSummary[] => {
      if (!isRecord(entry) || typeof entry.sessionId !== 'string' || entry.sessionId === '') return [];
      return [{
        sessionId: entry.sessionId, machine: optionalString(entry.machine), name: optionalString(entry.name),
        tool: optionalString(entry.tool), machineName: optionalString(entry.machineName),
        extendsName: optionalString(entry.extendsName), extendsMachine: optionalString(entry.extendsMachine),
        temporary: typeof entry.temporary === 'boolean' ? entry.temporary : undefined,
      }];
    });
    return { starId: optionalString(star.starId), name: optionalString(star.name), nodes, roster };
  });
  return { port: typeof value.port === 'number' ? value.port : undefined, stars };
}

export function queryBroker(options: TextOptions & { tcpDir: string }) {
  return readParsed(join(options.tcpDir, 'broker.json'), parseBroker, options);
}

/** Normalization follows the existing config parser; ordinary views never receive keys. */
export function queryNodeConnections(options: TextOptions & { tcpDir: string }) {
  const file = join(options.tcpDir, 'node.json');
  return readParsed(file, (raw) => {
    const config = parseNodeConfig(raw, file);
    return {
      showName: config.showName,
      entries: config.entries.map((entry) => ({
        host: entry.host, port: entry.port, name: entry.name, starId: entry.starId, showName: entry.showName,
        hasMemberKey: entry.key !== '', hasAdminKey: entry.adminKey !== undefined,
      })),
    };
  }, options);
}
