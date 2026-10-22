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
});
