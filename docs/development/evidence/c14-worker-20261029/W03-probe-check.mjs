// C14-W03-R1 failure-path check for the probe. Every case runs the real probe as a child
// in an isolated TEMP (so any leftover crosschat-w03-* root is provably ours) and asserts
// the exit code, the summary, and the cleanup. Exit 0 = all cases passed.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { duplicatesOf, ownedTempRoot, resolveVerdict, sha256Of } from './W03-probe-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE = join(HERE, 'W03-probe.mjs');
const ORIGINAL_EVIDENCE = join(HERE, 'W03-result.json');
const base = mkdtempSync(join(tmpdir(), 'crosschat-w03-check-'));
const tempBase = join(base, 'tmp');
const failures = [];

function check(name, condition, detail) {
  const ok = condition === true;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' — ' + detail}\n`);
  if (!ok) failures.push(name);
}

function runProbe(args, extraEnv = {}, timeout = 120_000) {
  const result = spawnSync(process.execPath, [PROBE, ...args], {
    env: { ...process.env, TEMP: tempBase, TMP: tempBase, ...extraEnv },
    encoding: 'utf8',
    timeout,
  });
  let summary;
  const lines = String(result.stdout ?? '').trim().split('\n').filter(Boolean);
  try { summary = JSON.parse(lines[lines.length - 1]); } catch { summary = undefined; }
  return { code: result.status, signal: result.signal, summary, stderr: String(result.stderr ?? '') };
}

function leftovers() {
  try { return readdirSync(tempBase).filter((name) => name.startsWith('crosschat-w03-')); }
  catch { return []; }
}

try {
  const originalHash = sha256Of(ORIGINAL_EVIDENCE);
  mkdirSync(tempBase, { recursive: true });

  // 1. Normal deterministic replay: valid experiment, controls healthy, roots cleaned.
  const normal = runProbe([], { W03_REPEATS: '1' });
  check('normal: exit 0', normal.code === 0, `exit ${normal.code}`);
  check('normal: 1/1 reproduced', normal.summary?.reproducedRuns === 1, JSON.stringify(normal.summary?.reproducedRuns));
  check('normal: no malfunction', normal.summary?.malfunctions === 0, String(normal.summary?.malfunctions));
  check('normal: empty control valid', normal.summary?.controlEmpty?.valid === true, JSON.stringify(normal.summary?.controlEmpty?.problems));
  check('normal: existing-handle control valid', normal.summary?.controlExisting?.valid === true, JSON.stringify(normal.summary?.controlExisting?.problems));
  check('normal: roots cleaned', leftovers().length === 0, leftovers().join(','));

  // 2. Init failure after mkdtemp: a regular file at this scenario's own state path.
  const initFail = runProbe([], { W03_REPEATS: '1', W03_FAIL_INIT: '1' });
  check('init failure: non-zero exit', initFail.code !== 0 && initFail.code !== null, `exit ${initFail.code}`);
  check('init failure: roots cleaned', leftovers().length === 0, leftovers().join(','));

  const foreign = join(base, 'outside-scenario');
  mkdirSync(foreign, { recursive: true });
  const sentinel = join(foreign, 'keep.txt');
  writeFileSync(sentinel, 'unchanged', 'utf8');
  const foreignRoot = runProbe([], { W03_REPEATS: '1', W03_STATE_ROOT: foreign });
  check('foreign state: non-zero exit', foreignRoot.code === 1, `exit ${foreignRoot.code}`);
  check('foreign state: no writes', readdirSync(foreign).length === 1 && readFileSync(sentinel, 'utf8') === 'unchanged');
  check('foreign state: scenario roots cleaned', leftovers().length === 0, leftovers().join(','));

  // 3. Subprocess run failure: repo without dist, so the worker import fails.
  const noDist = join(base, 'no-dist');
  mkdirSync(noDist, { recursive: true });
  const noDistRun = runProbe([], { W03_REPEATS: '1', W03_REPO: noDist });
  check('worker run failure: non-zero exit', noDistRun.code !== 0 && noDistRun.code !== null, `exit ${noDistRun.code}`);
  check('worker run failure: malfunction recorded', (noDistRun.summary?.malfunctions ?? 0) > 0, String(noDistRun.summary?.malfunctions));
  check('worker run failure: roots cleaned', leftovers().length === 0, leftovers().join(','));

  // 4. Node starts, but loading the absent worker script fails (not spawn's error event).
  const missing = runProbe([], { W03_REPEATS: '1', W03_WORKER: join(base, 'missing-worker.mjs') });
  check('missing worker: non-zero exit', missing.code !== 0 && missing.code !== null, `exit ${missing.code}`);
  check('missing worker: roots cleaned', leftovers().length === 0, leftovers().join(','));

  // 5. Invalid worker output: exit 0 but no JSON result must not count as "not reproduced".
  const stub = join(base, 'stub-worker.mjs');
  writeFileSync(stub, "process.stdout.write('not a json result\\n');\n", 'utf8');
  const garbage = runProbe([], { W03_REPEATS: '1', W03_WORKER: stub });
  check('invalid result: non-zero exit', garbage.code !== 0 && garbage.code !== null, `exit ${garbage.code}`);
  check('invalid result: not counted as a valid run', (garbage.summary?.reproducedRuns ?? 0) === 0 && (garbage.summary?.malfunctions ?? 0) > 0,
    `reproduced=${garbage.summary?.reproducedRuns} malfunctions=${garbage.summary?.malfunctions}`);
  check('invalid result: roots cleaned', leftovers().length === 0, leftovers().join(','));

  // A wrong full ref must make the actual probe fail, including its concurrent branch.
  const wrongWorker = join(base, 'wrong-worker.mjs');
  const workerText = readFileSync(join(HERE, 'W03-worker.mjs'), 'utf8');
  const marker = '  emit({ id, handle, nonce: ref.n, ref: ownRef, renames: globalThis.__w03Renames ?? 0, resolve }, 0);';
  if (!workerText.includes(marker)) throw new Error('Worker result boundary changed; update the controlled wrong-mapping fixture');
  writeFileSync(wrongWorker, workerText.replace(marker,
    "  if (process.env.W03_PEER_ID !== 'none') resolve = { ok: true, ref: 'controlled-other-ref' };\n" + marker), 'utf8');
  const wrongMapping = runProbe([], { W03_REPEATS: '1', W03_WORKER: wrongWorker });
  check('wrong mapping: exit 1', wrongMapping.code === 1, `exit ${wrongMapping.code}`);
  check('wrong mapping: counted as malfunction', wrongMapping.summary?.mismatches === 2 && (wrongMapping.summary?.malfunctions ?? 0) >= 2);
  check('wrong mapping: not counted as reproduced', wrongMapping.summary?.reproducedRuns === 0);
  check('wrong mapping: roots cleaned', leftovers().length === 0, leftovers().join(','));

  // 6. Suppress a required signal permanently; startup scheduling cannot avoid timeout.
  const barrier = runProbe([], { W03_REPEATS: '1', W03_BARRIER_TIMEOUT_MS: '25', W03_SUPPRESS_BARRIER_SIGNAL: 'r1-b' }, 60_000);
  check('barrier timeout: non-zero exit', barrier.code !== 0 && barrier.code !== null, `exit ${barrier.code}`);
  check('barrier timeout: recorded as timeout', (barrier.summary?.barrierTimeouts ?? 0) > 0, String(barrier.summary?.barrierTimeouts));
  check('barrier timeout: not counted as reproduced', (barrier.summary?.reproducedRuns ?? 0) === 0, String(barrier.summary?.reproducedRuns));
  check('barrier timeout: roots cleaned', leftovers().length === 0, leftovers().join(','));

  // 7. Output protection: an existing evidence file is never overwritten.
  const existingOut = join(base, 'existing.json');
  writeFileSync(existingOut, '{"keep":true}\n', 'utf8');
  const before = sha256Of(existingOut);
  const refused = runProbe(['--out', existingOut], { W03_REPEATS: '1' });
  check('existing output: exit 2', refused.code === 2, `exit ${refused.code}`);
  check('existing output: file unchanged', sha256Of(existingOut) === before);

  // 8. Explicit output: a fresh path is created and parses.
  const freshOut = join(base, 'fresh.json');
  const written = runProbe(['--out', freshOut], { W03_REPEATS: '1' });
  check('fresh output: exit 0', written.code === 0, `exit ${written.code}`);
  check('fresh output: file parses', existsSync(freshOut) && JSON.parse(readFileSync(freshOut, 'utf8'))?.ticket === 'C14-W03-R1');
  check('fresh output: roots cleaned', leftovers().length === 0, leftovers().join(','));

  // 9. Committed evidence must stay byte-identical.
  check('original W03-result.json unchanged', sha256Of(ORIGINAL_EVIDENCE) === originalHash);

  // 10. Library behaviour on synthetic inputs (not string-contains assertions).
  const shards = [
    { shard: 'a.json', handles: { c1: 'ref-a', c2: 'ref-a2' } },
    { shard: 'b.json', handles: { c1: 'ref-b' } },
  ];
  check('lib: duplicates detected by distinct refs', duplicatesOf(shards).length === 1 && duplicatesOf(shards)[0].handle === 'c1');
  check('lib: same ref twice is not a duplicate', duplicatesOf([{ shard: 'a.json', handles: { c1: 'ref-a' } }, { shard: 'b.json', handles: { c1: 'ref-a' } }]).length === 0);
  check('lib: own ref verdict', resolveVerdict({ ok: true, ref: 'R' }, 'R') === 'own');
  check('lib: other ref is a mismatch', resolveVerdict({ ok: true, ref: 'X' }, 'R') === 'other');
  check('lib: collision only for the ambiguity error', resolveVerdict({ ok: false, code: 'INVALID_CONVERSATION_REF', message: 'c1 撞号指向多个对话' }, 'R') === 'collision');
  check('lib: expired handle is not a collision', resolveVerdict({ ok: false, code: 'INVALID_CONVERSATION_REF', message: 'c1 已过期或未知' }, 'R') === 'error');
  check('lib: foreign root is not deletable', ownedTempRoot(join(base, 'not-ours')) === false);
} finally {
  if (!ownedTempRoot(base)) throw new Error('Refusing to clean a foreign check root');
  rmSync(base, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stdout.write(`\n${failures.length} FAILED: ${failures.join(', ')}\n`);
  process.exit(1);
}
process.stdout.write('\nall checks passed\n');
