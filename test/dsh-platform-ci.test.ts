import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dshRegressionIdentity, parseDshDesktopWindowsManifest, parseDshNpmManifest, parsePnpmManifest, runDshBuildSequence, runDshProbeAttempt } from '../scripts/dsh-compat-ci.mjs';

const pinned = JSON.parse(await readFile(new URL('../scripts/dsh-compat-baseline.json', import.meta.url), 'utf8'));
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

function communicationReport(platform: string, arch: string, version: string, runId = randomUUID()) {
  return { schema: 1, tool: 'dsh-web-runtime', platform, arch, version, runId, status: 'passed', stage: 'done', category: null,
    scope: { officialNpmRuntime: true, officialPluginManager: true, ordinaryWebSessions: true, scriptedLocalModel: true,
      browserUI: false, desktop: false, modelIntelligence: false },
    checks: ['official-plugin-installation-and-owned-web-runtime', 'public-web-session-controller-creates-interactive-sessions',
      'messages-model-and-native-shell-identity-bootstrap', 'authenticated-production-discovery-and-pagination',
      'idle-production-delivery-wakes-the-existing-session', 'busy-native-queue-and-steer-step-boundaries',
      'native-shell-send-and-conversation-reply-have-full-session-identities', 'missing-target-does-not-create-or-resume-a-replacement']
      .map(name => ({ name, status: 'passed', elapsedMs: 1 })),
    cleanup: { runtimeStopped: true, registrationRemoved: true, removed: true, forced: false },
  };
}

function regressionSummary(platform: string, arch: string) {
  const baseline = parseDshNpmManifest(pinned.package, platform, arch);
  const candidate = { ...baseline, version: '0.2.1-rc.5', url: 'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.1-rc.5.tgz' };
  const failed = () => {
    const report = communicationReport(platform, arch, candidate.version);
    return { ...report, status: 'failed', category: 'compatibility', checks: report.checks.slice(0, 5),
      stage: 'native-delivery', check: 'busy-native-queue-and-steer-step-boundaries', process: { code: 1, signal: null, timedOut: false } };
  };
  const report = communicationReport(platform, arch, baseline.version);
  return { schema: 1, tool: 'dsh-web-runtime', platform, arch, scope: report.scope,
    builds: { baseline, candidate, packageManager: parsePnpmManifest(pinned.packageManager) },
    classification: { kind: 'regression', notify: true }, installationCleanup: 'removed',
    baseline: { ...report, process: { code: 0, signal: null, timedOut: false } }, candidate: failed(), retry: failed() };
}

describe('DSH npm platform boundaries', () => {
  it.each([['linux', 'x64'], ['darwin', 'x64'], ['darwin', 'arm64']])(
    'verifies the same pinned official npm archive for %s/%s without claiming native execution', (platform, arch) => {
      const artifact = parseDshNpmManifest(pinned.package, platform, arch);
      expect(artifact).toEqual({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.2',
        url: 'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.1-rc.2.tgz', integrity: pinned.package.dist.integrity });
      expect(() => parseDshNpmManifest({ ...pinned.package, dist: { ...pinned.package.dist, integrity: 'sha512-invalid' } }, platform, arch)).toThrow();
    });

  it.each([['linux', 'arm64'], ['win32', 'arm64'], ['freebsd', 'x64'], ['darwin', 'ia32']])(
    'keeps unplanned npm targets rejected: %s/%s', (platform, arch) => {
      expect(() => parseDshNpmManifest(pinned.package, platform, arch)).toThrow();
    });

  it.each([['linux', 'x64'], ['darwin', 'arm64']])(
    'keeps Windows Desktop artifacts isolated from npm target expansion: %s/%s', (platform, arch) => {
      expect(() => parseDshDesktopWindowsManifest(pinned.desktopWindows, platform, arch)).toThrow();
    });
});

