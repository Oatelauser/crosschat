#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { classifyCompatibility } from './opencode-compat-report.mjs';

const tool = 'claude-code-cli';
const nativePackage = '@anthropic-ai/claude-code-win32-x64';
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const slug = /^[a-z0-9-]{1,100}$/;
const sri = /^sha512-[A-Za-z0-9+/]{85}[AQgw]==$/;
const maxArchiveBytes = 512 * 1024 * 1024;
const maxUnpackedBytes = 512 * 1024 * 1024;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const message = (error) => error instanceof Error ? error.message : String(error);

export const claudeCompatibilityScope = Object.freeze({ officialNativeCLI: true, productionWrapper: true, scriptedLocalModel: true,
  streamJSON: true, interactiveTUI: false, desktop: false, modelIntelligence: false });
export const claudeRequiredChecks = Object.freeze(['official-wrapper-and-native-session-registration', 'messages-model-and-native-bash-identity',
  'production-discovery-and-idle-queue-steer', 'busy-queue-step-boundary', 'busy-steer-step-boundary',
  'native-shell-send-and-conversation-reply', 'exit-and-missing-target-do-not-create-session']);

function supportedVersion(version) {
  if (typeof version !== 'string' || version.length > 80) throw new Error('Invalid official Claude Code version');
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)?$/.exec(version);
  if (!match || match.slice(1, 4).some((part) => !Number.isSafeInteger(Number(part)))) throw new Error('Invalid official Claude Code version');
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  if (version.includes('-') || major !== 2 || (minor === 0 || (minor === 1 && patch < 309))) {
    throw Object.assign(new Error('Claude Code release is outside the configured stable >=2.1.309 <3 probe range; this does not determine upstream protocol support'), { category: 'unsupported', version });
  }
  return version;
}

/** Resolve the public CLI version once, then request that exact native version. */
export function parseClaudeLatestManifest(input) {
  if (!record(input) || input.name !== '@anthropic-ai/claude-code') throw new Error('Invalid official Claude Code main-package metadata');
  return supportedVersion(input.version);
}

export function parseClaudeNpmManifest(input, platform, arch, expectedVersion) {
  if (!record(input) || input.name !== nativePackage || !record(input.dist)) throw new Error('Invalid official Claude Code native-package metadata');
  const version = supportedVersion(input.version);
  if (platform !== 'win32' || arch !== 'x64') throw new Error('This Claude Code probe is configured for Windows x64 only; platform matrix scope remains separate');
  if (expectedVersion !== undefined && version !== expectedVersion) throw new Error('Official Claude Code main and native package versions differ');
  const url = `https://registry.npmjs.org/${nativePackage}/-/claude-code-win32-x64-${version}.tgz`;
  if (input.dist.tarball !== url || !sri.test(input.dist.integrity ?? '')) throw new Error('Invalid official Claude Code archive URL or canonical SHA-512 SRI');
  return { name: nativePackage, version, url, integrity: input.dist.integrity };
}

function validateArtifact(artifact) {
  if (!record(artifact)) throw new Error('Invalid Claude Code artifact');
  return parseClaudeNpmManifest({ name: artifact.name, version: artifact.version, dist: { tarball: artifact.url, integrity: artifact.integrity } }, 'win32', 'x64');
}

export function verifyClaudeNpmArtifact(bytes, artifact) {
  if (!(bytes instanceof Uint8Array) || !sri.test(artifact?.integrity ?? '')) throw new Error('Invalid Claude Code archive integrity input');
  const expected = Buffer.from(artifact.integrity.slice(7), 'base64');
  if (!timingSafeEqual(createHash('sha512').update(bytes).digest(), expected)) throw new Error('Official Claude Code archive failed SHA-512 verification');
  return true;
}

async function realDirectoryTree(path) {
  for (let cursor = path;; cursor = dirname(cursor)) {
    const info = await lstat(cursor);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Claude Code test paths and their ancestors must be real directories without links');
    if (dirname(cursor) === cursor) break;
  }
  return realpath(path);
}

