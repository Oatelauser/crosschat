import { describe, expect, it, vi } from 'vitest';
import { createTuiController } from '../src/tui/app/controller.js';
import { createResourceRegistry, defaultResources } from '../src/tui/resources/registry.js';
import type { TuiAction, TuiPage, TuiResourceAdapter } from '../src/tui/model.js';

const actions: readonly TuiAction[] = [
  { id: 'tool', label: '工具筛选', shortcut: 't', ownerResourceId: 'sessions', kind: 'filter', filterId: 'provider', mutation: false, selectionPolicy: 'none', returnPolicy: 'restore' },
  { id: 'anonymous', label: '匿名筛选', shortcut: 'u', ownerResourceId: 'sessions', kind: 'filter', filterId: 'naming', mutation: false, selectionPolicy: 'none', returnPolicy: 'restore' },
  { id: 'guide', label: '原生指引', shortcut: 'g', ownerResourceId: 'sessions', kind: 'detail', viewId: 'guide', mutation: false, selectionPolicy: 'required', returnPolicy: 'restore' },
  { id: 'info', label: '读取信息', shortcut: 'i', ownerResourceId: 'sessions', kind: 'detail', viewId: 'info', mutation: false, selectionPolicy: 'none', returnPolicy: 'restore' },
  { id: 'copy-ref', label: '完整引用', shortcut: 'Y', ownerResourceId: 'sessions', kind: 'copy', copyKey: 'ref', mutation: false, selectionPolicy: 'required', returnPolicy: 'restore' },
];
function registry(extra: readonly TuiAction[] = []) {
  return createResourceRegistry(defaultResources.map((resource) => resource.id === 'sessions' ? { ...resource, unavailableReason: undefined, actions: [...actions, ...extra] } : resource));
}
function page(): TuiPage {
  return {
    sampledAt: 12345, completeness: 'complete',
    filters: [
      { id: 'provider', label: '工具', mode: 'select', defaultValue: 'all', options: [{ value: 'all', label: '全部工具' }, { value: 'third', label: '第三工具' }, { value: 'codex', label: 'Codex' }] },
      { id: 'naming', label: '匿名', mode: 'toggle', defaultValue: 'all', options: [{ value: 'all', label: '含匿名' }, { value: 'named', label: '仅命名' }] },
    ],
    rows: [
      { id: 'third/opaque/anonymous', cells: { name: '匿名', tool: 'third' }, facets: { provider: 'third', naming: 'anonymous' }, copyValues: { ref: '{"providerId":"third","nativeId":"opaque/anonymous"}' }, detailViews: { guide: { title: '第三工具指引', fields: [{ label: '说明', value: '请在原生工具查看完整会话' }] } }, actionAvailability: { copy: { enabled: false, reason: '没有可发送地址' } } },
      { id: 'codex/opaque/named-b', cells: { name: 'named-b', tool: 'codex' }, facets: { provider: 'codex', naming: 'named' }, copyValue: 'complete-address-b' },
      { id: 'third/opaque/named-c', cells: { name: 'named-c', tool: 'third' }, facets: { provider: 'third', naming: 'named' } },
    ],
    detailViews: { info: { title: '完整读取信息', fields: [{ label: '来源', value: 'third unavailable，其他来源已完成' }] } },
  };
}
function command(controller: ReturnType<typeof createTuiController>, text: string) {
  controller.handleKey({ name: ':' }); controller.handleKey({ name: 'text', text }); controller.handleKey({ name: 'enter' });
}
async function enter(controller: ReturnType<typeof createTuiController>) {
  controller.handleKey({ name: 'enter' }); await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
}

