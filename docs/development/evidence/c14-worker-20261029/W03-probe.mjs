// C14-W03-R1 probe: deterministic interleaving of two independent claimHandle callers.
// Only scheduling is controlled (fs rename barriers); the allocator is the real built
// module. A malfunction (spawn error, non-zero exit, missing/invalid result, barrier
// timeout, unexpected shard shape) aborts with a non-zero exit instead of being counted
// as "not reproduced". Usage: node W03-probe.mjs [--out <new file>]
// Exit: 0 = every scenario was a valid experiment, 1 = probe/scenario malfunction,
//       2 = usage error or refusing to overwrite an existing evidence file.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import {
  duplicatesOf, fileStat, handleIndex, ownedTempRoot, readShardHandles, resolveVerdict, sha256Of, tailBuffer,
} from './W03-probe-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.W03_REPO ?? resolve(HERE, '../../../..');
const DIST = join(REPO, 'dist');
const WORKER = process.env.W03_WORKER ?? join(HERE, 'W03-worker.mjs');
const CANDIDATE = 1;
const REPEATS = Math.max(1, Number(process.env.W03_REPEATS ?? 5));
const BARRIER_STEPS = Math.max(1, Number(process.env.W03_BARRIER_STEPS ?? 2));
const BARRIER_TIMEOUT_MS = Number(process.env.W03_BARRIER_TIMEOUT_MS ?? 15_000);
const WORKER_TIMEOUT_MS = Number(process.env.W03_WORKER_TIMEOUT_MS ?? 30_000);
const OUT_LIMIT = 64 * 1024;
const USAGE = 'usage: node W03-probe.mjs [--out <new file>]   (refuses to overwrite an existing file)\n';

// Runtime-generated CJS preload: wraps fs.renameSync only to schedule the two callers.
// A barrier that times out throws, so the worker fails instead of continuing on a
// silently different interleaving.
const HOOK = `// runtime-generated timing barrier (CJS preload, lives in the probe's temp root)
const fs = require('node:fs');
const path = require('node:path');
const shardDir = process.env.W03_SHARD_DIR;
const barrier = process.env.W03_BARRIER_DIR;
const id = process.env.W03_WORKER_ID;
const peer = process.env.W03_PEER_ID;
const steps = Number(process.env.W03_BARRIER_STEPS || '2');
const timeoutMs = Number(process.env.W03_BARRIER_TIMEOUT_MS || '15000');
const origRename = fs.renameSync;
const flag = function (kind, who) { return path.join(barrier, kind + '-' + who); };
const sleep = function (ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
function signal(kind) { fs.writeFileSync(flag(kind, id), '1'); }
function waitPeer(kind) {
  const start = Date.now();
  while (!fs.existsSync(flag(kind, peer))) {
    if (Date.now() - start > timeoutMs) {
      fs.writeFileSync(path.join(barrier, 'timeout-' + kind + '-' + id), '1');
      throw new Error('W03 barrier timeout: ' + kind);
    }
    sleep(2);
  }
}
let renames = 0;
globalThis.__w03Renames = 0;
fs.renameSync = function (from, to) {
  const target = path.resolve(String(to));
  const inShardDir = target === shardDir || target.startsWith(shardDir + path.sep);
  if (!inShardDir) return origRename.apply(this, arguments);
  renames += 1;
  globalThis.__w03Renames = renames;
  if (renames > steps) return origRename.apply(this, arguments);
  if (renames === 1) {
    const result = origRename.apply(this, arguments);
    signal('r1');
    waitPeer('r1');
    return result;
  }
  signal('pre2');
  waitPeer('pre2');
  const result = origRename.apply(this, arguments);
  signal('post2');
  waitPeer('post2');
  return result;
};
`;

function bail(code, message) {
  process.stderr.write(message + '\n');
  process.exit(code);
}

