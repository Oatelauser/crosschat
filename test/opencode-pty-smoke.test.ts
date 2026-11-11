import { describe, expect, it } from 'vitest';
import { supportsOpenCodePtySmokePlatform } from '../scripts/opencode-pty-smoke.mjs';

describe('OpenCode native PTY smoke platform support', () => {
  it('supports the native Windows and Linux PTY hosts only', () => {
    expect(supportsOpenCodePtySmokePlatform('win32')).toBe(true);
    expect(supportsOpenCodePtySmokePlatform('linux')).toBe(true);
    expect(supportsOpenCodePtySmokePlatform('darwin')).toBe(false);
  });
});
