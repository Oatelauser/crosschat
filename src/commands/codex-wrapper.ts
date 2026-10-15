import { spawn } from 'node:child_process';
import process from 'node:process';
import { resolveCodexExecutable } from '../codex/transport.js';
import { splitLauncherKnobs, validateLauncherKnob } from '../limits.js';
import { otherIdentityKeys, stripOtherFamilies } from '../identity.js';
import { realStarJoinDeps, splitStarLauncherArgs, StarJoinDeps, StarJoiner } from './session-star.js';

/**
 * `crosschat codex [args...]`（票A 第五单）：与 crosschat claude 成对的
 * "crosschat 增强启动器"。与 claude 侧的必要性差异：codex 接收走原生
 * daemon，**无需注入任何 codex 设置**——本命令的存在意义是旋钮透传与身份
 * 清洗两个会话面增强；不管理 daemon 生命周期（原生的事）。
 *
 * 机制镜像 claude-wrapper：--max-body-kb / --max-turn 剥离、正整数快错、
 * 写进子进程环境变量；其余参数（含子命令 resume、--profile 等）一个不解析、
 * 原样转发。身份清洗方向相反：启动 codex 剥 CLAUDE_CODE_* 家族——从 claude
 * 会话里启动的 codex 会把双身份带进每个 crosschat 子命令
 * （CALLER_IDENTITY_CONFLICT 的机构化预防）；CODEX_HOME 等配置变量绝不动。
 *
 * 全局规则（平面分家）：启动器 = 会话面配置的家（crosschat claude / codex）；
 * 传输面配置（tcp 端口/密钥、broker 编址）属传输组件自己的面，不进启动器
 * ——远端来件与非会话上下文读不到会话启动参数。
 */

export interface CodexWrapperDeps {
  resolveExe(): string;
  /** Child env base（身份清洗与旋钮注入的基底）；缺省 process.env。 */
  env?: NodeJS.ProcessEnv;
  /** Spawns interactively (stdio inherit); resolves to the child's exit code. env 缺省 = 继承 process.env。 */
  spawnInherit(exe: string, args: readonly string[], env?: NodeJS.ProcessEnv): Promise<number>;
  /** 018 批二：入星腿依赖（--connect 在场时使用）；缺省 realStarJoinDeps()。 */
  star?: StarJoinDeps;
}

export function defaultCodexWrapperDeps(): CodexWrapperDeps {
  return {
    // 真实解析复用 codex 传输层的现成逻辑（CROSSCHAT_CODEX_BIN 覆盖 > PATH）。
    resolveExe: () => resolveCodexExecutable(),
    spawnInherit: (exe, args, env) =>
      new Promise((resolve, reject) => {
        const child = spawn(exe, args, env === undefined ? { stdio: 'inherit' } : { stdio: 'inherit', env });
        child.on('error', reject);
        child.on('close', (code) => resolve(code ?? 1));
      }),
  };
}

export async function runCodexWrapper(
  args: readonly string[],
  deps: CodexWrapperDeps = defaultCodexWrapperDeps(),
): Promise<number> {
  // 018 批二：--connect <星> 在场=入星启动（codex 无 -n——名字原生 /rename 后由聚合器回填）
  const star = splitStarLauncherArgs(args);
  const { passthrough, maxBodyKb, maxTurn } = splitLauncherKnobs(star.passthrough);
  const maxBodyKbNum = validateLauncherKnob('crosschat codex', '--max-body-kb', maxBodyKb);
  const maxTurnNum = validateLauncherKnob('crosschat codex', '--max-turn', maxTurn);
  const parentEnv = deps.env ?? process.env;
  const foreignIdentityPresent = otherIdentityKeys('codex').some((key) => parentEnv[key] !== undefined);
  const env =
    maxBodyKbNum === undefined && maxTurnNum === undefined && !foreignIdentityPresent
      ? undefined // 无旋钮且无对族身份变量 = 干净透传（不传 env，spawn 继承）
      : stripOtherFamilies(
          {
            ...parentEnv,
            ...(maxBodyKbNum !== undefined ? { CROSSCHAT_MAX_BODY_KIB: String(maxBodyKbNum) } : {}),
            ...(maxTurnNum !== undefined ? { CROSSCHAT_MAX_TURN: String(maxTurnNum) } : {}),
          },
          'codex',
        );
  // 无 --settings 类注入：codex 接收靠原生 daemon，参数全部原样转发。
  // 入星腿与 claude 同构：spawn 前快照、守连接、退出 detach；失败只出一行 stderr。
  if (star.connects.length > 0) {
    const joiner = new StarJoiner({
      deps: deps.star ?? realStarJoinDeps(),
      side: 'codex',
      connects: star.connects,
      ...(star.extendSession === undefined ? {} : { extendSession: star.extendSession }),
    });
    await joiner.begin();
    try {
      return await deps.spawnInherit(deps.resolveExe(), passthrough, env);
    } finally {
      await joiner.stop();
    }
  }
  return deps.spawnInherit(deps.resolveExe(), passthrough, env);
}
