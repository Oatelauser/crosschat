#!/usr/bin/env node
// Fixed-release enhancement qualification, separate from baseline/latest regression CI.
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { access, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL, URL } from 'node:url';
import { parseDshNpmManifest, parsePnpmManifest, verifyNpmArtifact, installDshNpmDependencies, runDshProcess } from './dsh-compat-ci.mjs';
import { DSH_ENHANCEMENT_SCOPE, validateDshEnhancementReport } from './dsh-enhancement-contract.mjs';
import { isDshNpmTarget } from './dsh-npm-target.mjs';
import { prepareDshProfile, repositoryRoot } from '../test/helpers/dsh-live-fixture.mjs';

const version = '0.2.1-rc.5';
const errorText = error => error instanceof Error ? error.message : String(error);
const normal = result => result?.timedOut === false && result.signal === null && Number.isInteger(result.code);
const failed = error => ({ status: 'failed', category: 'infrastructure', released: false, error: errorText(error) });
function requireTarget(target) {
  if (!isDshNpmTarget(target?.platform, target?.arch)) throw new Error('Unplanned C22 target');
}

export async function readDshEnhancementPins(target) {
  requireTarget(target);
  const pins = JSON.parse(await readFile(new URL('./dsh-enhancement-pins.json', import.meta.url), 'utf8'));
  const baseline = JSON.parse(await readFile(new URL('./dsh-compat-baseline.json', import.meta.url), 'utf8'));
  const runtime = parseDshNpmManifest(pins.package, target.platform, target.arch);
  if (pins.schema !== 1 || runtime.version !== version) throw new Error('Enhancement qualification requires the pinned rc.5 release');
  return { runtime, manager: parsePnpmManifest(baseline.packageManager) };
}

/** Fresh UUID, bounded regular report, process outcome and strict producer identity must agree. */
export async function runDshEnhancementAttempt({ output, sourceHead, target }, execute) {
  requireTarget(target);
  if (!/^[0-9a-f]{40}$/u.test(sourceHead ?? '')) throw new Error('A full source commit is required');
  await mkdir(output, { recursive: true });
  const runId = randomUUID(), reportPath = join(output, `report-${runId}.json`);
  const binding = { runId, sourceHead, ...target, version };
  let result;
  try {
    result = await execute({ reportPath, runId });
    await writeFile(join(output, 'process.json'), JSON.stringify(result, null, 2) + '\n');
    if (!normal(result) || ![0, 1].includes(result.code)) return failed('Probe did not exit normally; runtime release is unknown');
    const stat = await lstat(reportPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) return failed('Probe report is not a bounded regular file');
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    const validation = validateDshEnhancementReport(report, binding);
    if (!validation.valid) return failed(validation.reason);
    if (result.code !== (report.status === 'passed' ? 0 : 1)) return failed('Probe exit code and report disagree');
    return { status: report.status, category: report.status === 'passed' ? null : report.category === 'infrastructure' || ['setup', 'cleanup'].includes(report.stage) ? 'infrastructure' : 'validation-failed', released: true, runId, reportPath, report };
  } catch (error) { return { ...failed(error), runId, reportPath }; }
}

/** A single qualification, never baseline/latest/retry; uncertain release prevents deletion. */
export async function runDshEnhancementSequence({ target }, operations) {
  requireTarget(target);
  const summary = { schema: 1, tool: 'dsh-enhancement', ...target, version, scope: DSH_ENHANCEMENT_SCOPE,
    status: 'failed', category: 'infrastructure', notify: false, installationCleanup: 'retained' };
  let installation;
  try {
    installation = await operations.install();
    const attempt = await operations.probe(installation);
    summary.attempt = attempt;
    if (attempt.released !== true) throw new Error('Runtime release is unconfirmed; retain the owned installation');
    await operations.remove(installation);
    summary.installationCleanup = 'removed'; summary.status = attempt.status; summary.category = attempt.category;
  } catch (error) { summary.error = errorText(error); }
  return summary;
}

async function archive(artifact, root) {
  const response = await globalThis.fetch(artifact.url, { redirect: 'error', signal: globalThis.AbortSignal.timeout(120000) });
  const limit = 512 * 1024 * 1024;
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > limit) throw new Error('Official archive download failed');
  const chunks = []; let count = 0;
  for await (const chunk of response.body) {
    count += chunk.byteLength;
    if (count > limit) throw new Error('Official archive exceeded its byte budget');
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks); verifyNpmArtifact(bytes, artifact);
  const file = join(root, `${artifact.name === 'pnpm' ? 'pnpm' : 'dsh'}.tgz`);
  await writeFile(file, bytes, { flag: 'wx' }); return file;
}

async function assertOwned(root, parent, owner) {
  const actual = await realpath(root), child = relative(parent, actual);
  if (actual !== root || !child || child.startsWith('..') || isAbsolute(child)
    || (await lstat(root)).isSymbolicLink() || await readFile(join(root, '.fixture-owner'), 'utf8') !== owner) throw new Error('Owned C22 task path changed');
}

