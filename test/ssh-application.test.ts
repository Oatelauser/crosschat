import { spawn as spawnChild } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSshApplication } from '../src/application/ssh/index.js';

class FakeSshChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => { queueMicrotask(() => this.emit('close', null)); return true; });
  input = '';
  constructor() {
    super();
    this.stdin.on('data', (chunk: Buffer) => { this.input += chunk.toString('utf8'); });
  }
  finish(stdout: string, code = 0, stderr = ''): void {
    this.stdout.write(stdout);
    this.stderr.write(stderr);
    this.emit('close', code);
  }
}

const homes: string[] = [];
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'crosschat-t10-ssh-'));
  homes.push(home);
  await mkdir(join(home, '.ssh'));
  await writeFile(join(home, '.ssh', 'config'), 'Host fixture other\n  User same-user\nHost *.wild\n');
  return home;
}
const response = () => ({ op: 'list', providers: [{ providerId: 'future-tool', capabilities: { discovery: true, delivery: false, launch: false, diagnostics: false } }],
  page: { items: [{ ref: { contextId: 'local', providerId: 'future-tool', nativeId: 'native/opaque/完整' }, name: null, rawStatus: 'idle', capabilities: { discovery: true, delivery: false, launch: false, diagnostics: false }, attributes: {} }],
    nextCursor: null, completeness: 'complete', errors: [], observedAt: 7 } });
const diagnostic = () => ({ groups: [{ context: { kind: 'environment' }, checks: [{ code: 'node-unsupported', level: 'error', data: { version: '20.0.0' } }] }], summary: { pass: 0, warn: 0, error: 1, failed: true } });

afterEach(async () => { vi.useRealTimers(); await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))); });

