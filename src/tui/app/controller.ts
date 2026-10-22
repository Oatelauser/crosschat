import type {
  TuiAction, TuiActionEntry, TuiContext, TuiDetail, TuiInput, TuiKey, TuiMode,
  TuiPage, TuiResourceAdapter, TuiRoute, TuiRow, TuiSnapshot,
} from '../model.js';
import type { ResourceRegistry } from '../resources/registry.js';
import { editText } from '../ui/text.js';
import type { EditEvent } from '../ui/text.js';

export interface TuiControllerOptions {
  registry: ResourceRegistry;
  contexts: readonly TuiContext[];
  adapters: Readonly<Record<string, TuiResourceAdapter>>;
  initialSelectedContextId?: string;
  clipboard?: (text: string, signal: AbortSignal) => Promise<void>;
  onExit?: () => void;
  now?: () => number;
}

interface ListState {
  route: TuiRoute;
  rows: readonly TuiRow[];
  selectedId?: string;
  scrollOffset: number;
  filter: string;
  completeness: TuiPage['completeness'];
  notice?: string;
  error?: string;
  sortColumn?: string;
}

interface SavedInput {
  mode: 'list' | 'detail';
  filter: string;
  selectedId?: string;
  scrollOffset: number;
  detail?: TuiDetail;
}

function shortcut(key: TuiKey): string {
  const names: Readonly<Record<string, string>> = {
    escape: 'Esc', esc: 'Esc', enter: 'Enter', return: 'Enter', up: '↑', down: '↓', left: '←', right: '→',
    pageup: 'PgUp', pagedown: 'PgDn', home: 'Home', end: 'End', tab: 'Tab', space: 'Space', backspace: 'Backspace', delete: 'Delete',
  };
  const name = names[key.name.toLocaleLowerCase()] ?? (key.text?.length === 1 ? key.text : key.name);
  if (key.ctrl) return `Ctrl+${name.toLocaleUpperCase()}`;
  if (key.shift && name === 'Tab') return 'Shift+Tab';
  return name;
}

