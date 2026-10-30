#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { access, copyFile, lstat, mkdir, mkdtemp, open, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { pathToFileURL, URL } from 'node:url';
import { prepareDshProfile, repositoryRoot } from '../test/helpers/dsh-live-fixture.mjs';

const tool = 'dsh-web-runtime';
const pnpmVersion = '11.28.5';
const pnpmIntegrity = 'sha512-SEVj0wtMKtJ8tIqpT/KzAtvOvI/2vyiBbCWJiG4UbOf3bzVPO8GkOOb16XaMMCqgpvet2CMpA81M+BQmy8FNng==';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const slug = /^[a-z0-9-]{1,100}$/;
const sri = /^sha512-[A-Za-z0-9+/]{85}[AQgw]==$/;
const requiredChecks = ['official-plugin-installation-and-owned-web-runtime', 'public-web-session-controller-creates-interactive-sessions', 'messages-model-and-native-shell-identity-bootstrap',
  'authenticated-production-discovery-and-pagination', 'idle-production-delivery-wakes-the-existing-session', 'busy-native-queue-and-steer-step-boundaries',
  'native-shell-send-and-conversation-reply-have-full-session-identities', 'missing-target-does-not-create-or-resume-a-replacement'];
const scope = { officialNpmRuntime: true, officialPluginManager: true, ordinaryWebSessions: true, scriptedLocalModel: true, browserUI: false, desktop: false, modelIntelligence: false };
const desktopTool = 'dsh-desktop';
const desktopChecks = ['formal-desktop-artifact-and-built-in-runtime-profile', 'skill-and-plugin-loading', 'desktop-ui-send-receive-and-reply',
  'host-natural-exit', 'official-uninstall', 'bridge-registration-and-system-registration-cleanup'];
const desktopScope = { officialDesktopArtifact: true, builtInRuntimeProfile: true, skillAndPluginLoading: true, desktopUi: true,
  ordinaryWebSessions: false, browserUI: false, modelIntelligence: false };
const desktopReportMaxBytes = 1024 * 1024;
const desktopSessionId = /^[A-Za-z0-9._:-]{1,200}$/;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const message = (error) => error instanceof Error ? error.message : String(error);

