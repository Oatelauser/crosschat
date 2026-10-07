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
    expect(encoded.startsWith('mc2_')).toBe(true);
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

describe('mc2 compact codec (008 B2)', () => {
  const uuidA = 'a3f9c2e1-5b7d-4f8a-9c21-8e4d2b6a0f33';
  const uuidB = '01a1115b-1a3c-7e71-addc-fee969078e1b';

  it('round-trips the standard cross-machine example and stays compact', () => {
    const ref: ConversationRef = {
      v: 1,
      f: { p: 'claude', id: uuidA, m: 'win-dev' },
      t: { p: 'codex', id: uuidB, m: 'build01' },
      n: '9d4f2ab1c3e85760',
      c: 2,
    };
    const encoded = encodeRef(ref);
    expect(encoded.startsWith('mc2_')).toBe(true);
    // Design §6 target ≈79; varint length prefixes + 8-byte nonce land at ~84.
    expect(encoded.length).toBeLessThanOrEqual(85);
    expect(encoded.length).toBeGreaterThanOrEqual(75);
    expect(decodeRef(encoded)).toEqual(ref);
  });

  it('round-trips every endpoint shape: raw-string ids, human, m on none/one/both', () => {
    const cases: ConversationRef[] = [
      { v: 1, f: { p: 'claude', id: uuidA }, t: { p: 'codex', id: uuidB }, n: '0011223344556677', c: 1 },
      { v: 1, f: { p: 'human' }, t: { p: 'claude', id: 'cs-1', m: 'build01' }, n: 'ab', c: 9 },
      { v: 1, f: { p: 'codex', id: 'short-id', m: 'w' }, t: { p: 'codex', id: uuidB, m: 'x'.repeat(60) }, n: 'ff', c: 1 },
      { v: 1, f: { p: 'human' }, t: { p: 'human' }, n: '00', c: 300 },
    ];
    for (const ref of cases) expect(decodeRef(encodeRef(ref))).toEqual(ref);
  });

  it('supports turn counters beyond 127 via varint', () => {
    const ref: ConversationRef = { v: 1, f: { p: 'human' }, t: { p: 'claude', id: uuidA }, n: '11', c: 5_000 };
    const decoded = decodeRef(encodeRef(ref));
    expect(decoded.c).toBe(5_000);
  });

  it('nextTurnRef keeps endpoint machines structurally', () => {
    const ref = newConversationRef({ p: 'claude', id: uuidA, m: 'win-dev' }, { p: 'codex', id: uuidB, m: 'build01' });
    const next = nextTurnRef(ref);
    expect(next.c).toBe(2);
    expect(decodeRef(encodeRef(next))).toEqual(next);
    expect(next.f).toEqual({ p: 'claude', id: uuidA, m: 'win-dev' });
  });

  it('decodes legacy mc1_ refs forever (old envelopes never expire)', () => {
    const legacy = {
      v: 1,
      f: { p: 'claude', id: 'boss' },
      t: { p: 'codex', id: '01a1' },
      n: 'ab',
      c: 1,
    };
    const encoded = REF_PREFIX + Buffer.from(JSON.stringify(legacy), 'utf8').toString('base64url');
    expect(decodeRef(encoded)).toEqual(legacy);
  });

  it('re-encodes a decoded mc1_ ref byte-faithfully as mc2_ (nonce survives)', () => {
    const legacy = { v: 1, f: { p: 'claude', id: 'boss' }, t: { p: 'codex', id: '01a1' }, n: 'ab', c: 1 };
    const encoded = REF_PREFIX + Buffer.from(JSON.stringify(legacy), 'utf8').toString('base64url');
    const again = encodeRef(nextTurnRef(decodeRef(encoded)));
    expect(decodeRef(again)).toEqual({ ...legacy, c: 2 });
  });

  it('reports malformed mc2 payloads with the version-skew hint', () => {
    // valid base64url of a truncated body (flags only): decode must fail with the upgrade hint
    const truncated = 'mc2_' + Buffer.from([0b00000000]).toString('base64url');
    expect(() => decodeRef(truncated)).toThrow(/版本较新/);
    expect(() => decodeRef('mc2_!!!!')).toThrow();
    expect(() => decodeRef('mc3_abc')).toThrow(/prefix/);
  });
});
