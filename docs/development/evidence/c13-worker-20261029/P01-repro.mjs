// C13-P01-R1 isolated reproduction: what survives a rejected mountDshBridge.close().
// Synthetic ctx/host only, exclusive temp home, no native Harness, no message
// delivery, no user state. The bridge owns its listener, so a rejected close
// leaks it; this script therefore runs each scenario in its own bounded child
// process and lets process exit reclaim the socket. Cleanup never re-calls the
// memoized close and never scans or kills by process name.
//
// A scenario only counts as evidence when the child exited normally, was not
// timed out or truncated, produced a parsable RESULT with every field this run
// needs, and the port is refused afterwards. Anything else is an evidence
// failure, and a run with any failure exits non-zero.
// Usage: node P01-repro.mjs [--out <new.json>]
/* global process */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const LIMITS = { childMs: 20_000, closeMs: 5_000, probeMs: 3_000, stdoutBytes: 64 * 1024, stderrBytes: 16 * 1024 };
const SCENARIOS = ['control', 'release-throws', 'scope-dispose-rejects', 'mount-catch'];
const REQUIRED_FIELDS = ['scenario', 'mountError', 'registrationPublished', 'closeOutcome', 'sameSettledPromise', 'listenerWhileProcessAlive', 'registrationStillPresent', 'url'];
const describe = (error) => ({ name: error?.name, message: String(error?.message ?? error) });

// What the defect currently does. A scenario that does not match is reported as
// not reproduced, which is a different thing from an evidence failure.
const EXPECTATIONS = {
  control: { mountError: null, closeOutcome: 'resolved', registrationStillPresent: false, listenerAnswered: false, sameSettledPromise: true },
  'release-throws': { mountError: null, closeOutcome: 'rejected', closeMessage: 'contributor release failed', registrationStillPresent: true, listenerAnswered: true, listenerStatus: 503 },
  'scope-dispose-rejects': { mountError: null, closeOutcome: 'rejected', closeMessage: 'scope dispose failed', registrationStillPresent: true, listenerAnswered: true, listenerStatus: 503, sameSettledPromise: true },
  'mount-catch': { mountError: 'scope dispose failed', closeOutcome: 'not-called', registrationStillPresent: true, listenerAnswered: true, listenerStatus: 503 },
};

async function probeListener(url, token) {
  try {
    const response = await fetch(`${url}/v1/info`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(LIMITS.probeMs) });
    return { answered: true, status: response.status, confirmedClosed: false };
  } catch (error) {
    const code = error?.cause?.code ?? error?.code ?? error?.name;
    // Only a refused connection proves the port is released. A timeout or any
    // other network error leaves the closure unverified.
    return { answered: false, code, confirmedClosed: code === 'ECONNREFUSED' };
  }
}

// ---- child: one scenario, one process, one listener ------------------------

function syntheticCtx(scenario, home) {
  const agents = new Map([['root', { id: 'root', status: 'idle', session: { id: 'root', header: { id: 'root', createdAt: 1 } }, followup() {}, steer() {} }]]);
  const scope = (register) => ({ get: (key) => (key === 'shellEnv' ? { register } : undefined), effect: (setup) => setup() });
  const inject = (_dependencies, callback) => {
    if (scenario === 'scope-dispose-rejects' || scenario === 'mount-catch') {
      callback(scope(() => () => {}));
      return { dispose: async () => { throw new Error('scope dispose failed'); } };
    }
    const unregister = scenario === 'release-throws' ? () => { throw new Error('contributor release failed'); } : () => {};
    callback(scope(() => unregister));
    return { dispose: async () => {} };
  };
  return {
    agents: { get: (id) => agents.get(id), roots: () => [...agents.values()] },
    get: (key) => (key === 'profileContext' ? { name: 'web', dir: join(home, 'native-profile') } : undefined),
    // The only ctx.effect call is the one that adopts close() as an owner effect.
    effect: (setup) => { if (scenario === 'mount-catch') throw new Error('effect registration failed'); return setup(); },
    inject,
  };
}