export async function resolveDshNpmCache(root, supplied) {
  const owned = await realpath(root);
  const external = supplied !== undefined;
  if (external && (typeof supplied !== 'string' || !isAbsolute(supplied) || /^[a-z][a-z0-9+.-]*:\/\//i.test(supplied)
    || /^[\\/]{2}/.test(supplied) || supplied.split(/[\\/]/).some((part) => part === '.' || part === '..'))) throw new Error('External npm cache must be an absolute local directory path');
  const selected = external ? resolve(supplied) : join(owned, 'npm-cache');
  if (!external) await mkdir(selected, { recursive: true });
  for (let cursor = selected;; cursor = dirname(cursor)) {
    const info = await lstat(cursor);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Npm cache and its ancestors must be real directories without links');
    if (dirname(cursor) === cursor) break;
  }
  const path = await realpath(selected);
  const child = relative(owned, path);
  if (external && (!child || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`)))) throw new Error('An external cache must be outside the owned compatibility task directory');
  return { path, external };
}

function semver(version) {
  if (typeof version !== 'string' || version.length > 80) return;
  const parts = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*))?$/.exec(version);
  if (!parts || parts.slice(1, 4).some((item) => !Number.isSafeInteger(Number(item)))) return;
  const pre = parts[4]?.split('.');
  if (pre?.some((item) => /^[0-9]+$/.test(item) && item.length > 1 && item.startsWith('0'))) return;
  return { major: Number(parts[1]), minor: Number(parts[2]), patch: Number(parts[3]), pre };
}

function supported(version) {
  const parts = semver(version);
  if (!parts || parts.major !== 0 || parts.minor !== 2 || parts.patch < 1) return false;
  if (parts.patch > 1 || !parts.pre) return true;
  const minimum = ['rc', '2'];
  for (let index = 0; index < Math.max(minimum.length, parts.pre.length); index++) {
    const left = parts.pre[index]; const right = minimum[index];
    if (left === undefined) return false;
    if (right === undefined) return true;
    if (left === right) continue;
    const numericLeft = /^[0-9]+$/.test(left); const numericRight = /^[0-9]+$/.test(right);
    if (numericLeft && numericRight) return BigInt(left) > BigInt(right);
    if (numericLeft !== numericRight) return !numericLeft;
    return left > right;
  }
  return true;
}

export function parseDshNpmManifest(input, platform, arch) {
  if (!record(input) || input.name !== '@deepseek-ai/dsh' || !semver(input.version) || !record(input.dist)) throw new Error('Invalid official Harness npm metadata');
  if (!supported(input.version)) throw Object.assign(new Error('Harness release is outside the approved >=0.2.1-rc.2 <0.3.0-0 window'), { category: 'unsupported', version: input.version });
  if (platform !== 'win32' || arch !== 'x64') throw new Error('This compatibility probe is configured for Windows x64 only');
  const url = `https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-${input.version}.tgz`;
  if (input.dist.tarball !== url || !sri.test(input.dist.integrity ?? '')) throw new Error('Invalid official Harness archive URL or SHA-512 SRI');
  return { name: input.name, version: input.version, url, integrity: input.dist.integrity };
}

export function parsePnpmManifest(input) {
  if (!record(input) || input.name !== 'pnpm' || input.version !== pnpmVersion || !record(input.dist)
    || input.dist.tarball !== `https://registry.npmjs.org/pnpm/-/pnpm-${pnpmVersion}.tgz` || input.dist.integrity !== pnpmIntegrity) throw new Error('The isolated package manager must match the pinned official pnpm archive');
  return { name: input.name, version: input.version, url: input.dist.tarball, integrity: input.dist.integrity };
}

export function verifyNpmArtifact(bytes, artifact) {
  if (!sri.test(artifact?.integrity ?? '') || !(bytes instanceof Uint8Array)) throw new Error('Invalid archive integrity input');
  const expected = Buffer.from(artifact.integrity.slice(7), 'base64');
  if (!timingSafeEqual(createHash('sha512').update(bytes).digest(), expected)) throw new Error('Official npm archive failed SHA-512 verification');
  return true;
}

/** Temporary RED placeholders so the new desktop expectations fail on business assertions; the GREEN implementation replaces them. */
export function parseDshDesktopWindowsManifest() {}
export async function downloadDshDesktopInstaller() {}

/** A timeout cannot prove descendant release; the caller retains the installation. */
export function runDshProcess(binary, args, options = {}) {
  return new Promise((done, reject) => {
    const child = spawn(binary, args, { cwd: options.cwd ?? repositoryRoot, env: options.env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let settled = false;
    const finish = (value, error) => {
      if (settled) return; settled = true; clearTimeout(timer); child.stdout.destroy(); child.stderr.destroy();
      if (error) reject(error); else done({ ...value, stdout, stderr, pid: child.pid });
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* Unknown release is retained by the caller. */ }
      finish({ code: null, signal: null, timedOut: true });
    }, options.timeout ?? 30000);
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-128000); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-128000); });
    child.once('error', (error) => finish(undefined, error));
    child.once('close', (code, signal) => finish({ code, signal, timedOut: false }));
  });
}

