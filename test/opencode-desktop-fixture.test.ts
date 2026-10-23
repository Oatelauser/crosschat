import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectDesktopRunProcesses, prepareDesktopProfile } from './helpers/opencode-desktop-live-fixture.mjs';
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
    const env = await prepareDesktopProfile(root);
    expect(JSON.parse(await readFile(join(env.OPENCODE_DESKTOP_TEST_ROOT, 'desktop', 'opencode.settings'), 'utf8'))).toEqual({ firstLaunchOnboardingComplete: true });
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

  it.skipIf(process.platform !== 'win32')('reports an unregistered executable under the owned run before allowing cleanup', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'crosschat-desktop-fixture-unit-')));
    roots.push(root);
    const env = await prepareDesktopProfile(root);
    const binary = join(root, 'native', 'ping.exe');
    await mkdir(join(root, 'native'));
    await copyFile(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'PING.EXE'), binary);
    const child = spawn(binary, ['-t', '127.0.0.1'], { env, cwd: root, windowsHide: true, stdio: 'ignore' });
    const exited = new Promise<void>((done) => child.once('close', () => done()));
    try {
      await new Promise<void>((done, reject) => { child.once('spawn', done); child.once('error', reject); });
      expect(child.pid).toBeTypeOf('number');
      expect(child.exitCode).toBeNull();
      const inspection = await inspectDesktopRunProcesses(root, env);
      expect(inspection.state).toBe('occupied');
      expect(inspection.processes).toContainEqual({ pid: child.pid, parentPid: process.pid, executablePath: binary });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited;
    }
    const stopped = await inspectDesktopRunProcesses(root, env);
    expect(stopped).toMatchObject({ state: 'clear', processes: [] });
  }, 20000);
});
