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
  command(controller, 'sessions'); await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
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
      clipboard.mockClear(); controller.handleKey({ name: 'y' });
      await vi.waitFor(() => expect(clipboard).toHaveBeenCalledWith('third unavailable，其他来源已完成', expect.any(AbortSignal)));
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

  it('uses row-over-page action fields for enum forms, rejects arbitrary input and retains choices after write failure', async () => {
    const adopt: TuiAction = { id: 'adopt', label: '收编所选会话', shortcut: 'a', ownerResourceId: 'sessions', kind: 'form', mutation: true, selectionPolicy: 'required', returnPolicy: 'restore', fields: [{ id: 'old', label: '旧静态字段' }] };
    const data = page();
    const fields = [{ id: 'starId', label: '已配置星', required: true, initialValue: 'star-one', options: [
      { value: 'star-one', label: '第一星' }, { value: 'revoked', label: '不可用星', enabled: false, reason: '权限已撤销' }, { value: 'star-two', label: '第二星' }, { value: 'star-three', label: '第三星' },
    ] }];
    data.actionAvailability = { adopt: { enabled: false, reason: '当前行不可收编', nextStep: '选择可用行', fields: [{ id: 'page-old', label: '页级字段' }] } };
    data.rows = data.rows.map((row, index) => index === 0 ? { ...row, actionAvailability: { ...row.actionAvailability, adopt: { enabled: true, fields } } } : row);
    const checkAction = vi.fn<TuiResourceAdapter['checkAction']>(async () => ({ enabled: true }));
    const mutate = vi.fn<TuiResourceAdapter['mutate']>(async () => { throw new Error('写入未完成，保留选择'); });
    const controller = createTuiController({ registry: registry([adopt]), contexts: [{ id: 'local', label: '本机', kind: 'local' }], adapters: { sessions: { read: async () => data, checkAction, mutate } } });
    try {
      await enter(controller);
      expect(controller.getSnapshot().actions.find((action) => action.id === 'adopt')).toMatchObject({ enabled: true, fields });
      controller.handleKey({ name: 'a' });
      await vi.waitFor(() => expect(controller.getSnapshot().overlay?.checking).toBe(false));
      expect(controller.getSnapshot().overlay?.fields).toMatchObject([{ id: 'starId', value: 'star-one', options: fields[0].options }]);
      expect(checkAction.mock.calls[0][0].action.fields).toEqual(fields);
      controller.handleKey({ name: 'down' }); expect(controller.getSnapshot().overlay?.fields[0].value).toBe('star-two');
      controller.handleKey({ name: 'left' }); expect(controller.getSnapshot().overlay?.fields[0].value).toBe('star-one');
      controller.handleKey({ name: ' ' }); expect(controller.getSnapshot().overlay?.fields[0].value).toBe('star-two');
      controller.handleKey({ name: 'home' }); expect(controller.getSnapshot().overlay?.fields[0].value).toBe('star-one');
      controller.handleKey({ name: 'end' }); expect(controller.getSnapshot().overlay?.fields[0].value).toBe('star-three');
      controller.handleKey({ name: 'text', text: 'arbitrary-star' }); controller.handleKey({ name: 'paste', text: 'arbitrary-star' });
      expect(controller.getSnapshot().overlay?.fields[0].value).toBe('star-three');
      controller.handleKey({ name: 'up' }); controller.handleKey({ name: 'enter' }); controller.handleKey({ name: 'tab' }); controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller.getSnapshot().overlay?.error).toContain('写入未完成'));
      expect(mutate.mock.calls[0][0]).toMatchObject({ target: { id: 'third/opaque/anonymous' }, values: { starId: 'star-two' } });
      expect(controller.getSnapshot().overlay?.fields[0].value).toBe('star-two');
      controller.handleKey({ name: 'escape' }); controller.handleKey({ name: 'down' });
      const before = checkAction.mock.calls.length;
      controller.handleKey({ name: '?' });
      expect(controller.getSnapshot().help?.entries.find((entry) => entry.id === 'adopt')).toMatchObject({ enabled: false, reason: '当前行不可收编' });
      controller.handleKey({ name: 'escape' }); controller.handleKey({ name: 'a' });
      expect(controller.getSnapshot().notice).toContain('当前行不可收编');
      expect(checkAction.mock.calls).toHaveLength(before);
    } finally { controller.dispose(); }
  });

  it('preserves a fixed enum value if an authority check removes that option and refuses to submit it', async () => {
    const adopt: TuiAction = { id: 'adopt', label: '收编', shortcut: 'a', ownerResourceId: 'sessions', kind: 'form', mutation: true, selectionPolicy: 'required', returnPolicy: 'restore' };
    const data = page();
    data.actionAvailability = { adopt: { enabled: true, fields: [{ id: 'starId', label: '目标星', required: true, initialValue: 'fixed-star', options: [{ value: 'fixed-star', label: '原星' }, { value: 'other-star', label: '另一星' }] }] } };
    let initial = true;
    const mutate = vi.fn(async () => ({}));
    const controller = createTuiController({ registry: registry([adopt]), contexts: [{ id: 'local', label: '本机', kind: 'local' }], adapters: { sessions: {
      read: async () => data,
      checkAction: async () => initial ? { enabled: true } : { enabled: true, fields: [{ id: 'starId', label: '目标星', required: true, options: [{ value: 'other-star', label: '另一星' }] }] }, mutate,
    } } });
    try {
      await enter(controller); controller.handleKey({ name: 'a' });
      await vi.waitFor(() => expect(controller.getSnapshot().overlay?.checking).toBe(false));
      initial = false;
      controller.handleKey({ name: 'enter' }); controller.handleKey({ name: 'tab' }); controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller.getSnapshot().overlay?.error).toContain('选项'));
      expect(controller.getSnapshot().overlay?.fields[0].value).toBe('fixed-star');
      expect(mutate).not.toHaveBeenCalled();
    } finally { controller.dispose(); }
  });

  it('keeps a disappearing facet selection explicit after refresh and lets the user return to the declared default', async () => {
    let data = page();
    const controller = createTuiController({ registry: registry(), contexts: [{ id: 'local', label: '本机', kind: 'local' }], adapters: { sessions: { read: async () => data } } });
    try {
      await enter(controller); controller.handleKey({ name: 't' }); controller.handleKey({ name: 'down' }); controller.handleKey({ name: 'enter' });
      data = { ...data, rows: [data.rows[1]], filters: [{ ...data.filters![0], options: [data.filters![0].options[0], data.filters![0].options[2]] }], completeness: 'partial' };
      await controller.refresh();
      expect(controller.getSnapshot()).toMatchObject({ rows: [], selectedFacets: { provider: 'third' }, completeness: 'partial' });
      controller.handleKey({ name: 't' });
      const choice = controller.getSnapshot().choice!;
      expect(choice.options[choice.selectedIndex]).toMatchObject({ value: 'third', enabled: false });
      controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot().mode).toBe('choice');
      controller.handleKey({ name: 'home' }); controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot()).toMatchObject({ mode: 'list', selectedFacets: { provider: 'all' } });
      expect(controller.getSnapshot().rows.map((row) => row.id)).toEqual(['codex/opaque/named-b']);
    } finally { controller.dispose(); }
  });

  it('rejects a confirmation whose authority removes a field instead of dropping its fixed value', async () => {
    const adopt: TuiAction = {
      id: 'adopt', label: '收编', shortcut: 'a', ownerResourceId: 'sessions', kind: 'form', mutation: true, selectionPolicy: 'required', returnPolicy: 'restore',
      fields: [{ id: 'starId', label: '目标星', required: true, initialValue: 'fixed-star', options: [{ value: 'fixed-star', label: '原星' }] }],
    };
    let initial = true;
    const mutate = vi.fn(async () => ({}));
    const controller = createTuiController({ registry: registry([adopt]), contexts: [{ id: 'local', label: '本机', kind: 'local' }], adapters: { sessions: {
      read: async () => page(), checkAction: async () => initial ? { enabled: true } : { enabled: true, fields: [] }, mutate,
    } } });
    try {
      await enter(controller); controller.handleKey({ name: 'a' });
      await vi.waitFor(() => expect(controller.getSnapshot().overlay?.checking).toBe(false));
      initial = false;
      controller.handleKey({ name: 'enter' }); controller.handleKey({ name: 'tab' }); controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller.getSnapshot().overlay?.error).toContain('字段'));
      expect(controller.getSnapshot().overlay?.fields).toMatchObject([{ id: 'starId', value: 'fixed-star' }]);
      expect(controller.getSnapshot().overlay?.targetId).toBe('third/opaque/anonymous');
      expect(mutate).not.toHaveBeenCalled();
    } finally { controller.dispose(); }
  });
});
