import { describe, expect, it } from 'vitest';
import {
  desktopRegressionIdentity,
  parseDesktopArtifactManifest,
  runDesktopBuildSequence,
  validateDesktopSignature,
} from '../scripts/opencode-desktop-compat-ci.mjs';

const publisher = 'CN="Anomaly Innovations, Inc https://anoma.ly/", O="Anomaly Innovations, Inc https://anoma.ly/", L=Dover, S=Delaware, C=US';
function manifest(version = '2.1.3', sha256 = 'a'.repeat(64)) {
  return { version, name: 'desktop', distribution: 'opencode', metadata: { github: { sha: 'c'.repeat(40) }, files: {
    'opencode-desktop-win-x64.exe': { url: `https://opencode.ai/files/bin/${version}/opencode-desktop-win-x64.exe`, sha256, size: 250321424 },
  } } };
}
const baseline = { version: '2.1.3', filename: 'opencode-desktop-win-x64.exe', url: 'https://opencode.ai/files/bin/2.1.3/opencode-desktop-win-x64.exe', sha256: 'a'.repeat(64), size: 250321424, sourceCommit: 'c'.repeat(40) };
const candidate = { ...baseline, version: '2.1.4', url: 'https://opencode.ai/files/bin/2.1.4/opencode-desktop-win-x64.exe', sha256: 'b'.repeat(64) };
function passed(version: string) {
  return { schema: 1, tool: 'opencode-desktop', platform: 'win32', arch: 'x64', version, status: 'passed', stage: 'done', checks: [] };
}
function failed(version: string) {
  return { ...passed(version), status: 'failed', stage: 'desktop-contract', check: 'visible-session-incoming', category: 'compatibility' };
}

