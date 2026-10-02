import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parseInstallSkillsArgs } from '../src/cli.js';
import { runInstallSkills } from '../src/commands/install-skills.js';
import { MultichatError } from '../src/errors.js';

const realSourceDir = fileURLToPath(new URL('../skills/crosschat', import.meta.url));
const tmpRoot = mkdtempSync(join(tmpdir(), 'crosschat-skills-'));
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

/** Recursive file snapshot (path -> content) for equality checks. */
function snapshot(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) for (const [path, content] of snapshot(full)) files.set(`${entry.name}/${path}`, content);
    else files.set(entry.name, readFileSync(full, 'utf8'));
  }
  return files;
}

describe('runInstallSkills', () => {
  it('installs into .claude and .codex under the injected root with identical content', () => {
    const root = join(tmpRoot, 'default-root');
    const paths = runInstallSkills({}, { sourceDir: () => realSourceDir, defaultRoot: () => root });
    expect(paths).toEqual([
      join(root, '.claude', 'skills', 'crosschat'),
      join(root, '.codex', 'skills', 'crosschat'),
    ]);
    const source = snapshot(realSourceDir);
    expect(source.size).toBeGreaterThan(0);
    for (const path of paths) expect(snapshot(path)).toEqual(source);
  });

  it('is idempotent: reinstalling overwrites with identical content', () => {
    const root = join(tmpRoot, 'idem-root');
    const deps = { sourceDir: () => realSourceDir, defaultRoot: () => root };
    runInstallSkills({}, deps);
    const first = snapshot(join(root, '.claude', 'skills', 'crosschat'));
    runInstallSkills({}, deps);
    expect(snapshot(join(root, '.claude', 'skills', 'crosschat'))).toEqual(first);
  });

  it('honors --dir override for the root', () => {
    const alt = join(tmpRoot, 'alt-root');
    const paths = runInstallSkills({ dir: alt }, { sourceDir: () => realSourceDir, defaultRoot: () => join(tmpRoot, 'should-not-exist') });
    expect(paths).toEqual([
      join(alt, '.claude', 'skills', 'crosschat'),
      join(alt, '.codex', 'skills', 'crosschat'),
    ]);
    expect(existsSync(join(alt, '.claude', 'skills', 'crosschat', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(alt, '.codex', 'skills', 'crosschat', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(tmpRoot, 'should-not-exist'))).toBe(false);
  });

  it('copies the whole source directory, not just SKILL.md', () => {
    const source = join(tmpRoot, 'fixture-source');
    mkdirSync(source);
    writeFileSync(join(source, 'SKILL.md'), 'fixture skill');
    writeFileSync(join(source, 'extra.md'), 'extra file');
    const root = join(tmpRoot, 'fixture-root');
    runInstallSkills({ dir: root }, { sourceDir: () => source, defaultRoot: () => root });
    expect(readFileSync(join(root, '.claude', 'skills', 'crosschat', 'extra.md'), 'utf8')).toBe('extra file');
  });
});

describe('parseInstallSkillsArgs', () => {
  it('parses --dir in both forms and empty argv', () => {
    expect(parseInstallSkillsArgs([])).toEqual({});
    expect(parseInstallSkillsArgs(['--dir', 'C:/tmp'])).toEqual({ dir: 'C:/tmp' });
    expect(parseInstallSkillsArgs(['--dir=C:/tmp'])).toEqual({ dir: 'C:/tmp' });
  });

  it('rejects unknown options, positionals, and a missing value', () => {
    const expectUsage = (argv: readonly string[], needle: string): void => {
      try {
        parseInstallSkillsArgs(argv);
        expect.unreachable('should have thrown USAGE');
      } catch (err) {
        expect(err).toBeInstanceOf(MultichatError);
        expect((err as MultichatError).code).toBe('USAGE');
        expect((err as MultichatError).message).toContain(needle);
      }
    };
    expectUsage(['--wat'], 'unknown option');
    expectUsage(['root'], 'unexpected argument');
    expectUsage(['--dir'], 'requires a value');
  });
});
