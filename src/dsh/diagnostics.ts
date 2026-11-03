import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDshRecord } from './registry.js';

/** Read-only profile facts. Installed files and a running bridge are separate evidence. */
export type DshPluginIssue = 'profiles-unreadable' | 'profile-limit' | 'profile-location'
  | 'profile-unreadable' | 'profile-invalid' | 'installation-missing' | 'package-invalid'
  | 'installation-unreadable' | 'content-differs' | 'read-limit' | 'source-unavailable' | 'timeout';

export type DshProfileDiagnostic =
  | { state: 'not-declared'; profileDir: string }
  | { state: 'ready'; profileDir: string; packageDir: string; version: string }
  | { state: 'warning'; path: string; reason: DshPluginIssue; profileDir?: string; packageDir?: string; version?: string };

export interface DshProfileDiagnosticOptions {
  home: string;
  dshHome?: string;
  /** Only directories already verified by the native bridge handshake. */
  verifiedProfileDirs?: readonly string[];
  sourceDir?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const packageName = '@crosschat/dsh-bridge';
const packagedFiles = ['package.json', 'index.js', 'bridge.js', 'cordis.patch.yml', 'icon.svg', 'locale/en.json', 'locale/zh.json'];
const readLimit = 64 * 1024;
const profileLimit = 100;
const missing = (error: unknown): boolean => isDshRecord(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR');

class ProfileReadFailure extends Error {
  constructor(readonly reason: DshPluginIssue, readonly path: string, readonly absent = false) { super(reason); }
}

/** Runs inside the existing query-owned process. Late IO retains its close handlers until that owner exits. */
export async function inspectDshProfiles(options: DshProfileDiagnosticOptions): Promise<DshProfileDiagnostic[]> {
  options.signal?.throwIfAborted();
  const dshHome = options.dshHome === undefined || options.dshHome === '' ? join(options.home, '.dsh') : options.dshHome;
  const sourceDir = options.sourceDir ?? fileURLToPath(new URL('../../integrations/dsh', import.meta.url));
  const timeoutMs = options.timeoutMs ?? 5000;
  if (![options.home, dshHome, sourceDir, ...options.verifiedProfileDirs ?? []].every(isAbsolute)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new Error('Harness profile diagnostics need absolute paths and a positive bounded deadline');
  }
  const profilesPath = join(dshHome, 'profiles');
  const controller = new AbortController();
  const deadlineAt = Date.now() + timeoutMs;
  let deadlineTriggered = false;
  const active = (): void => {
    options.signal?.throwIfAborted();
    if (deadlineTriggered || Date.now() >= deadlineAt) throw new ProfileReadFailure('timeout', profilesPath);
    controller.signal.throwIfAborted();
  };
  const forward = (): void => controller.abort(options.signal?.reason);
  const stopped = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
  });
  const timer = setTimeout(() => {
    deadlineTriggered = true;
    controller.abort(new ProfileReadFailure('timeout', profilesPath));
  }, timeoutMs);
  options.signal?.addEventListener('abort', forward, { once: true });
  if (options.signal?.aborted) forward();

