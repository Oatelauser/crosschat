import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { runClaudeWrapper } from '../src/commands/claude-wrapper.js';
import { runCodexWrapper } from '../src/commands/codex-wrapper.js';
import { runOpenCodeWrapper } from '../src/commands/opencode-wrapper.js';
import { endpointOfIdentity, identityKey, identityMatchesEndpoint, otherIdentityKeys, resolveCallerIdentity, stripOtherFamilies } from '../src/identity.js';
import { decodeOriginIdentity, encodeOrigin, originDisplayName } from '../src/federation.js';
import { decodeRef, encodeRef, nextTurnRef } from '../src/ref.js';
import type { ConversationRef } from '../src/ref.js';

const scan = { sessions: [{ pid: 1, sessionId: 'claude-native', kind: 'interactive' as const, messagingSocketPath: 'owned-socket' }], skipped: 0 };

describe('DeepSeek Harness native caller identity', () => {
  it('uses only the current native DSH_SESSION_ID and treats empty or unrecognized integration keys as human', () => {
    expect(resolveCallerIdentity({ DSH_SESSION_ID: 'native-harness' }, scan)).toEqual({ p: 'dsh', id: 'native-harness' });
    expect(resolveCallerIdentity({ DSH_SESSION_ID: '' }, scan)).toEqual({ p: 'human' });
    expect(resolveCallerIdentity({ CROSSCHAT_DSH_SESSION_ID: 'unrecognized' }, scan)).toEqual({ p: 'human' });
  });

  it.each([
    { CODEX_THREAD_ID: 'codex-native' }, { CODEX_SESSION_ID: 'codex-native' },
    { CLAUDE_CODE_MESSAGING_SOCKET: 'owned-socket' },
    { OPENCODE_SESSION_ID: 'opencode-native' }, { CROSSCHAT_OPENCODE_SESSION_ID: 'opencode-native' },
  ])('rejects native Harness mixed with another caller family (%j)', (foreign) => {
    expect(() => resolveCallerIdentity({ ...foreign, DSH_SESSION_ID: 'harness-native' }, scan)).toThrow(expect.objectContaining({ code: 'CALLER_IDENTITY_CONFLICT' }));
  });

  it('keeps provider and opaque native ID together in identity comparison', () => {
    const caller = { p: 'dsh' as const, id: 'same-id' };
    expect(identityKey(caller)).toBe('dsh:same-id');
    expect(endpointOfIdentity(caller)).toEqual(caller);
    expect(identityMatchesEndpoint(caller, { p: 'dsh', id: 'same-id', m: 'elsewhere' })).toBe(true);
    expect(identityMatchesEndpoint(caller, { p: 'opencode', id: 'same-id' })).toBe(false);
    expect(identityMatchesEndpoint(caller, { p: 'human' })).toBe(false);
  });

  it.each(['claude', 'codex', 'opencode'] as const)('strips Harness identity from the %s launcher and preserves configuration', async (family) => {
    const parent = { DSH_SESSION_ID: 'parent-harness', DSH_HOME: 'profile-home', DSH_PROFILE: 'profile-name', DSH_PROFILE_DIR: 'profile-directory' };
    const spawnInherit = vi.fn<(exe: string, args: readonly string[], env?: NodeJS.ProcessEnv) => Promise<number>>(async () => 0);
    const deps = { resolveExe: () => 'native-tool', env: parent, spawnInherit };
    const launch = { claude: runClaudeWrapper, codex: runCodexWrapper, opencode: runOpenCodeWrapper }[family];
    expect(otherIdentityKeys(family)).toContain('DSH_SESSION_ID');
    await launch(['--version'], deps);
    expect(spawnInherit).toHaveBeenCalledTimes(1);
    expect(spawnInherit.mock.calls[0][2]).toEqual({ DSH_HOME: 'profile-home', DSH_PROFILE: 'profile-name', DSH_PROFILE_DIR: 'profile-directory' });
    expect(parent.DSH_SESSION_ID).toBe('parent-harness');
    expect(stripOtherFamilies(parent, family)).not.toHaveProperty('DSH_SESSION_ID');
  });
});

describe('DeepSeek Harness conversation references and origin', () => {
  it.each(['native-session', 'native/a@b:c%雪', '01a1115b-1a3c-7e71-addc-fee969078e1b'])('round-trips opaque ID on either mc2 endpoint (%s)', (id) => {
    const ref: ConversationRef = { v: 1, f: { p: 'dsh', id, m: 'host-a', mid: 'machine-a' }, t: { p: 'opencode', id: 'other', m: 'host-b', mid: 'machine-b' }, n: '0011223344556677', c: 3, starId: 'aaaabbbbcccc' };
    for (const value of [ref, { ...ref, f: ref.t, t: ref.f }]) {
      expect(decodeRef(encodeRef(value))).toEqual(value);
      expect(decodeRef(encodeRef(nextTurnRef(value)))).toEqual({ ...value, c: 4 });
    }
  });

  it('uses the existing named type-3 slot and leaves previous provider bytes intact', () => {
    const payload = Buffer.from([0x2e, 3, ...Buffer.from('dsh'), 3, ...Buffer.from('d-1'), 1, 0xab, 1]);
    expect(decodeRef(`mc2_${payload.toString('base64url')}`)).toEqual({ v: 1, f: { p: 'human' }, t: { p: 'dsh', id: 'd-1' }, n: 'ab', c: 1 });
    expect(encodeRef({ v: 1, f: { p: 'human' }, t: { p: 'dsh', id: 'd-1' }, n: 'ab', c: 1 })).toBe(`mc2_${payload.toString('base64url')}`);
    expect(encodeRef({ v: 1, f: { p: 'claude', id: 'a' }, t: { p: 'codex', id: 'b' }, n: 'ab', c: 1 })).toBe('mc2_NAFhAWIBqwE');
  });

  it('accepts a structurally valid mc1 endpoint while rejecting missing native IDs and unknown providers', () => {
    const json = (value: unknown) => `mc1_${Buffer.from(JSON.stringify(value)).toString('base64url')}`;
    const ref = { v: 1, f: { p: 'human' }, t: { p: 'dsh', id: 'native-session' }, n: 'ab', c: 1 };
    expect(decodeRef(json(ref))).toEqual(ref);
    expect(() => decodeRef(json({ ...ref, t: { p: 'dsh', id: '' } }))).toThrow(expect.objectContaining({ code: 'INVALID_CONVERSATION_REF' }));
    expect(() => decodeRef(json({ ...ref, t: { p: 'unregistered', id: 'native-session' } }))).toThrow(expect.objectContaining({ code: 'INVALID_CONVERSATION_REF' }));
  });

  it.each(['native-session', 'native/a@b:c%雪', '%not-escape'])('keeps full native origin ID and machine metadata (%s)', (id) => {
    const caller = { p: 'dsh' as const, id };
    expect(decodeOriginIdentity(encodeOrigin(caller, 'host-a', 'machine-a'))).toEqual({ ...caller, host: 'host-a', mid: 'machine-a' });
    expect(decodeOriginIdentity(encodeOrigin(caller, 'aaaabbbb', 'machine-a', 'tcp'))).toEqual({ ...caller, host: 'aaaabbbb', mid: 'machine-a', via: 'tcp' });
  });

  it('rejects invalid Harness origin escapes and exposes a bounded native sender label', () => {
    expect(() => decodeOriginIdentity(Buffer.from('dsh/%invalid@host-a').toString('base64url'))).toThrow(expect.objectContaining({ code: 'USAGE' }));
    expect(originDisplayName({ p: 'dsh', id: 'native-session' })).toBe('dsh/native-s');
  });
});
