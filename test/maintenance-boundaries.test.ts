import { linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { executeMaintenance, previewMaintenance } from '../src/application/maintenance/operations.js';

const failures = vi.hoisted(() => {
  let virtualStat: import('node:fs').BigIntStats | undefined;
  return { denied: new Set<string>(), crowded: '', reads: 0, closed: 0,
    virtualStat, descriptors: new Set<number>(), nextDescriptor: 1_000_000, opened: 0, fileClosed: 0 };
});
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const crowdedFile = (path: string) => failures.crowded !== '' && path.startsWith(join(failures.crowded, 'virtual-'));
  const virtualStat = () => {
    if (failures.virtualStat === undefined) throw new Error('Crowded fixture metadata was not initialized');
    return failures.virtualStat;
  };
  return { ...actual,
    lstatSync: (...args: Parameters<typeof actual.lstatSync>) => crowdedFile(String(args[0])) ? virtualStat() : actual.lstatSync(...args),
    openSync: (...args: Parameters<typeof actual.openSync>) => {
      if (failures.denied.has(String(args[0]))) throw Object.assign(new Error('SECRET source failure'), { code: 'EACCES' });
      if (crowdedFile(String(args[0]))) {
        if (args[1] !== 'r') throw new Error('Crowded fixture only supports read-only files');
        const descriptor = failures.nextDescriptor++;
        failures.descriptors.add(descriptor); failures.opened++;
        return descriptor;
      }
      return actual.openSync(...args);
    },
    fstatSync: (...args: Parameters<typeof actual.fstatSync>) => failures.descriptors.has(args[0]) ? virtualStat() : actual.fstatSync(...args),
    closeSync: (descriptor: number) => {
      if (failures.descriptors.delete(descriptor)) { failures.fileClosed++; return; }
      actual.closeSync(descriptor);
    },
    opendirSync: (...args: Parameters<typeof actual.opendirSync>) => {
      if (failures.denied.has(String(args[0]))) throw Object.assign(new Error('SECRET directory failure'), { code: 'EACCES' });
      if (String(args[0]) === failures.crowded) return {
        readSync: () => ++failures.reads <= 20_000 ? { name: `virtual-${failures.reads}.md` } : null,
        closeSync: () => { failures.closed++; },
      };
      return actual.opendirSync(...args);
    },
  };
});

