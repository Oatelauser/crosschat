import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  claudeCompatibilityScope, claudeRequiredChecks, claudeRegressionIdentity,
  createClaudeTaskRoot, extractClaudeNativeArchive, hasClaudeRuntimeReleaseProof, parseClaudeLatestManifest, parseClaudeNpmManifest,
  removeClaudeOwnedPath, runClaudeBuildSequence, runClaudeProbeAttempt, runClaudeProcess, verifyClaudeNpmArtifact,
} from '../scripts/claude-compat-ci.mjs';

const name = '@anthropic-ai/claude-code-win32-x64';
const baselineIntegrity = 'sha512-b4Ju2gf1VliNsF9dONk/G1xZEW3Zg+G4TgpOS5oXPHSsMIciczcF267//7RvtjEXghflc3Lwrqe+Q4iNMf2ukQ==';
const candidateIntegrity = `sha512-${Buffer.alloc(64, 2).toString('base64')}`;
const manifest = (version = '2.1.309', integrity = baselineIntegrity) => ({ name, version, dist: { tarball: `https://registry.npmjs.org/${name}/-/claude-code-win32-x64-${version}.tgz`, integrity } });
const artifact = (version = '2.1.309', integrity = baselineIntegrity) => ({ name, version, url: manifest(version, integrity).dist.tarball, integrity });
const builds = { baseline: artifact(), candidate: artifact('2.1.310', candidateIntegrity) };
const scope = { officialNativeCLI: true, productionWrapper: true, scriptedLocalModel: true, streamJSON: true, interactiveTUI: false, desktop: false, modelIntelligence: false };
const checks = ['official-wrapper-and-native-session-registration', 'messages-model-and-native-bash-identity', 'production-discovery-and-idle-queue-steer',
  'busy-queue-step-boundary', 'busy-steer-step-boundary', 'native-shell-send-and-conversation-reply', 'exit-and-missing-target-do-not-create-session'];
const cleanup = { runtimeStopped: true, registrationRemoved: true, modelClosed: true, removed: true, forced: false, errors: [] };
const passed = (version: string, runId = randomUUID()) => ({ schema: 1, tool: 'claude-code-cli', platform: 'win32', arch: 'x64', version, runId, scope,
  status: 'passed', stage: 'done', category: null, checks: checks.map((name) => ({ name, status: 'passed', elapsedMs: 1 })), cleanup,
  process: { code: 0, signal: null, timedOut: false } });
const failed = (version: string, runId = randomUUID()) => ({ ...passed(version, runId), status: 'failed', stage: 'contract', category: 'compatibility',
  check: 'busy-queue-step-boundary', checks: checks.slice(0, 3).map((name) => ({ name, status: 'passed', elapsedMs: 1 })), process: { code: 1, signal: null, timedOut: false } });

async function isolated(work: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crosschat-claude-ci-test-')));
  try { await work(root); } finally { await rm(root, { recursive: true, force: true }); }
}