describe('fresh DSH communication reports for an explicit runner target', () => {
  it.each([['linux', 'x64'], ['darwin', 'x64'], ['darwin', 'arm64']])(
    'accepts only the freshly executed %s/%s report for that runner', async (platform, arch) => {
      const output = await mkdtemp(join(tmpdir(), 'crosschat-dsh-platform-')); roots.push(output);
      const artifact = parseDshNpmManifest(pinned.package, platform, arch);
      const result = await runDshProbeAttempt({ output, artifact, label: 'baseline', target: { platform, arch } },
        async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
          await writeFile(reportPath, JSON.stringify(communicationReport(platform, arch, artifact.version, runId)));
          return { code: 0, signal: null, timedOut: false };
        });
      expect(result).toMatchObject({ status: 'passed', platform, arch, process: { code: 0, signal: null, timedOut: false } });
    });

  it.each([['win32', 'x64'], ['darwin', 'x64'], ['linux', 'arm64']])(
    'rejects a foreign %s/%s report on a Linux x64 runner and keeps the failure identity', async (platform, arch) => {
      const output = await mkdtemp(join(tmpdir(), 'crosschat-dsh-platform-')); roots.push(output);
      const artifact = parseDshNpmManifest(pinned.package, 'linux', 'x64');
      const result = await runDshProbeAttempt({ output, artifact, label: 'baseline', target: { platform: 'linux', arch: 'x64' } },
        async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
          await writeFile(reportPath, JSON.stringify(communicationReport(platform, arch, artifact.version, runId)));
          return { code: 0, signal: null, timedOut: false };
        });
      expect(result).toMatchObject({ status: 'failed', category: 'infrastructure', stage: 'probe-report', platform: 'linux', arch: 'x64' });
    });
});

describe('DSH communication sequence keeps the runner identity across builds', () => {
  it('accepts two independent Linux x64 attempts and reports the actual runner target', async () => {
    const baseline = parseDshNpmManifest(pinned.package, 'linux', 'x64');
    const candidate = { ...baseline, version: '0.2.1-rc.5' };
    const removed: string[] = [];
    const result = await runDshBuildSequence({ baseline, candidate }, {
      install: async (_artifact: unknown, label: string) => ({ root: label }),
      probe: async (_installation: unknown, artifact: { version: string }) => ({
        ...communicationReport('linux', 'x64', artifact.version), process: { code: 0, signal: null, timedOut: false },
      }),
      remove: async (installation: { root: string }) => { removed.push(installation.root); },
    }, { platform: 'linux', arch: 'x64' });
    expect(result).toMatchObject({ platform: 'linux', arch: 'x64', classification: { kind: 'compatible', notify: false }, installationCleanup: 'removed' });
    expect(result.baseline.runId).not.toBe(result.candidate.runId);
    expect(removed).toEqual(['baseline', 'candidate']);
  });

  it('retains a candidate with the wrong runner identity instead of deleting it or trying another build', async () => {
    const baseline = parseDshNpmManifest(pinned.package, 'linux', 'x64');
    const candidate = { ...baseline, version: '0.2.1-rc.5' };
    const installed: string[] = [], removed: string[] = [];
    const result = await runDshBuildSequence({ baseline, candidate }, {
      install: async (_artifact: unknown, label: string) => { installed.push(label); return { root: label }; },
      probe: async (installation: { root: string }, artifact: { version: string }) => ({
        ...communicationReport(installation.root === 'candidate' ? 'win32' : 'linux', 'x64', artifact.version),
        process: { code: 0, signal: null, timedOut: false },
      }),
      remove: async (installation: { root: string }) => { removed.push(installation.root); },
    }, { platform: 'linux', arch: 'x64' });
    expect(result).toMatchObject({ platform: 'linux', arch: 'x64', classification: { kind: 'infrastructure', notify: false },
      installationCleanup: 'incomplete', retainedInstallation: { label: 'candidate', root: 'candidate' },
      candidate: { platform: 'linux', arch: 'x64', category: 'infrastructure', status: 'failed' } });
    expect(installed).toEqual(['baseline', 'candidate']); expect(removed).toEqual(['baseline']);
  });
});

describe('DSH regression identity separates OS and architecture', () => {
  it.each([
    ['linux', 'x64', 'linux-x64'], ['darwin', 'x64', 'darwin-x64'], ['darwin', 'arm64', 'darwin-arm64'],
  ])('makes a scoped notification identity for %s/%s', (platform, arch, key) => {
    const identity = dshRegressionIdentity(regressionSummary(platform, arch));
    expect(identity?.marker).toBe(`<!-- dsh-compat:0.2.1-rc.5:${key}:busy-native-queue-and-steer-step-boundaries -->`);
  });

  it('preserves the established Windows marker', () => {
    expect(dshRegressionIdentity(regressionSummary('win32', 'x64'))?.marker)
      .toBe('<!-- dsh-compat:0.2.1-rc.5:win32:busy-native-queue-and-steer-step-boundaries -->');
  });

  it('rejects reports from a different OS or architecture instead of sharing their notification', () => {
    const report = regressionSummary('darwin', 'arm64');
    for (const changed of [{ ...report.baseline, platform: 'linux' }, { ...report.baseline, arch: 'x64' }]) {
      expect(dshRegressionIdentity({ ...report, baseline: changed })).toBeUndefined();
    }
    expect(dshRegressionIdentity({ ...report, platform: 'linux', arch: 'arm64' })).toBeUndefined();
  });
});
