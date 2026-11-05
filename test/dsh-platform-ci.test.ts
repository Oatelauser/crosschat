import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseDshDesktopWindowsManifest, parseDshNpmManifest, runDshProbeAttempt } from '../scripts/dsh-compat-ci.mjs';

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
});
