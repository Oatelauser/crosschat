import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTcpConfiguration } from '../src/application/tcp/configuration.js';

const cleanup: string[] = [];
afterEach(async () => { for (const directory of cleanup.splice(0)) await rm(directory, { recursive: true, force: true }); });
const first = { host: 'first.invalid', port: 7260, starId: 'first-star', key: 'PRIVATE-NODE-KEY', adminKey: 'PRIVATE-ADMIN-KEY', showName: 'per-star', keep: { entry: true } };
const second = { host: 'second.invalid', port: 7261, starId: 'second-star', key: 'OTHER-PRIVATE-KEY' };
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'crosschat-tcp-config-'));
  cleanup.push(home);
  const baseDir = join(home, '.crosschat');
  const directory = join(baseDir, 'tcp');
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'node.json');
  const original = { brokers: [first, second], showName: 'global', keep: { top: true } };
  await writeFile(file, JSON.stringify(original));
  return { home, baseDir, directory, file, original };
}

describe('TCP local connection edit and removal', () => {
  it('keeps empty brokers as a valid unconfigured document after removing the final local connection', async () => {
    const f = await fixture();
    await writeFile(f.file, JSON.stringify({ ...f.original, brokers: [first] }));
    const app = createTcpConfiguration(f);
    const target = (await app.list()).targets[0];
    const request = { operation: 'remove' as const, contextId: target.contextId, targetRevision: target.revision, values: {} };
    const preview = await app.previewChange(request);
    expect(await app.applyChange({ ...request, expectedRevision: preview.revision })).toMatchObject({ status: 'applied' });
    expect(JSON.parse(await readFile(f.file, 'utf8'))).toEqual({ ...f.original, brokers: [] });
    expect(await app.list()).toMatchObject({ targets: [], completeness: 'complete' });
    const content = JSON.stringify({ brokers: [second] });
    const add = await app.preview({ content });
    expect(add.enabled).toBe(true);
    expect(await app.apply({ content, expectedRevision: add.revision })).toMatchObject({ status: 'applied' });
  });

  it('lists only safe metadata and edits the exact entry while preserving blank secrets and unknown fields', async () => {
    const f = await fixture();
    const app = createTcpConfiguration(f);
    const listed = await app.list();
    expect(listed.targets).toHaveLength(2);
    expect(JSON.stringify(listed)).not.toContain('PRIVATE-');
    const target = listed.targets[0];
    const request = { operation: 'edit' as const, contextId: target.contextId, targetRevision: target.revision, values: { host: 'changed.invalid', port: '8022', key: '', adminKey: '' } };
    const preview = await app.previewChange(request);
    expect(preview.enabled).toBe(true);
    expect(JSON.stringify(preview)).not.toContain('PRIVATE-');
    expect(await app.applyChange({ ...request, expectedRevision: preview.revision })).toMatchObject({ status: 'applied' });
    expect(JSON.parse(await readFile(f.file, 'utf8'))).toEqual({ ...f.original, brokers: [{ ...first, host: 'changed.invalid', port: 8022 }, second] });
    expect(await readdir(f.directory)).toEqual(['node.json']);
  });

  it('removes only local configuration and shows service and broker self-registration consequences', async () => {
    const f = await fixture();
    const app = createTcpConfiguration(f);
    const target = (await app.list()).targets[0];
    const request = { operation: 'remove' as const, contextId: target.contextId, targetRevision: target.revision, values: {} };
    const preview = await app.previewChange(request);
    expect(preview.enabled).toBe(true);
    expect(preview.impact.join(' ')).toMatch(/不.*停止|仍.*运行/);
    expect(preview.impact.join(' ')).toMatch(/自登记|补建/);
    expect(await app.applyChange({ ...request, expectedRevision: preview.revision })).toMatchObject({ status: 'applied' });
    expect(JSON.parse(await readFile(f.file, 'utf8'))).toEqual({ ...f.original, brokers: [second] });
    expect(await readdir(f.directory)).toEqual(['node.json']);
  });

  it('refuses a replaced credential or changed file instead of applying a stale confirmation', async () => {
    const f = await fixture();
    const app = createTcpConfiguration(f);
    const target = (await app.list()).targets[0];
    const request = { operation: 'remove' as const, contextId: target.contextId, targetRevision: target.revision, values: {} };
    const preview = await app.previewChange(request);
    const external = { ...f.original, brokers: [{ ...first, key: 'REPLACED-PRIVATE-KEY' }, second] };
    await writeFile(f.file, JSON.stringify(external));
    expect((await app.applyChange({ ...request, expectedRevision: preview.revision })).status).not.toBe('applied');
    expect(JSON.parse(await readFile(f.file, 'utf8'))).toEqual(external);
    expect((await app.previewChange(request)).enabled).toBe(false);
  });

  it('clears admin credentials only by an explicit choice and never changes star identity', async () => {
    const f = await fixture();
    const app = createTcpConfiguration(f);
    const target = (await app.list()).targets[0];
    const request = { operation: 'edit' as const, contextId: target.contextId, targetRevision: target.revision, values: { adminKeyAction: 'remove' } };
    const preview = await app.previewChange(request);
    expect(preview.enabled).toBe(true);
    expect(await app.applyChange({ ...request, expectedRevision: preview.revision })).toMatchObject({ status: 'applied' });
    const saved = JSON.parse(await readFile(f.file, 'utf8'));
    expect(saved.brokers[0].adminKey).toBeUndefined();
    expect(saved.brokers[0].key).toBe(first.key);
    expect(saved.brokers[0].starId).toBe(first.starId);
    const fresh = (await app.list()).targets[0];
    expect((await app.previewChange({ ...request, contextId: fresh.contextId, targetRevision: fresh.revision, values: { starId: 'another-star' } })).enabled).toBe(false);
  });

  it('keeps the original bytes after replacement fails and removes private temporary data', async () => {
    const f = await fixture();
    const app = createTcpConfiguration({ ...f, renameFile: () => { throw new Error('PRIVATE-FILESYSTEM'); } });
    const target = (await app.list()).targets[0];
    const request = { operation: 'remove' as const, contextId: target.contextId, targetRevision: target.revision, values: {} };
    const preview = await app.previewChange(request);
    expect(await app.applyChange({ ...request, expectedRevision: preview.revision })).toMatchObject({ status: 'failed' });
    expect(JSON.parse(await readFile(f.file, 'utf8'))).toEqual(f.original);
    expect(await readdir(f.directory)).toEqual(['node.json']);
  });

  it('rejects invalid edits and cancellation without leaking replacement secrets or changing the file', async () => {
    const f = await fixture();
    const app = createTcpConfiguration(f);
    const target = (await app.list()).targets[0];
    for (const values of [{ host: 'bad host', key: 'SENSITIVE-REPLACEMENT' }, { port: '70000' }, { adminKeyAction: 'replace', adminKey: '' }, { adminKeyAction: 'unknown' }]) {
      const preview = await app.previewChange({ operation: 'edit', contextId: target.contextId, targetRevision: target.revision, values });
      expect(preview.enabled).toBe(false);
      expect(JSON.stringify(preview)).not.toContain('SENSITIVE-REPLACEMENT');
    }
    const request = { operation: 'edit' as const, contextId: target.contextId, targetRevision: target.revision, values: { key: 'NEW-SENSITIVE-KEY' } };
    const preview = await app.previewChange(request);
    const owner = new AbortController(); owner.abort();
    expect(await app.applyChange({ ...request, expectedRevision: preview.revision, signal: owner.signal })).toMatchObject({ status: 'cancelled' });
    expect(JSON.parse(await readFile(f.file, 'utf8'))).toEqual(f.original);
    expect(await readdir(f.directory)).toEqual(['node.json']);
  });
});
