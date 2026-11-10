#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { access, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL, URL } from 'node:url';
import { classifyCompatibility } from './opencode-compat-report.mjs';
import { prepareDesktopProfile } from '../test/helpers/opencode-desktop-live-fixture.mjs';
import { repositoryRoot, runCommand } from '../test/helpers/opencode-live-fixture.mjs';

const filename = 'opencode-desktop-win-x64.exe';
const tool = 'opencode-desktop';
const guid = 'd074f30d-5f88-5885-b075-be1348cc7676';
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function errorMessage(error) {
  if (error instanceof AggregateError) return `${error.message}: ${error.errors.map(errorMessage).join('; ')}`;
  return error instanceof Error ? error.message : String(error);
}

export function parseDesktopArtifactManifest(input, platform, arch) {
  if (!record(input) || input.name !== 'desktop' || input.distribution !== 'opencode' || typeof input.version !== 'string'
    || !/^\d+\.\d+\.\d+$/.test(input.version) || !record(input.metadata) || !record(input.metadata.files)) throw new Error('Invalid official OpenCode Desktop manifest');
  if (Number(input.version.split('.')[0]) > 2) throw Object.assign(new Error(`OpenCode Desktop ${input.version} is an unsupported new major`), { category: 'unsupported', version: input.version });
  if (!input.version.startsWith('2.') || platform !== 'win32' || arch !== 'x64') throw new Error('Only OpenCode Desktop V2 Windows x64 is configured');
  const file = input.metadata.files[filename];
  if (!record(file) || file.url !== `https://opencode.ai/files/bin/${input.version}/${filename}`
    || typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size)
    || file.size < 1 || file.size > 512 * 1024 * 1024 || !record(input.metadata.github)
    || !/^[0-9a-f]{40}$/.test(input.metadata.github.sha ?? '')) throw new Error('Invalid official desktop artifact URL, digest, size or source commit');
  return { version: input.version, filename, url: file.url, sha256: file.sha256, size: file.size, sourceCommit: input.metadata.github.sha };
}

export function requireApprovedCandidateVersion(artifact, expectedVersion) {
  if (expectedVersion === undefined) return artifact;
  if (typeof expectedVersion !== 'string' || !/^2\.\d+\.\d+$/.test(expectedVersion)) {
    throw new Error('OpenCode Desktop approved version must be an exact release version');
  }
  if (artifact.version !== expectedVersion) {
    throw new Error(`Official OpenCode Desktop latest ${artifact.version} differs from the approved version ${expectedVersion}`);
  }
  return artifact;
}

export function validateDesktopSignature(signature) {
  if (!record(signature) || signature.status !== 'Valid' || typeof signature.subject !== 'string'
    || !/(?:^|,\s*)O="Anomaly Innovations, Inc https:\/\/anoma\.ly\/"(?:,|$)/.test(signature.subject)) {
    throw new Error('Desktop Authenticode signature is not valid for the expected publisher organization');
  }
  return true;
}

function noDesktopArtifacts(state) {
  return record(state) && state.installKey === false && state.uninstallKey === false
    && state.machineInstallKey === false && state.machineUninstallKey === false
    && Array.isArray(state.sideEffects) && state.sideEffects.every((item) => record(item) && item.exists === false);
}

export function canSnapshotExistingProtocol(state) {
  return noDesktopArtifacts(state) && typeof state.protocolKey === 'boolean';
}

export function desktopStateMatchesBaseline(state, protocolWasPresent, protocolMatchesSnapshot) {
  return noDesktopArtifacts(state) && state.protocolKey === protocolWasPresent
    && (!protocolWasPresent || protocolMatchesSnapshot === true);
}

export function protocolRestorationAction({ originalValuesMatch, originalAclMatches, installedSnapshotMatches }) {
  if (originalValuesMatch === true) {
    if (originalAclMatches === true) return 'keep';
    return installedSnapshotMatches === true ? 'restore-original-acl' : 'refuse';
  }
  return installedSnapshotMatches === true ? 'remove-installed-registration' : 'refuse';
}

export function compareProtocolAclSnapshots(expected, actual) {
  const expectedItems = normalizedProtocolAcl(expected);
  const actualItems = normalizedProtocolAcl(actual);
  const expectedByPath = new Map(expectedItems.map((item) => [item.relative, item.sddl]));
  const actualByPath = new Map(actualItems.map((item) => [item.relative, item.sddl]));
  const missing = expectedItems.filter((item) => !actualByPath.has(item.relative)).map((item) => item.relative);
  const extra = actualItems.filter((item) => !expectedByPath.has(item.relative)).map((item) => item.relative);
  const changed = expectedItems.filter((item) => actualByPath.has(item.relative) && actualByPath.get(item.relative) !== item.sddl)
    .map((item) => item.relative);
  return { matches: missing.length === 0 && extra.length === 0 && changed.length === 0, missing, extra, changed };
}

export function isProtocolAclSnapshotRace(error) {
  return /(?:Protocol key changed during ACL snapshot|OpenCode protocol ACL key disappeared during verification)/.test(errorMessage(error));
}

export const protocolAclRestoreSecurityInformation = 1 | 2 | 4;

export function protocolSnapshotsMatch(expected, actual) {
  return Buffer.isBuffer(expected?.values) && Buffer.isBuffer(actual?.values)
    && expected.values.equals(actual.values)
    && compareProtocolAclSnapshots(expected.acl, actual.acl).matches;
}

