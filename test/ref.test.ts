import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  REF_PREFIX,
  decodeRef,
  encodeRef,
  newConversationRef,
  nextTurnRef,
  type ConversationRef,
} from '../src/ref.js';
import { MultichatError } from '../src/errors.js';

const from = { p: 'claude' as const, id: 's-1111' };
const to = { p: 'codex' as const, id: 't-2222' };

function expectInvalid(fn: () => unknown, why: string): void {
  try {
    fn();
    expect.unreachable(`should have thrown (${why})`);
  } catch (err) {
    expect(err).toBeInstanceOf(MultichatError);
    expect((err as MultichatError).code).toBe('INVALID_CONVERSATION_REF');
  }
}

/** Hand-build a ref string whose JSON payload we control exactly. */
function rawRef(payload: string): string {
  return REF_PREFIX + Buffer.from(payload, 'utf8').toString('base64url');
}

describe('conversation ref codec', () => {
  it('round-trips encode/decode with the mc1_ prefix', () => {
    const ref = newConversationRef(from, to);
    const encoded = encodeRef(ref);
    expect(encoded.startsWith('mc1_')).toBe(true);
    expect(encoded.length).toBeGreaterThan('mc1_'.length + 20);
    expect(decodeRef(encoded)).toEqual(ref);
  });

  it('supports human as an endpoint (no id)', () => {
    const ref = newConversationRef({ p: 'human' }, to);
    expect(decodeRef(encodeRef(ref))).toEqual({ ...ref, f: { p: 'human' } });
  });

  it('increments the turn while keeping nonce and endpoints', () => {
    const ref = newConversationRef(from, to);
    const next = nextTurnRef(ref);
    expect(next.c).toBe(2);
    expect(next.n).toBe(ref.n);
    expect(next.f).toEqual(from);
    expect(next.t).toEqual(to);
    expect(decodeRef(encodeRef(next))).toEqual(next);
  });

  it('generates a fresh nonce per conversation', () => {
    expect(newConversationRef(from, to).n).not.toBe(newConversationRef(from, to).n);
  });
});

describe('conversation ref validation', () => {
  it('rejects a wrong or missing prefix', () => {
    expectInvalid(() => decodeRef('xx_eyJ2IjoxfQ'), 'wrong prefix');
    expectInvalid(() => decodeRef('eyJ2IjoxfQ'), 'missing prefix');
  });

  it('detects a corrupted payload', () => {
    const ref = newConversationRef(from, to);
    const json = JSON.stringify(ref);
    expectInvalid(() => decodeRef(rawRef(json.slice(0, json.length - 12))), 'truncated json');
  });

  it('a flipped character never yields a malformed ref (refs are validated, not signed)', () => {
    const encoded = encodeRef(newConversationRef(from, to));
    for (let i = REF_PREFIX.length; i < encoded.length; i++) {
      const flipped = encoded.slice(0, i) + (encoded[i] === 'A' ? 'B' : 'A') + encoded.slice(i + 1);
      try {
        const ref = decodeRef(flipped);
        // Survived: must still be a fully valid shape (any landing spot that
        // keeps JSON valid keeps the schema valid too).
        expect(ref.v).toBe(1);
        expect(ref.c).toBeGreaterThanOrEqual(1);
        expect(ref.n).not.toBe('');
      } catch (err) {
        expect((err as MultichatError).code).toBe('INVALID_CONVERSATION_REF');
      }
    }
  });

  it('rejects non-JSON payloads', () => {
    expectInvalid(() => decodeRef(rawRef('{oops')), 'corrupt json');
  });

  it('rejects a wrong version', () => {
    const ref = newConversationRef(from, to);
    expectInvalid(() => decodeRef(rawRef(JSON.stringify({ ...ref, v: 2 }))), 'version');
  });

  it('rejects structural violations', () => {
    const ref = newConversationRef(from, to);
    expectInvalid(() => decodeRef(rawRef(JSON.stringify({ ...ref, c: 0 }))), 'turn below 1');
    expectInvalid(() => decodeRef(rawRef(JSON.stringify({ ...ref, c: 1.5 }))), 'fractional turn');
    expectInvalid(() => decodeRef(rawRef(JSON.stringify({ ...ref, n: '' }))), 'empty nonce');
    expectInvalid(() => decodeRef(rawRef(JSON.stringify({ ...ref, f: { p: 'claude' } }))), 'claude without id');
    expectInvalid(() => decodeRef(rawRef(JSON.stringify({ ...ref, t: { p: 'slack', id: 'x' } }))), 'unknown side');
    expectInvalid(() => decodeRef(rawRef(JSON.stringify({ ...ref, t: undefined }))), 'missing endpoint');
    expectInvalid(() => decodeRef(rawRef('null')), 'null payload');
    expectInvalid(() => decodeRef(rawRef('[1,2]')), 'array payload');
  });

  it('keeps extra JSON keys out of the decoded ref', () => {
    const ref: ConversationRef = newConversationRef(from, to);
    const noisy = rawRef(JSON.stringify({ ...ref, extra: 'ignored' }));
    expect(decodeRef(noisy)).toEqual(ref);
  });
});
