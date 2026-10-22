/** Framework-independent UI contracts. Native tools and transports stay in application adapters. */
export interface TuiKey { name: string; text?: string; ctrl?: boolean; shift?: boolean; alt?: boolean }
export interface TuiContext extends Pick<TuiRow, 'actionRoutes' | 'actionAvailability' | 'detailViews'> {
  id: string;
  label: string;
  kind: string;
  description?: string;
  target?: string;
  identityHint?: string;
  permissionLabel?: string;
  defaultResourceId?: string;
}
export interface TuiRoute { resourceId: string; contextId?: string; query?: Readonly<Record<string, string>> }
export interface TuiField { label: string; value: string }
export interface TuiRow {
  id: string;
  cells: Readonly<Record<string, string>>;
  searchText?: string;
  detail?: readonly TuiField[];
  contextId?: string;
  navigate?: TuiRoute;
  actionRoutes?: Readonly<Record<string, TuiRoute>>;
  copyValue?: string;
  copyValues?: Readonly<Record<string, string>>;
  facets?: Readonly<Record<string, string>>;
  actionAvailability?: Readonly<Record<string, TuiActionAvailability>>;
  detailViews?: Readonly<Record<string, TuiReadonlyView>>;
}
export interface TuiColumn { id: string; label: string; width: number; priority?: number }
export type TuiMode = 'list' | 'input' | 'detail' | 'help' | 'form' | 'choice' | 'result';
export interface TuiReadonlyView { title: string; fields: readonly TuiField[] }
export interface TuiOption { value: string; label: string; enabled?: boolean; reason?: string }
export interface TuiRouteChoice { title: string; options: readonly (TuiOption & { route: TuiRoute })[] }
export interface TuiFilter { id: string; label: string; mode: 'select' | 'toggle'; defaultValue: string; options: readonly TuiOption[] }
export interface TuiActionAvailability { enabled: boolean; reason?: string; nextStep?: string; impact?: readonly string[]; fields?: readonly TuiFormField[] }
export interface TuiFormField { id: string; label: string; required?: boolean; secret?: boolean; initialValue?: string; options?: readonly TuiOption[] }
export interface TuiAction {
  id: string;
  label: string;
  shortcut: string;
  ownerResourceId: string;
  selectionPolicy: 'required' | 'optional' | 'none';
  capability?: string;
  mutation: boolean;
  kind: 'detail' | 'copy' | 'navigate' | 'form' | 'command' | 'filter' | 'route-choice' | 'follow';
  filterId?: string;
  viewId?: string;
  copyKey?: string;
  navigateTo?: string;
  fields?: readonly TuiFormField[];
  impact?: readonly string[];
  returnPolicy: 'restore' | 'select-result';
  enabled?: boolean;
  unavailableReason?: string;
  nextStep?: string;
}
export interface TuiResource {
  id: string;
  label: string;
  aliases: readonly string[];
  description: string;
  columns: readonly TuiColumn[];
  actions: readonly TuiAction[];
  sortable?: boolean;
  unavailableReason?: string;
}
export interface TuiPagePresentation { columns?: readonly TuiColumn[]; actions?: readonly TuiAction[] }
/** Explicitly generated secrets live only in this one-time result, never in a cached resource page. */
export interface TuiSensitiveResult {
  title: string;
  fields: readonly TuiField[];
  copies: readonly { id: string; label: string; shortcut: string; value: string }[];
  notice?: string;
}
export interface TuiMutationResult { selectedId?: string; message?: string; result?: TuiSensitiveResult; navigate?: TuiRoute }
export interface TuiPage {
  rows: readonly TuiRow[];
  completeness: 'complete' | 'partial' | 'unavailable' | 'cancelled';
  sampledAt?: number;
  notice?: string;
  filters?: readonly TuiFilter[];
  actionAvailability?: Readonly<Record<string, TuiActionAvailability>>;
  detailViews?: Readonly<Record<string, TuiReadonlyView>>;
  routeChoices?: Readonly<Record<string, TuiRouteChoice>>;
  canFollow?: boolean;
  /** Refreshes a normal resource list without log tail selection/scroll behavior. */
  autoRefresh?: boolean;
  presentation?: TuiPagePresentation;
  actionRoutes?: Readonly<Record<string, TuiRoute>>;
  contextSummary?: { label?: string; permissionLabel?: string };
}
export interface TuiActionRequest {
  action: TuiAction;
  target?: TuiRow;
  context?: TuiContext;
  route?: TuiRoute;
  values: Readonly<Record<string, string>>;
  signal: AbortSignal;
}
export interface TuiResourceAdapter {
  read(request: TuiReadRequest): Promise<TuiPage>;
  /** Owns its polling/IO until signal aborts; publishes complete bounded snapshots. */
  watch?(request: TuiReadRequest, publish: (page: TuiPage) => void): Promise<void>;
  checkAction?(request: TuiActionRequest): Promise<TuiActionAvailability>;
  mutate?(request: TuiActionRequest): Promise<TuiMutationResult>;
}
export interface TuiReadRequest { context?: TuiContext; route?: TuiRoute; signal: AbortSignal }
export interface TuiActionEntry extends TuiActionAvailability { id: string; shortcut: string; label: string }
export interface TuiCandidate { id: string; label: string; enabled: boolean; reason?: string }
export interface TuiInput {
  kind: 'command' | 'filter' | 'detail-search';
  editor: { text: string; cursor: number };
  candidates: readonly TuiCandidate[];
  candidateIndex?: number;
  hint: string;
}
export interface TuiDetail { title: string; fields: readonly TuiField[]; selectedIndex: number; scrollOffset: number; query: string }
export interface TuiOverlay {
  actionId: string;
  ownerResourceId: string;
  targetId?: string;
  contextId?: string;
  title: string;
  fields: readonly { id: string; label: string; value: string; secret?: boolean; cursor?: number; options?: readonly TuiOption[] }[];
  focusIndex: number;
  scrollOffset?: number;
  checking?: boolean;
  phase: 'editing' | 'confirming' | 'submitting';
  impact: readonly string[];
  error?: string;
  confirmationDefault: 'cancel';
}
export interface TuiSnapshot {
  route: TuiRoute;
  context?: TuiContext;
  mode: TuiMode;
  rows: readonly TuiRow[];
  selectedId?: string;
  selectedIndex: number;
  scrollOffset: number;
  filter: string;
  input?: TuiInput;
  detail?: TuiDetail;
  help?: { title: string; entries: readonly TuiActionEntry[]; scrollOffset: number };
  overlay?: TuiOverlay;
  choice?: { filterId?: string; actionId?: string; title: string; options: readonly TuiOption[]; selectedIndex: number; scrollOffset: number };
  filters?: readonly TuiFilter[];
  selectedFacets?: Readonly<Record<string, string>>;
  sampledAt?: number;
  following?: boolean;
  autoRefreshing?: boolean;
  loading: boolean;
  totalRows?: number;
  error?: string;
  notice?: string;
  completeness: TuiPage['completeness'];
  actions: readonly TuiActionEntry[];
  viewport: { columns: number; rows: number };
  resource?: TuiResource;
  result?: TuiSensitiveResult & { scrollOffset: number };
}
