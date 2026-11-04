import { describe, expect, it } from 'vitest';
import { decodeRef } from '../src/ref.js';
import { MultichatError } from '../src/errors.js';

describe('extended provider reference errors', () => {
  it.each(['\u001b[2Jprivate-provider', '\r\nforged diagnostic'])('keeps untrusted provider controls out of printable errors (%#)', (provider) => {
    const bytes = Buffer.from(provider, 'utf8');
    // f.type=3 followed by a length-prefixed provider: rejection happens before IDs.
    const encoded = `mc2_${Buffer.concat([Buffer.from([3, bytes.byteLength]), bytes]).toString('base64url')}`;
    let failure: unknown;
    try { decodeRef(encoded); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(MultichatError);
    if (!(failure instanceof MultichatError)) throw new Error('Expected a bounded reference error.');
    expect(failure.code).toBe('INVALID_CONVERSATION_REF');
    expect(failure.message).toContain('unknown extended provider');
    expect(Array.from(failure.message).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)).toBe(false);
  });
});
