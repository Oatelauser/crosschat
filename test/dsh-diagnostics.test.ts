import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { PathLike } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectDshProfiles } from '../src/dsh/diagnostics.js';

const io = vi.hoisted((): {
  beforeOpen?: (path: PathLike) => Promise<void>;
  opened?: (path: PathLike, handle: FileHandle) => void;
} => ({}));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    await io.beforeOpen?.(args[0]);
    const handle = await actual.open(...args);
    io.opened?.(args[0], handle);
    return handle;
  } };
});

const roots: string[] = [];
afterEach(async () => {
  io.beforeOpen = undefined; io.opened = undefined;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'crosschat-dsh-profile-')); roots.push(root);
  const home = join(root, 'home');
  const sourceDir = join(root, 'packaged-bridge');
  await mkdir(home);
  await mkdir(join(sourceDir, 'locale'), { recursive: true });
  const files = { 'package.json': JSON.stringify({ name: '@crosschat/dsh-bridge', version: '0.1.0' }),
    'index.js': 'owned plugin entry', 'bridge.js': 'owned bridge code', 'cordis.patch.yml': 'owned patch',
    'icon.svg': '<svg/>', 'locale/en.json': '{}', 'locale/zh.json': '{}' };
  for (const [file, text] of Object.entries(files)) await writeFile(join(sourceDir, file), text);
  const options = { home, sourceDir };
  const profile = async (name = 'desktop', document: unknown = { dependencies: { '@crosschat/dsh-bridge': 'file:private-spec-never-display' } }) => {
    const profileDir = join(home, '.dsh', 'profiles', name);
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, 'package.json'), JSON.stringify(document));
    const packageDir = join(profileDir, 'node_modules', '@crosschat', 'dsh-bridge');
    return { profileDir, packageDir, manifest: join(profileDir, 'package.json') };
  };
  return { root, home, sourceDir, options, profile };
}