function validReport(report, artifact) {
  return record(report) && report.schema === 1 && report.tool === tool && report.platform === 'win32' && report.arch === 'x64'
    && report.version === artifact.version && (report.status === 'passed' ? report.stage === 'done'
      : report.status === 'failed' && ['compatibility', 'infrastructure'].includes(report.category)
        && /^[a-z0-9-]{1,80}$/.test(report.stage ?? '') && /^[a-z0-9-]{1,80}$/.test(report.check ?? ''));
}

function infrastructure(version, stage, error) {
  return { schema: 1, tool, platform: 'win32', arch: 'x64', version, status: 'failed', category: 'infrastructure', stage, check: stage,
    error: errorMessage(error) };
}

export function desktopLifecycleFailure(result, operation) {
  const stdoutBytes = Buffer.byteLength(result.stdout ?? '', 'utf8');
  const stderrBytes = Buffer.from(result.stderr ?? '', 'utf8');
  let stderrStart = Math.max(0, stderrBytes.length - 4000);
  let stderr = stderrBytes.subarray(stderrStart).toString('utf8');
  while (Buffer.byteLength(stderr, 'utf8') > 4000) {
    stderrStart += 1;
    stderr = stderrBytes.subarray(stderrStart).toString('utf8');
  }
  const output = stderr ? `stderr (last ${Buffer.byteLength(stderr, 'utf8')} bytes): ${stderr}` : 'no stderr output';
  return `Desktop Windows lifecycle helper "${operation}" failed (exitCode=${result.code}, signal=${result.signal ?? 'none'}, timedOut=${result.timedOut}, stdoutBytes=${stdoutBytes}): ${output}`;
}

/** A report is usable for uninstall only after the probe proves that its owned runtime has released it. */
export function hasDesktopRuntimeReleaseProof(cleanup) {
  return record(cleanup) && cleanup.appStopped === true && cleanup.serviceStopped === true && cleanup.removed === true
    && record(cleanup.runProcesses) && cleanup.runProcesses.state === 'clear'
    && (cleanup.errors === undefined || (Array.isArray(cleanup.errors) && cleanup.errors.length === 0));
}

/** The child receives an empty, unique evidence directory; an earlier invocation's report is never an input. */
export async function runDesktopProbeAttempt({ output, label, version }, execute) {
  if (!/^(baseline|candidate|retry)$/.test(label)) throw new Error('Invalid desktop probe attempt label');
  const attemptRoot = await mkdtemp(join(output, `${label}-`));
  const reportPath = join(attemptRoot, 'report.json'); const evidencePath = join(attemptRoot, 'ui');
  let result;
  try { result = await execute({ reportPath, evidencePath }); }
  catch (error) { return infrastructure(version, 'probe-runner', error); }
  if (!record(result) || result.timedOut !== false || result.signal !== null || ![0, 1].includes(result.code)) {
    return infrastructure(version, 'probe-process', `Desktop probe did not exit normally (code=${result?.code}, signal=${result?.signal}, timedOut=${result?.timedOut}); runtime release is unknown`);
  }
  let report;
  try { report = JSON.parse(await readFile(reportPath, 'utf8')); }
  catch { return infrastructure(version, 'probe-report', 'Desktop probe did not produce a fresh valid JSON report'); }
  if (!validReport(report, { version })) return infrastructure(version, 'probe-report', 'Fresh desktop probe report does not match the installed artifact or report schema');
  if (result.code !== (report.status === 'passed' ? 0 : 1)) return infrastructure(version, 'probe-process', 'Desktop probe exit code disagrees with its report; runtime release is unknown');
  return report;
}

/** Each install must be removed before the same NSIS GUID can be installed again. */
export async function runDesktopBuildSequence(builds, operations) {
  const summary = { schema: 1, tool, platform: 'win32', arch: 'x64', builds };
  async function run(artifact, label) {
    const installation = await operations.install(artifact, label);
    let report;
    try {
      report = await operations.probe(installation, artifact, label);
      if (!validReport(report, artifact)) report = infrastructure(artifact.version, 'probe-report', 'Probe report tool, version or platform does not match the installed desktop artifact');
    } catch (error) { report = infrastructure(artifact.version, 'probe-runner', error); }
    summary[label] = report;
    if (!hasDesktopRuntimeReleaseProof(report.cleanup)) {
      const reason = 'Desktop probe did not prove release of its owned app and service; retain the installation and stop all later attempts';
      if (report.category !== 'infrastructure') summary[label] = { ...infrastructure(artifact.version, 'probe-cleanup', reason), observedProbe: report };
      summary.retainedInstallation = { label, version: artifact.version, taskRoot: installation.taskRoot, reason };
      throw new Error(reason);
    }
    await operations.uninstall(installation, artifact, label);
    return report;
  }
  try {
    summary.baseline = await run(builds.baseline, 'baseline');
    summary.candidate = await run(builds.candidate, 'candidate');
    if (summary.candidate.status !== 'passed') summary.retry = await run(builds.candidate, 'retry');
    summary.classification = classifyCompatibility(summary.baseline, summary.candidate, summary.retry);
  } catch (error) {
    summary.error = errorMessage(error);
    summary.classification = { kind: 'infrastructure', notify: false };
  }
  return summary;
}

