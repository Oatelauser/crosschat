import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { handleForRef, loadAllPairs, pairKeyOf, recordConversation, resolveHandle } from '../src/conversations.js';
import { encodeRef, newConversationRef, nextTurnRef } from '../src/ref.js';
import type { ConversationRef } from '../src/ref.js';
import { conversationSummaries } from '../src/conversation-summary.js';
import { executeCleanup, planCleanup } from '../src/application/cleanup/index.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-handle-ring-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const first = { p: 'claude', id: 'ring-sender', endpointType: 'cli' } as const;
const second = { p: 'codex', id: 'ring-receiver', endpointType: 'desktop' } as const;
const freshFile = () => join(mkdtempSync(join(root, 'case-')), 'conversations.json');
const shardPath = (file: string, pair: string) => join(dirname(file), 'conversations', `${createHash('sha256').update(pair).digest('hex')}.json`);
function seed(file: string, ref: ConversationRef, handle: string, handleSequence: number): string {
  const pair = pairKeyOf(ref.f, ref.t);
  const path = shardPath(file, pair);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ pair, ref: encodeRef(ref), updatedAt: 1, handles: { [handle]: encodeRef(ref) }, handleSequence }));
  return path;
}
const summaries = (file: string) => conversationSummaries({ conversationsFile: file, sendLogFile: join(dirname(file), 'send.jsonl'), outboxDir: join(dirname(file), 'outbox') });

