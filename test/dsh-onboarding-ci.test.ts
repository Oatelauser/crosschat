import { describe, expect, it } from 'vitest';
import { DSH_ONBOARDING_CHECKS, DSH_ONBOARDING_SCOPE, DSH_ONBOARDING_TOOL, validDshOnboardingProcessReport, validDshOnboardingReport } from '../scripts/dsh-onboarding-contract.mjs';

const artifact = { name: '@deepseek-ai/dsh', version: '0.2.1-rc.2' };
const runId = '11111111-1111-4111-8111-111111111111';
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
});