function validScope(value) { return record(value) && Object.entries(scope).every(([key, expected]) => value[key] === expected); }
function validReport(report, artifact, runId) {
  if (!record(report) || report.schema !== 1 || report.tool !== tool || report.platform !== 'win32' || report.arch !== 'x64'
    || report.version !== artifact.version || !uuid.test(report.runId ?? '') || (runId !== undefined && report.runId !== runId) || !validScope(report.scope)
    || !Array.isArray(report.checks) || report.checks.some((check) => !record(check) || !requiredChecks.includes(check.name) || check.status !== 'passed' || !Number.isFinite(check.elapsedMs) || check.elapsedMs < 0)
    || new Set(report.checks.map((check) => check.name)).size !== report.checks.length) return false;
  return report.status === 'passed' ? report.stage === 'done' && report.category === null && report.checks.length === requiredChecks.length
    : report.status === 'failed' && ['compatibility', 'infrastructure'].includes(report.category) && slug.test(report.stage ?? '') && report.stage !== 'done' && slug.test(report.check ?? '');
}
function normalProcess(result) { return record(result) && result.timedOut === false && result.signal === null && [0, 1].includes(result.code); }
function processMatches(report) { return normalProcess(report.process) && report.process.code === (report.status === 'passed' ? 0 : 1); }
function infrastructure(version, stage, error) { return { schema: 1, tool, platform: 'win32', arch: 'x64', version, status: 'failed', category: 'infrastructure', stage, check: stage, error: message(error) }; }

export function hasDshRuntimeReleaseProof(cleanup) {
  return record(cleanup) && cleanup.runtimeStopped === true && cleanup.registrationRemoved === true && cleanup.removed === true && cleanup.forced === false
    && (cleanup.errors === undefined || (Array.isArray(cleanup.errors) && cleanup.errors.length === 0));
}

function validDesktopScope(value) { return record(value) && Object.entries(desktopScope).every(([key, expected]) => value[key] === expected); }
function knownDesktopArtifact(artifact) {
  return record(artifact) && typeof artifact.version === 'string' && artifact.version !== '' && typeof artifact.integrity === 'string' && sri.test(artifact.integrity);
}

/** Identity fields are UUID/owner strings only; an array that stringifies to a UUID is not an identity. */
function desktopIdentity(installation) {
  if (typeof installation?.installationId !== 'string' || !uuid.test(installation.installationId)
    || typeof installation?.owner !== 'string' || installation.owner === '') return;
  return { installationId: installation.installationId, owner: installation.owner };
}

function desktopBinding(installation, runId) {
  const identity = desktopIdentity(installation);
  return typeof runId === 'string' && uuid.test(runId) && identity ? { runId, ...identity } : undefined;
}

/**
 * The caller's own record of this run, install, owner, native instance and session. The launch record comes from the
 * launch step, never from the report: equality only proves agreement with the caller, not native facts or intent.
 */
function desktopExpectation(installation, launch, runId) {
  const binding = desktopBinding(installation, runId);
  return binding && typeof launch?.instanceId === 'string' && uuid.test(launch.instanceId)
    && typeof launch.sessionId === 'string' && desktopSessionId.test(launch.sessionId)
    ? { ...binding, instanceId: launch.instanceId, sessionId: launch.sessionId } : undefined;
}

/**
 * Every bound field must be present with the expected type before it is compared, so two missing values never match.
 * A PASS also needs complete, affirmative cleanup; unknown cleanup is never "proven released".
 */
