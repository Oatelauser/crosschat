import { describe, expect, it, vi } from 'vitest';
import { createTuiController } from '../src/tui/app/controller.js';
import { createResourceRegistry, defaultResources } from '../src/tui/resources/registry.js';
import type { TuiPage, TuiReadRequest, TuiResourceAdapter } from '../src/tui/model.js';

function page(...ids: string[]): TuiPage { return { rows: ids.map((id) => ({ id, cells: { name: id }, detail: [{ label: '完整行', value: id }], copyValue: id })), completeness: 'complete', canFollow: true }; }
function fixture() {
  const owners: { request: TuiReadRequest; publish: (page: TuiPage) => void }[] = [];
  let current = page('old-0', 'old-1', 'old-2');
  const read = vi.fn<TuiResourceAdapter['read']>(async () => current);
  const watch: NonNullable<TuiResourceAdapter['watch']> = (request, publish) => {
    owners.push({ request, publish });
    return new Promise(() => {});
  };
  const registry = createResourceRegistry(defaultResources.map((resource) => resource.id === 'logs' ? {
    ...resource, unavailableReason: undefined, sortable: false,
    actions: [{ id: 'follow', label: '暂停或恢复跟随', shortcut: 'Space', ownerResourceId: 'logs', kind: 'follow', mutation: false, selectionPolicy: 'none', returnPolicy: 'restore' }],
  } : resource));
  const onExit = vi.fn();
  const controller = createTuiController({ registry, contexts: [{ id: 'local', kind: 'local', label: '本机' }], adapters: { logs: { read, watch } }, onExit });
  return { controller, registry, owners, read, onExit, setPage(value: TuiPage) { current = value; } };
}
function command(controller: ReturnType<typeof createTuiController>, text: string) {
  controller.handleKey({ name: ':' }); controller.handleKey({ name: 'text', text }); controller.handleKey({ name: 'enter' });
}
async function enter(value: ReturnType<typeof fixture>) {
  command(value.controller, 'logs'); await vi.waitFor(() => expect(value.controller.getSnapshot().loading).toBe(false));
  await vi.waitFor(() => expect(value.owners).toHaveLength(1));
}

