import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  endpointOfIdentity,
  identityKey,
  identityMatchesEndpoint,
  otherIdentityKeys,
  resolveCallerIdentity,
  stripOtherFamilies,
} from '../src/identity.js';
import { decodeOriginIdentity, encodeOrigin, originDisplayName } from '../src/federation.js';
import { decodeRef, encodeRef, nextTurnRef } from '../src/ref.js';
import type { CallerIdentity } from '../src/identity.js';
import type { ConversationRef } from '../src/ref.js';

const scan = {
  sessions: [{ pid: 100, sessionId: 'claude-1', kind: 'interactive' as const, messagingSocketPath: 'socket-1' }],
  malformed: 0,
};

describe('OpenCode caller identity', () => {
  it('identifies the current native session through the shell tool key or explicit integration fallback', () => {
    expect(resolveCallerIdentity({ OPENCODE_SESSION_ID: 'ses_native-1' }, scan)).toEqual({
      p: 'opencode', id: 'ses_native-1',
    });
    expect(resolveCallerIdentity({ CROSSCHAT_OPENCODE_SESSION_ID: 'ses_opaque-1' }, scan)).toEqual({
      p: 'opencode', id: 'ses_opaque-1',
    });
    expect(resolveCallerIdentity({ CROSSCHAT_OPENCODE_SESSION_ID: '' }, scan)).toEqual({ p: 'human' });
    expect(resolveCallerIdentity({ OPENCODE_SESSION_ID: '', CROSSCHAT_OPENCODE_SESSION_ID: '' }, scan))
      .toEqual({ p: 'human' });
    expect(resolveCallerIdentity({ OPENCODE_SESSION_ID: 'ses_1', CROSSCHAT_OPENCODE_SESSION_ID: 'ses_1' }, scan))
      .toEqual({ p: 'opencode', id: 'ses_1' });
  });

  it('rejects disagreeing native and explicit integration session ids', () => {
    expect(() => resolveCallerIdentity({ OPENCODE_SESSION_ID: 'ses_native', CROSSCHAT_OPENCODE_SESSION_ID: 'ses_other' }, scan))
      .toThrow(expect.objectContaining({ code: 'CALLER_IDENTITY_CONFLICT' }));
  });

  it.each([
    { CODEX_THREAD_ID: 'codex-1' },
    { CODEX_SESSION_ID: 'codex-1' },
    { CLAUDE_CODE_MESSAGING_SOCKET: 'socket-1' },
    { CODEX_THREAD_ID: 'codex-1', CLAUDE_CODE_MESSAGING_SOCKET: 'socket-1' },
  ])('rejects ambiguous OpenCode plus another native caller: %j', (foreign) => {
    expect(() => resolveCallerIdentity({ ...foreign, CROSSCHAT_OPENCODE_SESSION_ID: 'ses_1' }, scan))
      .toThrow(expect.objectContaining({ code: 'CALLER_IDENTITY_CONFLICT' }));
  });

  it('shares canonical identity, endpoint and matching behavior without confusing equal native ids', () => {
    const caller: CallerIdentity = { p: 'opencode', id: 'same-id' };
    expect(identityKey(caller)).toBe('opencode:same-id');
    expect(endpointOfIdentity(caller)).toEqual(caller);
    expect(identityMatchesEndpoint(caller, { p: 'opencode', id: 'same-id', m: 'remote' })).toBe(true);
    expect(identityMatchesEndpoint(caller, { p: 'codex', id: 'same-id' })).toBe(false);
    expect(identityMatchesEndpoint(caller, { p: 'opencode', id: 'other-id' })).toBe(false);
    expect(identityMatchesEndpoint(caller, { p: 'human' })).toBe(false);
  });

  it('strips inherited native identities while preserving configuration and the source environment', () => {
    const env = {
      OPENCODE_SESSION_ID: 'ses_1',
      CROSSCHAT_OPENCODE_SESSION_ID: 'ses_1',
      CODEX_THREAD_ID: 'codex-1',
      CLAUDE_CODE_MESSAGING_SOCKET: 'socket-1',
      OPENCODE_CONFIG: 'isolated-config.json',
      CODEX_HOME: 'codex-config',
    };
    expect(stripOtherFamilies(env, 'opencode')).toEqual({
      OPENCODE_SESSION_ID: 'ses_1', CROSSCHAT_OPENCODE_SESSION_ID: 'ses_1', OPENCODE_CONFIG: 'isolated-config.json', CODEX_HOME: 'codex-config',
    });
    expect(env.CODEX_THREAD_ID).toBe('codex-1');
    expect(otherIdentityKeys('claude')).toContain('CROSSCHAT_OPENCODE_SESSION_ID');
    expect(otherIdentityKeys('codex')).toContain('CROSSCHAT_OPENCODE_SESSION_ID');
    expect(otherIdentityKeys('claude')).toContain('OPENCODE_SESSION_ID');
    expect(otherIdentityKeys('codex')).toContain('OPENCODE_SESSION_ID');
    expect(stripOtherFamilies(env, 'codex')).not.toHaveProperty('CROSSCHAT_OPENCODE_SESSION_ID');
    expect(stripOtherFamilies(env, 'codex')).not.toHaveProperty('OPENCODE_SESSION_ID');
  });
});

