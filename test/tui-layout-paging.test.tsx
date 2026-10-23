import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'ink';
import { createTuiController } from '../src/tui/app/controller.js';
import { createResourceRegistry, defaultResources } from '../src/tui/resources/registry.js';
import { TuiScreen } from '../src/tui/ui/app.js';

describe('framed terminal paging shares the actual content budget', () => {
  it.each(['list', 'detail', 'form'] as const)('makes End reach the last %s content', async (mode) => {
    const resources = defaultResources.map((resource) => resource.id !== 'sessions' ? resource : { ...resource, unavailableReason: undefined,
      actions: [{ id: 'edit', label: '修改', shortcut: 'e', ownerResourceId: 'sessions', selectionPolicy: 'required' as const, mutation: true, kind: 'form' as const, returnPolicy: 'restore' as const }],
    });
    const registry = createResourceRegistry(resources);
    const rows = Array.from({ length: 30 }, (_, index) => ({ id: `row-${index}`, cells: { name: index === 29 ? 'LAST-ROW-MARKER' : `row-${index}` }, detail: Array.from({ length: 30 }, (_, field) => ({ label: `field-${field}`, value: field === 29 ? 'LAST-DETAIL-MARKER' : `value-${field}` })) }));
    const controller = createTuiController({ registry, contexts: [{ id: 'local', kind: 'local', label: '本机' }], adapters: { sessions: {
      read: async () => ({ rows, completeness: 'complete' }),
      checkAction: async () => ({ enabled: true, impact: [...Array.from({ length: 25 }, (_, index) => `impact-${index}`), 'LAST-IMPACT-MARKER'] }),
      mutate: async () => ({}),
    } } });
    try {
      controller.resize(100, 28);
      for (const name of ':sessions') controller.handleKey({ name }); controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
      if (mode === 'detail') controller.handleKey({ name: 'd' });
      if (mode === 'form') { controller.handleKey({ name: 'e' }); await vi.waitFor(() => expect(controller.getSnapshot().overlay?.checking).toBe(false)); }
      controller.handleKey({ name: 'end' });
      const snapshot = controller.getSnapshot();
      const output = renderToString(<TuiScreen snapshot={snapshot} resource={snapshot.resource ?? registry.resolve('sessions')!} version="fixture" />, { columns: 100 });
      expect(output).toContain(mode === 'list' ? 'LAST-ROW-MARKER' : mode === 'detail' ? 'LAST-DETAIL-MARKER' : 'LAST-IMPACT-MARKER');
    } finally { controller.dispose(); }
  });
});
