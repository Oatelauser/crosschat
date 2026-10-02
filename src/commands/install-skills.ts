import { cpSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `crosschat install-skills`: copy the repo's skills/crosschat into
 * <root>/.claude/skills/crosschat and <root>/.codex/skills/crosschat so both
 * agent families learn the protocol from a local skill (low-invasion: the
 * mechanism ships its own teaching, prompts stay role-only).
 */

export interface InstallSkillsArgs {
  /** Root override (--dir); defaults to the user's home directory. */
  dir?: string;
}

export interface InstallSkillsDeps {
  sourceDir(): string;
  defaultRoot(): string;
}

export function defaultInstallSkillsDeps(): InstallSkillsDeps {
  return {
    // src/commands/ and dist/commands/ are both two levels below the package root.
    sourceDir: () => fileURLToPath(new URL('../../skills/crosschat', import.meta.url)),
    defaultRoot: () => homedir(),
  };
}

const DEST_ROOTS = ['.claude', '.codex'] as const;

/** Copies the skill over both destinations (mkdir + overwrite = idempotent); returns the installed paths. */
export function runInstallSkills(
  args: InstallSkillsArgs,
  deps: InstallSkillsDeps = defaultInstallSkillsDeps(),
): string[] {
  const source = deps.sourceDir();
  const root = args.dir ?? deps.defaultRoot();
  const installed: string[] = [];
  for (const destRoot of DEST_ROOTS) {
    const dest = join(root, destRoot, 'skills', 'crosschat');
    mkdirSync(dest, { recursive: true });
    cpSync(source, dest, { recursive: true });
    installed.push(dest);
  }
  return installed;
}
