import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { continueConversation, continueFromRef, pairKeyOf, recordConversation } from '../src/conversations.js';
import { encodeRef, newConversationRef, nextTurnRef } from '../src/ref.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-conv-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const freshFile = (): string => join(mkdtempSync(join(root, 'case-')), 'conversations.json');

/** Mirror of the storage rule: <sibling conversations dir>/<sha256(pairKey)>.json. */
const shardPath = (file: string, pairKey: string): string =>
  join(
    dirname(file),
    'conversations',
    `${createHash('sha256').update(pairKey, 'utf8').digest('hex')}.json`,
  );

const claudeA = { p: 'claude', id: 'cs-1' } as const;
const codexB = { p: 'codex', id: 't-1' } as const;
const claudeC = { p: 'claude', id: 'cs-2' } as const;
const codexD = { p: 'codex', id: 't-2' } as const;

describe('pairKeyOf', () => {
  it('is order-independent', () => {
    expect(pairKeyOf(claudeA, codexB)).toBe(pairKeyOf(codexB, claudeA));
  });
});

describe('continueConversation / recordConversation', () => {
  it('starts fresh without state, then increments per recorded turn', () => {
    const file = freshFile();
    const first = continueConversation(file, claudeA, codexB);
    expect(first.turn).toBe(1);
    recordConversation(file, first.ref, 1_000);
    const second = continueConversation(file, claudeA, codexB);
    expect(second.turn).toBe(2);
    expect(second.ref.n).toBe(first.ref.n); // same conversation
    recordConversation(file, second.ref, 2_000);
    expect(continueConversation(file, claudeA, codexB).turn).toBe(3);
  });

  it('continues from either endpoint (the other party replying via --to)', () => {
    const file = freshFile();
    const first = continueConversation(file, claudeA, codexB); // claude initiated
    recordConversation(file, first.ref, 1_000);
    const reply = continueConversation(file, codexB, claudeA); // codex now sends --to
    expect(reply.turn).toBe(2);
    expect(reply.ref.f.p).toBe('claude'); // initiator order stays fixed
    expect(reply.ref.n).toBe(first.ref.n);
  });

  it('self-heals a corrupt state file as a fresh conversation', () => {
    const dir = join(root, 'corrupt');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'conversations.json');
    writeFileSync(file, 'not json', 'utf8');
    expect(continueConversation(file, claudeA, codexB).turn).toBe(1);
  });

  it('ignores a stored ref that belongs to different endpoints', () => {
    const file = freshFile();
    const other = newConversationRef(claudeA, { p: 'claude', id: 'cs-9' });
    recordConversation(file, other, 1_000);
    const got = continueConversation(file, claudeA, codexB);
    expect(got.turn).toBe(1); // no matching pair record -> fresh thread
    expect(got.ref.t.p).toBe('codex');
    expect(got.ref.n).not.toBe(other.n);
  });
});

describe('sharded storage (B20)', () => {
  it('stores each pair as its own shard file and reads it back', () => {
    const file = freshFile();
    const ref = newConversationRef(claudeA, codexB);
    recordConversation(file, ref, 1_234);
    const shard = shardPath(file, pairKeyOf(claudeA, codexB));
    expect(existsSync(shard)).toBe(true);
    expect(JSON.parse(readFileSync(shard, 'utf8'))).toEqual({
      pair: pairKeyOf(claudeA, codexB),
      ref: encodeRef(ref),
      updatedAt: 1_234,
    });
    expect(continueConversation(file, claudeA, codexB).ref.n).toBe(ref.n);
  });

  it('reads the legacy global file until a shard exists, then never touches it again', () => {
    const file = freshFile();
    const first = newConversationRef(claudeA, codexB);
    writeFileSync(
      file,
      JSON.stringify({ pairs: { [pairKeyOf(claudeA, codexB)]: { ref: encodeRef(first), updatedAt: 1_000 } } }),
      'utf8',
    );
    const legacyBytes = readFileSync(file, 'utf8');
    const second = continueConversation(file, claudeA, codexB); // no shard yet: legacy fallback
    expect(second.turn).toBe(2);
    expect(second.ref.n).toBe(first.n);
    recordConversation(file, second.ref, 2_000); // writes the shard only
    expect(readFileSync(file, 'utf8')).toBe(legacyBytes); // legacy file stays byte-identical
    expect(continueConversation(file, claudeA, codexB).turn).toBe(3); // now served by the shard
  });

  it('writing one pair leaves the other pair shard bytes unchanged', () => {
    const file = freshFile();
    recordConversation(file, newConversationRef(claudeA, codexB), 1_000);
    const shardA = shardPath(file, pairKeyOf(claudeA, codexB));
    const bytesA = readFileSync(shardA);
    recordConversation(file, newConversationRef(claudeC, codexD), 2_000);
    expect(readFileSync(shardA).equals(bytesA)).toBe(true);
    expect(existsSync(shardPath(file, pairKeyOf(claudeC, codexD)))).toBe(true);
  });

  it('self-heals a corrupt shard as a fresh conversation', () => {
    const file = freshFile();
    const shard = shardPath(file, pairKeyOf(claudeA, codexB));
    mkdirSync(dirname(shard), { recursive: true });
    writeFileSync(shard, 'not json', 'utf8');
    expect(continueConversation(file, claudeA, codexB).turn).toBe(1);
  });
});

