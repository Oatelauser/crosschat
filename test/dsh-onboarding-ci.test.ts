import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DSH_ONBOARDING_CHECKS, DSH_ONBOARDING_SCOPE, DSH_ONBOARDING_TOOL, validDshOnboardingProcessReport, validDshOnboardingReport } from '../scripts/dsh-onboarding-contract.mjs';
import { resolveDshCiSuite, runDshOnboardingAttempt, runDshOnboardingSequence } from '../scripts/dsh-compat-ci.mjs';

// File symlinks require privileges on this Windows host (EPERM). Supply only
// the filesystem's nonregular/link observation; real report bytes remain valid.
const reportLink = vi.hoisted(() => ({ active: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat: async (path: string) => reportLink.active && path.endsWith('report.json')
    ? { isFile: () => false, isSymbolicLink: () => true, size: 1 } : actual.lstat(path) };
});

const artifact = { name: '@deepseek-ai/dsh', version: '0.2.1-rc.2' };
const runId = '11111111-1111-4111-8111-111111111111';
const roots: string[] = [];
afterEach(async () => { reportLink.active = false; for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function directory() { const root = await mkdtemp(join(tmpdir(), 'crosschat-dsh-onboarding-unit-')); roots.push(root); return root; }
function passed() {
  return { schema: 1, tool: DSH_ONBOARDING_TOOL, platform: 'win32', arch: 'x64', version: artifact.version, runId,
    scope: { ...DSH_ONBOARDING_SCOPE }, status: 'passed', category: null, stage: 'done',
    checks: DSH_ONBOARDING_CHECKS.map((name: string) => ({ name, status: 'passed', elapsedMs: 5 })),
    cleanup: { runtimeStopped: true, registrationRemoved: true, removed: true, forced: false },
    process: { code: 0, signal: null, timedOut: false },
  };
}

describe('DSH from-zero onboarding report boundary', () => {
  it('accepts a complete fresh onboarding report independently of the communication schema', () => {
    expect(validDshOnboardingReport(passed(), artifact, runId)).toBe(true);
    expect(validDshOnboardingProcessReport(passed(), artifact)).toBe(true);
  });

  it.each([
    { tool: 'dsh-web-runtime' }, { platform: 'linux' }, { arch: 'arm64' }, { version: '0.2.1-rc.3' },
    { runId: '11111111-1111-1111-1111-111111111111' }, { runId: '22222222-2222-4222-8222-222222222222' },
  ])('rejects a mismatched producer, build or fresh attempt: %j', (change) => {
    expect(validDshOnboardingReport({ ...passed(), ...change }, artifact, runId)).toBe(false);
  });

  it('rejects omitted or expanded evidence claims instead of treating them as a full onboarding pass', () => {
    const missing: Record<string, boolean> = { ...DSH_ONBOARDING_SCOPE }; delete missing.skillLifecycle;
    for (const scope of [missing, { ...DSH_ONBOARDING_SCOPE, browserUI: true }, { ...DSH_ONBOARDING_SCOPE, desktop: true },
      { ...DSH_ONBOARDING_SCOPE, otherPlatform: true }]) expect(validDshOnboardingReport({ ...passed(), scope }, artifact, runId)).toBe(false);
  });

  it('requires every successful phase once, in order, with valid timing', () => {
    const report = passed();
    for (const checks of [report.checks.slice(0, -1), [...report.checks].reverse(), [...report.checks, report.checks[0]],
      report.checks.map((check, index) => index ? check : { ...check, name: 'synthetic-adapter-only' }),
      report.checks.map((check, index) => index ? check : { ...check, elapsedMs: -1 })]) {
      expect(validDshOnboardingReport({ ...report, checks }, artifact, runId)).toBe(false);
    }
  });

  it('retains a real failure at the next phase without claiming a complete pass or inventing release', () => {
    const report = { ...passed(), status: 'failed', category: 'compatibility', stage: 'onboarding',
      check: DSH_ONBOARDING_CHECKS[2], checks: passed().checks.slice(0, 2),
      cleanup: { runtimeStopped: false, registrationRemoved: false, removed: false, forced: false } };
    expect(validDshOnboardingReport(report, artifact, runId)).toBe(true);
    expect(validDshOnboardingReport({ ...report, check: DSH_ONBOARDING_CHECKS[0] }, artifact, runId)).toBe(false);
    expect(validDshOnboardingReport({ ...report, status: 'passed', stage: 'done', category: null }, artifact, runId)).toBe(false);
  });

  it('requires explicit cleanup observations instead of coercing unknown values', () => {
    for (const cleanup of [undefined, {}, { ...passed().cleanup, runtimeStopped: 'true' }, { ...passed().cleanup, forced: null }]) {
      expect(validDshOnboardingReport({ ...passed(), cleanup }, artifact, runId)).toBe(false);
    }
    for (const cleanup of [{ ...passed().cleanup, removed: false }, { ...passed().cleanup, forced: true }, { ...passed().cleanup, errors: ['unreleased'] }]) {
      expect(validDshOnboardingReport({ ...passed(), cleanup }, artifact, runId)).toBe(false);
    }
    expect(validDshOnboardingReport({ ...passed(), status: 'failed', category: 'infrastructure', stage: 'cleanup', check: 'owned-cleanup',
      cleanup: { runtimeStopped: true, registrationRemoved: false, removed: false, forced: true } }, artifact, runId)).toBe(true);
  });

  it('checks normal process completion against the report outcome', () => {
    for (const process of [undefined, { code: 1, signal: null, timedOut: false }, { code: 0, signal: 'SIGTERM', timedOut: false },
      { code: 0, signal: null, timedOut: true }]) expect(validDshOnboardingProcessReport({ ...passed(), process }, artifact)).toBe(false);
    const failure = { ...passed(), status: 'failed', category: 'compatibility', stage: 'onboarding', check: DSH_ONBOARDING_CHECKS[0], checks: [], process: { code: 1, signal: null, timedOut: false } };
    expect(validDshOnboardingProcessReport(failure, artifact)).toBe(true);
  });

  it('rejects a failed claim that omits the failed phase after all phases passed', () => {
    expect(validDshOnboardingReport({ ...passed(), status: 'failed', category: 'compatibility', stage: 'onboarding' }, artifact, runId)).toBe(false);
  });
});

describe('onboarding fresh attempts and serial resource ownership', () => {
  const processResult = { code: 0, signal: null, timedOut: false };
  const builds = { baseline: artifact, candidate: { ...artifact, version: '0.2.2' } };
  const successful = (version: string) => ({ ...passed(), version, runId: randomUUID() });

  it('accepts only the freshly minted report and never reuses a preceding PASS', async () => {
    const output = await directory(); let previousId = '';
    const first = await runDshOnboardingAttempt({ output, label: 'baseline', artifact }, async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
      previousId = runId; await writeFile(reportPath, JSON.stringify({ ...passed(), runId })); return processResult;
    });
    expect(first.status).toBe('passed');
    const stale = await runDshOnboardingAttempt({ output, label: 'baseline', artifact }, async ({ reportPath }: { reportPath: string }) => {
      await writeFile(reportPath, JSON.stringify({ ...passed(), runId: previousId })); return processResult;
    });
    expect(stale).toMatchObject({ tool: DSH_ONBOARDING_TOOL, category: 'infrastructure', check: 'probe-report' });
    expect(stale.cleanup).toBeUndefined();
  });

  it('rejects filesystem link metadata before accepting otherwise valid report bytes', async () => {
    const output = await directory();
    const result = await runDshOnboardingAttempt({ output, label: 'candidate', artifact }, async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
      await writeFile(reportPath, JSON.stringify({ ...passed(), runId })); reportLink.active = true;
      return processResult;
    });
    expect(result).toMatchObject({ category: 'infrastructure', check: 'probe-report' });
  });

  it('retains an installation with incomplete release and never enters the next build or removes it', async () => {
    const events: string[] = [];
    const result = await runDshOnboardingSequence(builds, {
      async install(value: typeof artifact, label: string) { events.push(`install:${label}`); return { root: `/owned/${value.version}` }; },
      async probe() { events.push('probe'); return { ...successful(artifact.version), status: 'failed', category: 'infrastructure', stage: 'cleanup', check: 'owned-cleanup',
        cleanup: { runtimeStopped: true, registrationRemoved: false, removed: false, forced: false }, process: { code: 1, signal: null, timedOut: false } }; },
      async remove() { events.push('remove'); },
    });
    expect(events).toEqual(['install:baseline', 'probe']);
    expect(result).toMatchObject({ tool: DSH_ONBOARDING_TOOL, installationCleanup: 'incomplete', classification: { kind: 'infrastructure', notify: false }, retainedInstallation: { label: 'baseline', root: `/owned/${artifact.version}` } });
  });

  it('uses the same candidate twice only after both observed runtime and installation releases', async () => {
    const events: string[] = [];
    const result = await runDshOnboardingSequence(builds, {
      async install(value: typeof artifact, label: string) { events.push(`install:${label}:${value.version}`); return { root: `/owned/${label}` }; },
      async probe(_installation: unknown, value: typeof artifact, label: string) {
        events.push(`probe:${label}`);
        return label === 'baseline' ? successful(value.version) : { ...successful(value.version), status: 'failed', category: 'compatibility', stage: 'onboarding',
          check: DSH_ONBOARDING_CHECKS[1], checks: passed().checks.slice(0, 1), process: { code: 1, signal: null, timedOut: false } };
      },
      async remove(_installation: unknown, _value: typeof artifact, label: string) { events.push(`remove:${label}`); },
    });
    expect(result).toMatchObject({ tool: DSH_ONBOARDING_TOOL, installationCleanup: 'removed', classification: { kind: 'regression', notify: true } });
    expect(events).toEqual(['install:baseline:0.2.1-rc.2', 'probe:baseline', 'remove:baseline', 'install:candidate:0.2.2', 'probe:candidate', 'remove:candidate', 'install:retry:0.2.2', 'probe:retry', 'remove:retry']);
  });
});