let outPath;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--help') {
    process.stdout.write(USAGE);
    process.exit(0);
  } else if (argv[i] === '--out') {
    outPath = argv[i += 1];
    if (outPath === undefined || outPath === '') bail(2, '--out 需要一个路径');
  } else {
    bail(2, '未知参数: ' + argv[i] + '\n' + USAGE);
  }
}
if (outPath !== undefined && existsSync(outPath)) bail(2, '拒绝覆盖已有证据文件: ' + outPath);

function head() {
  try { return execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}

function moduleInfo(rel) {
  const file = join(REPO, rel);
  try { return { file, sha256: sha256Of(file), ...fileStat(file) }; }
  catch (error) { return { file, sha256: 'unreadable', error: String(error?.message ?? error) }; }
}

function parseLastJson(text) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed !== null && typeof parsed === 'object') return parsed;
    } catch { /* not the result line */ }
  }
  return undefined;
}

function spawnWorker({ root, id, peer, endpoints, stateFile, shardDir, barrier, useHook }) {
  const env = {
    ...process.env,
    W03_DIST: DIST,
    W03_STATE_FILE: stateFile,
    W03_CANDIDATE: String(CANDIDATE),
    W03_EP_A: endpoints[0],
    W03_EP_B: endpoints[1],
    W03_WORKER_ID: id,
    W03_PEER_ID: peer,
    W03_SHARD_DIR: shardDir,
    W03_BARRIER_DIR: barrier,
    W03_BARRIER_STEPS: String(BARRIER_STEPS),
    W03_BARRIER_TIMEOUT_MS: String(BARRIER_TIMEOUT_MS),
  };
  const args = useHook ? ['--require', join(root, 'hook.cjs'), WORKER] : [WORKER];
  const record = { id, exit: undefined, signal: undefined, timedOut: false, spawnError: undefined, result: undefined, outputTruncated: false };
  const stdout = tailBuffer(OUT_LIMIT);
  const stderr = tailBuffer(OUT_LIMIT);
  let child;
  try {
    child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    record.spawnError = String(error?.message ?? error);
    return { record, promise: Promise.resolve(record), kill: () => {} };
  }
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  let settled = false;
  let timer;
  const promise = new Promise((done) => {
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      record.exit = child.exitCode;
      record.signal = child.signalCode;
      record.stdoutTail = stdout.text;
      record.stderrTail = stderr.text;
      record.outputTruncated = stdout.truncated || stderr.truncated;
      record.result = parseLastJson(stdout.text);
      done(record);
    };
    timer = setTimeout(() => {
      record.timedOut = true;
      try { child.kill(); } catch { /* already gone */ }
      setTimeout(finish, 5_000).unref();
    }, WORKER_TIMEOUT_MS);
    child.on('error', (error) => { record.spawnError = String(error?.message ?? error); finish(); });
    child.on('close', finish);
  });
  return { record, promise, kill: () => { try { child.kill(); } catch { /* already gone */ } } };
}

function workerOk(record) {
  return record.spawnError === undefined && !record.timedOut && record.exit === 0
    && record.result !== undefined && record.result.error === undefined
    && typeof record.result.handle === 'string' && typeof record.result.ref === 'string';
}