async function removeTaskRoot(root, parent, owner, safe) {
  if (!safe) throw new Error('An installer or runtime has unconfirmed release');
  await assertOwned(root, parent, owner);
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

async function main() {
  const target = { platform: process.platform, arch: process.arch };
  const sourceHead = process.env.DSH_PRODUCT_HEAD ?? process.env.GITHUB_SHA;
  const output = resolve(process.env.DSH_ENHANCEMENT_EVIDENCE ?? 'dsh-enhancement-evidence');
  await mkdir(output, { recursive: true });
  let root, parent, owner, summary, safe = true;
  try {
    if (process.env.CROSSCHAT_LIVE !== '1' || process.version !== 'v22.23.4') throw new Error('Explicit live opt-in and Node22.23.4 are required');
    requireTarget(target);
    if ((process.env.DSH_EXPECTED_PLATFORM && process.env.DSH_EXPECTED_PLATFORM !== target.platform)
      || (process.env.DSH_EXPECTED_ARCH && process.env.DSH_EXPECTED_ARCH !== target.arch)) throw new Error('Actual runner target does not match the requested target');
    if (!/^[0-9a-f]{40}$/u.test(sourceHead ?? '')) throw new Error('DSH_PRODUCT_HEAD or GITHUB_SHA must identify the source');
    const pins = await readDshEnhancementPins(target);
    parent = await realpath(tmpdir()); root = await realpath(await mkdtemp(join(parent, 'c22-'))); owner = randomUUID();
    await writeFile(join(root, '.fixture-owner'), owner);
    const npmCLI = join(dirname(process.execPath), ...(process.platform === 'win32' ? [] : ['..', 'lib']), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    await access(npmCLI);
    summary = await runDshEnhancementSequence({ target }, {
      async install() {
        const runtime = join(root, 'runtime'); await mkdir(runtime);
        const downloads = await Promise.allSettled([archive(pins.runtime, root), archive(pins.manager, root)]);
        const downloadErrors = downloads.filter(item => item.status === 'rejected').map(item => item.reason);
        if (downloadErrors.length) throw new AggregateError(downloadErrors, 'Pinned archive download failed');
        const [native, manager] = downloads.map(item => item.value);
        await writeFile(join(runtime, 'package.json'), JSON.stringify({ name: 'crosschat-c22-owned-runtime', version: '0.0.0', private: true,
          dependencies: { '@deepseek-ai/dsh': pathToFileURL(native).href, pnpm: pathToFileURL(manager).href } }));
        const env = await prepareDshProfile(join(root, 'installer'), 'http://127.0.0.1:1/v1');
        safe = false;
        const installed = await installDshNpmDependencies({ npmCLI, runtime, env, existingLock: false, label: 'enhancement-rc5' });
        await writeFile(join(output, 'install-process.json'), JSON.stringify(installed, null, 2) + '\n');
        safe = normal(installed);
        if (!safe || installed.code !== 0) throw new Error('Pinned npm dependency installation failed');
        for (const artifact of [pins.runtime, pins.manager]) {
          const manifest = JSON.parse(await readFile(join(runtime, 'node_modules', artifact.name, 'package.json'), 'utf8'));
          if (manifest.name !== artifact.name || manifest.version !== artifact.version) throw new Error('Installed package identity differs from the verified archive');
        }
        await copyFile(join(runtime, 'package-lock.json'), join(output, 'package-lock.json'));
        return { root: runtime };
      },
      async probe(installation) {
        safe = false;
        const attempt = await runDshEnhancementAttempt({ output, sourceHead, target }, async ({ reportPath, runId }) => {
          const env = await prepareDshProfile(join(root, 'controller'), 'http://127.0.0.1:1/v1');
          return runDshProcess(process.execPath, [join(repositoryRoot, 'test/helpers/dsh-enhancement-native-validation.mjs')], {
            env: { ...env, CROSSCHAT_LIVE: '1', DSH_C22_REPORT: reportPath, DSH_RUNTIME_DIR: installation.root,
              DSH_TASK_ROOT: root, DSH_PRODUCT_HEAD: sourceHead, DSH_EXPECTED_RUN_ID: runId }, timeout: 15 * 60 * 1000,
          });
        });
        safe = attempt.released === true; return attempt;
      },
      async remove(installation) {
        await assertOwned(root, parent, owner);
        if (installation.root !== join(root, 'runtime') || (await lstat(installation.root)).isSymbolicLink()) throw new Error('Runtime cleanup target changed');
        safe = false; await rm(installation.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); safe = true;
      },
    });
    summary.pins = pins; summary.sourceHead = sourceHead;
  } catch (error) { summary = { ...failed(error), tool: 'dsh-enhancement', ...target, notify: false, sourceHead }; }
  finally {
    summary ??= failed('No qualification result');
    if (root) {
      try {
        await removeTaskRoot(root, parent, owner, safe);
        summary.taskRootCleanup = 'removed';
        summary.installationCleanup = 'removed';
      } catch (error) {
        summary.taskRootCleanup = 'retained'; summary.retainedTaskRoot = root; summary.cleanupError = errorText(error);
        summary.status = 'failed'; summary.category = 'infrastructure';
      }
    }
    await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ status: summary.status, category: summary.category, notify: false }) + '\n');
    process.exitCode = summary.status === 'passed' ? 0 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
