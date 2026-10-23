import { describe, expect, it, vi } from 'vitest';
import { createTuiController } from '../src/tui/app/controller.js';
import { createResourceRegistry, defaultResources } from '../src/tui/resources/registry.js';
import { contextsResource, presentContext } from '../src/tui/resources/contexts.js';

function fixture() {
  const contexts = [
    presentContext({ id: 'local', kind: 'local', label: '本机', target: 'fixture' }),
    presentContext({ id: 'ssh:fixture', kind: 'ssh', label: 'fixture', target: 'fixture' }),
    presentContext({ id: 'tcp:pending', kind: 'tcp', label: 'TCP', target: 'fixture:1' }),
  ];
  const read = vi.fn(async () => ({ rows: [], completeness: 'complete' as const }));
  const registry = createResourceRegistry(defaultResources.map((resource) => resource.id === 'ctx' ? contextsResource : resource));
  return { read, controller: createTuiController({ registry, contexts, adapters: { ssh: { read }, status: { read }, sessions: { read }, stars: { read }, machines: { read }, connect: { read } } }) };
}

describe('context actions use declared presentation metadata', () => {
  it('navigates only to the selected SSH target and restores the source selection', async () => {
    const { controller, read } = fixture();
    try {
      controller.handleKey({ name: 'down' }); controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
      expect(controller.getSnapshot().route).toEqual({ resourceId: 'sessions', contextId: 'ssh:fixture' });
      controller.handleKey({ name: 'escape' });
      expect(controller.getSnapshot().selectedId).toBe('ssh:fixture');
    } finally { controller.dispose(); }
  });

  it('keeps ctx read-only and enters the selected TCP workspace without exposing connection mutations', async () => {
    const { controller, read } = fixture();
    try {
      controller.handleKey({ name: 'down' }); controller.handleKey({ name: 'd' });
      expect(controller.getSnapshot().mode).toBe('detail');
      expect(JSON.stringify(controller.getSnapshot().detail)).toContain('ssh');
      controller.handleKey({ name: 't' }); expect(read).not.toHaveBeenCalled();
      controller.handleKey({ name: 'escape' }); controller.handleKey({ name: 'down' }); controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
      expect(controller.getSnapshot().route).toEqual({ resourceId: 'stars', contextId: 'tcp:pending' });
      controller.handleKey({ name: 'escape' });
      controller.handleKey({ name: 'a' });
      expect(controller.getSnapshot().route.resourceId).toBe('ctx');
      expect(read).toHaveBeenCalledTimes(1);
    } finally { controller.dispose(); }
  });

  it('refreshes context action routes with the authoritative context list', async () => {
    const { controller } = fixture(); controller.dispose();
    const registry = createResourceRegistry(defaultResources.map((resource) => resource.id === 'ctx' ? contextsResource : resource));
    const current = [presentContext({ id: 'ssh:new', kind: 'ssh', label: 'new', target: 'new' })];
    const read = vi.fn(async () => ({ rows: [], completeness: 'complete' as const }));
    const active = createTuiController({ registry, contexts: [], contextSource: { initial: { contexts: [], completeness: 'complete' }, read: async () => ({ contexts: current, completeness: 'complete' }) }, adapters: { sessions: { read } } });
    try {
      active.handleKey({ name: 'r' }); await vi.waitFor(() => expect(active.getSnapshot().rows).toHaveLength(1));
      active.handleKey({ name: 'enter' }); await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
      expect(active.getSnapshot().route.contextId).toBe('ssh:new');
    } finally { active.dispose(); }
  });
});
