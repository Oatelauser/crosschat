// Planned npm/Web validation targets; this is not a claim of native acceptance.
export const DEFAULT_DSH_NPM_TARGET = Object.freeze({ platform: 'win32', arch: 'x64' });

export function isDshNpmTarget(platform, arch) {
  return ((platform === 'win32' || platform === 'linux') && arch === 'x64')
    || (platform === 'darwin' && (arch === 'x64' || arch === 'arm64'));
}
