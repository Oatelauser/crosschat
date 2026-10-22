import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { isValidElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTuiController } from '../src/tui/app/controller.js';
import type { TuiController } from '../src/tui/app/controller.js';
import type { TuiContext } from '../src/tui/model.js';
import { createResourceRegistry } from '../src/tui/resources/registry.js';
import { runTui } from '../src/tui/main.js';

const mocks = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('ink', () => ({ render: mocks.render }));
vi.mock('../src/tui/ui/app.js', () => ({ TuiApp: () => null }));

class Input extends PassThrough {
  isTTY = true;
  isRaw = false;
  setRawMode(value: boolean): this { this.isRaw = value; return this; }
}
class Output extends PassThrough { isTTY = true; columns = 80; rows = 24; }
const homes: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.render.mockImplementation(() => {
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    return { unmount: vi.fn(() => { finish(); }), waitUntilExit: () => done };
  });
});
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'crosschat-tui-source-'));
  homes.push(home);
  await mkdir(join(home, '.ssh'));
  await mkdir(join(home, '.crosschat', 'tcp'), { recursive: true });
  const stdin = new Input();
  const stdout = new Output();
  const stderr = new PassThrough();
  stderr.resume();
  return { home, stdin, stdout, stderr, signals: new EventEmitter(), adapters: {} };
}
function renderedController(): TuiController {
  const element: unknown = mocks.render.mock.calls[0]?.[0];
  if (!isValidElement<{ controller: TuiController }>(element)) throw new Error('Expected a controller-bound TUI element');
  return element.props.controller;
}
const local: TuiContext = { id: 'local', kind: 'local', label: '本机' };
const alpha: TuiContext = { id: 'ssh:alpha', kind: 'ssh', label: 'alpha', target: 'alpha' };
const beta: TuiContext = { id: 'ssh:beta', kind: 'ssh', label: 'beta', target: 'beta' };

