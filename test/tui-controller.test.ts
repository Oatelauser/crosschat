import { describe, expect, it, vi } from 'vitest';
import type { TuiContext, TuiPage, TuiResourceAdapter, TuiRow } from '../src/tui/model.js';
import { createTuiController } from '../src/tui/app/controller.js';
import { createResourceRegistry, defaultResources } from '../src/tui/resources/registry.js';

const contexts: TuiContext[] = [
  { id: 'local', kind: 'local', label: '本机', target: 'fixture-pc' },
  { id: 'ssh:dev', kind: 'ssh', label: '开发机', description: 'SSH', target: 'dev' },
  { id: 'tcp:star', kind: 'tcp', label: '测试星', description: 'TCP', target: 'example:7260' },
];

function command(controller: ReturnType<typeof createTuiController>, value: string) {
  controller.handleKey({ name: ':' });
  controller.handleKey({ name: 'text', text: value });
  controller.handleKey({ name: 'enter' });
}

const third: TuiRow = {
  id: 'local:third-provider:opaque/full/one',
  cells: { name: '匿名', provider: 'third-provider', status: '未识别<awaiting-new-state>', directory: '/完整/搜索目录' },
  detail: [{ label: '原生 ID', value: 'opaque/full/one' }, { label: '状态', value: 'awaiting-new-state' }, { label: '完整路径', value: '/完整/搜索目录' }],
  copyValue: 'opaque/full/one',
};
const other: TuiRow = { id: 'local:other:two', cells: { name: '第二项', provider: 'other-provider' }, detail: [{ label: 'ID', value: 'two' }] };
function registry() {
  return createResourceRegistry(defaultResources.map((resource) => resource.id === 'sessions' ? { ...resource, unavailableReason: undefined, columns: [{ id: 'name', label: '名称', width: 24 }, { id: 'provider', label: '工具', width: 12 }] } : resource));
}

