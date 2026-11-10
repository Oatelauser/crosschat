import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import * as desktopCI from '../scripts/opencode-desktop-compat-ci.mjs';
import {
  canSnapshotExistingProtocol,
  desktopStateMatchesBaseline,
  desktopLifecycleFailure,
  desktopRegressionIdentity,
  desktopArtifactDownloadTimeout,
  desktopInstallerCachePath,
  compareProtocolAclSnapshots,
  isProtocolAclSnapshotRace,
  parseDesktopArtifactManifest,
  protocolRestorationAction,
  protocolAclRestoreSecurityInformation,
  protocolSnapshotsMatch,
  requireApprovedCandidateVersion,
  runDesktopBuildSequence,
  validateGeneratedUninstaller,
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
  it('allows only an unchanged, snapshotted protocol key through the otherwise-empty install baseline', () => {
    const empty = { installKey: false, uninstallKey: false, protocolKey: false, machineInstallKey: false,
      machineUninstallKey: false, sideEffects: [] };
    expect(canSnapshotExistingProtocol(empty)).toBe(true);
    expect(desktopStateMatchesBaseline(empty, false, false)).toBe(true);

    const existingProtocol = { ...empty, protocolKey: true };
    expect(canSnapshotExistingProtocol(existingProtocol)).toBe(true);
    expect(desktopStateMatchesBaseline(existingProtocol, true, true)).toBe(true);
    expect(desktopStateMatchesBaseline(existingProtocol, true, false)).toBe(false);
    expect(desktopStateMatchesBaseline(existingProtocol, false, false)).toBe(false);
    expect(desktopStateMatchesBaseline({ ...empty, protocolKey: true }, false, false)).toBe(false);

    for (const changed of [
      { ...existingProtocol, installKey: true }, { ...existingProtocol, uninstallKey: true },
      { ...existingProtocol, machineInstallKey: true }, { ...existingProtocol, machineUninstallKey: true },
      { ...existingProtocol, sideEffects: [{ path: 'OpenCode.lnk', exists: true }] },
    ]) {
      expect(canSnapshotExistingProtocol(changed)).toBe(false);
      expect(desktopStateMatchesBaseline(changed, true, true)).toBe(false);
    }
  });

  it('restores ACLs only when registry values still match the original snapshot', () => {
    expect(protocolRestorationAction({ originalValuesMatch: true, originalAclMatches: true, installedSnapshotMatches: false }))
      .toBe('keep');
    expect(protocolRestorationAction({ originalValuesMatch: true, originalAclMatches: false, installedSnapshotMatches: true }))
      .toBe('restore-original-acl');
    expect(protocolRestorationAction({ originalValuesMatch: true, originalAclMatches: false, installedSnapshotMatches: false }))
      .toBe('refuse');
    expect(protocolRestorationAction({ originalValuesMatch: false, originalAclMatches: false, installedSnapshotMatches: true }))
      .toBe('remove-installed-registration');
    expect(protocolRestorationAction({ originalValuesMatch: false, originalAclMatches: false, installedSnapshotMatches: false }))
      .toBe('refuse');
  });

  it('compares complete protocol ACL trees and identifies only transient key disappearance', () => {
    const original = [
      { relative: '', sddl: 'root' },
      { relative: 'shell', sddl: 'shell' },
      { relative: 'shell\\open', sddl: 'open' },
      { relative: 'shell\\open\\command', sddl: 'command' },
    ];
    expect(compareProtocolAclSnapshots(original, [...original].reverse())).toEqual({ matches: true, missing: [], extra: [], changed: [] });
    expect(compareProtocolAclSnapshots(original, original.slice(0, 3))).toMatchObject({ matches: false, missing: ['shell\\open\\command'] });
    expect(compareProtocolAclSnapshots(original, [...original, { relative: 'extra', sddl: 'extra' }]))
      .toMatchObject({ matches: false, extra: ['extra'] });
    expect(compareProtocolAclSnapshots(original, original.map((item) => item.relative === 'shell' ? { ...item, sddl: 'changed' } : item)))
      .toMatchObject({ matches: false, changed: ['shell'] });
    expect(isProtocolAclSnapshotRace(new Error('OpenCode protocol ACL key disappeared during verification: shell\\open'))).toBe(true);
    expect(isProtocolAclSnapshotRace(new Error('OpenCode protocol ACL changed after the installed snapshot'))).toBe(false);
  });

  it('accepts a protocol snapshot only when registry values and the complete ACL tree stay stable', () => {
    const values = Buffer.from('Windows Registry Editor Version 5.00\r\n[HKEY_CURRENT_USER\\Software\\Classes\\opencode]\r\n');
    const acl = [{ relative: '', sddl: 'O:ownerG:groupD:(A;;KA;;;user)' }];
    expect(protocolSnapshotsMatch({ values, acl }, { values: Buffer.from(values), acl: [...acl] })).toBe(true);
    expect(protocolSnapshotsMatch({ values, acl }, { values: Buffer.from('changed'), acl })).toBe(false);
    expect(protocolSnapshotsMatch({ values, acl }, { values, acl: [{ relative: '', sddl: 'O:otherG:groupD:(A;;KA;;;user)' }] })).toBe(false);
    const registryValues = [{ relative: '', values: [{ name: '', kind: 'String', data: 'URL:opencode' }] }];
    expect(protocolSnapshotsMatch({ values, acl, registryValues }, { values: Buffer.from(values), acl: [...acl], registryValues: structuredClone(registryValues) })).toBe(true);
    expect(protocolSnapshotsMatch({ values, acl, registryValues }, { values: Buffer.from(values), acl: [...acl],
      registryValues: [{ relative: '', values: [{ name: '', kind: 'String', data: 'changed' }] }] })).toBe(false);
    expect(protocolAclRestoreSecurityInformation).toBe(7);
  });

  it('recognizes only OpenCode changing the protocol default command to this exact owned binary', () => {
    const compare = Reflect.get(desktopCI, 'protocolSnapshotsDifferOnlyByOwnedCommand');
    expect(compare).toBeTypeOf('function');
    type RegistryValue = { name: string; kind: string; data: unknown };
    type RegistryKey = { relative: string; values: RegistryValue[] };
    type Snapshot = { values: Buffer; acl: Array<{ relative: string; sddl: string }>; registryValues: RegistryKey[] };
    const binary = 'C:\\temp\\crosschat-opencode\\baseline\\install\\OpenCode.exe';
    const original: Snapshot = {
      values: Buffer.from('original registry export'),
      acl: [
        { relative: '', sddl: 'root-acl' },
        { relative: 'shell', sddl: 'shell-acl' },
        { relative: 'shell\\open', sddl: 'open-acl' },
        { relative: 'shell\\open\\command', sddl: 'command-acl' },
      ],
      registryValues: [
        { relative: '', values: [{ name: '', kind: 'String', data: 'URL:opencode' }, { name: 'URL Protocol', kind: 'String', data: '' }] },
        { relative: 'shell', values: [] },
        { relative: 'shell\\open', values: [] },
        { relative: 'shell\\open\\command', values: [{ name: '', kind: 'String', data: '"D:\\previous\\OpenCode.exe" "%1"' }] },
      ],
    };
    const clone = (snapshot: Snapshot): Snapshot => ({ values: Buffer.from(snapshot.values),
      acl: snapshot.acl.map((key) => ({ ...key })),
      registryValues: snapshot.registryValues.map((key) => ({ ...key, values: key.values.map((value) => ({ ...value })) })) });
    const current = clone(original);
    current.values = Buffer.from('current registry export');
    current.registryValues[3].values[0].data = `"${binary}" "%1"`;
    const compareSnapshots = compare as (before: Snapshot, after: Snapshot, path: string) => boolean;
    expect(compareSnapshots(original, current, binary)).toBe(true);

    const extraValue = clone(current);
    extraValue.registryValues[1].values.push({ name: 'unexpected', kind: 'String', data: 'keep me' });
    expect(compareSnapshots(original, extraValue, binary)).toBe(false);

    const changedAcl = clone(current);
    changedAcl.acl[3].sddl = 'changed-acl';
    expect(compareSnapshots(original, changedAcl, binary)).toBe(false);

    const otherCommand = clone(current);
    otherCommand.registryValues[3].values[0].data = '"C:\\temp\\other\\OpenCode.exe" "%1"';
    expect(compareSnapshots(original, otherCommand, binary)).toBe(false);
  });

  it('captures an install-time protocol checkpoint even when the original registration is unchanged', () => {
    const classify = Reflect.get(desktopCI, 'installedProtocolSnapshotAction');
    expect(classify).toBeTypeOf('function');
    const decision = classify as (input: Record<string, unknown>) => string;
    expect(decision({ originalPresent: true, currentPresent: true, matchesOriginal: true,
      onlyOwnedCommandChange: false, currentCommand: '"C:\\old\\OpenCode.exe" "%1"', expectedCommand: '"C:\\new\\OpenCode.exe" "%1"' })).toBe('capture');
    expect(decision({ originalPresent: true, currentPresent: true, matchesOriginal: false,
      onlyOwnedCommandChange: false, currentCommand: '"C:\\new\\OpenCode.exe" "%1"', expectedCommand: '"C:\\new\\OpenCode.exe" "%1"' })).toBe('refuse');
    expect(decision({ originalPresent: true, currentPresent: true, matchesOriginal: false,
      onlyOwnedCommandChange: true, currentCommand: '"C:\\new\\OpenCode.exe" "%1"', expectedCommand: '"C:\\new\\OpenCode.exe" "%1"' })).toBe('capture');
    expect(decision({ originalPresent: true, currentPresent: false, matchesOriginal: false,
      onlyOwnedCommandChange: false, currentCommand: undefined, expectedCommand: '"C:\\new\\OpenCode.exe" "%1"' })).toBe('refuse');
    expect(decision({ originalPresent: false, currentPresent: false, matchesOriginal: false,
      onlyOwnedCommandChange: false, currentCommand: undefined, expectedCommand: '"C:\\new\\OpenCode.exe" "%1"' })).toBe('none');
  });

  it('only adopts the exact OpenCode command mutation from the pre-probe snapshot', () => {
    const classify = Reflect.get(desktopCI, 'observedProtocolSnapshotAction');
    expect(classify).toBeTypeOf('function');
    const decide = classify as (before: unknown, actual: unknown, binary: string) => string;
    const before = { values: Buffer.from('before'), acl: [{ relative: '', sddl: 'same' }], registryValues: [
      { relative: '', values: [{ name: '', kind: 'String', data: 'URL:opencode' }] },
      { relative: 'shell\\open\\command', values: [{ name: '', kind: 'String', data: '"C:\\old\\OpenCode.exe" "%1"' }] },
    ] };
    const clone = () => ({ values: Buffer.from(before.values), acl: before.acl.map((key) => ({ ...key })),
      registryValues: before.registryValues.map((key) => ({ ...key, values: key.values.map((value) => ({ ...value })) })) });
    const changed = clone();
    changed.values = Buffer.from('after');
    changed.registryValues[1].values[0].data = '"C:\\new\\OpenCode.exe" "%1"';
    expect(decide(before, before, 'C:\\new\\OpenCode.exe')).toBe('unchanged');
    expect(decide(before, changed, 'C:\\new\\OpenCode.exe')).toBe('capture-owned-command');

    const unrelated = clone();
    unrelated.values = Buffer.from('after');
    unrelated.registryValues[0].values[0].data = 'changed';
    expect(decide(before, unrelated, 'C:\\new\\OpenCode.exe')).toBe('refuse');
    const otherCommand = clone();
    otherCommand.values = Buffer.from('after');
    otherCommand.registryValues[1].values[0].data = '"C:\\other\\OpenCode.exe" "%1"';
    expect(decide(before, otherCommand, 'C:\\new\\OpenCode.exe')).toBe('refuse');
  });

  it('restores owner, group and DACL sections with the rights required by Windows', async () => {
    const source = await readFile(new URL('../scripts/opencode-desktop-compat-ci.mjs', import.meta.url), 'utf8');
    expect(source).toContain('RegistryRights]::ChangePermissions -bor [System.Security.AccessControl.RegistryRights]::TakeOwnership');
    expect(source).toContain('RegSetKeySecurity($entry.key.Handle,${protocolAclRestoreSecurityInformation},$entry.binary)');
    expect(source).toContain('Sort-Object depth -Descending');
  });

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

  it('labels Windows state snapshots by their lifecycle checkpoint', async () => {
    const source = await readFile(new URL('../scripts/opencode-desktop-compat-ci.mjs', import.meta.url), 'utf8');
    expect(source).toMatch(/\blet protocolSnapshot;/);
    expect(source).toContain('async function windowsState(env, operation)');
    for (const operation of [
      'windowsState(env, `inspect ${label} installation state before install`)',
      'windowsState(env, `inspect ${label} installation state after install`)',
      'windowsState(context.env, `inspect ${context.label} installation state before uninstall`)',
      'windowsState(context.env, `verify ${context.label} Windows uninstaller registration removal`)',
      'windowsState(context.env, `inspect ${context.label} Windows installation state after uninstall`)',
    ]) expect(source).toContain(operation);
  });

  it('pins the official Windows desktop installer and its distinct desktop source commit', () => {
    expect(parseDesktopArtifactManifest(manifest(), 'win32', 'x64')).toEqual(baseline);
    const approved = parseDesktopArtifactManifest(manifest('2.2.6'), 'win32', 'x64');
    expect(requireApprovedCandidateVersion(approved, '2.2.6')).toBe(approved);
    expect(requireApprovedCandidateVersion(approved, undefined)).toBe(approved);
    expect(() => requireApprovedCandidateVersion(approved, '2.2.7')).toThrow('differs from the approved version 2.2.7');
    expect(() => requireApprovedCandidateVersion(approved, 'latest')).toThrow('approved version must be an exact release version');
    expect(() => parseDesktopArtifactManifest({ ...manifest(), name: 'cli' }, 'win32', 'x64')).toThrow();
    expect(() => parseDesktopArtifactManifest(manifest(), 'linux', 'x64')).toThrow();
  });

  it('bounds an optional desktop installer download timeout without changing the default', () => {
    expect(desktopArtifactDownloadTimeout(undefined)).toBe(120000);
    expect(desktopArtifactDownloadTimeout('600000')).toBe(600000);
    expect(() => desktopArtifactDownloadTimeout('0')).toThrow('between 1000 and 600000 milliseconds');
    expect(() => desktopArtifactDownloadTimeout('600001')).toThrow('between 1000 and 600000 milliseconds');
    expect(() => desktopArtifactDownloadTimeout('slow')).toThrow('between 1000 and 600000 milliseconds');
  });

  it('maps an absolute cache directory to an artifact-specific Windows path', () => {
    const artifact = { sha256: 'a'.repeat(64) };
    expect(desktopInstallerCachePath('C:\\cache\\opencode', artifact))
      .toBe(`C:\\cache\\opencode\\${artifact.sha256}.exe`);
    expect(() => desktopInstallerCachePath('relative-cache', artifact)).toThrow('absolute Windows path');
    expect(() => desktopInstallerCachePath('C:\\cache', { sha256: 'invalid' })).toThrow('SHA-256');
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

  it('accepts only the unchanged installer-generated uninstaller at its exact owned path', () => {
    const path = 'C:\\temp\\crosschat-opencode\\candidate\\install\\Uninstall OpenCode.exe';
    const sha256 = 'd'.repeat(64);
    const input = { expectedPath: path, actualPath: path.replaceAll('\\', '/'), installedSha256: sha256, currentSha256: sha256 };
    expect(validateGeneratedUninstaller({ ...input, signature: { status: 'NotSigned' } })).toBe(true);
    expect(validateGeneratedUninstaller({ ...input, signature: { status: 'Valid', subject: publisher } })).toBe(true);
    expect(() => validateGeneratedUninstaller({ ...input, actualPath: 'C:\\temp\\other\\Uninstall OpenCode.exe', signature: { status: 'NotSigned' } })).toThrow();
    expect(() => validateGeneratedUninstaller({ ...input, currentSha256: 'e'.repeat(64), signature: { status: 'NotSigned' } })).toThrow();
    expect(() => validateGeneratedUninstaller({ ...input, installedSha256: 'missing', currentSha256: 'missing', signature: { status: 'NotSigned' } })).toThrow();
    expect(() => validateGeneratedUninstaller({ ...input, signature: { status: 'HashMismatch' } })).toThrow();
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

  it('captures installed ownership before probing the native Desktop', async () => {
    const calls: string[] = [];
    await runDesktopBuildSequence({ baseline, candidate }, {
      install: async (_artifact: unknown, label: string) => { calls.push(`install:${label}`); return { label }; },
      captureInstalled: async (installation: { label: string }) => { calls.push(`capture:${installation.label}`); },
      probe: async (installation: { label: string }, artifact: typeof baseline) => { calls.push(`probe:${installation.label}`); return passed(artifact.version); },
      prepareUninstall: async (installation: { label: string }) => { calls.push(`prepare-uninstall:${installation.label}`); },
      uninstall: async (installation: { label: string }) => { calls.push(`uninstall:${installation.label}`); },
    });
    expect(calls.slice(0, 5)).toEqual(['install:baseline', 'capture:baseline', 'probe:baseline', 'prepare-uninstall:baseline', 'uninstall:baseline']);
  });

  it('captures and verifies a generated uninstaller before cleaning a failed partial installation', async () => {
    const context = {};
    const calls: string[] = [];
    const cleanup = Reflect.get(desktopCI, 'cleanupPartialDesktopInstallation');
    expect(cleanup).toBeTypeOf('function');
    const removed = await (cleanup as (context: object, operations: Record<string, unknown>) => Promise<boolean>)(context, {
      hasUninstaller: async () => true,
      captureUninstallerIdentity: async () => { calls.push('uninstaller-identity'); },
      verifyUninstallRegistration: async () => { calls.push('uninstall-registration'); },
      captureProtocolRegistration: async () => { calls.push('protocol-snapshot'); },
      uninstall: async () => { calls.push('uninstall'); },
    });
    expect(removed).toBe(true);
    expect(calls).toEqual(['uninstaller-identity', 'uninstall-registration', 'protocol-snapshot', 'uninstall']);
  });

  it('does not attempt partial-install cleanup without a generated uninstaller', async () => {
    const calls: string[] = [];
    const cleanup = Reflect.get(desktopCI, 'cleanupPartialDesktopInstallation');
    expect(cleanup).toBeTypeOf('function');
    const removed = await (cleanup as (context: object, operations: Record<string, unknown>) => Promise<boolean>)({}, {
      hasUninstaller: async () => false,
      captureUninstallerIdentity: async () => { calls.push('uninstaller-identity'); },
      verifyUninstallRegistration: async () => { calls.push('uninstall-registration'); },
      captureProtocolRegistration: async () => { calls.push('protocol-snapshot'); },
      uninstall: async () => { calls.push('uninstall'); },
    });
    expect(removed).toBe(false);
    expect(calls).toEqual([]);
  });

  it('does not run a partial-install uninstaller when ownership verification fails', async () => {
    const calls: string[] = [];
    const cleanup = Reflect.get(desktopCI, 'cleanupPartialDesktopInstallation');
    expect(cleanup).toBeTypeOf('function');
    const context = {};
    const operations = {
      hasUninstaller: async () => true,
      captureUninstallerIdentity: async () => { calls.push('uninstaller-identity'); },
      verifyUninstallRegistration: async () => { throw new Error('install registration points elsewhere'); },
      captureProtocolRegistration: async () => { calls.push('protocol-snapshot'); },
      uninstall: async () => { calls.push('uninstall'); },
    };
    await expect((cleanup as (context: object, operations: Record<string, unknown>) => Promise<boolean>)(context, operations))
      .rejects.toThrow('install registration points elsewhere');
    await expect((cleanup as (context: object, operations: Record<string, unknown>) => Promise<boolean>)(context, operations))
      .rejects.toThrow('Desktop install ownership capture did not complete; refusing to retry');
    expect(calls).toEqual(['uninstaller-identity']);
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
