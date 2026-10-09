import { describe, expect, it } from 'vitest';
import {
  bodyTooLargeMessage,
  CLAUDE_ENDPOINT_MAX_BODY_BYTES,
  CODEX_ENDPOINT_MAX_BODY_BYTES,
  DEFAULT_MAX_BODY_BYTES,
  MAX_BODY_KIB_CEILING,
  resolveConfiguredMaxBodyBytes,
  resolveMaxTurn,
} from '../src/limits.js';

describe('resolveConfiguredMaxBodyBytes (票A 三层来源)', () => {
  it('defaults to 16384 when no source is set', () => {
    expect(resolveConfiguredMaxBodyBytes(undefined, {})).toBe(DEFAULT_MAX_BODY_BYTES);
    expect(resolveConfiguredMaxBodyBytes(undefined, { CROSSCHAT_MAX_BODY_KIB: 'wat' })).toBe(DEFAULT_MAX_BODY_BYTES);
  });

  it('flag beats env (KiB → bytes)', () => {
    expect(resolveConfiguredMaxBodyBytes('32', { CROSSCHAT_MAX_BODY_KIB: '64' })).toBe(32 * 1_024);
  });

  it('env beats default when the flag is absent or invalid', () => {
    expect(resolveConfiguredMaxBodyBytes(undefined, { CROSSCHAT_MAX_BODY_KIB: '64' })).toBe(64 * 1_024);
    expect(resolveConfiguredMaxBodyBytes('abc', { CROSSCHAT_MAX_BODY_KIB: '64' })).toBe(64 * 1_024);
  });

  it('invalid sources (non-int / NaN / ≤0) silently fall to the next layer', () => {
    expect(resolveConfiguredMaxBodyBytes('1.5', {})).toBe(DEFAULT_MAX_BODY_BYTES);
    expect(resolveConfiguredMaxBodyBytes('0', {})).toBe(DEFAULT_MAX_BODY_BYTES);
    expect(resolveConfiguredMaxBodyBytes('-8', { CROSSCHAT_MAX_BODY_KIB: '-1' })).toBe(DEFAULT_MAX_BODY_BYTES);
  });

  it('clamps source values to the 16MiB absolute ceiling (deterministic behavior)', () => {
    expect(resolveConfiguredMaxBodyBytes('999999', {})).toBe(MAX_BODY_KIB_CEILING * 1_024);
    expect(resolveConfiguredMaxBodyBytes(undefined, { CROSSCHAT_MAX_BODY_KIB: '999999' })).toBe(MAX_BODY_KIB_CEILING * 1_024);
  });
});

describe('resolveMaxTurn (票A 双通道)', () => {
  it('flag beats env, env beats unset', () => {
    expect(resolveMaxTurn('40', { CROSSCHAT_MAX_TURN: '60' })).toBe(40);
    expect(resolveMaxTurn(undefined, { CROSSCHAT_MAX_TURN: '60' })).toBe(60);
    expect(resolveMaxTurn(undefined, {})).toBeUndefined();
  });

  it('invalid values silently fall to the next layer', () => {
    expect(resolveMaxTurn('x', { CROSSCHAT_MAX_TURN: '60' })).toBe(60);
    expect(resolveMaxTurn('0', {})).toBeUndefined();
    expect(resolveMaxTurn('-3', {})).toBeUndefined();
    expect(resolveMaxTurn('2.5', {})).toBeUndefined();
    expect(resolveMaxTurn(undefined, { CROSSCHAT_MAX_TURN: 'NaN!' })).toBeUndefined();
  });
});

describe('bodyTooLargeMessage (票A 教学)', () => {
  it('keeps the per-transport tails and appends the raise guidance', () => {
    const local = bodyTooLargeMessage(20_000, 16_384, undefined);
    expect(local).toContain('the limit is 16384.');
    expect(local).toContain('--max-body-kb');
    expect(local).toContain('CROSSCHAT_MAX_BODY_KIB');
    expect(local).toContain('Write the content to a file and send the path instead.');
    expect(bodyTooLargeMessage(20_000, 16_384, 'ssh:peer')).toContain('scp <文件> peer:/tmp/');
  });

  it('names the endpoint hard cap and says raising will not help', () => {
    expect(bodyTooLargeMessage(70_000, CLAUDE_ENDPOINT_MAX_BODY_BYTES, undefined, 'claude')).toContain('claude 端点硬顶 64KiB——提额无效');
    expect(bodyTooLargeMessage(2_000_000, CODEX_ENDPOINT_MAX_BODY_BYTES, undefined, 'codex')).toContain('codex 端点硬顶 1MiB——提额无效');
    expect(bodyTooLargeMessage(17_000_000, MAX_BODY_KIB_CEILING * 1_024, undefined, 'absolute')).toContain('绝对上界 16MiB');
    expect(bodyTooLargeMessage(2_000_000, CODEX_ENDPOINT_MAX_BODY_BYTES, 'ssh:peer', 'ssh-precheck')).toContain('远端自行复检');
  });
});