interface TarEntry { name: string; content?: string; type?: string; size?: number; corruptChecksum?: boolean }
function nativeArchive(entries: TarEntry[]) {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const content = Buffer.from(entry.content ?? ''); const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(`${(entry.size ?? content.length).toString(8).padStart(11, '0')}\0`, 124);
    header.write('00000000000\0', 136); header.fill(32, 148, 156); header.write(entry.type ?? '0', 156);
    header.write('ustar\0', 257); header.write('00', 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0) + (entry.corruptChecksum ? 1 : 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, content, Buffer.alloc((512 - content.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

describe('Claude Code official native artifact constraints', () => {
  it('pins the known official native baseline and locks a stable main-package candidate before selecting its matching platform build', async () => {
    expect(claudeCompatibilityScope).toEqual(scope); expect(claudeRequiredChecks).toEqual(checks);
    const pinned = JSON.parse(await readFile(new URL('../scripts/claude-compat-baseline.json', import.meta.url), 'utf8'));
    expect(pinned.schema).toBe(1); expect(pinned.package).toEqual(manifest());
    expect(parseClaudeNpmManifest(pinned.package, 'win32', 'x64')).toEqual(builds.baseline);
    const version = parseClaudeLatestManifest({ name: '@anthropic-ai/claude-code', version: '2.1.310' });
    expect(version).toBe('2.1.310');
    expect(parseClaudeNpmManifest(manifest(version, candidateIntegrity), 'win32', 'x64', version)).toEqual(builds.candidate);
    expect(() => parseClaudeNpmManifest(manifest('2.1.311'), 'win32', 'x64', version)).toThrow();
  });

  it('separates unsupported stable releases from malformed or unrelated metadata without broadening the current platform scope', () => {
    for (const version of ['2.1.309', '2.1.310', '2.2.0', '2.999.0']) expect(parseClaudeNpmManifest(manifest(version), 'win32', 'x64').version).toBe(version);
    for (const version of ['2.1.308', '2.0.999', '3.0.0', '2.1.310-rc.1']) {
      expect(() => parseClaudeLatestManifest({ name: '@anthropic-ai/claude-code', version })).toThrow(expect.objectContaining({ category: 'unsupported', version }));
    }
    for (const input of [{ ...manifest(), name: '@other/claude' }, { ...manifest(), version: 'latest' }, { ...manifest(), version: '2.01.309' },
      { ...manifest(), dist: { ...manifest().dist, tarball: 'https://example.org/claude.tgz' } }, { ...manifest(), dist: { ...manifest().dist, integrity: 'sha1-bad' } }]) {
      expect(() => parseClaudeNpmManifest(input, 'win32', 'x64')).toThrow();
    }
    expect(() => parseClaudeLatestManifest({ name: '@other/claude', version: '2.1.310' })).toThrow();
    expect(() => parseClaudeNpmManifest(manifest(), 'linux', 'x64')).toThrow();
    expect(() => parseClaudeNpmManifest(manifest(), 'win32', 'arm64')).toThrow();
  });

  it('checks the exact downloaded native archive against canonical SHA-512 SRI before extraction', () => {
    const bytes = Buffer.from('controlled native archive bytes');
    const exact = { ...artifact(), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` };
    expect(verifyClaudeNpmArtifact(bytes, exact)).toBe(true);
    expect(() => verifyClaudeNpmArtifact(Buffer.from('changed'), exact)).toThrow();
    expect(() => verifyClaudeNpmArtifact(bytes, { ...exact, integrity: 'sha512-invalid' })).toThrow();
  });

  it('extracts only the small known native package layout and rejects escaping paths, links, duplicate binaries, oversized/truncated entries or invalid headers', async () => {
    await isolated(async (root) => {
      const binary = { name: 'package/claude.exe', content: 'MZcontrolled-native-fixture' };
      const metadata = { name: 'package/package.json', content: JSON.stringify({ name, version: '2.1.309' }) };
      const extract = async (entries: TarEntry[], destination: string) => {
        const bytes = nativeArchive(entries); const build = { ...artifact(), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` };
        return extractClaudeNativeArchive(bytes, build, destination);
      };
      const valid = await extract([{ name: 'package/', type: '5' }, metadata, binary, { name: 'package/README.md', content: 'official native package' }], join(root, 'valid'));
      expect(await readFile(valid.binary, 'utf8')).toBe(binary.content);
      const invalid = [
        [metadata, binary, { name: '../outside.exe', content: 'escape' }], [metadata, binary, { name: 'package/../../outside.exe', content: 'escape' }],
        [metadata, binary, { name: 'package\\outside.exe', content: 'escape' }], [metadata, { ...binary, type: '2' }], [metadata, { ...binary, type: '1' }],
        [metadata, binary, binary], [metadata], [binary, { ...metadata, content: JSON.stringify({ name: '@other/tool', version: '2.1.309' }) }],
        [metadata, { ...binary, size: 512 * 1024 * 1024 + 1 }], [metadata, { ...binary, size: 1024 * 1024 }], [metadata, { ...binary, corruptChecksum: true }],
      ];
      for (const [index, entries] of invalid.entries()) await expect(extract(entries, join(root, `invalid-${index}`))).rejects.toThrow();
      await expect(readFile(join(root, 'outside.exe'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });
});

describe('Claude Code fresh probe evidence and resource release', () => {
  it('bounds controlled child execution and reports timeout separately from a clean process exit', async () => {
    expect(await runClaudeProcess(process.execPath, ['-e', 'process.stdout.write("controlled-child")'], { timeout: 5000 })).toMatchObject({ code: 0, signal: null, timedOut: false, stdout: 'controlled-child' });
    expect((await runClaudeProcess(process.execPath, ['-e', 'setTimeout(()=>{},20000)'], { timeout: 150 })).timedOut).toBe(true);
  });

  it('requires every resource to be released and treats missing model release, forced cleanup or cleanup errors as unknown ownership', () => {
    expect(hasClaudeRuntimeReleaseProof(cleanup)).toBe(true);
    for (const invalid of [undefined, {}, { ...cleanup, runtimeStopped: false }, { ...cleanup, registrationRemoved: false }, { ...cleanup, modelClosed: false },
      { ...cleanup, removed: false }, { ...cleanup, forced: true }, { ...cleanup, errors: undefined }, { ...cleanup, errors: ['unknown process'] }]) expect(hasClaudeRuntimeReleaseProof(invalid)).toBe(false);
  });

  it('uses a new empty report directory and caller-selected run ID on every attempt instead of trusting an existing PASS', async () => {
    await isolated(async (output) => {
      await writeFile(join(output, 'baseline.json'), JSON.stringify(passed(builds.baseline.version)));
      const paths: string[] = []; const ids: string[] = [];
      const first = await runClaudeProbeAttempt({ output, label: 'baseline', artifact: builds.baseline }, async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
        paths.push(reportPath); ids.push(runId); await writeFile(reportPath, JSON.stringify(passed(builds.baseline.version, runId))); return { code: 0, signal: null, timedOut: false };
      });
      const second = await runClaudeProbeAttempt({ output, label: 'baseline', artifact: builds.baseline }, async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
        paths.push(reportPath); ids.push(runId); return { code: 0, signal: null, timedOut: false };
      });
      expect(first.status).toBe('passed'); expect(new Set(paths).size).toBe(2); expect(new Set(ids).size).toBe(2);
      expect(second).toMatchObject({ status: 'failed', category: 'infrastructure' }); expect(second.cleanup).toBeUndefined();
    });
  });

  it('rejects wrong run or build identity, incomplete/scope-changing PASS, malformed failures and contradictory process termination', async () => {
    await isolated(async (output) => {
      const cases = [
        { report: { runId: randomUUID() } }, { report: { version: '2.1.311' } }, { report: { tool: 'claude-desktop' } },
        { report: { platform: 'linux' } }, { report: { checks: [] } }, { report: { scope: { ...scope, interactiveTUI: true } } },
        { report: { checks: [...passed(builds.candidate.version).checks, passed(builds.candidate.version).checks[0]] } },
        { report: { status: 'failed', stage: 'done', category: 'compatibility', check: 'busy-queue-step-boundary' }, process: { code: 1, signal: null, timedOut: false } },
        { process: { code: 0, signal: null, timedOut: true } }, { process: { code: 0, signal: 'SIGTERM', timedOut: false } }, { process: { code: 1, signal: null, timedOut: false } },
      ];
      for (const invalid of cases) {
        const result = await runClaudeProbeAttempt({ output, label: 'candidate', artifact: builds.candidate }, async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
          await writeFile(reportPath, JSON.stringify({ ...passed(builds.candidate.version, runId), ...invalid.report }));
          return invalid.process ?? { code: 0, signal: null, timedOut: false };
        });
        expect(result).toMatchObject({ status: 'failed', category: 'infrastructure' }); expect(result.cleanup).toBeUndefined();
      }
    });
  });
});

describe('Claude Code baseline/candidate lifecycle and reporting', () => {
  it('rejects contradictions and out-of-order evidence instead of reporting a passed check as a regression', () => {
    const baseline = passed(builds.baseline.version);
    const candidate = failed(builds.candidate.version);
    const retry = failed(builds.candidate.version);
    const summary = { schema: 1, tool: 'claude-code-cli', platform: 'win32', arch: 'x64', scope, builds, installationCleanup: 'removed',
      baseline, candidate, retry, classification: { kind: 'regression', notify: true } };
    expect(claudeRegressionIdentity(summary)).toBeDefined();
    for (const completed of [passed(builds.candidate.version).checks, [...candidate.checks, { name: candidate.check, status: 'passed', elapsedMs: 1 }],
      [...candidate.checks].reverse(), candidate.checks.slice(1)]) {
      expect(claudeRegressionIdentity({ ...summary, candidate: { ...candidate, checks: completed }, retry: { ...retry, checks: completed } })).toBeUndefined();
    }
  });

  it('removes each released build before the next and repeats the identical candidate only after a compatibility failure', async () => {
    const calls: string[] = []; const candidates: unknown[] = [];
    const summary = await runClaudeBuildSequence(builds, {
      install: async (build: typeof builds.baseline, label: string) => { calls.push(`install:${label}`); if (label !== 'baseline') candidates.push(build); return { label, root: `owned-${label}` }; },
      probe: async (_installation: unknown, build: typeof builds.baseline, label: string) => { calls.push(`probe:${label}`); return label === 'baseline' ? passed(build.version) : failed(build.version); },
      remove: async (_installation: unknown, _build: unknown, label: string) => { calls.push(`remove:${label}`); },
    });
    expect(calls).toEqual(['install:baseline', 'probe:baseline', 'remove:baseline', 'install:candidate', 'probe:candidate', 'remove:candidate', 'install:retry', 'probe:retry', 'remove:retry']);
    expect(candidates).toEqual([builds.candidate, builds.candidate]); expect(summary.installationCleanup).toBe('removed');
    expect(summary.classification).toEqual({ kind: 'regression', notify: true });
    expect(claudeRegressionIdentity(summary)).toMatchObject({ marker: '<!-- claude-compat:2.1.310:win32:busy-queue-step-boundary -->' });
  });

  it('does not remove or advance from malformed evidence, abnormal process exit or unknown runtime release', async () => {
    for (const report of [{ ...passed(builds.baseline.version), cleanup: undefined }, { ...passed(builds.baseline.version), cleanup: { ...cleanup, modelClosed: false } },
      { ...passed(builds.baseline.version), cleanup: { ...cleanup, forced: true } }, { ...passed(builds.baseline.version), checks: [] },
      { ...passed(builds.baseline.version), process: { code: null, signal: null, timedOut: true } }]) {
      const calls: string[] = [];
      const summary = await runClaudeBuildSequence(builds, { install: async (_build: unknown, label: string) => { calls.push(label); return { root: 'owned-retained' }; },
        probe: async () => report, remove: async () => { calls.push('remove'); } });
      expect(calls).toEqual(['baseline']); expect(summary.installationCleanup).not.toBe('removed');
      expect(summary.retainedInstallation).toMatchObject({ label: 'baseline', root: 'owned-retained' });
      expect(summary.classification).toEqual({ kind: 'infrastructure', notify: false });
    }
  });

  it('never reports baseline failures, model/infrastructure faults, flaky or changed candidate failures as regressions', async () => {
    const execute = async (reports: Record<string, unknown>, remove = async () => {}) => runClaudeBuildSequence(builds, {
      install: async (_build: unknown, label: string) => ({ label }), probe: async (_installation: unknown, _build: unknown, label: string) => reports[label], remove,
    });
    const baseline = passed(builds.baseline.version); const candidate = failed(builds.candidate.version);
    for (const reports of [
      { baseline: failed(builds.baseline.version) },
      { baseline, candidate: { ...candidate, category: 'infrastructure', stage: 'model-fixture' } },
      { baseline, candidate, retry: passed(builds.candidate.version) },
      { baseline, candidate, retry: { ...failed(builds.candidate.version), check: 'busy-steer-step-boundary' } },
      { baseline, candidate, retry: { ...failed(builds.candidate.version), stage: 'different-stage' } },
      { baseline, candidate, retry: { ...failed(builds.candidate.version), runId: candidate.runId } },
    ]) {
      const summary = await execute(reports); expect(summary.classification.notify).toBe(false); expect(claudeRegressionIdentity(summary)).toBeUndefined();
    }
    const removalFailure = await execute({ baseline }, async () => { throw new Error('controlled removal failure'); });
    expect(removalFailure.classification).toEqual({ kind: 'infrastructure', notify: false }); expect(removalFailure.retainedInstallation).toBeDefined();
    const downloadFailure = await runClaudeBuildSequence(builds, { install: async () => { throw new Error('controlled download failure'); }, probe: async () => {}, remove: async () => {} });
    expect(downloadFailure.classification).toEqual({ kind: 'infrastructure', notify: false }); expect(claudeRegressionIdentity(downloadFailure)).toBeUndefined();
  });

  it('independently validates complete immutable builds, scoped checks, fresh IDs and clean release before permitting a regression issue', () => {
    const summary = { schema: 1, tool: 'claude-code-cli', platform: 'win32', arch: 'x64', scope, builds, installationCleanup: 'removed',
      baseline: passed(builds.baseline.version), candidate: failed(builds.candidate.version), retry: failed(builds.candidate.version), classification: { kind: 'regression', notify: true } };
    expect(claudeRegressionIdentity(summary)).toMatchObject({ title: 'Claude Code 2.1.310: busy-queue-step-boundary compatibility regression (win32)' });
    for (const invalid of [
      { ...summary, baseline: { ...summary.baseline, status: 'failed' } }, { ...summary, candidate: { ...summary.candidate, category: 'infrastructure' } },
      { ...summary, retry: { ...summary.retry, cleanup: { ...cleanup, forced: true } } }, { ...summary, retry: { ...summary.retry, runId: summary.candidate.runId } },
      { ...summary, candidate: { ...summary.candidate, checks: [] }, baseline: { ...summary.baseline, checks: [] } },
      { ...summary, candidate: { ...summary.candidate, check: 'injected-check' }, retry: { ...summary.retry, check: 'injected-check' } },
      { ...summary, builds: { ...builds, candidate: { ...builds.candidate, url: 'https://example.org/tool.tgz' } } },
      { ...summary, builds: { ...builds, candidate: { ...builds.candidate, version: '3.0.0' } } },
      { ...summary, platform: 'linux' }, { ...summary, scope: { ...scope, desktop: true } }, { ...summary, installationCleanup: 'retained' },
    ]) expect(claudeRegressionIdentity(invalid)).toBeUndefined();
  });
});

describe('Claude Code owned installation boundaries', () => {
  it('creates an exclusive child of the supplied test parent and never removes that parent, an outside directory or a mismatched owner', async () => {
    await isolated(async (parent) => {
      const sentinel = join(parent, 'keep.txt'); await writeFile(sentinel, 'retained user parent');
      const task = await createClaudeTaskRoot(parent);
      expect(task.parent).toBe(parent); expect(task.root.startsWith(join(parent, 'crosschat-claude-ci-'))).toBe(true);
      const outside = join(parent, 'outside'); await mkdir(outside); await writeFile(join(outside, '.fixture-owner'), 'different-owner');
      await expect(removeClaudeOwnedPath(parent, parent, task.owner)).rejects.toThrow();
      await expect(removeClaudeOwnedPath(task.root, outside, task.owner)).rejects.toThrow();
      await expect(removeClaudeOwnedPath(parent, outside, task.owner)).rejects.toThrow();
      await removeClaudeOwnedPath(parent, task.root, task.owner);
      expect(await readFile(sentinel, 'utf8')).toBe('retained user parent');
      await expect(readFile(join(task.root, '.fixture-owner'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('rejects relative, network or linked parents instead of allowing cleanup to traverse a different ownership root', async () => {
    await isolated(async (parent) => {
      const target = join(parent, 'actual'); const link = join(parent, 'link'); await mkdir(target); await symlink(target, link, 'junction');
      for (const path of ['relative-parent', 'https://example.org/cache', '\\\\server\\share', link]) await expect(createClaudeTaskRoot(path)).rejects.toThrow();
    });
  });
});
