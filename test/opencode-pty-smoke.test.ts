import { describe, expect, it } from 'vitest';
import { runCommand, repositoryRoot } from './helpers/opencode-live-fixture.mjs';
import { supportsOpenCodePtySmokePlatform } from '../scripts/opencode-pty-smoke.mjs';

describe('OpenCode native PTY smoke platform support', () => {
  it('supports the native Windows and Linux PTY hosts only', () => {
    expect(supportsOpenCodePtySmokePlatform('win32')).toBe(true);
    expect(supportsOpenCodePtySmokePlatform('linux')).toBe(true);
    expect(supportsOpenCodePtySmokePlatform('darwin')).toBe(false);
  });

  it('does not run the C22 TUI child when its helper is imported by another child process', async () => {
    const helperUrl = new URL('./helpers/opencode-native-multinode.mjs', import.meta.url).href;
    const child = await runCommand(process.execPath, ['--input-type=module', '--eval',
      `process.argv.push('--tui-child'); await import(${JSON.stringify(helperUrl)});`], { cwd: repositoryRoot, timeout: 10000 });
    expect(child.code).toBe(0);
    expect(child.stderr).toBe('');
  });
});