async function loaded(controller: ReturnType<typeof createTuiController>) {
  await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
}

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

  it('remembers a context selection without entering it and enters local and TCP defaults only on request', async () => {
    const controller = createTuiController({ registry: registry(), contexts, initialSelectedContextId: 'tcp:star', adapters: {} });
    try {
      expect(controller.getSnapshot()).toMatchObject({ route: { resourceId: 'ctx' }, selectedId: 'tcp:star', selectedIndex: 2 });
      controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot().route).toEqual({ resourceId: 'machines', contextId: 'tcp:star' });
      expect(controller.getSnapshot().completeness).toBe('unavailable');
      expect(controller.getSnapshot().notice).toContain('尚未接入');
      expect(controller.getSnapshot().context?.permissionLabel).toBeUndefined();
      controller.handleKey({ name: 'escape' });
      expect(controller.getSnapshot()).toMatchObject({ route: { resourceId: 'ctx' }, selectedId: 'tcp:star' });
      controller.handleKey({ name: 'home' });
      controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot().route).toEqual({ resourceId: 'sessions', contextId: 'local' });
    } finally { controller.dispose(); }
  });

  it('distinguishes exact commands, selected completions and pure filtering without triggering resource keys', async () => {
    const controller = createTuiController({ registry: registry(), contexts, adapters: {} });
    try {
      controller.handleKey({ name: ':' });
      controller.handleKey({ name: 'text', text: 's' });
      controller.handleKey({ name: 'tab' });
      expect(controller.getSnapshot().input).toMatchObject({ editor: { text: 'sessions' }, candidateIndex: 0 });
      controller.handleKey({ name: 'tab', shift: true });
      expect(controller.getSnapshot().input?.editor.text).toBe('services');
      controller.handleKey({ name: 'up' });
      expect(controller.getSnapshot().input?.candidates[controller.getSnapshot().input!.candidateIndex!].id).toBe('status');
      controller.handleKey({ name: 'down' });
      controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot().route.resourceId).toBe('services');
      command(controller, 'ctx');
      controller.handleKey({ name: '/' });
      controller.handleKey({ name: 'text', text: 'sessions' });
      expect(controller.getSnapshot().input?.candidates).toEqual([]);
      controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot()).toMatchObject({ mode: 'list', route: { resourceId: 'ctx' }, filter: 'sessions' });
      controller.handleKey({ name: 'escape' });
      command(controller, 'ssh');
      expect(controller.getSnapshot().route.resourceId).toBe('ssh');
      controller.handleKey({ name: ':' });
      controller.handleKey({ name: 'text', text: 'does-not-match' });
      controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot()).toMatchObject({ route: { resourceId: 'ssh' }, filter: 'does-not-match' });
    } finally { controller.dispose(); }
  });

  it('preserves stable selection, scroll and filtering through refresh, detail and route return', async () => {
    let rows: readonly TuiRow[] = Array.from({ length: 18 }, (_, index) => ({ id: `row-${index}`, cells: { name: `fixture ${index}` } }));
    const adapter: TuiResourceAdapter = { read: async () => ({ rows, completeness: 'complete' }) };
    const controller = createTuiController({ registry: registry(), contexts, adapters: { sessions: adapter } });
    try {
      controller.resize(60, 12);
      command(controller, 'sessions');
      await loaded(controller);
      controller.handleKey({ name: 'end' });
      const before = controller.getSnapshot();
      expect(before.selectedId).toBe('row-17');
      expect(before.scrollOffset).toBeGreaterThan(0);
      rows = [...rows].reverse();
      await controller.refresh();
      expect(controller.getSnapshot().selectedId).toBe('row-17');
      controller.handleKey({ name: '/' });
      controller.handleKey({ name: 'text', text: '17' });
      controller.handleKey({ name: 'enter' });
      controller.handleKey({ name: 'd' });
      expect(controller.getSnapshot().mode).toBe('detail');
      controller.handleKey({ name: 'escape' });
      expect(controller.getSnapshot()).toMatchObject({ mode: 'list', filter: '17', selectedId: 'row-17' });
      command(controller, 'ctx');
      controller.handleKey({ name: 'escape' });
      expect(controller.getSnapshot()).toMatchObject({ route: { resourceId: 'sessions' }, filter: '17', selectedId: 'row-17' });
      controller.handleKey({ name: ':' });
      controller.handleKey({ name: 'text', text: 'nothing' });
      controller.handleKey({ name: 'escape' });
      expect(controller.getSnapshot()).toMatchObject({ filter: '17', selectedId: 'row-17' });
    } finally { controller.dispose(); }
  });

  it('uses the same read-only detail for an unknown provider and copies full raw fields', async () => {
    const clipboard = vi.fn(async () => {});
    const controller = createTuiController({ registry: registry(), contexts, adapters: { sessions: { read: async () => ({ rows: [third, other], completeness: 'partial', notice: '一个来源尚未完成' }) } }, clipboard });
    try {
      command(controller, 'sessions');
      await loaded(controller);
      controller.handleKey({ name: '/' });
      controller.handleKey({ name: 'text', text: '搜索目录' });
      controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot().rows).toEqual([third]);
      expect(controller.getSnapshot().completeness).toBe('partial');
      controller.handleKey({ name: 'd' });
      expect(controller.getSnapshot().detail?.fields).toEqual(third.detail);
      controller.handleKey({ name: 'down' });
      controller.handleKey({ name: 'y' });
      await vi.waitFor(() => expect(clipboard).toHaveBeenCalledWith('awaiting-new-state', expect.any(AbortSignal)));
      controller.handleKey({ name: '/' });
      controller.handleKey({ name: 'text', text: '完整路径' });
      controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot().detail).toMatchObject({ selectedIndex: 2, query: '完整路径' });
      controller.handleKey({ name: 'a' });
      controller.handleKey({ name: 'd', ctrl: true });
      expect(controller.getSnapshot().mode).toBe('detail');
      expect(controller.getSnapshot().actions.every((action) => !['新增', '移除'].includes(action.label))).toBe(true);
    } finally { controller.dispose(); }
  });

  it('cancels foreground reads promptly and ignores results that arrive after navigation or disposal', async () => {
    const finishes: Array<(page: TuiPage) => void> = [];
    const signals: AbortSignal[] = [];
    const onExit = vi.fn();
    const adapter: TuiResourceAdapter = { read: ({ signal }) => { signals.push(signal); return new Promise((resolve) => { finishes.push(resolve); }); } };
    const controller = createTuiController({ registry: registry(), contexts, adapters: { sessions: adapter }, onExit });
    command(controller, 'sessions');
    expect(controller.getSnapshot().loading).toBe(true);
    controller.handleKey({ name: 'c', ctrl: true });
    expect(signals[0].aborted).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ loading: false, completeness: 'cancelled' });
    expect(onExit).not.toHaveBeenCalled();
    const pending = controller.refresh();
    command(controller, 'ctx');
    expect(signals[1].aborted).toBe(true);
    finishes[0]({ rows: [third], completeness: 'complete' });
    finishes[1]({ rows: [other], completeness: 'complete' });
    await pending;
    expect(controller.getSnapshot().route.resourceId).toBe('ctx');
    expect(controller.getSnapshot().rows).not.toContainEqual(third);
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    unsubscribe();
    controller.resize(90, 30);
    expect(listener).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('renders help from the registered actions and prevents help keystrokes reaching the list', async () => {
    const onExit = vi.fn();
    const controller = createTuiController({ registry: registry(), contexts, adapters: {}, onExit });
    try {
      const actions = controller.getSnapshot().actions;
      controller.handleKey({ name: '?' });
      expect(controller.getSnapshot().help?.entries).toEqual(actions);
      controller.handleKey({ name: 'q' });
      controller.handleKey({ name: 'j' });
      controller.handleKey({ name: 'a' });
      expect(controller.getSnapshot()).toMatchObject({ mode: 'help', selectedId: 'local' });
      expect(onExit).not.toHaveBeenCalled();
      controller.handleKey({ name: 'escape' });
      controller.handleKey({ name: 'q' });
      expect(onExit).toHaveBeenCalledOnce();
    } finally { controller.dispose(); }
  });
});