describe('continueFromRef (B22: stale --conversation refs cannot roll back)', () => {
  it('follows the shard line when it has moved at or past the passed ref', () => {
    const file = freshFile();
    const base = newConversationRef(claudeA, codexB); // c=1
    recordConversation(file, nextTurnRef(nextTurnRef(base)), 1_000); // shard line at c=3
    const got = continueFromRef(file, nextTurnRef(base)); // stale reply base c=2
    expect(got.turn).toBe(4); // shard c + 1, not stale c + 1
    expect(got.ref.n).toBe(base.n);
    // Equal line (the normal case: replying to the latest message) is the same result.
    const exact = continueFromRef(file, nextTurnRef(nextTurnRef(base)));
    expect(exact.turn).toBe(4);
  });

  it('keeps the passed ref when it is ahead of the shard line', () => {
    const file = freshFile();
    const base = newConversationRef(claudeA, codexB);
    recordConversation(file, nextTurnRef(base), 1_000); // shard at c=2
    const passed = nextTurnRef(nextTurnRef(base)); // c=3, ahead of the shard
    const got = continueFromRef(file, passed);
    expect(got.turn).toBe(4);
    expect(got.ref.n).toBe(base.n);
  });

  it('keeps the passed ref when no record exists', () => {
    const ref = newConversationRef(claudeA, codexB);
    const got = continueFromRef(freshFile(), ref);
    expect(got.turn).toBe(2);
    expect(got.ref).toEqual(nextTurnRef(ref));
  });

  it('keeps the passed ref when the shard holds a different conversation or endpoints', () => {
    // Same pair, different conversation (nonce): the reply stays in its own thread.
    const file = freshFile();
    const passed = newConversationRef(claudeA, codexB); // c=1
    recordConversation(file, newConversationRef(claudeA, codexB), 1_000); // other nonce, c=1
    const got = continueFromRef(file, passed);
    expect(got.turn).toBe(2);
    expect(got.ref.n).toBe(passed.n);
    // Endpoint-mismatched shard content (hand-written): pass-through as well.
    const alien = newConversationRef(claudeC, codexD);
    const alienShard = shardPath(file, pairKeyOf(claudeA, codexB));
    writeFileSync(alienShard, JSON.stringify({ pair: pairKeyOf(claudeA, codexB), ref: encodeRef(alien), updatedAt: 1 }), 'utf8');
    const alienGot = continueFromRef(file, passed);
    expect(alienGot.turn).toBe(2);
    expect(alienGot.ref.n).toBe(passed.n);
  });

  it('multi-sender repeats of one old base no longer collide on the turn number', () => {
    const file = freshFile();
    const base = newConversationRef(claudeA, codexB); // c=1, the envelope everyone copies
    recordConversation(file, base, 1_000);
    // Sender X replies from the base: joins at c=2, shard advances.
    const x = continueFromRef(file, base);
    recordConversation(file, x.ref, 2_000);
    // Sender Y replies from the SAME stale base: must land on c=3, not c=2.
    const y = continueFromRef(file, base);
    expect(y.turn).toBe(3);
    expect(y.ref.n).toBe(base.n);
  });
});
