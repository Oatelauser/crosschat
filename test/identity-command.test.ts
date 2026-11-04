import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runIdentity } from '../src/commands/identity.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'crosschat-identity-command-'));
  directories.push(directory);
  return { directory, resolveCaller: vi.fn(() => ({ p: 'codex' as const, id: 'native-A' })), manualConfirmationApproved: () => true,
    probe: vi.fn(async () => ({ status: 'unresolved' as const, association: 'verified' as const, basis: 'native' as const,
      scope: 'origin' as const, sourceDomain: 'verified-origin', runtimeFingerprint: 'runtime-1' })),
    probePromptOwner: vi.fn(async () => 'active' as const) };
}
describe('identity command', () => {
  it('generates one program-owned context, then persists a user answer independently of send recipient type', async () => {
    const deps = await fixture();
    const first = await runIdentity([], deps);
    expect(first).toMatchObject({ status: 'confirmation-required', shouldAsk: true });
    expect(first.confirmationCommand).toContain(`--context ${first.context}`);
    expect(await runIdentity(['confirm', '--tool', 'codex-desktop', '--context', first.context!], deps)).toMatchObject({ status: 'confirmed', sourceTool: 'codex-desktop', basis: 'user' });
    expect(await runIdentity([], deps)).toMatchObject({ status: 'confirmed', shouldAsk: false });
  });

  it.each([
    ['confirm'], ['confirm', '--tool', 'codex-cli'], ['confirm', '--tool', 'codex-cli', '--context'],
    ['confirm', '--tool', 'codex-cli', '--tool', 'codex-desktop', '--context', 'x'],
    ['confirm', '--tool', 'unknown', '--context', 'x'], ['--tool', 'codex-cli'],
  ])('rejects invalid command arguments before reading native identity: %j', async (args) => {
    const deps = await fixture();
    await expect(runIdentity(args, deps)).rejects.toMatchObject({ code: 'USAGE' });
    expect(deps.resolveCaller).not.toHaveBeenCalled();
    expect(deps.probe).not.toHaveBeenCalled();
  });
});
