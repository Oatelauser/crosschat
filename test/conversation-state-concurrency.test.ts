import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sendMessage } from '../src/application/send/index.js';
import type { SendDeps } from '../src/application/send/types.js';
import {
  continueFromRef, handleForRef, loadAllPairs, pairKeyOf, recordConversation, resolveHandle,
} from '../src/conversations.js';
import { encodeRef, newConversationRef, nextTurnRef } from '../src/ref.js';
import type { ConversationRef, RefEndpoint } from '../src/ref.js';

const ALLOCATE = fileURLToPath(new URL('helpers/conversation-state-allocate.mjs', import.meta.url));
const HOLDER = fileURLToPath(new URL('helpers/conversation-state-holder.mjs', import.meta.url));

const claudeA: RefEndpoint = { p: 'claude', id: 'alpha', endpointType: 'cli' };
const codexB: RefEndpoint = { p: 'codex', id: 'beta', endpointType: 'cli' };
const claudeC: RefEndpoint = { p: 'claude', id: 'gamma', endpointType: 'cli' };
const codexD: RefEndpoint = { p: 'codex', id: 'delta', endpointType: 'cli' };

const roots: string[] = [];
const active = new Set<ReturnType<typeof spawn>>();
afterAll(async () => {
  for (const child of active) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  // Bounded wait for pipes to drain before any directory the child writes to is removed.
  await Promise.all([...active].map((child) => Promise.race([
    new Promise<void>((resolve) => { if (child.closed) resolve(); else child.once('close', () => resolve()); }),
    delay(5_000),
  ])));
  for (const root of roots.splice(0)) {
    // Recursive delete only for a root this file created: direct child of tmpdir with our prefix.
    if (dirname(root) !== tmpdir() || !basename(root).startsWith('crosschat-conv-lock-')) {
      throw new Error(`Refusing to delete a foreign root: ${root}`);
    }
    rmSync(root, { recursive: true, force: true });
  }
});

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'crosschat-conv-lock-'));
  roots.push(root);
  return root;
}

const shardPath = (file: string, pair: string): string =>
  join(dirname(file), 'conversations', `${createHash('sha256').update(pair, 'utf8').digest('hex')}.json`);

