// C13-P01 isolated reproduction: what survives a rejected mountDshBridge.close().
// Synthetic ctx/host only, exclusive temp home, no native Harness, no message
// delivery, no user state. The bridge owns its listener, so a rejected close
// leaks it; this script therefore runs each scenario in its own bounded child
// process and lets process exit reclaim the socket. Cleanup never re-calls the
// memoized close and never scans or kills by process name.
// Usage: node P01-repro.mjs [--out <new.json>]
/* global process */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const LIMITS = { childMs: 20_000, probeMs: 3_000, stdoutBytes: 64 * 1024 };
const SCENARIOS = ['control', 'release-throws', 'scope-dispose-rejects', 'mount-catch'];
const describe = (error) => ({ name: error?.name, message: String(error?.message ?? error) });

async function probeListener(url, token) {
  try {
    const response = await fetch(`${url}/v1/info`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(LIMITS.probeMs) });
    return { answered: true, status: response.status };
  } catch (error) { return { answered: false, error: error?.cause?.code ?? error?.code ?? error?.name }; }
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

  let closeError;
  let sameSettledPromise;
  if (bridge !== undefined) {
    const first = bridge.close();
    // A rejected close is memoized: a second call hands back the same promise.
    sameSettledPromise = bridge.close() === first;
    try { await first; } catch (error) { closeError = describe(error); }
  }

  const listener = registration === undefined ? { probed: false } : await probeListener(registration.url, registration.token);
  const line = `RESULT ${JSON.stringify({
    scenario,
    mountError: mountError ?? null,
    registrationPublished: registration !== undefined,
    closeCalled: bridge !== undefined || mountError !== null,
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
  return new Promise((resolve_) => {
    const env = { ...process.env };
    delete env.CROSSCHAT_LIVE;
    const child = spawn(process.execPath, [SELF, '--child', scenario, '--home', home], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, LIMITS.childMs);
    child.stdout.on('data', (chunk) => { if (stdout.length < LIMITS.stdoutBytes) stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { if (stderr.length < LIMITS.stdoutBytes) stderr += String(chunk); });
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const line = stdout.split(/\r?\n/).find((item) => item.startsWith('RESULT '));
      let observed;
      try { observed = line === undefined ? undefined : JSON.parse(line.slice(7)); } catch { observed = undefined; }
      resolve_({ childExit: code, timedOut, observed, stderr: stderr.trim().slice(0, 500) });
    };
    child.on('error', (error) => { stderr += String(error?.message ?? error); finish(null); });
    child.on('close', (code) => finish(code));
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const outPath = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : undefined;
  if (argv.includes('--out') && outPath === undefined) return { report: { error: '--out requires a path', wrote: false }, code: 2 };
  if (outPath !== undefined && existsSync(outPath)) return { report: { error: 'refusing to overwrite an existing output', out: outPath, wrote: false }, code: 3 };

  const root = mkdtempSync(join(tmpdir(), 'c13-p01-'));
  const runs = [];
  try {
    for (const scenario of SCENARIOS) {
      const home = join(root, scenario);
      mkdirSync(home, { recursive: true });
      const run = await runChild(scenario, home);
      const observed = run.observed ?? {};
      const directory = join(home, '.crosschat', 'dsh', 'instances');
      const left = existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith('.json')) : [];
      // The child has exited, so its listener must be gone: anything else is a leak.
      const afterExit = observed.url === null || observed.url === undefined ? { probed: false } : await probeListener(observed.url, 'after-exit');
      runs.push({ ...run, observed: observed, registrationFilesAfterExit: left.length, listenerAfterChildExit: afterExit });
    }
  } finally {
    if (resolve(join(root, '..')) === resolve(tmpdir()) && /^c13-p01-/.test(basename(root)) && existsSync(root)) rmSync(root, { recursive: true, force: true });
  }

  const byScenario = Object.fromEntries(runs.map((run) => [run.observed?.scenario ?? run.scenario, run]));
  const report = {
    probe: 'c13-harness-lifecycle-close-repro',
    version: 1,
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    baseline: 'b062c3e450794523c3633ef013481158e057b4d9',
    scope: 'synthetic ctx/host in an exclusive temp home; no native Harness, no message delivery',
    limits: LIMITS,
    runs: runs.map((run) => ({
      scenario: run.observed?.scenario ?? null,
      childExit: run.childExit,
      timedOut: run.timedOut,
      mountError: run.observed?.mountError ?? null,
      registrationPublished: run.observed?.registrationPublished ?? null,
      closeRejected: run.observed?.closeError !== null && run.observed?.closeError !== undefined,
      closeError: run.observed?.closeError ?? null,
      sameSettledPromise: run.observed?.sameSettledPromise ?? null,
      listenerWhileProcessAlive: run.observed?.listenerWhileProcessAlive ?? null,
      registrationStillPresent: run.observed?.registrationStillPresent ?? null,
      registrationFilesAfterExit: run.registrationFilesAfterExit,
      listenerAfterChildExit: run.listenerAfterChildExit,
      stderr: run.stderr === '' ? null : run.stderr,
    })),
    summary: {
      controlClosedCleanly: byScenario.control?.observed?.closeError === null
        && byScenario.control?.observed?.registrationStillPresent === false
        && byScenario.control?.observed?.listenerWhileProcessAlive?.answered === false,
      releaseFailureLeaksListener: byScenario['release-throws']?.observed?.listenerWhileProcessAlive?.answered === true,
      disposeFailureLeaksListener: byScenario['scope-dispose-rejects']?.observed?.listenerWhileProcessAlive?.answered === true,
      mountCatchReplacesOriginalError: byScenario['mount-catch']?.observed?.mountError?.message === 'scope dispose failed',
      closeIsMemoized: byScenario['scope-dispose-rejects']?.observed?.sameSettledPromise === true,
      childExitReclaimsListener: runs.every((run) => run.listenerAfterChildExit?.answered !== true),
    },
    cleanup: { created: true, removed: !existsSync(root) },
  };
  if (outPath !== undefined) {
    try {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(outPath, `${JSON.stringify({ ...report, wrote: true }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      report.wrote = true;
    } catch (error) { report.writeError = String(error?.code ?? error); }
  }
  return { report, code: report.writeError === undefined ? 0 : 1 };
}

if (process.argv[2] === '--child') {
  await childMain(process.argv[3], process.argv[5]);
} else if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outcome = await main();
  process.stdout.write(`${JSON.stringify(outcome.report, null, 2)}\n`);
  if (typeof outcome.code === 'number') process.exitCode = outcome.code;
}
