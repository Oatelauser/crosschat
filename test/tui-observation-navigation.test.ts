import { describe, expect, it, vi } from 'vitest';
import { createTuiController } from '../src/tui/app/controller.js';
import { createResourceRegistry, defaultResources } from '../src/tui/resources/registry.js';
import type { TuiAction, TuiPage, TuiResourceAdapter, TuiRoute } from '../src/tui/model.js';

function action(ownerResourceId: string, id: string, shortcut: string, kind: TuiAction['kind'], selectionPolicy: TuiAction['selectionPolicy'] = 'required'): TuiAction {
  return { id, label: id, shortcut, kind, selectionPolicy, ownerResourceId, mutation: false, returnPolicy: 'restore' };
}
const context = { id: 'local', kind: 'local', label: '本机' };
function command(controller: ReturnType<typeof createTuiController>, text: string) {
  controller.handleKey({ name: ':' }); controller.handleKey({ name: 'text', text }); controller.handleKey({ name: 'enter' });
}
async function loaded(controller: ReturnType<typeof createTuiController>) { await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false)); }
function registry() {
  return createResourceRegistry(defaultResources.map((resource) => ({ ...resource, unavailableReason: undefined,
    actions: resource.id === 'sessions' ? [action('sessions', 'related-deliveries', 'o', 'navigate'), action('sessions', 'related-logs', 'l', 'navigate')]
      : resource.id === 'deliveries' ? [action('deliveries', 'related-outbox', 'w', 'navigate'), action('deliveries', 'related-logs', 'l', 'navigate'), action('deliveries', 'same-route', 'n', 'navigate')]
        : resource.id === 'logs' ? [action('logs', 'source', 't', 'route-choice', 'none')] : [],
  })));
}

