import { spawn } from 'node:child_process';
import { MultichatError } from '../errors.js';
import { resolveClaudeExe } from '../claude/resolve-exe.js';

/**
 * `crosschat claude [args...]`: start the real claude CLI with
 * `crossSessionInbound: accept` so peer sessions can inject messages
 * (ticket 002: without it inbound frames sit in parity hold).
 */

const INBOUND_SETTINGS = JSON.stringify({ crossSessionInbound: 'accept' });

export interface ClaudeWrapperDeps {
  resolveExe(): string;
  /** Spawns interactively (stdio inherit); resolves to the child's exit code. */
  spawnInherit(exe: string, args: readonly string[]): Promise<number>;
}

export function defaultClaudeWrapperDeps(): ClaudeWrapperDeps {
  return {
    resolveExe: () => resolveClaudeExe(),
    spawnInherit: (exe, args) =>
      new Promise((resolve, reject) => {
        const child = spawn(exe, args, { stdio: 'inherit' });
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
  const exe = deps.resolveExe();
  return deps.spawnInherit(exe, ['--settings', INBOUND_SETTINGS, ...args]);
}