/** Independently revalidate report-job input; a boolean from the probe job is insufficient. */
export function desktopRegressionIdentity(summary) {
  if (!record(summary) || summary.schema !== 1 || summary.tool !== tool || summary.platform !== 'win32' || summary.arch !== 'x64'
    || !record(summary.builds) || !record(summary.builds.baseline) || !record(summary.builds.candidate)) return undefined;
  const { baseline, candidate, retry, builds } = summary;
  if (!validReport(baseline, builds.baseline) || !validReport(candidate, builds.candidate) || !validReport(retry, builds.candidate)
    || [baseline, candidate, retry].some((report) => !hasDesktopRuntimeReleaseProof(report.cleanup))
    || !/^2\.\d+\.\d+$/.test(baseline.version) || !/^2\.\d+\.\d+$/.test(candidate.version)
    || !/^[0-9a-f]{64}$/.test(builds.candidate.sha256 ?? '') || !/^[0-9a-f]{40}$/.test(builds.candidate.sourceCommit ?? '')
    || builds.candidate.url !== `https://opencode.ai/files/bin/${candidate.version}/${filename}`
    || !/^[a-z0-9-]{1,80}$/.test(candidate.check ?? '') || !/^[a-z0-9-]{1,80}$/.test(candidate.stage ?? '')
    || classifyCompatibility(baseline, candidate, retry).kind !== 'regression') return undefined;
  return { marker: `<!-- opencode-desktop-compat:${candidate.version}:win32:${candidate.check} -->`,
    title: `OpenCode Desktop ${candidate.version}: ${candidate.check} compatibility regression (win32)` };
}

async function fetchBytes(url, maxBytes, timeout = 120000) {
  let failure;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(timeout) });
      if (!response.ok || Number(response.headers.get('content-length')) > maxBytes) throw new Error(`Official artifact request failed or exceeded its budget (HTTP ${response.status})`);
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      try {
        for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > maxBytes) throw new Error('Official response exceeded its byte budget'); chunks.push(part.value); }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      return Buffer.concat(chunks);
    } catch (error) { failure = error; if (attempt < 2) await delay(1000 * (attempt + 1)); }
  }
  throw failure;
}

async function exists(path) { try { await access(path); return true; } catch { return false; } }

const windowsStateScript = String.raw`
$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$g='d074f30d-5f88-5885-b075-be1348cc7676'; $base='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$g
$protocol='HKCU:\Software\Classes\opencode'; $quiet=$null; $command=$null; $icon=$null
if(Test-Path -LiteralPath $base){$quiet=(Get-ItemProperty -LiteralPath $base).QuietUninstallString}
if(Test-Path -LiteralPath ($protocol+'\shell\open\command')){$command=(Get-Item -LiteralPath ($protocol+'\shell\open\command')).GetValue('')}
if(Test-Path -LiteralPath ($protocol+'\DefaultIcon')){$icon=(Get-Item -LiteralPath ($protocol+'\DefaultIcon')).GetValue('')}
$profiles=@($env:APPDATA)
$locals=@($env:LOCALAPPDATA)
if(-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)){
  $profiles+=Join-Path $env:USERPROFILE 'AppData\Roaming'
  $locals+=Join-Path $env:USERPROFILE 'AppData\Local'
}
$appData=[Environment]::GetFolderPath('ApplicationData'); if(-not [string]::IsNullOrWhiteSpace($appData)){$profiles+=$appData}
$localAppData=[Environment]::GetFolderPath('LocalApplicationData'); if(-not [string]::IsNullOrWhiteSpace($localAppData)){$locals+=$localAppData}
$profiles=@($profiles | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
$locals=@($locals | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
$paths=@(); foreach($p in $profiles){$paths+=Join-Path $p 'Microsoft\Windows\Start Menu\Programs\OpenCode.lnk'}
$desktop=[Environment]::GetFolderPath('Desktop')
if([string]::IsNullOrWhiteSpace($desktop) -and -not [string]::IsNullOrWhiteSpace($env:USERPROFILE)){$desktop=Join-Path $env:USERPROFILE 'Desktop'}
if(-not [string]::IsNullOrWhiteSpace($desktop)){$paths+=Join-Path $desktop 'OpenCode.lnk'}
foreach($p in $locals){$paths+=Join-Path $p '@opencodedesktop-updater\installer.exe'}
$effects=@($paths | Select-Object -Unique | ForEach-Object {@{path=$_;exists=(Test-Path -LiteralPath $_);parentExists=(Test-Path -LiteralPath (Split-Path -Parent $_))}})
@{installKey=(Test-Path -LiteralPath ('HKCU:\Software\'+$g));uninstallKey=(Test-Path -LiteralPath $base);protocolKey=(Test-Path -LiteralPath $protocol);machineInstallKey=(Test-Path -LiteralPath ('HKLM:\Software\'+$g));machineUninstallKey=(Test-Path -LiteralPath ('HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$g));quiet=$quiet;protocolCommand=$command;protocolIcon=$icon;sideEffects=$effects} | ConvertTo-Json -Depth 8
`;

async function powershell(script, env, operation) {
  const executable = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = await runCommand(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { env, timeout: 30000 });
  if (result.code !== 0 || result.timedOut) throw new Error(desktopLifecycleFailure(result, operation));
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
}

async function windowsState(env, operation) { return powershell(windowsStateScript, env, operation); }

