import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { formatSendCommand } from '../src/tui/send-command.js';

describe('TUI send command templates', () => {
  it('keeps complete native IDs, slash characters and Unicode literal with a separate type', () => {
    expect(formatSendCommand({ to: 'session/原生完整-ID', tool: 'opencode' }, 'linux'))
      .toBe('crosschat send --to session/原生完整-ID --tool opencode --body "<正文>"');
    expect(formatSendCommand({ via: 'tcp:main:电脑A:full-native-id', tool: 'codex-desktop' }, 'win32'))
      .toBe('crosschat send --via tcp:main:电脑A:full-native-id --tool codex-desktop --body "<正文>"');
  });

  it('quotes PowerShell arguments without allowing interpolation or shell operators', () => {
    expect(formatSendCommand({ via: 'ssh:my host', to: "a'b;$env:PRIVATE`x", tool: 'claude' }, 'win32'))
      .toBe("crosschat send --via 'ssh:my host' --to 'a''b;$env:PRIVATE`x' --tool claude --body \"<正文>\"");
  });

  it('quotes POSIX arguments while preserving an embedded single quote', () => {
    expect(formatSendCommand({ to: "a'b;$(private)`x", tool: 'claude' }, 'darwin'))
      .toBe("crosschat send --to 'a'\\''b;$(private)`x' --tool claude --body \"<正文>\"");
  });

  it('round-trips opaque arguments through the current platform shell', () => {
    for (const nativeId of ['@opaque', '@opaque-id', "a'b;$env:PRIVATE`x", 'tcp:原生/完整-id']) {
      const command = formatSendCommand({ to: nativeId, tool: 'opencode' })!;
      const windows = process.platform === 'win32';
      const capture = windows
        ? 'function crosschat { ConvertTo-Json -InputObject @($args | ForEach-Object { [string]$_ }) -Compress }; '
        : 'crosschat() { printf \'%s\\0\' "$@"; }; ';
      const execution = spawnSync(windows ? 'powershell.exe' : '/bin/sh', windows
        ? ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ' + capture + command]
        : ['-c', capture + command], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
      expect(execution.status, execution.stderr).toBe(0);
      const args: unknown = windows ? JSON.parse(execution.stdout.trim()) : execution.stdout.split('\0').slice(0, -1);
      expect(args).toEqual(['send', '--to', nativeId, '--tool', 'opencode', '--body', '<正文>']);
    }
  });

  it('refuses incomplete targets, malformed types and control-bearing values', () => {
    expect(formatSendCommand({ tool: 'claude' })).toBeUndefined();
    expect(formatSendCommand({ to: '', tool: 'claude' })).toBeUndefined();
    expect(formatSendCommand({ to: 'native-id', tool: 'claude;echo' })).toBeUndefined();
    for (const control of ['\u0000', '\n', '\r', '\t', '\u007f', '\u0085']) {
      expect(formatSendCommand({ to: `native${control}id`, tool: 'claude' })).toBeUndefined();
      expect(formatSendCommand({ via: `ssh:host${control}`, to: 'native-id', tool: 'claude' })).toBeUndefined();
    }
  });
});
