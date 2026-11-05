import { ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async (original) => ({ ...await original<typeof import('node:child_process')>(), spawn: boundary.spawn }));
vi.mock('node:timers', async (original) => ({
  ...await original<typeof import('node:timers')>(),
  setTimeout: (callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => globalThis.setTimeout(callback, delay, ...args),
  clearTimeout: (timer: Parameters<typeof globalThis.clearTimeout>[0]) => globalThis.clearTimeout(timer),
}));

import { installDshNpmDependencies } from '../scripts/dsh-compat-ci.mjs';

let child: ChildProcess;
let stdout: PassThrough;
let stderr: PassThrough;
const options = { npmCLI: resolve('fixture npm-cli.mjs'), runtime: resolve('fixture-runtime'), existingLock: false, label: 'baseline', env: { HOME: 'owned-profile', FIXTURE_SECRET: 'do-not-print-this' } };
beforeEach(() => {
  vi.useFakeTimers();
  child = new ChildProcess(); stdout = new PassThrough(); stderr = new PassThrough();
  child.stdout = stdout; child.stderr = stderr;
  vi.spyOn(child, 'kill').mockReturnValue(true);
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  boundary.spawn.mockReturnValue(child);
});
afterEach(() => {
  child.emit('close', 0, null);
  vi.restoreAllMocks(); vi.useRealTimers();
});

describe('isolated official npm installation policy', () => {
  it('allows a slow cold install to finish after the former fifteen-minute deadline', async () => {
    const pending = installDshNpmDependencies(options);
    await vi.advanceTimersByTimeAsync(16 * 60 * 1000);
    expect(child.kill).not.toHaveBeenCalled();
    stdout.write('installed'); child.emit('close', 0, null);
    expect(await pending).toMatchObject({ code: 0, signal: null, timedOut: false, stdout: 'installed' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still bounds a stalled installer at twenty minutes without claiming release', async () => {
    const pending = installDshNpmDependencies(options);
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000 - 1);
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ code: null, signal: null, timedOut: true });
    expect(child.kill).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])('uses the exact private profile and safe npm policy with existingLock=%s', async (existingLock) => {
    const pending = installDshNpmDependencies({ ...options, existingLock });
    const [binary, args, spawnOptions] = boundary.spawn.mock.calls.at(-1)!;
    expect(binary).toBe(process.execPath);
    expect(args).toEqual([options.npmCLI, existingLock ? 'ci' : 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', '--timing']);
    expect(spawnOptions).toMatchObject({ env: options.env, cwd: options.runtime, shell: false });
    child.emit('close', 0, null); await pending;
  });

  it('records bounded phase progress without printing environment secrets or changing installer output', async () => {
    const pending = installDshNpmDependencies(options);
    stdout.write('npm-result'); stderr.write('npm-timing'); child.emit('close', 0, null);
    expect(await pending).toMatchObject({ stdout: 'npm-result', stderr: 'npm-timing', code: 0 });
    const progress = vi.mocked(process.stderr.write).mock.calls.map(call => String(call[0])).join('');
    expect(progress).toContain('baseline'); expect(progress).toContain('started'); expect(progress).toContain('exited 0');
    expect(progress).not.toContain(options.env.FIXTURE_SECRET);
  });
});