describe('OpenCode Desktop CI evidence', () => {
  it('pins the official Windows desktop installer and its distinct desktop source commit', () => {
    expect(parseDesktopArtifactManifest(manifest(), 'win32', 'x64')).toEqual(baseline);
    expect(() => parseDesktopArtifactManifest({ ...manifest(), name: 'cli' }, 'win32', 'x64')).toThrow();
    expect(() => parseDesktopArtifactManifest(manifest(), 'linux', 'x64')).toThrow();
  });

  it('rejects a mutable/unrelated download, invalid digest/size/source and an unapproved major', () => {
    const bad = manifest();
    bad.metadata.files['opencode-desktop-win-x64.exe'].url = 'https://unrelated.example/installer.exe';
    expect(() => parseDesktopArtifactManifest(bad, 'win32', 'x64')).toThrow();
    expect(() => parseDesktopArtifactManifest(manifest('2.1.3', 'bad'), 'win32', 'x64')).toThrow();
    const badSize = manifest(); badSize.metadata.files['opencode-desktop-win-x64.exe'].size = -1;
    expect(() => parseDesktopArtifactManifest(badSize, 'win32', 'x64')).toThrow();
    const badSource = manifest(); badSource.metadata.github.sha = '';
    expect(() => parseDesktopArtifactManifest(badSource, 'win32', 'x64')).toThrow();
    expect(() => parseDesktopArtifactManifest(manifest('3.0.0'), 'win32', 'x64')).toThrow(expect.objectContaining({ category: 'unsupported', version: '3.0.0' }));
  });

  it('requires a valid Authenticode publisher organization without pinning a rotating thumbprint', () => {
    expect(validateDesktopSignature({ status: 'Valid', subject: publisher, thumbprint: 'old' })).toBe(true);
    expect(validateDesktopSignature({ status: 'Valid', subject: publisher, thumbprint: 'new' })).toBe(true);
    expect(() => validateDesktopSignature({ status: 'NotSigned', subject: publisher })).toThrow();
    expect(() => validateDesktopSignature({ status: 'Valid', subject: 'CN="Anomaly Innovations, Inc https://anoma.ly/", O="Other Publisher"' })).toThrow();
  });

  it('uninstalls each same-GUID build before installing the next, and retries the identical candidate artifact', async () => {
    const calls: string[] = [];
    const candidateArtifacts: unknown[] = [];
    const summary = await runDesktopBuildSequence({ baseline, candidate }, {
      install: async (artifact: typeof baseline, label: string) => { calls.push(`install:${label}`); if (label !== 'baseline') candidateArtifacts.push(artifact); return { label }; },
      probe: async (installation: { label: string }, artifact: typeof baseline) => { calls.push(`probe:${installation.label}`); return installation.label === 'baseline' ? passed(artifact.version) : failed(artifact.version); },
      uninstall: async (installation: { label: string }) => { calls.push(`uninstall:${installation.label}`); },
    });
    expect(calls).toEqual(['install:baseline', 'probe:baseline', 'uninstall:baseline', 'install:candidate', 'probe:candidate', 'uninstall:candidate', 'install:retry', 'probe:retry', 'uninstall:retry']);
    expect(candidateArtifacts).toEqual([candidate, candidate]);
    expect(summary.classification).toEqual({ kind: 'regression', notify: true });
    expect(desktopRegressionIdentity(summary)?.marker).toBe('<!-- opencode-desktop-compat:2.1.4:win32:visible-session-incoming -->');
  });

  it('uninstalls a crashing probe and treats runtime/network faults as infrastructure', async () => {
    const calls: string[] = [];
    const summary = await runDesktopBuildSequence({ baseline, candidate }, {
      install: async (_artifact: unknown, label: string) => ({ label }),
      probe: async (installation: { label: string }, artifact: typeof baseline) => { if (installation.label === 'baseline') return passed(artifact.version); throw new Error('runner unavailable'); },
      uninstall: async (installation: { label: string }) => { calls.push(installation.label); },
    });
    expect(calls).toEqual(['baseline', 'candidate', 'retry']);
    expect(summary.classification).toEqual({ kind: 'infrastructure', notify: false });
    expect(desktopRegressionIdentity(summary)).toBeUndefined();
  });

  it('stops before the next install if uninstall or the clean-registry checkpoint fails', async () => {
    const calls: string[] = [];
    const summary = await runDesktopBuildSequence({ baseline, candidate }, {
      install: async (_artifact: unknown, label: string) => { calls.push(label); return { label }; },
      probe: async (_installation: unknown, artifact: typeof baseline) => passed(artifact.version),
      uninstall: async () => { throw new Error('registry still has the installed GUID'); },
    });
    expect(calls).toEqual(['baseline']);
    expect(summary.classification).toEqual({ kind: 'infrastructure', notify: false });
  });

  it('does not report a flaky failure, different failed check, or wrong-tool/mismatched-build evidence', async () => {
    async function sequence(retry: Record<string, unknown>) {
      return runDesktopBuildSequence({ baseline, candidate }, {
        install: async (_artifact: unknown, label: string) => ({ label }),
        probe: async (installation: { label: string }, artifact: typeof baseline) => installation.label === 'baseline' ? passed(artifact.version) : installation.label === 'candidate' ? failed(artifact.version) : retry,
        uninstall: async () => {},
      });
    }
    expect((await sequence(passed('2.1.4'))).classification).toEqual({ kind: 'flaky', notify: false });
    expect((await sequence({ ...failed('2.1.4'), check: 'different-check' })).classification.notify).toBe(false);
    expect((await sequence({ ...failed('2.1.4'), tool: 'opencode-cli' })).classification.notify).toBe(false);
    expect((await sequence(failed('2.1.5'))).classification.notify).toBe(false);
    const fabricated = { schema: 1, tool: 'opencode-desktop', platform: 'win32', arch: 'x64', builds: { baseline, candidate }, baseline: passed('2.1.3'), candidate: failed('2.1.4'), retry: failed('2.1.4'), classification: { kind: 'regression', notify: true } };
    expect(desktopRegressionIdentity({ ...fabricated, candidate: { ...fabricated.candidate, check: 'bad\n<!--body-->' } })).toBeUndefined();
    expect(desktopRegressionIdentity({ ...fabricated, tool: 'opencode-cli' })).toBeUndefined();
  });
});