function validDesktopReport(report, artifact, expected) {
  if (!record(report) || !knownDesktopArtifact(artifact) || !record(expected)
    || report.schema !== 1 || report.tool !== desktopTool || report.platform !== 'win32' || report.arch !== 'x64'
    || report.version !== artifact.version || typeof report.artifactId !== 'string' || !sri.test(report.artifactId) || report.artifactId !== artifact.integrity
    || typeof report.runId !== 'string' || report.runId !== expected.runId
    || typeof report.installationId !== 'string' || report.installationId !== expected.installationId || report.owner !== expected.owner
    || typeof report.instanceId !== 'string' || !uuid.test(report.instanceId) || (expected.instanceId !== undefined && report.instanceId !== expected.instanceId)
    || typeof report.sessionId !== 'string' || !desktopSessionId.test(report.sessionId) || (expected.sessionId !== undefined && report.sessionId !== expected.sessionId)
    || !validDesktopScope(report.scope)
    || !Array.isArray(report.checks) || report.checks.some((check) => !record(check) || !desktopChecks.includes(check.name) || check.status !== 'passed' || !Number.isFinite(check.elapsedMs) || check.elapsedMs < 0)
    || new Set(report.checks.map((check) => check.name)).size !== report.checks.length) return false;
  // Every desktop area needs its own passing check, so a missing UI or uninstall record can never PASS.
  return report.status === 'passed' ? report.stage === 'done' && report.category === null && report.checks.length === desktopChecks.length && hasDesktopCleanupProof(report.cleanup)
    : report.status === 'failed' && ['compatibility', 'infrastructure'].includes(report.category) && slug.test(report.stage ?? '') && report.stage !== 'done' && slug.test(report.check ?? '');
}
function desktopFailure(version, stage, error) { return { schema: 1, tool: desktopTool, platform: 'win32', arch: 'x64', version, status: 'failed', category: 'infrastructure', stage, check: stage, error: message(error) }; }
function intactProcess(result) { return normalProcess(result) && result.truncated === false; }
function desktopProcessMatches(report) { return intactProcess(report.process) && report.process.code === (report.status === 'passed' ? 0 : 1); }

/** The report is read against a byte budget before parsing; the open handle keeps growth after the pre-check bounded too. */
async function readDesktopReport(path) {
  const known = await lstat(path);
  if (known.isSymbolicLink() || !known.isFile() || known.size > desktopReportMaxBytes) throw new Error('Desktop report must be a plain file within its byte budget');
  const handle = await open(path, 'r');
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Desktop report must be a plain file');
    const parts = []; let total = 0;
    for (let size = Math.min(64 * 1024, desktopReportMaxBytes + 1); size > 0; size = Math.min(64 * 1024, desktopReportMaxBytes + 1 - total)) {
      const chunk = Buffer.allocUnsafe(size);
      const { bytesRead } = await handle.read(chunk, 0, size, null);
      if (bytesRead === 0) break;
      parts.push(chunk.subarray(0, bytesRead)); total += bytesRead;
      if (total > desktopReportMaxBytes) throw new Error('Desktop report exceeds its byte budget');
    }
    return JSON.parse(Buffer.concat(parts, total).toString('utf8'));
  } finally { await handle.close(); }
}

/** A failed install that still names the root, installation and owner it created keeps that ownership; less than that is honestly unknown. */
function desktopPartialInstallation(error) {
  const installation = error?.installation;
  const identity = desktopIdentity(installation);
  if (!record(installation) || typeof installation.root !== 'string' || !isAbsolute(installation.root) || !identity) return;
  return { root: installation.root, ...identity };
}

/** Desktop release needs the Host's own exit, the official uninstall and both registration cleanups; a kill is not release. */
export function hasDesktopCleanupProof(cleanup) {
  return record(cleanup) && cleanup.hostExited === true && cleanup.uninstalled === true && cleanup.registrationRemoved === true
    && cleanup.systemRegistrationRemoved === true && cleanup.forced === false
    && (cleanup.errors === undefined || (Array.isArray(cleanup.errors) && cleanup.errors.length === 0));
}

