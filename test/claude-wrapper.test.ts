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

describe('runClaudeWrapper knob passthrough (票A)', () => {
  const knobSpawns: { exe: string; args: readonly string[]; env: NodeJS.ProcessEnv | undefined }[] = [];
  const knobDeps = (env: NodeJS.ProcessEnv = {}) => ({
    resolveExe: () => 'C:/fake/claude.exe',
    env,
    spawnInherit: async (
      exe: string,
      args: readonly string[],
      env?: NodeJS.ProcessEnv,
    ): Promise<number> => {
      knobSpawns.push({ exe, args, env });
      return 0;
    },
  });

  it('strips both knobs, injects them as child env, forwards the rest verbatim', async () => {
    await runClaudeWrapper(['--max-body-kb', '64', '--max-turn', '40', '--version'], knobDeps());
    const spawn = knobSpawns.at(-1)!;
    expect(spawn.args).toEqual(['--settings', '{"crossSessionInbound":"accept"}', '--version']);
    expect(spawn.env?.CROSSCHAT_MAX_BODY_KIB).toBe('64');
    expect(spawn.env?.CROSSCHAT_MAX_TURN).toBe('40');
  });

  it('accepts --opt=N forms and takes the last occurrence (same as parseSendArgs)', async () => {
    await runClaudeWrapper(['--max-body-kb=32', '--max-body-kb', '64', '-p', 'hi'], knobDeps());
    const spawn = knobSpawns.at(-1)!;
    expect(spawn.args).toEqual(['--settings', '{"crossSessionInbound":"accept"}', '-p', 'hi']);
    expect(spawn.env?.CROSSCHAT_MAX_BODY_KIB).toBe('64');
  });

  it('no knobs and no foreign identity vars → env stays undefined, argv byte-identical to the legacy spawn', async () => {
    await runClaudeWrapper(['--version'], knobDeps());
    const spawn = knobSpawns.at(-1)!;
    expect(spawn.args).toEqual(['--settings', '{"crossSessionInbound":"accept"}', '--version']);
    expect(spawn.env).toBeUndefined();
  });

  it('fails fast on non-positive-integer values with legal-form guidance, without spawning', async () => {
    const before = knobSpawns.length;
    const err = await expectCode(runClaudeWrapper(['--max-body-kb', 'wat'], knobDeps()), 'USAGE');
    expect(err.message).toContain('--max-body-kb 64');
    await expectCode(runClaudeWrapper(['--max-turn', '0'], knobDeps()), 'USAGE');
    await expectCode(runClaudeWrapper(['--max-turn', '-3'], knobDeps()), 'USAGE');
    await expectCode(runClaudeWrapper(['--max-body-kb'], knobDeps()), 'USAGE');
    expect(knobSpawns.length).toBe(before);
  });

  it('--settings conflict detection is unaffected by the knobs', async () => {
    const before = knobSpawns.length;
    await expectCode(
      runClaudeWrapper(['--max-body-kb', '64', '--settings', '{"x":1}'], knobDeps()),
      'SETTINGS_CONFLICT',
    );
    await expectCode(
      runClaudeWrapper(['--settings={"x":1}', '--max-turn', '40'], knobDeps()),
      'SETTINGS_CONFLICT',
    );
    expect(knobSpawns.length).toBe(before);
  });

  it('identity cleaning: strips codex identity vars from the child env (票A 第五单)', async () => {
    // 从 codex 会话里启动 claude 的场景：父环境带着 codex 身份变量。
    await runClaudeWrapper(
      ['--version'],
      knobDeps({ CODEX_THREAD_ID: 't1', CODEX_SESSION_ID: 's1', CODEX_HOME: 'C:/codex-home', PATH: 'x' }),
    );
    const env = knobSpawns.at(-1)!.env!;
    expect(env.CODEX_THREAD_ID).toBeUndefined();
    expect(env.CODEX_SESSION_ID).toBeUndefined();
    expect(env.CODEX_HOME).toBe('C:/codex-home'); // 配置变量绝不动
    expect(env.PATH).toBe('x');
    // 无旋钮但有对族身份变量时，env 仍然是清洗副本（非 undefined）。
    await runClaudeWrapper(['--version'], knobDeps({}));
    expect(knobSpawns.at(-1)!.env).toBeUndefined();
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