async function childMain(scenario, home) {
  const { mountDshBridge } = await import('../../../../integrations/dsh/bridge.js');
  const host = { getDshRuntimeVersion: () => '0.2.1-rc.2', createUserMessage: (input) => ({ ...input, id: 'message-1', role: 'user' }) };
  let bridge;
  let mountError;
  try { bridge = await mountDshBridge(syntheticCtx(scenario, home), host, { home }); }
  catch (error) { mountError = describe(error); }

  const directory = join(home, '.crosschat', 'dsh', 'instances');
  const published = () => (existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith('.json')) : []);
  const names = published();
  const file = names.length === 1 ? join(directory, names[0]) : undefined;
  const registration = file === undefined ? undefined : JSON.parse(readFileSync(file, 'utf8'));

  let closeOutcome = 'not-called';
  let closeError;
  let sameSettledPromise;
  if (bridge !== undefined) {
    const first = bridge.close();
    // A rejected close is memoized: a second call hands back the same promise.
    sameSettledPromise = bridge.close() === first;
    try { await first; closeOutcome = 'resolved'; } catch (error) { closeOutcome = 'rejected'; closeError = describe(error); }
  }

  const listener = registration === undefined ? { probed: false, confirmedClosed: false } : await probeListener(registration.url, registration.token);
  const line = `RESULT ${JSON.stringify({
    scenario,
    mountError: mountError ?? null,
    registrationPublished: registration !== undefined,
    closeOutcome,
    closeError: closeError ?? null,
    sameSettledPromise: sameSettledPromise === true,
    listenerWhileProcessAlive: listener,
    registrationStillPresent: file !== undefined && existsSync(file),
    url: registration?.url ?? null,
  })}\n`;
  // The listener is still bound here, so the loop would never drain on its own.
  process.stdout.write(line, () => process.exit(0));
}

// ---- parent: bounded children, own temp root, own cleanup ------------------

function runChild(scenario, home) {
  return new Promise((settle) => {
    const env = { ...process.env };
    delete env.CROSSCHAT_LIVE;
    const child = spawn(process.execPath, [SELF, '--child', scenario, '--home', home], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let killedFor = null;
    let closeUnconfirmed = false;
    let done = false;
    let deadline;
    const errors = [];

    const settleOnce = (code) => {
      if (done) return;
      done = true;
      clearTimeout(hardTimer);
      clearTimeout(deadline);
      const line = stdout.split(/\r?\n/).find((item) => item.startsWith('RESULT '));
      let observed;
      try { observed = line === undefined ? undefined : JSON.parse(line.slice(7)); } catch { observed = undefined; }
      settle({ childExit: code, killedFor, closeUnconfirmed, errors, stdoutTruncated, stderrTruncated, stdoutBytes, stderrBytes, observed, stderr: stderr.trim().slice(0, 400) });
    };
    // The child may still be alive here. Release only the handles this parent
    // holds and stop waiting; that is not a claim that the process exited.
    const releaseChild = () => {
      for (const stream of [child.stdout, child.stderr]) {
        if (stream === null || stream === undefined) continue;
        stream.removeAllListeners('data');
        stream.on('error', () => {});
        stream.destroy();
      }
      child.unref();
    };
    // Once the child was killed or failed to spawn, wait for its own close only
    // for a bounded time; an unconfirmed exit stops the run and keeps the root.
    const awaitClose = () => {
      if (deadline !== undefined) return;
      deadline = setTimeout(() => { closeUnconfirmed = true; settleOnce(null); releaseChild(); }, LIMITS.closeMs);
    };
    const kill = (reason) => { if (killedFor !== null) return; killedFor = reason; child.kill(); awaitClose(); };
    const hardTimer = setTimeout(() => kill('timeout'), LIMITS.childMs);

    child.stdout.on('data', (chunk) => {
      if (stdoutTruncated) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > LIMITS.stdoutBytes) { stdoutTruncated = true; stdout = ''; kill('output-limit'); return; }
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      if (stderrTruncated) return;
      stderrBytes += chunk.length;
      if (stderrBytes > LIMITS.stderrBytes) { stderrTruncated = true; kill('output-limit'); return; }
      stderr += chunk.toString('utf8');
    });
    // A spawn error is only recorded; settlement still waits for close.
    child.on('error', (error) => { errors.push(String(error?.message ?? error)); awaitClose(); });
    child.on('close', (code) => settleOnce(code));
  });
}

