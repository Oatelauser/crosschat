import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

describe('C22 enhancement candidate stays manual and unprivileged', () => {
  it('selects four explicit OS/architecture targets', async () => {
    const workflow = await readFile(new URL('../.github/workflows/dsh-enhancement.yml', import.meta.url), 'utf8');
    const line = workflow.split('\n').find(value => value.trimStart().startsWith('include: ${{'))!;
    const expression = line.slice(line.indexOf('${{') + 3, line.lastIndexOf('}}')).trim();
    expect(runInNewContext(expression, { fromJSON: JSON.parse })).toEqual([
      { runner: 'windows-latest', platform: 'win32', arch: 'x64' },
      { runner: 'ubuntu-24.04', platform: 'linux', arch: 'x64' },
      { runner: 'macos-15-intel', platform: 'darwin', arch: 'x64' },
      { runner: 'macos-15', platform: 'darwin', arch: 'arm64' },
    ]);
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s*(schedule|push|pull_request|issues):/mu);
    expect(workflow).not.toContain('write'); expect(workflow).not.toContain('github-script');
  });
  it('pins the runtime, checks POSIX PTY, and always retains separate evidence', async () => {
    const workflow = await readFile(new URL('../.github/workflows/dsh-enhancement.yml', import.meta.url), 'utf8');
    for (const required of ['contents: read', "node-version: '22.23.4'", 'architecture: ${{ matrix.arch }}',
      'actions/setup-python@v6', "python-version: '3.12'", "if: matrix.platform != 'win32'",
      'node test/helpers/tui-posix-pty-selftest.mjs dsh-enhancement-evidence/terminal-preflight',
      "TMPDIR: ${{ matrix.platform != 'win32' && '/tmp' || '' }}", 'node scripts/dsh-enhancement-ci.mjs',
      'DSH_EXPECTED_PLATFORM: ${{ matrix.platform }}', 'DSH_EXPECTED_ARCH: ${{ matrix.arch }}',
      'if: always()', 'name: dsh-enhancement-${{ matrix.platform }}-${{ matrix.arch }}',
      'path: dsh-enhancement-evidence/', 'retention-days: 21']) expect(workflow).toContain(required);
    expect(workflow.indexOf('tui-posix-pty-selftest')).toBeLessThan(workflow.indexOf('node scripts/dsh-enhancement-ci.mjs'));
  });
});
