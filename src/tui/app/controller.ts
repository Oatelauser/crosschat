import type {
  TuiAction, TuiActionEntry, TuiActionRequest, TuiContext, TuiDetail, TuiFormField, TuiInput, TuiKey, TuiMode,
  TuiOverlay, TuiPage, TuiResourceAdapter, TuiRoute, TuiRow, TuiSnapshot, TuiWorkspaceId, TuiPromptRequest,
} from '../model.js';
import { createResourceRegistry } from '../resources/registry.js';
import type { ResourceRegistry } from '../resources/registry.js';
import { editText } from '../ui/text.js';
import type { EditEvent } from '../ui/text.js';
import { detailLines } from './detail.js';
import { helpLines } from './help.js';
import { formContentLines } from './form.js';
import { enterContextRoute, localWorkspaceRows, resourceWorkspaces, workspaceFor } from './workspaces.js';
import { screenLayout } from './layout.js';

export interface TuiControllerOptions {
  registry: ResourceRegistry;
  contexts: readonly TuiContext[];
  contextSource?: { initial: TuiContextPage; read(signal: AbortSignal): Promise<TuiContextPage> };
  adapters: Readonly<Record<string, TuiResourceAdapter>>;
  initialSelectedContextId?: string;
  onContextSelection?: (id: string) => void;
  clipboard?: (text: string, signal: AbortSignal) => Promise<void>;
  onExit?: () => void;
  onSensitiveClear?: () => void;
  onActiveContext?: (id: string | null) => void;
}

export interface TuiContextPage {
  contexts: readonly TuiContext[];
  completeness: TuiPage['completeness'];
  notice?: string;
}

interface ListState {
  workspaceId?: TuiWorkspaceId;
  route: TuiRoute;
  rows: readonly TuiRow[];
  selectedId?: string;
  scrollOffset: number;
  filter: string;
  completeness: TuiPage['completeness'];
  notice?: string;
  error?: string;
  sortColumn?: string;
  sampledAt?: number;
  filters?: TuiPage['filters'];
  selectedFacets?: Map<string, string>;
  actionAvailability?: TuiPage['actionAvailability'];
  detailViews?: TuiPage['detailViews'];
  routeChoices?: TuiPage['routeChoices'];
  canFollow?: boolean;
  autoRefresh?: boolean;
  following?: boolean;
  registry?: ResourceRegistry;
  actionRoutes?: TuiPage['actionRoutes'];
  contextSummary?: TuiPage['contextSummary'];
}

interface SavedInput {
  mode: 'list' | 'detail';
  filter: string;
  selectedId?: string;
  scrollOffset: number;
  detail?: TuiDetail;
  detailCursorLine: number;
  contextId?: string;
}

function shortcut(key: TuiKey): string {
  const names: Readonly<Record<string, string>> = {
    escape: 'Esc', esc: 'Esc', enter: 'Enter', return: 'Enter', up: '↑', down: '↓', left: '←', right: '→',
    pageup: 'PgUp', pagedown: 'PgDn', home: 'Home', end: 'End', tab: 'Tab', space: 'Space', ' ': 'Space', backspace: 'Backspace', delete: 'Delete',
  };
  const name = names[key.name.toLocaleLowerCase()] ?? (key.text?.length === 1 ? key.text : key.name);
  if (key.ctrl) return `Ctrl+${name.toLocaleUpperCase()}`;
  if (key.shift && name === 'Tab') return 'Shift+Tab';
  return name;
}

