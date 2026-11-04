// Separate from the existing eight-check communication report and its hosted workflow.
export const DSH_ONBOARDING_TOOL = 'dsh-onboarding';
export const DSH_ONBOARDING_SCOPE = Object.freeze({ officialNpmRuntime: true, officialPluginManager: true,
  ordinaryWebSessions: true, scriptedLocalModel: true, skillLifecycle: true, diagnostics: true, tui: true,
  browserUI: false, desktop: false, modelIntelligence: false });
export const DSH_ONBOARDING_CHECKS = Object.freeze([
  'official-profile-plugin-and-skill-installation',
  'native-skill-load-and-current-source',
  'native-roundtrip-and-typed-discovery',
  'same-source-diagnostics-and-real-terminal',
  'skill-update-and-profile-preserving-shutdown',
  'official-plugin-and-crosschat-removal-with-owned-cleanup',
]);

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

/** The caller supplies the already verified official artifact and, for a fresh child, its minted UUID. */
export function validDshOnboardingReport(input, artifact, runId) {
  if (!record(input) || !record(artifact) || artifact.name !== '@deepseek-ai/dsh' || typeof artifact.version !== 'string'
    || input.schema !== 1 || input.tool !== DSH_ONBOARDING_TOOL || input.platform !== 'win32' || input.arch !== 'x64'
    || input.version !== artifact.version || !uuid.test(input.runId ?? '') || (runId !== undefined && input.runId !== runId)
    || !record(input.scope) || Object.keys(input.scope).length !== Object.keys(DSH_ONBOARDING_SCOPE).length
    || !Object.entries(DSH_ONBOARDING_SCOPE).every(([key, value]) => Object.hasOwn(input.scope, key) && input.scope[key] === value)
    || !Array.isArray(input.checks) || input.checks.length > DSH_ONBOARDING_CHECKS.length
    || !input.checks.every((check, index) => record(check) && check.name === DSH_ONBOARDING_CHECKS[index] && check.status === 'passed'
      && Number.isFinite(check.elapsedMs) && check.elapsedMs >= 0)
    || !record(input.cleanup) || !['runtimeStopped', 'registrationRemoved', 'removed', 'forced'].every((key) => typeof input.cleanup[key] === 'boolean')
    || (input.cleanup.errors !== undefined && (!Array.isArray(input.cleanup.errors) || !input.cleanup.errors.every((error) => typeof error === 'string')))) return false;
  if (input.status === 'passed') return input.stage === 'done' && input.category === null && input.check === undefined && input.error === undefined
    && input.checks.length === DSH_ONBOARDING_CHECKS.length && input.cleanup.runtimeStopped && input.cleanup.registrationRemoved
    && input.cleanup.removed && !input.cleanup.forced && !input.cleanup.errors?.length;
  return input.status === 'failed' && typeof input.check === 'string' && ['compatibility', 'infrastructure'].includes(input.category)
    && ['setup', 'onboarding', 'cleanup'].includes(input.stage)
    && (input.check === DSH_ONBOARDING_CHECKS[input.checks.length]
      || (input.category === 'infrastructure' && input.stage === 'cleanup' && input.check === 'owned-cleanup'));
}

export function validDshOnboardingProcessReport(input, artifact) {
  return validDshOnboardingReport(input, artifact) && record(input.process)
    && input.process.code === (input.status === 'passed' ? 0 : 1) && input.process.signal === null && input.process.timedOut === false;
}
