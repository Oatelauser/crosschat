import { ChildProcess } from 'node:child_process';
import { getEventListeners } from 'node:events';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runOwnedServiceProcess } from '../src/application/services/owned-process.js';

const originalPlatform = process.platform;
const groupId = 424242;

function missingGroup(): NodeJS.ErrnoException {
  return Object.assign(new Error('No such process group'), { code: 'ESRCH' });
}

function ownedFixture(options: { exitDelay?: number; groupError?: string } = {}) {
  const child = new ChildProcess();
  Object.defineProperty(child, 'pid', { value: groupId });
  child.send = vi.fn(() => true);
  let groupPresent = true;
  const exit = () => {
    child.signalCode = 'SIGKILL';
    child.emit('exit', null, 'SIGKILL');
  };
  const kill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (pid !== -groupId) throw new Error('The owner must target only its fixed process group');
    if (signal === 'SIGKILL') {
      if (options.exitDelay !== undefined) setTimeout(exit, options.exitDelay);
      return true;
    }
    if (signal !== 0) throw new Error('Unexpected cleanup signal');
    if (options.groupError !== undefined) throw Object.assign(new Error('Cannot inspect process group'), { code: options.groupError });
    if (!groupPresent) throw missingGroup();
    return true;
  });
  const signal = new AbortController().signal;
  const run = () => runOwnedServiceProcess({}, {
    entry: new URL('file:///isolated/owned-process.js'), signal, timeoutMs: 5000, createProcess: () => child,
  });
  function expectReleasedListeners() {
    for (const event of ['message', 'error', 'exit']) expect(child.listenerCount(event)).toBe(0);
    expect(getEventListeners(signal, 'abort')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  }
  return { child, kill, run, exit, removeGroup: () => { groupPresent = false; }, expectReleasedListeners };
}

beforeEach(() => {
  // Exercise the POSIX OS boundary on every host without starting real processes
  // or changing the existing real fork/scanner integration assertions.
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  Object.defineProperty(process, 'platform', { value: originalPlatform });
});

describe('owned POSIX process group completion', () => {
  it('keeps a completed request pending until the helper has exited and its scanner group has disappeared', async () => {
    const fixture = ownedFixture({ exitDelay: 10 });
    let settled = false;
    const pending = fixture.run().then((value) => { settled = true; return value; });
    fixture.child.emit('message', { state: 'ready' });
    await vi.advanceTimersByTimeAsync(30);
    expect(settled).toBe(false);
    fixture.removeGroup();
    await vi.advanceTimersByTimeAsync(30);
    expect(await pending).toEqual({ state: 'ready' });
    expect(fixture.kill.mock.calls.filter(([, signal]) => signal === 'SIGKILL')).toHaveLength(1);
    fixture.expectReleasedListeners();
  });

  it('reports bounded cleanup failure for a persistent scanner group without repeatedly sending kill signals', async () => {
    const fixture = ownedFixture({ exitDelay: 10 });
    const outcome = fixture.run().catch((error: unknown) => error);
    fixture.child.emit('message', { state: 'ready' });
    await vi.advanceTimersByTimeAsync(1100);
    expect(await outcome).toMatchObject({ code: 'cleanup' });
    expect(fixture.kill.mock.calls.filter(([, signal]) => signal === 'SIGKILL')).toHaveLength(1);
    fixture.expectReleasedListeners();
  });

  it.each(['EPERM', 'EIO'])('treats %s during group verification as cleanup failure rather than disappearance', async (groupError) => {
    const fixture = ownedFixture({ exitDelay: 10, groupError });
    const outcome = fixture.run().catch((error: unknown) => error);
    fixture.child.emit('message', { state: 'ready' });
    await vi.advanceTimersByTimeAsync(1100);
    expect(await outcome).toMatchObject({ code: 'cleanup' });
    expect(fixture.kill.mock.calls.filter(([, signal]) => signal === 'SIGKILL')).toHaveLength(1);
    fixture.expectReleasedListeners();
  });

  it('bounds waiting for a missing helper exit event and releases its temporary listener', async () => {
    const fixture = ownedFixture();
    let settled = false;
    const outcome = fixture.run().catch((error: unknown) => error).then((value) => { settled = true; return value; });
    fixture.child.emit('message', { state: 'ready' });
    fixture.removeGroup();
    try {
      await vi.advanceTimersByTimeAsync(1100);
      expect(settled).toBe(true);
      expect(await outcome).toMatchObject({ code: 'cleanup' });
      fixture.expectReleasedListeners();
    } finally {
      // Release the pre-fix implementation after the RED assertion, so the
      // reproducer itself does not retain a deliberately unresolved promise.
      fixture.exit();
      await outcome;
    }
  });

  it('does not kill a reused group after an unreported helper exit and reports incomplete cleanup', async () => {
    const fixture = ownedFixture();
    const outcome = fixture.run().catch((error: unknown) => error);
    fixture.exit();
    expect(await outcome).toMatchObject({ code: 'cleanup' });
    expect(fixture.kill.mock.calls.filter(([, signal]) => signal === 'SIGKILL')).toHaveLength(0);
    fixture.expectReleasedListeners();
  });

  it('retains the missing-receipt error when an exited helper group is gone and leaves no exit listener', async () => {
    const fixture = ownedFixture();
    const outcome = fixture.run().catch((error: unknown) => error);
    fixture.removeGroup();
    fixture.exit();
    expect(await outcome).toMatchObject({ code: 'exit' });
    expect(fixture.kill).toHaveBeenCalledWith(-groupId, 0);
    expect(fixture.kill.mock.calls.filter(([, signal]) => signal === 'SIGKILL')).toHaveLength(0);
    fixture.expectReleasedListeners();
  });
});
