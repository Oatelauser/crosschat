import { describe, expect, it } from 'vitest';
import { runCodexWrapper } from '../src/commands/codex-wrapper.js';
import { MultichatError } from '../src/errors.js';

const spawns: { exe: string; args: readonly string[]; env: NodeJS.ProcessEnv | undefined }[] = [];
const deps = (env: NodeJS.ProcessEnv = {}) => ({
  resolveExe: () => 'C:/fake/codex.exe',
  env,
  spawnInherit: async (
    exe: string,
    args: readonly string[],
    env?: NodeJS.ProcessEnv,
  ): Promise<number> => {
    spawns.push({ exe, args, env });
    return 0;
  },
});

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

describe('runCodexWrapper (票A 第五单)', () => {
  it('forwards args verbatim (subcommands included, nothing prepended) with knobs as env', async () => {
    const code = await runCodexWrapper(['--max-body-kb', '64', '--max-turn', '40', 'resume', '--profile', 'fast'], deps());
    expect(code).toBe(0);
    const spawn = spawns.at(-1)!;
    expect(spawn.exe).toBe('C:/fake/codex.exe');
    // 无 --settings 类注入：codex 接收走原生 daemon，参数全部原样转发。
    expect(spawn.args).toEqual(['resume', '--profile', 'fast']);
    expect(spawn.env?.CROSSCHAT_MAX_BODY_KIB).toBe('64');
    expect(spawn.env?.CROSSCHAT_MAX_TURN).toBe('40');
  });

  it('accepts --opt=N forms and takes the last occurrence', async () => {
    await runCodexWrapper(['--max-turn=30', '--max-turn', '60', '-p', 'hi'], deps());
    const spawn = spawns.at(-1)!;
    expect(spawn.args).toEqual(['-p', 'hi']);
    expect(spawn.env?.CROSSCHAT_MAX_TURN).toBe('60');
  });

  it('no knobs and no foreign identity vars → env undefined, argv untouched (zero-regression anchor)', async () => {
    await runCodexWrapper(['--version'], deps());
    const spawn = spawns.at(-1)!;
    expect(spawn.args).toEqual(['--version']);
    expect(spawn.env).toBeUndefined();
  });

  it('passes through a non-zero exit code unchanged', async () => {
    const code = await runCodexWrapper(['--version'], {
      ...deps(),
      spawnInherit: async () => 42,
    });
    expect(code).toBe(42);
  });

  it('fails fast on non-positive-integer values with legal-form guidance, without spawning', async () => {
    const before = spawns.length;
    const err = await expectCode(runCodexWrapper(['--max-turn', 'wat'], deps()), 'USAGE');
    expect(err.message).toContain('--max-turn 40');
    await expectCode(runCodexWrapper(['--max-body-kb', '0'], deps()), 'USAGE');
    await expectCode(runCodexWrapper(['--max-body-kb'], deps()), 'USAGE');
    expect(spawns.length).toBe(before);
  });

  it('identity cleaning: strips the CLAUDE_CODE_* family, keeps CODEX_HOME and knob env', async () => {
    // 从 claude 会话里启动 codex 的场景：父环境带着 claude 身份变量。
    await runCodexWrapper(
      ['--max-body-kb', '64'],
      deps({
        CLAUDE_CODE_MESSAGING_SOCKET: 'sock-x',
        CLAUDE_CODE_MESSAGING_TOKEN: 'tok',
        CLAUDE_CODE_SESSION_ID: 'sess-x',
        CODEX_HOME: 'C:/codex-home',
        PATH: 'x',
      }),
    );
    const env = spawns.at(-1)!.env!;
    expect(env.CLAUDE_CODE_MESSAGING_SOCKET).toBeUndefined();
    expect(env.CLAUDE_CODE_MESSAGING_TOKEN).toBeUndefined();
    expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined();
    expect(env.CODEX_HOME).toBe('C:/codex-home'); // 配置变量绝不在剥离清单
    expect(env.CROSSCHAT_MAX_BODY_KIB).toBe('64');
    expect(env.PATH).toBe('x');
  });
});