describe('configured SSH application reads', () => {
  it('lists configured aliases without executing SSH or interpreting configuration as authentication', async () => {
    const spawn = vi.fn(() => new FakeSshChild());
    const application = createSshApplication({ home: await fixture(), spawn });
    const listed = await application.list(new AbortController().signal);
    expect(listed.items.map((item) => item.id)).toEqual(['ssh:fixture', 'ssh:other']);
    expect(listed.items[0].identityHint).toContain('尚未核实');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('uses only the currently configured alias and the readonly discover protocol with full scoped references', async () => {
    const child = new FakeSshChild();
    const spawn = vi.fn(() => child);
    const application = createSshApplication({ home: await fixture(), spawn });
    const pending = application.discovery.execute({ op: 'list', limit: 1 }, { contextId: 'ssh:fixture' });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    child.finish(JSON.stringify(response()));
    expect(await pending).toMatchObject({ page: { items: [{ ref: { contextId: 'ssh:fixture', providerId: 'future-tool', nativeId: 'native/opaque/完整' } }] } });
    expect(spawn).toHaveBeenCalledWith('ssh', ['-T', '-o', 'BatchMode=yes', '--', 'fixture', 'crosschat', 'discover'], expect.objectContaining({ windowsHide: true }));
    expect(JSON.parse(child.input)).toEqual({ op: 'list', limit: 1 });
    expect(JSON.stringify(spawn.mock.calls)).not.toMatch(/status|--origin|send/);
  });

  it('rejects removed, unknown and pre-cancelled contexts without running a process or falling back locally', async () => {
    const home = await fixture();
    const spawn = vi.fn(() => new FakeSshChild());
    const application = createSshApplication({ home, spawn });
    expect(await application.discovery.execute({ op: 'list' }, { contextId: 'ssh:unconfigured' })).toMatchObject({ page: { completeness: 'unavailable', items: [] } });
    await writeFile(join(home, '.ssh', 'config'), 'Host other\n');
    expect(await application.doctor({ contextId: 'ssh:fixture' })).toMatchObject({ completeness: 'unavailable', result: null });
    const cancelled = new AbortController(); cancelled.abort();
    expect(await application.inspect({ contextId: 'ssh:other', signal: cancelled.signal })).toMatchObject({ completeness: 'cancelled' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('preserves a completed doctor error report instead of treating exit one as transport failure', async () => {
    const child = new FakeSshChild();
    const spawn = vi.fn(() => child);
    const application = createSshApplication({ home: await fixture(), spawn, now: () => 19 });
    const pending = application.doctor({ contextId: 'ssh:fixture' });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    const result = diagnostic();
    child.finish(JSON.stringify(result), 1);
    expect(await pending).toMatchObject({ contextId: 'ssh:fixture', host: 'fixture', completeness: 'complete', exitCode: 1, result, observedAt: 19, errors: [] });
    expect(spawn).toHaveBeenCalledWith('ssh', ['-T', '-o', 'BatchMode=yes', '--', 'fixture', 'crosschat', 'doctor', '--json'], expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }));
    expect(child.input).toBe('');
  });

  it('reports authentication and remote PATH failures with safe next steps without echoing raw stderr', async () => {
    const children = [new FakeSshChild(), new FakeSshChild()];
    let index = 0;
    const spawn = vi.fn(() => children[index++]);
    const application = createSshApplication({ home: await fixture(), spawn });
    const denied = application.doctor({ contextId: 'ssh:fixture' });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    children[0].finish('', 255, 'Permission denied (publickey). adminKey=SECRET');
    const denial = await denied;
    expect(denial).toMatchObject({ completeness: 'unavailable', errors: [expect.objectContaining({ nextStep: expect.stringMatching(/密钥|免密|认证/) })] });
    expect(JSON.stringify(denial)).not.toContain('SECRET');
    const missing = application.doctor({ contextId: 'ssh:other' });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
    children[1].finish('', 127, 'crosschat: command not found; token=SECRET');
    const unavailable = await missing;
    expect(unavailable).toMatchObject({ completeness: 'unavailable', errors: [expect.objectContaining({ nextStep: expect.stringMatching(/PATH|安装/) })] });
    expect(JSON.stringify(unavailable)).not.toContain('SECRET');
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('bounds stdout and owned execution, removes cancellation listeners, and rejects late results', async () => {
    const child = new FakeSshChild();
    const spawn = vi.fn(() => child);
    const application = createSshApplication({ home: await fixture(), spawn, maxOutputBytes: 64 });
    const pending = application.doctor({ contextId: 'ssh:fixture' });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    child.stdout.write('x'.repeat(1024));
    const bounded = await pending;
    expect(bounded.completeness).not.toBe('complete');
    expect(bounded.result).toBeNull();
    expect(child.kill).toHaveBeenCalled();
    expect(child.stdout.listenerCount('data')).toBe(0);
    expect(child.stderr.listenerCount('data')).toBe(0);
    child.finish('LATE', 0);
    expect(JSON.stringify(bounded)).not.toContain('LATE');
  });

  it('rejects old text, forged severities and inconsistent JSON exits without a fallback command', async () => {
    const children = [new FakeSshChild(), new FakeSshChild(), new FakeSshChild()];
    let index = 0;
    const spawn = vi.fn(() => children[index++]);
    const application = createSshApplication({ home: await fixture(), spawn });
    const inputs = ['环境\n结论: 1 项通过', JSON.stringify({ ...diagnostic(), groups: [{ context: { kind: 'environment' }, checks: [{ code: 'node-unsupported', level: 'pass', data: { version: '20.0.0' } }] }] }), JSON.stringify(diagnostic())];
    for (let i = 0; i < inputs.length; i++) {
      const pending = application.doctor({ contextId: 'ssh:fixture' });
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(i + 1));
      children[i].finish(inputs[i], 0);
      expect(await pending).toMatchObject({ completeness: 'unavailable', result: null, errors: [expect.objectContaining({ kind: 'malformed' })] });
    }
    expect(spawn).toHaveBeenCalledTimes(inputs.length);
  });

  it('times out and cancels without waiting for the configured SSH process to cooperate', async () => {
    const home = await fixture();
    vi.useFakeTimers();
    const child = new FakeSshChild();
    const application = createSshApplication({ home, spawn: () => child, timeoutMs: 20,
      readContexts: async () => ({ items: [{ id: 'ssh:fixture', kind: 'ssh', name: 'fixture', target: 'fixture', identityHint: '尚未核实', attributes: {} }], errors: [], observedAt: 0 }) });
    const pending = application.doctor({ contextId: 'ssh:fixture' });
    await vi.advanceTimersByTimeAsync(20);
    expect(await pending).toMatchObject({ completeness: 'unavailable', errors: [expect.objectContaining({ message: expect.stringMatching(/超时/) })] });
    expect(child.kill).toHaveBeenCalled();
    const other = new FakeSshChild();
    const cancel = new AbortController();
    const controlled = createSshApplication({ home, spawn: () => other,
      readContexts: async () => ({ items: [{ id: 'ssh:fixture', kind: 'ssh', name: 'fixture', target: 'fixture', identityHint: '尚未核实', attributes: {} }], errors: [], observedAt: 0 }) });
    const cancelled = controlled.doctor({ contextId: 'ssh:fixture', signal: cancel.signal });
    await vi.advanceTimersByTimeAsync(0);
    cancel.abort();
    expect(await cancelled).toMatchObject({ completeness: 'cancelled', result: null });
    expect(other.kill).toHaveBeenCalled();
    expect(other.stdout.listenerCount('data')).toBe(0);
  });

  it('reaps a controlled local fixture process when remote doctor waiting is cancelled', async () => {
    let child: ReturnType<typeof spawnChild> | undefined;
    let closed: Promise<number | null> | undefined;
    const cancel = new AbortController();
    const spawn = vi.fn((_command, _args, options) => {
      const controlled = spawnChild(process.execPath, ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000);'], options);
      child = controlled;
      closed = new Promise((resolve) => controlled.once('close', resolve));
      return controlled;
    });
    const application = createSshApplication({ home: await fixture(), spawn });
    const pending = application.doctor({ contextId: 'ssh:fixture', signal: cancel.signal });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    cancel.abort();
    expect(await pending).toMatchObject({ completeness: 'cancelled' });
    await closed;
    expect(child?.killed).toBe(true);
  });
});