describe('five-character conversation handle ring', () => {
  it('allocates a fixed five-character handle and reuses it across turns without adding state files', async () => {
    const file = freshFile();
    const ref = newConversationRef(first, second);
    expect(await handleForRef(file, ref)).toBe('cA000');
    await recordConversation(file, nextTurnRef(ref), 123);
    expect(await handleForRef(file, nextTurnRef(ref))).toBe('cA000');
    expect(resolveHandle(file, 'cA000')).toBe(encodeRef(nextTurnRef(ref)));
    expect(readdirSync(dirname(file))).toEqual(['conversations']);
    expect(readdirSync(join(dirname(file), 'conversations'))).toHaveLength(1);
  });

  it('keeps allocation progress after eight-slot eviction and accounting when rereading stored state', async () => {
    const file = freshFile();
    for (let i = 0; i < 9; i++) {
      const ref = newConversationRef(first, second);
      await handleForRef(file, ref);
      await recordConversation(file, ref, i);
    }
    const record = loadAllPairs(file)[pairKeyOf(first, second)]!;
    expect(Object.keys(record.handles ?? {})).toHaveLength(8);
    expect(JSON.parse(readFileSync(shardPath(file, pairKeyOf(first, second)), 'utf8')).handleSequence).toBe(9);
    expect(() => resolveHandle(file, 'cA000')).toThrow(/过期或未知/);
    expect(await handleForRef(file, newConversationRef(first, second))).toBe('cA009');
  });

  it('rejects old numeric handles even when a legacy binding is present', () => {
    const file = freshFile();
    const ref = newConversationRef(first, second);
    const path = shardPath(file, pairKeyOf(first, second));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ pair: pairKeyOf(first, second), ref: encodeRef(ref), updatedAt: 1, handles: { c14: encodeRef(ref) } }));
    expect(() => resolveHandle(file, 'c14')).toThrow(/旧.*短柄.*停用/);
  });

  it('wraps a slot into its next generation and expires the old token while its original shard remains', async () => {
    const file = freshFile();
    const old = newConversationRef(first, second);
    const previous = newConversationRef(first, { ...second, id: 'previous' });
    const next = newConversationRef(first, { ...second, id: 'next' });
    const oldPath = seed(file, old, 'cA000', 1);
    seed(file, previous, 'cA999', 1000);
    const oldBytes = readFileSync(oldPath);
    expect(resolveHandle(file, 'cA000')).toBe(encodeRef(old));
    expect(await handleForRef(file, next)).toBe('cB000');
    expect(resolveHandle(file, 'cB000')).toBe(encodeRef(next));
    expect(resolveHandle(file, 'cA999')).toBe(encodeRef(previous));
    expect(() => resolveHandle(file, 'cA000')).toThrow(/过期或未知/);
    expect(readFileSync(oldPath)).toEqual(oldBytes);
    expect(await handleForRef(file, old)).toBe('cB001');
  });

  it('stops after cZ999, preserves reusable current handles, and does not rewrite state on exhaustion', async () => {
    const file = freshFile();
    const ref = newConversationRef(first, second);
    const path = seed(file, ref, 'cZ999', 26000);
    const before = readFileSync(path);
    expect(await handleForRef(file, nextTurnRef(ref))).toBe('cZ999');
    expect(await handleForRef(file, newConversationRef(first, second))).toBeUndefined();
    expect(readFileSync(path)).toEqual(before);
    expect(resolveHandle(file, 'cZ999')).toBe(encodeRef(ref));
  });

  it('does not allocate or overwrite numbering state when a shard is corrupt', async () => {
    const file = freshFile();
    const ref = newConversationRef(first, second);
    const path = seed(file, ref, 'cA014', 15);
    const broken = join(dirname(path), 'broken.json');
    writeFileSync(broken, '{broken');
    const before = readFileSync(path);
    expect(await handleForRef(file, newConversationRef(first, second))).toBeUndefined();
    await recordConversation(file, nextTurnRef(ref), 200);
    expect(readFileSync(path)).toEqual(before);
    expect(() => resolveHandle(file, 'cA014')).toThrow(/无法完整核验/);
    expect(summaries(file)[0]!.handle).toBeNull();
  });

  it('fails closed if a malformed handle entry has lost its allocation progress', async () => {
    const file = freshFile();
    const ref = newConversationRef(first, second);
    const path = seed(file, ref, 'cA014', 15);
    writeFileSync(path, JSON.stringify({ pair: pairKeyOf(first, second), ref: encodeRef(ref), updatedAt: 1, handles: { cZ999: 42 } }));
    expect(await handleForRef(file, newConversationRef(first, second))).toBeUndefined();
  });

  it('shows only current unambiguous handles in read-only summaries', async () => {
    const file = freshFile();
    const old = newConversationRef(first, second);
    const next = newConversationRef(first, { ...second, id: 'summary-next' });
    seed(file, old, 'cA000', 1);
    seed(file, next, 'cB000', 1001);
    const rows = summaries(file);
    expect(rows.find((row) => row.ref === encodeRef(old))!.handle).toBeNull();
    expect(rows.find((row) => row.ref === encodeRef(next))!.handle).toBe('cB000');
    const foreign = newConversationRef(first, { ...second, id: 'summary-conflict' });
    seed(file, foreign, 'cB000', 1001);
    expect(summaries(file).every((row) => row.handle === null)).toBe(true);
  });

  it('normal cleanup keeps one highest-progress shard and force cleanup explicitly resets the namespace', async () => {
    const file = freshFile();
    const old = newConversationRef(first, second);
    const latest = newConversationRef(first, { ...second, id: 'cleanup-latest' });
    const oldPath = seed(file, old, 'cA000', 1);
    const latestPath = seed(file, latest, 'cA014', 15);
    for (const path of [oldPath, latestPath]) utimesSync(path, new Date(0), new Date(0));
    const deps = { tcpDir: join(dirname(file), 'tcp'), conversationsDir: dirname(oldPath), now: () => 1800000000000 };
    const plan = planCleanup({}, deps);
    expect(plan.targets.map((target) => target.file)).toEqual([oldPath]);
    executeCleanup(plan);
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(latestPath)).toBe(true);
    expect(await handleForRef(file, newConversationRef(first, second))).toBe('cA015');
    executeCleanup(planCleanup({ force: true }, deps));
    expect(readdirSync(deps.conversationsDir)).toEqual([]);
    expect(await handleForRef(file, newConversationRef(first, second))).toBe('cA000');
  });
});
