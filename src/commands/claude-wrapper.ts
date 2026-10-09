import { spawn } from 'node:child_process';
import process from 'node:process';
import { MultichatError } from '../errors.js';
import { resolveClaudeExe } from '../claude/resolve-exe.js';
import { splitLauncherKnobs, validateLauncherKnob } from '../limits.js';
import { otherIdentityKeys, stripOtherFamilies } from '../identity.js';

/**
 * `crosschat claude [args...]`: start the real claude CLI with
 * `crossSessionInbound: accept` so peer sessions can inject messages
 * (ticket 002: without it inbound frames sit in parity hold).
 *
 * 票A 旋钮透传：`--max-body-kb <N>` / `--max-turn <N>` 是 crosschat 的旋钮
 * （不是 claude 的参数），剥离、校验后写进子进程环境变量——该会话后续所有
 * `crosschat send` 经 env 层继承；send 显式参数仍最高优先（三层链不动）。
 *
 * 身份清洗（票A 第五单）：启动 claude 时剥掉 codex 家族身份变量
 * （CODEX_THREAD_ID / CODEX_SESSION_ID）——从 codex 会话里启动的 claude 会把
 * 双身份带进每个 crosschat 子命令（CALLER_IDENTITY_CONFLICT；报错里 env -u
 * 的人工自纠在这里机构化做掉）。
 *
 * 全局规则（平面分家）：启动器 = 会话面配置的家（crosschat claude / codex）；
 * 传输面配置（tcp 端口/密钥、broker 编址）属传输组件自己的面，不进启动器
 * ——远端来件与非会话上下文读不到会话启动参数。
 */

const INBOUND_SETTINGS = JSON.stringify({ crossSessionInbound: 'accept' });

export interface ClaudeWrapperDeps {
  resolveExe(): string;
  /** Child env base（身份清洗与旋钮注入的基底）；缺省 process.env。 */
  env?: NodeJS.ProcessEnv;
  /** Spawns interactively (stdio inherit); resolves to the child's exit code. env 缺省 = 继承 process.env（现状行为）。 */
  spawnInherit(exe: string, args: readonly string[], env?: NodeJS.ProcessEnv): Promise<number>;
}

export function defaultClaudeWrapperDeps(): ClaudeWrapperDeps {
  return {
    resolveExe: () => resolveClaudeExe(),
    spawnInherit: (exe, args, env) =>
      new Promise((resolve, reject) => {
        const child = spawn(exe, args, env === undefined ? { stdio: 'inherit' } : { stdio: 'inherit', env });
        child.on('error', reject);
        child.on('close', (code) => resolve(code ?? 1));
      }),
  };
}

export async function runClaudeWrapper(
  args: readonly string[],
  deps: ClaudeWrapperDeps = defaultClaudeWrapperDeps(),
): Promise<number> {
  if (args.some((token) => token === '--settings' || token.startsWith('--settings='))) {
    throw new MultichatError(
      'SETTINGS_CONFLICT',
      'crosschat claude passes its own --settings {"crossSessionInbound":"accept"}. '
        + 'Merge that JSON into your settings file and start claude directly instead.',
    );
  }
  const { passthrough, maxBodyKb, maxTurn } = splitLauncherKnobs(args);
  const maxBodyKbNum = validateLauncherKnob('crosschat claude', '--max-body-kb', maxBodyKb);
  const maxTurnNum = validateLauncherKnob('crosschat claude', '--max-turn', maxTurn);
  const parentEnv = deps.env ?? process.env;
  const foreignIdentityPresent = otherIdentityKeys('claude').some((key) => parentEnv[key] !== undefined);
  const env =
    maxBodyKbNum === undefined && maxTurnNum === undefined && !foreignIdentityPresent
      ? undefined // 无旋钮且无对族身份变量 = 与现状完全一致（不传 env，spawn 继承）
      : stripOtherFamilies(
          {
            ...parentEnv,
            ...(maxBodyKbNum !== undefined ? { CROSSCHAT_MAX_BODY_KIB: String(maxBodyKbNum) } : {}),
            ...(maxTurnNum !== undefined ? { CROSSCHAT_MAX_TURN: String(maxTurnNum) } : {}),
          },
          'claude',
        );
  const exe = deps.resolveExe();
  return deps.spawnInherit(exe, ['--settings', INBOUND_SETTINGS, ...passthrough], env);
}
