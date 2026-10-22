import { describe, expect, it } from 'vitest';
import { createTuiController } from '../src/tui/app/controller.js';
import type { TuiAction, TuiPage } from '../src/tui/model.js';
import { createResourceRegistry, defaultResources } from '../src/tui/resources/registry.js';

const enter: TuiAction = { id: 'open-node', label: '进入节点', shortcut: 'Enter', ownerResourceId: 'sessions', selectionPolicy: 'required', mutation: false, kind: 'navigate', returnPolicy: 'restore' };
const detail: TuiAction = { id: 'detail', label: '完整会话', shortcut: 'd', ownerResourceId: 'sessions', selectionPolicy: 'required', mutation: false, kind: 'detail', returnPolicy: 'restore' };
function setup(initial: TuiPage) {
  let page = initial;
  const registry = createResourceRegistry(defaultResources.map((resource) => resource.id === 'sessions' ? { ...resource, actions: [], unavailableReason: undefined } : resource));
  const controller = createTuiController({ registry, contexts: [{ id: 'local', kind: 'local', label: '本机' }], adapters: { sessions: { read: async () => page }, machines: { read: async () => ({ rows: [], completeness: 'complete' }) } } });
  controller.handleKey({ name: 'enter' });
  return { controller, replace(next: TuiPage) { page = next; } };
}
const row = { id: 'opaque/session', cells: { name: '同名', machine: '完整机器名' }, detail: [{ label: 'ID', value: 'opaque/session' }], actionRoutes: { 'open-node': { resourceId: 'machines', contextId: 'local', query: { machineId: 'full-machine' } } } };

describe('resource page presentation', () => {
  it('uses page columns and list actions for navigation and help, while detail stays read only', async () => {
    const { controller } = setup({ rows: [row], completeness: 'complete', presentation: { columns: [{ id: 'machine', label: '所属节点', width: 20 }], actions: [enter, detail] }, contextSummary: { label: '当前星', permissionLabel: '本次普通成员' } });
    try {
      await controller.refresh();
      expect(controller.getSnapshot().resource?.columns).toEqual([{ id: 'machine', label: '所属节点', width: 20 }]);
      expect(controller.getSnapshot().context).toMatchObject({ label: '当前星', permissionLabel: '本次普通成员' });
      controller.handleKey({ name: '?' });
      expect(controller.getSnapshot().help?.entries).toContainEqual(expect.objectContaining({ id: 'open-node', label: '进入节点' }));
      controller.handleKey({ name: 'escape' });
      controller.handleKey({ name: 'd' });
      expect(controller.getSnapshot().mode).toBe('detail');
      controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot().mode).toBe('detail');
      controller.handleKey({ name: 'escape' });
      controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot().route).toMatchObject({ resourceId: 'machines', query: { machineId: 'full-machine' } });
    } finally { controller.dispose(); }
  });

  it('provides page navigation on empty lists and clears presentation when the next page omits it', async () => {
    const action: TuiAction = { ...enter, id: 'view-nodes', shortcut: 'v', selectionPolicy: 'none' };
    const { controller, replace } = setup({ rows: [], completeness: 'complete', presentation: { actions: [action] }, actionRoutes: { 'view-nodes': { resourceId: 'machines', contextId: 'local' } } });
    try {
      await controller.refresh(); controller.handleKey({ name: 'v' });
      expect(controller.getSnapshot().route.resourceId).toBe('machines');
      controller.handleKey({ name: 'escape' });
      replace({ rows: [row], completeness: 'complete' }); await controller.refresh();
      expect(controller.getSnapshot().actions.some((entry) => entry.id === 'view-nodes')).toBe(false);
      controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot().mode).toBe('detail');
    } finally { controller.dispose(); }
  });

  it('rejects cross-resource action ownership before making an invalid page interactive', async () => {
    const { controller } = setup({ rows: [row], completeness: 'complete', presentation: { actions: [{ ...enter, ownerResourceId: 'keys' }] } });
    try {
      await controller.refresh();
      expect(controller.getSnapshot().completeness).toBe('unavailable');
      expect(controller.getSnapshot().actions.some((entry) => entry.id === 'open-node')).toBe(false);
    } finally { controller.dispose(); }
  });
});
