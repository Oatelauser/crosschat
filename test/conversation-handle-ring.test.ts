import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { handleForRef, loadAllPairs, pairKeyOf, recordConversation, resolveHandle } from '../src/conversations.js';
import { encodeRef, newConversationRef, nextTurnRef } from '../src/ref.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-handle-ring-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const first = { p: 'claude', id: 'ring-sender', endpointType: 'cli' } as const;
const second = { p: 'codex', id: 'ring-receiver', endpointType: 'desktop' } as const;
const freshFile = () => join(mkdtempSync(join(root, 'case-')), 'conversations.json');
const shardPath = (file: string, pair: string) => join(dirname(file), 'conversations', `${createHash('sha256').update(pair).digest('hex')}.json`);

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

  it('keeps allocation progress after eight-slot eviction and accounting, including a fresh module read', async () => {
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
});
