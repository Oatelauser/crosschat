/** Framework-independent UI contracts. Native tools and transports stay in application adapters. */
export interface TuiKey { name: string; text?: string; ctrl?: boolean; shift?: boolean; alt?: boolean }
export interface TuiContext {
  id: string;
  label: string;
  kind: string;
  description?: string;
  target?: string;
  identityHint?: string;
  permissionLabel?: string;
  defaultResourceId?: string;
}
export interface TuiRoute { resourceId: string; contextId?: string }
export interface TuiField { label: string; value: string }
export interface TuiRow {
  id: string;
  cells: Readonly<Record<string, string>>;
  searchText?: string;
  detail?: readonly TuiField[];
  contextId?: string;
  navigate?: TuiRoute;
  copyValue?: string;
  copyValues?: Readonly<Record<string, string>>;
  facets?: Readonly<Record<string, string>>;
  actionAvailability?: Readonly<Record<string, TuiActionAvailability>>;
  detailViews?: Readonly<Record<string, TuiReadonlyView>>;
}
export interface TuiColumn { id: string; label: string; width: number; priority?: number }
export type TuiMode = 'list' | 'input' | 'detail' | 'help' | 'form' | 'choice';
export interface TuiReadonlyView { title: string; fields: readonly TuiField[] }
export interface TuiOption { value: string; label: string; enabled?: boolean; reason?: string }
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
  kind: 'detail' | 'copy' | 'navigate' | 'form' | 'command' | 'filter';
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
  unavailableReason?: string;
}
export interface TuiPage {
  rows: readonly TuiRow[];
  completeness: 'complete' | 'partial' | 'unavailable' | 'cancelled';
  sampledAt?: number;
  notice?: string;
  filters?: readonly TuiFilter[];
  actionAvailability?: Readonly<Record<string, TuiActionAvailability>>;
  detailViews?: Readonly<Record<string, TuiReadonlyView>>;
}
export interface TuiActionRequest {
  action: TuiAction;
  target?: TuiRow;
  context?: TuiContext;
  values: Readonly<Record<string, string>>;
  signal: AbortSignal;
}
export interface TuiResourceAdapter {
  read(request: { context?: TuiContext; signal: AbortSignal }): Promise<TuiPage>;
  checkAction?(request: TuiActionRequest): Promise<TuiActionAvailability>;
  mutate?(request: TuiActionRequest): Promise<{ selectedId?: string; message?: string }>;
}
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
  choice?: { filterId: string; title: string; options: readonly TuiOption[]; selectedIndex: number; scrollOffset: number };
  filters?: readonly TuiFilter[];
  selectedFacets?: Readonly<Record<string, string>>;
  sampledAt?: number;
  loading: boolean;
  totalRows?: number;
  error?: string;
  notice?: string;
  completeness: TuiPage['completeness'];
  actions: readonly TuiActionEntry[];
  viewport: { columns: number; rows: number };
}
