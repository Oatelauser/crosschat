import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseDshDesktopWindowsManifest, parseDshNpmManifest } from '../scripts/dsh-compat-ci.mjs';

const pinned = JSON.parse(await readFile(new URL('../scripts/dsh-compat-baseline.json', import.meta.url), 'utf8'));

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
