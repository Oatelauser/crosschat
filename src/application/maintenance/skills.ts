import { cpSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export interface InstallSkillsArgs { dir?: string }
export interface InstallSkillsDeps { sourceDir(): string; defaultRoot(): string; env?: { DSH_HOME?: string } }
export function defaultInstallSkillsDeps(): InstallSkillsDeps {
  return { sourceDir: () => fileURLToPath(new URL('../../../skills/crosschat', import.meta.url)), defaultRoot: () => homedir(), env: { DSH_HOME: process.env.DSH_HOME } };
}
/** A skill copy plus the directory it must stay inside; a custom Harness home may sit outside the user home. */
export interface SkillTarget { label: string; path: string; root: string }
function harnessHome(root: string, env: { DSH_HOME?: string }): string {
  const value = env.DSH_HOME;
  if (value === undefined || value === '') return join(root, '.dsh');
  // A relative DSH_HOME would silently resolve against whatever cwd runs the command.
  if (!isAbsolute(value)) throw new Error(`DSH_HOME 必须是绝对路径：${value}`);
  return resolve(value);
}
/** Key by the verified identity of the deepest existing ancestor; a missing suffix follows platform case semantics. */
function targetKey(path: string): string {
  let current = resolve(path);
  const suffix: string[] = [];
  for (;;) {
    try {
      const stat = statSync(current, { bigint: true });
      if (stat.ino !== 0n) {
        const rest = suffix.join('/');
        // Windows resolves not-yet-created names case-insensitively; POSIX keeps distinct spellings apart.
        return `${stat.dev}:${stat.ino}:${process.platform === 'win32' ? rest.toLowerCase() : rest}`;
      }
      break;
    } catch { /* uninspectable here: keep walking up to an inspectable ancestor */ }
    const parent = dirname(current);
    if (parent === current) break;
    suffix.unshift(basename(current));
    current = parent;
  }
  return `path:${resolve(path)}`;
}
/** Ordered Claude, Codex, then Harness plan shared by install/update, CLI uninstall and TUI maintenance. */
export function skillPlan(root: string, env: { DSH_HOME?: string } = {}): SkillTarget[] {
  const harness = harnessHome(root, env);
  const targets = [
    { label: 'claude 侧 skill', path: join(root, '.claude', 'skills', 'crosschat'), root },
    { label: 'codex 侧 skill', path: join(root, '.codex', 'skills', 'crosschat'), root },
    { label: 'harness 侧 skill', path: join(harness, 'skills', 'crosschat'), root: harness },
  ];
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = targetKey(target.path);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
export function installSkillDestination(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true });
}
/** Same ordered, stop-on-first-failure overwrite semantics as install-skills. */
export function runInstallSkills(args: InstallSkillsArgs, deps: InstallSkillsDeps = defaultInstallSkillsDeps()): string[] {
  const source = deps.sourceDir();
  // An explicit --dir owns all three targets; the host DSH_HOME never leaks into it.
  const destinations = skillPlan(args.dir ?? deps.defaultRoot(), args.dir === undefined ? deps.env ?? {} : {}).map((target) => target.path);
  for (const destination of destinations) installSkillDestination(source, destination);
  return destinations;
}
