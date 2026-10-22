import { describe, expect, it, vi } from 'vitest';
import { createTuiController } from '../src/tui/app/controller.js';
import { createResourceRegistry, defaultResources } from '../src/tui/resources/registry.js';
import type { TuiContext } from '../src/tui/model.js';

describe('mutation completion navigation', () => {
  it('reloads the authoritative connection list before selecting a newly imported context', async () => {
    let contexts: TuiContext[] = [{ id: 'local', kind: 'local', label: '本机' }];
    const reload = vi.fn(async () => ({ contexts, completeness: 'complete' as const }));
    const controller = createTuiController({ registry: createResourceRegistry(defaultResources.map((resource) => resource.id === 'keys' ? { ...resource, unavailableReason: undefined, actions: [{ id: 'import', ownerResourceId: 'keys', label: '导入', shortcut: 'a', selectionPolicy: 'none', mutation: true, kind: 'form', returnPolicy: 'select-result' }] } : resource)), contexts,
      contextSource: { initial: { contexts, completeness: 'complete' }, read: reload }, adapters: { keys: { read: async () => ({ rows: [], completeness: 'complete' }), checkAction: async () => ({ enabled: true }), mutate: async () => {
        contexts = [...contexts, { id: 'tcp:actual-new', kind: 'tcp', label: '实际配置' }];
        return { navigate: { resourceId: 'ctx' }, selectedId: 'tcp:actual-new', message: '导入完成' };
      } } } });
    try {
      controller.handleKey({ name: ':' }); controller.handleKey({ name: 'text', text: 'keys' }); controller.handleKey({ name: 'enter' });
      await controller.refresh(); controller.handleKey({ name: 'a' });
      await vi.waitFor(() => expect(controller.getSnapshot().overlay?.checking).toBe(false));
      controller.handleKey({ name: 'tab' }); controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller.getSnapshot().route.resourceId).toBe('ctx'));
      await vi.waitFor(() => expect(controller.getSnapshot().selectedId).toBe('tcp:actual-new'));
      expect(reload).toHaveBeenCalled();
      expect(controller.getSnapshot().rows.find((row) => row.id === 'tcp:actual-new')?.cells.name).toBe('实际配置');
    } finally { controller.dispose(); }
  });
});
