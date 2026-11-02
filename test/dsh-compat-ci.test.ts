import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { admitDshDesktopInstaller, downloadDshDesktopInstaller, dshRegressionIdentity, hasDesktopCleanupProof, hasDshRuntimeReleaseProof, parseDshDesktopWindowsManifest,
  parseDshNpmManifest, parsePnpmManifest, resolveDshNpmCache, runDshBuildSequence, runDshDesktopAttempt, runDshDesktopSequence, runDshProbeAttempt, runDshProcess,
  verifyNpmArtifact } from '../scripts/dsh-compat-ci.mjs';

// The only fs injections this suite needs: metadata/open() can stall or arrive late and rm() can refuse a late cleanup.
const lstatInjection = vi.hoisted(() => ({ impl: null as null | ((...args: unknown[]) => Promise<unknown>), real: null as null | ((...args: unknown[]) => Promise<unknown>) }));
const openInjection = vi.hoisted(() => ({ impl: null as null | ((...args: unknown[]) => Promise<unknown>), real: null as null | ((...args: unknown[]) => Promise<unknown>) }));
const rmInjection = vi.hoisted(() => ({ impl: null as null | ((...args: unknown[]) => Promise<unknown>), real: null as null | ((...args: unknown[]) => Promise<unknown>) }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const realLstat = actual.lstat as unknown as (...args: unknown[]) => Promise<unknown>;
  const real = actual.open as unknown as (...args: unknown[]) => Promise<unknown>;
  const realRm = actual.rm as unknown as (...args: unknown[]) => Promise<unknown>;
  lstatInjection.real = realLstat;
  openInjection.real = real;
  rmInjection.real = realRm;
  return { ...actual,
    lstat: (...args: unknown[]) => (lstatInjection.impl ?? realLstat)(...args),
    open: (...args: unknown[]) => (openInjection.impl ?? real)(...args),
    rm: (...args: unknown[]) => (rmInjection.impl ?? realRm)(...args) };
});

// The default signature adapter is a read-only child process; tests replace spawn only for that path.
const spawnInjection = vi.hoisted(() => ({ impl: null as null | ((...args: unknown[]) => unknown), real: null as null | ((...args: unknown[]) => unknown) }));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const real = actual.spawn as unknown as (...args: unknown[]) => unknown;
  spawnInjection.real = real;
  return { ...actual, spawn: (...args: unknown[]) => (spawnInjection.impl ?? real)(...args) };
});

const integrity = `sha512-${Buffer.alloc(64, 1).toString('base64')}`;
const pnpmIntegrity = 'sha512-SEVj0wtMKtJ8tIqpT/KzAtvOvI/2vyiBbCWJiG4UbOf3bzVPO8GkOOb16XaMMCqgpvet2CMpA81M+BQmy8FNng==';
const manifest = (version = '0.2.1-rc.2') => ({ name: '@deepseek-ai/dsh', version, dist: { tarball: `https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-${version}.tgz`, integrity } });
const artifact = (version = '0.2.1-rc.2') => ({ name: '@deepseek-ai/dsh', version, url: manifest(version).dist.tarball, integrity });
const pnpm = { name: 'pnpm', version: '11.28.5', url: 'https://registry.npmjs.org/pnpm/-/pnpm-11.28.5.tgz', integrity: pnpmIntegrity };
const builds = { baseline: artifact(), candidate: artifact('0.2.2'), packageManager: pnpm };
const checks = ['official-plugin-installation-and-owned-web-runtime', 'public-web-session-controller-creates-interactive-sessions', 'messages-model-and-native-shell-identity-bootstrap',
  'authenticated-production-discovery-and-pagination', 'idle-production-delivery-wakes-the-existing-session', 'busy-native-queue-and-steer-step-boundaries',
  'native-shell-send-and-conversation-reply-have-full-session-identities', 'missing-target-does-not-create-or-resume-a-replacement'];
const scope = { officialNpmRuntime: true, officialPluginManager: true, ordinaryWebSessions: true, scriptedLocalModel: true, browserUI: false, desktop: false, modelIntelligence: false };
const cleanup = { runtimeStopped: true, registrationRemoved: true, removed: true, forced: false };
const passed = (version: string, runId = randomUUID()) => ({ schema: 1, tool: 'dsh-web-runtime', platform: 'win32', arch: 'x64', runId, version,
  status: 'passed', stage: 'done', category: null, checks: checks.map((name) => ({ name, status: 'passed', elapsedMs: 1 })), scope, cleanup,
  process: { code: 0, signal: null, timedOut: false } });
const failed = (version: string, runId = randomUUID()) => ({ ...passed(version, runId), status: 'failed', stage: 'contract', check: 'native-queue', category: 'compatibility', process: { code: 1, signal: null, timedOut: false } });

async function isolated(work: (output: string) => Promise<void>) {
  const output = await mkdtemp(join(tmpdir(), 'crosschat-dsh-ci-test-'));
  try { await work(output); } finally { await rm(output, { recursive: true, force: true }); }
}

