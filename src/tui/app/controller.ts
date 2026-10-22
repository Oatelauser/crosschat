import type { TuiContext, TuiKey, TuiResourceAdapter, TuiSnapshot } from '../model.js';
import type { ResourceRegistry } from '../resources/registry.js';
import { editText } from '../ui/text.js';

export interface TuiControllerOptions {
  registry: ResourceRegistry;
  contexts: readonly TuiContext[];
  adapters: Readonly<Record<string, TuiResourceAdapter>>;
  initialSelectedContextId?: string;
  clipboard?: (text: string, signal: AbortSignal) => Promise<void>;
  onExit?: () => void;
  now?: () => number;
}

export function createTuiController(options: TuiControllerOptions) {
  const listeners = new Set<() => void>();
  const rows = options.contexts.map((context) => ({
    id: context.id, contextId: context.id,
    cells: { kind: context.kind, name: context.label, target: context.target ?? '', description: context.description ?? '' },
    copyValue: context.target ?? context.id,
  }));
  let snapshot: TuiSnapshot = {
    route: { resourceId: 'ctx' }, mode: 'list', rows, selectedId: rows.some((row) => row.id === options.initialSelectedContextId) ? options.initialSelectedContextId : rows[0]?.id,
    selectedIndex: 0, scrollOffset: 0, filter: '', loading: false, completeness: 'complete',
    actions: options.registry.actions('ctx', 'list').map((action) => ({ ...action, enabled: true })), viewport: { columns: 80, rows: 24 },
  };
  let saved: TuiSnapshot | undefined;
  function publish(next: TuiSnapshot) { snapshot = next; for (const listener of listeners) listener(); }
  function handleKey(key: TuiKey) {
    if (snapshot.mode === 'input') {
      if (key.name === 'escape') { if (saved) publish(saved); return; }
      if (!key.ctrl && !key.alt && (key.text || key.name.length === 1)) {
        const editor = editText(snapshot.input!.editor, { type: 'insert', text: key.text ?? key.name });
        const query = editor.text.toLocaleLowerCase();
        publish({ ...snapshot, filter: editor.text, rows: rows.filter((row) => Object.values(row.cells).some((value) => value.toLocaleLowerCase().includes(query))), input: {
          ...snapshot.input!, editor,
          candidates: options.registry.candidates(editor.text).map((resource) => ({ id: resource.id, label: resource.label, enabled: true })),
        } });
      }
      return;
    }
    if (key.name === ':' || key.name === '/') {
      saved = snapshot;
      publish({ ...snapshot, mode: 'input', input: { kind: key.name === ':' ? 'command' : 'filter', editor: { text: '', cursor: 0 }, candidates: options.registry.candidates('').map((resource) => ({ id: resource.id, label: resource.label, enabled: true })), hint: 'Enter 保留筛选' } });
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    handleKey,
    resize: (columns: number, rowCount: number) => publish({ ...snapshot, viewport: { columns, rows: rowCount } }),
    refresh: async () => {},
    dispose: () => listeners.clear(),
  };
}
