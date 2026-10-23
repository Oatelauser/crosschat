import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { isValidElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runTui } from '../src/tui/main.js';
import type { TuiController } from '../src/tui/app/controller.js';

const mocks = vi.hoisted(() => ({ factory: vi.fn(), membership: vi.fn(), render: vi.fn(), execute: vi.fn() }));
vi.mock('../src/application/discovery/local.js', () => ({ createLocalDiscoveryService: mocks.factory }));
vi.mock('../src/application/session-membership/index.js', () => ({ createSessionMembershipService: mocks.membership }));
vi.mock('ink', () => ({ render: mocks.render }));
vi.mock('../src/tui/ui/app.js', () => ({ TuiApp: () => null }));
class Input extends PassThrough { isTTY = true; isRaw = false; setRawMode(value: boolean) { this.isRaw = value; return this; } }
class Output extends PassThrough { isTTY = true; columns = 80; rows = 24; }
const homes: string[] = [];
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'crosschat-t07-main-')); homes.push(home);
  const stderr = new PassThrough(); stderr.resume();
  return { home, stdin: new Input(), stdout: new Output(), stderr, signals: new EventEmitter(), version: 'fixture', contexts: [{ id: 'local', kind: 'local', label: '本机' }, { id: 'ssh:fixture', kind: 'ssh', label: '远机' }] };
}
function controller(): TuiController {
  const element: unknown = mocks.render.mock.calls[0]?.[0];
  if (!isValidElement<{ controller: TuiController }>(element)) throw new Error('Expected TUI controller');
  return element.props.controller;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.factory.mockReturnValue({ execute: mocks.execute });
  mocks.membership.mockReturnValue({ listTargets: async () => ({ stars: [], completeness: 'complete', observedAt: 1, errors: [] }) });
  mocks.execute.mockImplementation(async (_request, options) => ({ op: 'list', providers: [{ providerId: 'future', capabilities: { discovery: true, delivery: false, launch: false, diagnostics: false } }], page: { items: [{ ref: { contextId: options.contextId, providerId: 'future', nativeId: '完整/native-id' }, name: null, rawStatus: 'new-state', attributes: {}, capabilities: { discovery: true, delivery: false, launch: false, diagnostics: false } }], nextCursor: null, observedAt: 1, errors: [], completeness: 'complete' } }));
  mocks.render.mockImplementation(() => { let finish!: () => void; const done = new Promise<void>((resolve) => { finish = resolve; }); return { unmount: finish, waitUntilExit: () => done }; });
});
afterEach(async () => { await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))); });

describe('default local sessions wiring', () => {
  it('installs the real session resource through injectable safe application sources after entering local', async () => {
    const io = await fixture(); const pending = runTui(io);
    try {
      await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
      expect(mocks.execute).not.toHaveBeenCalled();
      controller().handleKey({ name: 'enter' });
      controller().handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller().getSnapshot().rows).toHaveLength(1));
      expect(controller().getSnapshot().rows[0].cells.name).toBe('匿名');
      expect(controller().getSnapshot().rows[0].copyValues?.ref).toContain('完整/native-id');
      expect(mocks.factory).toHaveBeenCalledWith({ home: io.home });
      expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ op: 'list' }), expect.objectContaining({ contextId: 'local' }));
    } finally { io.signals.emit('SIGTERM'); await pending; }
  });
  it('rejects a remote session context instead of querying local sources', async () => {
    const io = await fixture(); const pending = runTui(io);
    try {
      await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
      controller().handleKey({ name: 'down' }); controller().handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller().getSnapshot().loading).toBe(false));
      expect(controller().getSnapshot().completeness).toBe('unavailable');
      expect(mocks.execute).not.toHaveBeenCalled();
    } finally { io.signals.emit('SIGTERM'); await pending; }
  });
  it('keeps explicit adapter injection authoritative and rejects non-TTY before composing sources', async () => {
    const io = await fixture(); const pending = runTui({ ...io, adapters: {} });
    try {
      await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
      expect(mocks.factory).not.toHaveBeenCalled();
    } finally { io.signals.emit('SIGTERM'); await pending; }
    io.stdin.isTTY = false;
    expect(await runTui(io)).toBe(1);
    expect(mocks.factory).not.toHaveBeenCalled();
  });
});