describe('independent communication and onboarding CI entry points', () => {
  it.each([undefined, 'communication'])('preserves the existing communication default (%s)', (value) => {
    expect(resolveDshCiSuite(value)).toMatchObject({ tool: 'dsh-web-runtime', evidenceDirectory: 'dsh-compat-evidence', script: 'dsh-compat.mjs', timeoutMs: 360000,
      scope: { officialNpmRuntime: true, ordinaryWebSessions: true, browserUI: false, desktop: false } });
  });
  it('binds onboarding to its complete report and independent artifact directory', () => {
    const selected = resolveDshCiSuite('onboarding');
    expect(selected).toMatchObject({ tool: DSH_ONBOARDING_TOOL, scope: DSH_ONBOARDING_SCOPE, evidenceDirectory: 'dsh-onboarding-evidence', script: 'dsh-onboarding.mjs', timeoutMs: 600000 });
    expect(selected.attempt).toBe(runDshOnboardingAttempt); expect(selected.sequence).toBe(runDshOnboardingSequence);
    expect(Object.isFrozen(selected.scope)).toBe(true);
  });
  it.each(['', 'desktop', 'ONBOARDING', false])('rejects an unknown suite instead of running the communication default (%s)', (value) => {
    expect(() => resolveDshCiSuite(value)).toThrow();
  });
});
