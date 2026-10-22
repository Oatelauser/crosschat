import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { runTerminalSession } from '../src/tui/terminal.js';

class Input extends PassThrough {
  isTTY = true;
  isRaw = false;
  readonly rawModes: boolean[] = [];
  setRawMode(value: boolean): this { this.isRaw = value; this.rawModes.push(value); return this; }
}
class Output extends PassThrough { isTTY = true; columns = 80; rows = 24; }
function fixture() {
  const stdin = new Input();
  const stdout = new Output();
  const stderr = new PassThrough();
  const signals = new EventEmitter();
  let output = '';
  let error = '';
  stdout.on('data', (chunk) => { output += String(chunk); });
  stderr.on('data', (chunk) => { error += String(chunk); });
  return { stdin, stdout, stderr, signals, output: () => output, error: () => error };
}

describe('TUI terminal ownership', () => {
  it('rejects non-TTY before mounting or touching stdin', async () => {
    const io = fixture();
    io.stdin.isTTY = false;
    const mount = vi.fn();
    expect(await runTerminalSession({ ...io, mount })).toBe(1);
    expect(mount).not.toHaveBeenCalled();
    expect(io.stdin.rawModes).toEqual([]);
    expect(io.error()).toContain('交互终端');
    expect(io.output()).toBe('');
  });

  it('restores raw mode, cursor, paste mode and listeners after normal exit', async () => {
    const io = fixture();
    const dispose = vi.fn();
    let signal: AbortSignal | undefined;
    const code = await runTerminalSession({ ...io, mount: async (owner) => {
      signal = owner.signal;
      io.stdin.setRawMode(true);
      owner.exit();
      return { done: new Promise<void>(() => undefined), dispose };
    } });
    expect(code).toBe(0);
    expect(dispose).toHaveBeenCalledOnce();
    expect(signal?.aborted).toBe(true);
    expect(io.stdin.isRaw).toBe(false);
    expect(io.output()).toContain('\u001b[?25h');
    expect(io.output()).toContain('\u001b[?2004l');
    for (const event of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection', 'exit']) expect(io.signals.listenerCount(event)).toBe(0);
  });

  it('preserves the caller raw/paused state and closes on stdin end', async () => {
    const io = fixture();
    io.stdin.isRaw = true;
    io.stdin.pause();
    const dispose = vi.fn();
    const pending = runTerminalSession({ ...io, mount: async () => {
      io.stdin.setRawMode(false);
      io.stdin.resume();
      return { done: new Promise<void>(() => undefined), dispose };
    } });
    await vi.waitFor(() => expect(io.signals.listenerCount('SIGTERM')).toBe(1));
    io.stdin.emit('end');
    expect(await pending).toBe(0);
    expect(io.stdin.isRaw).toBe(true);
    expect(io.stdin.isPaused()).toBe(true);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('routes first SIGINT to read cancellation and permits a later interrupt to exit', async () => {
    const io = fixture();
    let exit!: () => void;
    let interrupts = 0;
    const pending = runTerminalSession({ ...io, mount: async (owner) => {
      exit = owner.exit;
      return { done: new Promise<void>(() => undefined), dispose: () => undefined,
        interrupt: () => { if (++interrupts > 1) exit(); } };
    } });
    await vi.waitFor(() => expect(exit).toBeTypeOf('function'));
    io.signals.emit('SIGINT');
    expect(interrupts).toBe(1);
    io.signals.emit('SIGINT');
    expect(await pending).toBe(0);
  });

  it('restores terminal on mount/render errors without echoing secret-bearing exceptions', async () => {
    const io = fixture();
    expect(await runTerminalSession({ ...io, mount: async () => {
      io.stdin.setRawMode(true);
      throw new Error('fixture-secret');
    } })).toBe(1);
    expect(io.stdin.isRaw).toBe(false);
    expect(io.error()).toContain('异常');
    expect(io.error()).not.toContain('fixture-secret');
    expect(io.output()).toContain('\u001b[?1049l');
  });

  it('handles process-level failures and disposes an owner that fails to unmount', async () => {
    const io = fixture();
    let ready = false;
    const pending = runTerminalSession({ ...io, mount: async () => {
      ready = true;
      return { done: new Promise<void>(() => undefined), dispose: () => { throw new Error('cleanup-secret'); } };
    } });
    await vi.waitFor(() => expect(ready).toBe(true));
    io.signals.emit('unhandledRejection', new Error('private-rejection'));
    expect(await pending).toBe(1);
    expect(io.error()).not.toMatch(/private-rejection|cleanup-secret/);
    expect(io.signals.listenerCount('unhandledRejection')).toBe(0);
  });
});
