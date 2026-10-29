// C14-W07 isolation probe. Uses only the built dist conversation API against
// synthetic shards in an exclusive temp root under node_modules/.cache; never
// reads or writes the real ~/.crosschat state.
// Usage: node docs/development/evidence/c14-worker-20261029/W07-probe.mjs [--out <json>]
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const { handleForRef, claimHandle, resolveHandle, recordConversation, pairKeyOf } =
  await import(new URL('../../../../dist/conversations.js', import.meta.url).href);
const { newConversationRef, nextTurnRef, encodeRef, decodeRef } =
  await import(new URL('../../../../dist/ref.js', import.meta.url).href);
const { composeEnvelope } = await import(new URL('../../../../dist/envelope.js', import.meta.url).href);

const cacheBase = join(repo, 'node_modules', '.cache');
const root = join(cacheBase, `w07-probe-${Date.now()}-${randomBytes(4).toString('hex')}`);
mkdirSync(root); // non-recursive: fails loudly if the name is taken

const claudeA = { p: 'claude', id: 'cs-1' };
const codexB = { p: 'codex', id: 't-1' };
const claudeC = { p: 'claude', id: 'cs-2' };
const codexD = { p: 'codex', id: 't-2' };
const shardFile = (file, pair) =>
  join(dirname(file), 'conversations', `${createHash('sha256').update(pair, 'utf8').digest('hex')}.json`);
const readShard = (file, pair) => JSON.parse(readFileSync(shardFile(file, pair), 'utf8'));
const writeShard = (file, pair, record) => {
  mkdirSync(dirname(shardFile(file, pair)), { recursive: true });
  writeFileSync(shardFile(file, pair), JSON.stringify({ pair, ...record }), 'utf8');
};
const caseDir = (name) => {
  const dir = join(root, name);
  mkdirSync(dir);
  return join(dir, 'conversations.json');
};
const errorOf = (fn) => {
  try { return { returned: fn() }; } catch (error) { return { code: error.code, message: error.message }; }
};
const hintOf = (input) => /<crosschat-reply-hint[^>]*>([\s\S]*?)<\/crosschat-reply-hint>/.exec(composeEnvelope(input))[1];

const pairAB = pairKeyOf(claudeA, codexB);
const pairCD = pairKeyOf(claudeC, codexD);
const results = [];

async function experiment(id, question, body) {
  try {
    const { observed, pass, notes } = await body();
    results.push({ id, question, pass, observed, ...(notes === undefined ? {} : { notes }) });
  } catch (error) {
    results.push({ id, question, pass: false, observed: { error: String(error?.stack ?? error) } });
  }
}

/** Historical cross-shard collision: c14 bound to two different nonces. The
 *  current allocator cannot produce it any more, so the two shards are written
 *  directly; everything exercised afterwards goes through the real API. */
async function collisionState(name) {
  const file = caseDir(name);
  const a = newConversationRef(claudeA, codexB);
  const b = newConversationRef(claudeC, codexD);
  await recordConversation(file, a, 1_000);
  await recordConversation(file, b, 1_001);
  writeShard(file, pairAB, { ref: encodeRef(a), updatedAt: 1_000, handles: { c14: encodeRef(a) } });
  writeShard(file, pairCD, { ref: encodeRef(b), updatedAt: 1_001, handles: { c14: encodeRef(b) } });
  return { file, a, b };
}

await experiment('E1', 'Does a historical cross-shard c14 collision leave handleForRef without a hint, and does the envelope fall back to the full ref?', async () => {
  const { file, a } = await collisionState('e1');
  const ref = nextTurnRef(a);
  const hint = await handleForRef(file, ref);
  const sender = { fromName: 'claude', fromTool: 'claude', replyTool: 'codex-cli', toName: 'codex', turn: ref.c, ref: encodeRef(ref), body: 'x' };
  const fallback = hintOf({ ...sender, ...(hint === undefined ? {} : { handle: hint }) });
  const short = hintOf({ ...sender, handle: 'c15' });
  const pass = hint === undefined && fallback.includes('--conversation mc2_') && !short.includes('mc2_') && short.includes('--conversation c15');
  return { observed: { handleForRef: hint ?? null, fallbackHint: fallback, shortHintForComparison: short }, pass };
});

await experiment('E2', 'Is the colliding number still rejected at consumption time, listing both candidates?', async () => {
  const { file, a, b } = await collisionState('e2');
  const resolved = errorOf(() => resolveHandle(file, 'c14'));
  const pass = resolved.code === 'INVALID_CONVERSATION_REF'
    && resolved.message.includes('撞号') && resolved.message.includes(encodeRef(a)) && resolved.message.includes(encodeRef(b));
  return { observed: { code: resolved.code, message: resolved.message }, pass };
});

