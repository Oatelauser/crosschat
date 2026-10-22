import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement } from 'react';
import { runTui } from '../src/tui/main.js';
import type { TuiController } from '../src/tui/app/controller.js';

const mocks = vi.hoisted(() => ({ list: vi.fn(), load: vi.fn(), save: vi.fn(), render: vi.fn() }));
vi.mock('../src/application/contexts/index.js', () => ({
  listTuiContexts: mocks.list, loadTuiPreferences: mocks.load, saveTuiPreferences: mocks.save,
}));
vi.mock('ink', () => ({ render: mocks.render }));
vi.mock('../src/tui/ui/app.js', () => ({ TuiApp: () => null }));

class Input extends PassThrough {
  isTTY = true;
  isRaw = false;
  setRawMode(value: boolean): this { this.isRaw = value; return this; }
}
class Output extends PassThrough { isTTY = true; columns = 80; rows = 24; }
const homes: string[] = [];
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'crosschat-tui-cli-'));
  homes.push(home);
  const stdin = new Input();
  const stdout = new Output();
  const stderr = new PassThrough();
  const signals = new EventEmitter();
  let errors = '';
  stderr.on('data', (chunk) => { errors += String(chunk); });
  return { home, stdin, stdout, stderr, signals, adapters: {}, errors: () => errors };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({ items: [{ id: 'local', kind: 'local', name: '本机', target: 'fixture-host', identityHint: '本机环境', attributes: {} }], errors: [], observedAt: 1 });
  mocks.load.mockResolvedValue({ state: 'ready', value: { version: 1 }, errors: [], observedAt: 1 });
  mocks.save.mockResolvedValue({ state: 'ready', value: { version: 1 }, errors: [], observedAt: 1 });
  mocks.render.mockImplementation(() => {
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    return { unmount: vi.fn(() => { finish(); }), waitUntilExit: () => done };
  });
});
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});
function renderedController(): TuiController {
  const element: unknown = mocks.render.mock.calls[0]?.[0];
  if (!isValidElement<{ controller: TuiController }>(element)) throw new Error('Expected a controller-bound TUI element.');
  return element.props.controller;
}