const protocolAclReadScript = String.raw`
$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$items=[System.Collections.Generic.List[object]]::new()
$sections=[System.Security.AccessControl.AccessControlSections]::Owner -bor [System.Security.AccessControl.AccessControlSections]::Group -bor [System.Security.AccessControl.AccessControlSections]::Access
function Visit-ProtocolKey([Microsoft.Win32.RegistryKey]$key,[string]$relative){
  $sddl=$key.GetAccessControl($sections).GetSecurityDescriptorSddlForm($sections)
  $items.Add(@{relative=$relative;sddl=$sddl})
  foreach($name in $key.GetSubKeyNames()){
    $child=$key.OpenSubKey($name)
    $next=if($relative){$relative+'\'+$name}else{$name}
    if($null -eq $child){throw "Protocol key changed during ACL snapshot at $next"}
    try{Visit-ProtocolKey $child $next}
    finally{$child.Dispose()}
  }
}
$root=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\opencode')
if($null -eq $root){throw 'OpenCode protocol ACL key disappeared during verification: <root>'}
try{Visit-ProtocolKey $root ''}finally{$root.Dispose()}
ConvertTo-Json -InputObject @($items.ToArray()) -Depth 6
`;

const protocolAclRestoreScript = String.raw`
$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$base='Software\Classes\opencode';$items=ConvertFrom-Json -InputObject (Get-Content -LiteralPath $env:CROSSCHAT_DESKTOP_PROTOCOL_ACL -Raw)
$rights=[System.Security.AccessControl.RegistryRights]::ReadKey -bor [System.Security.AccessControl.RegistryRights]::ChangePermissions -bor [System.Security.AccessControl.RegistryRights]::TakeOwnership
$permissionCheck=[Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles; public static class CrosschatRegistrySecurityNative { [DllImport("advapi32.dll", SetLastError=true)] public static extern int RegSetKeySecurity(SafeRegistryHandle hKey, int securityInformation, byte[] securityDescriptor); }'
 $opened=[System.Collections.Generic.List[object]]::new()
try{
  foreach($item in $items){
    $relative=[string]$item.relative
    $path=if([string]::IsNullOrEmpty($relative)){$base}else{$base+'\'+$relative}
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($path,$permissionCheck,$rights)
    if($null -eq $key){throw 'Protocol key required for ACL restoration is absent'}
    $depth=if($relative){$relative.Split([char]92).Count}else{0}
    $opened.Add(@{depth=$depth;key=$key;binary=$null})
    $descriptor=New-Object System.Security.AccessControl.RawSecurityDescriptor([string]$item.sddl)
    $binary=[byte[]]::new($descriptor.BinaryLength);$descriptor.GetBinaryForm($binary,0)
    $opened[$opened.Count-1].binary=$binary
  }
  foreach($entry in ($opened | Sort-Object depth -Descending)){
    $result=[CrosschatRegistrySecurityNative]::RegSetKeySecurity($entry.key.Handle,${protocolAclRestoreSecurityInformation},$entry.binary)
    if($result -ne 0){throw "Could not restore protocol key owner, group, and DACL (Win32 $result)"}
  }
}finally{
  foreach($entry in $opened){$entry.key.Dispose()}
}
@{restored=$true}|ConvertTo-Json
`;

function normalizedProtocolAcl(value) {
  const items = Array.isArray(value) ? value : [value];
  if (!items.length || items.some((item) => !record(item) || typeof item.relative !== 'string' || typeof item.sddl !== 'string')) {
    throw new Error('OpenCode protocol ACL snapshot is malformed');
  }
  return items.map(({ relative, sddl }) => ({ relative, sddl })).sort((a, b) => a.relative.localeCompare(b.relative));
}

async function readProtocolAcl(env) {
  return normalizedProtocolAcl(await powershell(protocolAclReadScript, env, 'read OpenCode protocol ACL'));
}

async function registryExport(path, env) {
  const executable = join(process.env.SystemRoot, 'System32', 'reg.exe');
  const result = await runCommand(executable, ['export', 'HKCU\\Software\\Classes\\opencode', path, '/y'], { env, timeout: 30000 });
  if (result.code !== 0 || result.timedOut || result.signal !== null) throw new Error(`Could not export the exact OpenCode protocol registration (${result.code})`);
  return await readFile(path);
}

async function snapshotProtocolRegistration(root, env) {
  const state = await windowsState(env, 'inspect Windows protocol and Desktop install baseline');
  if (!canSnapshotExistingProtocol(state)) throw new Error(`OpenCode Desktop installation, shortcut or installer cache already exists (GUID ${guid}); refusing to snapshot or replace it`);
  if (!state.protocolKey) return undefined;
  const snapshot = { present: true, registryFile: join(root, 'opencode-protocol-before.reg'), aclFile: join(root, 'opencode-protocol-before-acl.json') };
  const stable = await readStableProtocolSnapshot(root, env, 'capture original OpenCode protocol registration');
  await writeFile(snapshot.registryFile, stable.values);
  await writeFile(snapshot.aclFile, JSON.stringify(stable.acl, null, 2) + '\n');
  return snapshot;
}

async function readStableProtocolSnapshot(root, env, operation) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const firstFile = join(root, `opencode-protocol-${randomUUID()}-first.reg`);
    const secondFile = join(root, `opencode-protocol-${randomUUID()}-second.reg`);
    try {
      const firstValues = await registryExport(firstFile, env);
      const firstAcl = await readProtocolAcl(env);
      const secondValues = await registryExport(secondFile, env);
      const secondAcl = await readProtocolAcl(env);
      const first = { values: firstValues, acl: firstAcl };
      const second = { values: secondValues, acl: secondAcl };
      if (protocolSnapshotsMatch(first, second)) return first;
    } catch (error) {
      if (!isProtocolAclSnapshotRace(error) || attempt === 3) throw error;
    } finally {
      await Promise.all([rm(firstFile, { force: true }), rm(secondFile, { force: true })]);
    }
    if (attempt < 3) await delay(125 * (attempt + 1));
  }
  throw new Error(`OpenCode protocol registration changed during ${operation}; refusing to use an unstable snapshot`);
}

