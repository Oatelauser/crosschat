// C14-W03 probe: deterministic interleaving of two independent claimHandle callers.
// Only scheduling is controlled (fs rename barriers); the allocator itself is the
// real built module. Run: node docs/development/evidence/c14-worker-20261029/W03-probe.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.W03_REPO ?? resolve(HERE, '../../../..');
const DIST = join(REPO, 'dist');
const PROBE = join(HERE, 'W03-probe.mjs');
const WORKER = join(HERE, 'W03-worker.mjs');
const EVIDENCE = join(HERE, 'W03-result.json');
const CANDIDATE = 1;
const REPEATS = 5;
const BARRIER_TIMEOUT_MS = 15_000;
const WORKER_TIMEOUT_MS = 30_000;

function head() {
  try { return execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}

const HOOK = `// runtime-generated timing barrier (CJS preload; cleaned with the temp root)
const fs = require('node:fs');
const path = require('node:path');
const shardDir = process.env.W03_SHARD_DIR;
const barrier = process.env.W03_BARRIER_DIR;
const id = process.env.W03_WORKER_ID;
const peer = process.env.W03_PEER_ID;
const timeoutMs = Number(process.env.W03_BARRIER_TIMEOUT_MS || '15000');
const origRename = fs.renameSync;
const flag = (kind, who) => path.join(barrier, kind + '-' + who);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function signal(kind) { fs.writeFileSync(flag(kind, id), '1'); }
function waitPeer(kind) {
  const start = Date.now();
  while (!fs.existsSync(flag(kind, peer))) {
    if (Date.now() - start > timeoutMs) { fs.writeFileSync(path.join(barrier, 'timeout-' + kind + '-' + id), '1'); return; }
    sleep(2);
  }
}
let renames = 0;
fs.renameSync = function (from, to) {
  const target = path.resolve(String(to));
  const inShardDir = target === shardDir || target.startsWith(shardDir + path.sep);
  if (!inShardDir) return origRename.apply(this, arguments);
  renames += 1;
  if (renames === 1) { const r = origRename.apply(this, arguments); signal('r1'); waitPeer('r1'); return r; }
  if (renames === 2) { signal('r2'); waitPeer('r2'); return origRename.apply(this, arguments); }
  return origRename.apply(this, arguments);
};
`;

function spawnWorker({ root, id, peer, endpoints, candidate, stateFile, shardDir, barrier, useHook }) {
  const env = {
    ...process.env,
    W03_DIST: DIST,
    W03_STATE_FILE: stateFile,
    W03_CANDIDATE: String(candidate),
    W03_EP_A: endpoints[0],
    W03_EP_B: endpoints[1],
    W03_WORKER_ID: id,
    W03_PEER_ID: peer,
    W03_SHARD_DIR: shardDir,
    W03_BARRIER_DIR: barrier,
    W03_BARRIER_TIMEOUT_MS: String(BARRIER_TIMEOUT_MS),
  };
  const args = useHook ? ['--require', join(root, 'hook.cjs'), WORKER] : [WORKER];
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    const timer = setTimeout(() => child.kill(), WORKER_TIMEOUT_MS);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      let parsed;
      try { parsed = JSON.parse(out.trim().split('\n').pop() ?? ''); } catch { parsed = undefined; }
      done({ id, code, signal, result: parsed, stderr: err.trim().slice(0, 400) });
    });
  });
}

function readHandles(shardDir, handle) {
  const found = [];
  if (!existsSync(shardDir)) return found;
  for (const name of readdirSync(shardDir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const shard = JSON.parse(readFileSync(join(shardDir, name), 'utf8'));
      for (const [key, ref] of Object.entries(shard.handles ?? {})) {
        if (key === handle) found.push({ shard: name.slice(0, 8), refPrefix: String(ref).slice(0, 24) + '…' });
      }
    } catch { /* ignore malformed temp leftovers */ }
  }
  return found;
}

