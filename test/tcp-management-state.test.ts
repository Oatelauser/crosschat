import { describe, expect, it } from 'vitest';
import { credentialRevision, starRevision } from '../src/serve/management-state.js';
import type { NodeEntry, StarRecord } from '../src/serve/registry.js';

const node: NodeEntry = { label: 'node-1', key: 'isolated-node-secret', addedAt: '2026-10-22T00:00:00.000Z' };
const admin: NodeEntry = { label: 'ops', adminKey: 'isolated-admin-secret', addedAt: '2026-10-22T00:00:00.000Z' };
const star: StarRecord = { starId: 'opaque-full-star', name: 'fixture-star', nodes: [node, admin], roster: [
  { sessionId: 'opaque/full/session', machine: 'a'.repeat(32), tool: 'future-provider', name: '匿名也可无名', online: true },
  { sessionId: 'other/full/session', machine: 'b'.repeat(32), tool: 'codex', extendsName: 'previous', extendsMachine: 'c'.repeat(32), temporary: true },
] };

describe('shared management state identities', () => {
  it('gives each credential a secret-free revision and changes it on label, kind or key replacement', () => {
    const revision = credentialRevision(node);
    expect(revision).toMatch(/^[a-f0-9]{64}$/);
    expect(revision).not.toContain(node.key);
    expect(credentialRevision({ ...node, machineId: 'a'.repeat(32), machineName: '新绑定', addedAt: 'later' })).toBe(revision);
    expect(credentialRevision({ ...node, key: 'replacement-secret' })).not.toBe(revision);
    expect(credentialRevision({ ...node, label: 'other-label' })).not.toBe(revision);
    expect(credentialRevision({ label: node.label, adminKey: node.key, addedAt: node.addedAt })).not.toBe(revision);
  });

  it('ignores only roster online state and list order while binding all static star, credential and member structure', () => {
    const revision = starRevision(star);
    const shuffled: StarRecord = { ...star, nodes: [...star.nodes].reverse(), roster: [...star.roster].reverse().map((member) => ({ ...member, online: member.online !== true })) };
    expect(starRevision(shuffled)).toBe(revision);
    expect(starRevision({ ...star, name: 'renamed' })).not.toBe(revision);
    expect(starRevision({ ...star, nodes: [{ ...node, machineId: 'a'.repeat(32) }, admin] })).not.toBe(revision);
    expect(starRevision({ ...star, nodes: [{ ...node, key: 'replacement-secret' }, admin] })).not.toBe(revision);
    expect(starRevision({ ...star, roster: star.roster.map((member, index) => index === 0 ? { ...member, tool: 'other-provider' } : member) })).not.toBe(revision);
    expect(starRevision({ ...star, roster: [...star.roster, { sessionId: 'new-member', machine: 'c'.repeat(32) }] })).not.toBe(revision);
  });

  it('retains unknown static fields in the revision without mutating input or exposing the secret values', () => {
    const before = JSON.stringify(star);
    const changed = { ...star, nodes: [{ ...node, futureStaticProperty: { b: 2, a: 1 } }, admin] };
    expect(starRevision(changed)).not.toBe(starRevision(star));
    expect(starRevision({ ...changed, nodes: [{ ...node, futureStaticProperty: { a: 1, b: 2 } }, admin] })).toBe(starRevision(changed));
    expect(JSON.stringify(star)).toBe(before);
    expect(starRevision(star)).toMatch(/^[a-f0-9]{64}$/);
  });
});
