import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { isValidElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runTui } from '../src/tui/main.js';
import { defaultResources } from '../src/tui/resources/registry.js';
import type { TuiController } from '../src/tui/app/controller.js';

const mocks = vi.hoisted(() => ({ compose: vi.fn(), render: vi.fn(), canSave: vi.fn() }));
vi.mock('../src/tui/composition.js', () => ({ createDefaultResources: mocks.compose }));
vi.mock('ink', () => ({ render: mocks.render }));
vi.mock('../src/tui/ui/app.js', () => ({ TuiApp: () => null }));
class Input extends PassThrough { isTTY = true; isRaw = false; setRawMode(value: boolean) { this.isRaw = value; return this; } }
class Output extends PassThrough { isTTY = true; columns = 100; rows = 28; }
const homes: string[] = [];
afterEach(async () => { vi.clearAllMocks(); await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))); });

describe('preference writes respect completed local data removal', () => {
  it.each([false, true])('saves only if the composition owner permits it: %s', async (canSave) => {
    const home = await mkdtemp(join(tmpdir(), 'crosschat-tui-preference-owner-')); homes.push(home);
    mocks.canSave.mockReturnValue(canSave);
    mocks.compose.mockReturnValue({ resources: defaultResources, adapters: { sessions: { read: async () => ({ rows: [], completeness: 'complete' }) } }, shouldSavePreferences: mocks.canSave, setActiveContext: vi.fn(), dispose: async () => {} });
    mocks.render.mockImplementation(() => { let close!: () => void; const done = new Promise<void>((resolve) => { close = resolve; }); return { unmount: close, waitUntilExit: () => done }; });
    const signals = new EventEmitter(); const stderr = new PassThrough(); stderr.resume();
    const active = runTui({ home, version: 'fixture', stdin: new Input(), stdout: new Output(), stderr, signals, contexts: [{ id: 'local', kind: 'local', label: '本机' }] });
    try {
      await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
      const element: unknown = mocks.render.mock.calls[0][0];
      if (!isValidElement<{ controller: TuiController }>(element)) throw new Error('Missing controller');
      element.props.controller.handleKey({ name: 'enter' });
    } finally { signals.emit('SIGTERM'); await active; }
    expect(existsSync(join(home, '.crosschat', 'tui.json'))).toBe(canSave);
  });
});
