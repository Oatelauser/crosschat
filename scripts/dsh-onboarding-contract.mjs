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
  'profile-preserving-skill-update-and-removal',
  'official-plugin-removal-and-owned-cleanup',
]);

export function validDshOnboardingReport() { return false; }
export function validDshOnboardingProcessReport() { return false; }