async function protocolMatchesSnapshot(state, snapshot, root, env) {
  if (snapshot === undefined) return state.protocolKey === false;
  if (!state.protocolKey) return false;
  const [expectedValues, expectedAcl, actual] = await Promise.all([
    readFile(snapshot.registryFile), readFile(snapshot.aclFile, 'utf8').then((text) => JSON.parse(text)),
    readStableProtocolSnapshot(root, env, 'verify OpenCode protocol registration'),
  ]);
  return protocolSnapshotsMatch({ values: expectedValues, acl: expectedAcl }, actual);
}

async function captureInstalledProtocolRegistration(context, snapshot, root) {
  const state = await windowsState(context.env, `snapshot ${context.label} installed protocol registration`);
  if (!state.protocolKey || await protocolMatchesSnapshot(state, snapshot, root, context.env)) return undefined;
  const expected = `"${context.binary}"`;
  if (typeof state.protocolCommand !== 'string' || !state.protocolCommand.toLowerCase().startsWith(expected.toLowerCase())) {
    throw new Error('OpenCode protocol registration changed to an unknown owner during installation');
  }
  const installed = { present: true, registryFile: join(root, `opencode-protocol-after-${context.label}.reg`),
    aclFile: join(root, `opencode-protocol-after-${context.label}-acl.json`) };
  const stable = await readStableProtocolSnapshot(root, context.env, `capture ${context.label} installed protocol registration`);
  await writeFile(installed.registryFile, stable.values);
  await writeFile(installed.aclFile, JSON.stringify(stable.acl, null, 2) + '\n');
  return installed;
}

async function removeOwnedProtocolRegistration(context, installedSnapshot, root) {
  const expected = `"${context.binary}"`;
  const script = String.raw`
$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$protocol='HKCU:\Software\Classes\opencode';$expected=[IO.Path]::GetFullPath($env:CROSSCHAT_DESKTOP_OWNED_BINARY)
if(Test-Path -LiteralPath $protocol){
  $reg=Join-Path $env:SystemRoot 'System32\reg.exe';$currentFile=$env:CROSSCHAT_DESKTOP_PROTOCOL_VERIFY_FILE
  try{
    & $reg export 'HKCU\Software\Classes\opencode' $currentFile /y | Out-Null
    if($LASTEXITCODE -ne 0){throw 'Could not re-read the installed OpenCode protocol registration'}
    $expectedBytes=[IO.File]::ReadAllBytes($env:CROSSCHAT_DESKTOP_PROTOCOL_INSTALLED_REG)
    $currentBytes=[IO.File]::ReadAllBytes($currentFile)
    if($expectedBytes.Length -ne $currentBytes.Length -or [Convert]::ToBase64String($expectedBytes) -cne [Convert]::ToBase64String($currentBytes)){
      throw 'OpenCode protocol values changed after the installed snapshot; refusing to remove user data'
    }
    $sections=[System.Security.AccessControl.AccessControlSections]::Owner -bor [System.Security.AccessControl.AccessControlSections]::Group -bor [System.Security.AccessControl.AccessControlSections]::Access
    $aclItems=ConvertFrom-Json -InputObject (Get-Content -LiteralPath $env:CROSSCHAT_DESKTOP_PROTOCOL_INSTALLED_ACL -Raw)
    $actualItems=[System.Collections.Generic.List[object]]::new()
    function Visit-ProtocolKey([Microsoft.Win32.RegistryKey]$key,[string]$relative){
      $actualItems.Add(@{relative=$relative;sddl=$key.GetAccessControl($sections).GetSecurityDescriptorSddlForm($sections)})
      foreach($name in $key.GetSubKeyNames()){
        $next=if($relative){$relative+'\'+$name}else{$name}
        $child=$key.OpenSubKey($name)
        if($null -eq $child){throw "OpenCode protocol ACL key disappeared during verification: $next"}
        try{Visit-ProtocolKey $child $next}finally{$child.Dispose()}
      }
    }
    $rootKey=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\opencode')
    if($null -eq $rootKey){throw 'OpenCode protocol ACL key disappeared during verification: <root>'}
    try{Visit-ProtocolKey $rootKey ''}finally{$rootKey.Dispose()}
    if($actualItems.Count -ne $aclItems.Count){throw 'OpenCode protocol ACL tree changed after the installed snapshot; refusing to remove user data'}
    foreach($item in $aclItems){
      $actual=@($actualItems | Where-Object { $_.relative -ceq [string]$item.relative })
      if($actual.Count -ne 1){throw 'OpenCode protocol ACL tree changed after the installed snapshot; refusing to remove user data'}
      if($actual[0].sddl -cne [string]$item.sddl){throw 'OpenCode protocol ACL changed after the installed snapshot; refusing to remove user data'}
    }
  }finally{if(Test-Path -LiteralPath $currentFile){Remove-Item -LiteralPath $currentFile -Force}}
  $commandKey=$protocol+'\shell\open\command'
  if(-not (Test-Path -LiteralPath $commandKey)){throw 'OpenCode protocol command key is missing; owner cannot be verified'}
  $command=(Get-Item -LiteralPath $commandKey).GetValue('')
  if(-not ($command -is [string]) -or -not $command.StartsWith('"'+$expected+'"',[StringComparison]::OrdinalIgnoreCase)){throw 'Refusing to remove protocol registration not owned by this install'}
  Remove-Item -LiteralPath $protocol -Recurse -Force
}
@{removed=$true}|ConvertTo-Json
`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const state = await windowsState(context.env, `verify ${context.label} protocol ownership before removal`);
      if (!state.protocolKey) return;
      if (!installedSnapshot || !await protocolMatchesSnapshot(state, installedSnapshot, root, context.env)) {
        throw new Error('OpenCode protocol registration changed after installation; refusing to remove user data');
      }
      if (typeof state.protocolCommand !== 'string' || !state.protocolCommand.toLowerCase().startsWith(expected.toLowerCase())) {
        throw new Error('OpenCode protocol registration changed to an unknown owner; refusing to replace it');
      }
  // Registry has no conditional tree-delete API, so recheck the complete values and ACL immediately before removal.
      await powershell(script, { ...context.env, CROSSCHAT_DESKTOP_OWNED_BINARY: context.binary,
        CROSSCHAT_DESKTOP_PROTOCOL_INSTALLED_REG: installedSnapshot.registryFile,
        CROSSCHAT_DESKTOP_PROTOCOL_INSTALLED_ACL: installedSnapshot.aclFile,
        CROSSCHAT_DESKTOP_PROTOCOL_VERIFY_FILE: join(root, `opencode-protocol-remove-check-${randomUUID()}.reg`) }, 'remove exact owned OpenCode protocol registration');
      return;
    } catch (error) {
      if (!isProtocolAclSnapshotRace(error) || attempt === 3) throw error;
      await delay(125 * (attempt + 1));
    }
  }
}

