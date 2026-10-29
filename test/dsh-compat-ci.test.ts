import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { dshRegressionIdentity, hasDesktopCleanupProof, hasDshRuntimeReleaseProof, parseDshNpmManifest, parsePnpmManifest, resolveDshNpmCache, runDshBuildSequence,
  runDshDesktopAttempt, runDshDesktopSequence, runDshProbeAttempt, runDshProcess, verifyNpmArtifact } from '../scripts/dsh-compat-ci.mjs';

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
  const owned = { installationId: randomUUID(), owner, root: 'owned-desktop' };
  const desktopPassed = (version = builds.baseline.version, runId = randomUUID()) => ({ schema: 1, tool: 'dsh-desktop', platform: 'win32', arch: 'x64',
    runId, version, artifactId: integrity, installationId: owned.installationId, owner, instanceId: randomUUID(), sessionId: 'native-session-1',
    status: 'passed', stage: 'done', category: null, checks: desktopChecks.map((name) => ({ name, status: 'passed', elapsedMs: 1 })),
    scope: desktopScope, cleanup: desktopCleanup, process: { code: 0, signal: null, timedOut: false } });

  it('accepts a fresh desktop report bound to this install, native instance, session and artifact', async () => {
    await isolated(async (output) => {
      const result = await runDshDesktopAttempt({ output, label: 'baseline', artifact: builds.baseline, installation: owned },
        async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
          await writeFile(reportPath, JSON.stringify(desktopPassed(builds.baseline.version, runId)));
          return { code: 0, signal: null, timedOut: false };
        });
      expect(result).toMatchObject({ status: 'passed', stage: 'done', category: null });
      expect(hasDesktopCleanupProof(result.cleanup)).toBe(true);
    });
  });

  it('rejects web, stale, foreign and incomplete desktop evidence', async () => {
    await isolated(async (output) => {
      const incomplete = (name: string) => desktopChecks.filter((item) => item !== name).map((item) => ({ name: item, status: 'passed', elapsedMs: 1 }));
      for (const invalid of [
        { tool: 'dsh-web-runtime' }, { scope: { ...scope, desktop: true } }, { scope: { ...desktopScope, desktopUi: false } },
        { runId: randomUUID() }, { installationId: randomUUID() }, { owner: randomUUID() }, { version: '0.2.2' },
        { artifactId: `sha512-${Buffer.alloc(64, 2).toString('base64')}` }, { instanceId: 'not-a-uuid' }, { sessionId: '' },
        { checks: [] }, { checks: incomplete('desktop-ui-send-receive-and-reply') }, { checks: incomplete('official-uninstall') },
        { checks: [...desktopChecks, desktopChecks[0]].map((name) => ({ name, status: 'passed', elapsedMs: 1 })) }, { stage: 'contract' },
      ]) {
        const result = await runDshDesktopAttempt({ output, label: 'candidate', artifact: builds.candidate, installation: owned },
          async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
            await writeFile(reportPath, JSON.stringify({ ...desktopPassed(builds.candidate.version, runId), ...invalid }));
            return { code: 0, signal: null, timedOut: false };
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
      const ignored = await runDshDesktopAttempt({ output, label: 'baseline', artifact: builds.baseline, installation: owned },
        async () => ({ code: 0, signal: null, timedOut: false }));
      expect(ignored).toMatchObject({ status: 'failed', category: 'infrastructure' });

      const truncated = await runDshDesktopAttempt({ output, label: 'baseline', artifact: builds.baseline, installation: owned },
        async ({ reportPath }: { reportPath: string }) => {
          await writeFile(reportPath, '{"schema":1,"tool":"dsh-desktop"'); return { code: 0, signal: null, timedOut: false };
        });
      expect(truncated).toMatchObject({ status: 'failed', category: 'infrastructure' });

      const paths: string[] = []; let first: unknown;
      const accepted = await runDshDesktopAttempt({ output, label: 'candidate', artifact: builds.candidate, installation: owned },
        async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
          paths.push(reportPath); first = desktopPassed(builds.candidate.version, runId);
          await writeFile(reportPath, JSON.stringify(first)); return { code: 0, signal: null, timedOut: false };
        });
      const reused = await runDshDesktopAttempt({ output, label: 'candidate', artifact: builds.candidate, installation: owned },
        async ({ reportPath }: { reportPath: string }) => {
          paths.push(reportPath); await writeFile(reportPath, JSON.stringify(first)); return { code: 0, signal: null, timedOut: false };
        });
      expect(accepted.status).toBe('passed'); expect(paths[0]).not.toBe(paths[1]);
      expect(reused).toMatchObject({ status: 'failed', category: 'infrastructure' }); expect(reused.cleanup).toBeUndefined();
    });
  });

  it('keeps release unknown when the desktop session times out, is killed, disagrees or throws', async () => {
    await isolated(async (output) => {
      for (const process of [{ code: null, signal: null, timedOut: true }, { code: 0, signal: 'SIGKILL', timedOut: false }, { code: 1, signal: null, timedOut: false }]) {
        const result = await runDshDesktopAttempt({ output, label: 'baseline', artifact: builds.baseline, installation: owned },
          async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
            await writeFile(reportPath, JSON.stringify(desktopPassed(builds.baseline.version, runId))); return process;
          });
        expect(result).toMatchObject({ status: 'failed', category: 'infrastructure' }); expect(result.cleanup).toBeUndefined();
      }
      const crashed = await runDshDesktopAttempt({ output, label: 'baseline', artifact: builds.baseline, installation: owned },
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

  it('installs the candidate only after the released desktop baseline and stays out of the web reporter', async () => {
    const calls: string[] = [];
    const summary = await runDshDesktopSequence(builds, {
      install: async (_build: unknown, label: string) => { calls.push(`install:${label}`); return { ...owned, root: `owned-${label}` }; },
      probe: async (_installation: unknown, build: typeof builds.baseline, label: string) => { calls.push(`probe:${label}`); return desktopPassed(build.version); },
      remove: async (_installation: unknown, _build: unknown, label: string) => { calls.push(`remove:${label}`); },
    });
    expect(calls).toEqual(['install:baseline', 'probe:baseline', 'remove:baseline', 'install:candidate', 'probe:candidate', 'remove:candidate']);
    expect(summary).toMatchObject({ tool: 'dsh-desktop', installationCleanup: 'removed', classification: { kind: 'compatible' } });
    expect(summary.scope).toEqual(desktopScope);

    const regression = await runDshDesktopSequence(builds, {
      install: async () => ({ ...owned }), probe: async (_installation: unknown, build: typeof builds.baseline) => build.version === builds.baseline.version
        ? desktopPassed(build.version) : { ...desktopPassed(build.version), status: 'failed', stage: 'contract', check: 'native-queue', category: 'compatibility', process: { code: 1, signal: null, timedOut: false } },
      remove: async () => {},
    });
    expect(regression.classification).toEqual({ kind: 'regression', notify: true });
    expect(dshRegressionIdentity(regression)).toBeUndefined();
  });

  it('retains the first desktop installation and stops when release is unverified', async () => {
    for (const report of [{ ...desktopPassed(), cleanup: { ...desktopCleanup, systemRegistrationRemoved: false } },
      { ...desktopPassed(), cleanup: { ...desktopCleanup, forced: true } },
      { ...desktopPassed(), process: { code: null, signal: null, timedOut: true } }]) {
      const calls: string[] = [];
      const summary = await runDshDesktopSequence(builds, {
        install: async (_build: unknown, label: string) => { calls.push(label); return { ...owned, root: 'owned-retained' }; },
        probe: async () => report, remove: async () => { calls.push('remove'); },
      });
      expect(calls).toEqual(['baseline']); expect(summary.retainedInstallation).toBeDefined();
      expect(summary.classification).toEqual({ kind: 'infrastructure', notify: false });
    }
  });

  it('never closes blindly after a thrown desktop operation and keeps ownership when the close fails', async () => {
    const crashed: string[] = [];
    const crashedSummary = await runDshDesktopSequence(builds, {
      install: async (_build: unknown, label: string) => { crashed.push(label); return { ...owned }; },
      probe: async () => { throw new Error('desktop driver crashed'); },
      remove: async () => { crashed.push('remove'); },
    });
    expect(crashed).toEqual(['baseline']); expect(crashedSummary.retainedInstallation).toBeDefined();

    const refused: string[] = [];
    const refusedSummary = await runDshDesktopSequence(builds, {
      install: async (_build: unknown, label: string) => { refused.push(`install:${label}`); return { ...owned }; },
      probe: async (_installation: unknown, build: typeof builds.baseline, label: string) => { refused.push(`probe:${label}`); return desktopPassed(build.version); },
      remove: async (_installation: unknown, _build: unknown, label: string) => { refused.push(`remove:${label}`); throw new Error('Official uninstall refused'); },
    });
    expect(refused).toEqual(['install:baseline', 'probe:baseline', 'remove:baseline']);
    expect(refusedSummary.retainedInstallation).toMatchObject({ label: 'baseline' });
    expect(refusedSummary.classification).toEqual({ kind: 'infrastructure', notify: false });

    const failed = await runDshDesktopSequence(builds, { install: async () => { throw new Error('Desktop install failed'); }, probe: async () => undefined, remove: async () => {} });
    expect(failed.classification).toEqual({ kind: 'infrastructure', notify: false });
    expect(failed.retainedInstallation).toBeUndefined();
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
      install: async (_build: unknown, label: string) => { desktopCalls.push(label); return { ...owned }; },
      probe: async (_installation: unknown, build: typeof builds.baseline) => passed(build.version), remove: async () => { desktopCalls.push('remove'); },
    });
    expect(desktopCalls).toEqual(['baseline']); expect(desktop.retainedInstallation).toBeDefined();
  });
});
