import { Worker } from 'node:worker_threads';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'crosschat-maintenance-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
function fixture() {
  const home = mkdtempSync(join(root, 'home-'));
  const sourceDir = join(home, 'packaged-skill');
  mkdirSync(sourceDir);
  writeFileSync(join(sourceDir, 'SKILL.md'), 'isolated source');
  const options = { home, sourceDir, env: {}, now: () => NOW };
  const put = (relative: string, age = 0) => {
    const file = join(home, '.crosschat', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'fixture');
    const at = new Date(NOW - age);
    utimesSync(file, at, at);
    return file;
  };
  return { home, options, put };
}

describe('local maintenance plans and exact execution', () => {
  it('previews the unchanged retention rules without touching data or skills', async () => {
    const { previewMaintenance } = await import('../src/application/maintenance/operations.js');
    const f = fixture();
    const expired = f.put('tcp/inbox/old', 6 * DAY);
    const fresh = f.put('tcp/parts/fresh', 4 * DAY);
    const shard = f.put('conversations/old.json', 31 * DAY);
    const temporary = f.put('conversations/old.json.tmp', 90 * DAY);
    const ignored = f.put('outbox/parked.json', 90 * DAY);
    const preview = previewMaintenance('cleanup', f.options);
    expect(preview.operationId).toBe('cleanup');
    expect(preview.enabled).toBe(true);
    expect(preview.targets.map((item) => item.path)).toEqual([expired, shard]);
    expect(preview.effects.join('\n')).toContain('30');
    for (const file of [expired, fresh, shard, temporary, ignored]) expect(readFileSync(file, 'utf8')).toBe('fixture');
    expect(existsSync(join(f.home, '.claude'))).toBe(false);
  });

  it('refuses a changed cleanup plan before any deletion, rather than extending its accepted targets', async () => {
    const { previewMaintenance, executeMaintenance } = await import('../src/application/maintenance/operations.js');
    const f = fixture();
    const first = f.put('tcp/inbox/first', 9 * DAY);
    const preview = previewMaintenance('cleanup', f.options);
    const late = f.put('tcp/inbox/late', 9 * DAY);
    const remove = vi.fn();
    const result = executeMaintenance('cleanup', preview.fingerprint, { ...f.options, effects: { remove } });
    expect(result.status).toBe('changed');
    expect(remove).not.toHaveBeenCalled();
    expect(existsSync(first)).toBe(true);
    expect(existsSync(late)).toBe(true);
  });

  it('reports actual successful and failed removals without claiming the planned count was deleted', async () => {
    const { previewMaintenance, executeMaintenance } = await import('../src/application/maintenance/operations.js');
    const f = fixture();
    const good = f.put('tcp/inbox/good', 9 * DAY);
    const denied = f.put('tcp/parts/denied', 9 * DAY);
    const preview = previewMaintenance('cleanup', f.options);
    const result = executeMaintenance('cleanup', preview.fingerprint, { ...f.options, effects: { remove: (file) => {
      if (file === denied) throw new Error('sensitive body must never escape');
      rmSync(file, { force: true });
    } } });
    expect(result.status).toBe('partial');
    expect(result.items).toEqual([
      expect.objectContaining({ path: good, outcome: 'deleted' }),
      expect.objectContaining({ path: denied, outcome: 'failed' }),
    ]);
    expect(result.message).toMatch(/1.*1/);
    expect(JSON.stringify(result)).not.toContain('sensitive');
    expect(existsSync(good)).toBe(false);
    expect(existsSync(denied)).toBe(true);
  });

  it('force cleanup keeps the old temporary-shard and outbox exclusions', async () => {
    const { previewMaintenance, executeMaintenance } = await import('../src/application/maintenance/operations.js');
    const f = fixture();
    const fresh = f.put('tcp/inbox/fresh');
    const shard = f.put('conversations/fresh.json');
    const temporary = f.put('conversations/fresh.json.tmp');
    const queue = f.put('outbox/queue.json');
    const preview = previewMaintenance('cleanup-force', f.options);
    expect(preview.targets.map((item) => item.path)).toEqual([fresh, shard]);
    const result = executeMaintenance('cleanup-force', preview.fingerprint, f.options);
    expect(result.status).toBe('complete');
    expect(existsSync(fresh)).toBe(false);
    expect(existsSync(shard)).toBe(false);
    expect(existsSync(temporary)).toBe(true);
    expect(existsSync(queue)).toBe(true);
  });

  it('skill installation previews both existing destinations and retains the original overwrite behavior', async () => {
    const { previewMaintenance, executeMaintenance } = await import('../src/application/maintenance/operations.js');
    const f = fixture();
    const first = join(f.home, '.claude', 'skills', 'crosschat');
    mkdirSync(first, { recursive: true });
    writeFileSync(join(first, 'SKILL.md'), 'older');
    const preview = previewMaintenance('install-skills', f.options);
    expect(preview.targets.map((item) => item.path)).toEqual([first, join(f.home, '.codex', 'skills', 'crosschat')]);
    expect(readFileSync(join(first, 'SKILL.md'), 'utf8')).toBe('older');
    const result = executeMaintenance('install-skills', preview.fingerprint, f.options);
    expect(result.status).toBe('complete');
    expect(result.items.map((item) => item.outcome)).toEqual(['installed', 'installed']);
    for (const item of result.items) expect(readFileSync(join(item.path, 'SKILL.md'), 'utf8')).toBe('isolated source');
  });

  it('blocks uninstall if a named node becomes fresh after preview and never executes npm', async () => {
    const { previewMaintenance, executeMaintenance } = await import('../src/application/maintenance/operations.js');
    const f = fixture();
    f.put('tcp/node.json');
    const preview = previewMaintenance('uninstall-data', f.options);
    expect(preview.enabled).toBe(true);
    const status = f.put('tcp/status-node-work.json');
    writeFileSync(status, JSON.stringify({ state: 'online', lastUpdated: new Date(NOW).toISOString() }));
    const remove = vi.fn();
    const result = executeMaintenance('uninstall-data', preview.fingerprint, { ...f.options, effects: { remove } });
    expect(result.status).toBe('blocked');
    expect(result.npm).toBe('not-run');
    expect(result.message).toContain('serve');
    expect(remove).not.toHaveBeenCalled();
    expect(existsSync(join(f.home, '.crosschat'))).toBe(true);
  });

  it('uninstalls exactly the old data and skill scopes with distinct missing/failed outcomes and npm left installed', async () => {
    const { previewMaintenance, executeMaintenance } = await import('../src/application/maintenance/operations.js');
    const f = fixture();
    f.put('tcp/node.json');
    const legacy = join(f.home, 'crosschat');
    mkdirSync(legacy);
    const denied = join(f.home, '.claude', 'skills', 'crosschat');
    mkdirSync(denied, { recursive: true });
    const preview = previewMaintenance('uninstall-data', f.options);
    expect(preview.targets.map((item) => item.path)).toEqual([
      join(f.home, '.crosschat'), legacy, denied, join(f.home, '.codex', 'skills', 'crosschat'),
    ]);
    const result = executeMaintenance('uninstall-data', preview.fingerprint, { ...f.options, effects: { remove: (file, recursive) => {
      if (file === denied) throw new Error('denied');
      rmSync(file, { recursive, force: true });
    } } });
    expect(result.status).toBe('partial');
    expect(result.items.map((item) => item.outcome)).toEqual(['deleted', 'deleted', 'failed', 'skipped']);
    expect(result.npm).toBe('not-run');
    expect(result.message).toContain('npm uninstall -g @oatelauser/crosschat');
    expect(existsSync(denied)).toBe(true);
    expect(existsSync(f.options.sourceDir)).toBe(true);
  });
});

describe('owned maintenance worker lifecycle', () => {
  it('does not start work for an already-aborted operation', async () => {
    const { createLocalMaintenance } = await import('../src/application/maintenance/index.js');
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    const createWorker = vi.fn(() => new Worker('', { eval: true }));
    const maintenance = createLocalMaintenance({ ...f.options, createWorker });
    await expect(maintenance.preview({ operationId: 'cleanup', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('terminates blocked IO work and removes only its listeners when cancelled', async () => {
    const { createLocalMaintenance } = await import('../src/application/maintenance/index.js');
    const f = fixture();
    const worker = new Worker("require('node:worker_threads').parentPort.postMessage('ready'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);", { eval: true });
    await new Promise<void>((resolve) => worker.once('message', () => resolve()));
    const terminate = vi.spyOn(worker, 'terminate');
    const controller = new AbortController();
    const maintenance = createLocalMaintenance({ ...f.options, createWorker: () => worker });
    const pending = maintenance.preview({ operationId: 'cleanup', signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(terminate).toHaveBeenCalledOnce();
    expect(worker.threadId).toBe(-1);
    expect(worker.listenerCount('message')).toBe(0);
  });
});