function assess(scenario, run) {
  const problems = [];
  if (run.closeUnconfirmed) problems.push('child exit not confirmed within the close deadline');
  if (run.killedFor === 'timeout') problems.push('child exceeded the time limit');
  if (run.killedFor === 'output-limit') problems.push('child output exceeded the byte cap');
  if (run.stdoutTruncated) problems.push('stdout truncated at the byte cap');
  if (run.childExit !== 0) problems.push(`child exited ${String(run.childExit)}`);
  const observed = run.observed;
  if (observed === undefined) problems.push('no parsable RESULT line');
  else {
    if (observed.scenario !== scenario) problems.push('RESULT scenario does not match');
    const missing = REQUIRED_FIELDS.filter((key) => !(key in observed));
    if (missing.length > 0) problems.push(`RESULT is missing ${missing.join(',')}`);
  }
  if (run.listenerAfterChildExit?.confirmedClosed !== true) problems.push('port release not confirmed after child exit');
  if (problems.length > 0) return { status: 'evidence-failure', problems };

  const expected = EXPECTATIONS[scenario] ?? {};
  const mismatches = [];
  if (expected.mountError !== undefined && (observed.mountError?.message ?? null) !== expected.mountError) mismatches.push(`mountError ${JSON.stringify(observed.mountError)}`);
  if (expected.closeOutcome !== undefined && observed.closeOutcome !== expected.closeOutcome) mismatches.push(`closeOutcome ${observed.closeOutcome}`);
  if (expected.closeMessage !== undefined && observed.closeError?.message !== expected.closeMessage) mismatches.push(`closeError ${JSON.stringify(observed.closeError)}`);
  if (expected.registrationStillPresent !== undefined && observed.registrationStillPresent !== expected.registrationStillPresent) mismatches.push(`registrationStillPresent ${observed.registrationStillPresent}`);
  if (expected.listenerAnswered !== undefined && (observed.listenerWhileProcessAlive?.answered === true) !== expected.listenerAnswered) mismatches.push(`listenerAnswered ${JSON.stringify(observed.listenerWhileProcessAlive)}`);
  if (expected.listenerStatus !== undefined && observed.listenerWhileProcessAlive?.status !== expected.listenerStatus) mismatches.push(`listenerStatus ${JSON.stringify(observed.listenerWhileProcessAlive?.status)}`);
  if (expected.sameSettledPromise !== undefined && observed.sameSettledPromise !== expected.sameSettledPromise) mismatches.push(`sameSettledPromise ${observed.sameSettledPromise}`);
  return mismatches.length > 0 ? { status: 'not-reproduced', mismatches } : { status: 'reproduced' };
}

