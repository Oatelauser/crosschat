// Controlled reproduction of one possible path to the hosted ENOENT symptom.
// This does not establish that lock contention caused the original CI failure.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { handleForRef, pairKeyOf, recordConversation } from '../../../../../dist/conversations.js';
import { encodeRef, newConversationRef, nextTurnRef } from '../../../../../dist/ref.js';
import { withStateLock } from '../../../../../dist/state-lock.js';

const root = await mkdtemp(join(tmpdir(), 'crosschat-conversation-ci-probe-'));
const file = join(root, 'conversations.json');
const base = newConversationRef({ p: 'claude', id: 'cs-1' }, { p: 'codex', id: 't-1' });
const advanced = nextTurnRef(nextTurnRef(base));
const directory = join(dirname(file), 'conversations');
const shard = join(directory, `${createHash('sha256').update(pairKeyOf(base.f, base.t)).digest('hex')}.json`);
const report = { node: process.version, platform: process.platform, scope: 'isolated owned fixture; controlled contention only', hostedRootCauseConfirmed: false };
try {
  await mkdir(directory);
  const held = await withStateLock(directory, 'conversation-state', async () => {
    const handle = await handleForRef(file, base);
    await recordConversation(file, advanced, 2000);
    assert.equal(handle, undefined);
    let code;
    try { await readFile(shard, 'utf8'); } catch (error) { code = error.code; }
    assert.equal(code, 'ENOENT');
    return { handleUnavailable: true, missingShard: code };
  });
  assert.equal(held.acquired, true);
  report.controlledContention = held.value;
  const handle = await handleForRef(file, base);
  assert.equal(handle, 'cA000');
  await recordConversation(file, advanced, 2000);
  const stored = JSON.parse(await readFile(shard, 'utf8'));
  assert.equal(stored.ref, encodeRef(advanced));
  assert.equal(stored.handles[handle], encodeRef(advanced));
  report.afterRelease = { handle, latestRefRecorded: true, handleRefRefreshed: true };
} finally {
  await rm(root, { recursive: true });
  try { await access(root); report.fixtureRemoved = false; }
  catch (error) { if (error.code !== 'ENOENT') throw error; report.fixtureRemoved = true; }
}
assert.equal(report.fixtureRemoved, true);
console.log(JSON.stringify(report, null, 2));