async function restoreProtocolTree(context, snapshot, root) {
  let state = await windowsState(context.env, `inspect ${context.label} protocol after uninstall`);
  if (!state.protocolKey) {
    if (snapshot !== undefined) {
      const executable = join(process.env.SystemRoot, 'System32', 'reg.exe');
      const result = await runCommand(executable, ['import', snapshot.registryFile], { env: context.env, timeout: 30000 });
      if (result.code !== 0 || result.timedOut || result.signal !== null) throw new Error(`Could not restore the original OpenCode protocol registration (${result.code})`);
      await powershell(protocolAclRestoreScript, { ...context.env, CROSSCHAT_DESKTOP_PROTOCOL_ACL: snapshot.aclFile }, 'restore original OpenCode protocol ACL');
    }
  } else {
    const actual = await readStableProtocolSnapshot(root, context.env, `inspect ${context.label} protocol before restoration`);
    const original = snapshot === undefined ? undefined : {
      values: await readFile(snapshot.registryFile),
      acl: JSON.parse(await readFile(snapshot.aclFile, 'utf8')),
    };
    const originalValuesMatch = original !== undefined && actual.values.equals(original.values);
    const originalAclMatches = originalValuesMatch && compareProtocolAclSnapshots(original.acl, actual.acl).matches;
    const installedSnapshot = context.protocolInstalledSnapshot === undefined ? undefined : {
      values: await readFile(context.protocolInstalledSnapshot.registryFile),
      acl: JSON.parse(await readFile(context.protocolInstalledSnapshot.aclFile, 'utf8')),
    };
    const installedSnapshotMatches = installedSnapshot !== undefined && protocolSnapshotsMatch(installedSnapshot, actual);
    const action = protocolRestorationAction({ originalValuesMatch, originalAclMatches, installedSnapshotMatches });
    if (action === 'restore-original-acl') {
      await powershell(protocolAclRestoreScript, { ...context.env, CROSSCHAT_DESKTOP_PROTOCOL_ACL: snapshot.aclFile }, 'restore original OpenCode protocol ACL');
    } else if (action === 'remove-installed-registration') {
      await removeOwnedProtocolRegistration(context, context.protocolInstalledSnapshot, root);
      state = await windowsState(context.env, `inspect ${context.label} protocol after removing installed registration`);
      if (snapshot !== undefined && !state.protocolKey) {
        const executable = join(process.env.SystemRoot, 'System32', 'reg.exe');
        const result = await runCommand(executable, ['import', snapshot.registryFile], { env: context.env, timeout: 30000 });
        if (result.code !== 0 || result.timedOut || result.signal !== null) throw new Error(`Could not restore the original OpenCode protocol registration (${result.code})`);
        await powershell(protocolAclRestoreScript, { ...context.env, CROSSCHAT_DESKTOP_PROTOCOL_ACL: snapshot.aclFile }, 'restore original OpenCode protocol ACL');
      }
    } else if (action === 'refuse') {
      throw new Error('OpenCode protocol registration differs from both snapshots; refusing to replace user data');
    }
  }
  state = await windowsState(context.env, `verify ${context.label} original protocol registration restoration`);
  const matches = await protocolMatchesSnapshot(state, snapshot, root, context.env);
  if (!matches) throw new Error('OpenCode protocol registration does not match the pre-test snapshot');
  return { state, matches };
}

async function restoreProtocolRegistration(context, snapshot, root) {
  const { state, matches } = await restoreProtocolTree(context, snapshot, root);
  if (!matches) throw new Error('OpenCode Desktop uninstall did not restore the exact pre-test protocol registration');
  return state;
}

function assertCleanWindows(state, snapshot, protocolMatches) {
  if (!desktopStateMatchesBaseline(state, snapshot !== undefined, protocolMatches)) {
    throw new Error(`OpenCode Desktop installation, protocol, shortcut or installer cache differs from the verified baseline (GUID ${guid}); refusing to continue`);
  }
}

