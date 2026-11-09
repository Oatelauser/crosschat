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

export function validateDesktopSignature(signature) {
  if (!record(signature) || signature.status !== 'Valid' || typeof signature.subject !== 'string'
    || !/(?:^|,\s*)O="Anomaly Innovations, Inc https:\/\/anoma\.ly\/"(?:,|$)/.test(signature.subject)) {
    throw new Error('Desktop Authenticode signature is not valid for the expected publisher organization');
  }
  return true;
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
$profiles=@($env:APPDATA,(Join-Path $env:USERPROFILE 'AppData\Roaming'),[Environment]::GetFolderPath('ApplicationData')) | Select-Object -Unique
$locals=@($env:LOCALAPPDATA,(Join-Path $env:USERPROFILE 'AppData\Local'),[Environment]::GetFolderPath('LocalApplicationData')) | Select-Object -Unique
$paths=@(); foreach($p in $profiles){$paths+=Join-Path $p 'Microsoft\Windows\Start Menu\Programs\OpenCode.lnk'}
$paths+=Join-Path ([Environment]::GetFolderPath('Desktop')) 'OpenCode.lnk'
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

async function windowsState(env) { return powershell(windowsStateScript, env, 'inspect Windows installation state'); }
function assertCleanWindows(state) {
  if (state.installKey || state.uninstallKey || state.protocolKey || state.machineInstallKey || state.machineUninstallKey
    || state.sideEffects.some((item) => item.exists)) throw new Error(`OpenCode Desktop installation, protocol, shortcut or installer cache already exists (GUID ${guid}); refusing to replace it`);
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
$protocol='HKCU:\Software\Classes\opencode'
if(Test-Path -LiteralPath $protocol){
  $command=(Get-Item -LiteralPath ($protocol+'\shell\open\command')).GetValue('')
  if(-not $command.StartsWith('"'+$expected+'"',[StringComparison]::OrdinalIgnoreCase)){throw 'Refusing to remove protocol registration owned by another executable'}
  Remove-Item -LiteralPath $protocol -Recurse -Force
}
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
      context.before = await windowsState(env); assertCleanWindows(context.before);
      const archive = await installer(artifact, env);
      try {
        context.started = true;
        const installed = await runCommand(archive, ['/S', '--no-desktop-shortcut', `/D=${join(taskRoot, 'install')}`], { env, cwd: taskRoot, timeout: 180000 });
        if (installed.code !== 0 || installed.timedOut) throw new Error(`Official desktop installer failed (${installed.code})`);
        await access(context.binary); await access(context.uninstaller);
        context.afterInstall = await windowsState(env); ownsQuietUninstall(context.afterInstall, context);
        context.signature = await signature(context.binary, env);
        await writeFile(join(output, `${label}-installation.json`), JSON.stringify({ before: context.before, afterInstall: context.afterInstall, signature: context.signature }, null, 2));
        return context;
      } catch (error) {
        if (await exists(context.uninstaller)) {
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
      const before = await windowsState(context.env); ownsQuietUninstall(before, context);
      await signature(context.uninstaller, context.env);
      const removed = await runCommand(context.uninstaller, ['/currentuser', '/S'], { env: context.env, cwd: context.taskRoot, timeout: 180000 });
      if (removed.code !== 0 || removed.timedOut) throw new Error(`Owned desktop uninstaller failed (${removed.code})`);
      let state; const deadline = Date.now() + 30000;
      do { state = await windowsState(context.env); if (!state.installKey && !state.uninstallKey) break; await delay(500); } while (Date.now() < deadline);
      if (state.installKey || state.uninstallKey) throw new Error('Owned desktop uninstall did not remove its installer registration');
      await removeOwnedSideEffects(context);
      context.afterUninstall = await windowsState(context.env); assertCleanWindows(context.afterUninstall);
      context.removed = true;
      await writeFile(join(output, `${context.label}-uninstallation.json`), JSON.stringify({ afterUninstall: context.afterUninstall, exitCode: removed.code }, null, 2));
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
    const builds = { baseline: parseDesktopArtifactManifest(JSON.parse(await readFile(new URL('./opencode-desktop-baseline.json', import.meta.url), 'utf8')), process.platform, process.arch),
      candidate: parseDesktopArtifactManifest(JSON.parse((await fetchBytes('https://opencode.ai/update/api/latest/desktop/opencode', 256 * 1024, 30000)).toString()), process.platform, process.arch) };
    summary = await runDesktopBuildSequence(builds, operations);
  } catch (error) {
    summary = { schema: 1, tool, platform: process.platform, arch: process.arch, classification: { kind: error?.category === 'unsupported' ? 'unsupported-release' : 'infrastructure', notify: false }, error: errorMessage(error) };
  } finally {
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
