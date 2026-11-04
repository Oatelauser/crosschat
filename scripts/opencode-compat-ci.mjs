#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { TextDecoder } from 'node:util';
import { URL } from 'node:url';
import { classifyCompatibility, parseArtifactManifest } from './opencode-compat-report.mjs';
import { repositoryRoot, runCommand } from '../test/helpers/opencode-live-fixture.mjs';

if (process.env.CROSSCHAT_LIVE !== '1') throw new Error('CROSSCHAT_LIVE=1 is required for official binary downloads and isolated live probes');
const output = resolve(process.env.OPENCODE_COMPAT_EVIDENCE ?? 'opencode-compat-evidence');
await mkdir(output, { recursive: true });
const temp = await realpath(tmpdir());
const root = await realpath(await mkdtemp(join(temp, 'crosschat-opencode-download-')));
const owner = randomUUID();
await writeFile(join(root, '.fixture-owner'), owner);
const results = {};
const builds = {};

async function fetchWithRetry(url, timeout = 120000) {
  let failure;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(timeout) });
      if (!response.ok) throw new Error(`Official artifact request returned HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) { failure = error; if (attempt < 2) await delay(1000 * (attempt + 1)); }
  }
  throw failure;
}

async function install(artifact, label) {
  const directory = join(root, label);
  await mkdir(directory);
  const archive = join(directory, artifact.filename);
  const contents = await fetchWithRetry(artifact.url);
  if (contents.length !== artifact.size || createHash('sha256').update(contents).digest('hex') !== artifact.sha256) throw new Error('Official archive checksum or size mismatch');
  await writeFile(archive, contents);
  const listing = await runCommand('tar', ['-tf', archive], { timeout: 30000 });
  if (listing.code !== 0) throw new Error(`Archive listing failed: ${listing.stderr}`);
  const entries = listing.stdout.split(/\r?\n/).filter(Boolean);
  if (!entries.length || entries.some((entry) => /(^[\\/]|^[a-z]:|(^|[\\/])\.\.([\\/]|$))/i.test(entry))) throw new Error('Archive contains an unsafe path');
  const nativeName = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
  const candidate = entries.find((entry) => basename(entry) === nativeName);
  if (!candidate) throw new Error('Official archive has no CLI executable');
  const expanded = await runCommand('tar', ['-xf', archive, '-C', directory], { timeout: 60000 });
  if (expanded.code !== 0) throw new Error(`Archive extraction failed: ${expanded.stderr}`);
  const binary = join(directory, candidate);
  await access(binary);
  if (process.platform !== 'win32') await chmod(binary, 0o700);
  return binary;
}

async function probe(binary, artifact, label) {
  const path = join(output, `${label}.json`);
  await runCommand(process.execPath, [join(repositoryRoot, 'scripts', 'opencode-compat.mjs'), '--report', path], {
    env: { ...process.env, CROSSCHAT_LIVE: '1', OPENCODE_BIN: binary, OPENCODE_EXPECTED_VERSION: artifact.version }, timeout: 300000,
  });
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return { status: 'failed', category: 'infrastructure', stage: 'probe-runner', version: artifact.version, error: 'Probe did not produce a valid report' }; }
}

async function cleanupDownloadRoot() {
  const target = await realpath(root);
  const child = relative(temp, target);
  if (target !== root || !child || isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`)
    || !basename(target).startsWith('crosschat-opencode-download-') || await readFile(join(target, '.fixture-owner'), 'utf8') !== owner) throw new Error('Unsafe download cleanup target');
  await rm(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

try {
  builds.baseline = parseArtifactManifest(JSON.parse(await readFile(new URL('./opencode-compat-baseline.json', import.meta.url), 'utf8')), process.platform, process.arch);
  // The manifest and immutable URL are captured once per run, including retries.
  builds.candidate = parseArtifactManifest(JSON.parse(new TextDecoder().decode(await fetchWithRetry('https://opencode.ai/update/api/latest/cli/opencode', 30000))), process.platform, process.arch);
  const baselineBinary = await install(builds.baseline, 'baseline');
  results.baseline = await probe(baselineBinary, builds.baseline, 'baseline');
  const candidateBinary = builds.candidate.sha256 === builds.baseline.sha256 && builds.candidate.version === builds.baseline.version ? baselineBinary : await install(builds.candidate, 'candidate');
  results.candidate = await probe(candidateBinary, builds.candidate, 'candidate');
  if (results.candidate.status !== 'passed') results.retry = await probe(candidateBinary, builds.candidate, 'retry');
  results.classification = classifyCompatibility(results.baseline, results.candidate, results.retry);
} catch (error) {
  results.classification = { kind: error?.category === 'unsupported' ? 'unsupported-release' : 'infrastructure', notify: false };
  if (error?.category === 'unsupported') results.unsupportedVersion = error.version;
  results.error = error instanceof Error ? error.message : String(error);
} finally {
  try {
    await cleanupDownloadRoot();
    results.downloadCleanup = 'removed';
  } catch (error) { results.downloadCleanup = String(error); results.classification = { kind: 'infrastructure', notify: false }; }
  const summary = { schema: 1, platform: process.platform, arch: process.arch, builds, ...results };
  await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  process.stdout.write(`${JSON.stringify(summary.classification)}\n`);
  if (summary.classification.kind !== 'compatible') process.exitCode = 1;
}
