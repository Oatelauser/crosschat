import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { resolveClaudeExe } from '../src/claude/resolve-exe.js';
import { runClaudeWrapper } from '../src/commands/claude-wrapper.js';
import { MultichatError } from '../src/errors.js';

const spawns: { exe: string; args: string[] }[] = [];
const deps = {
  resolveExe: () => 'C:/fake/claude.exe',
  spawnInherit: async (exe: string, args: readonly string[]): Promise<number> => {
    spawns.push({ exe, args: [...args] });
    return 0;
  },
};

async function expectCode(promise: Promise<unknown>, code: string): Promise<MultichatError> {
  try {
    await promise;
    expect.unreachable(`should have thrown ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(MultichatError);
    const me = err as MultichatError;
    expect(me.code).toBe(code);
    return me;
  }
}

describe('runClaudeWrapper', () => {
  it('prepends --settings {"crossSessionInbound":"accept"} and passes the rest through', async () => {
    const code = await runClaudeWrapper(['--version'], deps);
    expect(code).toBe(0);
    expect(spawns.at(-1)).toEqual({
      exe: 'C:/fake/claude.exe',
      args: ['--settings', '{"crossSessionInbound":"accept"}', '--version'],
    });
  });

  it('passes through a non-zero exit code unchanged', async () => {
    const code = await runClaudeWrapper(['-p', 'hi'], {
      ...deps,
      spawnInherit: async () => 42,
    });
    expect(code).toBe(42);
  });

  it('rejects a user-supplied --settings without spawning', async () => {
    const before = spawns.length;
    await expectCode(runClaudeWrapper(['--settings', '{"x":1}'], deps), 'SETTINGS_CONFLICT');
    await expectCode(runClaudeWrapper(['--settings={"x":1}'], deps), 'SETTINGS_CONFLICT');
    expect(spawns.length).toBe(before);
  });
});

describe('resolveClaudeExe', () => {
  const npmExe = (appdata: string) =>
    join(
      appdata,
      'npm',
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'node_modules',
      '@anthropic-ai',
      'claude-code-win32-x64',
      'claude.exe',
    );

  describe.skipIf(process.platform !== 'win32')('win32 resolution', () => {
    it('prefers the APPDATA npm layout when it exists', () => {
      const appdata = 'C:/Users/x/AppData/Roaming';
      const exe = resolveClaudeExe({
        env: { APPDATA: appdata },
        where: () => ({ status: 0, stdout: 'C:/other/claude.cmd\r\n' }),
        exists: (path) => path === npmExe(appdata),
      });
      expect(exe).toBe(npmExe(appdata));
    });

    it('falls back to where.exe .exe lines (cmd/ps1 shims skipped)', () => {
      const exe = resolveClaudeExe({
        env: {},
        where: () => ({ status: 0, stdout: 'C:/bin/claude.cmd\r\nC:/bin/claude.exe\r\nD:/tools/claude.EXE\r\n' }),
        exists: (path) => path === 'C:/bin/claude.exe',
      });
      expect(exe).toBe('C:/bin/claude.exe');
    });

    it('throws CLAUDE_EXE_NOT_FOUND when nothing resolves', () => {
      try {
        resolveClaudeExe({ env: {}, where: () => ({ status: 1, stdout: '' }), exists: () => false });
        expect.unreachable('should have thrown CLAUDE_EXE_NOT_FOUND');
      } catch (err) {
        expect(err).toBeInstanceOf(MultichatError);
        expect((err as MultichatError).code).toBe('CLAUDE_EXE_NOT_FOUND');
      }
    });
  });

  describe.skipIf(process.platform === 'win32')('unix resolution', () => {
    it('returns the CROSSCHAT_CLAUDE_BIN override', () => {
      expect(resolveClaudeExe({ env: { CROSSCHAT_CLAUDE_BIN: '/opt/claude/claude' }, where: () => ({ status: 0, stdout: '' }), exists: () => true })).toBe('/opt/claude/claude');
    });

    it("returns bare 'claude' from PATH without touching where.exe", () => {
      expect(resolveClaudeExe({ env: {}, where: () => ({ status: 0, stdout: '/usr/bin/claude\r\n' }), exists: () => false })).toBe('claude');
    });
  });
});