async function execute(scenario, root, record, track) {
  const barrier = join(root, 'barrier');
  const stateRoot = process.env.W03_STATE_ROOT ?? join(root, 'state');
  const stateFile = join(stateRoot, 'conversations.json');
  const shardDir = join(stateRoot, 'conversations');
  mkdirSync(barrier, { recursive: true });
  mkdirSync(stateRoot, { recursive: true });
  writeFileSync(join(root, 'hook.cjs'), HOOK, 'utf8');

  const endpointsA = ['w03-claude-a', 'w03-codex-a'];
  const endpointsB = ['w03-claude-b', 'w03-codex-b'];
  const base = { root, stateFile, shardDir, barrier };

  if (scenario === 'concurrent') {
    const spawned = [
      track(spawnWorker({ ...base, id: 'a', peer: 'b', endpoints: endpointsA, useHook: true })),
      track(spawnWorker({ ...base, id: 'b', peer: 'a', endpoints: endpointsB, useHook: true })),
    ];
    await Promise.all(spawned.map((s) => s.promise));
  } else if (scenario === 'control-empty') {
    const solo = track(spawnWorker({ ...base, id: 'solo', peer: 'none', endpoints: endpointsA, useHook: false }));
    await solo.promise;
  } else if (scenario === 'control-existing') {
    const first = track(spawnWorker({ ...base, id: 's1', peer: 'none', endpoints: endpointsA, useHook: false }));
    await first.promise;
    if (workerOk(first.record)) {
      const second = track(spawnWorker({ ...base, id: 's2', peer: 'none', endpoints: endpointsB, useHook: false }));
      await second.promise;
      if (workerOk(second.record)) {
        const { resolveHandle } = await import(pathToFileURL(join(DIST, 'conversations.js')).href);
        for (const [handle, worker] of [['c1', first.record], [second.record.result.handle, second.record]]) {
          try {
            const ref = resolveHandle(stateFile, handle);
            record.afterResolve.push({ handle, expectedRef: worker.result.ref, ok: ref === worker.result.ref, ref });
          } catch (error) {
            record.afterResolve.push({ handle, expectedRef: worker.result.ref, ok: false, code: error?.code, message: String(error?.message ?? error) });
          }
        }
      }
    }
  } else {
    throw new Error('未知场景: ' + scenario);
  }

  record.barrierFlags = readDirFlags(barrier);
  record.shards = readShardHandles(shardDir);
}

function readDirFlags(barrier) {
  try { return readdirSync(barrier).sort(); } catch { return []; }
}

async function runScenario(scenario) {
  const root = mkdtempSync(join(tmpdir(), 'crosschat-w03-'));
  const record = { scenario, tempRoot: root, cleaned: false, problems: [], workers: [], barrierFlags: [], shards: [], afterResolve: [] };
  const spawned = [];
  const track = (worker) => { spawned.push(worker); return worker; };
  try {
    try {
      await execute(scenario, root, record, track);
    } catch (error) {
      record.problems.push('初始化/执行异常: ' + String(error?.message ?? error));
    }
  } finally {
    for (const worker of spawned) worker.kill();
    await Promise.allSettled(spawned.map((worker) => worker.promise));
    record.workers = spawned.map((worker) => worker.record);
    if (ownedTempRoot(root)) {
      try { rmSync(root, { recursive: true, force: true }); }
      catch (error) { record.problems.push('清理失败: ' + String(error?.message ?? error)); }
    } else {
      record.problems.push('拒绝删除非本单根: ' + root);
    }
    record.cleaned = !existsSync(root);
    if (!record.cleaned) record.problems.push('临时根未清理: ' + root);
  }
  return record;
}

