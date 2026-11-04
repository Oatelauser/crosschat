import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile, link, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTcpConfiguration } from '../src/application/tcp/configuration.js';
import { listTuiContexts } from '../src/application/contexts/index.js';
import { tcpContextId } from '../src/application/tcp/reading.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const memberKey = 'a'.repeat(64);
const adminKey = 'b'.repeat(64);
const entry = { host: 'broker.example', port: 7260, starId: 'imported-star', name: 'imported', key: memberKey, adminKey, custom: { keep: 'new entry' } };
const content = JSON.stringify({ brokers: [entry], showName: 'receiver', customTop: { keep: 'import' } });
async function fixture(original?: string) {
  // The fixture itself is canonical; attack cases add their own linked paths.
  const home = await realpath(await mkdtemp(join(tmpdir(), 'crosschat-tcp-import-')));
  cleanups.push(() => rm(home, { recursive: true, force: true }));
  const baseDir = join(home, '.crosschat');
  const directory = join(baseDir, 'tcp');
  const file = join(directory, 'node.json');
  if (original !== undefined) { await mkdir(directory, { recursive: true }); await writeFile(file, original); }
  return { home, baseDir, directory, file };
}

describe('TUI existing TCP configuration import', () => {
  it('previews without writes or secret output, then creates a current-format connection without starting it', async () => {
    const f = await fixture();
    const app = createTcpConfiguration(f);
    const preview = await app.preview({ content });
    expect(preview).toMatchObject({ enabled: true, targets: [{ contextId: tcpContextId(entry), starId: entry.starId, host: entry.host, port: entry.port }] });
    expect(preview.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(preview)).not.toContain(memberKey);
    expect(JSON.stringify(preview)).not.toContain(adminKey);
    expect(await readdir(f.home)).toEqual([]);
    const result = await app.apply({ content, expectedRevision: preview.revision });
    expect(result).toMatchObject({ status: 'applied', contextId: tcpContextId(entry), targets: preview.targets });
    expect(JSON.stringify(result)).not.toContain(memberKey);
    expect(JSON.parse(await readFile(f.file, 'utf8'))).toEqual(JSON.parse(content));
    expect(await readdir(f.directory)).toEqual(['node.json']);
    expect((await listTuiContexts({ home: f.home })).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: tcpContextId(entry), kind: 'tcp' })]));
  });

  it('appends a distinct star at the same broker while preserving all existing credentials, entries and top-level fields', async () => {
    const previous = { host: entry.host, port: entry.port, starId: 'existing-star', key: 'c'.repeat(64), unknownEntry: ['retain'] };
    const original = { brokers: [previous], showName: 'existing-global', unknownTop: { preserve: [1, 2] } };
    const f = await fixture(JSON.stringify(original));
    const app = createTcpConfiguration(f);
    const preview = await app.preview({ content });
    expect(preview.enabled).toBe(true);
    expect(await app.apply({ content, expectedRevision: preview.revision })).toMatchObject({ status: 'applied' });
    expect(JSON.parse(await readFile(f.file, 'utf8'))).toEqual({ ...original, brokers: [previous, entry] });
  });

  it('rejects replacement, duplicate imported stars, unknown star identity and malformed formats without overwriting', async () => {
    const original = JSON.stringify({ brokers: [{ ...entry, key: 'c'.repeat(64) }], preserve: true });
    const f = await fixture(original);
    const app = createTcpConfiguration(f);
    const invalidContents = [content, JSON.stringify({ brokers: [entry, { ...entry, port: 7261 }] }),
      JSON.stringify({ brokers: [{ host: entry.host, port: entry.port, key: memberKey }] }),
      JSON.stringify({ broker: { host: entry.host, port: entry.port }, key: memberKey }), '{PRIVATE-BROKEN'];
    for (const invalid of invalidContents) {
      const preview = await app.preview({ content: invalid });
      expect(preview.enabled).toBe(false);
      expect(await app.apply({ content: invalid, expectedRevision: preview.revision })).toMatchObject({ status: 'blocked' });
      expect(JSON.stringify(preview)).not.toContain(memberKey);
      expect(JSON.stringify(preview)).not.toContain('PRIVATE-BROKEN');
    }
    expect(await readFile(f.file, 'utf8')).toBe(original);
    expect(await readdir(f.directory)).toEqual(['node.json']);
  });

  it('binds confirmation to original bytes and the private import content instead of overwriting a changed file', async () => {
    const original = { brokers: [{ ...entry, starId: 'existing-star' }], existing: true };
    const f = await fixture(JSON.stringify(original));
    const app = createTcpConfiguration(f);
    const preview = await app.preview({ content });
    const changed = JSON.stringify({ ...original, externalWriter: 'must survive' });
    await writeFile(f.file, changed);
    expect(await app.apply({ content, expectedRevision: preview.revision })).toMatchObject({ status: 'changed' });
    expect(await readFile(f.file, 'utf8')).toBe(changed);
    const fresh = await app.preview({ content });
    const switchedInput = JSON.stringify({ brokers: [{ ...entry, key: 'd'.repeat(64) }] });
    expect(await app.apply({ content: switchedInput, expectedRevision: fresh.revision })).toMatchObject({ status: 'changed' });
    expect(await readFile(f.file, 'utf8')).toBe(changed);
  });

  it('never repairs malformed existing metadata or accepts an oversized private input', async () => {
    const f = await fixture('{PRIVATE-EXISTING-BROKEN');
    const app = createTcpConfiguration(f);
    expect(await app.preview({ content })).toMatchObject({ enabled: false });
    expect(await app.apply({ content, expectedRevision: '' })).toMatchObject({ status: 'blocked' });
    expect(await readFile(f.file, 'utf8')).toBe('{PRIVATE-EXISTING-BROKEN');
    const empty = await fixture();
    const large = JSON.stringify({ brokers: [entry], unknown: 'x'.repeat(2 * 1024 * 1024) });
    expect(await createTcpConfiguration(empty).preview({ content: large })).toMatchObject({ enabled: false });
    expect(await readdir(empty.home)).toEqual([]);
    expect(await readdir(f.directory)).toEqual(['node.json']);
  });

  it('rejects existing hardlinks and linked parent directories without touching their other targets', async () => {
    const original = JSON.stringify({ brokers: [{ ...entry, starId: 'existing-star' }] });
    const hard = await fixture(original);
    const other = join(hard.home, 'outside.json');
    await link(hard.file, other);
    expect(await createTcpConfiguration(hard).preview({ content })).toMatchObject({ enabled: false });
    expect(await createTcpConfiguration(hard).apply({ content, expectedRevision: '' })).toMatchObject({ status: 'blocked' });
    expect(await readFile(other, 'utf8')).toBe(original);
    const linked = await fixture();
    const external = join(linked.home, 'external');
    await mkdir(external); await writeFile(join(external, 'sentinel'), 'untouched');
    await mkdir(linked.baseDir); await symlink(external, linked.directory, process.platform === 'win32' ? 'junction' : 'dir');
    expect(await createTcpConfiguration(linked).preview({ content })).toMatchObject({ enabled: false });
    expect(await createTcpConfiguration(linked).apply({ content, expectedRevision: '' })).toMatchObject({ status: 'blocked' });
    expect(await readdir(external)).toEqual(['sentinel']);
  });

  it('keeps the previous file and removes its temporary file after an atomic replacement failure', async () => {
    const original = JSON.stringify({ brokers: [{ ...entry, starId: 'existing-star' }] });
    const f = await fixture(original);
    const app = createTcpConfiguration({ ...f, renameFile: () => { throw new Error(`PRIVATE-FILESYSTEM-${memberKey}`); } });
    const preview = await app.preview({ content });
    const result = await app.apply({ content, expectedRevision: preview.revision });
    expect(result.status).toBe('failed');
    expect(JSON.stringify(result)).not.toContain(memberKey);
    expect(await readFile(f.file, 'utf8')).toBe(original);
    expect(await readdir(f.directory)).toEqual(['node.json']);
  });

  it('cancels before any directory, configuration or temporary file is created', async () => {
    const f = await fixture();
    const app = createTcpConfiguration(f);
    const preview = await app.preview({ content });
    const owner = new AbortController(); owner.abort();
    expect(await app.apply({ content, expectedRevision: preview.revision, signal: owner.signal })).toMatchObject({ status: 'cancelled', targets: [] });
    expect(await readdir(f.home)).toEqual([]);
  });
});
