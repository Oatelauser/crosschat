import process from 'node:process';
import { MultichatError } from './errors.js';
import type { ClaudeRegistryScan } from './claude/registry.js';
import type { RefEndpoint } from './ref.js';

/**
 * Caller identity from environment variables (ticket 003, stateless CLI):
 * - CLAUDE_CODE_MESSAGING_SOCKET -> match the pipe path against the registry
 * - CODEX_THREAD_ID || CODEX_SESSION_ID -> codex thread identity
 * - neither -> human (may send, cannot receive)
 */

export type CallerIdentity =
  | { p: 'claude'; id: string; name?: string }
  | { p: 'codex'; id: string }
  | { p: 'human' };

/**
 * 身份环境变量家族注册表（票A 第五单引入、第七单重组为注册表）：清单以
 * resolveCallerIdentity 双身份检测实际读取的变量为准——CLAUDE_CODE_TOKEN/
 * SESSION_ID 与 SOCKET 同族（同 CALLER_IDENTITY_CONFLICT 报错的自纠 env -u
 * 清单）。启动器据此剥"另一家族"，把报错里的人工自纠机构化做掉；配置变量
 * （CODEX_HOME 等）绝不在此列。
 *
 * 扩展路径：将来不止 claude/codex 两家（如 opencode）——注册表加一行 + 写
 * 其启动器，其余启动器零改动自动剥它。resolveCallerIdentity 的第三家族
 * 识别分支不在本票：那是未来新适配器票的事（先走原生通道可行性调研，同
 * codex/claude 先例）。
 */
export type IdentityFamily = 'claude' | 'codex';

export const IDENTITY_ENV_FAMILIES: Record<IdentityFamily, readonly string[]> = {
  claude: [
    'CLAUDE_CODE_MESSAGING_SOCKET',
    'CLAUDE_CODE_MESSAGING_TOKEN',
    'CLAUDE_CODE_SESSION_ID',
  ],
  codex: ['CODEX_THREAD_ID', 'CODEX_SESSION_ID'],
};

/** 复制 env 并删除给定键（不改动原对象）。 */
export function stripEnvKeys(env: NodeJS.ProcessEnv, keys: readonly string[]): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = { ...env };
  for (const key of keys) delete clean[key];
  return clean;
}

/** 除自家外所有家族的身份键合集（启动器检测"对族在场"与剥离共用）。 */
export function otherIdentityKeys(own: IdentityFamily): readonly string[] {
  return (Object.keys(IDENTITY_ENV_FAMILIES) as IdentityFamily[])
    .filter((family) => family !== own)
    .flatMap((family) => IDENTITY_ENV_FAMILIES[family]);
}

/** 启动器身份清洗：复制 env 并删除"除自家外所有家族"的身份键（不改动原对象）。 */
export function stripOtherFamilies(env: NodeJS.ProcessEnv, own: IdentityFamily): NodeJS.ProcessEnv {
  return stripEnvKeys(env, otherIdentityKeys(own));
}

/** Canonical key used for rate-limit buckets ("claude:<id>" / "codex:<id>" / "human"). */
export function identityKey(identity: { p: string; id?: string }): string {
  return identity.p === 'human' || identity.id === undefined ? identity.p : `${identity.p}:${identity.id}`;
}

export function endpointOfIdentity(identity: CallerIdentity): RefEndpoint {
  return identity.p === 'human' ? { p: 'human' } : { p: identity.p, id: identity.id };
}

export function identityMatchesEndpoint(identity: CallerIdentity, endpoint: RefEndpoint): boolean {
  if (endpoint.p === 'human') return identity.p === 'human';
  if (identity.p === 'human') return false;
  return identity.p === endpoint.p && identity.id === endpoint.id;
}

export function resolveCallerIdentity(
  env: Record<string, string | undefined>,
  scan: ClaudeRegistryScan,
): CallerIdentity {
  const socket = env.CLAUDE_CODE_MESSAGING_SOCKET ?? '';
  const claude = socket !== '' ? claudeIdentity(socket, scan) : undefined;
  const codexId = env.CODEX_THREAD_ID || env.CODEX_SESSION_ID || '';
  if (claude !== undefined && codexId !== '') {
    const unsetHint =
      process.platform === 'win32'
        ? `（PowerShell 先 Remove-Item Env:CLAUDE_CODE_*）。`
        : `（bash 先 unset CLAUDE_CODE_*；单次用 env -u 前缀）。`;
    throw new MultichatError(
      'CALLER_IDENTITY_CONFLICT',
      `Caller identity conflict: both CLAUDE_CODE_* and CODEX_* identity variables are present (socket ${socket}, thread ${codexId}). ` +
        `自纠（临时）: 命令前缀 env -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN -u CLAUDE_CODE_SESSION_ID ` +
        unsetHint +
        `根治: 从干净终端重启 codex daemon（codex app-server daemon stop && codex app-server daemon start）` +
        `——daemon 会把启动时的环境传给它派生的所有 shell。`,
    );
  }
  if (claude !== undefined) return claude;
  if (codexId !== '') return { p: 'codex', id: codexId };
  return { p: 'human' };
}

function claudeIdentity(socket: string, scan: ClaudeRegistryScan): CallerIdentity {
  const matches = scan.sessions.filter(
    (session) => session.messagingSocketPath === socket && session.sessionId !== '',
  );
  const ids = new Set(matches.map((session) => session.sessionId));
  if (ids.size !== 1) {
    throw new MultichatError(
      'IDENTITY_UNRESOLVED',
      `CLAUDE_CODE_MESSAGING_SOCKET does not match exactly one routable Claude session (matched ${matches.length}); cannot determine the sender.`,
    );
  }
  const session = matches[0];
  return { p: 'claude', id: session.sessionId, name: session.name };
}
