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
});
