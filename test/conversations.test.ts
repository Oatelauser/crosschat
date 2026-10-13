import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  claimHandle,
  continueConversation,
  continueFromRef,
  handleForRef,
  machineNameOfPair,
  pairKeyOf,
  recordConversation,
  resolveHandle,
} from '../src/conversations.js';
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

describe('conversation short handles (F2)', () => {
  it('reuses one handle per nonce and allocates machine-wide max+1 for a new nonce', () => {
    const file = freshFile();
    const base = newConversationRef(claudeA, codexB);
    expect(handleForRef(file, base)).toBe('c1');
    expect(handleForRef(file, nextTurnRef(base))).toBe('c1'); // same conversation, next turn: same handle
    expect(handleForRef(file, newConversationRef(claudeC, codexD))).toBe('c2'); // new nonce anywhere: max+1
    expect(handleForRef(file, newConversationRef(claudeA, codexB))).toBe('c3'); // same shard, new nonce
  });

  it('refreshes the handle ref as the conversation advances (rides recordConversation)', () => {
    const file = freshFile();
    const base = newConversationRef(claudeA, codexB);
    const handle = handleForRef(file, base);
    const advanced = nextTurnRef(nextTurnRef(base));
    recordConversation(file, advanced, 2_000);
    const shard = JSON.parse(readFileSync(shardPath(file, pairKeyOf(claudeA, codexB)), 'utf8')) as { ref: string; handles: Record<string, string> };
    expect(shard.ref).toBe(encodeRef(advanced));
    expect(shard.handles[handle]).toBe(encodeRef(advanced)); // 柄指向最新轮的 ref
    expect(resolveHandle(file, handle)).toBe(encodeRef(advanced));
  });

  it('CAS: a raced max+1 claim rewrites once and both conversations stay uniquely resolvable', () => {
    const file = freshFile();
    const a = newConversationRef(claudeA, codexB);
    const b = newConversationRef(claudeC, codexD);
    const winner = handleForRef(file, a); // c1
    // The loser scanned max=0 before the winner's write landed -> claims c1 too.
    const loser = claimHandle(file, b, 1);
    expect(loser).not.toBe(winner);
    expect(loser).toBe('c3'); // rewrite at rescan-max(1) + 2
    expect(resolveHandle(file, winner)).toBe(encodeRef(a));
    expect(resolveHandle(file, loser)).toBe(encodeRef(b));
  });

  it('caps a shard at 8 handles, evicting the least recently touched', () => {
    const file = freshFile();
    const handles: string[] = [];
    for (let i = 0; i < 9; i++) {
      const ref = newConversationRef(claudeA, codexB);
      handles.push(handleForRef(file, ref));
      recordConversation(file, ref, 1_000 + i); // touch: pushes the handle to the LRU tail
    }
    expect(handles).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9']);
    expect(() => resolveHandle(file, 'c1')).toThrow(/c1 已过期或未知/); // evicted with the 9th
    for (const handle of handles.slice(1)) expect(resolveHandle(file, handle)).toMatch(/^mc2_/);
    const shard = JSON.parse(readFileSync(shardPath(file, pairKeyOf(claudeA, codexB)), 'utf8')) as { handles: Record<string, string> };
    expect(Object.keys(shard.handles)).toEqual(['c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9']);
  });

  it('resolveHandle: unknown handle teaches --to; a forged collision lists candidates', () => {
    expect(() => resolveHandle(freshFile(), 'c7')).toThrow(/c7 已过期或未知——用 --to <名> 接续或开新对话/);
    expect(() => resolveHandle(undefined, 'c7')).toThrow(/已过期或未知/);
    const file = freshFile();
    handleForRef(file, newConversationRef(claudeA, codexB)); // c1 lives in pair A/B's shard
    const imposter = encodeRef(newConversationRef(claudeC, codexD));
    writeFileSync(
      shardPath(file, pairKeyOf(claudeC, codexD)),
      JSON.stringify({ pair: pairKeyOf(claudeC, codexD), ref: imposter, updatedAt: 1, handles: { c1: imposter } }),
      'utf8',
    );
    expect(() => resolveHandle(file, 'c1')).toThrow(/c1 撞号指向多个对话：mc2_.*mc2_.*--to <名>/);
  });

  it('an allocation write never advances the shard conversation line (failed sends leave --to untouched)', () => {
    const file = freshFile();
    const line = newConversationRef(claudeA, codexB);
    recordConversation(file, line, 5_000);
    // A later send to the same pair allocates a handle for a NEW conversation, then fails delivery.
    handleForRef(file, newConversationRef(claudeA, codexB));
    const shard = JSON.parse(readFileSync(shardPath(file, pairKeyOf(claudeA, codexB)), 'utf8')) as { ref: string; updatedAt: number };
    expect(shard.ref).toBe(encodeRef(line)); // pair line verbatim
    expect(shard.updatedAt).toBe(5_000);
    expect(continueConversation(file, claudeA, codexB).turn).toBe(2); // continues the recorded line, not the failed one
  });
});

