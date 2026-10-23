import { spawn } from 'node:child_process';
import process from 'node:process';
import { otherIdentityKeys, stripOtherFamilies } from '../identity.js';
import { splitLauncherKnobs, validateLauncherKnob } from '../limits.js';
import { realStarJoinDeps, splitStarLauncherArgs, StarJoiner } from './session-star.js';
import type { StarJoinDeps } from './session-star.js';

export interface OpenCodeWrapperDeps {
  resolveExe(): string;
  env?: NodeJS.ProcessEnv;
  spawnInherit(exe: string, args: readonly string[], env?: NodeJS.ProcessEnv): Promise<number>;
  star?: StarJoinDeps;
}

function defaultDeps(): OpenCodeWrapperDeps {
  return {
    resolveExe: () => process.env.CROSSCHAT_OPENCODE_BIN ?? 'opencode',
    spawnInherit: (exe, args, env) => new Promise((resolve, reject) => {
      const child = spawn(exe, args, { stdio: 'inherit', ...(env === undefined ? {} : { env }) });
      child.on('error', reject);
      child.on('close', (code) => resolve(code ?? 1));
    }),
  };
}

/** Native OpenCode owns its service and sessions; the launcher only adds crosschat options. */
export async function runOpenCodeWrapper(args: readonly string[], deps: OpenCodeWrapperDeps = defaultDeps()): Promise<number> {
  const star = splitStarLauncherArgs(args);
  const knobs = splitLauncherKnobs(star.passthrough);
  const maxBody = validateLauncherKnob('crosschat opencode', '--max-body-kb', knobs.maxBodyKb);
  const maxTurn = validateLauncherKnob('crosschat opencode', '--max-turn', knobs.maxTurn);
  const parent = deps.env ?? process.env;
  const needsEnv = maxBody !== undefined || maxTurn !== undefined || otherIdentityKeys('opencode').some((key) => parent[key] !== undefined);
  const env = needsEnv ? stripOtherFamilies({ ...parent,
    ...(maxBody === undefined ? {} : { CROSSCHAT_MAX_BODY_KIB: String(maxBody) }),
    ...(maxTurn === undefined ? {} : { CROSSCHAT_MAX_TURN: String(maxTurn) }),
  }, 'opencode') : undefined;
  if (star.connects.length === 0) return deps.spawnInherit(deps.resolveExe(), knobs.passthrough, env);
  const joiner = new StarJoiner({ deps: deps.star ?? realStarJoinDeps(), side: 'opencode', connects: star.connects,
    ...(star.extendSession === undefined ? {} : { extendSession: star.extendSession }), ...(star.rm === true ? { rm: true } : {}),
  });
  await joiner.begin();
  try { return await deps.spawnInherit(deps.resolveExe(), knobs.passthrough, env); }
  finally { await joiner.stop(); }
}