/** Every Desktop attempt owns a fresh directory, run ID and caller launch record; stale or foreign reports are never read. */
export async function runDshDesktopAttempt({ output, label, artifact, installation, launch, runId = randomUUID() }, execute) {
  if (!['baseline', 'candidate', 'retry'].includes(label)) throw new Error('Invalid Harness desktop probe label');
  const expected = knownDesktopArtifact(artifact) ? desktopExpectation(installation, launch, runId) : undefined;
  if (!expected) throw new Error('Desktop attempt needs a known artifact identity, installation, run ID, caller instance and session');
  const directory = await mkdtemp(join(output, `${label}-desktop-`));
  const reportPath = join(directory, 'report.json');
  let result;
  try { result = await execute({ reportPath, runId, directory }); }
  catch (error) { return desktopFailure(artifact.version, 'desktop-session', error); }
  if (!intactProcess(result)) return desktopFailure(artifact.version, 'desktop-session', 'Desktop session did not exit normally with complete output; release is unknown');
  let report;
  try { report = await readDesktopReport(reportPath); }
  catch { return desktopFailure(artifact.version, 'desktop-report', 'Desktop session did not produce a fresh valid report'); }
  if (!validDesktopReport(report, artifact, expected) || result.code !== (report.status === 'passed' ? 0 : 1))
    return desktopFailure(artifact.version, 'desktop-report', 'Desktop identity, evidence, scope or process exit disagrees with this attempt');
  return { ...report, process: { code: result.code, signal: result.signal, timedOut: false, truncated: false } };
}

/** Every child gets a new directory and UUID; stale PASS files are never read. */
export async function runDshProbeAttempt({ output, label, artifact }, execute) {
  if (!['baseline', 'candidate', 'retry'].includes(label)) throw new Error('Invalid Harness probe label');
  const directory = await mkdtemp(join(output, `${label}-`));
  const reportPath = join(directory, 'report.json'); const runId = randomUUID();
  let result;
  try { result = await execute({ reportPath, runId, directory }); }
  catch (error) { return infrastructure(artifact.version, 'probe-process', error); }
  if (!normalProcess(result)) return infrastructure(artifact.version, 'probe-process', 'Probe did not exit normally; runtime release is unknown');
  let report;
  try { report = JSON.parse(await readFile(reportPath, 'utf8')); }
  catch { return infrastructure(artifact.version, 'probe-report', 'Probe did not produce a fresh valid report'); }
  if (!validReport(report, artifact, runId) || result.code !== (report.status === 'passed' ? 0 : 1)) return infrastructure(artifact.version, 'probe-report', 'Probe identity, complete checks, scope or process exit disagrees with the fresh report');
  return { ...report, process: { code: result.code, signal: result.signal, timedOut: result.timedOut } };
}

function classify(baseline, candidate, retry) {
  if (baseline?.status !== 'passed') return { kind: 'baseline-failed', notify: false };
  if (candidate?.category === 'infrastructure' || retry?.category === 'infrastructure') return { kind: 'infrastructure', notify: false };
  if (candidate?.status === 'passed') return { kind: 'compatible', notify: false };
  if (retry?.status === 'passed') return { kind: 'flaky', notify: false };
  if (candidate?.status === 'failed' && retry?.status === 'failed' && candidate.category === 'compatibility' && retry.category === 'compatibility'
    && candidate.version === retry.version && candidate.check === retry.check && candidate.stage === retry.stage) return { kind: 'regression', notify: true };
  return { kind: 'inconclusive', notify: false };
}

