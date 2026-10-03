import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { continueConversation, pairKeyOf, recordConversation } from '../src/conversations.js';
import { newConversationRef } from '../src/ref.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-conv-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const freshFile = (): string => join(mkdtempSync(join(root, 'case-')), 'conversations.json');

const claudeA = { p: 'claude', id: 'cs-1' } as const;
const codexB = { p: 'codex', id: 't-1' } as const;

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
    const other = newConversationRef(claudeA, { p: 'claude', id: 'cs-2' });
    recordConversation(file, other, 1_000);
    const got = continueConversation(file, claudeA, codexB);
    expect(got.turn).toBe(1); // no matching pair record -> fresh thread
    expect(got.ref.t.p).toBe('codex');
    expect(got.ref.n).not.toBe(other.n);
  });
});