describe('016① machines 字段（跨机回执机器标识持久化，additive）', () => {
  const peerMid8 = 'ec542c2c'; // win 带杠 MachineGuid 'ec542c2c-…' 归一后的 8 hex 前缀

  it('recordConversation 写入 mid8→名 并按对话查询命中', () => {
    const file = freshFile();
    const ref = newConversationRef(claudeA, codexB);
    recordConversation(file, ref, 1_000, { [peerMid8]: 'cloudleg' });
    expect(machineNameOfPair(file, ref, peerMid8)).toBe('cloudleg');
    expect(machineNameOfPair(file, ref, 'deadbeef')).toBeUndefined();
    expect(machineNameOfPair(undefined, ref, peerMid8)).toBeUndefined();
  });

  it('后续写合并不丢既有机器条目；不含 machines 的写保留旧表', () => {
    const file = freshFile();
    const ref = newConversationRef(claudeA, codexB);
    recordConversation(file, ref, 1_000, { [peerMid8]: 'cloudleg' });
    recordConversation(file, nextTurnRef(ref), 2_000, { '9999dead': 'wsl-leg' });
    expect(machineNameOfPair(file, ref, peerMid8)).toBe('cloudleg');
    expect(machineNameOfPair(file, ref, '9999dead')).toBe('wsl-leg');
    recordConversation(file, nextTurnRef(nextTurnRef(ref)), 3_000); // 本地轮次不带新条目
    expect(machineNameOfPair(file, ref, peerMid8)).toBe('cloudleg');
  });

  it('017 改名自愈：机器改名后同 mid8 新信封经 machines merge 覆盖旧名（{...existing, ...machines}）', () => {
    const file = freshFile();
    const ref = newConversationRef(claudeA, codexB);
    recordConversation(file, ref, 1_000, { [peerMid8]: 'old-name' });
    expect(machineNameOfPair(file, ref, peerMid8)).toBe('old-name');
    // 对端改名（showName/自报名）后新信封到达：同 mid8、新 from-machine 名——merge 后者胜
    recordConversation(file, nextTurnRef(ref), 2_000, { [peerMid8]: 'new-name' });
    expect(machineNameOfPair(file, ref, peerMid8)).toBe('new-name');
  });

  it('新版读旧状态（无 machines 字段）：查询 undefined，接续行为不变', () => {
    const file = freshFile();
    const ref = newConversationRef(claudeA, codexB);
    recordConversation(file, ref, 1_000); // 旧版写法：无 machines
    expect(machineNameOfPair(file, ref, peerMid8)).toBeUndefined();
    expect(continueConversation(file, claudeA, codexB).turn).toBe(2);
  });

  it('旧版安全忽略新字段：新写分片仍满足旧版解析契约（四字段健全，machines 为额外键）', () => {
    const file = freshFile();
    const ref = newConversationRef(claudeA, codexB);
    recordConversation(file, ref, 1_000, { [peerMid8]: 'cloudleg' });
    const raw = JSON.parse(readFileSync(shardPath(file, pairKeyOf(ref.f, ref.t)), 'utf8')) as Record<string, unknown>;
    // 旧版 parseShard 只认 pair/ref/updatedAt(/handles)；machines 对它是未知键——四字段健全即安全忽略
    expect(typeof raw.pair).toBe('string');
    expect(typeof raw.ref).toBe('string');
    expect(typeof raw.updatedAt).toBe('number');
    expect(raw.machines).toEqual({ [peerMid8]: 'cloudleg' });
  });

  it('形状防守：machines 里非字符串值被丢弃', () => {
    const file = freshFile();
    const ref = newConversationRef(claudeA, codexB);
    const shard = shardPath(file, pairKeyOf(ref.f, ref.t));
    mkdirSync(dirname(shard), { recursive: true });
    writeFileSync(
      shard,
      JSON.stringify({ pair: pairKeyOf(ref.f, ref.t), ref: encodeRef(ref), updatedAt: 1, machines: { ok: 'x', bad: 3 } }),
      'utf8',
    );
    expect(machineNameOfPair(file, ref, 'ok')).toBe('x');
    expect(machineNameOfPair(file, ref, 'bad')).toBeUndefined();
  });
});
