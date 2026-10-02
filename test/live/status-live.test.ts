import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

/**
 * Read-only live check: run the built CLI's `status --json` and assert it
 * exits 0 with a single line of parseable JSON. Never sends anything.
 */
const cliJs = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));

interface ExecResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [cliJs, ...args],
      { encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const status = err === null ? 0 : typeof err.code === 'number' ? err.code : -1;
        resolve({ status, stdout: stdout ?? '', stderr: stderr ?? '' });
      },
    );
  });
}

describe.skipIf(!process.env.CROSSCHAT_LIVE)('status live (read-only)', () => {
  it('exits 0 and prints one line of parseable JSON', { timeout: 300_000 }, async () => {
    expect(existsSync(cliJs), 'dist/cli.js is missing; run npm run build first').toBe(true);
    const result = await runCli(['status', '--json']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const lines = result.stdout.trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as { claude: unknown[]; codex: unknown };
    expect(Array.isArray(parsed.claude)).toBe(true);
    expect(parsed.codex).toBeDefined();
  });

  it('human-readable status also exits 0', { timeout: 300_000 }, async () => {
    const result = await runCli(['status']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('claude:');
    expect(result.stdout).toContain('codex:');
  });
});
