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
  return { read, controller: createTuiController({ registry, contexts, adapters: { ssh: { read }, status: { read }, sessions: { read }, machines: { read }, connect: { read } } }) };
}

describe('context actions use declared presentation metadata', () => {
  it('tests only the selected SSH target and restores the source selection', async () => {
    const { controller, read } = fixture();
    try {
      controller.handleKey({ name: 'down' }); controller.handleKey({ name: 't' });
      await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
      expect(controller.getSnapshot().route).toEqual({ resourceId: 'ssh', contextId: 'ssh:fixture', query: { operation: 'check' } });
      controller.handleKey({ name: 'escape' });
      expect(controller.getSnapshot().selectedId).toBe('ssh:fixture');
    } finally { controller.dispose(); }
  });

  it('keeps guides readonly, tests the selected TCP star and opens the existing connection chooser without a write', async () => {
    const { controller, read } = fixture();
    try {
      controller.handleKey({ name: 'down' }); controller.handleKey({ name: 'g' });
      expect(controller.getSnapshot().mode).toBe('detail');
      expect(JSON.stringify(controller.getSnapshot().detail)).toContain('同一');
      controller.handleKey({ name: 't' }); expect(read).not.toHaveBeenCalled();
      controller.handleKey({ name: 'escape' }); controller.handleKey({ name: 'down' }); controller.handleKey({ name: 't' });
      await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
      expect(controller.getSnapshot().route).toEqual({ resourceId: 'machines', contextId: 'tcp:pending' });
      controller.handleKey({ name: 'escape' });
      controller.handleKey({ name: 'a' });
      await vi.waitFor(() => expect(controller.getSnapshot().route.resourceId).toBe('connect'));
      await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    } finally { controller.dispose(); }
  });

  it('refreshes context action routes with the authoritative context list', async () => {
    const { controller } = fixture(); controller.dispose();
    const registry = createResourceRegistry(defaultResources.map((resource) => resource.id === 'ctx' ? contextsResource : resource));
    const current = [presentContext({ id: 'ssh:new', kind: 'ssh', label: 'new', target: 'new' })];
    const read = vi.fn(async () => ({ rows: [], completeness: 'complete' as const }));
    const active = createTuiController({ registry, contexts: [], contextSource: { initial: { contexts: [], completeness: 'complete' }, read: async () => ({ contexts: current, completeness: 'complete' }) }, adapters: { ssh: { read } } });
    try {
      active.handleKey({ name: 'r' }); await vi.waitFor(() => expect(active.getSnapshot().rows).toHaveLength(1));
      active.handleKey({ name: 't' }); await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
      expect(active.getSnapshot().route.contextId).toBe('ssh:new');
    } finally { active.dispose(); }
  });
});