async function signature(path, env) {
  const result = await powershell(String.raw`$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$s=Get-AuthenticodeSignature -LiteralPath $env:CROSSCHAT_DESKTOP_VERIFY_FILE;@{status=$s.Status.ToString();subject=$s.SignerCertificate.Subject}|ConvertTo-Json`,
    { ...env, CROSSCHAT_DESKTOP_VERIFY_FILE: path }, 'verify Authenticode signature');
  validateDesktopSignature(result);
  return result;
}

function ownsQuietUninstall(state, context) {
  const expected = `"${context.uninstaller}" /currentuser /S`;
  if (typeof state.quiet !== 'string' || state.quiet.toLowerCase() !== expected.toLowerCase()) throw new Error('Desktop uninstall registry does not point to this exact owned installation');
}

async function removeOwnedSideEffects(context) {
  // Only exact artifacts absent before installation, with their content/target verified.
  const script = String.raw`
$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$expected=[IO.Path]::GetFullPath($env:CROSSCHAT_DESKTOP_OWNED_BINARY);$before=ConvertFrom-Json $env:CROSSCHAT_DESKTOP_BEFORE
foreach($entry in $before.sideEffects){
  if($entry.exists){throw 'Refusing to remove a pre-existing desktop artifact'}
  if(-not (Test-Path -LiteralPath $entry.path)){continue}
  if([IO.Path]::GetExtension($entry.path) -eq '.lnk'){
    $shell=New-Object -ComObject WScript.Shell;$shortcut=$shell.CreateShortcut($entry.path)
    if(-not [string]::Equals([IO.Path]::GetFullPath($shortcut.TargetPath),$expected,[StringComparison]::OrdinalIgnoreCase)){throw 'Shortcut target is not owned by this installation'}
  }else{
    if((Get-FileHash -LiteralPath $entry.path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $env:CROSSCHAT_DESKTOP_INSTALLER_SHA){throw 'Installer cache checksum is not the owned artifact'}
  }
  Remove-Item -LiteralPath $entry.path -Force
  $parent=Split-Path -Parent $entry.path
  if(-not $entry.parentExists -and (Test-Path -LiteralPath $parent) -and @(Get-ChildItem -LiteralPath $parent -Force).Count -eq 0){Remove-Item -LiteralPath $parent}
}
@{cleaned=$true}|ConvertTo-Json
`;
  await powershell(script, { ...context.env, CROSSCHAT_DESKTOP_OWNED_BINARY: context.binary,
    CROSSCHAT_DESKTOP_BEFORE: JSON.stringify(context.before), CROSSCHAT_DESKTOP_INSTALLER_SHA: context.artifact.sha256 }, 'remove owned installer side effects');
}

