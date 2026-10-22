import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { performLocalManagement } from '../src/application/tcp/local-management.js';

const directories: string[] = [];
function fixture() {
  const baseDir = mkdtempSync(join(tmpdir(), 'crosschat-tcp-local-management-')); directories.push(baseDir);
  mkdirSync(join(baseDir, 'tcp'));
  const file = join(baseDir, 'tcp', 'broker.json');
  writeFileSync(file, JSON.stringify({ port: 7260, stars: [{ starId: 'full-star', name: 'before', nodes: [], roster: [] }] }));
  const readStatus = async () => { throw Object.assign(new Error('fixture absent'), { code: 'ENOENT' }); };
  return { baseDir, file, readStatus, read: () => JSON.parse(readFileSync(file, 'utf8')) };
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('TUI local management ownership', () => {
  it('does not mistake malformed status metadata for verified cold state', async () => {
    const f = fixture();
    expect(await performLocalManagement({ op: 'set-name', starId: 'full-star', name: 'after' }, { baseDir: f.baseDir, readStatus: async () => null, processes: () => [], alive: () => false })).toMatchObject({ kind: 'failed' });
    expect(f.read().stars[0].name).toBe('before');
  });
  it('never cold-falls back after a verified hot broker refuses the connection', async () => {
    const f = fixture(); const transport = vi.fn(async () => ({ kind: 'cold' as const }));
    expect(await performLocalManagement({ op: 'set-name', starId: 'full-star', name: 'after' }, { baseDir: f.baseDir, readStatus: async () => ({ state: 'running', pid: 1234, port: 7260, adminPipe: 'fixture-capability' }), processes: () => [{ pid: 1234, cmdline: 'fixture/dist/cli.js serve' }], alive: () => true, transport })).toMatchObject({ kind: 'failed' });
    expect(transport).toHaveBeenCalledOnce(); expect(f.read().stars[0].name).toBe('before');
  });
  it('refuses missing status with a live broker and reuses cold business functions only after confirming none', async () => {
    const f = fixture(); const request = { op: 'set-name' as const, starId: 'full-star', name: 'after' };
    expect(await performLocalManagement(request, { baseDir: f.baseDir, readStatus: f.readStatus, processes: () => [{ pid: 1234, cmdline: 'fixture/dist/cli.js serve' }], alive: () => true })).toMatchObject({ kind: 'failed' });
    expect(f.read().stars[0].name).toBe('before');
    expect(await performLocalManagement(request, { baseDir: f.baseDir, readStatus: f.readStatus, processes: () => [], alive: () => false })).toMatchObject({ kind: 'applied', mode: 'cold' });
    expect(f.read().stars[0].name).toBe('after');
  });
  it('does not report a legacy-shaped node file as saved when the existing writer cannot modify it', async () => {
    const f = fixture(); const file = join(f.baseDir, 'tcp', 'node.json');
    const raw = JSON.stringify({ broker: { host: 'fixture.invalid', port: 7260, starId: 'full-star' }, key: 'only-fixture-key' }); writeFileSync(file, raw);
    expect(await performLocalManagement({ op: 'set-showname', name: 'new-name' }, { baseDir: f.baseDir, readStatus: f.readStatus, processes: () => [], alive: () => false })).toMatchObject({ kind: 'rejected' });
    expect(readFileSync(file, 'utf8')).toBe(raw);
  });
});