/** One install, evidence and removal cycle per build; the next install waits for a proven release. */
async function serialSequence(builds, config) {
  const summary = { schema: 1, tool: config.tool, platform: 'win32', arch: 'x64', builds, scope: config.scope, installationCleanup: 'incomplete' };
  async function attempt(artifact, label) {
    let installation;
    try { installation = await config.operations.install(artifact, label); }
    catch (error) {
      // A structured partial install keeps the ownership it created; an unstructured throw stays honestly unknown.
      const partial = config.partialInstallation?.(error);
      if (partial) summary.retainedInstallation = { label, version: artifact.version, ...partial, reason: message(error) };
      throw error;
    }
    const context = config.context?.();
    // A retained record keeps what this run knew: label, version, root, and — where the entry allows it — the
    // installation identity, owner and the real failure; nothing is invented from error text alone.
    const retain = (reason, error, threw = false) => {
      summary.retainedInstallation = { label, version: artifact.version, root: installation.root, reason, ...config.retainedIdentity?.(installation, error, threw) };
      return summary.retainedInstallation;
    };
    let report; let failure; let threw = false;
    try { report = await config.operations.probe(installation, artifact, label, context); }
    catch (error) { threw = true; failure = error; report = config.fail(artifact.version, 'process', error); }
    if (!config.verify(report, artifact, installation, context)) report = config.fail(artifact.version, 'report', new Error('Fresh process/report evidence is invalid'));
    summary[label] = report;
    if (!config.released(report.cleanup)) {
      // A captured throw is real even when its value is falsy; only a probe that returned keeps the generic wording.
      throw new Error(retain('Owned runtime release is unknown; do not remove or start another build', failure, threw).reason);
    }
    try { await config.operations.remove(installation, artifact, label); }
    catch (error) { retain(message(error), error, true); throw error; }
    return report;
  }
  try {
    summary.baseline = await attempt(builds.baseline, 'baseline');
    summary.candidate = await attempt(builds.candidate, 'candidate');
    if (summary.baseline.status === 'passed' && summary.candidate.status === 'failed' && summary.candidate.category === 'compatibility') summary.retry = await attempt(builds.candidate, 'retry');
    summary.installationCleanup = 'removed'; summary.classification = classify(summary.baseline, summary.candidate, summary.retry);
  } catch (error) { summary.error = message(error); summary.classification = { kind: 'infrastructure', notify: false }; }
  return summary;
}

export function runDshBuildSequence(builds, operations) {
  return serialSequence(builds, {
    tool, scope, operations,
    verify: (report, artifact) => validReport(report, artifact) && processMatches(report),
    released: hasDshRuntimeReleaseProof,
    fail: (version, phase, error) => infrastructure(version, phase === 'process' ? 'probe-process' : 'probe-report', error),
  });
}

export function runDshDesktopSequence(builds, operations) {
  const installations = new Set(); const instances = new Set();
  return serialSequence(builds, {
    tool: desktopTool, scope: desktopScope, operations,
    // The sequence mints the run identity it hands to the attempt it uses; the launch record stays with the runner.
    context: () => ({ runId: randomUUID() }),
    partialInstallation: desktopPartialInstallation,
    retainedIdentity: (installation, error, threw) => {
      const identity = desktopIdentity(installation);
      return identity ? { ...identity, ...(threw ? { reason: message(error) } : {}) } : undefined;
    },
    verify: (report, artifact, installation, context) => {
      const expected = desktopBinding(installation, context?.runId);
      if (!expected || installations.has(expected.installationId) || instances.has(report?.instanceId)
        || !validDesktopReport(report, artifact, expected) || !desktopProcessMatches(report)) return false;
      installations.add(expected.installationId); instances.add(report.instanceId);
      return true;
    },
    released: hasDesktopCleanupProof,
    fail: (version, phase, error) => desktopFailure(version, phase === 'process' ? 'desktop-session' : 'desktop-report', error),
  });
}

export function dshRegressionIdentity(summary) {
  if (!record(summary) || summary.schema !== 1 || summary.tool !== tool || summary.platform !== 'win32' || summary.arch !== 'x64' || !validScope(summary.scope)
    || summary.installationCleanup !== 'removed' || summary.classification?.kind !== 'regression' || summary.classification?.notify !== true || !record(summary.builds)) return;
  const { builds, baseline, candidate, retry } = summary;
  try {
    for (const artifact of [builds.baseline, builds.candidate]) parseDshNpmManifest({ ...artifact, dist: { tarball: artifact.url, integrity: artifact.integrity } }, 'win32', 'x64');
    parsePnpmManifest({ ...builds.packageManager, dist: { tarball: builds.packageManager.url, integrity: builds.packageManager.integrity } });
  } catch { return; }
  if (!validReport(baseline, builds.baseline) || !validReport(candidate, builds.candidate) || !validReport(retry, builds.candidate)
    || [baseline, candidate, retry].some((item) => !processMatches(item) || !hasDshRuntimeReleaseProof(item.cleanup))
    || new Set([baseline.runId, candidate.runId, retry.runId]).size !== 3 || classify(baseline, candidate, retry).kind !== 'regression') return;
  return { marker: `<!-- dsh-compat:${candidate.version}:win32:${candidate.check} -->`, title: `DeepSeek Harness ${candidate.version}: ${candidate.check} compatibility regression (win32)` };
}