describe('observation resource routes', () => {
  it('passes isolated complete routes to readers and uses the selected action route before a row default', async () => {
    const query = { session: 'opaque/full/native-id', provider: 'future' };
    const destination: TuiRoute = { resourceId: 'deliveries', contextId: 'local', query };
    const read = vi.fn<TuiResourceAdapter['read']>(async (request) => {
      const route = request.route;
      if (route?.query) Object.assign(route.query, { session: 'adapter-mutation' });
      return { rows: [], completeness: 'complete' };
    });
    const controller = createTuiController({ registry: registry(), contexts: [context], adapters: {
      sessions: { read: async () => ({ rows: [{ id: 'stable-session', cells: { name: 'selected' }, navigate: { resourceId: 'outbox', contextId: 'local' }, actionRoutes: { 'related-deliveries': destination, 'related-logs': { resourceId: 'logs', contextId: 'local', query: { source: 'send', session: query.session } } } }], completeness: 'complete' }) },
      deliveries: { read }, logs: { read: async () => ({ rows: [], completeness: 'complete' }) },
    } });
    try {
      command(controller, 'sessions'); await loaded(controller);
      controller.handleKey({ name: 'o' }); await loaded(controller);
      expect(read).toHaveBeenCalledOnce();
      expect(controller.getSnapshot().route).toEqual({ resourceId: 'deliveries', contextId: 'local', query: { session: 'opaque/full/native-id', provider: 'future' } });
      expect(query.session).toBe('opaque/full/native-id');
      query.session = 'source-mutation';
      expect(controller.getSnapshot().route.query?.session).toBe('opaque/full/native-id');
      controller.handleKey({ name: 'escape' }); controller.handleKey({ name: 'l' }); await loaded(controller);
      expect(controller.getSnapshot().route).toEqual({ resourceId: 'logs', contextId: 'local', query: { source: 'send', session: 'opaque/full/native-id' } });
    } finally { controller.dispose(); }
  });

  it('keeps related route caches separate, canonicalizes query order, clears associations on direct commands and restores the source', async () => {
    const read = vi.fn<TuiResourceAdapter['read']>(async ({ route }) => {
      const session = route?.query?.session;
      return { rows: Array.from({ length: 8 }, (_, index) => ({ id: `${session ?? 'all'}-${index}`, cells: { name: `item ${index}` }, actionRoutes: { 'same-route': { resourceId: 'deliveries', contextId: 'local', query: { z: 'last', session: session ?? '' } } } })), completeness: 'complete' };
    });
    const controller = createTuiController({ registry: registry(), contexts: [context], adapters: {
      sessions: { read: async () => ({ rows: ['one', 'two'].map((id) => ({ id, cells: { name: id }, actionRoutes: { 'related-deliveries': { resourceId: 'deliveries', contextId: 'local', query: { session: id, z: 'last' } } } })), completeness: 'complete' }) }, deliveries: { read },
    } });
    try {
      controller.resize(60, 12); command(controller, 'sessions'); await loaded(controller);
      controller.handleKey({ name: 'o' }); await loaded(controller); controller.handleKey({ name: 'end' });
      expect(controller.getSnapshot().selectedId).toBe('one-7');
      controller.handleKey({ name: 'n' }); await loaded(controller);
      controller.handleKey({ name: 'escape' });
      expect(controller.getSnapshot().route.resourceId).toBe('sessions');
      controller.handleKey({ name: 'down' }); controller.handleKey({ name: 'o' }); await loaded(controller);
      expect(controller.getSnapshot()).toMatchObject({ route: { query: { session: 'two' } }, selectedId: 'two-0', scrollOffset: 0 });
      controller.handleKey({ name: 'escape' }); controller.handleKey({ name: 'up' }); controller.handleKey({ name: 'o' }); await loaded(controller);
      expect(controller.getSnapshot()).toMatchObject({ route: { query: { session: 'one' } }, selectedId: 'one-7', scrollOffset: 5 });
      command(controller, 'deliveries'); await loaded(controller);
      expect(controller.getSnapshot().route.query).toBeUndefined();
      controller.handleKey({ name: 'escape' });
      expect(controller.getSnapshot()).toMatchObject({ route: { query: { session: 'one' } }, selectedId: 'one-7' });
    } finally { controller.dispose(); }
  });

  it('selects a route from a zero-row page, exposes complete option details, and revalidates its route before navigating', async () => {
    const longLabel = `看门狗日志 ${'完整/日志路径/'.repeat(20)}`;
    let data: TuiPage = { rows: [], completeness: 'complete', routeChoices: { source: { title: '选择日志来源', options: [
      { value: 'send', label: '投递日志', route: { resourceId: 'logs', contextId: 'local', query: { source: 'send' } } },
      { value: 'watchdog', label: longLabel, route: { resourceId: 'logs', contextId: 'local', query: { source: 'watchdog' } } },
      { value: 'missing', label: '缺失来源', enabled: false, reason: '没有此来源权限', route: { resourceId: 'logs', contextId: 'local', query: { source: 'missing' } } },
    ] } } };
    const clipboard = vi.fn(async () => {});
    const controller = createTuiController({ registry: registry(), contexts: [context], adapters: { logs: { read: async () => data } }, clipboard });
    try {
      command(controller, 'logs'); await loaded(controller); controller.handleKey({ name: 't' });
      expect(controller.getSnapshot()).toMatchObject({ mode: 'choice', choice: { actionId: 'source' } });
      controller.handleKey({ name: 'end' }); controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot()).toMatchObject({ mode: 'choice', notice: '没有此来源权限' });
      controller.handleKey({ name: 'up' }); controller.handleKey({ name: 'd' });
      expect(controller.getSnapshot().detail?.fields).toContainEqual({ label: '选项', value: longLabel });
      controller.handleKey({ name: 'escape' }); controller.handleKey({ name: '?' }); controller.handleKey({ name: 'escape' });
      expect(controller.getSnapshot()).toMatchObject({ mode: 'choice', choice: { selectedIndex: 1 } });
      controller.handleKey({ name: 'y' }); await vi.waitFor(() => expect(clipboard).toHaveBeenCalledWith('watchdog', expect.any(AbortSignal)));
      const prior = data.routeChoices!.source;
      data = { ...data, routeChoices: { source: { ...prior, options: prior.options.map((option) => option.value === 'watchdog' ? { ...option, route: { ...option.route, query: { source: 'changed-target' } } } : option) } } };
      await controller.refresh(); controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot().mode).toBe('choice');
      expect(controller.getSnapshot().route.query).toBeUndefined();
      expect(controller.getSnapshot().notice).toMatch(/变化|重新/);
      controller.handleKey({ name: 'escape' }); controller.handleKey({ name: 't' }); controller.handleKey({ name: 'down' }); controller.handleKey({ name: 'enter' }); await loaded(controller);
      expect(controller.getSnapshot().route.query).toEqual({ source: 'changed-target' });
      controller.handleKey({ name: 'escape' });
      expect(controller.getSnapshot().route).toEqual({ resourceId: 'logs', contextId: 'local' });
    } finally { controller.dispose(); }
  });
});
