import type {
  TuiAction, TuiActionEntry, TuiActionRequest, TuiContext, TuiDetail, TuiInput, TuiKey, TuiMode,
  TuiOverlay, TuiPage, TuiResourceAdapter, TuiRoute, TuiRow, TuiSnapshot,
} from '../model.js';
import type { ResourceRegistry } from '../resources/registry.js';
import { editText } from '../ui/text.js';
import type { EditEvent } from '../ui/text.js';
import { detailLines } from './detail.js';

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
  detailCursorLine: number;
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
    cells: { kind: ({ local: '本机', ssh: 'SSH', tcp: 'TCP' } as Record<string, string>)[context.kind] ?? context.kind, name: context.label, target: context.target ?? '', description: context.description ?? '' },
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
  let detailCursorLine = 0;
  let overlay: TuiOverlay | undefined;
  let overlayAction: TuiAction | undefined;
  let overlayOwner: ListState | undefined;
  let formController: AbortController | undefined;
  let formGeneration = 0;
  let formPending = false;
  let checkingSubmit = false;
  let writeIssued = false;
  let formPinnedImpact: readonly string[] = [];
  const formKnownSecrets = new Set<string>();
  let viewGeneration = 0;
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
      if (enabled && action.selectionPolicy === 'required' && !selectedRow()) { enabled = false; reason = '请先选择一项'; }
      if (action.kind === 'copy' && !options.clipboard) { enabled = false; reason = '当前终端未提供剪贴板'; }
      if (enabled && action.mutation && (!options.adapters[action.ownerResourceId]?.checkAction || !options.adapters[action.ownerResourceId]?.mutate)) {
        enabled = false; reason = '当前资源尚未提供权限核验与操作接口';
      }
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
      scrollOffset: page.scrollOffset, filter: page.filter, input, detail, help, overlay, loading,
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
    if (previous) {
      page.completeness = 'cancelled'; page.notice = '读取已取消；当前内容可能不完整。';
      if (showNotice) publish();
    }
  }
  async function refresh(): Promise<void> {
    if (disposed) return;
    cancelRead(false);
    if (page.route.resourceId === 'ctx') { page.rows = contextRows; page.completeness = 'complete'; publish(); return; }
    const adapter = options.adapters[page.route.resourceId];
    if (!adapter) {
      page.rows = []; page.completeness = 'unavailable'; page.error = undefined;
      page.notice = options.registry.resolve(page.route.resourceId)?.unavailableReason ?? '资源尚未启用。';
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
      const rowIds = new Set<string>();
      for (const row of result.rows) {
        if (!row.id || rowIds.has(row.id)) throw new Error(`资源返回重复稳定标识或空标识: ${row.id}`);
        rowIds.add(row.id);
      }
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
    cancelWork();
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
    cancelWork();
    if (mode === 'detail') { mode = 'list'; detail = undefined; publish(); return; }
    if (page.filter) { page.filter = ''; publish(); return; }
    const previous = history.pop();
    if (previous) { cancelRead(false); page = previous; mode = 'list'; publish(); }
  }
  function openInput(kind: TuiInput['kind']) {
    cancelWork();
    savedInput = { mode: mode === 'detail' ? 'detail' : 'list', filter: page.filter, selectedId: page.selectedId, scrollOffset: page.scrollOffset, detail, detailCursorLine };
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
        detail = { ...detail, query: input.editor.text, selectedIndex: found >= 0 ? found : detail.selectedIndex };
        if (found >= 0) {
          detailCursorLine = Math.max(0, detailLines(detail.fields, Math.max(1, viewport.columns - 2)).findIndex((line) => line.fieldIndex === found));
          ensureDetailVisible();
        }
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
      if (savedInput) { page.filter = savedInput.filter; page.selectedId = savedInput.selectedId; page.scrollOffset = savedInput.scrollOffset; detail = savedInput.detail; detailCursorLine = savedInput.detailCursorLine; mode = savedInput.mode; }
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
      const lines = detailLines(detail.fields, Math.max(1, viewport.columns - 2));
      const index = id === 'first' ? 0 : id === 'last' ? lines.length - 1 : detailCursorLine + amount;
      detailCursorLine = Math.max(0, Math.min(lines.length - 1, index));
      detail = { ...detail, selectedIndex: lines[detailCursorLine]?.fieldIndex ?? 0 };
      ensureDetailVisible();
    } else {
      const rows = visibleRows();
      const current = rows.findIndex((row) => row.id === page.selectedId);
      const index = id === 'first' ? 0 : id === 'last' ? rows.length - 1 : current + amount;
      page.selectedId = rows[Math.max(0, Math.min(rows.length - 1, index))]?.id;
    }
    publish();
  }
  function ensureDetailVisible() {
    if (!detail) return;
    const lines = detailLines(detail.fields, Math.max(1, viewport.columns - 2));
    detailCursorLine = Math.max(0, Math.min(detailCursorLine, Math.max(0, lines.length - 1)));
    let scrollOffset = Math.max(0, Math.min(detail.scrollOffset, Math.max(0, lines.length - pageSize())));
    if (detailCursorLine < scrollOffset) scrollOffset = detailCursorLine;
    if (detailCursorLine >= scrollOffset + pageSize()) scrollOffset = detailCursorLine - pageSize() + 1;
    detail = { ...detail, selectedIndex: lines[detailCursorLine]?.fieldIndex ?? 0, scrollOffset };
  }
  function cancelWork() {
    viewGeneration++;
    for (const controller of work) controller.abort();
    work.clear();
  }
  function formRequest(signal: AbortSignal): TuiActionRequest {
    if (!overlay || !overlayAction || !overlayOwner || page !== overlayOwner || overlay.ownerResourceId !== page.route.resourceId) throw new Error('操作来源已变化，请从对应资源列表重新开始');
    const target = overlay.targetId === undefined ? undefined : overlayOwner.rows.find((row) => row.id === overlay!.targetId);
    if (overlayAction.selectionPolicy === 'required' && !target) throw new Error('目标已不存在，请取消后刷新列表');
    return {
      action: overlayAction, target, context: options.contexts.find((context) => context.id === overlay!.contextId),
      values: Object.fromEntries(overlay.fields.map((field) => [field.id, field.value])), signal,
    };
  }
  function cancelForm() {
    if (!overlay) return;
    const uncertain = writeIssued;
    formGeneration++;
    formController?.abort(); formController = undefined;
    formPending = false; checkingSubmit = false; writeIssued = false;
    overlay = undefined; overlayAction = undefined; overlayOwner = undefined;
    formKnownSecrets.clear();
    mode = 'list'; page.notice = uncertain ? '请求已发出，已停止等待；结果待核实。' : '已取消操作';
    publish();
  }
  function openForm(action: TuiAction) {
    if (mode !== 'list' || action.ownerResourceId !== page.route.resourceId) return;
    const adapter = options.adapters[action.ownerResourceId];
    if (!adapter?.checkAction || !adapter.mutate) { page.notice = '当前资源尚未提供权限核验与操作接口'; publish(); return; }
    cancelWork();
    const row = action.selectionPolicy === 'none' ? undefined : selectedRow();
    const context = currentContext();
    overlayAction = action; overlayOwner = page;
    formPinnedImpact = [`上下文: ${context?.label ?? '当前连接'}${context?.target ? ` (${context.target})` : ''}`, ...(row ? [`目标: ${row.cells.name ?? row.id} (${row.id})`] : [])];
    const fields = (action.fields ?? []).map((field) => {
      const editor = editText({ text: '', cursor: 0 }, { type: 'insert', text: field.initialValue ?? row?.cells[field.id] ?? '' });
      return { id: field.id, label: field.label, value: editor.text, cursor: editor.cursor, secret: field.secret };
    });
    formKnownSecrets.clear();
    for (const field of fields) if (field.secret && field.value) formKnownSecrets.add(field.value);
    overlay = {
      actionId: action.id, ownerResourceId: action.ownerResourceId, targetId: row?.id, contextId: page.route.contextId,
      title: action.label, fields, focusIndex: 0, phase: fields.length ? 'editing' : 'confirming',
      impact: [...formPinnedImpact, ...(action.impact ?? [])], confirmationDefault: 'cancel',
    };
    const generation = ++formGeneration;
    const controller = new AbortController();
    formController = controller; formPending = true; checkingSubmit = false; writeIssued = false;
    mode = 'form'; publish();
    void (async () => {
      try {
        const result = await adapter.checkAction!(formRequest(controller.signal));
        if (disposed || generation !== formGeneration || !overlay) return;
        overlay = { ...overlay, impact: [...formPinnedImpact, ...(result.impact ?? action.impact ?? [])].map(formText), error: result.enabled ? undefined : formText([result.reason ?? '当前权限不允许此操作', result.nextStep].filter(Boolean).join('；')) };
      } catch (error) {
        if (!disposed && generation === formGeneration && overlay) overlay = { ...overlay, error: formText(errorText(error)) };
      } finally {
        if (!disposed && generation === formGeneration) { formPending = false; publish(); }
      }
    })();
  }
  async function submitForm(): Promise<void> {
    if (!overlay || !overlayAction || !overlayOwner || !formController || formPending) return;
    const action = overlayAction;
    const owner = overlayOwner;
    const adapter = options.adapters[action.ownerResourceId];
    if (!adapter?.checkAction || !adapter.mutate) return;
    const missing = (action.fields ?? []).find((field) => field.required && !overlay!.fields.find((value) => value.id === field.id)?.value.trim());
    if (missing) {
      overlay = { ...overlay, error: `请填写${missing.label}`, focusIndex: overlay.fields.findIndex((field) => field.id === missing.id), phase: 'editing' }; publish(); return;
    }
    const generation = formGeneration;
    const controller = formController;
    formPending = true; checkingSubmit = true;
    overlay = { ...overlay, error: undefined }; publish();
    try {
      const permission = await adapter.checkAction(formRequest(controller.signal));
      if (disposed || generation !== formGeneration || !overlay) return;
      if (!permission.enabled) throw new Error([permission.reason ?? '当前权限不允许此操作', permission.nextStep].filter(Boolean).join('；'));
      const impact = [...formPinnedImpact, ...(permission.impact ?? action.impact ?? [])].map(formText);
      if (JSON.stringify(impact) !== JSON.stringify(overlay.impact)) {
        overlay = { ...overlay, impact, focusIndex: overlay.fields.length, phase: 'confirming', error: '影响范围已更新，请核对后再次确认。' }; return;
      }
      const request = formRequest(controller.signal);
      writeIssued = true; checkingSubmit = false;
      overlay = { ...overlay, phase: 'submitting' }; publish();
      const result = await adapter.mutate(request);
      if (disposed || generation !== formGeneration || !overlay || page !== owner) return;
      const message = formText(result.message ?? '操作已完成');
      formGeneration++; formController = undefined; formPending = false; writeIssued = false;
      overlay = undefined; overlayAction = undefined; overlayOwner = undefined; mode = 'list';
      formKnownSecrets.clear();
      if (result.selectedId && action.returnPolicy === 'select-result') owner.selectedId = result.selectedId;
      const completionView = viewGeneration;
      publish(); await refresh();
      if (!disposed && page === owner && completionView === viewGeneration) { owner.notice = message; publish(); }
    } catch (error) {
      if (!disposed && generation === formGeneration && overlay) { overlay = { ...overlay, phase: 'confirming', error: formText(errorText(error)) }; publish(); }
    } finally {
      if (!disposed && generation === formGeneration) { formPending = false; checkingSubmit = false; writeIssued = false; publish(); }
    }
  }
  function formKey(key: TuiKey) {
    if (!overlay) return;
    const pressed = shortcut(key);
    if (pressed === 'Esc' || pressed === 'Ctrl+C') { cancelForm(); return; }
    if (checkingSubmit || overlay.phase === 'submitting') return;
    const count = overlay.fields.length;
    if (pressed === 'Tab' || pressed === 'Shift+Tab') {
      const direction = pressed === 'Tab' ? 1 : -1;
      const focusIndex = (overlay.focusIndex + direction + count + 2) % (count + 2);
      overlay = { ...overlay, focusIndex, phase: focusIndex < count ? 'editing' : 'confirming' }; publish(); return;
    }
    if (pressed === 'Enter') {
      if (overlay.focusIndex < count) {
        const focusIndex = overlay.focusIndex + 1;
        overlay = { ...overlay, focusIndex, phase: focusIndex < count ? 'editing' : 'confirming' }; publish();
      } else if (overlay.focusIndex === count) cancelForm();
      else void submitForm();
      return;
    }
    if (overlay.focusIndex >= count) {
      if (['←', '→', 'Home', 'End'].includes(pressed)) { overlay = { ...overlay, focusIndex: pressed === '←' || pressed === 'Home' ? count : count + 1 }; publish(); }
      return;
    }
    const event = editEvent(key);
    if (!event) return;
    const field = overlay.fields[overlay.focusIndex];
    const editor = editText({ text: field.value, cursor: field.cursor ?? 0 }, event);
    if (field.secret && editor.text) formKnownSecrets.add(editor.text);
    const fields = overlay.fields.map((value, index) => index === overlay!.focusIndex ? { ...value, value: editor.text, cursor: editor.cursor } : value);
    overlay = { ...overlay, fields, phase: 'editing', error: undefined }; publish();
  }
  function formText(message: string): string {
    let safe = message;
    for (const value of [...formKnownSecrets].sort((left, right) => right.length - left.length)) safe = safe.replaceAll(value, '[已隐藏]');
    return safe;
  }
  async function copy() {
    if (!options.clipboard) return;
    const value = mode === 'detail' ? detail?.fields[detail.selectedIndex]?.value : selectedRow()?.copyValue ?? selectedRow()?.id;
    if (value === undefined) return;
    const controller = new AbortController();
    const owner = page;
    const generation = viewGeneration;
    work.add(controller);
    try { await options.clipboard(value, controller.signal); if (!disposed && !controller.signal.aborted && page === owner && generation === viewGeneration) { page.notice = '已复制完整值'; publish(); } }
    catch (error) { if (!disposed && !controller.signal.aborted && page === owner && generation === viewGeneration) { page.notice = `复制失败: ${errorText(error)}`; publish(); } }
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
    if (action.kind === 'form') { openForm(action); return; }
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
        cancelWork();
        detail = { title: row.cells.name ?? row.id, fields: row.detail ?? Object.entries(row.cells).map(([label, value]) => ({ label, value })), selectedIndex: 0, scrollOffset: 0, query: '' };
        detailCursorLine = 0;
        mode = 'detail'; publish();
      }
    }
  }
  function handleKey(key: TuiKey) {
    if (disposed) return;
    if (mode === 'input') { inputKey(key); return; }
    if (mode === 'form') { formKey(key); return; }
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
      viewport = { columns: Math.max(1, Math.floor(columns)), rows: Math.max(1, Math.floor(rows)) }; ensureDetailVisible(); publish();
    },
    refresh,
    dispose: () => { if (disposed) return; cancelRead(false); cancelWork(); formController?.abort(); formGeneration++; disposed = true; listeners.clear(); },
  };
}

export type TuiController = ReturnType<typeof createTuiController>;
