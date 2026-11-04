import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async (original) => ({ ...await original<typeof import('node:child_process')>(), spawn: boundary.spawn }));
vi.mock('node:timers', async (original) => ({
  ...await original<typeof import('node:timers')>(),
  setTimeout: (callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => globalThis.setTimeout(callback, delay, ...args),
  clearTimeout: (timer: Parameters<typeof globalThis.clearTimeout>[0]) => globalThis.clearTimeout(timer),
}));

import { runCommand } from './helpers/opencode-live-fixture.mjs';

let child: ChildProcess;
let stdout: PassThrough;
let stderr: PassThrough;
let kill: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  child = new ChildProcess();
  child.stdin = new PassThrough();
  stdout = new PassThrough(); stderr = new PassThrough();
  child.stdout = stdout; child.stderr = stderr;
  kill = vi.spyOn(child, 'kill').mockImplementation(() => { child.emit('close', null, 'SIGTERM'); return true; });
  boundary.spawn.mockReturnValue(child);
});
afterEach(() => {
  child.emit('close', null, null);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const options = { timeout: 50, startupTimeout: 200, readyLine: 'ready' };
describe('owned fixture command readiness and operation budgets', () => {
  it('allows bounded startup then gives the ready command its full operation budget', async () => {
    const pending = runCommand('owned', [], options);
    await vi.advanceTimersByTimeAsync(100);
    expect(kill).not.toHaveBeenCalled();
    stderr.write('starting\nrea');
    await vi.advanceTimersByTimeAsync(20);
    stderr.write('dy\r\n');
    await vi.advanceTimersByTimeAsync(49);
    expect(kill).not.toHaveBeenCalled();
    stdout.write('complete'); child.emit('close', 0, null);
    expect(await pending).toMatchObject({ code: 0, timedOut: false, ready: true, stdout: 'complete' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds missing readiness and ignores a marker that arrives after expiry', async () => {
    const pending = runCommand('owned', [], options);
    await vi.advanceTimersByTimeAsync(200);
    stderr.write('ready\n');
    expect(await pending).toMatchObject({ timedOut: true, ready: false, timeoutStage: 'startup' });
    expect(kill).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not extend an operation when readiness is repeated', async () => {
    const pending = runCommand('owned', [], options);
    stderr.write('ready\n');
    await vi.advanceTimersByTimeAsync(40);
    stderr.write('ready\n');
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toMatchObject({ timedOut: true, ready: true, timeoutStage: 'command' });
    expect(kill).toHaveBeenCalledOnce();
  });

  it('requires the complete readiness line rather than a substring or an overlong suffix', async () => {
    const pending = runCommand('owned', [], options);
    stderr.write('not-ready\n' + 'x'.repeat(2000)); stderr.write('ready\n');
    await vi.advanceTimersByTimeAsync(60);
    expect(kill).not.toHaveBeenCalled();
    stderr.write('ready\n');
    child.emit('close', 0, null);
    expect(await pending).toMatchObject({ code: 0, ready: true, timedOut: false });
  });

  it('does not infer readiness from a successful exit or JSON-looking output', async () => {
    const pending = runCommand('owned', [], options);
    stdout.write('[]'); child.emit('close', 0, null);
    expect(await pending).toMatchObject({ code: 0, ready: false, timedOut: false });
  });

  it('preserves the original single timeout and result shape without readiness options', async () => {
    const pending = runCommand('owned', [], { timeout: 50 });
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toEqual({ code: null, signal: 'SIGTERM', stdout: '', stderr: '', timedOut: true });
    expect(kill).toHaveBeenCalledOnce();
  });

  it('releases timers and only its own listeners when spawn fails', async () => {
    const unrelated = () => {};
    stderr.on('data', unrelated);
    const pending = runCommand('owned', [], options);
    const rejected = expect(pending).rejects.toThrow('spawn failed');
    child.emit('error', new Error('spawn failed'));
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    expect(stderr.listeners('data')).toEqual([unrelated]);
    expect(stdout.listenerCount('data')).toBe(0);
  });
});