async function waitForFile(path: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${path}`);
    await delay(5);
  }
}

const CHILD_TIMEOUT_MS = 30_000;
const CHILD_OUTPUT_LIMIT = 64 * 1024;
interface ChildRun { code: number | null; stdout: string; stderr: string }
function runChild(script: string, args: string[], nodeArgs: string[] = [], env: Record<string, string> = {}): Promise<ChildRun> {
  const child = spawn(process.execPath, [...nodeArgs, script, ...args], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CROSSCHAT_LIVE: undefined, ...env },
  });
  active.add(child);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => { if (stdout.length < CHILD_OUTPUT_LIMIT) stdout += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < CHILD_OUTPUT_LIMIT) stderr += chunk.toString('utf8'); });
  return new Promise<ChildRun>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`child did not finish within ${CHILD_TIMEOUT_MS}ms: ${script}`));
    }, CHILD_TIMEOUT_MS);
    const done = () => { clearTimeout(timer); active.delete(child); };
    child.on('error', (error) => { done(); reject(error); });
    // close, not exit: the pipes are drained, so stdout is complete.
    child.on('close', (code) => { const run = { code, stdout, stderr }; done(); resolve(run); });
  });
}

function parseLine<T>(run: ChildRun): T {
  const line = run.stdout.trim().split('\n').filter(Boolean).at(-1);
  if (line === undefined) throw new Error(`child printed no result (exit ${run.code}): ${run.stderr}`);
  return JSON.parse(line) as T;
}

/** The preload blocks the holder's first shard rename until release (bounded). */
function writeHolderHook(root: string): string {
  const hook = join(root, 'rename-hook.cjs');
  writeFileSync(hook, `const fs = require('node:fs');
const original = fs.renameSync;
let blocked = false;
fs.renameSync = function (...args) {
  if (!blocked) {
    blocked = true;
    fs.writeFileSync(process.env.HOLDER_READY, 'held');
    const wait = new Int32Array(new SharedArrayBuffer(4));
    const deadline = Date.now() + 5_000;
    while (!fs.existsSync(process.env.HOLDER_RELEASE) && Date.now() < deadline) Atomics.wait(wait, 0, 0, 5);
  }
  return original.apply(fs, args);
};
`, 'utf8');
  return hook;
}

function sendDeps(root: string, file: string): SendDeps {
  return {
    env: { CODEX_THREAD_ID: 'delta' },
    listClaudeSessions: () => ({ sessions: [{ pid: 1, sessionId: 'peer', kind: 'interactive', name: 'Peer', status: 'idle', messagingSocketPath: 'isolated-fake-socket' }], malformed: 0 }),
    listCodexThreads: async () => [],
    deliverClaude: vi.fn(async () => ({ status: 'delivered' as const })),
    deliverCodex: vi.fn(async () => ({ status: 'accepted' as const, turnId: 'isolated-fake-turn' })),
    sendLogFile: join(root, 'send.jsonl'), outboxDir: join(root, 'outbox'), now: () => 100,
    conversationStateFile: file,
  };
}

describe('conversation state cross-process writes', () => {
  it('independent processes allocating at once never share a handle and each resolves to its own ref', async () => {
    const root = freshRoot();
    const file = join(root, 'conversations.json');
    // Two allocators share one pair (distinct nonces); the rest take their own pairs.
    const refs: ConversationRef[] = [
      newConversationRef(claudeA, codexB),
      newConversationRef(claudeA, codexB),
      newConversationRef(claudeC, codexD),
      newConversationRef(claudeA, codexD),
      newConversationRef(claudeC, codexB),
      newConversationRef(claudeA, codexB),
    ];
    const go = join(root, 'go');
    const runs = refs.map((ref, index) => runChild(ALLOCATE, [
      file, JSON.stringify(ref), join(root, `ready-${index}`), go,
    ]));
    for (let index = 0; index < refs.length; index++) await waitForFile(join(root, `ready-${index}`));
    writeFileSync(go, 'go');

    const outcomes = await Promise.all(runs);
    const results = outcomes.map((run) => {
      expect(run.code, run.stderr).toBe(0);
      return parseLine<{ handle: string; resolve: { ok: boolean; ref?: string } }>(run);
    });
    const handles = results.map((result) => result.handle);
    expect(new Set(handles).size).toBe(refs.length);
    results.forEach((result, index) => {
      expect(result.resolve).toEqual({ ok: true, ref: encodeRef(refs[index]!) });
      expect(resolveHandle(file, result.handle)).toBe(encodeRef(refs[index]!));
    });
    const pairs = loadAllPairs(file);
    expect(Object.values(pairs).flatMap((record) => Object.keys(record.handles ?? {}))).toHaveLength(refs.length);
  }, 60_000);

  it('concurrent processes reusing one nonce all get its single handle', async () => {
    const root = freshRoot();
    const file = join(root, 'conversations.json');
    const ref = newConversationRef(claudeA, codexB);
    const go = join(root, 'go');
    const runs = [0, 1, 2].map((index) => runChild(ALLOCATE, [
      file, JSON.stringify(ref), join(root, `ready-${index}`), go,
    ]));
    for (let index = 0; index < 3; index++) await waitForFile(join(root, `ready-${index}`));
    writeFileSync(go, 'go');

    const outcomes = await Promise.all(runs);
    const results = outcomes.map((run) => {
      expect(run.code, run.stderr).toBe(0);
      return parseLine<{ handle: string; resolve: { ok: boolean; ref?: string } }>(run);
    });
    expect(new Set(results.map((result) => result.handle)).size).toBe(1);
    for (const result of results) expect(result.resolve).toEqual({ ok: true, ref: encodeRef(ref) });
    expect(resolveHandle(file, results[0]!.handle)).toBe(encodeRef(ref));
  }, 60_000);

  it('a live writer on an aliased path blocks every other write path until it releases', async () => {
    const root = freshRoot();
    const stateDir = join(root, 'state');
    mkdirSync(stateDir, { recursive: true });
    const alias = join(root, 'alias');
    symlinkSync(stateDir, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const file = join(stateDir, 'conversations.json');
    const recorded = newConversationRef(claudeC, codexD);
    await recordConversation(file, recorded, 1_000);
    const recordedHandle = await handleForRef(file, recorded);

    const holderRef = newConversationRef(claudeA, codexB);
    const ready = join(root, 'held');
    const release = join(root, 'release');
    const hook = writeHolderHook(root);
    const held = runChild(HOLDER, [join(alias, 'conversations.json'), JSON.stringify(holderRef)],
      ['--require', hook], { HOLDER_READY: ready, HOLDER_RELEASE: release });
    try {
      await waitForFile(ready);
      // Inside the holder's critical section, before its shard rename: nothing it will write exists yet.
      expect(existsSync(shardPath(file, pairKeyOf(holderRef.f, holderRef.t)))).toBe(false);
      // Read-only queries never take the write lock.
      expect(resolveHandle(file, recordedHandle)).toBe(encodeRef(recorded));

      const other = newConversationRef(claudeA, codexD);
      const busy = await Promise.allSettled([handleForRef(file, other), continueFromRef(file, other)]);
      expect(busy.map((outcome) => outcome.status === 'rejected' ? outcome.reason.code : 'resolved'))
        .toEqual(['CONVERSATION_STATE_BUSY', 'CONVERSATION_STATE_BUSY']);
      // Post-delivery accounting stays best-effort: a busy lock must not reject.
      await expect(recordConversation(file, other, 2_000)).resolves.toBeUndefined();
      expect(existsSync(shardPath(file, pairKeyOf(other.f, other.t)))).toBe(false);
    } finally {
      writeFileSync(release, 'release');
    }

    const run = await held;
    expect(run.code, run.stderr).toBe(0);
    const heldResult = parseLine<{ handle: string }>(run);
    expect(resolveHandle(file, heldResult.handle)).toBe(encodeRef(holderRef));
    // The released lock is usable again: the pair the busy writer skipped now allocates.
    const retry = newConversationRef(claudeA, codexD);
    await expect(handleForRef(file, retry)).resolves.toMatch(/^c\d+$/);
  }, 60_000);

  it('a send that cannot take the lock delivers nothing, then succeeds once released', async () => {
    const root = freshRoot();
    const file = join(root, 'conversations.json');
    const deps = sendDeps(root, file);
    const holderRef = newConversationRef(claudeA, codexB);
    const ready = join(root, 'held');
    const release = join(root, 'release');
    const hook = writeHolderHook(root);
    const held = runChild(HOLDER, [file, JSON.stringify(holderRef)], ['--require', hook],
      { HOLDER_READY: ready, HOLDER_RELEASE: release });
    const target: RefEndpoint = { p: 'claude', id: 'peer', endpointType: 'cli' };
    const blocked = newConversationRef({ p: 'codex', id: 'delta' }, target);
    try {
      await waitForFile(ready);
      // Pre-lock failure is a structured rejection with zero native delivery.
      await expect(sendMessage({ tool: 'claude', conversation: encodeRef(blocked), bodyArg: 'locked out' }, deps))
        .rejects.toMatchObject({ code: 'CONVERSATION_STATE_BUSY' });
      expect(deps.deliverClaude).not.toHaveBeenCalled();
    } finally {
      writeFileSync(release, 'release');
    }
    expect((await held).code).toBe(0);

    const sent = await sendMessage({ tool: 'claude', conversation: encodeRef(blocked), bodyArg: 'lock free again' }, deps);
    expect(sent.status).toBe('delivered');
    expect(deps.deliverClaude).toHaveBeenCalledTimes(1);
  }, 60_000);

  it('a stuck holder still exits within its barrier deadline', async () => {
    const root = freshRoot();
    const file = join(root, 'conversations.json');
    const holderRef = newConversationRef(claudeA, codexB);
    const ready = join(root, 'held');
    const release = join(root, 'never-written');
    const hook = writeHolderHook(root);
    const held = runChild(HOLDER, [file, JSON.stringify(holderRef)], ['--require', hook],
      { HOLDER_READY: ready, HOLDER_RELEASE: release });

    await waitForFile(ready);
    // No release is ever written: the hook's own deadline must end the hold.
    const run = await held;
    expect(run.code, run.stderr).toBe(0);
    const heldResult = parseLine<{ handle: string }>(run);
    expect(resolveHandle(file, heldResult.handle)).toBe(encodeRef(holderRef));
  }, 60_000);

  it('a child that cannot load its script settles instead of hanging', async () => {
    const run = await runChild(join(freshRoot(), 'missing-child.mjs'), []);
    expect(run.code).not.toBe(0);
    expect(run.stderr).not.toBe('');
  }, 60_000);

  it('allocation and accounting on one pair keep both handles', async () => {
    const file = join(freshRoot(), 'conversations.json');
    const first = newConversationRef(claudeA, codexB);
    const second = newConversationRef(claudeA, codexB);
    const firstHandle = await handleForRef(file, first);
    const secondHandle = await handleForRef(file, second);
    expect(secondHandle).not.toBe(firstHandle);

    await recordConversation(file, nextTurnRef(second), 2_000);
    await Promise.all([recordConversation(file, nextTurnRef(first), 3_000), handleForRef(file, second)]);
    const shard = loadAllPairs(file)[pairKeyOf(first.f, first.t)]!;
    expect(new Set(Object.keys(shard.handles ?? {}))).toEqual(new Set([firstHandle, secondHandle]));
    expect(resolveHandle(file, firstHandle!)).toBe(encodeRef(nextTurnRef(first)));
    expect(resolveHandle(file, secondHandle!)).toBe(encodeRef(nextTurnRef(second)));
  }, 30_000);

  it('an existing handle collision never becomes a hint and never blocks the full ref', async () => {
    const file = join(freshRoot(), 'conversations.json');
    const mine = newConversationRef(claudeA, codexB);
    const foreign = newConversationRef(claudeC, codexD);
    for (const ref of [mine, foreign]) {
      const pair = pairKeyOf(ref.f, ref.t);
      mkdirSync(dirname(shardPath(file, pair)), { recursive: true });
      writeFileSync(shardPath(file, pair), JSON.stringify({ pair, ref: encodeRef(ref), updatedAt: 1, handles: { c1: encodeRef(ref) } }), 'utf8');
    }
    const mineShard = shardPath(file, pairKeyOf(mine.f, mine.t));
    const foreignShard = shardPath(file, pairKeyOf(foreign.f, foreign.t));
    const foreignBefore = readFileSync(foreignShard, 'utf8');
    const mineBefore = readFileSync(mineShard, 'utf8');

    // The full ref the caller passed still sends — without an ambiguous hint.
    await expect(handleForRef(file, mine)).resolves.toBeUndefined();
    // The colliding short handle still fails explicitly, and nothing was rewritten
    // to pick a winner: both shards stay byte-identical.
    expect(() => resolveHandle(file, 'c1')).toThrow(/撞号/);
    expect(readFileSync(foreignShard, 'utf8')).toBe(foreignBefore);
    expect(readFileSync(mineShard, 'utf8')).toBe(mineBefore);
  }, 30_000);

  it('a failed allocation write returns no ghost handle and leaves no scratch', async () => {
    const file = join(freshRoot(), 'conversations.json');
    const ref = newConversationRef(claudeA, codexB);
    const pair = pairKeyOf(ref.f, ref.t);
    mkdirSync(shardPath(file, pair), { recursive: true }); // a directory where the shard file must go
    await expect(handleForRef(file, ref)).rejects.toMatchObject({ code: 'CONVERSATION_STATE_WRITE_FAILED' });
    expect(loadAllPairs(file)[pair]?.handles).toBeUndefined();
    expect(() => resolveHandle(file, 'c1')).toThrow(/已过期或未知/); // no handle survived the failed write
    // The failed rename must not leave this write's tmp scratch behind.
    expect(readdirSync(dirname(shardPath(file, pair))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  }, 30_000);

  it('post-delivery accounting never rejects when the shard cannot be written', async () => {
    const file = join(freshRoot(), 'conversations.json');
    const ref = newConversationRef(claudeA, codexB);
    mkdirSync(shardPath(file, pairKeyOf(ref.f, ref.t)), { recursive: true });
    await expect(recordConversation(file, ref, 1_000)).resolves.toBeUndefined();
    // No scratch survives the swallowed write failure either.
    expect(readdirSync(dirname(shardPath(file, pairKeyOf(ref.f, ref.t)))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  }, 30_000);
});