function editEvent(key: TuiKey): EditEvent | undefined {
  const type = ({ '←': 'left', '→': 'right', Home: 'home', End: 'end', Backspace: 'backspace', Delete: 'delete' } as const)[shortcut(key) as '←' | '→' | 'Home' | 'End' | 'Backspace' | 'Delete'];
  if (type) return { type };
  if (!key.ctrl && !key.alt && (key.text || key.name.length === 1)) return { type: 'insert', text: key.text ?? key.name };
  return undefined;
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function routeKey(route: TuiRoute): string { return JSON.stringify([route.resourceId, route.contextId]); }

export function createTuiController(options: TuiControllerOptions) {
  const listeners = new Set<() => void>();
  const contextRows: readonly TuiRow[] = options.contexts.map((context) => ({
    id: context.id, contextId: context.id,
    cells: { kind: context.kind, name: context.label, target: context.target ?? '', description: context.description ?? '' },
    detail: [
      { label: '类型', value: context.kind }, { label: '名称', value: context.label }, { label: '目标', value: context.target ?? '' },
      { label: '身份提示', value: context.identityHint ?? '尚未核实' },
    ],
    copyValue: context.target ?? context.id,
  }));
  let page: ListState = {
    route: { resourceId: 'ctx' }, rows: contextRows,
    selectedId: contextRows.some((row) => row.id === options.initialSelectedContextId) ? options.initialSelectedContextId : contextRows[0]?.id,
    scrollOffset: 0, filter: '', completeness: 'complete',
  };
  const pages = new Map<string, ListState>([[routeKey(page.route), page]]);
  const history: ListState[] = [];
  const work = new Set<AbortController>();
  let mode: TuiMode = 'list';
  let input: TuiInput | undefined;
  let savedInput: SavedInput | undefined;
  let detail: TuiDetail | undefined;
  let help: TuiSnapshot['help'];
  let helpReturnMode: 'list' | 'detail' = 'list';
  let viewport = { columns: 80, rows: 24 };
  let loading = false;
  let disposed = false;
  let readGeneration = 0;
  let activeRead: AbortController | undefined;
  let snapshot: TuiSnapshot;

  function currentContext() { return options.contexts.find((context) => context.id === page.route.contextId); }
  function pageSize() { return Math.max(1, viewport.rows - 9); }
  function visibleRows(): readonly TuiRow[] {
    const query = page.filter.toLocaleLowerCase();
    const rows = page.rows.filter((row) => [row.id, row.searchText ?? '', ...Object.values(row.cells), ...(row.detail?.flatMap((field) => [field.label, field.value]) ?? [])].some((value) => value.toLocaleLowerCase().includes(query)));
    return page.sortColumn ? rows.toSorted((left, right) => (left.cells[page.sortColumn!] ?? '').localeCompare(right.cells[page.sortColumn!] ?? '')) : rows;
  }
  function selectedRow() { return page.rows.find((row) => row.id === page.selectedId); }
  function actionEntries(targetMode: TuiMode): TuiActionEntry[] {
    return options.registry.actions(page.route.resourceId, targetMode).map((action) => {
      let reason = action.unavailableReason;
      let enabled = action.enabled !== false;
      if (action.selectionPolicy === 'required' && !selectedRow()) { enabled = false; reason = '请先选择一项'; }
      if (action.kind === 'copy' && !options.clipboard) { enabled = false; reason = '当前终端未提供剪贴板'; }
      return { id: action.id, shortcut: action.shortcut, label: action.label, enabled, reason, nextStep: action.nextStep, impact: action.impact };
    });
  }
  function publish() {
    if (disposed) return;
    const rows = visibleRows();
    let selectedIndex = rows.findIndex((row) => row.id === page.selectedId);
    if (selectedIndex < 0) { selectedIndex = rows.length ? 0 : -1; page.selectedId = rows[0]?.id; }
    page.scrollOffset = Math.max(0, Math.min(page.scrollOffset, Math.max(0, rows.length - pageSize())));
    if (selectedIndex >= 0 && selectedIndex < page.scrollOffset) page.scrollOffset = selectedIndex;
    if (selectedIndex >= page.scrollOffset + pageSize()) page.scrollOffset = selectedIndex - pageSize() + 1;
    snapshot = {
      route: { ...page.route }, context: currentContext(), mode, rows, selectedId: page.selectedId, selectedIndex,
      scrollOffset: page.scrollOffset, filter: page.filter, input, detail, help, loading,
      error: page.error, notice: page.notice, completeness: page.completeness, actions: actionEntries(mode), viewport: { ...viewport },
    };
    for (const listener of listeners) listener();
  }
  function cancelRead(showNotice: boolean) {
    const previous = activeRead;
    activeRead = undefined;
    readGeneration++;
    previous?.abort();
    loading = false;
    if (previous && showNotice) { page.completeness = 'cancelled'; page.notice = '读取已取消；当前内容可能不完整。'; publish(); }
  }
  async function refresh(): Promise<void> {
    if (disposed) return;
    cancelRead(false);
    if (page.route.resourceId === 'ctx') { page.rows = contextRows; page.completeness = 'complete'; publish(); return; }
    const adapter = options.adapters[page.route.resourceId];
    if (!adapter) {
      page.rows = []; page.completeness = 'unavailable'; page.error = undefined;
      page.notice = options.registry.resolve(page.route.resourceId)?.unavailableReason ?? '此资源尚未接入。';
      publish(); return;
    }
    const requestPage = page;
    const generation = readGeneration;
    const controller = new AbortController();
    activeRead = controller;
    loading = true; page.error = undefined; publish();
    let removeAbort: (() => void) | undefined;
    try {
      const pending = adapter.read({ context: currentContext(), signal: controller.signal });
      const cancelled = new Promise<undefined>((resolve) => {
        const onAbort = () => resolve(undefined);
        controller.signal.addEventListener('abort', onAbort, { once: true });
        removeAbort = () => controller.signal.removeEventListener('abort', onAbort);
        if (controller.signal.aborted) resolve(undefined);
      });
      const result = await Promise.race([pending, cancelled]);
      if (!result || disposed || generation !== readGeneration || requestPage !== page) return;
      page.rows = [...result.rows]; page.completeness = result.completeness; page.notice = result.notice; page.error = undefined;
    } catch (error) {
      if (!disposed && generation === readGeneration && requestPage === page && !controller.signal.aborted) {
        page.error = errorText(error); page.completeness = page.rows.length ? 'partial' : 'unavailable';
      }
    } finally {
      removeAbort?.();
      if (!disposed && generation === readGeneration && requestPage === page) { activeRead = undefined; loading = false; publish(); }
    }
  }
  function navigate(route: TuiRoute) {
    if (!options.registry.resolve(route.resourceId)) { page.notice = `未知资源: ${route.resourceId}`; publish(); return; }
    cancelRead(false);
    if (routeKey(route) !== routeKey(page.route)) {
      history.push(page);
      const cached = pages.get(routeKey(route));
      page = cached ?? { route: { ...route }, rows: [], filter: '', scrollOffset: 0, completeness: 'unavailable' };
      pages.set(routeKey(route), page);
    }
    mode = 'list'; input = undefined; savedInput = undefined; detail = undefined; help = undefined;
    publish(); void refresh();
  }
  function back() {
    if (mode === 'detail') { mode = 'list'; detail = undefined; publish(); return; }
    if (page.filter) { page.filter = ''; publish(); return; }
    const previous = history.pop();
    if (previous) { cancelRead(false); page = previous; mode = 'list'; publish(); }
  }
  function openInput(kind: TuiInput['kind']) {
    savedInput = { mode: mode === 'detail' ? 'detail' : 'list', filter: page.filter, selectedId: page.selectedId, scrollOffset: page.scrollOffset, detail };
    input = { kind, editor: { text: '', cursor: 0 }, candidates: kind === 'command' ? options.registry.candidates('').map((resource) => ({ id: resource.id, label: resource.label, enabled: true, reason: resource.unavailableReason })) : [], hint: 'Enter 保留筛选' };
    mode = 'input';
    if (kind !== 'detail-search') page.filter = '';
    publish();
  }
  function updateInput() {
    if (!input) return;
    if (input.kind === 'detail-search') {
      if (detail) {
        const query = input.editor.text.toLocaleLowerCase();
        const found = detail.fields.findIndex((field) => `${field.label}\n${field.value}`.toLocaleLowerCase().includes(query));
        detail = { ...detail, query: input.editor.text, selectedIndex: found >= 0 ? found : detail.selectedIndex, scrollOffset: found >= 0 ? found : detail.scrollOffset };
      }
      input = { ...input, hint: 'Enter 保留详情查找' };
    } else {
      page.filter = input.editor.text;
      const target = input.candidateIndex === undefined ? options.registry.resolve(input.editor.text) : options.registry.resolve(input.candidates[input.candidateIndex]?.id ?? '');
      input = { ...input, hint: input.kind === 'command' && target ? `Enter 切换到 ${target.label} (:${target.id})` : 'Enter 保留筛选' };
    }
    publish();
  }
  function inputKey(key: TuiKey) {
    if (!input) return;
    const pressed = shortcut(key);
    if (pressed === 'Esc' || pressed === 'Ctrl+C') {
      if (savedInput) { page.filter = savedInput.filter; page.selectedId = savedInput.selectedId; page.scrollOffset = savedInput.scrollOffset; detail = savedInput.detail; mode = savedInput.mode; }
      input = undefined; savedInput = undefined; publish(); return;
    }
    if (pressed === 'Enter') {
      const target = input.kind === 'command' ? (input.candidateIndex === undefined ? options.registry.resolve(input.editor.text) : options.registry.resolve(input.candidates[input.candidateIndex]?.id ?? '')) : undefined;
      if (target) {
        if (savedInput) { page.filter = savedInput.filter; page.selectedId = savedInput.selectedId; page.scrollOffset = savedInput.scrollOffset; }
        navigate({ resourceId: target.id, ...(target.id === 'ctx' ? {} : { contextId: page.route.contextId }) });
      } else { mode = savedInput?.mode ?? 'list'; input = undefined; savedInput = undefined; publish(); }
      return;
    }
    if (input.kind === 'command' && ['Tab', 'Shift+Tab', '↑', '↓'].includes(pressed)) {
      const count = input.candidates.length;
      if (!count) return;
      const direction = pressed === 'Shift+Tab' || pressed === '↑' ? -1 : 1;
      const index = input.candidateIndex === undefined ? (direction > 0 ? 0 : count - 1) : (input.candidateIndex + direction + count) % count;
      input = { ...input, candidateIndex: index };
      if (pressed === 'Tab' || pressed === 'Shift+Tab') input = { ...input, editor: editText({ text: '', cursor: 0 }, { type: 'insert', text: input.candidates[index].id }) };
      updateInput(); return;
    }
    const event = editEvent(key);
    if (!event) return;
    const editor = editText(input.editor, event);
    input = { ...input, editor, candidateIndex: undefined, candidates: input.kind === 'command' ? options.registry.candidates(editor.text).map((resource) => ({ id: resource.id, label: resource.label, enabled: true, reason: resource.unavailableReason })) : [] };
    updateInput();
  }
  function move(id: string) {
    const amount = id === 'page-up' ? -pageSize() : id === 'page-down' ? pageSize() : id === 'previous' ? -1 : 1;
    if (mode === 'help' && help) {
      help = { ...help, scrollOffset: Math.max(0, Math.min(help.entries.length - 1, help.scrollOffset + amount)) };
    } else if (mode === 'detail' && detail) {
      const index = id === 'first' ? 0 : id === 'last' ? detail.fields.length - 1 : detail.selectedIndex + amount;
      const selectedIndex = Math.max(0, Math.min(detail.fields.length - 1, index));
      detail = { ...detail, selectedIndex, scrollOffset: selectedIndex };
    } else {
      const rows = visibleRows();
      const current = rows.findIndex((row) => row.id === page.selectedId);
      const index = id === 'first' ? 0 : id === 'last' ? rows.length - 1 : current + amount;
      page.selectedId = rows[Math.max(0, Math.min(rows.length - 1, index))]?.id;
    }
    publish();
  }
  async function copy() {
    if (!options.clipboard) return;
    const value = mode === 'detail' ? detail?.fields[detail.selectedIndex]?.value : selectedRow()?.copyValue ?? selectedRow()?.id;
    if (value === undefined) return;
    const controller = new AbortController();
    work.add(controller);
    try { await options.clipboard(value, controller.signal); if (!disposed && !controller.signal.aborted) { page.notice = '已复制完整值'; publish(); } }
    catch (error) { if (!disposed && !controller.signal.aborted) { page.notice = `复制失败: ${errorText(error)}`; publish(); } }
    finally { work.delete(controller); }
  }
  function execute(action: TuiAction) {
    const availability = actionEntries(mode).find((entry) => entry.id === action.id);
    if (!availability?.enabled) { page.notice = [availability?.reason, availability?.nextStep].filter(Boolean).join('；'); publish(); return; }
    if (['previous', 'next', 'page-up', 'page-down', 'first', 'last'].includes(action.id)) { move(action.id); return; }
    if (action.id === 'command') { openInput('command'); return; }
    if (action.id === 'filter') { openInput(mode === 'detail' ? 'detail-search' : 'filter'); return; }
    if (action.id === 'back') { back(); return; }
    if (action.id === 'refresh') { void refresh(); return; }
    if (action.id === 'help') {
      helpReturnMode = mode === 'detail' ? 'detail' : 'list';
      help = { title: options.registry.resolve(page.route.resourceId)?.label ?? page.route.resourceId, entries: actionEntries(mode), scrollOffset: 0 };
      mode = 'help'; publish(); return;
    }
    if (action.id === 'quit') { options.onExit?.(); return; }
    if (action.id === 'interrupt') { if (activeRead) cancelRead(true); else options.onExit?.(); return; }
    if (action.id === 'sort') {
      const columns = options.registry.resolve(page.route.resourceId)?.columns ?? [];
      const index = columns.findIndex((column) => column.id === page.sortColumn);
      page.sortColumn = columns[(index + 1) % columns.length]?.id;
      page.notice = page.sortColumn ? `按${columns.find((column) => column.id === page.sortColumn)?.label}排序` : '此资源没有可排序字段'; publish(); return;
    }
    if (action.kind === 'copy') { void copy(); return; }
    if (action.kind === 'navigate') {
      const row = selectedRow();
      if (action.id === 'enter-context' && row) {
        const context = options.contexts.find((item) => item.id === row.contextId);
        if (context) navigate({ resourceId: context.defaultResourceId ?? (context.kind === 'tcp' ? 'machines' : 'sessions'), contextId: context.id });
      } else if (row?.navigate) navigate(row.navigate);
      else if (action.navigateTo) navigate({ resourceId: action.navigateTo, contextId: page.route.contextId });
      return;
    }
    if (action.kind === 'detail') {
      const row = selectedRow();
      if (row) {
        detail = { title: row.cells.name ?? row.id, fields: row.detail ?? Object.entries(row.cells).map(([label, value]) => ({ label, value })), selectedIndex: 0, scrollOffset: 0, query: '' };
        mode = 'detail'; publish();
      }
    }
  }
  function handleKey(key: TuiKey) {
    if (disposed) return;
    if (mode === 'input') { inputKey(key); return; }
    if (key.name === 'paste') return;
    if (mode === 'help') {
      const pressed = shortcut(key);
      if (pressed === 'Esc' || pressed === '?') { mode = helpReturnMode; help = undefined; publish(); return; }
      const action = options.registry.actions(page.route.resourceId, 'help').find((entry) => entry.shortcut.split(' / ').includes(pressed));
      if (action && ['previous', 'next', 'page-up', 'page-down'].includes(action.id)) move(action.id);
      return;
    }
    const pressed = shortcut(key);
    const action = options.registry.actions(page.route.resourceId, mode).find((entry) => entry.shortcut.split(' / ').includes(pressed));
    if (action) execute(action);
  }
  publish();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { if (!disposed) listeners.add(listener); return () => { listeners.delete(listener); }; },
    handleKey,
    resize: (columns: number, rows: number) => {
      viewport = { columns: Math.max(1, Math.floor(columns)), rows: Math.max(1, Math.floor(rows)) }; publish();
    },
    refresh,
    dispose: () => { if (disposed) return; cancelRead(false); disposed = true; for (const controller of work) controller.abort(); work.clear(); listeners.clear(); },
  };
}

export type TuiController = ReturnType<typeof createTuiController>;
