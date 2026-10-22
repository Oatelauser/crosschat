import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTcpApplication } from '../src/application/tcp/index.js';
import { createTcpManagement } from '../src/application/tcp/management.js';

const roots: string[] = [];
const fullMachine = 'a'.repeat(32);
async function fixture() {
  const baseDir = await mkdtemp(join(tmpdir(), 'crosschat-tcp-cold-')); roots.push(baseDir); await mkdir(join(baseDir, 'tcp'));
  const file = join(baseDir, 'tcp', 'broker.json');
  const raw = JSON.stringify({ port: 7260, stars: [{ starId: 'full-existing-star', name: 'existing', nodes: [{ label: 'node-1', key: 'only-isolated-fixture-key', machineId: fullMachine, addedAt: '2026-10-22T00:00:00.000Z' }], roster: [{ sessionId: 'full/native/session', machine: fullMachine, tool: 'futuretool' }] }] });
  await writeFile(file, raw);
  await writeFile(join(baseDir, 'tcp', 'status-broker.json'), JSON.stringify({ state: 'stopped', pid: 1234, lastUpdated: '2026-10-22T00:00:00.000Z' }));
  const catalog = createTcpApplication({ baseDir });
  const executeLocal = vi.fn(async () => ({ kind: 'applied' as const, mode: 'cold' as const, value: undefined }));
  const service = createTcpManagement({ baseDir, catalog, executeLocal, machineId: () => fullMachine });
  return { baseDir, file, raw, catalog, executeLocal, service };
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('verified cold static metadata for TCP management', () => {
  it('keeps unknown runtime presence partial while explicitly identifying complete validated local static data', async () => {
    const f = await fixture();
    const page = await f.catalog.readStar({ contextId: 'local', starId: 'full-existing-star' });
    expect(page).toMatchObject({ completeness: 'partial', staticComplete: true, star: { role: 'broker-owner', onlineNodes: null } });
    expect(page.machines[0].presence).toBe('unknown'); expect(page.members[0].presence).toBe('unknown');
    expect(await f.catalog.readStars({ contextId: 'local' })).toMatchObject({ completeness: 'partial', staticComplete: true });
    expect(await readFile(f.file, 'utf8')).toBe(f.raw);
  });

  it('allows a cold existing-star mutation from the actual readonly app without reading OS processes or executing real writes', async () => {
    const f = await fixture(); const page = await f.catalog.readStar({ contextId: 'local', starId: 'full-existing-star' });
    const request = { contextId: 'local', action: 'rename-star' as const, starId: 'full-existing-star', targetId: page.star!.id, values: { name: 'renamed' } };
    const preview = await f.service.preview(request); expect(preview.enabled).toBe(true);
    expect(await f.service.apply({ ...request, expectedPreviewRevision: preview.revision })).toMatchObject({ kind: 'applied', mode: 'cold' });
    expect(f.executeLocal).toHaveBeenCalledWith({ op: 'set-name', starId: 'full-existing-star', name: 'renamed' }, undefined);
    expect(await readFile(f.file, 'utf8')).toBe(f.raw);
  });

  it('allows another local star to be added while existing stars have only validated static metadata', async () => {
    const f = await fixture(); f.executeLocal.mockResolvedValue({ kind: 'applied', mode: 'cold', value: { starId: 'new-full-star', stars: 2 } });
    const request = { contextId: 'local', action: 'add-star' as const, values: { name: 'another' } };
    const preview = await f.service.preview(request); expect(preview.enabled).toBe(true);
    expect(await f.service.apply({ ...request, expectedPreviewRevision: preview.revision })).toMatchObject({ kind: 'applied', mode: 'cold' });
    expect(f.executeLocal).toHaveBeenCalledWith({ op: 'add-star', name: 'another' }, undefined);
    expect(await readFile(f.file, 'utf8')).toBe(f.raw);
  });

  it('does not mark damaged local static metadata complete or permit mutation', async () => {
    const f = await fixture(); await writeFile(f.file, '{damaged');
    const page = await f.catalog.readStars({ contextId: 'local' }); expect(page.staticComplete).not.toBe(true);
    expect(await f.service.preview({ contextId: 'local', action: 'add-star', values: { name: 'another' } })).toMatchObject({ enabled: false });
    expect(f.executeLocal).not.toHaveBeenCalled(); expect(await readFile(f.file, 'utf8')).toBe('{damaged');
  });

  it('never uses a partial remote result as local static authority even if an injected source claims the marker', async () => {
    const f = await fixture(); const local = await f.catalog.readStar({ contextId: 'local', starId: 'full-existing-star' });
    const remote = { ...local, contextId: 'tcp:configured', staticComplete: true, star: { ...local.star!, contextId: 'tcp:configured', role: 'star-admin' as const } };
    const catalog = { readStar: vi.fn(async () => remote), readStars: vi.fn(async () => ({ contextId: remote.contextId, staticComplete: true, completeness: 'partial' as const, observedAt: remote.observedAt, errors: remote.errors, role: 'star-admin' as const, configured: true, items: [remote.star] })) };
    const service = createTcpManagement({ baseDir: f.baseDir, catalog, executeLocal: f.executeLocal });
    expect(await service.preview({ contextId: remote.contextId, starId: remote.star.starId, action: 'generate-node-key', values: { count: '1', host: 'reachable.invalid' } })).toMatchObject({ enabled: false });
    expect(f.executeLocal).not.toHaveBeenCalled();
  });
});
