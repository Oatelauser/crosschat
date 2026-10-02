import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

it('--version prints the package.json version', () => {
  expect(pkg.version).toBe('1.0.0');
  const result = spawnSync(process.execPath, [cliPath, '--version'], {
    encoding: 'utf8',
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(`${pkg.version}\n`);
});

it('unknown command exits non-zero and reports to stderr with the crosschat prefix', () => {
  const result = spawnSync(
    process.execPath,
    [cliPath, 'definitely-not-a-command'],
    { encoding: 'utf8' },
  );
  expect(result.status).not.toBe(0);
  expect(result.stderr.split('\n')[0]).toContain('crosschat: USAGE: unknown command');
  expect(result.stderr).toContain('usage: crosschat <command>');
  expect(result.stderr).not.toContain('multichat');
});
