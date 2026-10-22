import { createHash } from 'node:crypto';
import type { NodeEntry, StarRecord } from './registry.js';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}
function hash(value: object): string { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function ordered(values: readonly unknown[]): string[] { return values.map((value) => JSON.stringify(canonical(value))).sort(); }

/** A credential replacement changes its identity; connection-time bindings are checked separately. */
export function credentialRevision(node: NodeEntry): string {
  return hash({ scope: 'crosschat-credential-v1', label: node.label, key: node.key ?? null, adminKey: node.adminKey ?? null });
}

/** Full static deletion impact. Presence changes and equivalent list ordering do not invalidate a preview. */
export function starRevision(star: StarRecord): string {
  return hash({ scope: 'crosschat-star-v1', ...star, nodes: ordered(star.nodes),
    roster: ordered(star.roster.map((member) => Object.fromEntries(Object.entries(member).filter(([key]) => key !== 'online')))) });
}
