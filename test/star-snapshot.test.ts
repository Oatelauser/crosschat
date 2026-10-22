import { describe, expect, it } from 'vitest';

const midA = '12345678000000000000000000000001';
const midB = '12345678000000000000000000000002';
describe('secret-free authoritative star snapshots', () => {
  it('emits complete machine identity and credential revisions without confusing credentials with machines or leaking keys', async () => {
    const { buildStarSnapshot } = await import('../src/serve/star-snapshot.js');
    const star = { starId: 'star-full', name: 'alpha', nodes: [
      { label: 'one', key: 'PRIVATE-one', machineId: midA, machineName: 'same', addedAt: '2026-01-01' },
      { label: 'two', key: 'PRIVATE-two', machineId: midB, machineName: 'same', addedAt: '2026-01-01' },
      { label: 'unused', key: 'PRIVATE-unused', addedAt: '2026-01-01' }, { label: 'ops', adminKey: 'PRIVATE-admin', addedAt: '2026-01-01' },
    ], roster: [{ sessionId: 'full/native', machine: midB, tool: 'third', online: true, extendsName: 'old', temporary: true }] };
    const result = buildStarSnapshot(star, { role: 'member', onlineMachines: new Set([midA]) });
    expect(result.role).toBe('member');
    expect(result.machines).toEqual([{ machineId: midA, name: 'same', online: true }, { machineId: midB, name: 'same', online: false }]);
    expect(result.nodes.map((node) => node.kind)).toEqual(['node', 'node', 'node', 'admin']);
    expect(result.nodes.every((node) => /^[a-f0-9]{64}$/.test(node.revision))).toBe(true);
    expect(result.members[0]).toMatchObject({ machine: midB, online: true, sessionId: 'full/native', extendsName: 'old', temporary: true });
    expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
});
