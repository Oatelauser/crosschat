import { cpSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface InstallSkillsArgs { dir?: string }
export interface InstallSkillsDeps { sourceDir(): string; defaultRoot(): string }
export function defaultInstallSkillsDeps(): InstallSkillsDeps {
  return { sourceDir: () => fileURLToPath(new URL('../../../skills/crosschat', import.meta.url)), defaultRoot: () => homedir() };
}
export function skillDestinations(root: string): string[] {
  return ['.claude', '.codex'].map((directory) => join(root, directory, 'skills', 'crosschat'));
}
export function installSkillDestination(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true });
}
/** Same ordered, stop-on-first-failure overwrite semantics as install-skills. */
export function runInstallSkills(args: InstallSkillsArgs, deps: InstallSkillsDeps = defaultInstallSkillsDeps()): string[] {
  const source = deps.sourceDir();
  const destinations = skillDestinations(args.dir ?? deps.defaultRoot());
  for (const destination of destinations) installSkillDestination(source, destination);
  return destinations;
}