describe('bounded resource following', () => {
  it('follows the latest row, pauses on upward navigation, drops late updates, and resumes with independent owners', async () => {
    const value = fixture(); const { controller, owners } = value;
    try {
      controller.resize(60, 12); await enter(value);
      expect(controller.getSnapshot()).toMatchObject({ following: true, selectedId: 'old-2' });
      owners[0].publish(page('old-0', 'old-1', 'old-2', 'new-3'));
      expect(controller.getSnapshot()).toMatchObject({ selectedId: 'new-3', scrollOffset: 1 });
      controller.handleKey({ name: 'up' });
      expect(controller.getSnapshot()).toMatchObject({ following: false, selectedId: 'old-2' });
      expect(owners[0].request.signal.aborted).toBe(true);
      owners[0].publish(page('late-update'));
      expect(controller.getSnapshot().selectedId).toBe('old-2');
      controller.handleKey({ name: 'end' });
      expect(owners).toHaveLength(2);
      expect(owners[1].request.signal).not.toBe(owners[0].request.signal);
      expect(controller.getSnapshot()).toMatchObject({ following: true, selectedId: 'new-3' });
      controller.handleKey({ name: ' ' });
      expect(controller.getSnapshot().following).toBe(false);
      expect(owners[1].request.signal.aborted).toBe(true);
    } finally { controller.dispose(); }
  });

  it('suspends observation outside the list, preserves intent, and continues following through zero text matches', async () => {
    const value = fixture(); const { controller, owners } = value;
    try {
      await enter(value); controller.handleKey({ name: 'd' });
      expect(owners[0].request.signal.aborted).toBe(true);
      expect(controller.getSnapshot()).toMatchObject({ mode: 'detail', following: true });
      owners[0].publish(page('late-detail'));
      expect(controller.getSnapshot().detail?.fields).toContainEqual({ label: '完整行', value: 'old-2' });
      controller.handleKey({ name: 'escape' }); expect(owners).toHaveLength(2);
      controller.handleKey({ name: '?' }); expect(owners[1].request.signal.aborted).toBe(true);
      controller.handleKey({ name: 'escape' }); expect(owners).toHaveLength(3);
      controller.handleKey({ name: '/' }); expect(owners[2].request.signal.aborted).toBe(true);
      controller.handleKey({ name: 'text', text: 'matching' }); controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot()).toMatchObject({ rows: [], following: true });
      expect(owners).toHaveLength(4);
      owners[3].publish(page('unrelated', 'matching-complete-line'));
      expect(controller.getSnapshot()).toMatchObject({ selectedId: 'matching-complete-line', following: true });
      expect(controller.getSnapshot().rows).toHaveLength(1);
    } finally { controller.dispose(); }
  });

  it('reopens on manual refresh and releases every observation on cancellation, navigation and disposal', async () => {
    const value = fixture(); const { controller, owners, onExit } = value;
    try {
      await enter(value); value.setPage(page('refreshed'));
      await controller.refresh();
      expect(owners[0].request.signal.aborted).toBe(true);
      expect(owners).toHaveLength(2);
      owners[0].publish(page('late-before-reopen'));
      expect(controller.getSnapshot().rows[0].id).toBe('refreshed');
      controller.handleKey({ name: 'c', ctrl: true });
      expect(owners[1].request.signal.aborted).toBe(true);
      expect(controller.getSnapshot().following).toBe(false); expect(onExit).not.toHaveBeenCalled();
      controller.handleKey({ name: 'c', ctrl: true }); expect(onExit).toHaveBeenCalledOnce();
      controller.handleKey({ name: ' ' }); expect(owners).toHaveLength(3);
      command(controller, 'ctx'); expect(owners[2].request.signal.aborted).toBe(true);
      owners[2].publish(page('late-after-route'));
      expect(controller.getSnapshot().route.resourceId).toBe('ctx');
      controller.handleKey({ name: 'escape' }); expect(owners).toHaveLength(4);
      controller.dispose(); expect(owners[3].request.signal.aborted).toBe(true);
      owners[3].publish(page('late-after-dispose'));
      expect(controller.getSnapshot().rows[0].id).toBe('refreshed');
    } finally { controller.dispose(); }
  });

  it('offers follow only for a capable page and honors sortable:false for any resource', async () => {
    const value = fixture(); const { controller, owners, registry } = value;
    try {
      value.setPage({ ...page('snapshot-only'), canFollow: false }); command(controller, 'logs');
      await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
      expect(owners).toEqual([]);
      expect(controller.getSnapshot().actions.find((entry) => entry.id === 'follow')).toMatchObject({ enabled: false });
      expect(registry.actions('logs', 'list').some((entry) => entry.id === 'sort')).toBe(false);
      const future = createResourceRegistry([{ id: 'future', label: '未来流', aliases: [], description: '', columns: [], actions: [], sortable: false }]);
      expect(future.actions('future', 'list').some((entry) => entry.id === 'sort')).toBe(false);
      expect(future.actions('future', 'detail').some((entry) => entry.id === 'sort')).toBe(false);
    } finally { controller.dispose(); }
  });

  it('exits from a suspended input without starting a new observer merely to cancel it', async () => {
    const value = fixture(); const { controller, owners, onExit } = value;
    try {
      await enter(value); controller.handleKey({ name: '/' });
      expect(owners[0].request.signal.aborted).toBe(true);
      controller.handleKey({ name: 'text', text: 'draft' });
      controller.handleKey({ name: 'c', ctrl: true });
      expect(onExit).toHaveBeenCalledOnce();
      expect(owners).toHaveLength(1);
      expect(controller.getSnapshot()).toMatchObject({ mode: 'list', filter: '' });
    } finally { controller.dispose(); }
  });

  it('keeps following paused after cancelling an uncooperative manual read and ignores its late result', async () => {
    const value = fixture(); const { controller, owners, read, onExit } = value;
    let finishRead: ((page: TuiPage) => void) | undefined;
    try {
      await enter(value);
      read.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
      const pending = controller.refresh();
      expect(owners[0].request.signal.aborted).toBe(true);
      expect(controller.getSnapshot().loading).toBe(true);
      controller.handleKey({ name: 'c', ctrl: true });
      await pending;
      expect(controller.getSnapshot()).toMatchObject({ following: false, loading: false, completeness: 'cancelled' });
      expect(owners).toHaveLength(1);
      expect(onExit).not.toHaveBeenCalled();
      finishRead?.(page('late-read'));
      await Promise.resolve();
      expect(controller.getSnapshot().rows.map((row) => row.id)).toEqual(['old-0', 'old-1', 'old-2']);
    } finally { controller.dispose(); }
  });
});
