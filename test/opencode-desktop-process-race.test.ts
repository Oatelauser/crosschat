import { join, resolve } from 'node:path';
import process from 'node:process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ realpath: vi.fn(), runCommand: vi.fn(), kill: vi.fn() }));
vi.mock('node:fs/promises', async (original) => ({ ...await original<typeof import('node:fs/promises')>(), realpath: boundary.realpath }));
vi.mock('node:process', async (original) => ({ default: { ...(await original<typeof import('node:process')>()).default, platform: 'win32', kill: boundary.kill } }));
vi.mock('./helpers/opencode-live-fixture.mjs', async (original) => ({ ...await original<typeof import('./helpers/opencode-live-fixture.mjs')>(), runCommand: boundary.runCommand }));

import { inspectDesktopRunProcesses } from './helpers/opencode-desktop-live-fixture.mjs';

const root = resolve('fixture-owned-desktop-run');
const ownedBinary = join(root, 'native', 'desktop.exe');
const otherBinary = join(resolve('fixture-unrelated-run'), 'TEMP~1', 'askpass.exe');
const owned = { ProcessId: 61001, ParentProcessId: 61000, ExecutablePath: ownedBinary };
const gone = { ProcessId: 62001, ParentProcessId: 62000, ExecutablePath: otherBinary };
const env = { SystemRoot: resolve('fixture-system-root') };

beforeEach(() => {
  vi.clearAllMocks();
  boundary.realpath.mockImplementation(async (path: string) => {
    if (path === root || path === ownedBinary) return path;
    if (path === otherBinary) throw Object.assign(new Error('Snapshot executable disappeared'), { code: 'ENOENT' });
    throw new Error('Unexpected path boundary');
  });
  boundary.runCommand.mockResolvedValue({ code: 0, signal: null, timedOut: false, ready: true, stdout: JSON.stringify([gone, owned]), stderr: '' });
});

describe('desktop executable snapshot races', () => {
  it('reports the bounded CIM timeout without trusting a partial process table', async () => {
    boundary.runCommand.mockResolvedValue({ code: null, signal: 'SIGTERM', timedOut: true, ready: true, timeoutStage: 'command',
      stdout: JSON.stringify([owned]), stderr: 'crosschat-cim:started' });
    const result = await inspectDesktopRunProcesses(root, env);
    expect(result).toMatchObject({ state: 'unknown', processes: [], error: expect.stringContaining('timed out after 5000ms') });
    expect(result.error).toContain('crosschat-cim:started');
    expect(boundary.realpath).toHaveBeenCalledExactlyOnceWith(root);
  });

  it('keeps startup expiry distinct from an expired metadata query', async () => {
    boundary.runCommand.mockResolvedValue({ code: null, timedOut: true, ready: false, timeoutStage: 'startup', stdout: '', stderr: 'crosschat-cim:started' });
    expect(await inspectDesktopRunProcesses(root, env)).toMatchObject({ state: 'unknown', error: expect.stringContaining('module initialization timed out after 30000ms') });
  });

  it('rejects a complete-looking table if module readiness was never confirmed', async () => {
    boundary.runCommand.mockResolvedValue({ code: 0, timedOut: false, ready: false, stdout: JSON.stringify([owned]), stderr: '' });
    expect(await inspectDesktopRunProcesses(root, env)).toMatchObject({ state: 'unknown', processes: [], error: expect.stringContaining('module readiness') });
  });

  it('ignores an unrelated short-path executable only after the sampled process has explicitly exited', async () => {
    boundary.kill.mockImplementation((pid: number) => {
      if (pid === gone.ProcessId) throw Object.assign(new Error('No such process'), { code: 'ESRCH' });
      return true;
    });
    const result = await inspectDesktopRunProcesses(root, env);
    expect(result).toEqual({ state: 'occupied', processes: [{ pid: owned.ProcessId, parentPid: owned.ParentProcessId, executablePath: ownedBinary }] });
    expect(boundary.kill).toHaveBeenCalledExactlyOnceWith(gone.ProcessId, 0);
    expect(boundary.runCommand).toHaveBeenCalledOnce();
  });

  it('retains unknown when a missing executable path still belongs to a live sampled PID', async () => {
    boundary.kill.mockReturnValue(true);
    const result = await inspectDesktopRunProcesses(root, env);
    expect(result).toMatchObject({ state: 'unknown', processes: [], error: expect.stringContaining('disappeared') });
    expect(boundary.runCommand).toHaveBeenCalledOnce();
    expect(boundary.kill).toHaveBeenCalledExactlyOnceWith(gone.ProcessId, 0);
  });

  it('retains unknown when the PID zero-signal check is denied or otherwise cannot establish exit', async () => {
    boundary.kill.mockImplementation(() => { throw Object.assign(new Error('Liveness inspection denied'), { code: 'EPERM' }); });
    const result = await inspectDesktopRunProcesses(root, env);
    expect(result).toMatchObject({ state: 'unknown', processes: [] });
    expect(boundary.kill).toHaveBeenCalledExactlyOnceWith(gone.ProcessId, 0);
    expect(boundary.runCommand).toHaveBeenCalledOnce();
    expect(process.platform).toBe('win32');
  });
});