function editEvent(key: TuiKey): EditEvent | undefined {
  const edits: Readonly<Record<string, 'left' | 'right' | 'home' | 'end' | 'backspace' | 'delete'>> = { '←': 'left', '→': 'right', Home: 'home', End: 'end', Backspace: 'backspace', Delete: 'delete' };
  const type = edits[shortcut(key)];
  if (type) return { type };
  if (!key.ctrl && !key.alt && (key.text || key.name.length === 1)) return { type: 'insert', text: key.text ?? key.name };
  return undefined;
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function routeKey(route: TuiRoute): string { return JSON.stringify([route.resourceId, route.contextId, Object.entries(route.query ?? {}).sort(([left], [right]) => left.localeCompare(right))]); }
function copyRoute(route: TuiRoute): TuiRoute {
  return { resourceId: route.resourceId, ...(route.contextId === undefined ? {} : { contextId: route.contextId }), ...(Object.keys(route.query ?? {}).length ? { query: { ...route.query } } : {}) };
}
function own<T>(values: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return values && Object.hasOwn(values, key) ? values[key] : undefined;
}

export function createTuiController(options: TuiControllerOptions) {
  const listeners = new Set<() => void>();
  const contextLabels = new Map<string, string>([['local', '本机'], ['ssh', 'SSH'], ['tcp', 'TCP']]);
  const initialContexts = options.contextSource?.initial ?? { contexts: options.contexts, completeness: 'complete' as const };
  let contexts = [...initialContexts.contexts];
  function contextRows(values: readonly TuiContext[], notice?: string): readonly TuiRow[] { return values.map((context) => ({
    id: context.id, contextId: context.id,
    cells: { kind: contextLabels.get(context.kind) ?? context.kind, name: context.label, target: context.target ?? '', description: context.description ?? '' },
    detail: [
      { label: '类型', value: context.kind }, { label: '名称', value: context.label }, { label: '目标', value: context.target ?? '' },
      { label: '身份提示', value: context.identityHint ?? '尚未核实' },
      ...(notice ? [{ label: '读取提示', value: notice }] : []),
    ],
    copyValue: context.target ?? context.id,
    actionRoutes: context.actionRoutes, actionAvailability: context.actionAvailability, detailViews: context.detailViews,
  })); }
  let page: ListState = {
    route: { resourceId: 'ctx' }, rows: contextRows(contexts, initialContexts.notice),
    selectedId: contexts.some((context) => context.id === options.initialSelectedContextId) ? options.initialSelectedContextId : contexts[0]?.id,
    scrollOffset: 0, filter: '', completeness: initialContexts.completeness, notice: initialContexts.notice,
  };
  const pages = new Map<string, ListState>([[JSON.stringify([undefined, routeKey(page.route)]), page]]);
  const history: ListState[] = [];
  const work = new Set<AbortController>();
  let mode: TuiMode = 'list';
  let input: TuiInput | undefined;
  let savedInput: SavedInput | undefined;
  let detail: TuiDetail | undefined;
  let detailCursorLine = 0;
  let detailReturnMode: 'list' | 'choice' = 'list';
  let choice: TuiSnapshot['choice'];
  let choiceRoutes = new Map<string, TuiRoute>();
  let overlay: TuiOverlay | undefined;
  let overlayAction: TuiAction | undefined;
  let overlayOwner: ListState | undefined;
  let formController: AbortController | undefined;
  let formGeneration = 0;
  let formPending = false;
  let checkingSubmit = false;
  let formManualScroll = false;
  let writeIssued = false;
  let formPinnedImpact: readonly string[] = [];
  const formKnownSecrets = new Set<string>();
  let viewGeneration = 0;
  let help: TuiSnapshot['help'];
  let helpReturnMode: 'list' | 'detail' | 'choice' = 'list';
  let viewport = { columns: 80, rows: 24 };
  let loading = false;
  let disposed = false;
  let readGeneration = 0;
  let activeRead: AbortController | undefined;
  let activeWatch: AbortController | undefined;
  let watchOwner: ListState | undefined;
  let watchGeneration = 0;
  let snapshot: TuiSnapshot;
  let result: TuiSnapshot['result'];
  let resultSelection: string | undefined;
  let lastTcpRoute: TuiRoute | undefined;
  let notifiedContext: string | null = null;
  let promptState: TuiSnapshot['prompt'];
  let promptEditor = { text: '', cursor: 0 };
  let promptFinish: ((value: string | boolean | null) => void) | undefined;

  function commandCandidates(value: string) {
    return options.registry.candidates(value).filter((resource) =>
      ['ctx', 'local', 'ssh', 'tcp'].includes(resource.id) || !page.workspaceId || resourceWorkspaces(resource).includes(page.workspaceId));
  }

  function currentContext() { return contexts.find((context) => context.id === page.route.contextId); }
  function authorization(): TuiSnapshot['authorization'] {
    if (!currentContext()) return undefined;
    const permission = page.contextSummary?.permissionVerified === false ? undefined : page.contextSummary?.permissionLabel;
    const verified = permission && !page.error && !['unavailable', 'cancelled'].includes(page.completeness);
    return { state: loading ? 'checking' : verified ? 'verified' : permission ? 'stale' : 'unavailable', checkedAt: page.sampledAt };
  }
  function pageRegistry() { return page.registry ?? options.registry; }
  function pageResource() { return pageRegistry().resolve(page.route.resourceId); }
  function actionsFor(targetMode: TuiMode) { return pageRegistry().actions(page.route.resourceId, targetMode); }
  function geometry() { return screenLayout(viewport, mode, page.filters, Object.fromEntries(page.selectedFacets ?? [])); }
  function pageSize() { return geometry().pageRows; }
  function visibleRows(): readonly TuiRow[] {
    const query = page.filter.toLocaleLowerCase();
    const rows = page.rows.filter((row) => (page.filters ?? []).every((filter) => {
      const selected = page.selectedFacets?.get(filter.id) ?? filter.defaultValue;
      return selected === filter.defaultValue || own(row.facets, filter.id) === selected;
    }) && [row.id, row.searchText ?? '', ...Object.values(row.cells), ...(row.detail?.flatMap((field) => [field.label, field.value]) ?? [])].some((value) => value.toLocaleLowerCase().includes(query)));
    return page.sortColumn ? rows.toSorted((left, right) => (left.cells[page.sortColumn!] ?? '').localeCompare(right.cells[page.sortColumn!] ?? '')) : rows;
  }
  function selectedRow() { return page.rows.find((row) => row.id === page.selectedId); }
  function actionRoute(action: TuiAction, row = selectedRow()): TuiRoute | undefined {
    const linked = own(row?.actionRoutes, action.id);
    if (linked) return linked;
    const pageLink = own(page.actionRoutes, action.id);
    if (pageLink) return pageLink;
    if (row?.actionRoutes === undefined && row?.navigate) return row.navigate;
    if (action.navigateTo) return { resourceId: action.navigateTo, contextId: page.route.contextId };
    return undefined;
  }
  function actionEntries(targetMode: TuiMode): TuiActionEntry[] {
    if (targetMode === 'prompt') return [
      { id: 'prompt-confirm', shortcut: 'Enter', label: promptState?.kind === 'confirm' ? '应用所选按钮' : '确认输入', enabled: true },
      { id: 'prompt-cancel', shortcut: 'Esc / Ctrl+C', label: '取消认证', enabled: true },
    ];
    if (targetMode === 'result' && result) return [...actionsFor('result').map((entry) => ({ ...entry, enabled: true })),
      ...result.copies.map((entry) => ({ id: `result-copy-${entry.id}`, label: entry.label, shortcut: entry.shortcut, enabled: options.clipboard !== undefined, reason: options.clipboard ? undefined : '当前终端未提供剪贴板' }))];
    return actionsFor(targetMode).map((action) => {
      const row = selectedRow();
      const availability = {
        enabled: action.enabled !== false, reason: action.unavailableReason, nextStep: action.nextStep, impact: action.impact, fields: action.fields,
        ...(targetMode === 'list' ? own(page.actionAvailability, action.id) : undefined),
        ...(targetMode === 'list' ? own(row?.actionAvailability, action.id) : undefined),
      };
      let { reason, enabled } = availability;
      const hasSelection = targetMode === 'detail' ? detail?.fields[detail.selectedIndex] !== undefined : row !== undefined;
      if (enabled && action.selectionPolicy === 'required' && !hasSelection) { enabled = false; reason = '请先选择一项'; }
      if (action.kind === 'copy' && !options.clipboard) { enabled = false; reason = '当前终端未提供剪贴板'; }
      if (enabled && action.kind === 'copy' && targetMode === 'list' && (action.copyKey ? own(row?.copyValues, action.copyKey) : row?.copyValue) === undefined) {
        enabled = false; reason = '当前项目没有可复制的完整值';
      }
      if (enabled && action.kind === 'detail' && action.viewId && !own(row?.detailViews, action.viewId) && !own(page.detailViews, action.viewId)) {
        enabled = false; reason = '当前项目未提供此只读信息';
      }
      if (enabled && action.kind === 'filter' && !page.filters?.some((filter) => filter.id === action.filterId)) { enabled = false; reason = '当前资源未提供此筛选'; }
      if (enabled && action.kind === 'route-choice' && !own(page.routeChoices, action.id)?.options.length) { enabled = false; reason = '当前资源没有可选择的来源'; }
      if (enabled && action.kind === 'follow' && (!page.canFollow || !options.adapters[page.route.resourceId]?.watch)) { enabled = false; reason = '当前来源不支持跟随'; }
      if (enabled && action.kind === 'navigate' && action.id !== 'enter-context' && !actionRoute(action, row)) { enabled = false; reason = '当前项目没有可用的关联目标'; }
      if (enabled && action.mutation && (!options.adapters[action.ownerResourceId]?.checkAction || !options.adapters[action.ownerResourceId]?.mutate)) {
        enabled = false; reason = '当前资源尚未提供权限核验与操作接口';
      }
      if (enabled && action.mutation && loading) { enabled = false; reason = '正在重新核验当前连接与权限'; }
      if (enabled && action.mutation && authorization()?.state === 'stale') { enabled = false; reason = '当前仅有上次权限结果，请刷新并重新核验后操作'; }
      return { id: action.id, shortcut: action.shortcut, label: choice?.actionId && action.id === 'choice-apply' ? '打开来源' : action.label, ...availability, enabled, reason };
    });
  }
  function publish() {
    if (disposed) return;
    syncWatch();
    const rows = visibleRows();
    if (mode === 'list' && page.canFollow && page.following) page.selectedId = rows.at(-1)?.id;
    let selectedIndex = rows.findIndex((row) => row.id === page.selectedId);
    if (selectedIndex < 0) { selectedIndex = rows.length ? 0 : -1; page.selectedId = rows[0]?.id; }
    page.scrollOffset = Math.max(0, Math.min(page.scrollOffset, Math.max(0, rows.length - pageSize())));
    if (selectedIndex >= 0 && selectedIndex < page.scrollOffset) page.scrollOffset = selectedIndex;
    if (selectedIndex >= page.scrollOffset + pageSize()) page.scrollOffset = selectedIndex - pageSize() + 1;
    snapshot = {
      workspaceId: page.workspaceId, authorization: authorization(), prompt: promptState,
      route: copyRoute(page.route), context: currentContext() ? { ...currentContext()!, ...page.contextSummary } : undefined, mode, rows, selectedId: page.selectedId, selectedIndex,
      scrollOffset: page.scrollOffset, filter: page.filter, input, detail, help, overlay, choice, loading,
      filters: page.filters, selectedFacets: Object.fromEntries(page.selectedFacets ?? []), sampledAt: page.sampledAt, totalRows: page.rows.length,
      following: page.canFollow && options.adapters[page.route.resourceId]?.watch ? page.following ?? true : undefined,
      autoRefreshing: page.autoRefresh !== undefined && options.adapters[page.route.resourceId]?.watch ? page.autoRefresh : undefined,
      error: page.error, notice: page.notice, completeness: page.completeness, actions: actionEntries(mode), viewport: { ...viewport },
      resource: pageResource(), result,
    };
    for (const listener of listeners) listener();
  }
  function applyPage(next: TuiPage) {
    const base = options.registry.resolve(page.route.resourceId);
    const registry = next.presentation && base ? createResourceRegistry([{ ...base, columns: next.presentation.columns ?? base.columns, actions: next.presentation.actions ?? base.actions }]) : undefined;
    const rowIds = new Set<string>();
    for (const row of next.rows) {
      if (!row.id || rowIds.has(row.id)) throw new Error(`资源返回重复稳定标识或空标识: ${row.id}`);
      rowIds.add(row.id);
    }
    page.rows = [...next.rows]; page.completeness = next.completeness; page.notice = next.notice; page.error = undefined;
    page.sampledAt = next.sampledAt; page.filters = next.filters;
    page.actionAvailability = next.actionAvailability; page.detailViews = next.detailViews;
    page.routeChoices = next.routeChoices; page.canFollow = next.canFollow;
    page.autoRefresh = next.autoRefresh;
    page.registry = registry; page.actionRoutes = next.actionRoutes; page.contextSummary = next.contextSummary;
    if (next.canFollow) page.following ??= true;
    page.selectedFacets ??= new Map();
    for (const filter of page.filters ?? []) if (!page.selectedFacets.has(filter.id)) page.selectedFacets.set(filter.id, filter.defaultValue);
  }
  function stopWatch() {
    const previous = activeWatch;
    activeWatch = undefined; watchOwner = undefined; watchGeneration++;
    previous?.abort();
  }
  function syncWatch() {
    const adapter = options.adapters[page.route.resourceId];
    const enabled = mode === 'list' && !loading && !activeRead && (page.autoRefresh || page.canFollow && page.following) && adapter?.watch && (page.route.contextId === undefined || currentContext());
    if (!enabled) { if (activeWatch) stopWatch(); return; }
    if (activeWatch && watchOwner === page) return;
    stopWatch();
    const owner = page;
    const controller = new AbortController();
    const generation = watchGeneration;
    activeWatch = controller; watchOwner = owner;
    const current = () => !disposed && activeWatch === controller && generation === watchGeneration && owner === page && !controller.signal.aborted;
    const finished = (error?: unknown) => {
      if (!current()) return;
      stopWatch(); page.following = false;
      if (error !== undefined) page.error = errorText(error);
      else page.notice = '观察已结束，可恢复跟随后重新读取。';
      publish();
    };
    try {
      const pending = adapter!.watch!({ context: currentContext(), route: copyRoute(page.route), signal: controller.signal }, (next) => {
        if (!current()) return;
        try { applyPage(next); publish(); } catch (error) { finished(error); }
      });
      void pending.then(() => finished(), (error: unknown) => finished(error));
    } catch (error) { finished(error); }
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
    stopWatch();
    cancelRead(false);
    const catalog = page.route.resourceId === 'ctx' || page.route.resourceId === 'tcp';
    const contextSource = catalog ? options.contextSource : undefined;
    const catalogRows = (values: readonly TuiContext[], notice?: string) => page.route.resourceId === 'tcp'
      ? contextRows(values.filter((context) => context.kind === 'local' || context.kind === 'tcp'), notice).map((row) => ({ ...row, navigate: { resourceId: 'stars', contextId: row.contextId }, actionRoutes: undefined }))
      : contextRows(values, notice);
    if (page.route.resourceId === 'local') {
      applyPage({ rows: localWorkspaceRows(options.registry.resources), completeness: 'complete', notice: '选择本机资源；TCP 星管理请进入 :tcp。' }); publish(); return;
    }
    if (catalog && !contextSource) { applyPage({ rows: catalogRows(contexts), completeness: initialContexts.completeness, notice: initialContexts.notice }); publish(); return; }
    if (page.route.contextId !== undefined && !currentContext()) {
      page.completeness = 'unavailable'; page.error = undefined;
      page.notice = '连接配置已不存在，请返回 ctx 重新选择连接。'; publish(); return;
    }
    const adapter = options.adapters[page.route.resourceId];
    if (!contextSource && !adapter) {
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
      const pending: Promise<{ page: TuiPage; contexts?: readonly TuiContext[] }> = contextSource
        ? contextSource.read(controller.signal).then((result) => ({ contexts: result.contexts, page: {
          rows: catalogRows(result.contexts, result.notice), completeness: result.completeness, notice: result.notice,
        } }))
        : adapter!.read({ context: currentContext(), route: copyRoute(page.route), signal: controller.signal }).then((result) => ({ page: result }));
      const cancelled = new Promise<undefined>((resolve) => {
        const onAbort = () => resolve(undefined);
        controller.signal.addEventListener('abort', onAbort, { once: true });
        removeAbort = () => controller.signal.removeEventListener('abort', onAbort);
        if (controller.signal.aborted) resolve(undefined);
      });
      const result = await Promise.race([pending, cancelled]);
      if (!result || disposed || generation !== readGeneration || requestPage !== page) return;
      if (result.contexts !== undefined) contexts = [...result.contexts];
      applyPage(result.page);
    } catch (error) {
      if (!disposed && generation === readGeneration && requestPage === page && !controller.signal.aborted) {
        page.error = contextSource ? '无法读取连接配置，请检查来源和访问权限后重试。' : errorText(error); page.completeness = page.rows.length ? 'partial' : 'unavailable';
      }
    } finally {
      removeAbort?.();
      if (!disposed && generation === readGeneration && requestPage === page) { activeRead = undefined; loading = false; publish(); }
    }
  }
  function navigate(route: TuiRoute, load = true) {
    if (!options.registry.resolve(route.resourceId)) { page.notice = `未知资源: ${route.resourceId}`; publish(); return; }
    cancelRead(false);
    stopWatch();
    cancelWork();
    promptFinish?.(null);
    const workspaceId = workspaceFor(options.registry.resolve(route.resourceId), contexts.find((context) => context.id === route.contextId), page.workspaceId);
    const cacheKey = JSON.stringify([workspaceId, routeKey(route)]);
    if (routeKey(route) !== routeKey(page.route) || workspaceId !== page.workspaceId) {
      history.push(page);
      const cached = pages.get(cacheKey);
      page = cached ?? { route: copyRoute(route), rows: [], filter: '', scrollOffset: 0, completeness: 'unavailable' };
      pages.set(cacheKey, page);
    }
    page.workspaceId = workspaceId;
    if (workspaceId === 'tcp' && route.contextId && route.resourceId !== 'tcp-targets') lastTcpRoute = { resourceId: 'stars', contextId: route.contextId };
    const active = route.contextId ?? null;
    if (active !== notifiedContext) { notifiedContext = active; options.onActiveContext?.(active); }
    mode = 'list'; input = undefined; savedInput = undefined; detail = undefined; help = undefined; choice = undefined; choiceRoutes.clear();
    if (load) void refresh();
  }
  function back() {
    cancelWork();
    if (mode === 'detail') { mode = detailReturnMode; detail = undefined; publish(); return; }
    if (page.filter) { page.filter = ''; publish(); return; }
    if (page.filters?.some((filter) => (page.selectedFacets?.get(filter.id) ?? filter.defaultValue) !== filter.defaultValue)) {
      page.selectedFacets = new Map(page.filters.map((filter) => [filter.id, filter.defaultValue])); publish(); return;
    }
    const previous = history.pop();
    if (previous) {
      cancelRead(false); stopWatch(); page = previous; mode = 'list';
      const active = page.route.contextId ?? null;
      if (active !== notifiedContext) { notifiedContext = active; options.onActiveContext?.(active); }
      if (page.workspaceId === 'tcp' && page.route.contextId && page.route.resourceId !== 'tcp-targets') void refresh();
      else publish();
    }
  }
  function openInput(kind: TuiInput['kind']) {
    cancelWork();
    savedInput = {
      mode: mode === 'detail' ? 'detail' : 'list', filter: page.filter, selectedId: page.selectedId, scrollOffset: page.scrollOffset, detail, detailCursorLine,
      contextId: page.route.contextId ?? (page.route.resourceId === 'ctx' ? selectedRow()?.contextId : undefined),
    };
    input = { kind, editor: { text: '', cursor: 0 }, candidates: kind === 'command' ? commandCandidates('').map((resource) => ({ id: resource.id, label: resource.label, enabled: true, reason: resource.unavailableReason })) : [], hint: 'Enter 保留筛选' };
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
          detailCursorLine = Math.max(0, detailLines(detail.fields, geometry().detailColumns).findIndex((line) => line.fieldIndex === found));
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
    if (pressed === 'Esc') {
      if (savedInput) { page.filter = savedInput.filter; page.selectedId = savedInput.selectedId; page.scrollOffset = savedInput.scrollOffset; detail = savedInput.detail; detailCursorLine = savedInput.detailCursorLine; mode = savedInput.mode; }
      input = undefined; savedInput = undefined; publish(); return;
    }
    if (pressed === 'Enter') {
      const target = input.kind === 'command' ? (input.candidateIndex === undefined ? options.registry.resolve(input.editor.text) : options.registry.resolve(input.candidates[input.candidateIndex]?.id ?? '')) : undefined;
      if (target) {
        const contextId = savedInput?.contextId ?? page.route.contextId;
        if (savedInput) { page.filter = savedInput.filter; page.selectedId = savedInput.selectedId; page.scrollOffset = savedInput.scrollOffset; }
        if (!['ctx', 'local', 'ssh', 'tcp', 'tcp-targets', 'connect'].includes(target.id) && (!contextId || !contexts.some((context) => context.id === contextId))) {
          mode = savedInput?.mode ?? 'list'; input = undefined; savedInput = undefined; page.notice = '请先从 ctx 选择有效连接'; publish(); return;
        }
        if (page.route.resourceId === 'ctx' && target.id !== 'ctx' && contextId) options.onContextSelection?.(contextId);
        if (target.id === 'tcp') {
          navigate(lastTcpRoute && contexts.some((context) => context.id === lastTcpRoute!.contextId) ? lastTcpRoute : { resourceId: 'tcp' });
        } else if (target.id === 'local') navigate({ resourceId: 'local', contextId: 'local' });
        else if (['ctx', 'ssh', 'tcp-targets', 'connect'].includes(target.id)) navigate({ resourceId: target.id });
        else {
          const declared = page.workspaceId === 'tcp' ? [...Object.values(page.actionRoutes ?? {}), ...Object.values(selectedRow()?.actionRoutes ?? {})].find((route) => route.resourceId === target.id) : undefined;
          navigate(declared ? copyRoute(declared) : { resourceId: target.id, contextId });
        }
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
    input = { ...input, editor, candidateIndex: undefined, candidates: input.kind === 'command' ? commandCandidates(editor.text).map((resource) => ({ id: resource.id, label: resource.label, enabled: true, reason: resource.unavailableReason })) : [] };
    updateInput();
  }
  function move(id: string) {
    const amount = id === 'page-up' ? -pageSize() : id === 'page-down' ? pageSize() : id === 'previous' ? -1 : 1;
    if (mode === 'help' && help) {
      const max = Math.max(0, helpLines(help.entries, geometry().contentColumns).length - pageSize());
      const offset = id === 'first' ? 0 : id === 'last' ? max : help.scrollOffset + amount;
      help = { ...help, scrollOffset: Math.max(0, Math.min(max, offset)) };
    } else if (mode === 'detail' && detail) {
      const lines = detailLines(detail.fields, geometry().detailColumns);
      const index = id === 'first' ? 0 : id === 'last' ? lines.length - 1 : detailCursorLine + amount;
      detailCursorLine = Math.max(0, Math.min(lines.length - 1, index));
      detail = { ...detail, selectedIndex: lines[detailCursorLine]?.fieldIndex ?? 0 };
      ensureDetailVisible();
    } else {
      if (page.canFollow && ['previous', 'page-up', 'first'].includes(id)) page.following = false;
      if (page.canFollow && id === 'last' && options.adapters[page.route.resourceId]?.watch) page.following = true;
      const rows = visibleRows();
      const current = rows.findIndex((row) => row.id === page.selectedId);
      const index = id === 'first' ? 0 : id === 'last' ? rows.length - 1 : current + amount;
      page.selectedId = rows[Math.max(0, Math.min(rows.length - 1, index))]?.id;
      if (page.route.resourceId === 'ctx' && page.selectedId) options.onContextSelection?.(page.selectedId);
    }
    publish();
  }
  function ensureDetailVisible() {
    if (!detail) return;
    const lines = detailLines(detail.fields, geometry().detailColumns);
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
    const context = contexts.find((context) => context.id === overlay!.contextId);
    if (overlay.contextId !== undefined && !context) throw new Error('连接配置已不存在，请返回 ctx 重新选择连接。');
    return {
      action: overlayAction, target, context, route: copyRoute(overlayOwner.route),
      values: Object.fromEntries(overlay.fields.map((field) => [field.id, field.value])), signal,
    };
  }
  function cancelForm() {
    if (!overlay) return;
    const uncertain = writeIssued;
    formGeneration++;
    formController?.abort(); formController = undefined;
    formPending = false; checkingSubmit = false; writeIssued = false; formManualScroll = false;
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
    formKnownSecrets.clear();
    overlay = {
      actionId: action.id, ownerResourceId: action.ownerResourceId, targetId: row?.id, contextId: page.route.contextId,
      title: action.label, fields: [], focusIndex: 0, phase: 'confirming',
      impact: [...formPinnedImpact, ...(action.impact ?? [])], confirmationDefault: 'cancel', scrollOffset: 0, checking: true,
    };
    updateFormFields(action.fields ?? []);
    overlay = { ...overlay!, phase: overlay!.fields.length ? 'editing' : 'confirming' };
    const generation = ++formGeneration;
    const controller = new AbortController();
    formController = controller; formPending = true; checkingSubmit = false; writeIssued = false; formManualScroll = false;
    ensureFormVisible();
    mode = 'form'; publish();
    void (async () => {
      try {
        const result = await adapter.checkAction!(formRequest(controller.signal));
        if (disposed || generation !== formGeneration || !overlay) return;
        if (result.fields) updateFormFields(result.fields);
        overlay = { ...overlay, impact: [...formPinnedImpact, ...(result.impact ?? action.impact ?? [])].map(formText), error: result.enabled ? undefined : formText([result.reason ?? '当前权限不允许此操作', result.nextStep].filter(Boolean).join('；')) };
        if (overlay.error) formManualScroll = false;
      } catch (error) {
        if (!disposed && generation === formGeneration && overlay) { overlay = { ...overlay, error: formText(errorText(error)) }; formManualScroll = false; }
      } finally {
        if (!disposed && generation === formGeneration && overlay) {
          formPending = false; overlay = { ...overlay, checking: false }; ensureFormVisible(); publish();
        }
      }
    })();
  }
  async function submitForm(): Promise<void> {
    if (!overlay || !overlayAction || !overlayOwner || !formController || formPending) return;
    const action = overlayAction;
    const owner = overlayOwner;
    const adapter = options.adapters[action.ownerResourceId];
    if (!adapter?.checkAction || !adapter.mutate) return;
    if (!validateFormValues()) { publish(); return; }
    const generation = formGeneration;
    const controller = formController;
    formPending = true; checkingSubmit = true;
    overlay = { ...overlay, error: undefined, checking: true }; ensureFormVisible(); publish();
    try {
      const permission = await adapter.checkAction(formRequest(controller.signal));
      if (disposed || generation !== formGeneration || !overlay) return;
      if (permission.fields && (permission.fields.length !== overlay.fields.length || permission.fields.some((field) => !overlay!.fields.some((existing) => existing.id === field.id)))) {
        throw new Error('表单字段已变化，请关闭后重新开始；已保留原输入。');
      }
      if (permission.fields) updateFormFields(permission.fields);
      if (!permission.enabled) throw new Error([permission.reason ?? '当前权限不允许此操作', permission.nextStep].filter(Boolean).join('；'));
      if (!validateFormValues()) return;
      const impact = [...formPinnedImpact, ...(permission.impact ?? action.impact ?? [])].map(formText);
      if (JSON.stringify(impact) !== JSON.stringify(overlay.impact)) {
        overlay = { ...overlay, impact, focusIndex: overlay.fields.length, phase: 'confirming', error: '影响范围已更新，请核对后再次确认。' };
        formManualScroll = false; ensureFormVisible(); return;
      }
      const request = formRequest(controller.signal);
      writeIssued = true; checkingSubmit = false;
      overlay = { ...overlay, phase: 'submitting', checking: false }; publish();
      const completion = await adapter.mutate(request);
      if (disposed || generation !== formGeneration || !overlay || page !== owner) return;
      if (completion.navigate && (!options.registry.resolve(completion.navigate.resourceId) || completion.result)) throw new Error('操作已提交，但返回目标无效；请核实结果后返回连接列表。');
      let message = completion.result ? '配置已生成；请在当前结果页保存后关闭。' : formText(completion.message ?? '操作已完成');
      if (completion.refreshContexts && options.contextSource) {
        try {
          const latest = await options.contextSource.read(controller.signal);
          if (disposed || generation !== formGeneration || !overlay || page !== owner) return;
          contexts = [...latest.contexts];
          if (latest.completeness !== 'complete') message += '；配置已保存，连接目录读取不完整，请返回工作区刷新。';
        } catch { message += '；配置已保存，连接目录刷新失败，请返回工作区刷新。'; }
      }
      if (completion.result) {
        const keys = new Set<string>();
        const ids = new Set<string>();
        for (const copy of completion.result.copies) {
          if (!copy.id || ids.has(copy.id) || keys.has(copy.shortcut) || !/^[A-Za-z0-9]$/.test(copy.shortcut) || copy.shortcut === 'q') throw new Error('结果复制动作登记无效，请核实已生成目标。');
          keys.add(copy.shortcut); ids.add(copy.id);
        }
      }
      formGeneration++; formController = undefined; formPending = false; writeIssued = false;
      overlay = undefined; overlayAction = undefined; overlayOwner = undefined; mode = 'list';
      formKnownSecrets.clear();
      if (completion.result) {
        result = { ...completion.result, fields: completion.result.fields.map((field) => ({ ...field })), copies: completion.result.copies.map((entry) => ({ ...entry })), scrollOffset: 0 };
        resultSelection = completion.selectedId; page.notice = message; mode = 'result'; publish(); return;
      }
      if (completion.navigate) {
        navigate(completion.navigate, false);
        const destination = page;
        const generation = viewGeneration;
        publish(); await refresh();
        if (!disposed && destination === page && generation === viewGeneration) {
          if (completion.selectedId && page.rows.some((row) => row.id === completion.selectedId)) {
            page.filter = ''; page.selectedId = completion.selectedId;
            if (page.route.resourceId === 'ctx') options.onContextSelection?.(completion.selectedId);
          }
          page.notice = message; publish();
        }
        return;
      }
      const completionView = viewGeneration;
      publish(); await refresh();
      if (!disposed && page === owner && completionView === viewGeneration) {
        let notice = message;
        if (completion.selectedId && action.returnPolicy === 'select-result') {
          if (owner.rows.some((row) => row.id === completion.selectedId)) {
            if (!visibleRows().some((row) => row.id === completion.selectedId)) {
              owner.filter = ''; notice += '；已清除筛选以显示结果。';
            }
            owner.selectedId = completion.selectedId;
          } else notice += '；结果不在当前列表，请刷新/调整范围核实。';
        }
        owner.notice = notice; publish();
      }
    } catch (error) {
      if (!disposed && generation === formGeneration && overlay) {
        overlay = { ...overlay, phase: 'confirming', error: formText(errorText(error)), checking: false };
        formManualScroll = false; ensureFormVisible(); publish();
      }
    } finally {
      if (!disposed && generation === formGeneration) {
        formPending = false; checkingSubmit = false; writeIssued = false;
        if (overlay) { overlay = { ...overlay, checking: false }; ensureFormVisible(); }
        publish();
      }
    }
  }
  function formPageSize() { return geometry().formRows; }
  function updateFormFields(definitions: readonly TuiFormField[]) {
    if (!overlay || !overlayAction) return;
    const previous = overlay.fields;
    const target = overlayOwner?.rows.find((row) => row.id === overlay!.targetId);
    const fields = definitions.map((field) => {
      const existing = previous.find((value) => value.id === field.id);
      const candidate = existing?.value ?? field.initialValue ?? own(target?.cells, field.id) ?? field.options?.find((option) => option.enabled !== false)?.value ?? '';
      const editor = editText({ text: '', cursor: 0 }, { type: 'insert', text: candidate });
      const value = field.options ? candidate : editor.text;
      if (field.secret && value) formKnownSecrets.add(value);
      return { id: field.id, label: field.label, value, cursor: field.options ? 0 : existing?.cursor ?? editor.cursor, secret: field.secret, options: field.options?.map((option) => ({ ...option })) };
    });
    overlayAction = { ...overlayAction, fields: definitions };
    const focusIndex = Math.min(overlay.focusIndex, fields.length + 1);
    overlay = { ...overlay, fields, focusIndex, phase: focusIndex < fields.length ? 'editing' : overlay.phase };
  }
  function validateFormValues(): boolean {
    if (!overlay || !overlayAction) return false;
    for (const [index, definition] of (overlayAction.fields ?? []).entries()) {
      const field = overlay.fields.find((value) => value.id === definition.id);
      const value = field?.value ?? '';
      const option = definition.options?.find((entry) => entry.value === value);
      const error = definition.options && (!option || option.enabled === false) ? `请重新选择${definition.label}的可用选项${option?.reason ? `：${option.reason}` : ''}`
        : definition.required && !value.trim() ? `请填写${definition.label}` : undefined;
      if (error) {
        overlay = { ...overlay, error: formText(error), focusIndex: index, phase: 'editing' };
        formManualScroll = false; ensureFormVisible(); return false;
      }
    }
    return true;
  }
  function ensureFormVisible() {
    if (!overlay) return;
    const lines = formContentLines(overlay, geometry().contentColumns);
    const max = Math.max(0, lines.length - formPageSize());
    let scrollOffset = Math.max(0, Math.min(overlay.scrollOffset ?? 0, max));
    if (!formManualScroll) {
      const focusIndex = overlay.focusIndex;
      const index = focusIndex < overlay.fields.length ? lines.findIndex((line) => line.fieldIndex === focusIndex)
        : overlay.error ? lines.findIndex((line) => line.kind === 'error')
          : lines.findIndex((line) => line.kind === 'impact');
      if (index >= 0 && index < scrollOffset) scrollOffset = index;
      if (index >= scrollOffset + formPageSize()) scrollOffset = index - formPageSize() + 1;
    }
    overlay = { ...overlay, scrollOffset };
  }
  function formKey(key: TuiKey) {
    if (!overlay) return;
    const pressed = shortcut(key);
    if (pressed === 'Esc' || pressed === 'Ctrl+C') { cancelForm(); return; }
    const count = overlay.fields.length;
    if (['PgUp', 'PgDn'].includes(pressed) || (overlay.focusIndex >= count && ['Home', 'End'].includes(pressed))) {
      const max = Math.max(0, formContentLines(overlay, geometry().contentColumns).length - formPageSize());
      const previous = overlay.scrollOffset ?? 0;
      const requested = pressed === 'Home' ? 0 : pressed === 'End' ? max : previous + (pressed === 'PgUp' ? -formPageSize() : formPageSize());
      overlay = { ...overlay, scrollOffset: Math.max(0, Math.min(max, requested)) };
      formManualScroll = true; publish(); return;
    }
    if (checkingSubmit || overlay.phase === 'submitting') return;
    if (pressed === 'Tab' || pressed === 'Shift+Tab') {
      const direction = pressed === 'Tab' ? 1 : -1;
      const focusIndex = (overlay.focusIndex + direction + count + 2) % (count + 2);
      overlay = { ...overlay, focusIndex, phase: focusIndex < count ? 'editing' : 'confirming' };
      formManualScroll = false; ensureFormVisible(); publish(); return;
    }
    if (pressed === 'Enter') {
      if (overlay.focusIndex < count) {
        const focusIndex = overlay.focusIndex + 1;
        overlay = { ...overlay, focusIndex, phase: focusIndex < count ? 'editing' : 'confirming' };
        formManualScroll = false; ensureFormVisible(); publish();
      } else if (overlay.focusIndex === count) cancelForm();
      else void submitForm();
      return;
    }
    if (overlay.focusIndex >= count) {
      if (['←', '→'].includes(pressed)) {
        overlay = { ...overlay, focusIndex: pressed === '←' ? count : count + 1 };
        formManualScroll = false; ensureFormVisible(); publish();
      }
      return;
    }
    const focused = overlay.fields[overlay.focusIndex];
    if (focused.options) {
      const available = focused.options.filter((option) => option.enabled !== false);
      if (!available.length || !['↑', '↓', '←', '→', 'Space', 'Home', 'End'].includes(pressed)) return;
      const direction = ['↑', '←'].includes(pressed) ? -1 : 1;
      const current = available.findIndex((option) => option.value === focused.value);
      const index = pressed === 'Home' ? 0 : pressed === 'End' ? available.length - 1 : current < 0 ? (direction > 0 ? 0 : available.length - 1) : (current + direction + available.length) % available.length;
      const value = available[index].value;
      const fields = overlay.fields.map((field, fieldIndex) => fieldIndex === overlay!.focusIndex ? { ...field, value, cursor: 0 } : field);
      if (focused.secret && value) formKnownSecrets.add(value);
      overlay = { ...overlay, fields, error: undefined };
      formManualScroll = false; ensureFormVisible(); publish(); return;
    }
    const event = editEvent(key);
    if (!event) return;
    const field = overlay.fields[overlay.focusIndex];
    const editor = editText({ text: field.value, cursor: field.cursor ?? 0 }, event);
    if (field.secret && editor.text) formKnownSecrets.add(editor.text);
    const fields = overlay.fields.map((value, index) => index === overlay!.focusIndex ? { ...value, value: editor.text, cursor: editor.cursor } : value);
    overlay = { ...overlay, fields, phase: 'editing', error: undefined };
    formManualScroll = false; ensureFormVisible(); publish();
  }
  function formText(message: string): string {
    let safe = message;
    for (const value of [...formKnownSecrets].sort((left, right) => right.length - left.length)) safe = safe.replaceAll(value, '[已隐藏]');
    return safe;
  }
  async function copy(action?: TuiAction) {
    if (!options.clipboard) return;
    const value = mode === 'detail' ? detail?.fields[detail.selectedIndex]?.value
      : mode === 'choice' && choice ? choice.options[choice.selectedIndex]?.value
        : action?.copyKey ? own(selectedRow()?.copyValues, action.copyKey) : selectedRow()?.copyValue;
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
      helpReturnMode = mode === 'detail' ? 'detail' : mode === 'choice' ? 'choice' : 'list';
      help = { title: pageResource()?.label ?? page.route.resourceId, entries: actionEntries(mode), scrollOffset: 0 };
      mode = 'help'; publish(); return;
    }
    if (action.id === 'quit') { options.onExit?.(); return; }
    if (action.id === 'interrupt') { if (activeRead) cancelRead(true); else options.onExit?.(); return; }
    if (action.id === 'sort') {
      const columns = pageResource()?.columns ?? [];
      const index = columns.findIndex((column) => column.id === page.sortColumn);
      page.sortColumn = columns[(index + 1) % columns.length]?.id;
      page.notice = page.sortColumn ? `按${columns.find((column) => column.id === page.sortColumn)?.label}排序` : '此资源没有可排序字段'; publish(); return;
    }
    if (action.kind === 'copy') { void copy(action); return; }
    if (action.kind === 'filter') { openFacet(action); return; }
    if (action.kind === 'route-choice') { openRouteChoice(action); return; }
    if (action.kind === 'follow') { page.following = !page.following; publish(); return; }
    if (action.kind === 'form') { openForm({ ...action, fields: availability.fields ?? action.fields, impact: availability.impact ?? action.impact }); return; }
    if (action.kind === 'navigate') {
      const row = selectedRow();
      if (action.id === 'enter-context' && row) {
        const context = contexts.find((item) => item.id === row.contextId);
        if (context) {
          if (page.route.resourceId === 'ctx') options.onContextSelection?.(context.id);
          navigate(enterContextRoute(context));
        }
      } else {
        const route = actionRoute(action, row);
        if (route) navigate(route);
      }
      return;
    }
    if (action.kind === 'detail') {
      const row = selectedRow();
      const view = action.viewId ? own(row?.detailViews, action.viewId) ?? own(page.detailViews, action.viewId) : undefined;
      if (row || view) {
        cancelWork();
        detail = {
          title: view?.title ?? row!.cells.name ?? row!.id,
          fields: view?.fields ?? row!.detail ?? Object.entries(row!.cells).map(([label, value]) => ({ label, value })), selectedIndex: 0, scrollOffset: 0, query: '',
        };
        detailReturnMode = 'list';
        detailCursorLine = 0;
        mode = 'detail'; publish();
      }
      return;
    }
    page.notice = `此操作尚未接入: ${action.label}`; publish();
  }
  function openFacet(action: TuiAction) {
    const filter = page.filters?.find((filter) => filter.id === action.filterId);
    if (!filter || !filter.options.length) { page.notice = '当前没有可用筛选项'; publish(); return; }
    const current = page.selectedFacets?.get(filter.id) ?? filter.defaultValue;
    if (filter.mode === 'toggle') {
      const enabled = filter.options.filter((option) => option.enabled !== false);
      const index = enabled.findIndex((option) => option.value === current);
      const next = enabled[(index + 1) % enabled.length];
      if (!next) { page.notice = '当前没有可用筛选项'; publish(); return; }
      page.selectedFacets ??= new Map(); page.selectedFacets.set(filter.id, next.value); publish(); return;
    }
    cancelWork(); mode = 'choice'; choiceRoutes.clear();
    const options = filter.options.some((option) => option.value === current) ? filter.options : [...filter.options, { value: current, label: current, enabled: false, reason: '此筛选值已不在当前来源中，请选择其他选项' }];
    choice = { filterId: filter.id, title: filter.label, options, selectedIndex: Math.max(0, options.findIndex((option) => option.value === current)), scrollOffset: 0 };
    ensureChoiceVisible(); publish();
  }
  function openRouteChoice(action: TuiAction) {
    const source = own(page.routeChoices, action.id);
    if (!source?.options.length) return;
    cancelWork(); mode = 'choice';
    choiceRoutes = new Map(source.options.map((option) => [option.value, copyRoute(option.route)]));
    choice = { actionId: action.id, title: source.title, options: source.options.map((option) => ({ value: option.value, label: option.label, enabled: option.enabled, reason: option.reason })), selectedIndex: Math.max(0, source.options.findIndex((option) => routeKey(option.route) === routeKey(page.route))), scrollOffset: 0 };
    ensureChoiceVisible(); publish();
  }
  function ensureChoiceVisible() {
    if (!choice) return;
    const selectedIndex = Math.max(0, Math.min(choice.selectedIndex, Math.max(0, choice.options.length - 1)));
    let scrollOffset = Math.max(0, Math.min(choice.scrollOffset, Math.max(0, choice.options.length - pageSize())));
    if (selectedIndex < scrollOffset) scrollOffset = selectedIndex;
    if (selectedIndex >= scrollOffset + pageSize()) scrollOffset = selectedIndex - pageSize() + 1;
    choice = { ...choice, selectedIndex, scrollOffset };
  }
  function choiceKey(key: TuiKey) {
    if (!choice || key.name === 'paste') return;
    const pressed = shortcut(key);
    const action = options.registry.actions(page.route.resourceId, 'choice').find((entry) => entry.shortcut.split(' / ').includes(pressed));
    if (!action) return;
    if (action.id === 'choice-cancel') { cancelWork(); mode = 'list'; choice = undefined; choiceRoutes.clear(); publish(); return; }
    if (action.id === 'help') { execute(action); return; }
    const option = choice.options[choice.selectedIndex];
    if (action.id === 'choice-copy') { execute(action); return; }
    if (action.id === 'choice-detail' && option) {
      cancelWork();
      detail = { title: choice.title, fields: [{ label: '选项', value: option.label }, { label: '值', value: option.value }, { label: '可用性', value: option.enabled === false ? option.reason ?? '暂不可用' : '可用' }], selectedIndex: 0, scrollOffset: 0, query: '' };
      detailReturnMode = 'choice'; detailCursorLine = 0; mode = 'detail'; publish(); return;
    }
    if (action.id === 'choice-apply' && option) {
      if (choice.actionId) {
        const current = own(page.routeChoices, choice.actionId)?.options.find((entry) => entry.value === option.value);
        const expected = choiceRoutes.get(option.value);
        if (!current || current.enabled === false || !expected || routeKey(current.route) !== routeKey(expected)) { page.notice = current?.enabled === false ? current.reason ?? '来源暂不可用' : '来源选项已变化，请重新选择'; publish(); return; }
        navigate(copyRoute(current.route)); return;
      }
      const filter = page.filters?.find((entry) => entry.id === choice!.filterId);
      const current = filter?.options.find((entry) => entry.value === option.value);
      if (!current || current.enabled === false) { page.notice = current?.reason ?? '筛选选项已变化，请重新选择'; publish(); return; }
      page.selectedFacets ??= new Map(); page.selectedFacets.set(filter!.id, current.value);
      mode = 'list'; choice = undefined; publish(); return;
    }
    const moves: Readonly<Record<string, number>> = { previous: -1, next: 1, 'page-up': -pageSize(), 'page-down': pageSize() };
    const index = action.id === 'first' ? 0 : action.id === 'last' ? choice.options.length - 1 : choice.selectedIndex + (own(moves, action.id) ?? 0);
    choice = { ...choice, selectedIndex: Math.max(0, Math.min(choice.options.length - 1, index)) };
    ensureChoiceVisible(); publish();
  }
  function clearResult() {
    if (!result) return;
    result = undefined; resultSelection = undefined; cancelWork();
    try { options.onSensitiveClear?.(); }
    catch { page.notice = '秘密结果已关闭；终端清屏未确认，请在原生终端手动清屏。'; }
  }
  function closeResult(quit = false) {
    const selectedId = resultSelection;
    clearResult(); mode = 'list'; publish();
    if (quit) { options.onExit?.(); return; }
    const owner = page;
    const generation = viewGeneration;
    void refresh().then(() => {
      if (disposed || owner !== page || generation !== viewGeneration || !selectedId) return;
      if (page.rows.some((row) => row.id === selectedId)) { page.selectedId = selectedId; publish(); }
    });
  }
  function resultKey(key: TuiKey) {
    if (!result || key.name === 'paste') return;
    const pressed = shortcut(key);
    if (pressed === 'Esc' || pressed === 'Ctrl+C' || pressed === 'q') { closeResult(pressed === 'q'); return; }
    const copy = result.copies.find((entry) => entry.shortcut === pressed);
    if (copy && options.clipboard) {
      const owner = result;
      const controller = new AbortController(); work.add(controller);
      void options.clipboard(copy.value, controller.signal).then(() => {
        if (!disposed && !controller.signal.aborted && owner === result) { result = { ...result, notice: '已复制完整值；离开前请保存，系统剪贴板需自行覆盖。' }; publish(); }
      }, () => {
        if (!disposed && !controller.signal.aborted && owner === result) { result = { ...result, notice: '复制失败；请检查本机剪贴板后重试。' }; publish(); }
      }).finally(() => { work.delete(controller); });
      return;
    }
    const size = Math.max(1, viewport.rows - 9);
    const max = Math.max(0, detailLines(result.fields, geometry().detailColumns).length - size);
    const changes: Readonly<Record<string, number>> = { '↑': -1, k: -1, '↓': 1, j: 1, PgUp: -size, PgDn: size };
    const next = pressed === 'Home' ? 0 : pressed === 'End' ? max : result.scrollOffset + (own(changes, pressed) ?? 0);
    result = { ...result, scrollOffset: Math.max(0, Math.min(max, next)) }; publish();
  }
  function prompt(request: TuiPromptRequest, signal: AbortSignal): Promise<string | boolean | null> {
    if (disposed || signal.aborted) return Promise.resolve(null);
    promptFinish?.(null);
    const returnMode = mode;
    const owner = page;
    promptEditor = { text: '', cursor: 0 };
    promptState = { ...request, fields: request.fields.map((field) => ({ ...field })), displayValue: '', cursor: 0, accepted: false, scrollOffset: 0 };
    mode = 'prompt';
    return new Promise((resolve) => {
      const aborted = () => finish(null);
      const finish = (value: string | boolean | null) => {
        if (promptFinish !== finish) return;
        signal.removeEventListener('abort', aborted);
        promptFinish = undefined; promptState = undefined; promptEditor = { text: '', cursor: 0 };
        if (owner === page && mode === 'prompt') mode = returnMode;
        resolve(value); publish();
      };
      promptFinish = finish;
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) finish(null); else publish();
    });
  }
  function promptKey(key: TuiKey) {
    if (!promptState) return;
    const pressed = shortcut(key);
    if (pressed === 'Esc' || pressed === 'Ctrl+C') { promptFinish?.(null); return; }
    if (viewport.columns < 24 || viewport.rows < 16) return;
    if (['PgUp', 'PgDn', '↑', '↓'].includes(pressed)) {
      promptState = { ...promptState, scrollOffset: Math.max(0, promptState.scrollOffset + (['PgUp', '↑'].includes(pressed) ? -1 : 1)) }; publish(); return;
    }
    if (pressed === 'Enter') { promptFinish?.(promptState.kind === 'confirm' ? promptState.accepted : promptEditor.text); return; }
    if (promptState.kind === 'confirm') {
      if (['Tab', 'Shift+Tab', '←', '→', 'Space'].includes(pressed)) promptState = { ...promptState, accepted: !promptState.accepted };
    } else {
      const event = key.name === 'paste' && key.text ? { type: 'insert' as const, text: key.text } : editEvent(key);
      if (event) promptEditor = editText(promptEditor, event);
      promptState = { ...promptState, displayValue: '•'.repeat(Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(promptEditor.text)).length), cursor: promptEditor.cursor };
    }
    publish();
  }
  function handleKey(key: TuiKey) {
    if (disposed) return;
    if (mode === 'prompt') { promptKey(key); return; }
    if (mode === 'result') { resultKey(key); return; }
    if (mode === 'form') { formKey(key); return; }
    if (shortcut(key) === 'Ctrl+C') {
      if (page.autoRefresh !== undefined) page.autoRefresh = false;
      if (page.canFollow) page.following = false;
      if (mode === 'input') inputKey({ name: 'escape' });
      if (mode === 'choice') { mode = 'list'; choice = undefined; publish(); }
      if (activeRead) cancelRead(true);
      else if (activeWatch) { page.following = false; stopWatch(); page.notice = page.autoRefresh === false ? '自动刷新已暂停；r重新读取并恢复。' : '跟随已暂停'; publish(); }
      else options.onExit?.();
      return;
    }
    if (mode === 'input') { inputKey(key); return; }
    if (mode === 'choice') { choiceKey(key); return; }
    if (key.name === 'paste') return;
    if (mode === 'help') {
      const pressed = shortcut(key);
      if (pressed === 'Esc' || pressed === '?') { mode = helpReturnMode; help = undefined; publish(); return; }
      const action = options.registry.actions(page.route.resourceId, 'help').find((entry) => entry.shortcut.split(' / ').includes(pressed));
      if (action && ['previous', 'next', 'page-up', 'page-down', 'first', 'last'].includes(action.id)) move(action.id);
      return;
    }
    const pressed = shortcut(key);
    const action = actionsFor(mode).find((entry) => entry.shortcut.split(' / ').includes(pressed));
    if (action) execute(action);
  }
  publish();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { if (!disposed) listeners.add(listener); return () => { listeners.delete(listener); }; },
    handleKey,
    resize: (columns: number, rows: number) => {
      viewport = { columns: Math.max(1, Math.floor(columns)), rows: Math.max(1, Math.floor(rows)) };
      ensureDetailVisible();
      ensureFormVisible();
      ensureChoiceVisible();
      if (help) help = { ...help, scrollOffset: Math.min(help.scrollOffset, Math.max(0, helpLines(help.entries, geometry().contentColumns).length - pageSize())) };
      publish();
    },
    refresh,
    prompt,
    dispose: () => { if (disposed) return; promptFinish?.(null); options.onActiveContext?.(null); stopWatch(); cancelRead(false); cancelWork(); formController?.abort(); formGeneration++; clearResult(); if (snapshot.result) snapshot = { ...snapshot, result: undefined, mode: 'list' }; disposed = true; listeners.clear(); },
  };
}

export type TuiController = ReturnType<typeof createTuiController>;