function evaluate(record) {
  const problems = [...record.problems];
  const index = handleIndex(record.shards);
  const duplicates = duplicatesOf(record.shards);
  const outcomes = [];

  for (const worker of record.workers) {
    if (worker.spawnError !== undefined) problems.push(`${worker.id}: 子进程启动失败 ${worker.spawnError}`);
    if (worker.timedOut) problems.push(`${worker.id}: 子进程超时被杀`);
    if (worker.exit !== 0) problems.push(`${worker.id}: 退出码 ${worker.exit}${worker.signal ? ' 信号 ' + worker.signal : ''}`);
    if (worker.outputTruncated) problems.push(`${worker.id}: 输出超限被截断`);
    if (!workerOk(worker)) {
      if (worker.result === undefined) problems.push(`${worker.id}: 无合法 JSON 结果`);
      else if (worker.result.error !== undefined) problems.push(`${worker.id}: worker 报错 ${worker.result.error}`);
      else problems.push(`${worker.id}: 结果缺少 handle/ref`);
      continue;
    }
    const verdict = resolveVerdict(worker.result.resolve, worker.result.ref);
    const hits = index.get(worker.result.handle) ?? [];
    const distinctRefs = new Set(hits.map((hit) => hit.ref)).size;
    outcomes.push({
      id: worker.id,
      handle: worker.result.handle,
      ref: worker.result.ref,
      renames: worker.result.renames,
      verdict,
      shardHits: hits.length,
      distinctRefs,
      resolve: worker.result.resolve,
    });
    if (verdict === 'error') problems.push(`${worker.id}: resolve 失败且非撞号 ${worker.result.resolve?.code}: ${worker.result.resolve?.message}`);
    if (verdict === 'collision' && distinctRefs < 2) problems.push(`${worker.id}: 报撞号但分片中无重复（${worker.result.handle} 命中 ${distinctRefs} 个 ref）`);
    if (hits.length === 0) problems.push(`${worker.id}: 返回柄未落进任何分片（${worker.result.handle}）`);
  }

  const barrierTimeouts = record.barrierFlags.filter((flag) => flag.startsWith('timeout-'));
  if (barrierTimeouts.length > 0) problems.push(`屏障超时: ${barrierTimeouts.join(',')}`);

  if (record.scenario === 'concurrent') {
    if (record.shards.length !== 2) problems.push(`分片数 ${record.shards.length} ≠ 2`);
    for (const shard of record.shards) {
      const count = Object.keys(shard.handles).length;
      if (count !== 1) problems.push(`分片 ${shard.shard} 柄数 ${count} ≠ 1`);
    }
    const expected = BARRIER_STEPS >= 2 ? ['r1', 'pre2', 'post2'] : ['r1'];
    const missing = expected.flatMap((kind) => [`${kind}-a`, `${kind}-b`]).filter((flag) => !record.barrierFlags.includes(flag));
    if (missing.length > 0) problems.push(`屏障信号缺失: ${missing.join(',')}`);
    for (const outcome of outcomes) {
      if (outcome.renames !== BARRIER_STEPS) problems.push(`${outcome.id}: 分片写入次数 ${outcome.renames} ≠ ${BARRIER_STEPS}（探针只覆盖当前分配形状）`);
    }
  }

  if (record.scenario === 'control-empty') {
    if (record.shards.length !== 1) problems.push(`空状态分片数 ${record.shards.length} ≠ 1`);
    for (const outcome of outcomes) {
      if (outcome.handle !== 'c1') problems.push(`${outcome.id}: 空状态首个柄应为 c1，实际 ${outcome.handle}`);
      if (outcome.verdict !== 'own') problems.push(`${outcome.id}: 空状态应解析回自己的 ref，实际 ${outcome.verdict}`);
    }
  }

  if (record.scenario === 'control-existing') {
    if (record.shards.length !== 2) problems.push(`已有柄对照分片数 ${record.shards.length} ≠ 2`);
    const [first, second] = outcomes;
    if (first === undefined || second === undefined) {
      problems.push('已有柄对照缺少执行者结果');
    } else {
      if (first.handle !== 'c1') problems.push(`s1: 首个柄应为 c1，实际 ${first.handle}`);
      if (second.handle === first.handle) problems.push(`s2: 未避开已占用柄 ${second.handle}`);
      for (const outcome of [first, second]) {
        if (outcome.verdict !== 'own') problems.push(`${outcome.id}: 应解析回自己的 ref，实际 ${outcome.verdict}`);
        if (outcome.shardHits !== 1 || outcome.distinctRefs !== 1) problems.push(`${outcome.id}: ${outcome.handle} 分片命中 ${outcome.shardHits}/${outcome.distinctRefs}`);
      }
      const c1 = index.get('c1') ?? [];
      if (new Set(c1.map((hit) => hit.ref)).size !== 1 || c1[0]?.ref !== first.ref) problems.push('c1 在对照结束后未唯一指向 s1 的 ref');
    }
    for (const entry of record.afterResolve) {
      if (!entry.ok) problems.push(`事后 resolve(${entry.handle}) 未回到预期 ref（${entry.code ?? 'mismatch'}）`);
    }
    if (record.afterResolve.length !== 2) problems.push(`事后 resolve 条数 ${record.afterResolve.length} ≠ 2`);
  }

  const valid = problems.length === 0;
  const reproduced = record.scenario === 'concurrent' && valid && duplicates.length > 0
    && outcomes.length === 2 && outcomes.every((outcome) => outcome.verdict === 'collision');
  return { valid, reproduced, problems, outcomes, duplicates, barrierTimeouts };
}