async function fetchBytes(url, maxBytes) {
  const response = await globalThis.fetch(url, { redirect: 'error', signal: globalThis.AbortSignal.timeout(120000) });
  if (!response.ok || Number(response.headers.get('content-length')) > maxBytes || !response.body) throw new Error('Official npm request failed or exceeded its byte budget');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > maxBytes) throw new Error('Official npm response exceeded its byte budget'); chunks.push(part.value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks);
}

async function ownedChild(parent, target, owner) {
  const real = await realpath(target); const child = relative(parent, real);
  if (real !== target || !child || isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`) || await readFile(join(real, '.fixture-owner'), 'utf8') !== owner) throw new Error('Unsafe Harness compatibility cleanup target');
  return real;
}

async function main() {
  if (process.env.CROSSCHAT_LIVE !== '1') throw new Error('CROSSCHAT_LIVE=1 is required for official Harness downloads and isolated probes');
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Only Windows x64 is configured; platform matrix work remains separate');
  const output = resolve(process.env.DSH_COMPAT_EVIDENCE ?? 'dsh-compat-evidence'); await mkdir(output, { recursive: true });
  const temp = await realpath(tmpdir()); const root = await realpath(await mkdtemp(join(temp, 'crosschat-dsh-ci-'))); const owner = randomUUID();
  await writeFile(join(root, '.fixture-owner'), owner);
  const installations = []; const archives = new Map();
  let npmCache;
  let summary = { schema: 1, tool, platform: 'win32', arch: 'x64', scope, builds: {}, classification: { kind: 'infrastructure', notify: false }, installationCleanup: 'incomplete' };
  async function archive(artifact) {
    const key = createHash('sha256').update(artifact.integrity).digest('hex');
    if (!archives.has(key)) {
      const bytes = await fetchBytes(artifact.url, 512 * 1024 * 1024); verifyNpmArtifact(bytes, artifact);
      const path = join(root, `${key}.tgz`); await writeFile(path, bytes); archives.set(key, path);
    }
    return archives.get(key);
  }
  async function cleanupTaskRoot() {
    if (installations.some((installation) => !installation.safe)) throw new Error('An installer or runtime has unknown release state; the owned CI directory is retained');
    if (!basename(root).startsWith('crosschat-dsh-ci-')) throw new Error('Unexpected Harness compatibility task root');
    await rm(await ownedChild(temp, root, owner), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  try {
    npmCache = await resolveDshNpmCache(root, process.env.DSH_COMPAT_NPM_CACHE);
    const pinned = JSON.parse(await readFile(new URL('./dsh-compat-baseline.json', import.meta.url), 'utf8'));
    const builds = { baseline: parseDshNpmManifest(pinned.package, process.platform, process.arch), packageManager: parsePnpmManifest(pinned.packageManager) }; summary.builds = builds;
    builds.candidate = parseDshNpmManifest(JSON.parse((await fetchBytes('https://registry.npmjs.org/@deepseek-ai/dsh/latest', 2 * 1024 * 1024)).toString('utf8')), process.platform, process.arch);
    const npmCLI = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'); await access(npmCLI);
    summary = await runDshBuildSequence(builds, {
      async install(artifact, label) {
        const runtime = join(root, `install-${label}`); await mkdir(runtime); await writeFile(join(runtime, '.fixture-owner'), owner);
        const installation = { root: runtime, safe: false, removed: false }; installations.push(installation);
        const env = await prepareDshProfile(runtime, 'http://127.0.0.1:1/v1');
        env.npm_config_cache = npmCache.path;
        const [native, manager] = await Promise.all([archive(artifact), archive(builds.packageManager)]);
        await writeFile(join(runtime, 'package.json'), JSON.stringify({ name: 'crosschat-dsh-compat-fixture', version: '0.0.0', private: true,
          dependencies: { '@deepseek-ai/dsh': pathToFileURL(native).href, pnpm: pathToFileURL(manager).href } }));
        const lock = join(root, `${createHash('sha256').update(artifact.integrity).digest('hex')}.lock.json`);
        let existingLock = false; try { await copyFile(lock, join(runtime, 'package-lock.json')); existingLock = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
        const installed = await runDshProcess(process.execPath, [npmCLI, existingLock ? 'ci' : 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline'], { cwd: runtime, env, timeout: 15 * 60 * 1000 });
        await writeFile(join(output, `${label}-install.json`), JSON.stringify(installed, null, 2));
        installation.safe = installed.timedOut === false && installed.signal === null && Number.isInteger(installed.code);
        if (!installation.safe || installed.code !== 0) throw new Error('Isolated npm installation failed; abnormal process release is retained for inspection');
        for (const [name, expected] of [['@deepseek-ai/dsh', artifact.version], ['pnpm', pnpmVersion]]) {
          const manifest = JSON.parse(await readFile(join(runtime, 'node_modules', name, 'package.json'), 'utf8'));
          if (manifest.name !== name || manifest.version !== expected) throw new Error('Installed npm package identity differs from the verified artifact');
        }
        if (!existingLock) await copyFile(join(runtime, 'package-lock.json'), lock);
        await copyFile(join(runtime, 'package-lock.json'), join(output, `${label}-package-lock.json`)); return installation;
      },
      async probe(installation, artifact, label) {
        installation.safe = false;
        return runDshProbeAttempt({ output, label, artifact }, async ({ reportPath, runId, directory }) => {
          const result = await runDshProcess(process.execPath, [join(repositoryRoot, 'scripts', 'dsh-compat.mjs'), '--report', reportPath], {
            env: { ...(await prepareDshProfile(join(root, `controller-${label}`), 'http://127.0.0.1:1/v1')), CROSSCHAT_LIVE: '1', DSH_RUNTIME_DIR: installation.root,
              DSH_TASK_ROOT: root, DSH_EXPECTED_VERSION: artifact.version, DSH_EXPECTED_RUN_ID: runId }, timeout: 360000,
          });
          await writeFile(join(directory, 'process.json'), JSON.stringify(result, null, 2)); return result;
        });
      },
      async remove(installation) {
        installation.safe = true;
        try { await rm(await ownedChild(root, installation.root, owner), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); installation.removed = true; }
        catch (error) { installation.safe = false; throw error; }
      },
    });
  } catch (error) {
    summary.error = message(error); summary.classification = { kind: error?.category === 'unsupported' ? 'unsupported-release' : 'infrastructure', notify: false };
    if (error?.category === 'unsupported') summary.unsupportedVersion = error.version;
  } finally {
    try {
      await cleanupTaskRoot(); summary.installationCleanup = 'removed';
    } catch (error) { summary.installationCleanup = 'retained'; summary.retainedTaskRoot = root; summary.cleanupError = message(error); summary.classification = { kind: 'infrastructure', notify: false }; }
    if (npmCache) summary.npmCache = { ...npmCache, disposition: npmCache.external ? 'retained-externally'
      : summary.installationCleanup === 'removed' ? 'removed-with-task-root' : 'retained-with-task-root' };
    await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2)); process.stdout.write(`${JSON.stringify(summary.classification)}\n`);
    if (summary.classification.kind !== 'compatible') process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
