import { describe, expect, it, vi } from 'vitest';
import { createTuiController } from '../src/tui/app/controller.js';
import { createResourceRegistry, defaultResources } from '../src/tui/resources/registry.js';
import type { TuiAction, TuiActionRequest } from '../src/tui/model.js';

const action: TuiAction = { id: 'generate', label: '生成配置', shortcut: 'a', ownerResourceId: 'keys', selectionPolicy: 'none', mutation: true, kind: 'form', returnPolicy: 'restore' };
const secret = 'fixture-generated-private-key';
const route = { resourceId: 'keys', contextId: 'local' };
async function setup() {
  const clipboard = vi.fn<(text: string, signal: AbortSignal) => Promise<void>>(async () => {});
  const clear = vi.fn(); const exit = vi.fn(); const reads = vi.fn(async () => ({ rows: [], completeness: 'complete' as const }));
  const check = vi.fn<(request: TuiActionRequest) => Promise<{ enabled: boolean; impact: string[] }>>(async () => ({ enabled: true, impact: ['仅生成配置，不代表机器在线'] }));
  const mutate = vi.fn(async () => ({ message: '已生成配置', result: { title: '接入配置', fields: [{ label: '配置', value: secret }], copies: [{ id: 'config', label: '复制配置', shortcut: 'y', value: secret }, { id: 'command', label: '复制指引', shortcut: 'c', value: 'fixture connect command' }] } }));
  const controller = createTuiController({ registry: createResourceRegistry(defaultResources.map((r) => r.id === 'keys' ? { ...r, actions: [action], unavailableReason: undefined } : r)), contexts: [{ id: 'local', kind: 'local', label: '本机' }], adapters: { keys: { read: reads, checkAction: check, mutate } }, clipboard, onSensitiveClear: clear, onExit: exit });
  controller.handleKey({ name: ':' }); controller.handleKey({ name: 'text', text: 'keys' }); controller.handleKey({ name: 'enter' });
  await controller.refresh(); controller.handleKey({ name: 'a' });
  await vi.waitFor(() => expect(controller.getSnapshot().overlay?.checking).toBe(false));
  controller.handleKey({ name: 'tab' }); controller.handleKey({ name: 'enter' });
  await vi.waitFor(() => expect(mutate).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(controller.getSnapshot().mode).not.toBe('form'));
  return { controller, clipboard, clear, exit, check, mutate, reads };
}

describe('one-time sensitive mutation results', () => {
  it('keeps generated secrets in a dedicated result owner and only copies explicit result actions', async () => {
    const f = await setup();
    try {
      expect(f.controller.getSnapshot()).toMatchObject({ mode: 'result', route, result: { title: '接入配置' } });
      expect(f.check.mock.calls[0][0].route).toEqual(route);
      expect(JSON.stringify(f.controller.getSnapshot().rows)).not.toContain(secret);
      expect(f.controller.getSnapshot().notice).not.toContain(secret);
      const count = f.reads.mock.calls.length;
      f.controller.handleKey({ name: 'a' }); f.controller.handleKey({ name: ':', text: ':' }); f.controller.handleKey({ name: 'enter' }); f.controller.handleKey({ name: 'd', ctrl: true });
      expect(f.mutate).toHaveBeenCalledOnce(); expect(f.reads).toHaveBeenCalledTimes(count);
      f.controller.handleKey({ name: 'y' });
      await vi.waitFor(() => expect(f.clipboard).toHaveBeenCalledWith(secret, expect.any(AbortSignal)));
      f.controller.handleKey({ name: 'c' });
      await vi.waitFor(() => expect(f.clipboard).toHaveBeenCalledWith('fixture connect command', expect.any(AbortSignal)));
      f.controller.handleKey({ name: 'escape' });
      expect(f.controller.getSnapshot()).toMatchObject({ mode: 'list', route });
      expect(JSON.stringify(f.controller.getSnapshot())).not.toContain(secret);
      expect(f.clear).toHaveBeenCalledOnce();
    } finally { f.controller.dispose(); }
  });

  it('uses a constant safe copy error, discards the result on interrupt and clears it on disposal', async () => {
    const f = await setup();
    f.clipboard.mockRejectedValueOnce(new Error(secret));
    f.controller.handleKey({ name: 'y' });
    await vi.waitFor(() => expect(f.controller.getSnapshot().result?.notice).toContain('复制失败'));
    expect(f.controller.getSnapshot().result?.notice).not.toContain(secret);
    f.controller.handleKey({ name: 'c', ctrl: true });
    expect(f.controller.getSnapshot().mode).toBe('list'); expect(f.exit).not.toHaveBeenCalled();
    expect(f.clear).toHaveBeenCalledOnce(); f.controller.dispose();
    const second = await setup(); second.controller.dispose(); expect(second.clear).toHaveBeenCalledOnce();
    expect(second.controller.getSnapshot().result).toBeUndefined();
  });
});