describe('DeepSeek Harness official npm artifact constraints', () => {
  it('pins the scoped npm artifact, package manager and the supported prerelease window', async () => {
    expect(parseDshNpmManifest(manifest(), 'win32', 'x64')).toEqual(artifact());
    for (const version of ['0.2.1-rc.3', '0.2.1-rc.10', '0.2.1', '0.2.2', '0.2.99-preview.1']) expect(parseDshNpmManifest(manifest(version), 'win32', 'x64').version).toBe(version);
    for (const version of ['0.2.1-rc.1', '0.3.0-0', '0.3.0', '1.0.0']) expect(() => parseDshNpmManifest(manifest(version), 'win32', 'x64')).toThrow(expect.objectContaining({ category: 'unsupported', version }));
    expect(() => parseDshNpmManifest(manifest(), 'linux', 'x64')).toThrow();
    expect(parsePnpmManifest({ name: pnpm.name, version: pnpm.version, dist: { tarball: pnpm.url, integrity: pnpm.integrity } })).toEqual(pnpm);
    const pinned = JSON.parse(await readFile(new URL('../scripts/dsh-compat-baseline.json', import.meta.url), 'utf8'));
    expect(parseDshNpmManifest(pinned.package, 'win32', 'x64').version).toBe('0.2.1-rc.2');
    expect(parsePnpmManifest(pinned.packageManager)).toEqual(pnpm);
  });

  it('rejects unrelated or mutable sources, malformed SRI and package-manager drift', () => {
    for (const input of [{ ...manifest(), name: '@someone/dsh' }, { ...manifest(), version: 'latest' }, { ...manifest(), dist: { ...manifest().dist, tarball: 'https://example.org/dsh.tgz' } },
      { ...manifest(), dist: { ...manifest().dist, integrity: 'sha1-bad' } }]) expect(() => parseDshNpmManifest(input, 'win32', 'x64')).toThrow();
    expect(() => parsePnpmManifest({ name: 'pnpm', version: '11.28.6', dist: { tarball: pnpm.url, integrity: pnpm.integrity } })).toThrow();
    expect(() => parsePnpmManifest({ name: 'pnpm', version: pnpm.version, dist: { tarball: pnpm.url, integrity } })).toThrow();
  });

  it('verifies the exact downloaded archive bytes using canonical SHA-512 SRI', () => {
    const bytes = Buffer.from('controlled official artifact fixture');
    const exact = { ...artifact(), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` };
    expect(verifyNpmArtifact(bytes, exact)).toBe(true);
    expect(() => verifyNpmArtifact(Buffer.from('changed'), exact)).toThrow();
  });
});

describe('DeepSeek Harness isolated npm download cache', () => {
  it('uses a shared run-owned default and marks an explicit existing external cache for retention', async () => {
    await isolated(async (output) => {
      const root = join(output, 'owned-task'); const external = join(output, 'external-npm-cache');
      await mkdir(root); await mkdir(external);
      const selected = await resolveDshNpmCache(root);
      expect(selected).toEqual({ path: await realpath(join(root, 'npm-cache')), external: false });
      expect(await resolveDshNpmCache(root, external)).toEqual({ path: await realpath(external), external: true });
    });
  });

  it('rejects relative paths, URLs, network paths, files and externally labelled owned paths', async () => {
    await isolated(async (output) => {
      const root = join(output, 'owned-task'); const file = join(output, 'cache-file');
      await mkdir(root); await writeFile(file, 'not a directory');
      for (const input of ['relative-npm-cache', 'https://example.org/cache', 'file:///cache', '\\\\server\\cache', file, root, join(root, 'npm-cache')]) {
        await expect(resolveDshNpmCache(root, input)).rejects.toThrow();
      }
    });
  });

  it('rejects directory links and linked ancestors before using an external cache', async () => {
    await isolated(async (output) => {
      const root = join(output, 'owned-task'); const cache = join(output, 'actual-cache'); const link = join(output, 'cache-link');
      await mkdir(root); await mkdir(join(cache, 'nested'), { recursive: true }); await symlink(cache, link, 'junction');
      await expect(resolveDshNpmCache(root, link)).rejects.toThrow();
      await expect(resolveDshNpmCache(root, join(link, 'nested'))).rejects.toThrow();
    });
  });
});

describe('DeepSeek Harness fresh process and cleanup evidence', () => {
  it('runs only controlled child processes and reports normal and timed-out termination distinctly', async () => {
    const normal = await runDshProcess(process.execPath, ['-e', 'process.stdout.write("controlled-child")'], { timeout: 5000 });
    expect(normal).toMatchObject({ code: 0, signal: null, timedOut: false, stdout: 'controlled-child' });
    const timed = await runDshProcess(process.execPath, ['-e', 'setTimeout(()=>{},20000)'], { timeout: 150 });
    expect(timed.timedOut).toBe(true);
  });

  it('uses a unique empty report location and a caller-chosen UUID for every attempt', async () => {
    await isolated(async (output) => {
      await writeFile(join(output, 'baseline.json'), JSON.stringify(passed(builds.baseline.version)));
      const paths: string[] = [];
      const first = await runDshProbeAttempt({ output, label: 'baseline', artifact: builds.baseline }, async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
        paths.push(reportPath); await writeFile(reportPath, JSON.stringify(passed(builds.baseline.version, runId))); return { code: 0, signal: null, timedOut: false };
      });
      const second = await runDshProbeAttempt({ output, label: 'baseline', artifact: builds.baseline }, async ({ reportPath }: { reportPath: string }) => {
        paths.push(reportPath); return { code: 0, signal: null, timedOut: false };
      });
      expect(first.status).toBe('passed'); expect(paths[0]).not.toBe(paths[1]);
      expect(second).toMatchObject({ status: 'failed', category: 'infrastructure' });
      expect(second.cleanup).toBeUndefined();
    });
  });

  it('rejects wrong run IDs, incomplete PASS evidence, timeout/signal and process/report disagreement', async () => {
    await isolated(async (output) => {
      for (const invalid of [
        { process: { code: 0, signal: null, timedOut: true } }, { process: { code: 0, signal: 'SIGTERM', timedOut: false } }, { process: { code: 1, signal: null, timedOut: false } },
        { report: { runId: randomUUID() } }, { report: { checks: [] } }, { report: { scope: { ...scope, desktop: true } } }, { report: { version: '0.3.0' } },
      ]) {
        const result = await runDshProbeAttempt({ output, label: 'candidate', artifact: builds.candidate }, async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
          await writeFile(reportPath, JSON.stringify({ ...passed(builds.candidate.version, runId), ...invalid.report }));
          return invalid.process ?? { code: 0, signal: null, timedOut: false };
        });
        expect(result).toMatchObject({ status: 'failed', category: 'infrastructure' }); expect(result.cleanup).toBeUndefined();
      }
    });
  });

  it('requires all four exact cleanup booleans and refuses forced or unknown release', () => {
    expect(hasDshRuntimeReleaseProof(cleanup)).toBe(true);
    for (const value of [undefined, {}, { ...cleanup, removed: false }, { ...cleanup, forced: true }, { ...cleanup, registrationRemoved: undefined }, { ...cleanup, errors: ['unknown child'] }]) expect(hasDshRuntimeReleaseProof(value)).toBe(false);
  });
});

describe('DeepSeek Harness baseline and candidate lifecycle', () => {
  it('removes each released install before the next and retries the same pinned candidate', async () => {
    const calls: string[] = []; const candidates: unknown[] = [];
    const summary = await runDshBuildSequence(builds, {
      install: async (build: typeof builds.baseline, label: string) => { calls.push(`install:${label}`); if (label !== 'baseline') candidates.push(build); return { label, root: `owned-${label}` }; },
      probe: async (_installation: unknown, build: typeof builds.baseline, label: string) => { calls.push(`probe:${label}`); return label === 'baseline' ? passed(build.version) : failed(build.version); },
      remove: async (_installation: unknown, _build: unknown, label: string) => { calls.push(`remove:${label}`); },
    });
    expect(calls).toEqual(['install:baseline', 'probe:baseline', 'remove:baseline', 'install:candidate', 'probe:candidate', 'remove:candidate', 'install:retry', 'probe:retry', 'remove:retry']);
    expect(candidates).toEqual([builds.candidate, builds.candidate]);
    expect(summary.classification).toEqual({ kind: 'regression', notify: true });
    expect(dshRegressionIdentity(summary)?.marker).toBe('<!-- dsh-compat:0.2.2:win32:native-queue -->');
  });

  it('retains unknown runtime state and never advances or removes it', async () => {
    for (const report of [{ ...passed(builds.baseline.version), cleanup: undefined }, { ...passed(builds.baseline.version), cleanup: { ...cleanup, forced: true } },
      { ...passed(builds.baseline.version), process: { code: null, signal: null, timedOut: true } }]) {
      const calls: string[] = [];
      const summary = await runDshBuildSequence(builds, { install: async (_build: unknown, label: string) => { calls.push(label); return { root: 'owned-retained' }; }, probe: async () => report, remove: async () => { calls.push('remove'); } });
      expect(calls).toEqual(['baseline']); expect(summary.classification).toEqual({ kind: 'infrastructure', notify: false }); expect(summary.retainedInstallation).toBeDefined();
    }
  });

  it('keeps the web retainedInstallation shape unchanged when a probe fails', async () => {
    const summary = await runDshBuildSequence(builds, {
      install: async () => ({ root: 'owned-web' }),
      probe: async () => { throw new Error('Probe crashed'); },
      remove: async () => {},
    });
    expect(summary.retainedInstallation).toEqual({ label: 'baseline', version: builds.baseline.version, root: 'owned-web',
      reason: 'Owned runtime release is unknown; do not remove or start another build' });
  });

  it('does not turn installation, readiness, cleanup, baseline failure or flaky checks into issues', async () => {
    const ready = async (reports: Record<string, unknown>, remove = async () => {}) => runDshBuildSequence(builds, {
      install: async (_build: unknown, label: string) => ({ label }), probe: async (_installation: unknown, _build: unknown, label: string) => reports[label], remove,
    });
    for (const reports of [
      { baseline: passed(builds.baseline.version), candidate: { ...failed(builds.candidate.version), category: 'infrastructure', stage: 'setup', check: 'service-readiness' } },
      { baseline: failed(builds.baseline.version), candidate: failed(builds.candidate.version) },
      { baseline: passed(builds.baseline.version), candidate: failed(builds.candidate.version), retry: passed(builds.candidate.version) },
      { baseline: passed(builds.baseline.version), candidate: failed(builds.candidate.version), retry: { ...failed(builds.candidate.version), check: 'different-check' } },
    ]) expect(dshRegressionIdentity(await ready(reports))).toBeUndefined();
    const removed = await ready({ baseline: passed(builds.baseline.version) }, async () => { throw new Error('Installation cleanup refused'); });
    expect(removed.classification).toEqual({ kind: 'infrastructure', notify: false });
    const installation = await runDshBuildSequence(builds, { install: async () => { throw new Error('Network install failed'); }, probe: async () => {}, remove: async () => {} });
    expect(installation.classification).toEqual({ kind: 'infrastructure', notify: false });
  });
});

describe('DeepSeek Harness independent issue reporter', () => {
  async function report(summary: unknown, existing: unknown[] = []) {
    const workflow = await readFile(new URL('../.github/workflows/dsh-compat.yml', import.meta.url), 'utf8');
    const script = workflow.split(/ {10}script: \|\r?\n/)[1].split(/\r?\n/).map((line) => line.replace(/^ {12}/, '')).join('\n');
    const created: unknown[] = [];
    await runInNewContext(`(async()=>{${script}\n})()`, { require: (name: string) => { if (name !== 'node:fs/promises') throw new Error(`Unexpected dependency ${name}`); return { readFile: async () => JSON.stringify(summary) }; },
      context: { serverUrl: 'https://github.com', repo: { owner: 'fixture', repo: 'fixture' }, runId: 1 }, core: { notice: () => {} },
      github: { paginate: async () => existing, rest: { issues: { listForRepo: {}, create: async (value: unknown) => created.push(value) } } } });
    return { workflow, created };
  }

  it('creates only one deduplicated issue after independently verifying genuine scoped regression evidence', async () => {
    const summary = { schema: 1, tool: 'dsh-web-runtime', platform: 'win32', arch: 'x64', builds, scope, installationCleanup: 'removed',
      baseline: passed(builds.baseline.version), candidate: failed(builds.candidate.version), retry: failed(builds.candidate.version), classification: { kind: 'regression', notify: true } };
    const valid = await report(summary); expect(valid.created).toHaveLength(1);
    expect(valid.workflow.split('  report:')[1]).not.toMatch(/checkout@|run:|node scripts/);
    expect(valid.workflow.split('  report:')[0]).not.toContain('issues: write');
    expect((await report(summary, [{ body: dshRegressionIdentity(summary)?.marker }])).created).toHaveLength(0);
    for (const invalid of [
      { ...summary, candidate: { ...summary.candidate, category: 'infrastructure' } }, { ...summary, baseline: { ...summary.baseline, status: 'failed' } },
      { ...summary, candidate: { ...summary.candidate, scope: { ...scope, browserUI: true } } }, { ...summary, retry: { ...summary.retry, cleanup: { ...cleanup, forced: true } } },
      { ...summary, retry: { ...summary.retry, runId: summary.candidate.runId } }, { ...summary, installationCleanup: 'retained' },
    ]) { expect(dshRegressionIdentity(invalid)).toBeUndefined(); expect((await report(invalid)).created).toHaveLength(0); }
  });
});

describe('DeepSeek Harness formal desktop report and lifecycle', () => {
  const desktopScope = { officialDesktopArtifact: true, builtInRuntimeProfile: true, skillAndPluginLoading: true, desktopUi: true,
    ordinaryWebSessions: false, browserUI: false, modelIntelligence: false };
  const desktopChecks = ['formal-desktop-artifact-and-built-in-runtime-profile', 'skill-and-plugin-loading', 'desktop-ui-send-receive-and-reply',
    'host-natural-exit', 'official-uninstall', 'bridge-registration-and-system-registration-cleanup'];
  const desktopCleanup = { hostExited: true, uninstalled: true, registrationRemoved: true, systemRegistrationRemoved: true, forced: false };
  const owner = randomUUID();
  const launch = { instanceId: randomUUID(), sessionId: 'native-session-1' };
  const owned = { installationId: randomUUID(), owner, root: 'owned-desktop' };
  const exited = { code: 0, signal: null, timedOut: false, truncated: false };
  const desktopPassed = (version = builds.baseline.version, runId = randomUUID(), extra: Record<string, unknown> = {}) => ({ schema: 1, tool: 'dsh-desktop', platform: 'win32', arch: 'x64',
    runId, version, artifactId: integrity, installationId: owned.installationId, owner, instanceId: launch.instanceId, sessionId: launch.sessionId,
    status: 'passed', stage: 'done', category: null, checks: desktopChecks.map((name) => ({ name, status: 'passed', elapsedMs: 1 })),
    scope: desktopScope, cleanup: desktopCleanup, process: exited, ...extra });
  // A sequence-side report must carry the installation and run identity the sequence handed to the probe, plus its own native instance.
  const bound = (build: { version: string }, installation: { installationId: unknown; owner: string }, runId: string, extra: Record<string, unknown> = {}) =>
    desktopPassed(build.version, runId, { installationId: installation.installationId, owner: installation.owner, instanceId: randomUUID(), ...extra });

  it('accepts a fresh desktop report bound to this install, native instance, session and artifact', async () => {
    await isolated(async (output) => {
      const result = await runDshDesktopAttempt({ output, label: 'baseline', artifact: builds.baseline, installation: owned, launch },
        async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
          await writeFile(reportPath, JSON.stringify(desktopPassed(builds.baseline.version, runId))); return exited;
        });
      expect(result).toMatchObject({ status: 'passed', stage: 'done', category: null });
      expect(result.process).toEqual(exited);
      expect(hasDesktopCleanupProof(result.cleanup)).toBe(true);
    });
  });

  it('binds the report to the caller launch instead of the report claim', async () => {
    await isolated(async (output) => {
      for (const foreign of [{ instanceId: randomUUID() }, { sessionId: 'native-session-2' }]) {
        const result = await runDshDesktopAttempt({ output, label: 'candidate', artifact: builds.candidate, installation: owned, launch },
          async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
            await writeFile(reportPath, JSON.stringify(desktopPassed(builds.candidate.version, runId, foreign))); return exited;
          });
        expect(result).toMatchObject({ status: 'failed', category: 'infrastructure' });
      }
      // Without a caller launch record a report could vouch for itself, so the attempt refuses to start.
      await expect(runDshDesktopAttempt({ output, label: 'baseline', artifact: builds.baseline, installation: owned }, async () => exited)).rejects.toThrow();
    });
  });

  it('rejects web, stale, foreign and incomplete desktop evidence', async () => {
    await isolated(async (output) => {
      const incomplete = (name: string) => desktopChecks.filter((item) => item !== name).map((item) => ({ name: item, status: 'passed', elapsedMs: 1 }));
      for (const invalid of [
        { tool: 'dsh-web-runtime' }, { scope: { ...scope, desktop: true } }, { scope: { ...desktopScope, desktopUi: false } },
        { runId: randomUUID() }, { installationId: randomUUID() }, { owner: randomUUID() }, { version: '0.3.0' },
        { artifactId: `sha512-${Buffer.alloc(64, 2).toString('base64')}` }, { instanceId: 'not-a-uuid' }, { sessionId: '' },
        { checks: [] }, { checks: incomplete('desktop-ui-send-receive-and-reply') }, { checks: incomplete('official-uninstall') },
        { checks: [...desktopChecks, desktopChecks[0]].map((name) => ({ name, status: 'passed', elapsedMs: 1 })) }, { stage: 'contract' },
        { cleanup: undefined },
      ]) {
        const result = await runDshDesktopAttempt({ output, label: 'candidate', artifact: builds.candidate, installation: owned, launch },
          async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
            await writeFile(reportPath, JSON.stringify(desktopPassed(builds.candidate.version, runId, invalid))); return exited;
          });
        // A report without the desktop UI or official-uninstall evidence can never PASS.
        expect(result).toMatchObject({ status: 'failed', category: 'infrastructure', stage: 'desktop-report' });
        expect(result.cleanup).toBeUndefined();
      }
    });
  });

  it('ignores reports outside the exclusive attempt location and never reuses an earlier report', async () => {
    await isolated(async (output) => {
      await writeFile(join(output, 'report.json'), JSON.stringify(desktopPassed()));
      const ignored = await runDshDesktopAttempt({ output, label: 'baseline', artifact: builds.baseline, installation: owned, launch },
        async () => exited);
      expect(ignored).toMatchObject({ status: 'failed', category: 'infrastructure' });

      const truncated = await runDshDesktopAttempt({ output, label: 'baseline', artifact: builds.baseline, installation: owned, launch },
        async ({ reportPath }: { reportPath: string }) => {
          await writeFile(reportPath, '{"schema":1,"tool":"dsh-desktop"'); return exited;
        });
      expect(truncated).toMatchObject({ status: 'failed', category: 'infrastructure' });

      const paths: string[] = []; let first: unknown;
      const accepted = await runDshDesktopAttempt({ output, label: 'candidate', artifact: builds.candidate, installation: owned, launch },
        async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
          paths.push(reportPath); first = desktopPassed(builds.candidate.version, runId);
          await writeFile(reportPath, JSON.stringify(first)); return exited;
        });
      const reused = await runDshDesktopAttempt({ output, label: 'candidate', artifact: builds.candidate, installation: owned, launch },
        async ({ reportPath }: { reportPath: string }) => {
          paths.push(reportPath); await writeFile(reportPath, JSON.stringify(first)); return exited;
        });
      expect(accepted.status).toBe('passed'); expect(paths[0]).not.toBe(paths[1]);
      expect(reused).toMatchObject({ status: 'failed', category: 'infrastructure' }); expect(reused.cleanup).toBeUndefined();
    });
  });

  it('rejects a well formed report above the read budget and keeps release unknown', async () => {
    await isolated(async (output) => {
      const result = await runDshDesktopAttempt({ output, label: 'baseline', artifact: builds.baseline, installation: owned, launch },
        async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
          await writeFile(reportPath, JSON.stringify(desktopPassed(builds.baseline.version, runId, { padding: 'x'.repeat(2 * 1024 * 1024) })));
          return exited;
        });
      expect(result).toMatchObject({ status: 'failed', category: 'infrastructure' }); expect(result.cleanup).toBeUndefined();
    });
  });

  it('never binds two missing artifact identities', async () => {
    await isolated(async (output) => {
      const write = (omit: boolean) => async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
        const report: Record<string, unknown> = { ...desktopPassed(builds.baseline.version, runId) };
        if (omit) delete report.artifactId;
        await writeFile(reportPath, JSON.stringify(report)); return exited;
      };
      // A caller record without a real version and SRI is not a binding at all.
      await expect(runDshDesktopAttempt({ output, label: 'baseline', artifact: { version: builds.baseline.version }, installation: owned, launch }, write(true))).rejects.toThrow();
      const result = await runDshDesktopAttempt({ output, label: 'baseline', artifact: builds.baseline, installation: owned, launch }, write(true));
      expect(result).toMatchObject({ status: 'failed', category: 'infrastructure' }); expect(result.cleanup).toBeUndefined();
    });
  });

  it('keeps release unknown when the session times out, is killed, truncates output or disagrees', async () => {
    await isolated(async (output) => {
      for (const process of [{ code: null, signal: null, timedOut: true, truncated: false }, { code: 0, signal: 'SIGKILL', timedOut: false, truncated: false },
        { code: 0, signal: null, timedOut: false, truncated: true }, { code: 0, signal: null, timedOut: false }, { code: 1, signal: null, timedOut: false, truncated: false }]) {
        const result = await runDshDesktopAttempt({ output, label: 'baseline', artifact: builds.baseline, installation: owned, launch },
          async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
            await writeFile(reportPath, JSON.stringify(desktopPassed(builds.baseline.version, runId))); return process;
          });
        expect(result).toMatchObject({ status: 'failed', category: 'infrastructure' }); expect(result.cleanup).toBeUndefined();
      }
      const crashed = await runDshDesktopAttempt({ output, label: 'baseline', artifact: builds.baseline, installation: owned, launch },
        async () => { throw new Error('desktop driver crashed'); });
      expect(crashed).toMatchObject({ status: 'failed', category: 'infrastructure' }); expect(crashed.cleanup).toBeUndefined();
    });
  });

  it('requires the Host exit, official uninstall and both registration cleanups for desktop release', () => {
    expect(hasDesktopCleanupProof(desktopCleanup)).toBe(true);
    for (const value of [undefined, {}, { ...desktopCleanup, hostExited: false }, { ...desktopCleanup, uninstalled: false },
      { ...desktopCleanup, registrationRemoved: false }, { ...desktopCleanup, systemRegistrationRemoved: false }, { ...desktopCleanup, forced: true },
      { ...desktopCleanup, errors: ['bridge still registered'] }]) expect(hasDesktopCleanupProof(value)).toBe(false);
  });

  it('installs the candidate only after a released baseline bound to this run', async () => {
    const calls: string[] = [];
    const summary = await runDshDesktopSequence(builds, {
      install: async (_build: unknown, label: string) => { calls.push(`install:${label}`); return { ...owned, installationId: randomUUID(), root: `owned-${label}` }; },
      probe: async (installation: { installationId: string; owner: string }, build: typeof builds.baseline, label: string, context?: { runId: string }) => {
        calls.push(`probe:${label}`); return bound(build, installation, context?.runId ?? randomUUID());
      },
      remove: async (_installation: unknown, _build: unknown, label: string) => { calls.push(`remove:${label}`); },
    });
    expect(calls).toEqual(['install:baseline', 'probe:baseline', 'remove:baseline', 'install:candidate', 'probe:candidate', 'remove:candidate']);
    expect(summary).toMatchObject({ tool: 'dsh-desktop', installationCleanup: 'removed', classification: { kind: 'compatible' } });
    expect(summary.scope).toEqual(desktopScope);

    // A same-version report left under this install is stale: the sequence must hand the run identity to the attempt it uses.
    const stale: string[] = [];
    const ignored = await runDshDesktopSequence(builds, {
      install: async (_build: unknown, label: string) => { stale.push(`install:${label}`); return { ...owned, installationId: randomUUID() }; },
      probe: async (installation: { installationId: string; owner: string }, build: typeof builds.baseline, label: string) => {
        stale.push(`probe:${label}`); return bound(build, installation, randomUUID());
      },
      remove: async () => { stale.push('remove'); },
    });
    expect(stale).toEqual(['install:baseline', 'probe:baseline']);
    expect(ignored.retainedInstallation).toBeDefined();
    expect(ignored.classification).toEqual({ kind: 'infrastructure', notify: false });
  });

  it('refuses to reuse an installation identity across attempts', async () => {
    const shared = randomUUID(); const calls: string[] = [];
    const summary = await runDshDesktopSequence(builds, {
      install: async (_build: unknown, label: string) => { calls.push(`install:${label}`); return { ...owned, installationId: shared, root: `owned-${label}` }; },
      probe: async (installation: { installationId: string; owner: string }, build: typeof builds.baseline, label: string, context?: { runId: string }) => {
        calls.push(`probe:${label}`); return bound(build, installation, context?.runId ?? randomUUID());
      },
      remove: async (_installation: unknown, _build: unknown, label: string) => { calls.push(`remove:${label}`); },
    });
    expect(calls).toEqual(['install:baseline', 'probe:baseline', 'remove:baseline', 'install:candidate', 'probe:candidate']);
    expect(summary.retainedInstallation).toMatchObject({ label: 'candidate' });
    expect(summary.classification).toEqual({ kind: 'infrastructure', notify: false });
  });

  it('keeps the desktop summary out of the web reporter', async () => {
    const summary = await runDshDesktopSequence(builds, {
      install: async () => ({ ...owned, installationId: randomUUID() }),
      probe: async (installation: { installationId: string; owner: string }, build: typeof builds.baseline, _label: string, context?: { runId: string }) => build.version === builds.baseline.version
        ? bound(build, installation, context?.runId ?? randomUUID())
        : { ...bound(build, installation, context?.runId ?? randomUUID()), status: 'failed', stage: 'contract', check: 'native-queue', category: 'compatibility', process: { code: 1, signal: null, timedOut: false, truncated: false } },
      remove: async () => {},
    });
    expect(summary.classification).toEqual({ kind: 'regression', notify: true });
    expect(dshRegressionIdentity(summary)).toBeUndefined();
  });

  it('retains the first desktop installation and stops when release is unverified', async () => {
    for (const extra of [{ cleanup: { ...desktopCleanup, systemRegistrationRemoved: false } }, { cleanup: { ...desktopCleanup, forced: true } },
      { cleanup: undefined }, { process: { code: null, signal: null, timedOut: true, truncated: false } }]) {
      const calls: string[] = [];
      const summary = await runDshDesktopSequence(builds, {
        install: async (_build: unknown, label: string) => { calls.push(label); return { ...owned, installationId: randomUUID(), root: 'owned-retained' }; },
        probe: async (installation: { installationId: string; owner: string }, build: typeof builds.baseline, _label: string, context?: { runId: string }) =>
          bound(build, installation, context?.runId ?? randomUUID(), extra),
        remove: async () => { calls.push('remove'); },
      });
      expect(calls).toEqual(['baseline']); expect(summary.retainedInstallation).toBeDefined();
      expect(summary.classification).toEqual({ kind: 'infrastructure', notify: false });
    }
  });

  it('never closes blindly after a thrown desktop operation and keeps ownership when the close fails', async () => {
    const crashed: string[] = [];
    const crashedSummary = await runDshDesktopSequence(builds, {
      install: async (_build: unknown, label: string) => { crashed.push(label); return { ...owned, installationId: randomUUID() }; },
      probe: async () => { throw new Error('desktop driver crashed'); },
      remove: async () => { crashed.push('remove'); },
    });
    expect(crashed).toEqual(['baseline']); expect(crashedSummary.retainedInstallation).toBeDefined();

    const refused: string[] = [];
    const refusedSummary = await runDshDesktopSequence(builds, {
      install: async (_build: unknown, label: string) => { refused.push(`install:${label}`); return { ...owned, installationId: randomUUID() }; },
      probe: async (installation: { installationId: string; owner: string }, build: typeof builds.baseline, label: string, context?: { runId: string }) => {
        refused.push(`probe:${label}`); return bound(build, installation, context?.runId ?? randomUUID());
      },
      remove: async (_installation: unknown, _build: unknown, label: string) => { refused.push(`remove:${label}`); throw new Error('Official uninstall refused'); },
    });
    expect(refused).toEqual(['install:baseline', 'probe:baseline', 'remove:baseline']);
    expect(refusedSummary.retainedInstallation).toMatchObject({ label: 'baseline' });
    expect(refusedSummary.classification).toEqual({ kind: 'infrastructure', notify: false });

    const failed = await runDshDesktopSequence(builds, { install: async () => { throw new Error('Desktop install failed'); }, probe: async () => undefined, remove: async () => {} });
    expect(failed.classification).toEqual({ kind: 'infrastructure', notify: false });
    expect(failed.retainedInstallation).toBeUndefined();
  });

  it('keeps the owned root of a partially created installation that throws', async () => {
    await isolated(async (output) => {
      const root = join(output, 'owned-partial'); await mkdir(root); await writeFile(join(root, '.fixture-owner'), 'marker');
      const partial = { root, installationId: randomUUID(), owner: randomUUID() }; const calls: string[] = [];
      const summary = await runDshDesktopSequence(builds, {
        install: async () => { calls.push('install'); throw Object.assign(new Error('Installer exited 1'), { installation: partial }); },
        probe: async () => { calls.push('probe'); },
        remove: async () => { calls.push('remove'); },
      });
      expect(calls).toEqual(['install']);
      expect(summary.retainedInstallation).toMatchObject({ label: 'baseline', root, installationId: partial.installationId, owner: partial.owner, reason: 'Installer exited 1' });
      expect(summary.classification).toEqual({ kind: 'infrastructure', notify: false });
      expect(existsSync(join(root, '.fixture-owner'))).toBe(true);
    });
  });

  it('keeps the web entry closed to desktop reports and the desktop entry closed to web reports', async () => {
    const webCalls: string[] = [];
    const web = await runDshBuildSequence(builds, {
      install: async (_build: unknown, label: string) => { webCalls.push(label); return { root: 'owned' }; },
      probe: async () => desktopPassed(), remove: async () => { webCalls.push('remove'); },
    });
    expect(webCalls).toEqual(['baseline']); expect(web.retainedInstallation).toBeDefined();

    const desktopCalls: string[] = [];
    const desktop = await runDshDesktopSequence(builds, {
      install: async (_build: unknown, label: string) => { desktopCalls.push(label); return { ...owned, installationId: randomUUID() }; },
      probe: async (_installation: unknown, build: typeof builds.baseline) => passed(build.version), remove: async () => { desktopCalls.push('remove'); },
    });
    expect(desktopCalls).toEqual(['baseline']); expect(desktop.retainedInstallation).toBeDefined();
  });

  it('rejects array UUID identities and never lets equal arrays bypass instance dedup', async () => {
    // An installationId that only stringifies to a UUID is not a UUID string; the first attempt must already stop.
    const installCalls: string[] = [];
    const arrayInstall = await runDshDesktopSequence(builds, {
      install: async (_build: unknown, label: string) => { installCalls.push(`install:${label}`); return { installationId: [randomUUID()], owner, root: `owned-${label}` }; },
      probe: async (installation: { installationId: unknown; owner: string }, build: typeof builds.baseline, label: string, context?: { runId: string }) => {
        installCalls.push(`probe:${label}`); return bound(build, installation, context?.runId ?? randomUUID());
      },
      remove: async (_installation: unknown, _build: unknown, label: string) => { installCalls.push(`remove:${label}`); },
    });
    expect(installCalls).toEqual(['install:baseline', 'probe:baseline']);
    expect(arrayInstall.retainedInstallation).toMatchObject({ label: 'baseline' });
    expect(arrayInstall.classification).toEqual({ kind: 'infrastructure', notify: false });

    // Two separately created arrays carrying the same UUID are not one instance either.
    const shared = randomUUID(); const instanceCalls: string[] = [];
    const arrayInstance = await runDshDesktopSequence(builds, {
      install: async (_build: unknown, label: string) => { instanceCalls.push(`install:${label}`); return { ...owned, installationId: randomUUID(), root: `owned-${label}` }; },
      probe: async (installation: { installationId: unknown; owner: string }, build: typeof builds.baseline, label: string, context?: { runId: string }) => {
        instanceCalls.push(`probe:${label}`); return bound(build, installation, context?.runId ?? randomUUID(), { instanceId: [shared] });
      },
      remove: async (_installation: unknown, _build: unknown, label: string) => { instanceCalls.push(`remove:${label}`); },
    });
    expect(instanceCalls).toEqual(['install:baseline', 'probe:baseline']);
    expect(arrayInstance.retainedInstallation).toMatchObject({ label: 'baseline' });
    expect(arrayInstance.classification).toEqual({ kind: 'infrastructure', notify: false });

    // Equal string instances stay rejected exactly as before.
    const stringShared = randomUUID(); const stringCalls: string[] = [];
    const stringInstance = await runDshDesktopSequence(builds, {
      install: async (_build: unknown, label: string) => { stringCalls.push(`install:${label}`); return { ...owned, installationId: randomUUID(), root: `owned-${label}` }; },
      probe: async (installation: { installationId: unknown; owner: string }, build: typeof builds.baseline, label: string, context?: { runId: string }) => {
        stringCalls.push(`probe:${label}`); return bound(build, installation, context?.runId ?? randomUUID(), { instanceId: stringShared });
      },
      remove: async (_installation: unknown, _build: unknown, label: string) => { stringCalls.push(`remove:${label}`); },
    });
    expect(stringCalls).toEqual(['install:baseline', 'probe:baseline', 'remove:baseline', 'install:candidate', 'probe:candidate']);
    expect(stringInstance.retainedInstallation).toMatchObject({ label: 'candidate' });
  });

  it('retains the full ownership after a normal install when release is unknown', async () => {
    await isolated(async (output) => {
      const root = join(output, 'owned-unknown'); await mkdir(root); await writeFile(join(root, '.fixture-owner'), 'marker');
      const installation = { installationId: randomUUID(), owner, root }; const calls: string[] = [];
      const summary = await runDshDesktopSequence(builds, {
        install: async () => { calls.push('install'); return installation; },
        probe: async (_installation: unknown, build: typeof builds.baseline, _label: string, context?: { runId: string }) => {
          calls.push('probe'); return bound(build, installation, context?.runId ?? randomUUID(), { cleanup: undefined });
        },
        remove: async () => { calls.push('remove'); },
      });
      expect(calls).toEqual(['install', 'probe']);
      expect(summary.retainedInstallation).toMatchObject({ label: 'baseline', version: builds.baseline.version, root, installationId: installation.installationId, owner });
      expect(typeof summary.retainedInstallation?.reason).toBe('string');
      expect(existsSync(join(root, '.fixture-owner'))).toBe(true);
      expect(summary.classification).toEqual({ kind: 'infrastructure', notify: false });
    });
  });

  it('retains the full ownership with the real reason when the desktop probe throws', async () => {
    await isolated(async (output) => {
      const root = join(output, 'owned-crashed'); await mkdir(root); await writeFile(join(root, '.fixture-owner'), 'marker');
      const installation = { installationId: randomUUID(), owner, root }; const calls: string[] = [];
      const summary = await runDshDesktopSequence(builds, {
        install: async () => { calls.push('install'); return installation; },
        probe: async () => { calls.push('probe'); throw new Error('desktop driver crashed mid-session'); },
        remove: async () => { calls.push('remove'); },
      });
      expect(calls).toEqual(['install', 'probe']);
      expect(summary.retainedInstallation).toMatchObject({ label: 'baseline', version: builds.baseline.version, root,
        installationId: installation.installationId, owner, reason: 'desktop driver crashed mid-session' });
      expect(existsSync(join(root, '.fixture-owner'))).toBe(true);
      expect(summary.classification).toEqual({ kind: 'infrastructure', notify: false });
    });
  });

  it('retains the full ownership when the official close fails', async () => {
    await isolated(async (output) => {
      const root = join(output, 'owned-refused'); await mkdir(root); await writeFile(join(root, '.fixture-owner'), 'marker');
      const installation = { installationId: randomUUID(), owner, root }; const calls: string[] = [];
      const summary = await runDshDesktopSequence(builds, {
        install: async () => { calls.push('install'); return installation; },
        probe: async (_installation: unknown, build: typeof builds.baseline, _label: string, context?: { runId: string }) => {
          calls.push('probe'); return bound(build, installation, context?.runId ?? randomUUID());
        },
        remove: async () => { calls.push('remove'); throw new Error('Official uninstall refused'); },
      });
      expect(calls).toEqual(['install', 'probe', 'remove']);
      expect(summary.retainedInstallation).toMatchObject({ label: 'baseline', version: builds.baseline.version, root,
        installationId: installation.installationId, owner, reason: 'Official uninstall refused' });
      expect(summary.classification).toEqual({ kind: 'infrastructure', notify: false });
    });
  });

  it('keeps String(value) as the real reason when the probe throws a falsy value', async () => {
    await isolated(async (output) => {
      const reject = async (value: unknown): Promise<never> => { throw value; };
      // A captured exception is a captured exception: throwing undefined is not "no exception".
      for (const [index, thrown] of [undefined, 0, false, '', null].entries()) {
        const root = join(output, `owned-falsy-${index}`); await mkdir(root); await writeFile(join(root, '.fixture-owner'), 'marker');
        const installation = { installationId: randomUUID(), owner, root }; const calls: string[] = [];
        const summary = await runDshDesktopSequence(builds, {
          install: async () => { calls.push('install'); return installation; },
          probe: async () => { calls.push('probe'); return reject(thrown); },
          remove: async () => { calls.push('remove'); },
        });
        expect(calls).toEqual(['install', 'probe']);
        expect(summary.retainedInstallation).toMatchObject({ label: 'baseline', version: builds.baseline.version, root,
          installationId: installation.installationId, owner, reason: String(thrown) });
        expect(summary.error).toBe(String(thrown));
        expect(existsSync(join(root, '.fixture-owner'))).toBe(true);
        expect(summary.classification).toEqual({ kind: 'infrastructure', notify: false });
      }
      // A close that throws a falsy value keeps String(value) as its reason too.
      const root = join(output, 'owned-falsy-close'); await mkdir(root); await writeFile(join(root, '.fixture-owner'), 'marker');
      const installation = { installationId: randomUUID(), owner, root }; const calls: string[] = [];
      const closed = await runDshDesktopSequence(builds, {
        install: async () => { calls.push('install'); return installation; },
        probe: async (_installation: unknown, build: typeof builds.baseline, _label: string, context?: { runId: string }) => {
          calls.push('probe'); return bound(build, installation, context?.runId ?? randomUUID());
        },
        remove: async () => { calls.push('remove'); return reject(0); },
      });
      expect(calls).toEqual(['install', 'probe', 'remove']);
      expect(closed.retainedInstallation).toMatchObject({ label: 'baseline', root, installationId: installation.installationId, owner, reason: '0' });
      expect(closed.error).toBe('0');
    });
  });
});

describe('DeepSeek Harness official Windows desktop installer metadata and streaming verification', () => {
  const installerBytes = Buffer.from('controlled official desktop installer fixture');
  const installerSha512 = createHash('sha512').update(installerBytes).digest('base64');
  const installerUrl = 'https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.1-rc.2-win-x64.exe';
  const installerName = 'deepseek-harness-0.2.1-rc.2-win-x64.exe';
  const desktopWindows = (overrides: Record<string, unknown> = {}) => ({ feed: 'https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml',
    version: '0.2.1-rc.2', url: installerUrl, size: installerBytes.length, sha512: installerSha512, ...overrides });
  const projected = () => parseDshDesktopWindowsManifest(desktopWindows(), 'win32', 'x64');
  const response = (body: unknown, status = 200, headers: Record<string, string> = {}) => ({ ok: status >= 200 && status < 300, status, body,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null } });
  const stream = (chunks: Buffer[], onCanceled: () => void = () => {}) => new ReadableStream<Uint8Array>({
    start(controller) { for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk)); controller.close(); }, cancel: onCanceled,
  });
  const stalled = (onCanceled: () => void) => new ReadableStream<Uint8Array>({ cancel: onCanceled });
  const download = (fetchImpl: (url: string, init: { redirect?: string; signal?: AbortSignal }) => Promise<unknown>, options: Record<string, unknown> = {}) =>
    downloadDshDesktopInstaller(projected(), { fetchImpl, timeoutMs: 5000, ...options });
  const bounded = <T,>(operation: Promise<T>, ms = 800): Promise<T> => {
    operation.catch(() => {});
    return Promise.race([operation, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('bounded-guard tripped')), ms))]);
  };
  // A gated open: the product's own open resolves only after the caller releases it. The fixture owns every
  // started open (real handle plus swap) and settle() releases the gate, waits for it, restores the real
  // close and awaits it, so a late handle is actually closed before the test removes its root.
  const lateOpen = (swap: (handle: Record<string, unknown>) => void | Promise<void>) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started: Promise<void>[] = [];
    const opened: { handle: Record<string, unknown>; close: () => Promise<unknown> }[] = [];
    openInjection.impl = (...args: unknown[]) => {
      const completion = (async () => {
        await gate;
        const handle = await openInjection.real!(...args) as Record<string, unknown>;
        opened.push({ handle, close: handle.close as () => Promise<unknown> });
        await swap(handle);
        return handle;
      })();
      started.push(completion.then(() => {}, () => {}));
      return completion;
    };
    return {
      release,
      handles: () => opened.length,
      arrived: async () => { await Promise.allSettled(started.slice()); return opened.at(-1)?.handle; },
      settle: async () => {
        release();
        await Promise.allSettled(started.splice(0));
        for (const { handle, close } of opened.splice(0)) {
          handle.close = close;
          await close.call(handle).catch(() => {});
        }
      },
    };
  };
  const notesOf = (failure: unknown) => (Array.isArray((failure as { undecidedResources?: unknown }).undecidedResources)
    ? (failure as { undecidedResources: unknown[] }).undecidedResources : []).join('; ');
  const fileHandleProto = async (output: string) => {
    const probe = await open(join(output, 'handle-probe'), 'w');
    const proto = Object.getPrototypeOf(probe) as Record<string, (...args: unknown[]) => Promise<unknown>>;
    await probe.close();
    return proto;
  };

  it('projects the pinned research metadata and refuses masquerading or inexact desktop sources', async () => {
    const pinned = JSON.parse(await readFile(new URL('../scripts/dsh-compat-baseline.json', import.meta.url), 'utf8'));
    expect(parseDshDesktopWindowsManifest(pinned.desktopWindows, 'win32', 'x64')).toEqual({ version: '0.2.1-rc.2', url: installerUrl, size: 289385456,
      integrity: 'sha512-39POl5osl9PKMqrPXQA52dh/bCV0Z02vOV9cTjOJDHE6gsJwp5bv7lfgB3mVWAKspX7a/w1iTi+8Listdhq45g==', filename: installerName });
    expect(projected()).toEqual({ version: '0.2.1-rc.2', url: installerUrl, size: installerBytes.length, integrity: `sha512-${installerSha512}`, filename: installerName });
    const newer = desktopWindows({ version: '0.2.2', url: 'https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.2-win-x64.exe' });
    expect(parseDshDesktopWindowsManifest(newer, 'win32', 'x64').version).toBe('0.2.2');
    for (const version of ['0.2.1-rc.1', '0.3.0-0']) expect(() => parseDshDesktopWindowsManifest(desktopWindows({ version }), 'win32', 'x64')).toThrow(expect.objectContaining({ category: 'unsupported' }));
    expect(() => parseDshDesktopWindowsManifest(desktopWindows(), 'linux', 'x64')).toThrow();
    expect(() => parseDshDesktopWindowsManifest(desktopWindows(), 'win32', 'arm64')).toThrow();
    for (const override of [
      { version: 'latest' }, { version: 0.21 }, { version: '0.2' },
      { url: 'https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-latest-win-x64.exe' },
      { url: `${installerUrl}?from=nightly` }, { url: `${installerUrl}#signature` },
      { url: 'https://token@download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.1-rc.2-win-x64.exe' },
      { url: 'http://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.1-rc.2-win-x64.exe' },
      { url: 'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.1-rc.2.tgz' },
      { url: 'https://download.deepseek.com/dsh-desk/bin/mac-arm64/deepseek-harness-0.2.1-rc.2-mac-arm64.dmg' },
      { url: 'https://download.deepseek.com/other/deepseek-harness-0.2.1-rc.2-win-x64.exe' },
      { url: 'https://download.deepseek.com:8443/dsh-desk/bin/win-x64/deepseek-harness-0.2.1-rc.2-win-x64.exe' },
      { url: 'https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.1-rc.2-win-x64.exe.txt' },
      { url: 'https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.1-rc.2-win-x64.exe.zip' },
      { url: 'https://download.deepseek.com/dsh-desk/bin/win-x64/nightly/deepseek-harness-0.2.1-rc.2-win-x64.exe' },
      { url: 'https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.1-rc.22-win-x64.exe' },
      { sha512: [installerSha512] }, { feed: ['https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml'] }, { url: [installerUrl] },
      { feed: 'http://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml' }, { feed: 'https://example.org/dsh-desk/feeds/win-x64/nightly.yml' },
      { size: 0 }, { size: -1 }, { size: 1.5 }, { size: '36' }, { size: 512 * 1024 * 1024 + 1 },
      { sha512: 'not-base64!!!' }, { sha512: 'short' }, { sha512: `sha512-${installerSha512}` },
    ]) expect(() => parseDshDesktopWindowsManifest(desktopWindows(override), 'win32', 'x64')).toThrow();
    // The web package stays a web package however it is wrapped.
    expect(() => parseDshDesktopWindowsManifest(pinned.package, 'win32', 'x64')).toThrow();
    expect(() => parseDshDesktopWindowsManifest(artifact(), 'win32', 'x64')).toThrow();
  });

  it('streams the exact pinned bytes into the exclusive directory and proves only the transfer', async () => {
    await isolated(async (output) => {
      const target = join(output, 'owned-desktop-download'); await mkdir(target);
      const requests: { url: string; redirect?: string }[] = [];
      const fetchImpl = async (url: string, init: { redirect?: string } = {}) => {
        requests.push({ url, redirect: init.redirect });
        return response(stream([installerBytes.subarray(0, 10), installerBytes.subarray(10)]), 200, { 'content-length': String(installerBytes.length) });
      };
      const result = await download(fetchImpl, { directory: target });
      expect(result).toEqual({ path: join(target, installerName), filename: installerName, version: '0.2.1-rc.2',
        size: installerBytes.length, integrity: `sha512-${installerSha512}` });
      expect(await readFile(result.path)).toEqual(installerBytes);
      expect(requests).toEqual([{ url: installerUrl, redirect: 'error' }]);
      // A missing Content-Length is acceptable; the pinned size and digest still decide.
      const implied = join(output, 'owned-without-length'); await mkdir(implied);
      await download(async () => response(stream([installerBytes])), { directory: implied });
      expect(await readFile(join(implied, installerName))).toEqual(installerBytes);
    });
  });

  it('rejects redirect, error and missing-body responses and size or digest disagreements without keeping partials', async () => {
    await isolated(async (output) => {
      const target = join(output, 'owned-desktop-download'); await mkdir(target);
      const attempt = (body: unknown, status = 200, headers: Record<string, string> = {}) => download(async () => response(body, status, headers), { directory: target });
      // Rejections before the first read still own the response body and cancel it.
      let lengthCanceled = false;
      await expect(attempt(stream([installerBytes], () => { lengthCanceled = true; }), 200, { 'content-length': '35' })).rejects.toThrow();
      expect(lengthCanceled).toBe(true);
      let statusCanceled = false;
      await expect(attempt(stream([installerBytes], () => { statusCanceled = true; }), 404)).rejects.toThrow();
      expect(statusCanceled).toBe(true);
      await expect(attempt(stream([installerBytes]), 200, { 'content-length': '+36' })).rejects.toThrow();
      await expect(attempt(stream([installerBytes]), 200, { 'content-length': '0x24' })).rejects.toThrow();
      await expect(attempt(stream([Buffer.concat([installerBytes, Buffer.from('!')])]))).rejects.toThrow();
      await expect(attempt(stream([installerBytes.subarray(0, 20)]))).rejects.toThrow();
      await expect(attempt(stream([Buffer.alloc(installerBytes.length, 7)]))).rejects.toThrow();
      await expect(attempt(stream([installerBytes]), 302)).rejects.toThrow();
      await expect(attempt(stream([installerBytes]), 500)).rejects.toThrow();
      await expect(attempt(null)).rejects.toThrow();
      // Deleting the partials proves the write handles were released; Windows keeps open files undeletable.
      expect(readdirSync(target)).toEqual([]);
    });
  });

  it('enforces the total deadline over headers and body and honors external cancellation', async () => {
    await isolated(async (output) => {
      const target = join(output, 'owned-desktop-download'); await mkdir(target);
      // Headers that never arrive still hit the deadline.
      await expect(download(() => new Promise(() => {}) as Promise<unknown>, { directory: target, timeoutMs: 60 })).rejects.toThrow();
      // A stalled body releases the reader and removes the partial file when the deadline fires.
      let stalledCanceled = false;
      await expect(download(async () => response(stalled(() => { stalledCanceled = true; })), { directory: target, timeoutMs: 60 })).rejects.toThrow();
      expect(stalledCanceled).toBe(true);
      // Caller cancellation mid-body never yields an installable path either.
      let cancelled = false; const caller = new AbortController();
      const partial = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(installerBytes.subarray(0, 10))); }, cancel: () => { cancelled = true; } });
      const attempt = download(async () => response(partial), { directory: target, signal: caller.signal });
      await new Promise((resolve) => setTimeout(resolve, 30));
      caller.abort(new Error('caller cancelled the desktop download'));
      await expect(attempt).rejects.toThrow();
      expect(cancelled).toBe(true);
      expect(readdirSync(target)).toEqual([]);
      // A stalled disk write cannot outlive the deadline either.
      const proto = await fileHandleProto(output);
      const realWrite = proto.write; const stalledHandles: unknown[] = [];
      proto.write = function () { stalledHandles.push(this); return new Promise(() => {}); };
      try {
        await expect(bounded(download(async () => response(stream([installerBytes])), { directory: target, timeoutMs: 60 }))).rejects.toThrow(/exceeded its 60ms deadline/);
      } finally {
        proto.write = realWrite;
        for (const item of stalledHandles) await (item as Record<string, () => Promise<unknown>>).close().catch(() => {});
      }
      expect(readdirSync(target)).toEqual([]);
      // A cancel that never settles still returns bounded within the finite shared cleanup budget; whatever the
      // leftover budget does to the partial, a retained file is always reported with its path.
      const neverCancelled = new ReadableStream<Uint8Array>({ cancel: () => new Promise(() => {}) });
      const stalledCancel: unknown = await bounded(download(async () => response(neverCancelled), { directory: target, timeoutMs: 60 })).catch((error: unknown) => error);
      expect(stalledCancel).toBeInstanceOf(Error);
      const stalledCancelFailure = stalledCancel as Error & { partialFile?: unknown; cleanupError?: unknown; cleanupNotes?: unknown; releaseUnclear?: unknown };
      const notes = [...(Array.isArray(stalledCancelFailure.cleanupNotes) ? stalledCancelFailure.cleanupNotes as unknown[] : []),
        ...(Array.isArray(stalledCancelFailure.releaseUnclear) ? stalledCancelFailure.releaseUnclear as unknown[] : [])].join('; ');
      expect(notes).toContain('the response body cancel did not settle');
      if (existsSync(join(target, installerName))) expect(stalledCancelFailure.partialFile).toBe(join(target, installerName));
      await rm(join(target, installerName), { force: true }).catch(() => {});
    });
  });

  it('rejects short and zero-progress disk writes instead of trusting the stream digest', async () => {
    await isolated(async (output) => {
      const target = join(output, 'owned-desktop-download'); await mkdir(target);
      const proto = await fileHandleProto(output);
      const realWrite = proto.write;
      try {
        // A real one-byte write against a full-chunk claim: the transferred digest alone must not certify the file.
        proto.write = function (buffer: unknown) { return realWrite.call(this, (buffer as Uint8Array).subarray(0, 1)); };
        await expect(download(async () => response(stream([installerBytes])), { directory: target })).rejects.toThrow(/did not accept the full chunk/);
        proto.write = async function () { return { bytesWritten: 0 }; };
        await expect(download(async () => response(stream([installerBytes])), { directory: target })).rejects.toThrow(/did not accept the full chunk/);
        expect(readdirSync(target)).toEqual([]);
      } finally { proto.write = realWrite; }
    });
  });

  it('voids delivery when cancellation or the total deadline lands during the close', async () => {
    await isolated(async (output) => {
      const target = join(output, 'owned-desktop-download'); await mkdir(target);
      // FileHandle.close is an own bound property, so a full-write patch swaps it per captured instance.
      const proto = await fileHandleProto(output);
      const realWrite = proto.write;
      const owned: { handle: Record<string, unknown>; close: unknown }[] = [];
      const swapClose = (make: (original: () => Promise<unknown>) => () => Promise<unknown>) => {
        proto.write = function (this: unknown, buffer: unknown) {
          const handle = this as Record<string, unknown>;
          const original = handle.close as () => Promise<unknown>;
          handle.close = make(original);
          owned.push({ handle, close: original });
          return realWrite.call(this, buffer);
        };
      };
      const release = async () => {
        for (const item of owned) { item.handle.close = item.close; await (item.close as () => Promise<unknown>)().catch(() => {}); }
      };
      try {
        // Cancellation while the only close is still pending voids the delivery and retains the partial.
        swapClose(() => () => new Promise(() => {}));
        const caller = new AbortController();
        const cancelled = download(async () => response(stream([installerBytes])), { directory: target, signal: caller.signal, timeoutMs: 5000 });
        await new Promise((resolve) => setTimeout(resolve, 30));
        caller.abort(new Error('cancelled during close'));
        const cancelledFailure: unknown = await bounded(cancelled).catch((error: unknown) => error);
        expect(cancelledFailure).toMatchObject({ message: 'cancelled during close', partialFile: join(target, installerName) });
        expect(Array.isArray((cancelledFailure as { releaseUnclear?: unknown }).releaseUnclear)).toBe(true);
        await release(); owned.length = 0;
        await rm(join(target, installerName));

        // A close finishing after the total deadline is not a success even though it does finish.
        swapClose((original) => () => new Promise((resolve) => setTimeout(resolve, 50)).then(() => original()));
        await expect(bounded(download(async () => {
          await new Promise((resolve) => setTimeout(resolve, 80));
          return response(stream([installerBytes]));
        }, { directory: target, timeoutMs: 100 }))).rejects.toThrow(/exceeded its 100ms deadline/);
        expect(existsSync(join(target, installerName))).toBe(true);
        await release(); owned.length = 0;
        await rm(join(target, installerName));
      } finally {
        proto.write = realWrite;
        await release();
        await rm(join(target, installerName), { force: true }).catch(() => {});
      }
    });
  });

  it('wraps frozen and falsy close failures with the retained path and the original cause', async () => {
    await isolated(async (output) => {
      const target = join(output, 'owned-desktop-download'); await mkdir(target);
      const proto = await fileHandleProto(output);
      const realWrite = proto.write;
      const owned: { handle: Record<string, unknown>; close: unknown }[] = [];
      const swapClose = (replacement: () => Promise<unknown>) => {
        proto.write = function (this: unknown, buffer: unknown) {
          const handle = this as Record<string, unknown>;
          owned.push({ handle, close: handle.close });
          handle.close = replacement;
          return realWrite.call(this, buffer);
        };
      };
      const release = async () => {
        for (const item of owned) { item.handle.close = item.close; await (item.close as () => Promise<unknown>)().catch(() => {}); }
      };
      try {
        // A frozen close failure cannot carry fields itself, so the report wraps it and keeps the cause.
        const frozen = Object.freeze(new Error('frozen close failure'));
        swapClose(() => Promise.reject(frozen));
        const frozenFailure: unknown = await bounded(download(async () => response(stream([installerBytes])), { directory: target, timeoutMs: 60 })).catch((error: unknown) => error);
        const wrapped = frozenFailure as Error & { cause?: unknown; partialFile?: unknown; releaseUnclear?: unknown };
        expect(wrapped).toBeInstanceOf(Error);
        expect(wrapped.cause).toBe(frozen);
        expect(wrapped.partialFile).toBe(join(target, installerName));
        expect(Array.isArray(wrapped.releaseUnclear)).toBe(true);
        expect(existsSync(join(target, installerName))).toBe(true);
        await release(); owned.length = 0;
        await rm(join(target, installerName));

        // A falsy close rejection keeps its value as the cause of the same writable report.
        swapClose(() => Promise.reject(0));
        const falsyFailure: unknown = await bounded(download(async () => response(stream([installerBytes])), { directory: target, timeoutMs: 60 })).catch((error: unknown) => error);
        const falsyWrapped = falsyFailure as Error & { cause?: unknown; partialFile?: unknown };
        expect(falsyWrapped.cause).toBe(0);
        expect(falsyWrapped.partialFile).toBe(join(target, installerName));
        await release(); owned.length = 0;
        await rm(join(target, installerName));
      } finally {
        proto.write = realWrite;
        await release();
        await rm(join(target, installerName), { force: true }).catch(() => {});
      }
    });
  });

  it('keeps late responses and late handles owned after the deadline', async () => {
    await isolated(async (output) => {
      const target = join(output, 'owned-desktop-download'); await mkdir(target);
      // A response that only arrives after the deadline still has its body cancelled.
      let lateCanceled = false;
      const lateBody = new ReadableStream<Uint8Array>({ cancel: () => { lateCanceled = true; } });
      await expect(bounded(download(async () => new Promise((resolve) => setTimeout(() => resolve(response(lateBody)), 120)), { directory: target, timeoutMs: 20 }))).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(lateCanceled).toBe(true);
      expect(readdirSync(target)).toEqual([]);
      // A handle that only opens after the deadline is closed and removed by its owner, never resumed into success.
      openInjection.impl = async (...args: unknown[]) => {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return openInjection.real!(...args);
      };
      try {
        await expect(bounded(download(async () => response(stream([installerBytes])), { directory: target, timeoutMs: 20 }))).rejects.toThrow();
        await new Promise((resolve) => setTimeout(resolve, 250));
        expect(readdirSync(target)).toEqual([]);
      } finally { openInjection.impl = null; }
    });
  });

  it('keeps the cause and the retained path when a falsy read failure meets an unclear release', async () => {
    await isolated(async (output) => {
      const target = join(output, 'owned-desktop-download'); await mkdir(target);
      const proto = await fileHandleProto(output);
      const realWrite = proto.write;
      const owned: { handle: Record<string, unknown>; close: unknown }[] = [];
      proto.write = function (this: unknown, buffer: unknown) {
        const handle = this as Record<string, unknown>;
        owned.push({ handle, close: handle.close });
        handle.close = () => new Promise(() => {});
        return realWrite.call(this, buffer);
      };
      const release = async () => {
        for (const item of owned) { item.handle.close = item.close; await (item.close as () => Promise<unknown>)().catch(() => {}); }
      };
      try {
        // The chunk is delivered before the error so the write (and the close swap) actually happens.
        const failing = new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(new Uint8Array(installerBytes.subarray(0, 10))); },
          async pull(controller) { await new Promise((resolve) => setTimeout(resolve, 10)); controller.error(0); },
        });
        const failure: unknown = await bounded(download(async () => response(failing), { directory: target, timeoutMs: 80 })).catch((error: unknown) => error);
        const wrapped = failure as Error & { cause?: unknown; partialFile?: unknown; releaseUnclear?: unknown };
        expect(wrapped).toBeInstanceOf(Error);
        expect(wrapped.cause).toBe(0);
        expect(wrapped.partialFile).toBe(join(target, installerName));
        expect(Array.isArray(wrapped.releaseUnclear)).toBe(true);
        expect(existsSync(join(target, installerName))).toBe(true);
      } finally {
        proto.write = realWrite;
        await release();
        await rm(join(target, installerName), { force: true }).catch(() => {});
      }
    });
  });

  it('refuses delivery when cancellation or the total deadline lands during cleanup', async () => {
    await isolated(async (output) => {
      const target = join(output, 'owned-desktop-download'); await mkdir(target);
      const gatedBody = (onStarted: () => void) => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const pending = [new Uint8Array(installerBytes)];
        // A consumed real stream makes cancel a no-op, so the body is a fake reader that delivers every byte, then gates.
        const body = { getReader: () => ({
          read: async () => (pending.length > 0 ? { done: false, value: pending.shift() } : { done: true, value: undefined }),
          cancel: () => { onStarted(); return gate; },
          releaseLock: () => {},
        }) };
        return { body, release };
      };
      // Caller cancellation while the owned body cancel is still gated voids the already recorded delivery.
      let cancelStartedA!: () => void;
      const startedA = new Promise<void>((resolve) => { cancelStartedA = resolve; });
      const first = gatedBody(() => { cancelStartedA(); });
      const caller = new AbortController();
      const cancelled = download(async () => response(first.body), { directory: target, signal: caller.signal, timeoutMs: 4000 });
      cancelled.catch(() => {});
      await startedA;
      caller.abort(new Error('cancelled during cleanup'));
      first.release();
      const cancelledFailure: unknown = await bounded(cancelled).catch((error: unknown) => error);
      expect(cancelledFailure).toMatchObject({ message: 'Desktop installer deadline or cancellation preceded delivery' });
      expect(readdirSync(target)).toEqual([]);
      // A cleanup that crosses the total deadline is not a success; the undeliverable closed file is reported.
      let cancelStartedB!: () => void;
      const startedB = new Promise<void>((resolve) => { cancelStartedB = resolve; });
      const second = gatedBody(() => { cancelStartedB(); });
      const overdue = download(async () => response(second.body), { directory: target, timeoutMs: 80 });
      overdue.catch(() => {});
      await startedB;
      await new Promise((resolve) => setTimeout(resolve, 120));
      second.release();
      const overdueFailure: unknown = await bounded(overdue).catch((error: unknown) => error);
      expect(overdueFailure).toMatchObject({ message: 'Desktop installer deadline or cancellation preceded delivery' });
      const overdueFields = overdueFailure as Error & { partialFile?: unknown; cleanupError?: unknown };
      expect(overdueFields.partialFile).toBe(join(target, installerName));
      expect(typeof overdueFields.cleanupError).toBe('string');
      expect(existsSync(join(target, installerName))).toBe(true);
    });
  });

  it('reports a late file close failure with the path and keeps the file owned', async () => {
    await isolated(async (output) => {
      const target = join(output, 'owned-desktop-download'); await mkdir(target);
      const retained = join(target, installerName);
      const late = lateOpen((handle) => { handle.close = () => Promise.reject(new Error('late close refused')); });
      try {
        const attempt = download(async () => response(stream([installerBytes])), { directory: target, timeoutMs: 1000 });
        attempt.catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 1100));
        late.release();
        // The handle is registered and its refused close is under way before the product stops waiting.
        await late.arrived();
        const failure: unknown = await bounded(attempt, 3000).catch((error: unknown) => error);
        expect(failure).toMatchObject({ message: 'Desktop installer exceeded its 1000ms deadline' });
        expect((failure as { partialFile?: unknown }).partialFile).toBe(retained);
        expect(notesOf(failure)).toContain('a late file close failed: late close refused');
        expect(existsSync(retained)).toBe(true);
      } finally {
        await late.settle();
        openInjection.impl = null;
        await rm(retained, { force: true }).catch(() => {});
      }
    });
  });

  it('reports a late file close that never settles as undecided at return', async () => {
    await isolated(async (output) => {
      const target = join(output, 'owned-desktop-download'); await mkdir(target);
      const retained = join(target, installerName);
      const late = lateOpen((handle) => { handle.close = () => new Promise(() => {}); });
      try {
        const attempt = download(async () => response(stream([installerBytes])), { directory: target, timeoutMs: 1000 });
        attempt.catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 1100));
        late.release();
        await late.arrived();
        const failure: unknown = await bounded(attempt, 4000).catch((error: unknown) => error);
        expect(failure).toMatchObject({ message: 'Desktop installer exceeded its 1000ms deadline' });
        expect((failure as { partialFile?: unknown }).partialFile).toBe(retained);
        expect(notesOf(failure)).toContain('had not settled at return');
        expect(existsSync(retained)).toBe(true);
      } finally {
        await late.settle();
        openInjection.impl = null;
        await rm(retained, { force: true }).catch(() => {});
      }
    });
  });

  it('reports a late partial removal failure with the path and keeps the file owned', async () => {
    await isolated(async (output) => {
      const target = join(output, 'owned-desktop-download'); await mkdir(target);
      const retained = join(target, installerName);
      const late = lateOpen(() => {});
      rmInjection.impl = async () => { throw new Error('late removal refused'); };
      try {
        const attempt = download(async () => response(stream([installerBytes])), { directory: target, timeoutMs: 200 });
        attempt.catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 250));
        late.release();
        await late.arrived();
        const failure: unknown = await bounded(attempt, 3000).catch((error: unknown) => error);
        expect(failure).toMatchObject({ message: 'Desktop installer exceeded its 200ms deadline' });
        expect((failure as { partialFile?: unknown }).partialFile).toBe(retained);
        expect(notesOf(failure)).toContain('the late partial removal failed');
        expect(existsSync(retained)).toBe(true);
      } finally {
        await late.settle();
        openInjection.impl = null;
        rmInjection.impl = null;
        await rm(retained, { force: true }).catch(() => {});
      }
    });
  });

  it('removes a late-created file exactly once and never deletes a replacement', async () => {
    await isolated(async (output) => {
      const target = join(output, 'owned-desktop-download'); await mkdir(target);
      const retained = join(target, installerName);
      let rmCalls = 0;
      rmInjection.impl = async (...args: unknown[]) => {
        rmCalls += 1;
        const removed = await rmInjection.real!(...args);
        // Another attempt may create the same path right after this call's own file is gone.
        await writeFile(retained, 'replacement bytes');
        return removed;
      };
      const late = lateOpen(() => {});
      try {
        const attempt = download(async () => response(stream([installerBytes])), { directory: target, timeoutMs: 200 });
        attempt.catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 250));
        late.release();
        await late.arrived();
        const failure: unknown = await bounded(attempt, 3000).catch((error: unknown) => error);
        expect(failure).toMatchObject({ message: 'Desktop installer exceeded its 200ms deadline' });
        expect((failure as { partialFile?: unknown }).partialFile).toBeUndefined();
        expect(rmCalls).toBe(1);
        expect(await readFile(retained, 'utf8')).toBe('replacement bytes');
      } finally {
        await late.settle();
        openInjection.impl = null;
        rmInjection.impl = null;
        await rm(retained, { force: true }).catch(() => {});
      }
    });
  });

  it('does not report a partial path after a successful late close and removal', async () => {
    await isolated(async (output) => {
      const target = join(output, 'owned-desktop-download'); await mkdir(target);
      const retained = join(target, installerName);
      let rmCalls = 0;
      rmInjection.impl = async (...args: unknown[]) => { rmCalls += 1; return rmInjection.real!(...args); };
      const late = lateOpen(() => {});
      try {
        const attempt = download(async () => response(stream([installerBytes])), { directory: target, timeoutMs: 200 });
        attempt.catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 250));
        late.release();
        await late.arrived();
        const failure: unknown = await bounded(attempt, 3000).catch((error: unknown) => error);
        expect(failure).toMatchObject({ message: 'Desktop installer exceeded its 200ms deadline' });
        expect((failure as { partialFile?: unknown }).partialFile).toBeUndefined();
        expect((failure as { cleanupError?: unknown }).cleanupError).toBeUndefined();
        expect(rmCalls).toBe(1);
        expect(existsSync(retained)).toBe(false);
      } finally {
        await late.settle();
        openInjection.impl = null;
        rmInjection.impl = null;
        await rm(retained, { force: true }).catch(() => {});
      }
    });
  });

  it('closes a real late handle that arrives after the product returned even when its close was replaced', async () => {
    await isolated(async (output) => {
      const target = join(output, 'owned-desktop-download'); await mkdir(target);
      const retained = join(target, installerName);
      const late = lateOpen((handle) => { handle.close = () => new Promise(() => {}); });
      let handle: Record<string, unknown> | undefined;
      try {
        const attempt = download(async () => response(stream([installerBytes])), { directory: target, timeoutMs: 50 });
        const failure: unknown = await bounded(attempt, 3000).catch((error: unknown) => error);
        expect(failure).toMatchObject({ message: 'Desktop installer exceeded its 50ms deadline' });
        // The product returned before its open callback registered any handle.
        expect(late.handles()).toBe(0);
        late.release();
        handle = await late.arrived();
        expect(handle).toBeDefined();
        await expect((handle as { stat: () => Promise<unknown> }).stat()).resolves.toBeDefined();
      } finally {
        await late.settle();
        openInjection.impl = null;
        await rm(retained, { force: true }).catch(() => {});
      }
      // Only the fixture's own restore-and-close can make the real handle unusable.
      await expect((handle as { stat: () => Promise<unknown> }).stat()).rejects.toMatchObject({ code: 'EBADF' });
    });
  });

  it('reports a late response whose cancel is still undecided when cleanup returns', async () => {
    await isolated(async (output) => {
      const target = join(output, 'owned-desktop-download'); await mkdir(target);
      let cancelStarted = false;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const lateBody = new ReadableStream<Uint8Array>({ cancel: () => { cancelStarted = true; return gate; } });
      try {
        const failure: unknown = await download(async () => new Promise((resolve) => setTimeout(() => resolve(response(lateBody)), 150)), { directory: target, timeoutMs: 100 }).catch((error: unknown) => error);
        expect(failure).toMatchObject({ message: 'Desktop installer exceeded its 100ms deadline' });
        expect(cancelStarted).toBe(true);
        expect(notesOf(failure)).toContain('cancel had not settled at return');
        expect(lateBody.locked).toBe(true);
      } finally {
        // The gate is released even when a return-time assertion fails; cleanup never depends on the happy path.
        release();
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(lateBody.locked).toBe(false);
      expect(readdirSync(target)).toEqual([]);
    });
  });

  it('cancels a late response, releases its lock and reports it as undecided at return', async () => {
    await isolated(async (output) => {
      const target = join(output, 'owned-desktop-download'); await mkdir(target);
      let lateCanceled = false;
      const lateBody = new ReadableStream<Uint8Array>({ cancel: () => { lateCanceled = true; } });
      const failure: unknown = await download(async () => new Promise((resolve) => setTimeout(() => resolve(response(lateBody)), 150)), { directory: target, timeoutMs: 30 }).catch((error: unknown) => error);
      expect(notesOf(failure)).toContain('the official response had not settled at return');
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(lateCanceled).toBe(true);
      expect(lateBody.locked).toBe(false);
      expect(readdirSync(target)).toEqual([]);
    });
  });

  it('keeps falsy and frozen stream failures as real failures and still cleans the owned partial', async () => {
    await isolated(async (output) => {
      const target = join(output, 'owned-desktop-download'); await mkdir(target);
      const failing = (thrown: unknown) => new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(installerBytes.subarray(0, 10))); controller.error(thrown); },
      });
      // A falsy rejection is still a failure; the partial this call created is still cleaned.
      for (const thrown of [null, undefined, 0, false, '']) {
        const failure: unknown = await download(async () => response(failing(thrown)), { directory: target }).catch((error: unknown) => error);
        expect(failure).toBe(thrown);
        expect(readdirSync(target)).toEqual([]);
      }
      // A frozen Error keeps its identity; no annotation TypeError may replace it.
      const frozen = Object.freeze(new Error('frozen stream failure'));
      const frozenFailure: unknown = await download(async () => response(failing(frozen)), { directory: target }).catch((error: unknown) => error);
      expect(frozenFailure).toBe(frozen);
      expect(readdirSync(target)).toEqual([]);
    });
  });

  it('never overwrites an existing file and re-checks the projection before any network call', async () => {
    await isolated(async (output) => {
      const target = join(output, 'owned-desktop-download'); await mkdir(target);
      const existing = join(target, installerName); await writeFile(existing, 'original bytes');
      let existingCanceled = false;
      await expect(download(async () => response(stream([installerBytes], () => { existingCanceled = true; })), { directory: target })).rejects.toThrow();
      expect(await readFile(existing, 'utf8')).toBe('original bytes');
      expect(existingCanceled).toBe(true);
      const requests: string[] = [];
      const fetchImpl = async (url: string) => { requests.push(url); return response(stream([installerBytes])); };
      for (const invalid of [artifact(), desktopWindows({ url: 'https://example.org/deepseek-harness-0.2.1-rc.2-win-x64.exe' }), desktopWindows({ size: 0 })]) {
        await expect(downloadDshDesktopInstaller(invalid, { directory: target, fetchImpl, timeoutMs: 5000 })).rejects.toThrow();
      }
      await expect(downloadDshDesktopInstaller(projected(), { directory: 'relative-desktop-dir', fetchImpl, timeoutMs: 5000 })).rejects.toThrow();
      expect(requests).toEqual([]);
    });
  });
});