function localAbsolutePath(path) {
  return typeof path === 'string' && isAbsolute(path) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(path) && !/^[\\/]{2}/.test(path)
    && !path.split(/[\\/]/).some((part) => part === '.' || part === '..');
}

export async function createClaudeTaskRoot(suppliedParent) {
  if (suppliedParent !== undefined && !localAbsolutePath(suppliedParent)) throw new Error('Claude Code compatibility parent must be an absolute local directory');
  const parent = await realDirectoryTree(suppliedParent === undefined ? await realpath(tmpdir()) : resolve(suppliedParent));
  const root = await realpath(await mkdtemp(join(parent, 'crosschat-claude-ci-'))); const owner = randomUUID();
  await writeFile(join(root, '.fixture-owner'), owner, { flag: 'wx' });
  return { parent, root, owner };
}

/** Verify the resolved path, ownership marker and containing directory before any recursive removal. */
export async function removeClaudeOwnedPath(parent, target, owner) {
  if (!localAbsolutePath(parent) || !localAbsolutePath(target) || !uuid.test(owner ?? '')) throw new Error('Invalid Claude Code cleanup ownership');
  const containing = await realDirectoryTree(resolve(parent)); const real = await realDirectoryTree(resolve(target)); const child = relative(containing, real);
  if (real !== resolve(target) || !child || isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`)) throw new Error('Refusing Claude Code cleanup outside its verified owned parent');
  const marker = join(real, '.fixture-owner'); const markerInfo = await lstat(marker);
  if (!markerInfo.isFile() || markerInfo.isSymbolicLink() || await readFile(marker, 'utf8') !== owner) throw new Error('Claude Code cleanup owner does not match');
  await rm(real, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

function tarText(header, offset, length) {
  const field = header.subarray(offset, offset + length); const zero = field.indexOf(0);
  return field.subarray(0, zero === -1 ? field.length : zero).toString('utf8');
}

function tarNumber(header, offset, length) {
  const field = header.subarray(offset, offset + length).toString('ascii').replaceAll('\0', '').trim();
  if (!/^[0-7]+$/.test(field)) throw new Error('Invalid native tar numeric field');
  const value = Number.parseInt(field, 8);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Native tar numeric field exceeds its budget');
  return value;
}

/** This is deliberately limited to the four ordinary files in the verified official native package. */
export async function extractClaudeNativeArchive(bytes, artifact, destination) {
  validateArtifact(artifact); verifyClaudeNpmArtifact(bytes, artifact);
  if (bytes.byteLength > maxArchiveBytes || !localAbsolutePath(destination)) throw new Error('Invalid native archive size or extraction path');
  const unpacked = gunzipSync(bytes, { maxOutputLength: maxUnpackedBytes });
  const allowed = new Set(['package/claude.exe', 'package/package.json', 'package/LICENSE.md', 'package/README.md']);
  const entries = new Map(); const seen = new Set(); let offset = 0; let ended = false;
  while (offset + 512 <= unpacked.length) {
    const header = unpacked.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      if (unpacked.length - offset < 1024 || !unpacked.subarray(offset).every((byte) => byte === 0)) throw new Error('Invalid native tar terminator');
      ended = true; break;
    }
    const expected = tarNumber(header, 148, 8);
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (checksum !== expected || tarText(header, 257, 5) !== 'ustar') throw new Error('Invalid native tar header checksum or format');
    const prefix = tarText(header, 345, 155); const shortName = tarText(header, 0, 100); const name = prefix ? `${prefix}/${shortName}` : shortName;
    const size = tarNumber(header, 124, 12); const kind = header[156];
    if (seen.has(name)) throw new Error('Duplicate native archive entry'); seen.add(name);
    if (kind === 53 && name === 'package/' && size === 0) { offset += 512; continue; }
    if ((kind !== 0 && kind !== 48) || !allowed.has(name)) throw new Error('Unexpected native archive path or non-ordinary file; links are never extracted');
    if (size < 1 || size > (name === 'package/claude.exe' ? maxUnpackedBytes : 1024 * 1024)) throw new Error('Native archive entry exceeds its byte budget');
    const start = offset + 512; const end = start + size; const next = start + Math.ceil(size / 512) * 512;
    if (end > unpacked.length || next > unpacked.length) throw new Error('Truncated native archive entry');
    entries.set(name, unpacked.subarray(start, end)); offset = next;
  }
  if (!ended || !entries.has('package/claude.exe') || !entries.has('package/package.json')) throw new Error('Native archive is missing its binary, metadata or terminator');
  let metadata;
  try { metadata = JSON.parse(entries.get('package/package.json').toString('utf8')); } catch { throw new Error('Native archive package metadata is malformed'); }
  if (!record(metadata) || metadata.name !== artifact.name || metadata.version !== artifact.version
    || entries.get('package/claude.exe').subarray(0, 2).toString('ascii') !== 'MZ') throw new Error('Native archive package or executable identity does not match its verified artifact');
  await mkdir(destination, { recursive: true }); const actual = await realDirectoryTree(resolve(destination));
  if (actual !== resolve(destination)) throw new Error('Native extraction directory changed its resolved ownership');
  await mkdir(join(actual, 'package'));
  for (const [name, content] of entries) await writeFile(join(actual, name), content, { flag: 'wx', mode: 0o600 });
  return { binary: join(actual, 'package', 'claude.exe'), metadata };
}

/** A timed-out controller cannot prove that its native descendants released their resources. */
export function runClaudeProcess(binary, args, options = {}) {
  return new Promise((done, reject) => {
    const child = spawn(binary, args, { cwd: options.cwd ?? repositoryRoot, env: options.env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let settled = false;
    const finish = (value, error) => {
      if (settled) return; settled = true; clearTimeout(timer); child.stdout.destroy(); child.stderr.destroy();
      if (error) reject(error); else done({ ...value, stdout, stderr, pid: child.pid });
    };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* Ownership remains unknown. */ } finish({ code: null, signal: null, timedOut: true }); }, options.timeout ?? 30000);
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-128000); }); child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-128000); });
    child.once('error', (error) => finish(undefined, error)); child.once('close', (code, signal) => finish({ code, signal, timedOut: false }));
  });
}

function validScope(value) {
  return record(value) && Object.keys(value).length === Object.keys(claudeCompatibilityScope).length
    && Object.entries(claudeCompatibilityScope).every(([key, expected]) => value[key] === expected);
}

function validReport(report, artifact, runId) {
  if (!record(report) || report.schema !== 1 || report.tool !== tool || report.platform !== 'win32' || report.arch !== 'x64'
    || report.version !== artifact.version || !uuid.test(report.runId ?? '') || (runId !== undefined && report.runId !== runId) || !validScope(report.scope)
    || !Array.isArray(report.checks) || report.checks.some((check) => !record(check) || !claudeRequiredChecks.includes(check.name) || check.status !== 'passed' || !Number.isFinite(check.elapsedMs) || check.elapsedMs < 0)
    || new Set(report.checks.map((check) => check.name)).size !== report.checks.length) return false;
  return report.status === 'passed' ? report.stage === 'done' && report.category === null && report.checks.length === claudeRequiredChecks.length
    : report.status === 'failed' && ['compatibility', 'infrastructure'].includes(report.category) && slug.test(report.stage ?? '') && report.stage !== 'done' && slug.test(report.check ?? '')
      && (report.category !== 'compatibility' || claudeRequiredChecks.includes(report.check));
}

const normalProcess = (result) => record(result) && result.timedOut === false && result.signal === null && [0, 1].includes(result.code);
const processMatches = (report) => normalProcess(report.process) && report.process.code === (report.status === 'passed' ? 0 : 1);
const infrastructure = (version, stage, error) => ({ schema: 1, tool, platform: 'win32', arch: 'x64', version, status: 'failed', category: 'infrastructure', stage, check: stage, error: message(error) });

export function hasClaudeRuntimeReleaseProof(cleanup) {
  return record(cleanup) && cleanup.runtimeStopped === true && cleanup.registrationRemoved === true && cleanup.modelClosed === true && cleanup.removed === true
    && cleanup.forced === false && Array.isArray(cleanup.errors) && cleanup.errors.length === 0;
}

/** The report path does not exist before this exact child receives its random run ID. */
export async function runClaudeProbeAttempt({ output, label, artifact }, execute) {
  if (!['baseline', 'candidate', 'retry'].includes(label)) throw new Error('Invalid Claude Code probe label');
  const directory = await mkdtemp(join(output, `${label}-`)); const reportPath = join(directory, 'report.json'); const runId = randomUUID();
  let result;
  try { result = await execute({ reportPath, runId, directory }); } catch (error) { return infrastructure(artifact.version, 'probe-process', error); }
  if (!normalProcess(result)) return infrastructure(artifact.version, 'probe-process', 'Probe did not exit normally; native runtime release is unknown');
  let report;
  try { report = JSON.parse(await readFile(reportPath, 'utf8')); } catch { return infrastructure(artifact.version, 'probe-report', 'Probe did not produce a fresh valid report'); }
  if (!validReport(report, artifact, runId) || result.code !== (report.status === 'passed' ? 0 : 1)) return infrastructure(artifact.version, 'probe-report', 'Fresh probe identity, complete checks, scope or process exit disagrees with the report');
  return { ...report, process: { code: result.code, signal: result.signal, timedOut: result.timedOut } };
}

function classify(baseline, candidate, retry) {
  const classification = classifyCompatibility(baseline, candidate, retry);
  if (classification.kind === 'regression' && new Set([baseline.runId, candidate.runId, retry.runId]).size !== 3) return { kind: 'inconclusive', notify: false };
  return classification;
}

export async function runClaudeBuildSequence(builds, operations) {
  const summary = { schema: 1, tool, platform: 'win32', arch: 'x64', builds, scope: claudeCompatibilityScope, installationCleanup: 'incomplete' };
  async function attempt(artifact, label) {
    const installation = await operations.install(artifact, label); let report;
    try { report = await operations.probe(installation, artifact, label); } catch (error) { report = infrastructure(artifact.version, 'probe-process', error); }
    if (!validReport(report, artifact) || !processMatches(report)) report = infrastructure(artifact.version, 'probe-report', 'Fresh process/report evidence is invalid');
    summary[label] = report;
    if (!hasClaudeRuntimeReleaseProof(report.cleanup)) {
      summary.retainedInstallation = { label, version: artifact.version, root: installation.root, reason: 'Owned native runtime release is unknown; do not remove or start another build' };
      throw new Error(summary.retainedInstallation.reason);
    }
    try { await operations.remove(installation, artifact, label); }
    catch (error) { summary.retainedInstallation = { label, version: artifact.version, root: installation.root, reason: message(error) }; throw error; }
    return report;
  }
  try {
    summary.builds = Object.freeze({ baseline: Object.freeze(validateArtifact(builds.baseline)), candidate: Object.freeze(validateArtifact(builds.candidate)) });
    summary.baseline = await attempt(summary.builds.baseline, 'baseline');
    if (summary.baseline.status === 'passed') {
      summary.candidate = await attempt(summary.builds.candidate, 'candidate');
      if (summary.candidate.status === 'failed' && summary.candidate.category === 'compatibility') summary.retry = await attempt(summary.builds.candidate, 'retry');
    }
    summary.installationCleanup = 'removed'; summary.classification = classify(summary.baseline, summary.candidate, summary.retry);
  } catch (error) { summary.error = message(error); summary.classification = { kind: error?.category === 'unsupported' ? 'unsupported-release' : 'infrastructure', notify: false }; }
  return summary;
}

/** Safe to import in an independent read-only workflow job: this function performs no I/O. */
export function claudeRegressionIdentity(summary) {
  if (!record(summary) || summary.schema !== 1 || summary.tool !== tool || summary.platform !== 'win32' || summary.arch !== 'x64' || !validScope(summary.scope)
    || summary.installationCleanup !== 'removed' || summary.classification?.kind !== 'regression' || summary.classification?.notify !== true || !record(summary.builds)) return;
  const { baseline, candidate, retry, builds } = summary;
  try { validateArtifact(builds.baseline); validateArtifact(builds.candidate); } catch { return; }
  if (!validReport(baseline, builds.baseline) || !validReport(candidate, builds.candidate) || !validReport(retry, builds.candidate)
    || [baseline, candidate, retry].some((report) => !processMatches(report) || !hasClaudeRuntimeReleaseProof(report.cleanup))
    || new Set([baseline.runId, candidate.runId, retry.runId]).size !== 3 || classify(baseline, candidate, retry).kind !== 'regression') return;
  return { marker: `<!-- claude-compat:${candidate.version}:win32:${candidate.check} -->`,
    title: `Claude Code ${candidate.version}: ${candidate.check} compatibility regression (win32)`,
    version: candidate.version, check: candidate.check, stage: candidate.stage, integrity: builds.candidate.integrity, baselineVersion: baseline.version };
}

async function fetchBytes(url, maxBytes, timeout = 120000) {
  const response = await globalThis.fetch(url, { redirect: 'error', signal: globalThis.AbortSignal.timeout(timeout) });
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > maxBytes) throw new Error('Official Claude Code request failed or exceeded its byte budget');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > maxBytes) throw new Error('Official Claude Code response exceeded its byte budget'); chunks.push(part.value); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks);
}

async function controllerEnvironment(root) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|LANG|LC_.*|TERM|COLORTERM|PROCESSOR_ARCHITECTURE|PROCESSOR_IDENTIFIER|NUMBER_OF_PROCESSORS|ProgramFiles.*|SYSTEMDRIVE|PROGRAMDATA|OS)$/i.test(key)));
  Object.assign(env, { HOME: join(root, 'home'), USERPROFILE: join(root, 'home'), APPDATA: join(root, 'appdata'), LOCALAPPDATA: join(root, 'localappdata'),
    TEMP: join(root, 'tmp'), TMP: join(root, 'tmp'), TMPDIR: join(root, 'tmp'), XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'),
    XDG_DATA_HOME: join(root, 'data'), XDG_STATE_HOME: join(root, 'state'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), NO_COLOR: '1', CI: '1' });
  if (process.platform === 'win32') { env.HOMEDRIVE = env.HOME.slice(0, 2); env.HOMEPATH = env.HOME.slice(2); }
  await Promise.all(['home', 'appdata', 'localappdata', 'tmp', 'config', 'cache', 'data', 'state'].map((name) => mkdir(join(root, name), { recursive: true })));
  await writeFile(join(root, 'gitconfig'), ''); return env;
}

async function main() {
  if (process.env.CROSSCHAT_LIVE !== '1') throw new Error('CROSSCHAT_LIVE=1 is required for official Claude Code downloads and isolated native probes');
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Only Windows x64 is configured; platform matrix scope remains separate');
  const output = resolve(process.env.CLAUDE_COMPAT_EVIDENCE ?? 'claude-compat-evidence'); await mkdir(output, { recursive: true });
  const task = await createClaudeTaskRoot(process.env.CLAUDE_COMPAT_TASK_PARENT); const installations = []; const archives = new Map();
  let summary = { schema: 1, tool, platform: 'win32', arch: 'x64', scope: claudeCompatibilityScope, builds: {}, installationCleanup: 'incomplete', classification: { kind: 'infrastructure', notify: false } };
  async function archive(artifact) {
    const key = createHash('sha256').update(artifact.integrity).digest('hex');
    if (!archives.has(key)) {
      let bytes;
      if (process.env.CLAUDE_COMPAT_ARCHIVE !== undefined) {
        const path = process.env.CLAUDE_COMPAT_ARCHIVE;
        if (!localAbsolutePath(path)) throw new Error('CLAUDE_COMPAT_ARCHIVE must be an absolute local archive path');
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.size > maxArchiveBytes) throw new Error('CLAUDE_COMPAT_ARCHIVE must be a bounded ordinary file');
        bytes = await readFile(path);
      } else bytes = await fetchBytes(artifact.url, maxArchiveBytes, 15 * 60 * 1000);
      verifyClaudeNpmArtifact(bytes, artifact);
      const path = join(task.root, `${key}.tgz`); await writeFile(path, bytes, { flag: 'wx' }); archives.set(key, path);
    }
    return archives.get(key);
  }
  try {
    const pinned = JSON.parse(await readFile(new URL('./claude-compat-baseline.json', import.meta.url), 'utf8'));
    if (!record(pinned) || pinned.schema !== 1) throw new Error('Invalid pinned Claude Code baseline');
    const builds = { baseline: parseClaudeNpmManifest(pinned.package, process.platform, process.arch) }; summary.builds = builds;
    const version = parseClaudeLatestManifest(JSON.parse((await fetchBytes('https://registry.npmjs.org/@anthropic-ai/claude-code/latest', 2 * 1024 * 1024)).toString('utf8')));
    builds.candidate = parseClaudeNpmManifest(JSON.parse((await fetchBytes(`https://registry.npmjs.org/${nativePackage}/${version}`, 2 * 1024 * 1024)).toString('utf8')), process.platform, process.arch, version);
    summary = await runClaudeBuildSequence(builds, {
      async install(artifact, label) {
        const root = join(task.root, `install-${label}`); await mkdir(root); await writeFile(join(root, '.fixture-owner'), task.owner, { flag: 'wx' });
        const installation = { root, safe: true, removed: false, binary: undefined }; installations.push(installation);
        const extracted = await extractClaudeNativeArchive(await readFile(await archive(artifact)), artifact, root);
        installation.binary = extracted.binary; await mkdir(join(root, 'fixtures')); return installation;
      },
      async probe(installation, artifact, label) {
        installation.safe = false;
        return runClaudeProbeAttempt({ output, label, artifact }, async ({ reportPath, runId, directory }) => {
          const result = await runClaudeProcess(process.execPath, [join(repositoryRoot, 'scripts', 'claude-compat.mjs'), '--report', reportPath, '--run-id', runId], {
            env: { ...(await controllerEnvironment(join(task.root, `controller-${label}`))), CROSSCHAT_LIVE: '1', CLAUDE_COMPAT_BIN: installation.binary,
              CLAUDE_COMPAT_PARENT: join(installation.root, 'fixtures'), CLAUDE_EXPECTED_VERSION: artifact.version }, cwd: installation.root, timeout: 8 * 60 * 1000,
          });
          await writeFile(join(directory, 'process.json'), JSON.stringify(result, null, 2)); return result;
        });
      },
      async remove(installation) {
        installation.safe = true;
        try { await removeClaudeOwnedPath(task.root, installation.root, task.owner); installation.removed = true; }
        catch (error) { installation.safe = false; throw error; }
      },
    });
  } catch (error) {
    summary.error = message(error); summary.classification = { kind: error?.category === 'unsupported' ? 'unsupported-release' : 'infrastructure', notify: false };
    if (error?.category === 'unsupported') summary.unsupportedVersion = error.version;
  } finally {
    try {
      if (installations.some((installation) => !installation.safe)) throw new Error('Native runtime release is unknown; retain the owned installation and do not start another build');
      if (!basename(task.root).startsWith('crosschat-claude-ci-')) throw new Error('Unexpected Claude Code compatibility task root');
      await removeClaudeOwnedPath(task.parent, task.root, task.owner); summary.installationCleanup = 'removed';
    } catch (error) {
      summary.installationCleanup = 'retained'; summary.retainedTaskRoot = task.root; summary.cleanupError = message(error); summary.classification = { kind: 'infrastructure', notify: false };
    }
    await writeFile(join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`); process.stdout.write(`${JSON.stringify(summary.classification)}\n`);
    if (summary.classification.kind !== 'compatible') process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