describe('OpenCode conversation references', () => {
  it.each(['ses_opaque-1', 'ses_a/b@c:雪', '01a1115b-1a3c-7e71-addc-fee969078e1b'])('round-trips opaque id %s on either endpoint', (id) => {
    const base: ConversationRef = {
      v: 1,
      f: { p: 'opencode', id, m: 'host-1', mid: 'machine-1' },
      t: { p: 'codex', id: 'other-id', m: 'host-2', mid: 'machine-2' },
      n: '0011223344556677', c: 1, starId: 'aaaabbbbcccc',
    };
    for (const ref of [base, { ...base, f: base.t, t: base.f }]) {
      expect(decodeRef(encodeRef(ref))).toEqual(ref);
      expect(decodeRef(encodeRef(nextTurnRef(ref)))).toEqual({ ...ref, c: 2 });
    }
  });

  it('reserves type 3 for a named extended provider and rejects unknown extended providers', () => {
    // flags=human sender, extended raw-string recipient; provider then native id.
    const payload = Buffer.from([0x2e, 8, ...Buffer.from('opencode'), 3, ...Buffer.from('s-1'), 1, 0xab, 1]);
    expect(decodeRef('mc2_' + payload.toString('base64url'))).toEqual({
      v: 1, f: { p: 'human' }, t: { p: 'opencode', id: 's-1' }, n: 'ab', c: 1,
    });
    const unknown = Buffer.from([0x2e, 7, ...Buffer.from('unknown'), 3, ...Buffer.from('s-1'), 1, 0xab, 1]);
    expect(() => decodeRef('mc2_' + unknown.toString('base64url'))).toThrow(/unknown.*provider|unknown.*type/);
  });

  it('keeps existing native reference bytes unchanged', () => {
    expect(encodeRef({ v: 1, f: { p: 'claude', id: 'a' }, t: { p: 'codex', id: 'b' }, n: 'ab', c: 1 }))
      .toBe('mc2_NAFhAWIBqwE');
  });

  it('decodes explicit mc1 JSON endpoints and rejects missing OpenCode native ids', () => {
    const ref = { v: 1, f: { p: 'human' }, t: { p: 'opencode', id: 'ses_1' }, n: 'ab', c: 1 };
    const rawRef = (value: unknown) => 'mc1_' + Buffer.from(JSON.stringify(value)).toString('base64url');
    expect(decodeRef(rawRef(ref))).toEqual(ref);
    expect(() => decodeRef(rawRef({ ...ref, t: { p: 'opencode', id: '' } })))
      .toThrow(expect.objectContaining({ code: 'INVALID_CONVERSATION_REF' }));
  });
});

describe('OpenCode origin identity', () => {
  it.each(['ses_1', 'ses_a/b@c:雪', '%not-an-escape'])('round-trips opaque id %s with machine and transport metadata', (id) => {
    const identity: CallerIdentity = { p: 'opencode', id };
    expect(decodeOriginIdentity(encodeOrigin(identity, 'host-1', 'machine-1'))).toEqual({
      ...identity, host: 'host-1', mid: 'machine-1',
    });
    expect(decodeOriginIdentity(encodeOrigin(identity, 'aaaa1111', 'machine-1', 'tcp'))).toEqual({
      ...identity, host: 'aaaa1111', mid: 'machine-1', via: 'tcp',
    });
  });

  it('rejects a malformed encoded OpenCode id and shows an OpenCode sender label', () => {
    expect(() => decodeOriginIdentity(Buffer.from('opencode/%invalid@host-1').toString('base64url')))
      .toThrow(expect.objectContaining({ code: 'USAGE' }));
    expect(originDisplayName({ p: 'opencode', id: 'ses_1234567890' })).toBe('opencode/ses_1234');
  });
});