describe('DeepSeek Harness desktop installer admission', () => {
  const bytes = Buffer.from('controlled desktop installer admission fixture');
  const digest = createHash('sha512').update(bytes).digest('base64');
  const url = 'https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.1-rc.2-win-x64.exe';
  const filename = 'deepseek-harness-0.2.1-rc.2-win-x64.exe';
  const artifact = (overrides: Record<string, unknown> = {}) => ({ version: '0.2.1-rc.2', url, size: bytes.length,
    integrity: `sha512-${digest}`, filename, ...overrides });
  const subject = 'CN=DeepSeek, O=DeepSeek, C=CN';
  const thumbprint = 'A'.repeat(40);
  const policy = { publisher: { subject, thumbprint } };
  const signature = { status: 'Valid', subject, thumbprint };
  const writeInstaller = async (output: string, content = bytes) => { const path = join(output, filename); await writeFile(path, content); return path; };
  const call = (path: string, extra: Record<string, unknown> = {}) => admitDshDesktopInstaller({ path, artifact: artifact(), policy,
    readSignature: async () => signature, timeoutMs: 5000, ...extra });
  const waitFor = async (check: () => boolean, budgetMs = 1500) => {
    const started = Date.now();
    while (!check() && Date.now() - started < budgetMs) await new Promise((resolve) => setTimeout(resolve, 10));
    return check();
  };
  type AdmissionOutcome = {
    stage?: string; message?: string; lateOpen?: { closed: boolean }; unresolvedResources?: string[]; releaseUnclear?: string[];
    cleanupError?: string; cleanupCause?: { message?: string }; cause?: unknown; originalError?: unknown;
  };

  type FakeStream = EventEmitter & { destroy?: () => void };
  type FakeChild = EventEmitter & { stdout: FakeStream; stderr: FakeStream; kill: () => boolean | void; unref?: () => void };
  // A controlled read-only child: no PowerShell, no user certificate, no real signature environment.
  const fakeSpawn = (options: { stdout?: string; stderr?: string; code?: number | null; signal?: string | null; hang?: boolean; error?: Error;
    killEffect?: boolean; killError?: Error; noClose?: boolean; lateClose?: number }) => {
    const calls: { command: string; args: string[]; options: Record<string, unknown> }[] = [];
    const state = { destroy: 0, unref: 0, kill: 0, child: null as FakeChild | null };
    spawnInjection.impl = (...args: unknown[]) => {
      calls.push({ command: String(args[0]), args: args[1] as string[], options: args[2] as Record<string, unknown> });
      const child = new EventEmitter() as FakeChild;
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.stdout.destroy = () => { state.destroy += 1; };
      child.stderr.destroy = () => { state.destroy += 1; };
      child.unref = () => { state.unref += 1; };
      let closed = false;
      const close = (code: number | null, signalName: string | null) => { if (closed) return; closed = true; child.emit('close', code, signalName); };
      child.kill = () => {
        state.kill += 1;
        if (options.killEffect === false) { if (options.killError) child.emit('error', options.killError); return false; }
        close(null, 'SIGTERM');
        return true;
      };
      queueMicrotask(() => {
        if (options.error) { child.emit('error', options.error); return; }
        if (options.stdout) child.stdout.emit('data', Buffer.from(options.stdout));
        if (options.stderr) child.stderr.emit('data', Buffer.from(options.stderr));
        if (options.noClose) return;
        if (options.lateClose !== undefined) { setTimeout(() => close(options.code ?? 0, options.signal ?? null), options.lateClose); return; }
        if (!options.hang) close(options.code ?? 0, options.signal ?? null);
      });
      state.child = child;
      return child;
    };
    return { calls, state };
  };

  it('admits the exact verified file and matching publisher without writing an installation', async () => {
    await isolated(async (output) => {
      const path = await writeInstaller(output);
      const before = readdirSync(output);
      const result = await call(path);
      expect(result).toMatchObject({ path, version: '0.2.1-rc.2', size: bytes.length, integrity: `sha512-${digest}`, filename, publisher: signature });
      expect(Object.keys(result).sort()).toEqual(['filename', 'integrity', 'path', 'publisher', 'size', 'version']);
      expect(readdirSync(output)).toEqual(before);
    });
  });

  it('rejects a missing or malformed publisher policy before any file read or child process', async () => {
    await isolated(async (output) => {
      const missing = join(output, 'missing-installer.exe');
      const reader = vi.fn(async () => signature);
      await expect(admitDshDesktopInstaller({ path: missing, artifact: artifact(), readSignature: reader })).rejects.toMatchObject({ stage: 'policy' });
      expect(reader).not.toHaveBeenCalled();
      for (const invalid of [null, {}, { publisher: null }, { publisher: {} }, { publisher: { subject, thumbprint: 'A'.repeat(39) } },
        { publisher: { subject, thumbprint: 'G'.repeat(40) } }, { publisher: { subject: '', thumbprint } }, { publisher: { subject: 1, thumbprint } },
        { publisher: { subject: 'x'.repeat(513), thumbprint } }]) {
        await expect(admitDshDesktopInstaller({ path: missing, artifact: artifact(), policy: invalid as never, readSignature: reader })).rejects.toMatchObject({ stage: 'policy' });
      }
      expect(reader).not.toHaveBeenCalled();
      const { calls } = fakeSpawn({ stdout: JSON.stringify(signature) });
      try {
        await expect(admitDshDesktopInstaller({ path: missing, artifact: artifact(), readSignature: undefined })).rejects.toMatchObject({ stage: 'policy' });
      } finally { spawnInjection.impl = null; }
      expect(calls).toEqual([]);
    });
  });

  it('rejects inexact artifact identities and file size or digest disagreements', async () => {
    await isolated(async (output) => {
      const missing = join(output, 'missing-installer.exe');
      for (const invalid of [{ ...artifact(), url: 'https://example.org/deepseek-harness-0.2.1-rc.2-win-x64.exe' }, { ...artifact(), version: '0.2.1-rc.1' },
        { ...artifact(), filename: 'deepseek-harness-latest-win-x64.exe' }, { ...artifact(), size: 0 }, { ...artifact(), integrity: 'sha1-bad' }]) {
        await expect(admitDshDesktopInstaller({ path: missing, artifact: invalid, policy, readSignature: async () => signature })).rejects.toMatchObject({ stage: 'artifact' });
      }
      const path = await writeInstaller(output);
      await expect(call(path, { artifact: artifact({ size: bytes.length + 1 }) })).rejects.toMatchObject({ stage: 'file' });
      const other = Buffer.from('other installer bytes'); await writeFile(path, other);
      await expect(call(path)).rejects.toMatchObject({ stage: 'file' });
    });
  });

  it('rejects links and non-regular files', async () => {
    await isolated(async (output) => {
      const directory = join(output, 'installer-directory'); await mkdir(directory);
      await expect(call(directory)).rejects.toMatchObject({ stage: 'file' });
      const target = join(output, 'installer-target'); await mkdir(target);
      const link = join(output, 'installer-link'); await symlink(target, link, 'junction');
      await expect(call(link)).rejects.toMatchObject({ stage: 'file' });
    });
  });

  it('rejects a file replaced between the read and the final state check', async () => {
    await isolated(async (output) => {
      const path = await writeInstaller(output);
      const replacement = Buffer.alloc(bytes.length, 0x42);
      let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
      let readStarted!: () => void; const started = new Promise<void>((resolve) => { readStarted = resolve; });
      const pending = call(path);
      try {
        openInjection.impl = async (...args: unknown[]) => {
          const handle = await openInjection.real!(...args) as { read: (...readArgs: unknown[]) => Promise<unknown>; [key: string]: unknown };
          const realRead = handle.read.bind(handle); let first = true;
          handle.read = async (...readArgs: unknown[]) => { if (first) { first = false; readStarted(); await gate; } return realRead(...readArgs); };
          return handle;
        };
        const began = await Promise.race([started.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1000))]);
        expect(began).toBe(true);
        if (!began) { release(); await pending.catch(() => {}); return; }
        await writeFile(path, replacement); release();
        await expect(pending).rejects.toMatchObject({ stage: 'file' });
      } finally {
        release(); openInjection.impl = null;
        await pending.catch(() => {});
      }
    });
  });

  it('rejects a signature status, subject or thumbprint that disagrees with the policy', async () => {
    await isolated(async (output) => {
      const path = await writeInstaller(output);
      for (const invalid of [{ status: 'NotSigned', subject, thumbprint }, { status: 'Valid', subject: 'CN=Other', thumbprint },
        { status: 'Valid', subject, thumbprint: 'B'.repeat(40) }, { status: 'Valid', subject: '', thumbprint },
        { status: 'Valid', subject, thumbprint: 'bad' }, { status: 'Valid', subject, thumbprint: 123 },
        'not-json', '[]', 'null', '{"status":"Valid"}']) {
        await expect(call(path, { readSignature: async () => invalid })).rejects.toMatchObject({ stage: 'signature' });
      }
    });
  });

  it('rejects pre-cancelled, timed-out and externally cancelled admissions without success', async () => {
    await isolated(async (output) => {
      const path = await writeInstaller(output);
      const controller = new AbortController(); controller.abort(new Error('pre-cancelled'));
      const preReader = vi.fn(async () => signature);
      await expect(call(path, { signal: controller.signal, readSignature: preReader })).rejects.toMatchObject({ stage: 'cancelled' });
      expect(preReader).not.toHaveBeenCalled();
      await expect(call(path, { timeoutMs: 0 })).rejects.toMatchObject({ stage: 'timeout' });
      let started!: () => void; const began = new Promise<void>((resolve) => { started = resolve; });
      const waiting = vi.fn(() => { started(); return new Promise<never>(() => {}); });
      await expect(call(path, { readSignature: waiting, timeoutMs: 50 })).rejects.toMatchObject({ stage: 'cancelled' });
      const external = new AbortController(); const pending = call(path, { signal: external.signal, readSignature: waiting });
      await began; external.abort(new Error('cancelled during signature'));
      await expect(pending).rejects.toMatchObject({ stage: 'cancelled' });
    });
  });

  it('uses the bounded Windows Authenticode adapter with the path in an environment field', async () => {
    await isolated(async (output) => {
      const path = await writeInstaller(output);
      const { calls } = fakeSpawn({ stdout: JSON.stringify(signature) });
      try {
        const result = await call(path, { readSignature: undefined });
        expect(result).toBeDefined();
        expect(result?.publisher).toEqual(signature);
        expect(calls).toHaveLength(1);
        expect(calls[0].command).toBe('powershell.exe');
        expect(calls[0].args).toEqual(expect.arrayContaining(['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command']));
        expect(calls[0].options.shell).toBe(false);
        expect(calls[0].options.windowsHide).toBe(true);
        expect((calls[0].options.env as Record<string, string | undefined>).DSH_ADMIT_SIGNATURE_PATH).toBe(path);
        expect(calls[0].args.join(' ')).not.toContain(path);
      } finally { spawnInjection.impl = null; }
    });
  });

  it('rejects default-adapter output, JSON and process failures', async () => {
    await isolated(async (output) => {
      const path = await writeInstaller(output);
      for (const options of [{ stdout: 'x'.repeat(70 * 1024) }, { stdout: 'not-json' }, { code: 1 }, { signal: 'SIGKILL' },
        { error: new Error('spawn failed') }]) {
        const { calls } = fakeSpawn(options);
        try { await expect(call(path, { readSignature: undefined })).rejects.toMatchObject({ stage: 'signature' }); }
        finally { spawnInjection.impl = null; }
        expect(calls).toHaveLength(1);
      }
      const { calls } = fakeSpawn({ hang: true });
      try { await expect(call(path, { readSignature: undefined, timeoutMs: 50 })).rejects.toMatchObject({ stage: 'cancelled' }); }
      finally { spawnInjection.impl = null; }
      expect(calls).toHaveLength(1);
    });
  });

  it('rejects same-fingerprint content rewritten while its signature is being read', async () => {
    await isolated(async (output) => {
      const path = await writeInstaller(output);
      const replacement = Buffer.from(bytes); replacement[0] = 0x43;
      // The file system can report an unchanged fingerprint for a same-length rewrite; this test pins the
      // metadata projection to the first valid state so only a real content comparison can reject the change.
      const original = await lstatInjection.real!(path);
      lstatInjection.impl = async () => original;
      openInjection.impl = async (...args: unknown[]) => {
        const handle = await openInjection.real!(...args) as Record<string, unknown>;
        handle.stat = async () => original;
        return handle;
      };
      try {
        let reads = 0;
        await expect(call(path, { readSignature: async (target: string) => {
          reads += 1;
          await writeFile(target, replacement);
          return signature;
        } })).rejects.toMatchObject({ stage: 'file' });
        expect(reads).toBe(1);
        expect(await readFile(path)).toEqual(replacement);
      } finally { openInjection.impl = null; lstatInjection.impl = null; }
    });
  });

  it('bounds the post-signature content read and still closes the handle', async () => {
    await isolated(async (output) => {
      const path = await writeInstaller(output);
      let closeCalls = 0;
      openInjection.impl = async (...args: unknown[]) => {
        const handle = await openInjection.real!(...args) as Record<string, unknown>;
        const realRead = (handle.read as (...readArgs: unknown[]) => Promise<unknown>).bind(handle);
        const realClose = (handle.close as () => Promise<unknown>).bind(handle);
        // The first hash reads sequentially; the post-signature pass reads from an explicit position and stalls.
        handle.read = async (...readArgs: unknown[]) => (readArgs[3] === null ? realRead(...readArgs) : new Promise(() => {}));
        handle.close = async () => { closeCalls += 1; return realClose(); };
        return handle;
      };
      try {
        const outcome = await call(path, { timeoutMs: 30 }).catch((value) => value) as AdmissionOutcome;
        expect(outcome).toMatchObject({ stage: 'cancelled' });
        expect(outcome.unresolvedResources).toEqual(expect.arrayContaining([expect.stringContaining('read')]));
        expect(closeCalls).toBe(1);
      } finally { openInjection.impl = null; }
    });
  });

  it('rejects a path replaced while the post-signature content is being re-read', async () => {
    await isolated(async (output) => {
      const path = await writeInstaller(output);
      const retired = join(output, 'retired-installer.exe');
      const replacement = Buffer.from(bytes); replacement[0] = 0x44;
      let swapped = false;
      let restore: (() => Promise<void>) | undefined;
      openInjection.impl = async (...args: unknown[]) => {
        const handle = await openInjection.real!(...args) as Record<string, unknown>;
        const realRead = (handle.read as (...readArgs: unknown[]) => Promise<unknown>).bind(handle);
        const realClose = (handle.close as () => Promise<unknown>).bind(handle);
        // The old handle still reads the original bytes; the path now names another same-length file.
        handle.read = async (...readArgs: unknown[]) => {
          if (!swapped && readArgs[3] === 0) {
            swapped = true;
            await rename(path, retired);
            await writeFile(path, replacement);
          }
          return realRead(...readArgs);
        };
        restore = async () => { handle.read = realRead; await realClose().catch(() => {}); };
        return handle;
      };
      try {
        await expect(call(path)).rejects.toMatchObject({ stage: 'file' });
        expect(swapped).toBe(true);
        expect(await readFile(path)).toEqual(replacement);
        expect(await readFile(retired)).toEqual(bytes);
      } finally {
        openInjection.impl = null;
        await restore?.();
        await rm(retired, { force: true }).catch(() => {});
      }
    });
  });

  it('bounds a stalled open, owns the late handle and closes it once', async () => {
    await isolated(async (output) => {
      const path = await writeInstaller(output);
      let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
      let closeCalls = 0; let handle: { close: () => Promise<void> } | undefined; let realClose: (() => Promise<void>) | undefined;
      openInjection.impl = async (...args: unknown[]) => {
        await gate;
        handle = await openInjection.real!(...args) as { close: () => Promise<void> };
        realClose = handle.close.bind(handle);
        handle.close = async () => { closeCalls += 1; return realClose!(); };
        return handle;
      };
      const pending = call(path, { timeoutMs: 30 });
      let outcome: AdmissionOutcome;
      try {
        outcome = await Promise.race([pending.then(() => ({ stage: 'resolved' }), (error: AdmissionOutcome) => error), new Promise<AdmissionOutcome>((resolve) => setTimeout(() => resolve({ stage: 'hung' }), 500))]);
        expect(outcome).toMatchObject({ stage: 'cancelled' });
        expect(outcome.lateOpen).toBeDefined();
        expect(outcome.unresolvedResources).toEqual(expect.arrayContaining([expect.stringContaining('open')]));
        release();
        expect(await waitFor(() => outcome.lateOpen?.closed === true)).toBe(true);
        expect(closeCalls).toBe(1);
      } finally {
        release();
        await Promise.race([pending.catch(() => {}), new Promise((resolve) => setTimeout(resolve, 100))]);
        await waitFor(() => closeCalls > 0, 500);
        openInjection.impl = null;
        if (handle && realClose) { handle.close = realClose; await realClose().catch(() => {}); }
      }
    });
  });

  it('bounds a stalled metadata read', async () => {
    await isolated(async (output) => {
      const path = await writeInstaller(output);
      lstatInjection.impl = () => new Promise(() => {});
      const pending = call(path, { timeoutMs: 30 });
      try {
        const outcome = await Promise.race([pending.then(() => ({ stage: 'resolved' }), (error: AdmissionOutcome) => error),
          new Promise<AdmissionOutcome>((resolve) => setTimeout(() => resolve({ stage: 'hung' }), 500))]);
        expect(outcome).toMatchObject({ stage: 'cancelled' });
        expect(outcome.unresolvedResources).toEqual(expect.arrayContaining([expect.stringContaining('read')]));
      } finally {
        lstatInjection.impl = null;
        await Promise.race([pending.catch(() => {}), new Promise((resolve) => setTimeout(resolve, 100))]);
      }
    });
  });

  it('reports an unconfirmed signature child release and clears parent pipes', async () => {
    await isolated(async (output) => {
      const path = await writeInstaller(output);
      const { calls, state } = fakeSpawn({ stdout: 'x'.repeat(70 * 1024), killEffect: false, noClose: true });
      try {
        const error = await call(path, { readSignature: undefined, timeoutMs: 5000 }).catch((value) => value);
        expect(error).toMatchObject({ stage: 'signature', releaseUnclear: expect.arrayContaining([expect.stringContaining('did not close')]) });
        expect(state.kill).toBeGreaterThan(0);
        expect(state.destroy).toBeGreaterThan(0);
        expect(state.unref).toBeGreaterThan(0);
        expect(state.child?.stdout.listenerCount('data')).toBe(0);
        expect(state.child?.stderr.listenerCount('data')).toBe(0);
      } finally { spawnInjection.impl = null; }
      expect(calls).toHaveLength(1);
    });
  });

  it('reports an unconfirmed signature child release on cancellation', async () => {
    await isolated(async (output) => {
      const path = await writeInstaller(output);
      const { state } = fakeSpawn({ killEffect: false, noClose: true });
      try {
        const error = await call(path, { readSignature: undefined, timeoutMs: 30 }).catch((value) => value);
        expect(error).toMatchObject({ stage: 'cancelled', releaseUnclear: expect.arrayContaining([expect.stringContaining('did not close')]) });
        expect(state.destroy).toBeGreaterThan(0);
        expect(state.unref).toBeGreaterThan(0);
        expect(state.child?.stdout.listenerCount('data')).toBe(0);
      } finally { spawnInjection.impl = null; }
    });
  });

  it('starts the real file close only once when it rejects', async () => {
    await isolated(async (output) => {
      const path = await writeInstaller(output);
      let closeCalls = 0; let handle: { close: () => Promise<void> } | undefined; let realClose: (() => Promise<void>) | undefined;
      openInjection.impl = async (...args: unknown[]) => {
        handle = await openInjection.real!(...args) as { close: () => Promise<void> };
        realClose = handle.close.bind(handle);
        handle.close = async () => { closeCalls += 1; throw new Error('close refused'); };
        return handle;
      };
      try {
        await expect(call(path)).rejects.toMatchObject({ stage: 'cleanup' });
        expect(closeCalls).toBe(1);
      } finally {
        openInjection.impl = null;
        if (handle && realClose) { handle.close = realClose; await realClose().catch(() => {}); }
      }
    });
  });

  it('preserves a frozen signature failure alongside the close failure', async () => {
    await isolated(async (output) => {
      const path = await writeInstaller(output);
      let closeCalls = 0; let handle: { close: () => Promise<void> } | undefined; let realClose: (() => Promise<void>) | undefined;
      openInjection.impl = async (...args: unknown[]) => {
        handle = await openInjection.real!(...args) as { close: () => Promise<void> };
        realClose = handle.close.bind(handle);
        handle.close = async () => { closeCalls += 1; throw new Error('close refused'); };
        return handle;
      };
      const signatureCause = new Error('signature cause');
      const frozen = Object.freeze(Object.assign(new Error('frozen signature', { cause: signatureCause }), { stage: 'signature' }));
      try {
        const error = await call(path, { readSignature: async () => { throw frozen; } }).catch((value) => value) as AdmissionOutcome;
        expect(error).toMatchObject({ stage: 'signature', cleanupError: expect.stringContaining('close') });
        expect(error.cause).toBe(signatureCause);
        expect(error.originalError).toBe(frozen);
        expect(error.cleanupCause).toMatchObject({ message: 'close refused' });
        expect(closeCalls).toBe(1);
      } finally {
        openInjection.impl = null;
        if (handle && realClose) { handle.close = realClose; await realClose().catch(() => {}); }
      }
    });
  });

  it('owns a spawned child error without a close instead of returning early', async () => {
    await isolated(async (output) => {
      const path = await writeInstaller(output);
      const { state } = fakeSpawn({ error: new Error('EPERM stop failed'), killEffect: false });
      try {
        const error = await call(path, { readSignature: undefined, timeoutMs: 5000 }).catch((value) => value) as AdmissionOutcome;
        expect(error).toMatchObject({ stage: 'signature', releaseUnclear: expect.arrayContaining([expect.stringContaining('did not close')]) });
        expect(error.message).toContain('EPERM stop failed');
        expect(state.kill).toBeGreaterThan(0);
        expect(state.destroy).toBeGreaterThan(0);
        expect(state.unref).toBeGreaterThan(0);
        expect(state.child?.stdout.listenerCount('data')).toBe(0);
        expect(state.child?.stderr.listenerCount('data')).toBe(0);
      } finally { spawnInjection.impl = null; }
    });
  });

  it('finishes a spawned child error once its close is observed', async () => {
    await isolated(async (output) => {
      const path = await writeInstaller(output);
      const { state } = fakeSpawn({ error: new Error('ENOENT') });
      try {
        const error = await call(path, { readSignature: undefined, timeoutMs: 5000 }).catch((value) => value) as AdmissionOutcome;
        expect(error).toMatchObject({ stage: 'signature' });
        expect(error.releaseUnclear).toBeUndefined();
        expect(state.kill).toBeGreaterThan(0);
        expect(state.destroy).toBe(0);
        expect(state.unref).toBe(0);
      } finally { spawnInjection.impl = null; }
    });
  });

  it('keeps the overflow failure when a failed stop reports an error', async () => {
    await isolated(async (output) => {
      const path = await writeInstaller(output);
      const { state } = fakeSpawn({ stdout: 'x'.repeat(70 * 1024), killEffect: false, killError: new Error('EPERM stop failed'), noClose: true });
      try {
        const error = await call(path, { readSignature: undefined, timeoutMs: 5000 }).catch((value) => value) as AdmissionOutcome;
        expect(error).toMatchObject({ stage: 'signature', releaseUnclear: expect.arrayContaining([expect.stringContaining('did not close')]) });
        expect(error.message).toContain('output budget');
        expect(state.kill).toBeGreaterThan(0);
        expect(state.destroy).toBeGreaterThan(0);
        expect(state.unref).toBeGreaterThan(0);
        expect(state.child?.stdout.listenerCount('data')).toBe(0);
      } finally { spawnInjection.impl = null; }
    });
  });

  it('keeps the signature failure and release state across the total deadline', async () => {
    await isolated(async (output) => {
      const path = await writeInstaller(output);
      const { state } = fakeSpawn({ stdout: 'x'.repeat(70 * 1024), killEffect: false, noClose: true });
      try {
        const error = await call(path, { readSignature: undefined, timeoutMs: 50 }).catch((value) => value) as AdmissionOutcome;
        expect(error).toMatchObject({ stage: 'signature', releaseUnclear: expect.arrayContaining([expect.stringContaining('did not close')]) });
        expect(error.message).toContain('output budget');
        expect(error.unresolvedResources).toEqual(expect.arrayContaining([expect.stringContaining('signature')]));
        expect(state.destroy).toBeGreaterThan(0);
        expect(state.unref).toBeGreaterThan(0);
      } finally { spawnInjection.impl = null; }
    });
  });
});
