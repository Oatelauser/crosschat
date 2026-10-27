import { spawn } from 'node:child_process';
import process from 'node:process';
import { MultichatError } from '../errors.js';
import { resolveClaudeExe } from '../claude/resolve-exe.js';
import { splitLauncherKnobs, validateLauncherKnob } from '../limits.js';
import { otherIdentityKeys, stripOtherFamilies } from '../identity.js';
import { realStarJoinDeps, reportLauncherFailure, splitStarLauncherArgs, createStarSelectionFollower } from './session-star.js';
import type { StarJoinDeps } from './session-star.js';
import { createClaudeSessionBinding } from '../claude/session-events.js';
import type { ClaudeSessionBindingFactory } from '../claude/session-events.js';
import type { LauncherSessionBinding } from '../application/session-selection.js';

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

/** 从原生透传参数读取会话名，仅用于启动前的异工具同名预警。 */
function claudeSpawnName(passthrough: readonly string[]): string | undefined {
  for (let i = 0; i < passthrough.length; i++) {
    const token = passthrough[i]!;
    if (token === '-n' || token === '--name') {
      const next = passthrough[i + 1];
      return next !== undefined && next !== '' && !next.startsWith('-') ? next : undefined;
    }
    if (token.startsWith('--name=') && token.length > '--name='.length) return token.slice('--name='.length);
    if (token.startsWith('-n=') && token.length > '-n='.length) return token.slice('-n='.length);
  }
  return undefined;
}

export interface ClaudeWrapperDeps {
  resolveExe(): string;
  /** Child env base（身份清洗与旋钮注入的基底）；缺省 process.env。 */
  env?: NodeJS.ProcessEnv;
  /** Spawns interactively; reports the actual child PID and resolves to its exit code. */
  spawnInherit(exe: string, args: readonly string[], env?: NodeJS.ProcessEnv, onSpawn?: (pid: number) => void): Promise<number>;
  /** 018 批二：入星腿依赖（--connect 在场时使用）；缺省 realStarJoinDeps()。 */
  star?: StarJoinDeps;
  createSessionBinding?: ClaudeSessionBindingFactory;
}

export function defaultClaudeWrapperDeps(): ClaudeWrapperDeps {
  return {
    resolveExe: () => resolveClaudeExe(),
    spawnInherit: (exe, args, env, onSpawn) =>
      new Promise((resolve, reject) => {
        const child = spawn(exe, args, env === undefined ? { stdio: 'inherit' } : { stdio: 'inherit', env });
        child.once('spawn', () => { if (child.pid !== undefined) onSpawn?.(child.pid); });
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
  const star = splitStarLauncherArgs(args);
  const { passthrough, maxBodyKb, maxTurn } = splitLauncherKnobs(star.passthrough);
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
  // --connect 入星按本启动器的原生子进程识别，不从全局最新会话猜身份。
  // 入星任何失败只出一行 stderr，不连坐会话本身
  if (star.connects.length > 0) {
    const spawnName = claudeSpawnName(passthrough);
    const starDeps = deps.star ?? realStarJoinDeps(parentEnv);
    const follower = createStarSelectionFollower({
      deps: starDeps,
      side: 'claude',
      connects: star.connects,
      ...(star.extendSession === undefined ? {} : { extendSession: star.extendSession }),
      ...(spawnName === undefined ? {} : { spawnName }),
      ...(star.rm === true ? { rm: true } : {}),
    });
    let binding: LauncherSessionBinding | undefined;
    let nativePid: number | undefined;
    try {
      try { binding = await (deps.createSessionBinding ?? createClaudeSessionBinding)({ args: passthrough, onSelection: (event) => follower.select(event),
        onUnavailable: (error) => reportLauncherFailure(starDeps, error),
        currentSessionId: () => {
          if (nativePid === undefined) return undefined;
          const matches = starDeps.listClaudeSessions().sessions.filter((session) => session.pid === nativePid);
          return matches.length === 1 ? matches[0]!.sessionId : undefined;
        } }); }
      catch (error) { reportLauncherFailure(starDeps, error); }
      return await deps.spawnInherit(exe, binding?.args ?? ['--settings', INBOUND_SETTINGS, ...passthrough], env, (pid) => { nativePid = pid; });
    } finally {
      try { await binding?.close(); } finally { await follower.close(); }
    }
  }
  return deps.spawnInherit(exe, ['--settings', INBOUND_SETTINGS, ...passthrough], env);
}