const concurrentRuns = [];
for (let repeat = 1; repeat <= REPEATS; repeat += 1) {
  const record = await runScenario('concurrent');
  concurrentRuns.push({ repeat, ...record, verdict: evaluate(record) });
}
const controlEmptyRecord = await runScenario('control-empty');
const controlEmpty = { ...controlEmptyRecord, verdict: evaluate(controlEmptyRecord) };
const controlExistingRecord = await runScenario('control-existing');
const controlExisting = { ...controlExistingRecord, verdict: evaluate(controlExistingRecord) };

const verdicts = [...concurrentRuns.map((run) => run.verdict), controlEmpty.verdict, controlExisting.verdict];
const malfunctions = verdicts.flatMap((verdict) => verdict.problems).length;
const reproducedRuns = concurrentRuns.filter((run) => run.verdict.reproduced).length;
const collisions = verdicts.flatMap((verdict) => verdict.outcomes).filter((outcome) => outcome.verdict === 'collision').length;
const mismatches = verdicts.flatMap((verdict) => verdict.outcomes).filter((outcome) => outcome.verdict === 'other').length;

const evidence = {
  ticket: 'C14-W03-R1',
  generatedAt: new Date().toISOString(),
  baseline: {
    head: head(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    repo: REPO,
    buildNote: process.env.W03_BUILD_NOTE ?? null,
    modules: ['dist/conversations.js', 'dist/ref.js', 'src/conversations.ts', 'src/ref.ts'].map(moduleInfo),
  },
  scenario: {
    candidate: CANDIDATE,
    repeats: REPEATS,
    barrierSteps: BARRIER_STEPS,
    barrierTimeoutMs: BARRIER_TIMEOUT_MS,
    workerTimeoutMs: WORKER_TIMEOUT_MS,
    barrier: 'CJS preload wraps fs.renameSync: r1 = both first shard writes visible before either scan; pre2 = both retry writes withheld until both callers computed max+2; post2 = both retry writes visible before either caller resolves; a timeout throws and fails the worker',
    pinnedShape: 'the barrier is pinned to the current two-shard-write allocation shape; a fixed allocator with a different shape trips the missing-signal/write-count checks instead of passing silently',
    endpoints: 'synthetic ids (w03-claude-a/b, w03-codex-a/b); no real state, no network, no messages sent',
    validity: 'non-zero exit, spawn error, timeout, missing/invalid result, truncated output, unexpected shard shape, missing barrier signal or a non-collision resolve error marks the run a malfunction (non-zero exit), never "not reproduced"',
  },
  concurrentRuns,
  controlEmpty,
  controlExisting,
  summary: {
    validRuns: concurrentRuns.filter((run) => run.verdict.valid).length + (controlEmpty.verdict.valid ? 1 : 0) + (controlExisting.verdict.valid ? 1 : 0),
    reproducedRuns,
    collisions,
    mismatches,
    malfunctions,
  },
};

const text = JSON.stringify(evidence, null, 2) + '\n';
if (outPath !== undefined) {
  try {
    writeFileSync(outPath, text, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    bail(2, '写入证据失败（未覆盖已有文件）: ' + String(error?.message ?? error));
  }
}

process.stdout.write(JSON.stringify({
  ticket: 'C14-W03-R1',
  head: evidence.baseline.head,
  repeats: REPEATS,
  reproducedRuns,
  collisions,
  mismatches,
  malfunctions,
  barrierTimeouts: verdicts.flatMap((verdict) => verdict.barrierTimeouts).length,
  controlEmpty: { valid: controlEmpty.verdict.valid, problems: controlEmpty.verdict.problems },
  controlExisting: { valid: controlExisting.verdict.valid, problems: controlExisting.verdict.problems },
  outPath: outPath ?? null,
}) + '\n');
process.exit(malfunctions === 0 ? 0 : 1);