async function main() {
  if (process.env.CROSSCHAT_LIVE !== '1') throw new Error('CROSSCHAT_LIVE=1 is required for official desktop installation and live probes');
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Desktop compatibility currently requires Windows x64');
  const output = resolve(process.env.OPENCODE_DESKTOP_COMPAT_EVIDENCE ?? 'opencode-desktop-compat-evidence');
  await mkdir(output, { recursive: true });
  const parent = await realpath(process.env.RUNNER_TEMP ?? tmpdir());
  const root = await realpath(await mkdtemp(join(parent, 'crosschat-opencode-desktop-ci-')));
  const owner = randomUUID(); await writeFile(join(root, '.desktop-ci-owner'), owner);
  const existingFlag = process.argv.indexOf('--installer-existing');
  const existing = existingFlag < 0 ? process.env.OPENCODE_DESKTOP_INSTALLER_EXISTING : process.argv[existingFlag + 1];
  const downloads = new Map(); const contexts = []; let summary;
  async function installer(artifact, env) {
    if (downloads.has(artifact.sha256)) return downloads.get(artifact.sha256);
    let path;
    if (existing) {
      if (!isAbsolute(existing)) throw new Error('Existing installer path must be absolute');
      const details = await stat(existing);
      if (details.size === artifact.size && createHash('sha256').update(await readFile(existing)).digest('hex') === artifact.sha256) path = existing;
    }
    if (!path) {
      const bytes = await fetchBytes(artifact.url, artifact.size);
      if (bytes.length !== artifact.size || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error('Desktop official installer checksum or size mismatch');
      path = join(root, `${artifact.sha256}.exe`); await writeFile(path, bytes);
    }
    await signature(path, env);
    downloads.set(artifact.sha256, path);
    return path;
  }
  const operations = {
    async install(artifact, label) {
      const taskRoot = join(root, label); const env = await prepareDesktopProfile(taskRoot);
      const context = { artifact, label, taskRoot, env, binary: join(taskRoot, 'install', 'OpenCode.exe'),
        uninstaller: join(taskRoot, 'install', 'Uninstall OpenCode.exe'), started: false, removed: false };
      contexts.push(context);
      if (/\s/.test(taskRoot)) throw new Error('NSIS /D requires this probe to use an owned task path without spaces');
      context.before = await windowsState(env, `inspect ${label} installation state before install`);
      assertCleanWindows(context.before, protocolSnapshot, await protocolMatchesSnapshot(context.before, protocolSnapshot, root, env));
      const archive = await installer(artifact, env);
      try {
        context.started = true;
        const installed = await runCommand(archive, ['/S', '--no-desktop-shortcut', `/D=${join(taskRoot, 'install')}`], { env, cwd: taskRoot, timeout: 180000 });
        if (installed.code !== 0 || installed.timedOut) throw new Error(`Official desktop installer failed (${installed.code})`);
        await access(context.binary); await access(context.uninstaller);
        context.afterInstall = await windowsState(env, `inspect ${label} installation state after install`); ownsQuietUninstall(context.afterInstall, context);
        context.signature = await signature(context.binary, env);
        await writeFile(join(output, `${label}-installation.json`), JSON.stringify({ before: context.before, afterInstall: context.afterInstall, signature: context.signature }, null, 2));
        return context;
      } catch (error) {
        const uninstallerExists = await exists(context.uninstaller);
        if (!uninstallerExists) {
          try { context.protocolInstalledSnapshot = await captureInstalledProtocolRegistration(context, protocolSnapshot, root); }
          catch (cleanup) { throw new AggregateError([error, cleanup], 'Desktop installation and its protocol snapshot failed'); }
        }
        if (uninstallerExists) {
          try { await operations.uninstall(context); }
          catch (cleanup) { throw new AggregateError([error, cleanup], 'Desktop installation and its cleanup failed'); }
        }
        throw error;
      }
    },
    async probe(context, artifact, label) {
      return runDesktopProbeAttempt({ output, label, version: artifact.version }, ({ reportPath, evidencePath }) => {
        return runCommand(process.execPath, [join(repositoryRoot, 'scripts', 'opencode-desktop-compat.mjs'), '--report', reportPath, '--evidence', evidencePath], {
          env: { ...context.env, CROSSCHAT_LIVE: '1', OPENCODE_DESKTOP_BIN: context.binary, OPENCODE_DESKTOP_TASK_ROOT: context.taskRoot, OPENCODE_EXPECTED_VERSION: artifact.version }, timeout: 360000,
        });
      });
    },
    async uninstall(context) {
      if (context.removed) return;
      const before = await windowsState(context.env, `inspect ${context.label} installation state before uninstall`); ownsQuietUninstall(before, context);
      context.protocolInstalledSnapshot = await captureInstalledProtocolRegistration(context, protocolSnapshot, root);
      await signature(context.uninstaller, context.env);
      const removed = await runCommand(context.uninstaller, ['/currentuser', '/S'], { env: context.env, cwd: context.taskRoot, timeout: 180000 });
      if (removed.code !== 0 || removed.timedOut) throw new Error(`Owned desktop uninstaller failed (${removed.code})`);
      let state; const deadline = Date.now() + 30000;
      do { state = await windowsState(context.env, `verify ${context.label} Windows uninstaller registration removal`); if (!state.installKey && !state.uninstallKey) break; await delay(500); } while (Date.now() < deadline);
      if (state.installKey || state.uninstallKey) throw new Error('Owned desktop uninstall did not remove its installer registration');
      state = await restoreProtocolRegistration(context, protocolSnapshot, root);
      await removeOwnedSideEffects(context);
      context.afterUninstall = await windowsState(context.env, `inspect ${context.label} Windows installation state after uninstall`);
      const protocolMatches = await protocolMatchesSnapshot(context.afterUninstall, protocolSnapshot, root, context.env);
      assertCleanWindows(context.afterUninstall, protocolSnapshot, protocolMatches);
      context.removed = true;
      await writeFile(join(output, `${context.label}-uninstallation.json`), JSON.stringify({ afterUninstall: context.afterUninstall,
        protocolRegistrationRestored: protocolMatches, exitCode: removed.code }, null, 2));
    },
  };
  async function cleanupTaskRoot() {
    if (contexts.some((context) => context.started && !context.removed)) throw new Error('An installation did not complete verified uninstall; retain its owned task root');
    const target = await realpath(root); const child = relative(parent, target);
    if (target !== root || !child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)
      || !basename(target).startsWith('crosschat-opencode-desktop-ci-') || await readFile(join(target, '.desktop-ci-owner'), 'utf8') !== owner) throw new Error('Unsafe desktop CI cleanup target');
    await rm(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
  try {
    protocolSnapshot = await snapshotProtocolRegistration(root, process.env);
    const baseline = parseDesktopArtifactManifest(JSON.parse(await readFile(new URL('./opencode-desktop-baseline.json', import.meta.url), 'utf8')), process.platform, process.arch);
    const candidate = requireApprovedCandidateVersion(
      parseDesktopArtifactManifest(JSON.parse((await fetchBytes('https://opencode.ai/update/api/latest/desktop/opencode', 256 * 1024, 30000)).toString()), process.platform, process.arch),
      process.env.OPENCODE_DESKTOP_EXPECTED_CANDIDATE_VERSION,
    );
    const builds = { baseline, candidate };
    summary = await runDesktopBuildSequence(builds, operations);
  } catch (error) {
    summary = { schema: 1, tool, platform: process.platform, arch: process.arch, classification: { kind: error?.category === 'unsupported' ? 'unsupported-release' : 'infrastructure', notify: false }, error: errorMessage(error) };
  } finally {
    for (const context of contexts) {
      if (!context.started || context.removed) continue;
      try {
        await restoreProtocolTree(context, protocolSnapshot, root);
        summary.protocolRegistrationRestoredAfterFailure = context.label;
      } catch (error) {
        summary.protocolRestoreError = errorMessage(error);
        summary.classification = { kind: 'infrastructure', notify: false };
      }
    }
    try {
      await cleanupTaskRoot();
      summary.downloadCleanup = 'removed';
    } catch (error) { summary.downloadCleanup = errorMessage(error); summary.retainedRoot = root; summary.classification = { kind: 'infrastructure', notify: false }; }
    await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  }
  process.stdout.write(JSON.stringify(summary.classification) + '\n');
  if (summary.classification.kind !== 'compatible') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