describe('Harness profile plugin diagnostics', () => {
  it('leaves an unconfigured home empty and never creates a profile', async () => {
    const f = await fixture();
    expect(await inspectDshProfiles(f.options)).toEqual([]);
    expect(await readdir(f.home)).toEqual([]);
  });

  it.each(['dependencies', 'devDependencies', 'optionalDependencies'])('reads a declared package from %s without exposing the spec or private config', async (field) => {
    const f = await fixture();
    const p = await f.profile('desktop', { [field]: { '@crosschat/dsh-bridge': 'https://private-spec.invalid/secret' }, privateConfig: 'private-profile-config' });
    await cp(f.sourceDir, p.packageDir, { recursive: true });
    const original = await readFile(p.manifest, 'utf8');
    const result = await inspectDshProfiles(f.options);
    expect(result).toEqual([{ state: 'ready', profileDir: p.profileDir, packageDir: await realpath(p.packageDir), version: '0.1.0' }]);
    expect(await readFile(p.manifest, 'utf8')).toBe(original);
    expect(JSON.stringify(result)).not.toContain('private-');
  });

  it('retains an undeclared plugin as info even if an unrelated package directory exists', async () => {
    const f = await fixture();
    const p = await f.profile('web', { dependencies: { unrelated: '1.0.0' } });
    await mkdir(p.packageDir, { recursive: true });
    await writeFile(join(p.packageDir, 'package.json'), 'private-unrelated-bytes');
    expect(await inspectDshProfiles(f.options)).toEqual([{ state: 'not-declared', profileDir: p.profileDir }]);
    expect(await readFile(join(p.packageDir, 'package.json'), 'utf8')).toBe('private-unrelated-bytes');
  });

  it('distinguishes a saved reference from a missing installation', async () => {
    const f = await fixture(); const p = await f.profile();
    expect(await inspectDshProfiles(f.options)).toContainEqual({ state: 'warning', path: p.packageDir,
      profileDir: p.profileDir, reason: 'installation-missing' });
  });

  it('detects changed files even when package versions are identical', async () => {
    const f = await fixture(); const p = await f.profile();
    await cp(f.sourceDir, p.packageDir, { recursive: true });
    await writeFile(join(p.packageDir, 'bridge.js'), 'owned older or customized bridge bytes');
    expect(await inspectDshProfiles(f.options)).toContainEqual({ state: 'warning', path: p.packageDir,
      profileDir: p.profileDir, packageDir: await realpath(p.packageDir), version: '0.1.0', reason: 'content-differs' });
  });

  it('reads through short file chunks before deciding whether installed contents match', async () => {
    const f = await fixture(); const p = await f.profile(); await cp(f.sourceDir, p.packageDir, { recursive: true });
    await writeFile(join(f.sourceDir, 'bridge.js'), 'sameprefix-source-suffix');
    await writeFile(join(p.packageDir, 'bridge.js'), 'sameprefix-installed-different-suffix');
    io.opened = (path, handle) => { if (String(path).endsWith('bridge.js')) {
      const read = handle.read.bind(handle);
      vi.spyOn(handle, 'read').mockImplementation(async (options) => Buffer.isBuffer(options)
        ? read(options, 0, 8, 0)
        : read({ ...options, length: Math.min(options?.length ?? 8, 8) }));
    } };
    expect(await inspectDshProfiles(f.options)).toContainEqual(expect.objectContaining({ state: 'warning', reason: 'content-differs' }));
  });

  it('reports a verified profile path that is now a file instead of calling it undeclared', async () => {
    const f = await fixture(); const path = join(f.root, 'former-profile'); await writeFile(path, 'owned file');
    expect(await inspectDshProfiles({ ...f.options, verifiedProfileDirs: [path] })).toEqual([
      { state: 'warning', path, reason: 'profile-location' },
    ]);
  });

  it('uses only the selected custom Harness home for automatic profile discovery', async () => {
    const f = await fixture(); const ignored = await f.profile(); await writeFile(ignored.manifest, '{private-ignored-home');
    const dshHome = join(f.root, 'selected-harness'); const profileDir = join(dshHome, 'profiles', 'web');
    const packageDir = join(profileDir, 'node_modules', '@crosschat', 'dsh-bridge');
    await cp(f.sourceDir, packageDir, { recursive: true });
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dependencies: { '@crosschat/dsh-bridge': 'file:fixture' } }));
    expect(await inspectDshProfiles({ ...f.options, dshHome })).toEqual([
      { state: 'ready', profileDir, packageDir: await realpath(packageDir), version: '0.1.0' },
    ]);
    expect(await readFile(ignored.manifest, 'utf8')).toBe('{private-ignored-home');
  });

  it('follows an actual pnpm/file package link and deduplicates a verified native profile', async () => {
    const f = await fixture(); const p = await f.profile();
    await mkdir(join(p.packageDir, '..'), { recursive: true });
    await symlink(f.sourceDir, p.packageDir, process.platform === 'win32' ? 'junction' : 'dir');
    const result = await inspectDshProfiles({ ...f.options, verifiedProfileDirs: [p.profileDir] });
    expect(result).toEqual([{ state: 'ready', profileDir: p.profileDir, packageDir: await realpath(f.sourceDir), version: '0.1.0' }]);
  });

  it('inspects a native-attested external profile without scanning historical or project directories', async () => {
    const f = await fixture();
    const external = join(f.root, 'attested-profile');
    const packageDir = join(external, 'node_modules', '@crosschat', 'dsh-bridge');
    await cp(f.sourceDir, packageDir, { recursive: true });
    await writeFile(join(external, 'package.json'), JSON.stringify({ dependencies: { '@crosschat/dsh-bridge': 'file:fixture' } }));
    await mkdir(join(f.home, 'project', '.agents', 'skills'), { recursive: true });
    expect(await inspectDshProfiles({ ...f.options, verifiedProfileDirs: [external] })).toEqual([
      { state: 'ready', profileDir: external, packageDir: await realpath(packageDir), version: '0.1.0' },
    ]);
  });

  it('reports corrupt metadata and still inspects a separate healthy profile', async () => {
    const f = await fixture(); const bad = await f.profile('bad'); const good = await f.profile('web');
    await writeFile(bad.manifest, '{private-corrupt-configuration');
    await cp(f.sourceDir, good.packageDir, { recursive: true });
    const result = await inspectDshProfiles(f.options);
    expect(result).toContainEqual({ state: 'warning', path: bad.manifest, profileDir: bad.profileDir, reason: 'profile-invalid' });
    expect(result).toContainEqual(expect.objectContaining({ state: 'ready', profileDir: good.profileDir }));
    expect(JSON.stringify(result)).not.toContain('private-corrupt');
    expect(await readFile(bad.manifest, 'utf8')).toBe('{private-corrupt-configuration');
  });

  it('bounds each metadata read and rejects a package with the wrong identity', async () => {
    const f = await fixture(); const large = await f.profile('large'); const wrong = await f.profile('wrong');
    await writeFile(large.manifest, 'x'.repeat(64 * 1024 + 1));
    await cp(f.sourceDir, wrong.packageDir, { recursive: true });
    await writeFile(join(wrong.packageDir, 'package.json'), JSON.stringify({ name: 'unrelated', version: '0.1.0', secret: 'private-wrong-package' }));
    const result = await inspectDshProfiles(f.options);
    expect(result).toContainEqual({ state: 'warning', path: large.manifest, profileDir: large.profileDir, reason: 'read-limit' });
    expect(result).toContainEqual(expect.objectContaining({ state: 'warning', reason: 'package-invalid', profileDir: wrong.profileDir }));
    expect(JSON.stringify(result)).not.toContain('private-wrong-package');
  });

  it('refuses linked profile discovery and limits directory enumeration', async () => {
    const f = await fixture();
    const profiles = join(f.home, '.dsh', 'profiles'); await mkdir(profiles, { recursive: true });
    const outside = join(f.root, 'unattested'); await mkdir(outside);
    await symlink(outside, join(profiles, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    for (let i = 0; i < 101; i++) await mkdir(join(profiles, `p${String(i).padStart(3, '0')}`));
    const result = await inspectDshProfiles(f.options);
    expect(result).toContainEqual(expect.objectContaining({ state: 'warning', reason: 'profile-location', path: join(profiles, 'linked') }));
    expect(result).toContainEqual(expect.objectContaining({ state: 'warning', reason: 'profile-limit', path: profiles }));
    expect(result.length).toBeLessThanOrEqual(102);
    expect(await readdir(outside)).toEqual([]);
  });

  it('honors pre-cancellation before any read or write', async () => {
    const f = await fixture();
    await expect(inspectDshProfiles({ ...f.options, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
    expect(await readdir(f.home)).toEqual([]);
  });

  it.each(['timeout', 'cancel'])('owns and closes a handle that opens after %s', async (mode) => {
    const f = await fixture(); const p = await f.profile(); await cp(f.sourceDir, p.packageDir, { recursive: true });
    let entered = () => {}; let release = () => {}; let closed = false; let started = false;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const opening = new Promise<void>((resolve) => { entered = resolve; });
    const target = join(f.sourceDir, 'bridge.js');
    io.beforeOpen = async (path) => { if (String(path) === target) { started = true; entered(); await gate; } };
    io.opened = (path, handle) => { if (String(path) === target) {
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'close').mockImplementation(async () => { await close(); closed = true; });
    } };
    const controller = new AbortController();
    const pending = inspectDshProfiles({ ...f.options, timeoutMs: mode === 'timeout' ? 30 : 5000, signal: controller.signal })
      .then((result) => ({ result, error: undefined }), (error: Error) => ({ result: undefined, error }));
    try {
      expect(await Promise.race([opening.then(() => 'entered'), pending.then(() => 'settled')])).toBe('entered');
      if (mode === 'cancel') controller.abort();
      const outcome = await pending;
      if (mode === 'cancel') expect(outcome.error?.name).toBe('AbortError');
      else expect(outcome.result).toContainEqual(expect.objectContaining({ state: 'warning', reason: 'timeout' }));
    } finally { release(); await pending; if (started) await vi.waitFor(() => expect(closed).toBe(true)); }
  });
});
