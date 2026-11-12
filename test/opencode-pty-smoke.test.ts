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

  it('binds the enhancement fixture broker to loopback before starting a native node', async () => {
    const helperUrl = new URL('./helpers/opencode-native-enhancement.mjs', import.meta.url).href;
    const brokerUrl = new URL('../dist/serve/broker.js', import.meta.url).href;
    const child = await runCommand(process.execPath, ['--input-type=module', '--eval', `
      import { mkdtemp, rm } from 'node:fs/promises';
      import { tmpdir } from 'node:os';
      import { join } from 'node:path';
      const { Broker } = await import(${JSON.stringify(brokerUrl)});
      const { validateOpenCodeNativeEnhancement } = await import(${JSON.stringify(helperUrl)});
      const root = await mkdtemp(join(tmpdir(), 'crosschat-opencode-bind-'));
      const stopped = new Error('Stop after observing the fixture listener');
      const start = Broker.prototype.start;
      Broker.prototype.start = async function () {
        await start.call(this);
        process.stdout.write(JSON.stringify(this.wss.address()));
        throw stopped;
      };
      try {
        await validateOpenCodeNativeEnhancement({
          fixture: { root, env: {}, api: async () => ({ data: { id: 'fixture-session', title: 'fixture' } }) },
          session: { id: 'fixture-session' }, waitForNativeTitle: async () => {},
          evidenceDirectory: join(root, 'evidence'),
        });
      } catch (error) {
        if (error !== stopped) throw error;
        if (!error.nativeEnhancementReport?.cleanup?.complete) throw new Error('Broker cleanup failed');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    `], { cwd: repositoryRoot, timeout: 10000 });
    expect(child.code, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toMatchObject({ address: '127.0.0.1' });
  });
});
