import { describe, expect, it, vi } from 'vitest';
import { runOpenCodeWrapper } from '../src/commands/opencode-wrapper.js';
import { parseStatusArgs } from '../src/cli.js';

describe('OpenCode native launcher', () => {
  it('forwards native arguments and launcher budgets while stripping foreign identities', async () => {
    const spawnInherit = vi.fn(async () => 0);
    await runOpenCodeWrapper(['--max-turn', '8', '--max-body-kb=64', 'run', 'hello'], {
      resolveExe: () => 'opencode.exe', env: { CODEX_THREAD_ID: 'outer', HOME: 'fixture-home' }, spawnInherit,
    });
    expect(spawnInherit).toHaveBeenCalledWith('opencode.exe', ['run', 'hello'], expect.objectContaining({ HOME: 'fixture-home', CROSSCHAT_MAX_TURN: '8', CROSSCHAT_MAX_BODY_KIB: '64' }));
    expect(spawnInherit.mock.calls[0][2]).not.toHaveProperty('CODEX_THREAD_ID');
  });
  it('preserves the native exit code and does not inject model configuration', async () => {
    const spawnInherit = vi.fn(async () => 7);
    expect(await runOpenCodeWrapper(['--version'], { resolveExe: () => 'opencode.exe', env: {}, spawnInherit })).toBe(7);
    expect(spawnInherit).toHaveBeenCalledWith('opencode.exe', ['--version'], undefined);
  });
  it('offers an explicit status section without changing the default selection', () => {
    expect(parseStatusArgs(['--opencode']).filters.section).toBe('opencode');
    expect(parseStatusArgs([]).filters?.section).toBeUndefined();
  });
});