describe('resource-neutral filters and read-only actions', () => {
  it('selects and toggles opaque facets independently of full text and restores them per route without rereading sources', async () => {
    const read = vi.fn(async () => page());
    const controller = createTuiController({ registry: registry(), contexts: [{ id: 'local', label: '本机', kind: 'local' }], adapters: { sessions: { read } } });
    try {
      await enter(controller);
      expect(controller.getSnapshot()).toMatchObject({ sampledAt: 12345, selectedFacets: { provider: 'all', naming: 'all' } });
      controller.handleKey({ name: 't' });
      expect(controller.getSnapshot().choice).toMatchObject({ filterId: 'provider', selectedIndex: 0 });
      controller.handleKey({ name: 'end' }); controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot().rows.map((row) => row.id)).toEqual(['codex/opaque/named-b']);
      controller.handleKey({ name: 'u' });
      controller.handleKey({ name: 't' }); controller.handleKey({ name: 'home' }); controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot().rows.map((row) => row.id)).toEqual(['codex/opaque/named-b', 'third/opaque/named-c']);
      controller.handleKey({ name: '/' }); controller.handleKey({ name: 'text', text: 'named-c' }); controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot().rows.map((row) => row.id)).toEqual(['third/opaque/named-c']);
      command(controller, 'ctx'); controller.handleKey({ name: 'escape' });
      expect(controller.getSnapshot()).toMatchObject({ selectedId: 'third/opaque/named-c', filter: 'named-c', selectedFacets: { provider: 'all', naming: 'named' } });
      expect(read).toHaveBeenCalledOnce();
    } finally { controller.dispose(); }
  });

  it('offers registered choice keys and prevents disabled choices or keystrokes from changing the list', async () => {
    const data = page();
    data.filters = [{ ...data.filters![0], options: [...data.filters![0].options, { value: 'unavailable', label: '不可用工具', enabled: false, reason: '来源尚未可用' }] }];
    const onExit = vi.fn();
    const controller = createTuiController({ registry: registry(), contexts: [{ id: 'local', label: '本机', kind: 'local' }], adapters: { sessions: { read: async () => data } }, onExit });
    try {
      await enter(controller); controller.handleKey({ name: 't' });
      expect(controller.getSnapshot().actions).toEqual(expect.arrayContaining([expect.objectContaining({ shortcut: 'Enter', label: '应用筛选' })]));
      controller.handleKey({ name: 'end' }); controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot()).toMatchObject({ mode: 'choice', notice: '来源尚未可用' });
      controller.handleKey({ name: 'q' }); controller.handleKey({ name: 'paste', text: 'u' });
      expect(controller.getSnapshot().selectedId).toBe('third/opaque/anonymous');
      expect(onExit).not.toHaveBeenCalled();
      controller.handleKey({ name: '?' });
      expect(controller.getSnapshot().mode).toBe('help');
      controller.handleKey({ name: 'escape' });
      expect(controller.getSnapshot().mode).toBe('choice');
      controller.handleKey({ name: 'escape' });
      expect(controller.getSnapshot()).toMatchObject({ mode: 'list', selectedFacets: { provider: 'all' } });
    } finally { controller.dispose(); }
  });

  it('shows full option labels, values and reasons in a read-only view and returns to the same choice position', async () => {
    const data = page();
    const value = 'opaque/provider/value/'.repeat(12);
    const label = '完整工具名称👩‍💻'.repeat(20);
    data.filters = [{ ...data.filters![0], defaultValue: '', options: [{ value: '', label: '全部' }, { value, label, enabled: false, reason: '来源不可用'.repeat(30) }] }];
    const clipboard = vi.fn(async () => {});
    const controller = createTuiController({ registry: registry(), contexts: [{ id: 'local', label: '本机', kind: 'local' }], adapters: { sessions: { read: async () => data } }, clipboard });
    try {
      controller.resize(30, 18); await enter(controller); controller.handleKey({ name: 't' }); controller.handleKey({ name: 'end' });
      controller.handleKey({ name: 'd' });
      expect(controller.getSnapshot().detail?.fields).toEqual(expect.arrayContaining([
        expect.objectContaining({ value: label }), expect.objectContaining({ value }), expect.objectContaining({ value: '来源不可用'.repeat(30) }),
      ]));
      controller.handleKey({ name: 'escape' });
      expect(controller.getSnapshot()).toMatchObject({ mode: 'choice', choice: { selectedIndex: 1 } });
      controller.handleKey({ name: 'y' });
      await vi.waitFor(() => expect(clipboard).toHaveBeenCalledWith(value, expect.any(AbortSignal)));
      controller.handleKey({ name: 'escape' });
      expect(controller.getSnapshot().selectedFacets?.provider).toBe('');
      expect(controller.getSnapshot().totalRows).toBe(3);
    } finally { controller.dispose(); }
  });

  it('opens named read-only views with or without rows and copies explicit values instead of an internal key', async () => {
    const clipboard = vi.fn(async () => {});
    let data = page();
    const controller = createTuiController({ registry: registry(), contexts: [{ id: 'local', label: '本机', kind: 'local' }], adapters: { sessions: { read: async () => data } }, clipboard });
    try {
      await enter(controller);
      expect(controller.getSnapshot().actions.find((action) => action.id === 'copy')).toMatchObject({ enabled: false, reason: '没有可发送地址' });
      controller.handleKey({ name: 'y' });
      expect(clipboard).not.toHaveBeenCalled();
      controller.handleKey({ name: 'Y' });
      await vi.waitFor(() => expect(clipboard).toHaveBeenCalledWith('{"providerId":"third","nativeId":"opaque/anonymous"}', expect.any(AbortSignal)));
      controller.handleKey({ name: 'g' });
      expect(controller.getSnapshot().detail).toMatchObject({ title: '第三工具指引', fields: [{ value: '请在原生工具查看完整会话' }] });
      controller.handleKey({ name: 'escape' });
      data = { ...data, rows: [], completeness: 'partial' }; await controller.refresh();
      controller.handleKey({ name: 'i' });
      expect(controller.getSnapshot().detail).toMatchObject({ title: '完整读取信息', fields: [{ value: 'third unavailable，其他来源已完成' }] });
    } finally { controller.dispose(); }
  });

  it('binds a resource command from ctx to the original selected context and reports unimplemented commands', async () => {
    const read = vi.fn<TuiResourceAdapter['read']>(async ({ context }) => ({ rows: [], completeness: 'unavailable', notice: `未接入 ${context?.id}` }));
    const unknown: TuiAction = { id: 'extension-command', label: '尚未接入', shortcut: 'x', ownerResourceId: 'sessions', kind: 'command', mutation: false, selectionPolicy: 'none', returnPolicy: 'restore' };
    const controller = createTuiController({ registry: registry([unknown]), contexts: [{ id: 'local', label: '本机', kind: 'local' }, { id: 'ssh:dev', label: '远端', kind: 'ssh' }], initialSelectedContextId: 'ssh:dev', adapters: { sessions: { read } } });
    try {
      command(controller, 'sessions'); await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
      expect(controller.getSnapshot().route).toEqual({ resourceId: 'sessions', contextId: 'ssh:dev' });
      expect(read.mock.calls[0][0].context?.id).toBe('ssh:dev');
      controller.handleKey({ name: 'x' });
      expect(controller.getSnapshot().notice).toContain('尚未接入');
    } finally { controller.dispose(); }
  });
});
