import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { copyText } from '../src/application/clipboard.js';

class Child extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => { queueMicrotask(() => this.emit('close', null)); return true; });
}
describe('explicit clipboard copy', () => {
  it('passes the complete original value only through stdin with no shell interpolation', async () => {
    const child = new Child();
    let input = '';
    child.stdin.on('data', (chunk) => { input += String(chunk); });
    const spawn = vi.fn(() => child);
    const original = '中文 👩‍💻 very-long-value $(ignored) `quoted` & |';
    const pending = copyText(original, { platform: 'win32', spawn });
    child.emit('close', 0);
    await pending;
    expect(input).toBe(original);
    expect(spawn.mock.calls[0]?.[1]).not.toContain(original);
    expect(spawn).toHaveBeenCalledWith('powershell.exe', expect.any(Array), expect.objectContaining({ shell: false, windowsHide: true }));
  });
  it('terminates only its own clipboard process on cancellation and reports failure', async () => {
    const child = new Child();
    const controller = new AbortController();
    const pending = copyText('copy', { platform: 'win32', spawn: () => child, signal: controller.signal });
    const assertion = expect(pending).rejects.toThrow();
    controller.abort();
    await assertion;
    expect(child.kill).toHaveBeenCalledOnce();
  });
  it('terminates a clipboard process on input failure and catches errors until it closes', async () => {
    const child = new Child();
    const pending = copyText('fixture', { spawn: () => child });
    const assertion = expect(pending).rejects.toThrow('无法复制');
    child.stdin.emit('error', new Error('private-pipe-failure'));
    expect(() => child.emit('error', new Error('private-late-failure'))).not.toThrow();
    expect(() => child.stdin.emit('error', new Error('private-late-input-failure'))).not.toThrow();
    await assertion;
    const kills = child.kill.mock.calls.length;
    const destroyed = child.stdin.destroyed;
    child.emit('close', null);
    expect(kills).toBe(1);
    expect(destroyed).toBe(true);
    expect(child.listenerCount('error')).toBe(0);
    expect(child.stdin.listenerCount('error')).toBe(0);
  });
  it('kills a child that reports a process error and rejects without exposing its exception', async () => {
    const child = new Child();
    const pending = copyText('fixture', { spawn: () => child });
    const assertion = expect(pending).rejects.toThrow('无法复制到系统剪贴板');
    child.emit('error', new Error('private-process-failure'));
    await assertion;
    const kills = child.kill.mock.calls.length;
    child.emit('close', null);
    expect(kills).toBe(1);
    expect(child.stdin.destroyed).toBe(true);
  });
});