  const read = async (path: string, reason: DshPluginIssue): Promise<Buffer> => {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let failed = false;
    try {
      active();
      handle = await open(path, 'r');
      active();
      const stat = await handle.stat();
      active();
      if (!stat.isFile()) throw new ProfileReadFailure(reason, path);
      if (stat.size > readLimit) throw new ProfileReadFailure('read-limit', path);
      const buffer = Buffer.alloc(readLimit + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      active();
      if (bytesRead > readLimit) throw new ProfileReadFailure('read-limit', path);
      return buffer.subarray(0, bytesRead);
    } catch (error) {
      failed = true;
      active();
      if (error instanceof ProfileReadFailure) throw error;
      throw new ProfileReadFailure(reason, path, missing(error));
    } finally {
      if (handle !== undefined) {
        try { await handle.close(); }
        catch { if (!failed) throw new ProfileReadFailure(reason, path); }
      }
    }
  };
  const json = (bytes: Buffer, path: string, reason: DshPluginIssue): Record<string, unknown> => {
    try { const value: unknown = JSON.parse(bytes.toString('utf8')); if (isDshRecord(value)) return value; }
    catch { /* Return only the fixed reason, never the source bytes. */ }
    throw new ProfileReadFailure(reason, path);
  };
  let source: Promise<Map<string, Buffer>> | undefined;
  const sourceFiles = (): Promise<Map<string, Buffer>> => source ??= (async () => {
    const files = new Map<string, Buffer>();
    for (const name of packagedFiles) files.set(name, await read(join(sourceDir, name), 'source-unavailable'));
    return files;
  })();

  const inspect = async (profileDir: string): Promise<DshProfileDiagnostic> => {
    const manifestPath = join(profileDir, 'package.json');
    let packageDir: string | undefined;
    let version: string | undefined;
    try {
      let manifest: Record<string, unknown>;
      try { manifest = json(await read(manifestPath, 'profile-unreadable'), manifestPath, 'profile-invalid'); }
      catch (error) {
        if (error instanceof ProfileReadFailure && error.absent) return { state: 'not-declared', profileDir };
        throw error;
      }
      const dependencies: Record<string, unknown> = {};
      for (const field of ['devDependencies', 'dependencies', 'optionalDependencies']) {
        if (manifest[field] === undefined) continue;
        if (!isDshRecord(manifest[field])) throw new ProfileReadFailure('profile-invalid', manifestPath);
        Object.assign(dependencies, manifest[field]);
      }
      if (!Object.hasOwn(dependencies, packageName)) return { state: 'not-declared', profileDir };
      if (typeof dependencies[packageName] !== 'string' || dependencies[packageName].trim() === '') throw new ProfileReadFailure('profile-invalid', manifestPath);
      const installedPath = join(profileDir, 'node_modules', '@crosschat', 'dsh-bridge');
      try { packageDir = await realpath(installedPath); active(); }
      catch (error) {
        active();
        throw new ProfileReadFailure(missing(error) ? 'installation-missing' : 'installation-unreadable', installedPath);
      }
      const metadataPath = join(packageDir, 'package.json');
      const metadataBytes = await read(metadataPath, 'installation-unreadable');
      const metadata = json(metadataBytes, metadataPath, 'package-invalid');
      if (metadata.name !== packageName || typeof metadata.version !== 'string' || metadata.version.length > 128
        || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.+-]+)?$/.test(metadata.version)) {
        throw new ProfileReadFailure('package-invalid', metadataPath);
      }
      version = metadata.version;
      const expected = await sourceFiles();
      for (const name of packagedFiles) {
        const actual = name === 'package.json' ? metadataBytes : await read(join(packageDir, name), 'installation-unreadable');
        if (!actual.equals(expected.get(name)!)) return { state: 'warning', path: packageDir, profileDir, packageDir, version, reason: 'content-differs' };
      }
      return { state: 'ready', profileDir, packageDir, version };
    } catch (error) {
      active();
      const failure = error instanceof ProfileReadFailure ? error : new ProfileReadFailure('installation-unreadable', profileDir);
      return { state: 'warning', path: failure.path, profileDir, reason: failure.reason,
        ...(packageDir === undefined ? {} : { packageDir }), ...(version === undefined ? {} : { version }) };
    }
  };

  const collect = async (): Promise<DshProfileDiagnostic[]> => {
    const results: DshProfileDiagnostic[] = [];
    const candidates: string[] = [];
    let directory: Awaited<ReturnType<typeof opendir>> | undefined;
    try {
      active();
      const stat = await lstat(profilesPath);
      active();
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new ProfileReadFailure('profile-location', profilesPath);
      directory = await opendir(profilesPath);
      active();
      for (let count = 0; ; count++) {
        const item = await directory.read();
        active();
        if (item === null) break;
        if (count >= profileLimit) { results.push({ state: 'warning', path: profilesPath, reason: 'profile-limit' }); break; }
        const path = join(profilesPath, item.name);
        if (item.isSymbolicLink()) results.push({ state: 'warning', path, reason: 'profile-location' });
        else if (item.isDirectory()) candidates.push(path);
      }
    } catch (error) {
      active();
      if (!missing(error)) results.push({ state: 'warning', path: profilesPath,
        reason: error instanceof ProfileReadFailure ? error.reason : 'profiles-unreadable' });
    } finally { if (directory !== undefined) await directory.close(); }
    const verified = options.verifiedProfileDirs ?? [];
    if (verified.length > profileLimit) results.push({ state: 'warning', path: profilesPath, reason: 'profile-limit' });
    candidates.push(...verified.slice(0, profileLimit));
    const seen = new Set<string>();
    for (const path of candidates) {
      active();
      let canonical: string;
      try { canonical = await realpath(path); active(); }
      catch { active(); results.push({ state: 'warning', path, reason: 'profile-location' }); continue; }
      const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(await inspect(resolve(path)));
    }
    return results;
  };

  try { return await Promise.race([collect(), stopped]); }
  catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof ProfileReadFailure && error.reason === 'timeout') return [{ state: 'warning', path: profilesPath, reason: 'timeout' }];
    throw error;
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', forward); }
}
