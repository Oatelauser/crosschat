import { describe, expect, it } from 'vitest';
import type { TuiContext } from '../src/tui/model.js';

const contexts: TuiContext[] = [
  { id: 'local', kind: 'local', label: '本机', target: 'fixture-host' },
  { id: 'ssh:dev', kind: 'ssh', label: '开发机', description: 'SSH', target: 'dev' },
  { id: 'tcp:star', kind: 'tcp', label: '测试星', description: 'TCP', target: 'example:7260' },
];

describe('TUI interaction controller', () => {
  it('starts on ctx with stable snapshots and filters its rows while offering commands', async () => {
    const { createTuiController } = await import('../src/tui/app/controller.js');
    const { createResourceRegistry } = await import('../src/tui/resources/registry.js');
    const controller = createTuiController({ registry: createResourceRegistry(), contexts, adapters: {} });
    try {
      const initial = controller.getSnapshot();
      expect(initial.route).toEqual({ resourceId: 'ctx' });
      expect(initial.rows.map((row) => row.id)).toEqual(['local', 'ssh:dev', 'tcp:star']);
      expect(controller.getSnapshot()).toBe(initial);
      controller.handleKey({ name: ':' });
      controller.handleKey({ name: 's', text: 's' });
      const input = controller.getSnapshot();
      expect(input.mode).toBe('input');
      expect(input.rows.map((row) => row.id)).toEqual(['ssh:dev']);
      expect(input.input?.candidates.map((candidate) => candidate.id)).toEqual(expect.arrayContaining(['sessions', 'ssh', 'stars', 'status', 'services']));
      expect(input.input?.hint).toContain('保留筛选');
      controller.handleKey({ name: 'escape' });
      expect(controller.getSnapshot()).toMatchObject({ mode: 'list', filter: '', selectedId: 'local' });
      expect(controller.getSnapshot().rows).toHaveLength(3);
    } finally {
      controller.dispose();
    }
  });
});
