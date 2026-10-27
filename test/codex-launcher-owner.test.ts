import { describe, expect, it, vi } from 'vitest';
import { startInstalledCodexOwner } from '../src/codex/launcher-owner.js';

describe('Codex launcher native owner startup', () => {
  it('starts only the already installed matching native package, never bootstrap/update', async () => {
    const run = vi.fn(async (executable: string, args: readonly string[]) => { expect(executable).toBeTruthy(); return args[0] === '--version' ? 'codex-cli 0.163.0\n' : 'started'; });
    await startInstalledCodexOwner({ executable: 'fixture-codex', env: { CODEX_HOME: 'fixture-home' }, installed: async () => true, run });
    expect(run.mock.calls.map((call) => call[1])).toEqual([['--version'], ['--version'], ['app-server', 'daemon', 'start']]);
  });

  it('does not install missing packages or update a mismatched version', async () => {
    const run = vi.fn(async (executable: string) => executable === 'fixture-codex' ? 'codex-cli 0.163.0' : 'codex-cli 0.162.0');
    await expect(startInstalledCodexOwner({ executable: 'fixture-codex', env: {}, installed: async () => false, run })).rejects.toThrow('daemon start');
    expect(run).not.toHaveBeenCalled();
    await expect(startInstalledCodexOwner({ executable: 'fixture-codex', env: {}, installed: async () => true, run })).rejects.toThrow('daemon start');
    expect(run).toHaveBeenCalledTimes(2);
  });
});
