import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import * as desktopCI from '../scripts/opencode-desktop-compat-ci.mjs';
import {
  desktopLifecycleFailure,
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
  return { schema: 1, tool: 'opencode-desktop', platform: 'win32', arch: 'x64', version, status: 'passed', stage: 'done', checks: [],
    cleanup: { appStopped: true, serviceStopped: true, removed: true, runProcesses: { state: 'clear' } } };
}
function failed(version: string) {
  return { ...passed(version), status: 'failed', stage: 'desktop-contract', check: 'visible-session-incoming', category: 'compatibility' };
}

describe('OpenCode Desktop CI evidence', () => {
  it('preserves PowerShell lifecycle exit, timeout and output when a helper fails', () => {
    const failure = desktopLifecycleFailure({ code: null, signal: 'SIGTERM', timedOut: true,
      stdout: '{"protocolCommand":"C:\\private\\uninstall.exe /S"}', stderr: 'parser diagnostic' }, 'inspect Windows installation state');
    expect(failure).toContain('inspect Windows installation state');
    expect(failure).toContain('exitCode=null, signal=SIGTERM, timedOut=true');
    expect(failure).toContain('stderr (last 17 bytes): parser diagnostic');
    expect(failure).toContain('stdoutBytes=49');
    expect(failure).not.toContain('private');

    const longError = 'x'.repeat(5000);
    const bounded = desktopLifecycleFailure({ code: 1, signal: null, timedOut: false, stdout: '', stderr: longError }, 'verify signature');
    expect(bounded).toContain('stderr (last 4000 bytes):');
    expect(bounded).toHaveLength('Desktop Windows lifecycle helper "verify signature" failed (exitCode=1, signal=none, timedOut=false, stdoutBytes=0): stderr (last 4000 bytes): '.length + 4000);
    const unicodeError = '\u754c'.repeat(5000);
    const unicodeFailure = desktopLifecycleFailure({ code: 1, signal: null, timedOut: false, stdout: '', stderr: unicodeError }, 'probe');
    expect(unicodeFailure).toContain('stderr (last 3999 bytes):');
    const unicodeOutput = unicodeFailure.split('stderr (last 3999 bytes): ')[1];
    expect(Buffer.byteLength(unicodeOutput, 'utf8')).toBe(3999);
    expect(unicodeOutput).toBe(unicodeError.slice(-1333));

    expect(desktopLifecycleFailure({ code: 1, signal: null, timedOut: false, stdout: '', stderr: '' }, 'probe'))
      .toContain('no stderr output');
  });

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

  it('retains the installation and stops all later attempts when a probe crashes with unknown release state', async () => {
    const calls: string[] = [];
    const summary = await runDesktopBuildSequence({ baseline, candidate }, {
      install: async (_artifact: unknown, label: string) => { calls.push(`install:${label}`); return { label }; },
      probe: async (installation: { label: string }, artifact: typeof baseline) => { if (installation.label === 'baseline') return passed(artifact.version); throw new Error('runner unavailable'); },
      uninstall: async (installation: { label: string }) => { calls.push(`uninstall:${installation.label}`); },
    });
    expect(calls).toEqual(['install:baseline', 'uninstall:baseline', 'install:candidate']);
    expect(summary.classification).toEqual({ kind: 'infrastructure', notify: false });
    expect(desktopRegressionIdentity(summary)).toBeUndefined();
  });

  it('does not uninstall or advance when an otherwise valid report lacks complete runtime-release evidence', async () => {
    for (const cleanup of [undefined, { appStopped: true, serviceStopped: true, removed: true },
      { appStopped: true, serviceStopped: false, removed: true, runProcesses: { state: 'clear' } },
      { appStopped: true, serviceStopped: true, removed: true, runProcesses: { state: 'unknown' } },
      { appStopped: true, serviceStopped: true, removed: true, runProcesses: { state: 'clear' }, errors: ['cleanup was incomplete'] }]) {
      const calls: string[] = [];
      const summary = await runDesktopBuildSequence({ baseline, candidate }, {
        install: async (_artifact: unknown, label: string) => { calls.push(`install:${label}`); return { label }; },
        probe: async (_installation: unknown, artifact: typeof baseline) => ({ ...passed(artifact.version), cleanup }),
        uninstall: async () => { calls.push('uninstall'); },
      });
      expect(calls).toEqual(['install:baseline']);
      expect(summary.classification).toEqual({ kind: 'infrastructure', notify: false });
    }
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

describe('OpenCode Desktop CI probe process evidence', () => {
  async function isolated(run: (output: string) => Promise<void>) {
    const output = await mkdtemp(join(tmpdir(), 'crosschat-desktop-ci-test-'));
    try { await run(output); } finally { await rm(output, { recursive: true, force: true }); }
  }
  const normal = { code: 0, signal: null, timedOut: false };

  it('uses a unique empty report location for every attempt and cannot reuse an earlier PASS', async () => {
    await isolated(async (output) => {
      const stale = join(output, 'baseline.json');
      await writeFile(stale, JSON.stringify(passed(baseline.version)));
      const paths: string[] = [];
      const first = await desktopCI.runDesktopProbeAttempt({ output, label: 'baseline', version: baseline.version }, async ({ reportPath }: { reportPath: string }) => {
        paths.push(reportPath); await writeFile(reportPath, JSON.stringify(passed(baseline.version))); return normal;
      });
      const second = await desktopCI.runDesktopProbeAttempt({ output, label: 'baseline', version: baseline.version }, async ({ reportPath }: { reportPath: string }) => {
        paths.push(reportPath); return normal;
      });
      expect(first.status).toBe('passed');
      expect(paths[0]).not.toBe(stale);
      expect(paths[1]).not.toBe(paths[0]);
      expect(second).toMatchObject({ status: 'failed', category: 'infrastructure' });
      expect(second.cleanup).toBeUndefined();
      expect(JSON.parse(await readFile(stale, 'utf8')).status).toBe('passed');
    });
  });

  it('rejects timeout, signal, unknown exit code and exit/report disagreement even with a fresh PASS file', async () => {
    await isolated(async (output) => {
      for (const processResult of [{ ...normal, timedOut: true }, { ...normal, signal: 'SIGTERM' },
        { ...normal, code: null }, { ...normal, code: 2 }, { ...normal, code: 1 }]) {
        const result = await desktopCI.runDesktopProbeAttempt({ output, label: 'candidate', version: candidate.version }, async ({ reportPath }: { reportPath: string }) => {
          await writeFile(reportPath, JSON.stringify(passed(candidate.version))); return processResult;
        });
        expect(result).toMatchObject({ status: 'failed', category: 'infrastructure' });
        expect(result.cleanup).toBeUndefined();
      }
      const failureWithZeroExit = await desktopCI.runDesktopProbeAttempt({ output, label: 'candidate', version: candidate.version }, async ({ reportPath }: { reportPath: string }) => {
        await writeFile(reportPath, JSON.stringify(failed(candidate.version))); return normal;
      });
      expect(failureWithZeroExit).toMatchObject({ status: 'failed', category: 'infrastructure' });
      expect(failureWithZeroExit.cleanup).toBeUndefined();
      const crashed = await desktopCI.runDesktopProbeAttempt({ output, label: 'candidate', version: candidate.version }, async ({ reportPath }: { reportPath: string }) => {
        await writeFile(reportPath, JSON.stringify(passed(candidate.version))); throw new Error('probe runner rejected after creating a report');
      });
      expect(crashed).toMatchObject({ status: 'failed', category: 'infrastructure' });
      expect(crashed.cleanup).toBeUndefined();
    });
  });

  it('accepts fresh consistent normal failure evidence and rejects malformed or wrong-build reports', async () => {
    await isolated(async (output) => {
      const failure = await desktopCI.runDesktopProbeAttempt({ output, label: 'candidate', version: candidate.version }, async ({ reportPath }: { reportPath: string }) => {
        await writeFile(reportPath, JSON.stringify(failed(candidate.version))); return { ...normal, code: 1 };
      });
      expect(failure).toEqual(failed(candidate.version));
      for (const text of ['{bad json', JSON.stringify(passed(baseline.version)), JSON.stringify({ ...passed(candidate.version), tool: 'opencode-cli' })]) {
        const result = await desktopCI.runDesktopProbeAttempt({ output, label: 'candidate', version: candidate.version }, async ({ reportPath }: { reportPath: string }) => {
          await writeFile(reportPath, text); return normal;
        });
        expect(result).toMatchObject({ status: 'failed', category: 'infrastructure' });
        expect(result.cleanup).toBeUndefined();
      }
    });
  });

  it('does not uninstall, retry or continue after a timed-out process left a fresh report claiming PASS', async () => {
    await isolated(async (output) => {
      const calls: string[] = [];
      const summary = await runDesktopBuildSequence({ baseline, candidate }, {
        install: async (_artifact: unknown, label: string) => { calls.push(`install:${label}`); return { label }; },
        probe: async (_installation: unknown, artifact: typeof baseline, label: string) => desktopCI.runDesktopProbeAttempt({ output, label, version: artifact.version }, async ({ reportPath }: { reportPath: string }) => {
          await writeFile(reportPath, JSON.stringify(passed(artifact.version))); return { ...normal, timedOut: true };
        }),
        uninstall: async () => { calls.push('uninstall'); },
      });
      expect(calls).toEqual(['install:baseline']);
      expect(summary.classification).toEqual({ kind: 'infrastructure', notify: false });
    });
  });
});

describe('OpenCode Desktop isolated report job', () => {
  async function reported(summary: unknown) {
    const workflow = await readFile(new URL('../.github/workflows/opencode-compat.yml', import.meta.url), 'utf8');
    const script = workflow.split(/ {10}script: \|\r?\n/)[1].split(/\r?\n/).map((line) => line.replace(/^ {12}/, '')).join('\n');
    const created: unknown[] = [];
    await runInNewContext(`(async () => {${script}\n})()`, {
      require: (name: string) => {
        if (name !== 'node:fs/promises') throw new Error(`Unexpected report dependency ${name}`);
        return { readdir: async () => [{ name: 'desktop', isDirectory: () => true }], readFile: async () => JSON.stringify(summary) };
      },
      context: { serverUrl: 'https://github.com', repo: { owner: 'test', repo: 'fixture' }, runId: 1 },
      core: { notice: () => {} },
      github: { paginate: async () => [], rest: { issues: { listForRepo: {}, create: async (input: unknown) => { created.push(input); } } } },
    });
    return created;
  }

  it('applies the same candidate-stage validation as desktopRegressionIdentity before creating an issue', async () => {
    const summary = { schema: 1, tool: 'opencode-desktop', platform: 'win32', arch: 'x64', builds: { baseline, candidate },
      baseline: passed(baseline.version), candidate: failed(candidate.version), retry: failed(candidate.version), classification: { kind: 'regression', notify: true } };
    expect(desktopRegressionIdentity(summary)).toBeDefined();
    expect(await reported(summary)).toHaveLength(1);
    for (const stage of [undefined, '', 'invalid\nstage', 'a'.repeat(81)]) {
      const invalid = { ...summary, candidate: { ...summary.candidate, stage }, retry: { ...summary.retry, stage } };
      expect(desktopRegressionIdentity(invalid)).toBeUndefined();
      expect(await reported(invalid)).toHaveLength(0);
    }
  });
});