await experiment('E3', 'Counterexample to "just claim a new handle": does claimHandle(file, ref, 15) drop the same-nonce c14 and make the foreign c14 suddenly unique?', async () => {
  const { file, a, b } = await collisionState('e3');
  const ref = nextTurnRef(a);
  const before = { shardA: readShard(file, pairAB), foreignBytes: readFileSync(shardFile(file, pairCD), 'utf8') };
  const claimed = await claimHandle(file, ref, 15);
  const after = readShard(file, pairAB);
  const foreignAfter = readFileSync(shardFile(file, pairCD), 'utf8');
  const c14 = errorOf(() => resolveHandle(file, 'c14'));
  const c15 = errorOf(() => resolveHandle(file, claimed));
  return {
    observed: {
      claimed,
      shardAHandlesBefore: before.shardA.handles,
      shardAHandlesAfter: after.handles,
      shardALineUnchanged: after.ref === before.shardA.ref && after.updatedAt === before.shardA.updatedAt,
      foreignShardBytesUnchanged: foreignAfter === before.foreignBytes,
      c14AfterRecovery: c14.returned === undefined ? { code: c14.code, message: c14.message } : { resolvesToNonce: decodeRef(c14.returned).n, isForeign: decodeRef(c14.returned).n === b.n },
      c15ResolvesToOurs: c15.returned !== undefined && decodeRef(c15.returned).n === a.n,
    },
    // The hazard is confirmed when c14 silently turns into the foreign conversation.
    pass: after.handles?.c14 === undefined && c14.returned !== undefined && decodeRef(c14.returned).n === b.n,
  };
});

await experiment('E4', 'Would keeping both handles survive normal accounting? Does recordConversation collapse same-nonce aliases to the last one?', async () => {
  const file = caseDir('e4');
  const a = newConversationRef(claudeA, codexB);
  const b = newConversationRef(claudeC, codexD);
  writeShard(file, pairAB, { ref: encodeRef(a), updatedAt: 1_000, handles: { c14: encodeRef(a), c15: encodeRef(a) } });
  writeShard(file, pairCD, { ref: encodeRef(b), updatedAt: 1_001, handles: { c14: encodeRef(b) } });
  const advanced = nextTurnRef(a);
  await recordConversation(file, advanced, 2_000);
  const after = readShard(file, pairAB);
  const c14 = errorOf(() => resolveHandle(file, 'c14'));
  return {
    observed: {
      handlesBefore: { c14: encodeRef(a), c15: encodeRef(a) },
      handlesAfter: after.handles,
      c14AfterRefresh: c14.returned === undefined ? { code: c14.code, message: c14.message } : { resolvesToForeign: decodeRef(c14.returned).n === b.n },
    },
    // Confirms the alias collapses to the last-inserted handle and the flip follows.
    pass: after.handles?.c14 === undefined && after.handles?.c15 === encodeRef(advanced) && c14.returned !== undefined && decodeRef(c14.returned).n === b.n,
  };
});

await experiment('E5', 'Is a failed allocation write atomic — old c14 copy intact, no ghost handle, no scratch?', async () => {
  const { file, a } = await collisionState('e5');
  const shard = shardFile(file, pairAB);
  const bytesBefore = readFileSync(shard, 'utf8');
  chmodSync(shard, 0o444); // Windows: rename over a read-only target fails
  const claimed = await claimHandle(file, nextTurnRef(a), 15).then((value) => ({ value }), (error) => ({ code: error.code, message: error.message }));
  chmodSync(shard, 0o666);
  const bytesAfter = readFileSync(shard, 'utf8');
  const scratch = readdirSync(dirname(shard)).filter((name) => name.endsWith('.tmp'));
  const c14 = errorOf(() => resolveHandle(file, 'c14'));
  return {
    observed: {
      claimOutcome: claimed,
      shardBytesUnchanged: bytesAfter === bytesBefore,
      handlesAfter: JSON.parse(bytesAfter).handles,
      c14StillColliding: c14.code === 'INVALID_CONVERSATION_REF' && c14.message.includes('撞号'),
      scratchLeftovers: scratch,
    },
    pass: claimed.code === 'CONVERSATION_STATE_WRITE_FAILED' && bytesAfter === bytesBefore && scratch.length === 0
      && c14.code === 'INVALID_CONVERSATION_REF',
  };
});

// Cleanup: only this run's own directory, under the verified cache parent.
const cleanup = { root, underCache: resolve(root).startsWith(resolve(cacheBase) + '\\'), removed: false };
if (cleanup.underCache && existsSync(root)) {
  rmSync(root, { recursive: true, force: true });
  cleanup.removed = !existsSync(root);
}

const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  repoRelativeDist: ['dist/conversations.js', 'dist/ref.js', 'dist/envelope.js'],
  experiments: results,
  cleanup,
};
const outIndex = process.argv.indexOf('--out');
const text = JSON.stringify(report, null, 2);
if (outIndex !== -1 && process.argv[outIndex + 1] !== undefined) writeFileSync(process.argv[outIndex + 1], text + '\n', 'utf8');
console.log(text);
if (results.some((entry) => entry.pass !== true) || !cleanup.removed) process.exitCode = 1;