describe('dynamic read-only context configuration', () => {
  it('keeps safe source errors visible in the real entry snapshot and complete read-only details', async () => {
    const io = await fixture();
    const node = join(io.home, '.crosschat', 'tcp', 'node.json');
    await writeFile(node, '{never-print-this-secret');
    const pending = runTui({ ...io, version: 'fixture' });
    try {
      await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
      const controller = renderedController();
      expect(controller.getSnapshot().completeness).toBe('partial');
      expect(controller.getSnapshot().notice).toContain(node);
      expect(controller.getSnapshot().notice).toContain('malformed');
      expect(controller.getSnapshot().notice).toContain('格式');
      controller.handleKey({ name: 'd' });
      const hints = controller.getSnapshot().detail?.fields.find((field) => field.label === '读取提示')?.value;
      expect(hints).toContain(node);
      expect(hints).toContain('检查');
      expect(JSON.stringify(controller.getSnapshot())).not.toContain('never-print-this-secret');
    } finally { io.signals.emit('SIGTERM'); await pending; }
  });

  it('rereads edited configuration on r, enters a new context and saves only an explicit selection', async () => {
    const io = await fixture();
    const ssh = join(io.home, '.ssh', 'config');
    await writeFile(ssh, 'Host alpha\n');
    const pending = runTui({ ...io, version: 'fixture' });
    try {
      await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
      const controller = renderedController();
      expect(controller.getSnapshot().rows.map((row) => row.id)).toEqual(['local', 'ssh:alpha']);
      await writeFile(ssh, 'Host beta\n');
      controller.handleKey({ name: 'r' });
      await vi.waitFor(() => expect(controller.getSnapshot().rows.map((row) => row.id)).toEqual(['local', 'ssh:beta']));
      expect(controller.getSnapshot().selectedId).toBe('local');
      controller.handleKey({ name: 'down' });
      controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot()).toMatchObject({ route: { resourceId: 'sessions', contextId: 'ssh:beta' }, context: { id: 'ssh:beta', label: 'beta' } });
    } finally { io.signals.emit('SIGTERM'); await pending; }
    expect(JSON.parse(await readFile(join(io.home, '.crosschat', 'tui.json'), 'utf8'))).toEqual({ version: 1, selectedContextId: 'ssh:beta' });
  });

  it('accepts dynamic initial metadata, preserves stable selection and resolves refreshed contexts', async () => {
    const read = vi.fn(async () => ({ contexts: [local, beta, { ...alpha, label: 'alpha updated' }], completeness: 'complete' as const }));
    const controller = createTuiController({ registry: createResourceRegistry(), contexts: [], initialSelectedContextId: alpha.id,
      contextSource: { initial: { contexts: [local, alpha], completeness: 'partial', notice: 'fixture source unavailable; inspect source' }, read }, adapters: {} });
    try {
      expect(controller.getSnapshot()).toMatchObject({ selectedId: alpha.id, completeness: 'partial', notice: 'fixture source unavailable; inspect source' });
      await controller.refresh();
      expect(read).toHaveBeenCalledOnce();
      expect(controller.getSnapshot()).toMatchObject({ selectedId: alpha.id, completeness: 'complete' });
      controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot().context?.label).toBe('alpha updated');
    } finally { controller.dispose(); }
  });

  it('does not replace remembered user selection when refresh removes that configured context', async () => {
    const io = await fixture();
    const ssh = join(io.home, '.ssh', 'config');
    const preferences = join(io.home, '.crosschat', 'tui.json');
    const remembered = '{"version":1,"selectedContextId":"ssh:alpha"}';
    await writeFile(ssh, 'Host alpha\n');
    await writeFile(preferences, remembered);
    const pending = runTui({ ...io, version: 'fixture' });
    try {
      await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
      const controller = renderedController();
      expect(controller.getSnapshot().selectedId).toBe(alpha.id);
      await writeFile(ssh, '# no configured aliases\n');
      await controller.refresh();
      expect(controller.getSnapshot().rows.map((row) => row.id)).toEqual(['local']);
      expect(controller.getSnapshot().selectedId).toBe(local.id);
    } finally { io.signals.emit('SIGTERM'); await pending; }
    expect(await readFile(preferences, 'utf8')).toBe(remembered);
  });

  it('emits context selection only for explicit movement and entry, including after a refresh fallback', async () => {
    const selected = vi.fn();
    const controller = createTuiController({ registry: createResourceRegistry(), contexts: [local, alpha], initialSelectedContextId: alpha.id,
      onContextSelection: selected, contextSource: { initial: { contexts: [local, alpha], completeness: 'complete' }, read: async () => ({ contexts: [local], completeness: 'complete' }) }, adapters: {} });
    try {
      await controller.refresh();
      expect(selected).not.toHaveBeenCalled();
      controller.handleKey({ name: '/' }); controller.handleKey({ name: 'text', text: '本机' }); controller.handleKey({ name: 'escape' });
      expect(selected).not.toHaveBeenCalled();
      controller.handleKey({ name: 'home' });
      expect(selected).toHaveBeenLastCalledWith(local.id);
      controller.handleKey({ name: 'enter' });
      expect(selected).toHaveBeenCalledTimes(2);
    } finally { controller.dispose(); }
  });

  it('does not read a deleted route context as an implicit local default after returning to a cached resource', async () => {
    const read = vi.fn(async () => ({ rows: [], completeness: 'complete' as const }));
    const controller = createTuiController({ registry: createResourceRegistry(), contexts: [local, alpha], initialSelectedContextId: alpha.id,
      contextSource: { initial: { contexts: [local, alpha], completeness: 'complete' }, read: async () => ({ contexts: [local], completeness: 'complete' }) }, adapters: { sessions: { read } } });
    try {
      controller.handleKey({ name: 'enter' }); await new Promise(setImmediate);
      expect(read).toHaveBeenCalledOnce();
      controller.handleKey({ name: ':' }); controller.handleKey({ name: 'text', text: 'ctx' }); controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller.getSnapshot().rows.map((row) => row.id)).toEqual(['local']));
      controller.handleKey({ name: 'escape' });
      expect(controller.getSnapshot().route.contextId).toBe(alpha.id);
      await controller.refresh();
      expect(read).toHaveBeenCalledOnce();
      expect(controller.getSnapshot().completeness).toBe('unavailable');
      expect(controller.getSnapshot().notice).toContain('连接配置已不存在');
    } finally { controller.dispose(); }
  });

  it('cancels a context refresh without accepting its late context collection', async () => {
    let signal: AbortSignal | undefined;
    let finish!: (page: { contexts: readonly TuiContext[]; completeness: 'complete' }) => void;
    const controller = createTuiController({ registry: createResourceRegistry(), contexts: [local, alpha], contextSource: {
      initial: { contexts: [local, alpha], completeness: 'complete' }, read: (currentSignal: AbortSignal) => {
        signal = currentSignal;
        return new Promise<{ contexts: readonly TuiContext[]; completeness: 'complete' }>((resolve) => { finish = resolve; });
      },
    }, adapters: {} });
    try {
      const pending = controller.refresh();
      expect(signal?.aborted).toBe(false);
      controller.handleKey({ name: 'c', ctrl: true });
      await pending;
      expect(signal?.aborted).toBe(true);
      expect(controller.getSnapshot().completeness).toBe('cancelled');
      finish({ contexts: [local, beta], completeness: 'complete' });
      await Promise.resolve();
      expect(controller.getSnapshot().rows.map((row) => row.id)).toEqual(['local', alpha.id]);
      controller.handleKey({ name: 'down' }); controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot().context?.id).toBe(alpha.id);
    } finally { controller.dispose(); }
  });
});
