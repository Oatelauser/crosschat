import * as fs from 'node:fs';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { credentialRevision, starRevision } from '../src/serve/management-state.js';
import { removeCredentialExactFor, removeStarExactFrom } from '../src/serve/registry.js';
import type { StarRecord } from '../src/serve/registry.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});
const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');

const directories: string[] = [];
const machine = 'a'.repeat(32);
function fixture() {
  // Use the real fixture root: macOS tmpdir can include the system /var symlink.
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'crosschat-tcp-exact-')));
  directories.push(directory);
  const file = join(directory, 'broker.json');
  const star: StarRecord = { starId: 'full-star-id', name: 'fixture', nodes: [{ label: 'node-1', key: 'only-fixture-key', addedAt: '2026-10-22T00:00:00.000Z', machineId: machine }, { label: 'admin-long', adminKey: 'only-fixture-admin-key', addedAt: '2026-10-22T00:00:00.000Z' }], roster: [{ sessionId: 'full/native/session', machine, tool: 'futuretool' }] };
  const document = { fixtureUnknown: { retained: true }, port: 7260, stars: [{ ...star, futureStatic: 'retained' }, { starId: 'other-full-star', name: 'other', nodes: [], roster: [] }] };
  const save = () => writeFileSync(file, JSON.stringify(document));
  save();
  return { directory, file, star: document.stars[0], document, save, read: () => JSON.parse(readFileSync(file, 'utf8')) };
}
afterEach(() => { vi.mocked(fs.renameSync).mockImplementation(actualFs.renameSync); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

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

  it('preserves the actual star deletion result when secondary node cleanup fails so broker can still revoke it', () => {
    const f = fixture(); const nodeFile = join(f.directory, 'node.json');
    writeFileSync(nodeFile, JSON.stringify({ brokers: [{ host: 'fixture.invalid', port: 7260, starId: f.star.starId, key: 'fixture-node-key' }] }));
    vi.mocked(fs.renameSync).mockImplementation((source, destination) => {
      if (String(destination) === nodeFile) throw new Error('controlled node cleanup failure');
      actualFs.renameSync(source, destination);
    });
    expect(removeStarExactFrom(f.file, f.star.starId!, { starRevision: starRevision(f.star) })).toMatchObject({ kind: 'removed', cleanupFailed: true, removed: { nodes: 2, roster: 1 } });
    expect(f.read().stars).toHaveLength(1);
    expect(JSON.parse(readFileSync(nodeFile, 'utf8')).brokers).toHaveLength(1);
  });

  it('does not overwrite an outside marker through a preexisting fixed temporary hard link', () => {
    const f = fixture(); const outside = join(f.directory, 'outside-marker'); writeFileSync(outside, 'keep-marker');
    linkSync(outside, `${f.file}.tmp`);
    const node = f.star.nodes[0];
    removeCredentialExactFor(f.file, f.star.starId!, node.label, 'node', { credentialRevision: credentialRevision(node), machineId: machine });
    expect(readFileSync(outside, 'utf8')).toBe('keep-marker');
  });

  it('rejects a linked parent chain before changing its actual external registry', () => {
    const f = fixture(); const linked = join(f.directory, 'linked-parent'); const actual = join(f.directory, 'actual-parent'); mkdirSync(actual);
    const outside = join(actual, 'broker.json'); writeFileSync(outside, JSON.stringify(f.document));
    symlinkSync(actual, linked, process.platform === 'win32' ? 'junction' : 'dir');
    const node = f.star.nodes[0]; const before = readFileSync(outside, 'utf8');
    expect(() => removeCredentialExactFor(join(linked, 'broker.json'), f.star.starId!, node.label, 'node', { credentialRevision: credentialRevision(node), machineId: machine })).toThrow();
    expect(readFileSync(outside, 'utf8')).toBe(before);
  });
});
