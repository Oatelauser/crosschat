import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parseDiagnosticResult } from '../src/application/diagnostics/query.js';
import { renderDoctorDiagnostics } from '../src/application/diagnostics/render.js';
import { runInstallSkills } from '../src/commands/install-skills.js';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'crosschat-doctor-json-')); homes.push(home);
  const outbox = join(home, '.crosschat', 'outbox');
  mkdirSync(outbox, { recursive: true });
  writeFileSync(join(outbox, 'untouched.json'), '{"items":[]}');
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: join(home, 'appdata'), LOCALAPPDATA: join(home, 'localappdata'),
    CODEX_HOME: join(home, '.codex'), CODEX_SQLITE_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'),
    DSH_HOME: join(home, '.dsh'),
    PATH: '', CROSSCHAT_CODEX_BIN: join(home, 'unavailable-codex'), CROSSCHAT_CLAUDE_BIN: join(home, 'unavailable-claude'), CROSSCHAT_LIVE: undefined };
  const run = (args: string[], overrides: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, [cli, 'doctor', ...args], { encoding: 'utf8', env: { ...env, ...overrides }, timeout: 5000, windowsHide: true });
  return { home, outbox, run };
}

describe('doctor JSON CLI extension', () => {
  it('diagnoses the exact custom Harness copy installed by the shared maintenance plan without repairing it', () => {
    const { home, run } = fixture();
    const dshHome = join(home, 'custom-harness');
    const source = fileURLToPath(new URL('../skills/crosschat', import.meta.url));
    const installed = runInstallSkills({}, { sourceDir: () => source, defaultRoot: () => home, env: { DSH_HOME: dshHome } });
    const skillDir = installed[2]!;
    const matching = run(['--json'], { DSH_HOME: dshHome });
    expect(matching.status, matching.stderr).toBe(0);
    const checks = parseDiagnosticResult(JSON.parse(matching.stdout)).groups.flatMap((group) => group.checks);
    expect(checks).toContainEqual({ code: 'skill-match', level: 'pass', data: { side: 'harness' } });

    const reference = join(skillDir, 'references', 'send.md');
    writeFileSync(reference, 'fixture stale reference');
    const mismatching = run(['--json'], { DSH_HOME: dshHome });
    expect(mismatching.status, mismatching.stderr).toBe(0);
    const report = parseDiagnosticResult(JSON.parse(mismatching.stdout));
    expect(report.groups.flatMap((group) => group.checks)).toContainEqual({
      code: 'skill-mismatch', level: 'warn', data: { side: 'harness', paths: ['references/send.md'] },
    });
    const text = run([], { DSH_HOME: dshHome });
    expect(text.stdout).toBe(`${renderDoctorDiagnostics(report).output}\n`);
    expect(readFileSync(reference, 'utf8')).toBe('fixture stale reference');
    expect(readdirSync(home)).not.toContain('.dsh');

    const invalid = run(['--json'], { DSH_HOME: 'relative-harness' });
    expect(invalid.status, invalid.stderr).toBe(0);
    const invalidChecks = parseDiagnosticResult(JSON.parse(invalid.stdout)).groups.flatMap((group) => group.checks);
    expect(invalidChecks).toContainEqual({ code: 'harness-home-invalid', level: 'warn', data: { value: 'relative-harness' } });
    expect(invalidChecks.filter((check) => check.code.startsWith('skill-'))).toHaveLength(2);
  });

  it('returns the structured checks and preserves the existing default report and exit severity', () => {
    const { outbox, run } = fixture();
    const json = run(['--json']);
    expect(json.status, json.stderr).toBe(0);
    const result = parseDiagnosticResult(JSON.parse(json.stdout));
    const text = run([]);
    expect(text.status, text.stderr).toBe(json.status);
    expect(text.stdout).toBe(`${renderDoctorDiagnostics(result).output}\n`);
    expect(json.stderr).toBe('');
    expect(result.summary.failed).toBe(false);
    expect(readFileSync(join(outbox, 'untouched.json'), 'utf8')).toBe('{"items":[]}');
    expect(readdirSync(outbox)).toEqual(['untouched.json']);
  });

  it('emits valid structured findings with exit one for a failed check and rejects extra options', () => {
    const { home, run } = fixture();
    mkdirSync(join(home, '.crosschat', 'tcp'), { recursive: true });
    writeFileSync(join(home, '.crosschat', 'tcp', 'node.json'), '{broken-secret-key');
    const failed = run(['--json']);
    expect(failed.status, failed.stderr).toBe(1);
    const result = parseDiagnosticResult(JSON.parse(failed.stdout));
    expect(result.summary.failed).toBe(true);
    expect(result.groups.flatMap((group) => group.checks)).toContainEqual(expect.objectContaining({ code: 'node-config-invalid', level: 'error' }));
    expect(failed.stdout).not.toContain('secret-key');
    for (const args of [['--json', '--extra'], ['--json', '--json']]) {
      const invalid = run(args);
      expect(invalid.status).toBe(1);
      expect(invalid.stdout).toBe('');
      expect(invalid.stderr).toContain('USAGE');
    }
  });
});