async function main() {
  const argv = process.argv.slice(2);
  const outPath = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : undefined;
  if (argv.includes('--out') && outPath === undefined) return { report: { problems: ['--out requires a path'], wrote: false }, code: 2 };
  if (outPath !== undefined && existsSync(outPath)) return { report: { problems: ['refusing to overwrite an existing output'], out: outPath, wrote: false }, code: 3 };

  const root = mkdtempSync(join(tmpdir(), 'c13-p01-'));
  const runs = [];
  let retain = false;
  try {
    for (const scenario of SCENARIOS) {
      const home = join(root, scenario);
      mkdirSync(home, { recursive: true });
      const run = await runChild(scenario, home);
      const observed = run.observed ?? {};
      const directory = join(home, '.crosschat', 'dsh', 'instances');
      const left = existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith('.json')) : [];
      // After the child is gone its listener must be refused; a missing url or a
      // skipped probe is not a confirmation of closure.
      let listenerAfterChildExit;
      if (run.closeUnconfirmed) listenerAfterChildExit = { outcome: 'child-not-confirmed-exited', confirmedClosed: false };
      else if (typeof observed.url !== 'string' || observed.url === '') listenerAfterChildExit = { outcome: 'not-probed', confirmedClosed: false };
      else listenerAfterChildExit = await probeListener(observed.url, 'after-exit');
      const verdict = assess(scenario, { ...run, listenerAfterChildExit });
      runs.push({ scenario, run, registrationFilesAfterExit: left.length, listenerAfterChildExit, verdict });
      if (run.closeUnconfirmed) { retain = true; break; }
    }
  } finally {
    if (!retain && resolve(join(root, '..')) === resolve(tmpdir()) && /^c13-p01-/.test(basename(root)) && existsSync(root)) rmSync(root, { recursive: true, force: true });
  }

  const problems = runs.flatMap((item) => (item.verdict.status === 'evidence-failure' ? item.verdict.problems.map((problem) => `${item.scenario}: ${problem}`) : []));
  if (runs.length !== SCENARIOS.length) problems.push(`stopped after ${runs.length} of ${SCENARIOS.length} scenarios`);
  const notReproduced = runs
    .filter((item) => item.verdict.status === 'not-reproduced')
    .map((item) => ({ scenario: item.scenario, mismatches: item.verdict.mismatches }));

  const report = {
    probe: 'c13-harness-lifecycle-close-repro',
    version: 2,
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    baseline: '2c4d48d0e31f0958b51a3a8b18fc41bcf261a779',
    scope: 'synthetic ctx/host in an exclusive temp home; no native Harness, no message delivery',
    limits: LIMITS,
    runs: runs.map((item) => ({
      scenario: item.scenario,
      verdict: item.verdict.status,
      childExit: item.run.childExit,
      killedFor: item.run.killedFor,
      closeUnconfirmed: item.run.closeUnconfirmed,
      childErrors: item.run.errors,
      stdoutBytes: item.run.stdoutBytes,
      stderrBytes: item.run.stderrBytes,
      stdoutTruncated: item.run.stdoutTruncated,
      stderrTruncated: item.run.stderrTruncated,
      mountError: item.run.observed?.mountError ?? null,
      registrationPublished: item.run.observed?.registrationPublished ?? null,
      closeOutcome: item.run.observed?.closeOutcome ?? null,
      closeError: item.run.observed?.closeError ?? null,
      sameSettledPromise: item.run.observed?.sameSettledPromise ?? null,
      listenerWhileProcessAlive: item.run.observed?.listenerWhileProcessAlive ?? null,
      registrationStillPresent: item.run.observed?.registrationStillPresent ?? null,
      registrationFilesAfterExit: item.registrationFilesAfterExit,
      listenerAfterChildExit: item.listenerAfterChildExit,
      problems: item.verdict.status === 'evidence-failure' ? item.verdict.problems : [],
      mismatches: item.verdict.status === 'not-reproduced' ? item.verdict.mismatches : [],
      stderr: item.run.stderr === '' ? null : item.run.stderr,
    })),
    verdicts: Object.fromEntries(runs.map((item) => [item.scenario, item.verdict.status])),
    problems,
    notReproduced,
    cleanup: { created: true, removed: !retain && !existsSync(root), retained: retain, root: retain ? root : null },
  };
  if (outPath !== undefined) {
    try {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(outPath, `${JSON.stringify({ ...report, wrote: true }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      report.wrote = true;
    } catch (error) { report.writeError = String(error?.code ?? error); }
  }
  const code = report.writeError !== undefined ? 1 : problems.length > 0 ? 1 : notReproduced.length > 0 ? 1 : 0;
  return { report, code };
}

if (process.argv[2] === '--child') {
  await childMain(process.argv[3], process.argv[5]);
} else if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outcome = await main();
  process.stdout.write(`${JSON.stringify(outcome.report, null, 2)}\n`);
  if (typeof outcome.code === 'number') process.exitCode = outcome.code;
}
