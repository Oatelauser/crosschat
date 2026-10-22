import { describe, expect, it } from 'vitest';

describe('TUI resource registry', () => {
  it('resolves resource aliases and keeps command discovery and shortcuts in one registry', async () => {
    const { createResourceRegistry } = await import('../src/tui/resources/registry.js');
    const registry = createResourceRegistry();
    expect(registry.resolve('nodes')?.id).toBe('machines');
    expect(registry.resolve('node-keys')?.id).toBe('keys');
    expect(registry.candidates('s').map((resource) => resource.id)).toEqual(expect.arrayContaining(['sessions', 'ssh', 'stars', 'status', 'services']));
    expect(registry.actions('ctx', 'list')).toEqual(expect.arrayContaining([
      expect.objectContaining({ shortcut: ':', label: '资源与筛选' }),
      expect.objectContaining({ shortcut: '?', label: '全部按键' }),
    ]));
  });

  it('accepts extension resources and rejects ambiguous commands and invalid terminal widths', async () => {
    const { createResourceRegistry, defaultResources } = await import('../src/tui/resources/registry.js');
    const extension = { id: 'third-tool', label: '第三工具', aliases: ['third'], description: '不透明第三方资源', columns: [{ id: 'native', label: '原值', width: 17 }], actions: [] };
    const registry = createResourceRegistry([...defaultResources, extension]);
    expect(registry.resolve('third')).toEqual(extension);
    expect(() => createResourceRegistry([...defaultResources, { ...extension, aliases: ['sessions'] }])).toThrow();
    expect(() => createResourceRegistry([{ ...extension, columns: [{ id: 'native', label: '原值', width: 0 }] }])).toThrow();
  });

  it('documents unavailable resource actions without exposing writes from details', async () => {
    const { createResourceRegistry } = await import('../src/tui/resources/registry.js');
    const registry = createResourceRegistry();
    expect(registry.actions('machines', 'list')).toEqual(expect.arrayContaining([
      expect.objectContaining({ shortcut: 'a', label: '让新机器接入', ownerResourceId: 'machines', enabled: false, mutation: true }),
      expect.objectContaining({ shortcut: 'Ctrl+D', label: '移除节点', enabled: false }),
      expect.objectContaining({ shortcut: 'v', label: '全星会话', enabled: false }),
    ]));
    for (const resource of registry.resources) {
      expect(registry.actions(resource.id, 'detail').every((action) => !action.mutation)).toBe(true);
      for (const action of resource.actions.filter((action) => action.enabled === false)) {
        expect(action.unavailableReason).toBeTruthy();
        expect(action.nextStep).toBeTruthy();
      }
    }
  });

  it('rejects wrong action owners and ambiguous action shortcuts', async () => {
    const { createResourceRegistry, defaultResources } = await import('../src/tui/resources/registry.js');
    const action = { id: 'rename', label: '改名', shortcut: 'e', ownerResourceId: 'sessions', selectionPolicy: 'required' as const, mutation: true, kind: 'form' as const, returnPolicy: 'restore' as const };
    const sessions = defaultResources.find((resource) => resource.id === 'sessions')!;
    expect(() => createResourceRegistry([{ ...sessions, actions: [{ ...action, ownerResourceId: 'machines' }] }])).toThrow();
    expect(() => createResourceRegistry([{ ...sessions, actions: [action, { ...action, id: 'other' }] }])).toThrow();
  });

  it('keeps differently named SSH contexts identifiable in a narrow terminal', async () => {
    const { createResourceRegistry } = await import('../src/tui/resources/registry.js');
    const { formatTable } = await import('../src/tui/ui/table.js');
    const columns = createResourceRegistry().resolve('ctx')!.columns;
    const table = formatTable({ columns, rows: [
      { id: 'ssh:alpha', cells: { kind: 'SSH', name: 'alpha', target: 'alpha.example' } },
      { id: 'ssh:beta', cells: { kind: 'SSH', name: 'beta', target: 'beta.example' } },
    ], width: 12 });
    expect(table.visibleColumnIds).toContain('name');
    expect(table.rows[0].text).toContain('alpha');
    expect(table.rows[1].text).toContain('beta');
    expect(table.rows[0].text).not.toBe(table.rows[1].text);
  });
});