async function resolveOutcome(stateFile, handle) {
  const { resolveHandle } = await import(pathToFileURL(join(DIST, 'conversations.js')).href);
  try { return { resolved: true, refPrefix: resolveHandle(stateFile, handle).slice(0, 24) + '…' }; }
  catch (error) { return { resolved: false, code: error?.code ?? 'UNKNOWN', message: String(error?.message ?? error).slice(0, 300) }; }
}

async function runScenario({ concurrent }) {
  const root = mkdtempSync(join(tmpdir(), 'crosschat-w03-'));
  const barrier = join(root, 'barrier');
  const stateDir = join(root, 'state');
  mkdirSync(barrier, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  const stateFile = join(stateDir, 'conversations.json');
  const shardDir = join(stateDir, 'conversations');
  const endpointsA = ['w03-claude-a', 'w03-codex-a'];
  const endpointsB = ['w03-claude-b', 'w03-codex-b'];
  writeFileSync(join(root, 'hook.cjs'), HOOK, 'utf8');
  try {
    const workers = concurrent
      ? await Promise.all([
          spawnWorker({ root, id: 'a', peer: 'b', endpoints: endpointsA, candidate: CANDIDATE, stateFile, shardDir, barrier, useHook: true }),
          spawnWorker({ root, id: 'b', peer: 'a', endpoints: endpointsB, candidate: CANDIDATE, stateFile, shardDir, barrier, useHook: true }),
        ])
      : [await spawnWorker({ root, id: 'solo', peer: 'none', endpoints: endpointsA, candidate: CANDIDATE, stateFile, shardDir, barrier, useHook: false })];
    const handle = workers[0]?.result?.handle;
    const timeouts = readdirSync(barrier).filter((name) => name.startsWith('timeout-'));
    const duplicates = handle === undefined ? [] : readHandles(shardDir, handle);
    const resolveResult = handle === undefined ? undefined : await resolveOutcome(stateFile, handle);
    return {
      concurrent,
      workers: workers.map((w) => ({ id: w.id, exit: w.code, signal: w.signal, handle: w.result?.handle, nonce: w.result?.nonce, stderr: w.stderr || undefined })),
      returnedHandles: [...new Set(workers.map((w) => w.result?.handle).filter(Boolean))],
      sameHandleReturned: handle !== undefined && workers.every((w) => w.result?.handle === handle),
      shardEntriesForHandle: duplicates,
      resolve: resolveResult,
      barrierTimeouts: timeouts,
      tempRoot: root,
      cleaned: false,
    };
  } finally {
    if (root.startsWith(tmpdir()) && basename(root).startsWith('crosschat-w03-')) rmSync(root, { recursive: true, force: true });
  }
}

const runs = [];
for (let i = 1; i <= REPEATS; i += 1) {
  const run = await runScenario({ concurrent: true });
  runs.push({ repeat: i, ...run, cleaned: !existsSync(run.tempRoot) });
}
const control = await runScenario({ concurrent: false });
control.cleaned = !existsSync(control.tempRoot);

const evidence = {
  ticket: 'C14-W03',
  generatedAt: new Date().toISOString(),
  baseline: { head: head(), node: process.version, platform: process.platform, arch: process.arch, dist: join(DIST, 'conversations.js') },
  scenario: {
    candidate: CANDIDATE,
    repeats: REPEATS,
    barrier: 'CJS preload wraps fs.renameSync: r1 = both first shard writes visible before either scan; r2 = both retry writes withheld until both callers computed max+2',
    endpoints: 'synthetic ids (w03-claude-a/b, w03-codex-a/b); no real state or network',
  },
  concurrentRuns: runs,
  serialControl: control,
};
writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2) + '\n', 'utf8');

const dupRuns = runs.filter((r) => r.sameHandleReturned && r.shardEntriesForHandle.length > 1).length;
const collisionRuns = runs.filter((r) => r.resolve?.resolved === false).length;
console.log(JSON.stringify({
  head: evidence.baseline.head,
  concurrentRuns: runs.length,
  duplicateHandleRuns: dupRuns,
  collisionRuns,
  controlSameHandle: control.sameHandleReturned,
  controlResolve: control.resolve,
  evidence: EVIDENCE,
}, null, 2));
