import * as fs from 'node:fs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { credentialRevision, machineCredentialRevision } from '../src/serve/management-state.js';
import { removeMachineExactFor, setConnectedNodeShowNameFor } from '../src/serve/registry.js';
import { performLocalManagement } from '../src/application/tcp/local-management.js';
import type { NodeEntry } from '../src/serve/registry.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});
const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
const roots: string[] = [];
const machineId = 'a'.repeat(32); const otherId = 'b'.repeat(32);
const addedAt = '2026-10-23T00:00:00Z';
function fixture() {
  const baseDir = mkdtempSync(join(process.platform === 'darwin' ? realpathSync('/tmp') : tmpdir(), 'cc-mtx-')); roots.push(baseDir);
  mkdirSync(join(baseDir, 'tcp')); const file = join(baseDir, 'tcp', 'broker.json');
  const nodes: NodeEntry[] = [
    { label: 'first', key: 'only-fixture-first-key', machineId, addedAt },
    { label: 'second', key: 'only-fixture-second-key', machineId, addedAt },
    { label: 'unused', key: 'only-fixture-unused-key', addedAt },
    { label: 'operator', adminKey: 'only-fixture-admin-key', addedAt },
    { label: 'other', key: 'only-fixture-other-key', machineId: otherId, addedAt },
  ];
  const roster = [{ sessionId: 'permanent/native/session', machine: machineId, tool: 'futuretool' }];
  const doc = { customTop: { keep: true }, port: 7260, stars: [{ starId: 'star-a', nodes, roster, customStar: true }, { starId: 'star-b', nodes: [{ ...nodes[0] }], roster: [] }] };
  const save = () => writeFileSync(file, JSON.stringify(doc)); save();
  const expected = () => ({ machineRevision: machineCredentialRevision(machineId, nodes.filter((item) => item.key && item.machineId === machineId).map((item) => ({ label: item.label, revision: credentialRevision(item) }))) });
  const statusMissing = async () => { throw Object.assign(new Error('fixture missing'), { code: 'ENOENT' }); };
  return { baseDir, file, nodes, roster, doc, save, expected, statusMissing, read: () => JSON.parse(readFileSync(file, 'utf8')) };
}
afterEach(() => { vi.mocked(fs.renameSync).mockImplementation(actualFs.renameSync); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('atomic complete machine registry writes', () => {
  it('removes all and only bound current-star node keys in one commit while preserving members and unknown fields', () => {
    const f = fixture(); const removed = f.nodes.slice(0, 2);
    const beforeWrites = vi.mocked(fs.renameSync).mock.calls.length;
    expect(removeMachineExactFor(f.file, 'star-a', machineId, f.expected())).toEqual({ kind: 'removed', machineId, credentials: removed });
    expect(vi.mocked(fs.renameSync).mock.calls.length - beforeWrites).toBe(1);
    expect(f.read()).toEqual({ ...f.doc, stars: [{ ...f.doc.stars[0], nodes: f.nodes.slice(2) }, f.doc.stars[1]] });
  });

  it('refuses added, replaced or rebound keys without making any partial deletion', () => {
    for (const change of ['added', 'replaced', 'rebound']) {
      const f = fixture(); const confirmed = f.expected();
      if (change === 'added') f.nodes.push({ label: 'late', key: 'only-fixture-late-key', machineId, addedAt });
      else if (change === 'replaced') f.nodes[0].key = 'only-fixture-replacement';
      else f.nodes[0].machineId = otherId;
      f.save(); const before = readFileSync(f.file, 'utf8');
      expect(removeMachineExactFor(f.file, 'star-a', machineId, confirmed)).toMatchObject({ kind: 'rejected' });
      expect(readFileSync(f.file, 'utf8')).toBe(before);
    }
  });

  it('ignores credential ordering and display-only metadata when binding the complete key set', () => {
    const f = fixture(); const confirmed = f.expected();
    f.nodes.reverse(); for (const node of f.nodes) node.machineName = 'new-display-only'; f.save();
    expect(removeMachineExactFor(f.file, 'star-a', machineId, confirmed)).toMatchObject({ kind: 'removed' });
    expect(f.read().stars[0].nodes.map((node: NodeEntry) => node.label).sort()).toEqual(['operator', 'other', 'unused']);
  });

  it('refuses malformed sources without repair or backups', () => {
    const f = fixture(); writeFileSync(f.file, '{broken');
    expect(() => removeMachineExactFor(f.file, 'star-a', machineId, f.expected())).toThrow();
    expect(readFileSync(f.file, 'utf8')).toBe('{broken'); expect(existsSync(`${f.file}.bak`)).toBe(false);
  });

  it('performs cold machine removal through the same transaction and never cold-renames an offline peer', async () => {
    const f = fixture(); const options = { baseDir: f.baseDir, readStatus: f.statusMissing, processes: () => [], alive: () => false };
    expect(await performLocalManagement({ op: 'rename-node', starId: 'star-a', machineId, name: 'peer' }, options)).toMatchObject({ kind: 'rejected' });
    expect(f.read().stars[0].nodes).toHaveLength(5);
    expect(await performLocalManagement({ op: 'remove-machine', starId: 'star-a', machineId, expected: f.expected() }, options)).toMatchObject({ kind: 'applied', mode: 'cold', value: { removed: true, machineId, removedLabels: ['first', 'second'] } });
    expect(f.read().stars[0].roster).toEqual(f.roster);
  });
  it('never falls back to cold machine deletion after the verified live broker loses its receipt channel', async () => {
    const f = fixture(); const before = readFileSync(f.file, 'utf8'); const transport = vi.fn(async () => ({ kind: 'cold' as const }));
    expect(await performLocalManagement({ op: 'remove-machine', starId: 'star-a', machineId, expected: f.expected() }, {
      baseDir: f.baseDir, readStatus: async () => ({ state: 'running', pid: 1234, port: 7260, adminPipe: 'fixture-only-capability' }),
      processes: () => [{ pid: 1234, cmdline: 'node /fixture/dist/cli.js serve' }], alive: () => true, transport,
    })).toMatchObject({ kind: 'failed' });
    expect(transport).toHaveBeenCalledOnce(); expect(readFileSync(f.file, 'utf8')).toBe(before);
  });
});

describe('fixed peer configuration naming transaction', () => {
  function configured() {
    const f = fixture(); const file = join(f.baseDir, 'tcp', 'node.json');
    const entry = { host: 'fixture.invalid', port: 7260, key: 'only-fixture-node-key', starId: 'star-a', showName: 'old', customEntry: { keep: true } };
    const doc = { brokers: [entry, { ...entry, starId: 'star-b', key: 'only-fixture-other-key', showName: 'other-star' }], showName: 'global-default', custom: { keep: true } };
    writeFileSync(file, JSON.stringify(doc)); return { ...f, file, entry, doc };
  }
  it('saves the exact connected current-star entry and clears only its override', () => {
    const f = configured();
    expect(setConnectedNodeShowNameFor(f.file, f.entry, 'new-name')).toEqual({ showName: 'new-name', name: 'new-name' });
    expect(JSON.parse(readFileSync(f.file, 'utf8'))).toEqual({ ...f.doc, brokers: [{ ...f.entry, showName: 'new-name' }, f.doc.brokers[1]] });
    expect(setConnectedNodeShowNameFor(f.file, f.entry, '')).toEqual({ showName: '', name: 'global-default' });
    const saved = JSON.parse(readFileSync(f.file, 'utf8')); expect(saved.brokers[0].showName).toBeUndefined();
    expect(saved.brokers[1]).toEqual(f.doc.brokers[1]); expect(saved.showName).toBe('global-default');
  });
  it('refuses a replaced credential or duplicate star before changing any file', () => {
    const f = configured(); const raw = readFileSync(f.file, 'utf8');
    expect(() => setConnectedNodeShowNameFor(f.file, { ...f.entry, key: 'different-fixture-key' }, 'new')).toThrow();
    expect(readFileSync(f.file, 'utf8')).toBe(raw);
    f.doc.brokers.push({ ...f.entry, key: 'another-fixture-key' }); writeFileSync(f.file, JSON.stringify(f.doc));
    const before = readFileSync(f.file, 'utf8'); expect(() => setConnectedNodeShowNameFor(f.file, f.entry, 'new')).toThrow();
    expect(readFileSync(f.file, 'utf8')).toBe(before);
  });
  it('keeps the previous configuration when final persistence fails', () => {
    const f = configured(); const before = readFileSync(f.file, 'utf8');
    vi.mocked(fs.renameSync).mockImplementation((source, destination) => {
      if (String(destination) === f.file) throw new Error('controlled write refusal');
      actualFs.renameSync(source, destination);
    });
    expect(() => setConnectedNodeShowNameFor(f.file, f.entry, 'new-name')).toThrow();
    expect(readFileSync(f.file, 'utf8')).toBe(before);
  });
});
