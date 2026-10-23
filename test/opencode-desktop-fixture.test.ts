import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDesktopEnvironment } from './helpers/opencode-desktop-live-fixture.mjs';
import { runCommand } from './helpers/opencode-live-fixture.mjs';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  const temp = await realpath(tmpdir());
  for (const root of roots.splice(0)) {
    const target = await realpath(root);
    const child = relative(temp, target);
    if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new Error('Unsafe fixture unit cleanup path');
    await rm(target, { recursive: true, force: true });
  }
});

describe('official desktop test environment', () => {
  it('keeps the desktop initial state and Windows post-initialization fallback in the same owned profile', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'crosschat-desktop-fixture-unit-')));
    roots.push(root);
    vi.stubEnv('OPENAI_API_KEY', 'must-not-reach-upstream');
    vi.stubEnv('GITHUB_TOKEN', 'must-not-reach-upstream');
    vi.stubEnv('CODEX_THREAD_ID', 'foreign-session');
    const env = createDesktopEnvironment(root);
    const result = await runCommand(process.execPath, ['--input-type=module', '-e', `
      import { homedir, tmpdir } from 'node:os';
      import { join } from 'node:path';
      const initial = process.env.XDG_STATE_HOME;
      delete process.env.XDG_STATE_HOME;
      console.log(JSON.stringify({ home: homedir(), temporary: tmpdir(), initial,
        fallback: join(homedir(), '.local', 'state'), testRoot: process.env.OPENCODE_DESKTOP_TEST_ROOT,
        foreign: ['OPENAI_API_KEY','GITHUB_TOKEN','CODEX_THREAD_ID'].some((key) => process.env[key]) }));
    `], { env });
    expect(result.code).toBe(0);
    const child = JSON.parse(result.stdout);
    expect(child).toMatchObject({ home: join(root, 'profile'), temporary: join(root, 'tmp'), initial: join(root, 'profile', '.local', 'state'), fallback: join(root, 'profile', '.local', 'state'), testRoot: join(root, 'profile', '.local'), foreign: false });
    expect(env.OPENCODE_CONFIG_DIR).toBe(join(root, 'profile', '.local', 'config', 'opencode'));
    expect(env.APPDATA.startsWith(root)).toBe(true);
    expect(env.LOCALAPPDATA.startsWith(root)).toBe(true);
  });
});
