import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { credentialRevision, starRevision } from '../src/serve/management-state.js';
import { removeCredentialExactFor, removeStarExactFrom } from '../src/serve/registry.js';
import type { StarRecord } from '../src/serve/registry.js';

const directories: string[] = [];
const machine = 'a'.repeat(32);
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'crosschat-tcp-exact-'));
  directories.push(directory);
  const file = join(directory, 'broker.json');
  const star: StarRecord = { starId: 'full-star-id', name: 'fixture', nodes: [{ label: 'node-1', key: 'only-fixture-key', addedAt: '2026-10-22T00:00:00.000Z', machineId: machine }, { label: 'admin-long', adminKey: 'only-fixture-admin-key', addedAt: '2026-10-22T00:00:00.000Z' }], roster: [{ sessionId: 'full/native/session', machine, tool: 'futuretool' }] };
  const document = { fixtureUnknown: { retained: true }, port: 7260, stars: [{ ...star, futureStatic: 'retained' }, { starId: 'other-full-star', name: 'other', nodes: [], roster: [] }] };
  const save = () => writeFileSync(file, JSON.stringify(document));
  save();
  return { directory, file, star: document.stars[0], document, save, read: () => JSON.parse(readFileSync(file, 'utf8')) };
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('atomic complete management targets', () => {
  it('refuses reused credential labels and changed complete machine bindings without writing', () => {
    const f = fixture(); const expected = { credentialRevision: credentialRevision(f.star.nodes[0]), machineId: machine };
    f.star.nodes[0].key = 'replacement-fixture-key'; f.save(); const before = readFileSync(f.file, 'utf8');
    expect(removeCredentialExactFor(f.file, f.star.starId!, 'node-1', 'node', expected)).toMatchObject({ kind: 'rejected' });
    expect(readFileSync(f.file, 'utf8')).toBe(before);
    const latest = { credentialRevision: credentialRevision(f.star.nodes[0]), machineId: null };
    expect(removeCredentialExactFor(f.file, f.star.starId!, 'node-1', 'node', latest)).toMatchObject({ kind: 'rejected' });
    expect(readFileSync(f.file, 'utf8')).toBe(before);
  });

  it('never falls back from a vanished admin label to another label prefix or credential kind', () => {
    const f = fixture(); const expected = { credentialRevision: credentialRevision(f.star.nodes[1]), machineId: null };
    expect(removeCredentialExactFor(f.file, f.star.starId!, 'admin', 'admin', expected)).toMatchObject({ kind: 'rejected' });
    expect(removeCredentialExactFor(f.file, f.star.starId!, 'admin-long', 'node', expected)).toMatchObject({ kind: 'rejected' });
    expect(f.read().stars[0].nodes).toHaveLength(2);
  });

  it('returns only the removed internal credential for revocation while retaining unrelated static data', () => {
    const f = fixture(); const node = f.star.nodes[0];
    expect(removeCredentialExactFor(f.file, f.star.starId!, node.label, 'node', { credentialRevision: credentialRevision(node), machineId: machine })).toEqual({ kind: 'removed', credential: node });
    expect(f.read()).toMatchObject({ fixtureUnknown: { retained: true }, stars: [{ futureStatic: 'retained', nodes: [f.star.nodes[1]], roster: f.star.roster }, f.document.stars[1]] });
  });

  it('binds star deletion to the full static impact while ignoring transient presence', () => {
    const f = fixture(); const revision = starRevision(f.star);
    f.star.roster.push({ sessionId: 'new/full/native', machine, tool: 'futuretool' }); f.save();
    expect(removeStarExactFrom(f.file, f.star.starId!, { starRevision: revision })).toMatchObject({ kind: 'rejected' });
    expect(f.read().stars).toHaveLength(2);
    const latest = starRevision(f.star); f.star.roster[0].online = true; f.save();
    writeFileSync(join(f.directory, 'node.json'), JSON.stringify({ brokers: [{ host: 'fixture.invalid', port: 7260, key: 'fixture-key', starId: f.star.starId }, { host: 'other.invalid', port: 7260, key: 'other-fixture-key', starId: 'other-full-star' }], futureNode: true }));
    expect(removeStarExactFrom(f.file, f.star.starId!, { starRevision: latest })).toMatchObject({ kind: 'removed', removed: { name: 'fixture', nodes: 2, roster: 2 } });
    expect(f.read()).toMatchObject({ fixtureUnknown: { retained: true }, stars: [f.document.stars[1]] });
    expect(JSON.parse(readFileSync(join(f.directory, 'node.json'), 'utf8'))).toMatchObject({ futureNode: true, brokers: [{ starId: 'other-full-star' }] });
  });

  it('refuses damaged or ambiguous source state without repair, backups or an unrelated deletion', () => {
    const f = fixture(); const node = f.star.nodes[0]; const expected = { credentialRevision: credentialRevision(node), machineId: machine };
    f.star.nodes.push({ ...node }); f.save();
    expect(() => removeCredentialExactFor(f.file, f.star.starId!, node.label, 'node', expected)).toThrow(/台账|配置|source/);
    expect(f.read().stars[0].nodes).toHaveLength(3);
    writeFileSync(f.file, '{broken');
    expect(() => removeStarExactFrom(f.file, f.star.starId!, { starRevision: 'a'.repeat(64) })).toThrow(/台账|配置|source/);
    expect(readFileSync(f.file, 'utf8')).toBe('{broken');
    expect(existsSync(`${f.file}.bak`)).toBe(false);
  });
});
