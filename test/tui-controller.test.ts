import { describe, expect, it, vi } from 'vitest';
import type { TuiAction, TuiActionRequest, TuiContext, TuiPage, TuiResourceAdapter, TuiRow } from '../src/tui/model.js';
import { createTuiController } from '../src/tui/app/controller.js';
import { createResourceRegistry, defaultResources } from '../src/tui/resources/registry.js';

const contexts: TuiContext[] = [
  { id: 'local', kind: 'local', label: '本机', target: 'fixture-pc' },
  { id: 'ssh:dev', kind: 'ssh', label: '开发机', description: 'SSH', target: 'dev' },
  { id: 'tcp:orbit', kind: 'tcp', label: '测试星', description: 'TCP', target: 'example:7260' },
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

const rename: TuiAction = {
  id: 'rename', label: '修改显示名', shortcut: 'e', ownerResourceId: 'sessions', selectionPolicy: 'required', capability: 'rename', mutation: true,
  kind: 'form', fields: [{ id: 'name', label: '显示名', required: true }], impact: ['只修改当前目标的显示名'], returnPolicy: 'restore',
};
function mutationRegistry(action: TuiAction = rename) {
  return createResourceRegistry(defaultResources.map((resource) => resource.id === 'sessions' ? { ...resource, unavailableReason: undefined, actions: [action] } : resource));
}

describe('TUI interaction controller', () => {
  it('starts on ctx with stable snapshots and filters its rows while offering commands', async () => {
    const { createTuiController } = await import('../src/tui/app/controller.js');
    const { createResourceRegistry } = await import('../src/tui/resources/registry.js');
    const controller = createTuiController({ registry: createResourceRegistry(), contexts, adapters: {} });
    try {
      const initial = controller.getSnapshot();
      expect(initial.route).toEqual({ resourceId: 'ctx' });
      expect(initial.rows.map((row) => row.id)).toEqual(['local', 'ssh:dev', 'tcp:orbit']);
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
    const controller = createTuiController({ registry: registry(), contexts, initialSelectedContextId: 'tcp:orbit', adapters: {} });
    try {
      expect(controller.getSnapshot()).toMatchObject({ route: { resourceId: 'ctx' }, selectedId: 'tcp:orbit', selectedIndex: 2 });
      controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot().route).toEqual({ resourceId: 'machines', contextId: 'tcp:orbit' });
      expect(controller.getSnapshot().completeness).toBe('unavailable');
      expect(controller.getSnapshot().notice).toContain('尚未启用');
      expect(controller.getSnapshot().context?.permissionLabel).toBeUndefined();
      controller.handleKey({ name: 'escape' });
      expect(controller.getSnapshot()).toMatchObject({ route: { resourceId: 'ctx' }, selectedId: 'tcp:orbit' });
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

  it('opens owner forms with fixed targets, defaults confirmation to cancel and isolates field input', async () => {
    const mutate = vi.fn(async () => ({ message: '完成' }));
    const onExit = vi.fn();
    const controller = createTuiController({ registry: mutationRegistry(), contexts, adapters: { sessions: {
      read: async () => ({ rows: [third, other], completeness: 'complete' }), checkAction: async () => ({ enabled: true, impact: ['只修改显示名'] }), mutate,
    } }, onExit });
    try {
      controller.handleKey({ name: 'enter' });
      await loaded(controller);
      controller.handleKey({ name: 'e' });
      await vi.waitFor(() => expect(controller.getSnapshot().mode).toBe('form'));
      expect(controller.getSnapshot().overlay).toMatchObject({ ownerResourceId: 'sessions', targetId: third.id, contextId: 'local', confirmationDefault: 'cancel', fields: [{ id: 'name', value: '匿名' }] });
      controller.handleKey({ name: 'text', text: 'qj?' });
      expect(controller.getSnapshot().overlay?.fields[0].value).toBe('匿名qj?');
      expect(controller.getSnapshot().selectedId).toBe(third.id);
      expect(onExit).not.toHaveBeenCalled();
      controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot().overlay).toMatchObject({ phase: 'confirming', focusIndex: 1 });
      controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot().mode).toBe('list');
      expect(mutate).not.toHaveBeenCalled();
      controller.handleKey({ name: 'd' });
      controller.handleKey({ name: 'e' });
      expect(controller.getSnapshot().mode).toBe('detail');
      expect(mutate).not.toHaveBeenCalled();
    } finally { controller.dispose(); }
  });

  it('revalidates permissions and the original target, preserves failed form values and restores the source list after success', async () => {
    let rows: readonly TuiRow[] = [third, other];
    let allowed = true;
    let fail = true;
    const mutate = vi.fn(async (request: TuiActionRequest) => {
      if (fail) throw new Error('写入失败，请保留输入');
      rows = rows.map((row) => row.id === request.target?.id ? { ...row, cells: { ...row.cells, name: request.values.name } } : row);
      return { selectedId: third.id, message: '显示名已更新' };
    });
    const controller = createTuiController({ registry: mutationRegistry(), contexts, adapters: { sessions: {
      read: async () => ({ rows, completeness: 'complete' }),
      checkAction: async () => allowed ? { enabled: true, impact: ['当前目标显示名'] } : { enabled: false, reason: '权限已撤销', nextStep: '请重新核实授权' }, mutate,
    } } });
    try {
      controller.handleKey({ name: 'enter' }); await loaded(controller);
      controller.handleKey({ name: '/' }); controller.handleKey({ name: 'text', text: 'third-provider' }); controller.handleKey({ name: 'enter' });
      controller.handleKey({ name: 'e' });
      await vi.waitFor(() => expect(controller.getSnapshot().mode).toBe('form'));
      controller.handleKey({ name: 'text', text: ' 新名' });
      rows = [other, third]; await controller.refresh();
      expect(controller.getSnapshot().overlay?.targetId).toBe(third.id);
      controller.handleKey({ name: 'enter' }); controller.handleKey({ name: 'tab' });
      allowed = false; controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller.getSnapshot().overlay?.error).toContain('权限已撤销'));
      expect(controller.getSnapshot().overlay?.fields[0].value).toBe('匿名 新名');
      expect(mutate).not.toHaveBeenCalled();
      allowed = true; controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller.getSnapshot().overlay?.error).toContain('写入失败'));
      expect(controller.getSnapshot().overlay?.fields[0].value).toBe('匿名 新名');
      expect(mutate.mock.calls[0][0].target?.id).toBe(third.id);
      fail = false; controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller.getSnapshot().mode).toBe('list'));
      expect(controller.getSnapshot()).toMatchObject({ filter: 'third-provider', selectedId: third.id, notice: '显示名已更新' });
      expect(controller.getSnapshot().rows[0].cells.name).toBe('匿名 新名');
    } finally { controller.dispose(); }
  });

  it('does not retarget confirmation when a refreshed list removes the original selection', async () => {
    let rows: readonly TuiRow[] = [third, other];
    const mutate = vi.fn(async () => ({}));
    const controller = createTuiController({ registry: mutationRegistry({ ...rename, fields: [] }), contexts, adapters: { sessions: {
      read: async () => ({ rows, completeness: 'complete' }), checkAction: async () => ({ enabled: true }), mutate,
    } } });
    try {
      controller.handleKey({ name: 'enter' }); await loaded(controller);
      controller.handleKey({ name: 'e' }); await vi.waitFor(() => expect(controller.getSnapshot().mode).toBe('form'));
      rows = [other]; await controller.refresh();
      controller.handleKey({ name: 'tab' }); controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller.getSnapshot().overlay?.error).toContain('目标已不存在'));
      expect(controller.getSnapshot().overlay?.targetId).toBe(third.id);
      expect(mutate).not.toHaveBeenCalled();
    } finally { controller.dispose(); }
  });

  it('marks an issued write as uncertain when the user cancels waiting and ignores its late result', async () => {
    let finish: ((result: { message?: string }) => void) | undefined;
    const mutate = vi.fn(() => new Promise<{ message?: string }>((resolve) => { finish = resolve; }));
    const controller = createTuiController({ registry: mutationRegistry({ ...rename, fields: [] }), contexts, adapters: { sessions: {
      read: async () => ({ rows: [third], completeness: 'complete' }), checkAction: async () => ({ enabled: true }), mutate,
    } } });
    try {
      controller.handleKey({ name: 'enter' }); await loaded(controller);
      controller.handleKey({ name: 'e' }); await vi.waitFor(() => expect(controller.getSnapshot().mode).toBe('form'));
      controller.handleKey({ name: 'tab' }); controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller.getSnapshot().overlay?.phase).toBe('submitting'));
      controller.handleKey({ name: 'escape' });
      expect(controller.getSnapshot()).toMatchObject({ mode: 'list' });
      expect(controller.getSnapshot().notice).toContain('待核实');
      expect(controller.getSnapshot().notice).not.toContain('回滚');
      command(controller, 'ctx');
      finish?.({ message: '不应覆盖当前页面' });
      await Promise.resolve(); await Promise.resolve();
      expect(controller.getSnapshot()).toMatchObject({ mode: 'list', route: { resourceId: 'ctx' } });
      expect(controller.getSnapshot().notice).not.toBe('不应覆盖当前页面');
      expect(mutate).toHaveBeenCalledOnce();
    } finally { controller.dispose(); }
  });

  it('supports field cursor editing and pastes while ignoring pasted list shortcuts', async () => {
    const onExit = vi.fn();
    const controller = createTuiController({ registry: mutationRegistry(), contexts, adapters: { sessions: {
      read: async () => ({ rows: [third], completeness: 'complete' }), checkAction: async () => ({ enabled: true }), mutate: async () => ({}),
    } }, onExit });
    try {
      controller.handleKey({ name: 'paste', text: 'q' });
      expect(onExit).not.toHaveBeenCalled();
      controller.handleKey({ name: 'enter' }); await loaded(controller);
      controller.handleKey({ name: 'e' }); await vi.waitFor(() => expect(controller.getSnapshot().mode).toBe('form'));
      controller.handleKey({ name: 'home' }); controller.handleKey({ name: 'delete' });
      controller.handleKey({ name: 'paste', text: '👩‍💻é' });
      expect(controller.getSnapshot().overlay?.fields[0]).toMatchObject({ value: '👩‍💻é名', cursor: 2 });
      controller.handleKey({ name: 'left' }); controller.handleKey({ name: 'backspace' });
      expect(controller.getSnapshot().overlay?.fields[0]).toMatchObject({ value: 'é名', cursor: 0 });
      controller.handleKey({ name: 'c', ctrl: true });
      expect(controller.getSnapshot().mode).toBe('list');
      expect(onExit).not.toHaveBeenCalled();
    } finally { controller.dispose(); }
  });

  it('scrolls the full value of a single long detail field and keeps copying its original value', async () => {
    const value = '长字段👩‍💻'.repeat(30);
    const clipboard = vi.fn(async () => {});
    const controller = createTuiController({ registry: registry(), contexts, adapters: { sessions: { read: async () => ({ rows: [{ id: 'long', cells: { name: '长字段' }, detail: [{ label: '完整值', value }] }], completeness: 'complete' }) } }, clipboard });
    try {
      controller.resize(30, 12);
      command(controller, 'sessions'); await loaded(controller);
      controller.handleKey({ name: 'd' }); controller.handleKey({ name: 'pagedown' });
      expect(controller.getSnapshot().detail?.scrollOffset).toBeGreaterThan(0);
      controller.handleKey({ name: 'end' });
      expect(controller.getSnapshot().detail?.scrollOffset).toBeGreaterThan(3);
      controller.handleKey({ name: 'y' });
      await vi.waitFor(() => expect(clipboard).toHaveBeenCalledWith(value, expect.any(AbortSignal)));
      controller.handleKey({ name: 'home' });
      expect(controller.getSnapshot().detail?.scrollOffset).toBe(0);
    } finally { controller.dispose(); }
  });

  it('keeps secret form values out of permission, write and success messages while preserving the field', async () => {
    const secret = 'fixture-secret-value';
    const action: TuiAction = { ...rename, fields: [{ id: 'token', label: '秘密', secret: true, initialValue: secret }] };
    let step = 0;
    const controller = createTuiController({ registry: mutationRegistry(action), contexts, adapters: { sessions: {
      read: async () => ({ rows: [third], completeness: 'complete' }),
      checkAction: async () => step === 0 ? { enabled: false, reason: `权限拒绝 ${secret}` } : { enabled: true },
      mutate: async () => { if (step === 1) throw new Error(`写入失败 ${secret}`); return { message: `已完成 ${secret}` }; },
    } } });
    try {
      controller.handleKey({ name: 'enter' }); await loaded(controller);
      controller.handleKey({ name: 'e' });
      await vi.waitFor(() => expect(controller.getSnapshot().overlay?.error).toContain('权限拒绝'));
      expect(controller.getSnapshot().overlay?.error).not.toContain(secret);
      expect(controller.getSnapshot().overlay?.fields[0].value).toBe(secret);
      step = 1; controller.handleKey({ name: 'enter' }); controller.handleKey({ name: 'tab' }); controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller.getSnapshot().overlay?.error).toContain('写入失败'));
      expect(controller.getSnapshot().overlay?.error).not.toContain(secret);
      expect(controller.getSnapshot().overlay?.fields[0].value).toBe(secret);
      step = 2; controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller.getSnapshot().mode).toBe('list'));
      expect(controller.getSnapshot().notice).toContain('已完成');
      expect(controller.getSnapshot().notice).not.toContain(secret);
    } finally { controller.dispose(); }
  });

  it('aborts copy ownership on route change and keeps late clipboard results away from the new page', async () => {
    let finish: (() => void) | undefined;
    let signal: AbortSignal | undefined;
    const controller = createTuiController({ registry: registry(), contexts, adapters: {}, clipboard: (_text, currentSignal) => {
      signal = currentSignal; return new Promise<void>((resolve) => { finish = resolve; });
    } });
    try {
      controller.handleKey({ name: 'y' });
      expect(signal?.aborted).toBe(false);
      command(controller, 'sessions');
      expect(signal?.aborted).toBe(true);
      finish?.(); await Promise.resolve();
      expect(controller.getSnapshot().notice).not.toBe('已复制完整值');
    } finally { controller.dispose(); }
  });

  it('marks interrupted cached reads as cancelled and rejects ambiguous row identities', async () => {
    let count = 0;
    let finish: ((page: TuiPage) => void) | undefined;
    const controller = createTuiController({ registry: registry(), contexts, adapters: { sessions: { read: async () => {
      count++;
      if (count === 1) return { rows: [third], completeness: 'complete' };
      if (count === 2) return new Promise<TuiPage>((resolve) => { finish = resolve; });
      return { rows: [third, { ...other, id: third.id }], completeness: 'complete' };
    } } } });
    try {
      command(controller, 'sessions'); await loaded(controller);
      const pending = controller.refresh(); command(controller, 'ctx');
      controller.handleKey({ name: 'escape' });
      expect(controller.getSnapshot()).toMatchObject({ route: { resourceId: 'sessions' }, completeness: 'cancelled', rows: [third] });
      finish?.({ rows: [other], completeness: 'complete' }); await pending;
      await controller.refresh();
      expect(controller.getSnapshot().error).toContain('重复稳定标识');
      expect(controller.getSnapshot().completeness).toBe('partial');
      expect(controller.getSnapshot().rows).toEqual([third]);
    } finally { controller.dispose(); }
  });

  it('applies global Ctrl+C in input and help while keeping form cancellation local', async () => {
    for (const key of [':', '?']) {
      const onExit = vi.fn();
      const controller = createTuiController({ registry: registry(), contexts, adapters: {}, onExit });
      try {
        controller.handleKey({ name: key });
        if (key === ':') controller.handleKey({ name: 'text', text: 'draft' });
        controller.handleKey({ name: 'c', ctrl: true });
        expect(onExit).toHaveBeenCalledOnce();
        expect(controller.getSnapshot().filter).toBe('');
      } finally { controller.dispose(); }
    }
    for (const key of [':', '?']) {
      let signal: AbortSignal | undefined;
      const onExit = vi.fn();
      const controller = createTuiController({ registry: registry(), contexts, adapters: { sessions: { read: (request) => {
        signal = request.signal; return new Promise<TuiPage>(() => {});
      } } }, onExit });
      try {
        command(controller, 'sessions'); controller.handleKey({ name: key });
        controller.handleKey({ name: 'c', ctrl: true });
        expect(signal?.aborted).toBe(true);
        expect(controller.getSnapshot()).toMatchObject({ loading: false, completeness: 'cancelled' });
        expect(onExit).not.toHaveBeenCalled();
      } finally { controller.dispose(); }
    }
  });

  it('selects a created stable result after refreshing the owner list', async () => {
    let rows: readonly TuiRow[] = [third];
    const create: TuiAction = { ...rename, id: 'create', label: '创建测试项', shortcut: 'a', selectionPolicy: 'none', returnPolicy: 'select-result', fields: [{ id: 'name', label: '名称', required: true }] };
    const controller = createTuiController({ registry: mutationRegistry(create), contexts, adapters: { sessions: {
      read: async () => ({ rows, completeness: 'complete' }), checkAction: async () => ({ enabled: true }), mutate: async (request) => {
        rows = [...rows, { id: 'new/stable/identifier', cells: { name: request.values.name } }];
        return { selectedId: 'new/stable/identifier', message: '已创建' };
      },
    } } });
    try {
      controller.handleKey({ name: 'enter' }); await loaded(controller);
      controller.handleKey({ name: 'a' }); await vi.waitFor(() => expect(controller.getSnapshot().mode).toBe('form'));
      controller.handleKey({ name: 'text', text: '新项' }); controller.handleKey({ name: 'enter' });
      controller.handleKey({ name: 'tab' }); controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller.getSnapshot().notice).toBe('已创建'));
      expect(controller.getSnapshot()).toMatchObject({ mode: 'list', selectedId: 'new/stable/identifier', selectedIndex: 1 });
    } finally { controller.dispose(); }
  });

  it('requires a second explicit confirmation when authority reports a changed impact', async () => {
    let impact = ['影响一项'];
    const mutate = vi.fn(async () => ({}));
    const controller = createTuiController({ registry: mutationRegistry({ ...rename, fields: [] }), contexts, adapters: { sessions: {
      read: async () => ({ rows: [third], completeness: 'complete' }), checkAction: async () => ({ enabled: true, impact }), mutate,
    } } });
    try {
      controller.handleKey({ name: 'enter' }); await loaded(controller);
      controller.handleKey({ name: 'e' });
      await vi.waitFor(() => expect(controller.getSnapshot().overlay?.impact).toContain('影响一项'));
      impact = ['影响两项']; controller.handleKey({ name: 'tab' }); controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller.getSnapshot().overlay?.error).toContain('影响范围已更新'));
      expect(controller.getSnapshot().overlay).toMatchObject({ focusIndex: 0, phase: 'confirming' });
      expect(controller.getSnapshot().overlay?.impact).toContain('影响两项');
      expect(mutate).not.toHaveBeenCalled();
      controller.handleKey({ name: 'tab' }); controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(mutate).toHaveBeenCalledOnce());
    } finally { controller.dispose(); }
  });

  it('keeps complete help reasons and next steps reachable in a narrow terminal', async () => {
    const { helpLines } = await import('../src/tui/app/help.js');
    const { displayWidth } = await import('../src/tui/ui/text.js');
    const reason = '资源尚未启用，请保留已有连接。'.repeat(12);
    const nextStep = '请切回连接列表核对当前目标。';
    const custom = createResourceRegistry(defaultResources.map((resource) => resource.id === 'ctx' ? { ...resource, actions: [...resource.actions, {
      ...rename, id: 'pending', shortcut: 'x', ownerResourceId: 'ctx', enabled: false, unavailableReason: reason, nextStep,
    }] } : resource));
    const controller = createTuiController({ registry: custom, contexts, adapters: {} });
    try {
      controller.resize(24, 12); controller.handleKey({ name: '?' });
      const entries = controller.getSnapshot().help!.entries;
      const lines = helpLines(entries, 24);
      expect(lines.every((line) => displayWidth(line.text) <= 24)).toBe(true);
      expect(lines.map((line) => line.text).join('')).toContain(reason);
      expect(lines.map((line) => line.text).join('')).toContain(nextStep);
      controller.handleKey({ name: 'pagedown' });
      expect(controller.getSnapshot().help?.scrollOffset).toBe(3);
      controller.handleKey({ name: 'end' });
      expect(controller.getSnapshot().help!.scrollOffset).toBeGreaterThan(entries.length);
      controller.handleKey({ name: 'home' });
      expect(controller.getSnapshot().help?.scrollOffset).toBe(0);
    } finally { controller.dispose(); }
  });
});