describe('TUI lazy entry and ownership', () => {
  it('rejects non-TTY before reading context configuration, preferences or loading the renderer', async () => {
    const io = await fixture();
    io.stdin.isTTY = false;
    expect(await runTui(io)).toBe(1);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.render).not.toHaveBeenCalled();
    expect(io.errors()).toContain('交互终端');
  });

  it('uses injected static contexts without discovery and leaves preferences unchanged until selection', async () => {
    const io = await fixture();
    const pending = runTui({ ...io, contexts: [{ id: 'fixture', kind: 'local', label: '中文😀 fixture', target: 'fixture-only' }] });
    await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
    expect(mocks.list).not.toHaveBeenCalled();
    expect(renderedController().getSnapshot().rows[0]?.cells.name).toBe('中文😀 fixture');
    expect(mocks.render.mock.calls[0]?.[1]).toMatchObject({ alternateScreen: true, exitOnCtrlC: false, patchConsole: false, interactive: true });
    io.signals.emit('SIGTERM');
    expect(await pending).toBe(0);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(io.signals.listenerCount('SIGINT')).toBe(0);
  });

  it('maps read-only context DTOs and restores then saves an explicit context selection', async () => {
    const io = await fixture();
    mocks.load.mockResolvedValue({ state: 'ready', value: { version: 1, selectedContextId: 'ssh:fixture' }, errors: [], observedAt: 1 });
    mocks.list.mockResolvedValue({ items: [
      { id: 'local', kind: 'local', name: '本机', target: 'fixture-host', identityHint: '本机环境', attributes: {} },
      { id: 'ssh:fixture', kind: 'ssh', name: '隔离远端', target: 'fixture-alias', identityHint: '配置别名；尚未认证', attributes: {} },
    ], errors: [], observedAt: 1 });
    const pending = runTui(io);
    await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
    const controller = renderedController();
    expect(controller.getSnapshot().selectedId).toBe('ssh:fixture');
    controller.handleKey({ name: 'up' });
    controller.handleKey({ name: 'q' });
    expect(await pending).toBe(0);
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ home: io.home, preferences: { version: 1, selectedContextId: 'local' } }));
    expect(controller.getSnapshot().rows[1]?.cells.target).toBe('fixture-alias');
  });

  it('does not mount late renderer work after a signal interrupts configuration reads', async () => {
    const io = await fixture();
    let resolve!: (value: unknown) => void;
    mocks.list.mockImplementation(() => new Promise((finish) => { resolve = finish; }));
    const pending = runTui(io);
    await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledOnce());
    io.signals.emit('SIGTERM');
    resolve({ items: [], errors: [], observedAt: 1 });
    expect(await pending).toBe(0);
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('remembers the context explicitly entered by a resource command without persisting unrelated row identities', async () => {
    const io = await fixture();
    const pending = runTui({ ...io, contexts: [{ id: 'fixture', kind: 'local', label: 'fixture' }] });
    await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
    const controller = renderedController();
    controller.handleKey({ name: ':' });
    controller.handleKey({ name: 'paste', text: 'sessions' });
    controller.handleKey({ name: 'enter' });
    expect(controller.getSnapshot().route.resourceId).toBe('sessions');
    controller.handleKey({ name: 'escape' });
    expect(controller.getSnapshot().route.resourceId).toBe('ctx');
    controller.handleKey({ name: 'q' });
    expect(await pending).toBe(0);
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ preferences: { version: 1, selectedContextId: 'fixture' } }));
  });

  it('does not save context changes made only while a cancelled filter was being edited', async () => {
    const io = await fixture();
    const pending = runTui({ ...io, contexts: [
      { id: 'first', kind: 'local', label: 'first' }, { id: 'second', kind: 'ssh', label: 'second' },
    ] });
    await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
    const controller = renderedController();
    controller.handleKey({ name: '/' });
    controller.handleKey({ name: 'paste', text: 'second' });
    expect(controller.getSnapshot().selectedId).toBe('second');
    controller.handleKey({ name: 'escape' });
    expect(controller.getSnapshot().selectedId).toBe('first');
    controller.handleKey({ name: 'q' });
    expect(await pending).toBe(0);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('waits for renderer teardown before completing terminal ownership and saving preferences', async () => {
    const io = await fixture();
    let finishCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => { finishCleanup = resolve; });
    const unmount = vi.fn();
    mocks.render.mockImplementation(() => ({ unmount, waitUntilExit: () => cleanup }));
    const pending = runTui({ ...io, contexts: [{ id: 'fixture', kind: 'local', label: 'fixture' }] });
    await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
    renderedController().handleKey({ name: 'enter' });
    io.signals.emit('SIGTERM');
    await vi.waitFor(() => expect(unmount).toHaveBeenCalledOnce());
    const outcome = await Promise.race([pending.then(() => 'exited'), new Promise<string>((resolve) => setTimeout(() => resolve('cleaning'), 20))]);
    const savedBeforeCleanup = mocks.save.mock.calls.length;
    finishCleanup();
    expect(await pending).toBe(0);
    expect(outcome).toBe('cleaning');
    expect(savedBeforeCleanup).toBe(0);
    expect(mocks.save).toHaveBeenCalledOnce();
  });
});

describe('CLI TUI command isolation', () => {
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const loader = `export async function resolve(specifier, context, next) {
    if (specifier === 'ink' || /(?:^|\\/)tui\\/main\\.js$/.test(specifier)) throw new Error('TUI_LOAD_BLOCKED');
    return next(specifier, context);
  }`;
  async function command(args: string[]) {
    const io = await fixture();
    const env = { ...process.env, HOME: io.home, USERPROFILE: io.home, CODEX_HOME: join(io.home, '.codex'), CLAUDE_CONFIG_DIR: join(io.home, '.claude') };
    delete env.CROSSCHAT_LIVE;
    return spawnSync(process.execPath, ['--no-warnings', '--experimental-loader', `data:text/javascript,${encodeURIComponent(loader)}`, cli, ...args], { encoding: 'utf8', env, timeout: 10_000 });
  }
  it.each([['--help'], ['--version'], ['tui', '--help']])('keeps %j independent from TUI and Ink modules', async (...args) => {
    const result = await command(args);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('TUI_LOAD_BLOCKED');
    if (args.includes('--help')) expect(result.stdout).toContain('tui');
  });
  it('rejects unsupported TUI arguments without importing the renderer', async () => {
    const result = await command(['tui', '--unknown']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('tui takes no options');
    expect(result.stderr).not.toContain('TUI_LOAD_BLOCKED');
  });
});