const root = mkdtempSync(join(tmpdir(), 'crosschat-maintenance-boundaries-'));
const NOW = 1_800_000_000_000;
afterEach(() => {
  failures.denied.clear(); failures.crowded = ''; failures.reads = 0; failures.closed = 0;
  failures.virtualStat = undefined; failures.descriptors.clear(); failures.nextDescriptor = 1_000_000; failures.opened = 0; failures.fileClosed = 0;
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
function fixture() {
  const home = mkdtempSync(join(root, 'home-'));
  const sourceDir = join(home, 'packaged-skill');
  const tcp = join(home, '.crosschat', 'tcp');
  mkdirSync(sourceDir); mkdirSync(tcp, { recursive: true });
  writeFileSync(join(sourceDir, 'SKILL.md'), 'isolated source');
  return { home, sourceDir, tcp, options: { home, sourceDir, env: {}, now: () => NOW } };
}

describe('TUI maintenance source and copy boundaries', () => {
  it('blocks uninstall for malformed, unknown and oversized service snapshots without deleting any target', () => {
    for (const raw of ['{broken SECRET', 'null', '{}', '{"state":"running","lastUpdated":"invalid"}', 'x'.repeat(2 * 1024 * 1024 + 1)]) {
      const f = fixture();
      const before = previewMaintenance('uninstall-data', f.options);
      writeFileSync(join(f.tcp, 'status-broker.json'), raw);
      const preview = previewMaintenance('uninstall-data', f.options);
      expect(preview.enabled).toBe(false);
      expect(preview.reason).toMatch(/状态|完整|核验/);
      expect(JSON.stringify(preview)).not.toContain('SECRET');
      const remove = vi.fn();
      expect(executeMaintenance('uninstall-data', before.fingerprint, { ...f.options, effects: { remove } }).status).toBe('blocked');
      expect(remove).not.toHaveBeenCalled();
    }
  });

  it('blocks unreadable and linked service snapshots instead of treating them as no running service', () => {
    const unreadable = fixture();
    const status = join(unreadable.tcp, 'status-node-work.json');
    writeFileSync(status, JSON.stringify({ state: 'stopped', lastUpdated: '2000-01-01' }));
    failures.denied.add(status);
    expect(previewMaintenance('uninstall-data', unreadable.options).enabled).toBe(false);
    const linked = fixture();
    const outside = mkdtempSync(join(root, 'outside-status-'));
    symlinkSync(outside, join(linked.tcp, 'status-node-work.json'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(previewMaintenance('uninstall-data', linked.options).enabled).toBe(false);
  });

  it('rechecks a confirmed skill destination subtree and refuses a new junction before copy can write outside it', () => {
    const f = fixture();
    mkdirSync(join(f.sourceDir, 'references'));
    writeFileSync(join(f.sourceDir, 'references', 'test.txt'), 'new source');
    const destination = join(f.home, '.claude', 'skills', 'crosschat');
    mkdirSync(destination, { recursive: true });
    const preview = previewMaintenance('install-skills', f.options);
    expect(preview.enabled).toBe(true);
    const outside = mkdtempSync(join(root, 'outside-copy-'));
    writeFileSync(join(outside, 'test.txt'), 'unchanged outside');
    symlinkSync(outside, join(destination, 'references'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = executeMaintenance('install-skills', preview.fingerprint, f.options);
    expect(result.status).toBe('blocked');
    expect(readFileSync(join(outside, 'test.txt'), 'utf8')).toBe('unchanged outside');
  });

  it('refuses nested source links and destination hard links without copying or modifying linked data', () => {
    const source = fixture();
    const outside = mkdtempSync(join(root, 'outside-source-'));
    symlinkSync(outside, join(source.sourceDir, 'references'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(previewMaintenance('install-skills', source.options).enabled).toBe(false);
    const destination = fixture();
    const target = join(destination.home, '.claude', 'skills', 'crosschat');
    mkdirSync(target, { recursive: true });
    const preview = previewMaintenance('install-skills', destination.options);
    const original = join(outside, 'original.txt');
    writeFileSync(original, 'unchanged hard link');
    linkSync(original, join(target, 'SKILL.md'));
    expect(executeMaintenance('install-skills', preview.fingerprint, destination.options).status).toBe('blocked');
    expect(readFileSync(original, 'utf8')).toBe('unchanged hard link');
  });

  it('closes unreadable sources and bounds directory enumeration before accepting a skill plan', () => {
    const denied = fixture();
    failures.denied.add(join(denied.sourceDir, 'SKILL.md'));
    expect(previewMaintenance('install-skills', denied.options).enabled).toBe(false);
    failures.denied.clear();
    failures.denied.add(denied.sourceDir);
    expect(previewMaintenance('install-skills', denied.options).enabled).toBe(false);
    failures.denied.clear();
    const crowded = fixture();
    // Keep the inventory-boundary test independent of 50,000 repeated OS file probes.
    // Ordinary source, permission and link cases above retain their real filesystem boundaries.
    failures.virtualStat = lstatSync(join(crowded.sourceDir, 'SKILL.md'), { bigint: true });
    failures.crowded = crowded.sourceDir;
    expect(previewMaintenance('install-skills', crowded.options).enabled).toBe(false);
    expect(failures.reads).toBe(10_001);
    expect(failures.opened).toBe(10_000);
    expect(failures.fileClosed).toBe(10_000);
    expect(failures.descriptors.size).toBe(0);
    expect(failures.closed).toBe(1);
  }, 15_000);
});
