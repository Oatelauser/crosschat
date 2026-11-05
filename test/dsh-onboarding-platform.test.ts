import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DSH_ONBOARDING_CHECKS, DSH_ONBOARDING_SCOPE, DSH_ONBOARDING_TOOL, validDshOnboardingProcessReport, validDshOnboardingReport } from '../scripts/dsh-onboarding-contract.mjs';
import { dshOnboardingRegressionIdentity, runDshOnboardingAttempt, runDshOnboardingSequence } from '../scripts/dsh-compat-ci.mjs';

const targets = [{ platform: 'linux', arch: 'x64' }, { platform: 'darwin', arch: 'x64' }, { platform: 'darwin', arch: 'arm64' }];
const windows = { platform: 'win32', arch: 'x64' };
const artifact = { name: '@deepseek-ai/dsh', version: '0.2.1-rc.2' };
const processResult = { code: 0, signal: null, timedOut: false };
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function directory() { const root = await mkdtemp(join(tmpdir(), 'crosschat-dsh-onboarding-target-')); roots.push(root); return root; }
function passed(target = windows, version = artifact.version, runId = randomUUID()) {
  return { schema: 1, tool: DSH_ONBOARDING_TOOL, ...target, version, runId, scope: { ...DSH_ONBOARDING_SCOPE },
    status: 'passed', category: null, stage: 'done', checks: DSH_ONBOARDING_CHECKS.map((name: string) => ({ name, status: 'passed', elapsedMs: 1 })),
    cleanup: { runtimeStopped: true, registrationRemoved: true, removed: true, forced: false }, process: processResult };
}

describe('from-zero evidence binds the expected native target', () => {
  it.each(targets)('accepts a complete fresh %j report only for its explicit target', (target) => {
    const report = passed(target);
    expect(validDshOnboardingReport(report, artifact, report.runId, target)).toBe(true);
    expect(validDshOnboardingProcessReport(report, artifact, target)).toBe(true);
    expect(validDshOnboardingReport(report, artifact, report.runId)).toBe(false);
    expect(validDshOnboardingReport({ ...report, arch: target.arch === 'arm64' ? 'x64' : 'arm64' }, artifact, report.runId, target)).toBe(false);
  });

  it('preserves the Windows default and rejects unplanned axes', () => {
    const report = passed(); expect(validDshOnboardingReport(report, artifact, report.runId)).toBe(true);
    for (const target of [{ platform: 'linux', arch: 'arm64' }, { platform: 'win32', arch: 'arm64' }, { platform: 'freebsd', arch: 'x64' }]) {
      expect(validDshOnboardingReport(passed(target), artifact, undefined, target)).toBe(false);
    }
  });

  it.each(targets)('accepts only a fresh %j child and retains its actual target on invalid evidence', async (target) => {
    const output = await directory();
    const result = await runDshOnboardingAttempt({ output, label: 'baseline', artifact, target }, async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
      await writeFile(reportPath, JSON.stringify(passed(target, artifact.version, runId))); return processResult;
    });
    expect(result).toMatchObject({ ...target, status: 'passed' });
    const wrong = await runDshOnboardingAttempt({ output, label: 'candidate', artifact, target }, async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
      await writeFile(reportPath, JSON.stringify(passed(windows, artifact.version, runId))); return processResult;
    });
    expect(wrong).toMatchObject({ ...target, status: 'failed', category: 'infrastructure', check: 'probe-report' });
    expect(wrong.cleanup).toBeUndefined();
  });

  it('snapshots the target before awaiting a fresh child', async () => {
    const target = { platform: 'darwin', arch: 'arm64' }; const output = await directory();
    const report = passed(target);
    const result = await runDshOnboardingAttempt({ output, label: 'baseline', artifact, target }, async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
      target.arch = 'x64'; await writeFile(reportPath, JSON.stringify({ ...report, runId })); return processResult;
    });
    expect(result).toMatchObject({ platform: 'darwin', arch: 'arm64', status: 'passed' });
  });

  it.each(targets)('serializes %j baseline/candidate using the same release owner', async (target) => {
    const events: string[] = []; const candidate = { ...artifact, version: '0.2.2' };
    const result = await runDshOnboardingSequence({ baseline: artifact, candidate }, {
      async install(_build: typeof artifact, label: string) { events.push('install:' + label); return { root: '/owned/' + label }; },
      async probe(_installation: unknown, build: typeof artifact, label: string) { events.push('probe:' + label); return passed(target, build.version); },
      async remove(_installation: unknown, _build: typeof artifact, label: string) { events.push('remove:' + label); },
    }, target);
    expect(result).toMatchObject({ ...target, classification: { kind: 'compatible', notify: false }, installationCleanup: 'removed' });
    expect(events).toEqual(['install:baseline', 'probe:baseline', 'remove:baseline', 'install:candidate', 'probe:candidate', 'remove:candidate']);
  });

  it('stops without removal or a second install when the target identity is wrong', async () => {
    const target = targets[0]; const events: string[] = [];
    const result = await runDshOnboardingSequence({ baseline: artifact, candidate: artifact }, {
      async install() { events.push('install'); return { root: '/owned/baseline' }; },
      async probe() { events.push('probe'); return passed(windows); },
      async remove() { events.push('remove'); },
    }, target);
    expect(result).toMatchObject({ ...target, classification: { kind: 'infrastructure', notify: false }, installationCleanup: 'incomplete', baseline: { ...target, category: 'infrastructure' } });
    expect(events).toEqual(['install', 'probe']);
  });
});

describe('from-zero regression reports stay separate per OS and architecture', () => {
  it.each(targets)('recognizes only independently repeated and fully released %j failures', async (target) => {
    const pinned = JSON.parse(await readFile(new URL('../scripts/dsh-compat-baseline.json', import.meta.url), 'utf8'));
    const manifest = (value: typeof pinned.package) => ({ name: value.name, version: value.version, url: value.dist.tarball, integrity: value.dist.integrity });
    const baseline = manifest(pinned.package); const candidate = { ...baseline, version: '0.2.2', url: 'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.2.tgz' };
    const failed = () => ({ ...passed(target, candidate.version), status: 'failed', category: 'compatibility', stage: 'onboarding', check: DSH_ONBOARDING_CHECKS[1], checks: passed().checks.slice(0, 1), process: { ...processResult, code: 1 } });
    const summary = { schema: 1, tool: DSH_ONBOARDING_TOOL, ...target, scope: DSH_ONBOARDING_SCOPE, installationCleanup: 'removed', classification: { kind: 'regression', notify: true },
      builds: { baseline, candidate, packageManager: manifest(pinned.packageManager) }, baseline: passed(target), candidate: failed(), retry: failed() };
    const expected = `<!-- dsh-onboarding-compat:0.2.2:${target.platform}-${target.arch}:${DSH_ONBOARDING_CHECKS[1]} -->`;
    expect(dshOnboardingRegressionIdentity(summary)?.marker).toBe(expected);
    expect(dshOnboardingRegressionIdentity({ ...summary, retry: { ...summary.retry, ...windows } })).toBeUndefined();
    expect(dshOnboardingRegressionIdentity({ ...summary, retry: { ...summary.retry, cleanup: { ...summary.retry.cleanup, forced: true } } })).toBeUndefined();
  });
});
