import { describe, expect, it, vi } from 'vitest';
import type { CommunicationSummary, OutboxThreadMetadata } from '../src/application/observations/communications.js';
import { createCommunicationResources } from '../src/tui/resources/communications.js';
import { encodeRef } from '../src/ref.js';

const context = { id: 'local', label: '本机', kind: 'local' };
const sessionRef = { contextId: 'local', providerId: 'codex', nativeId: 'full-thread-id' };
const pairId = 'claude:sender-full-id\ncodex:full-thread-id';
const savedRef = encodeRef({ v: 1, f: { p: 'claude', id: 'sender-full-id' }, t: { p: 'codex', id: 'full-thread-id' }, n: '01020304', c: 3 });
const item: CommunicationSummary = { id: 'communication-full-id', contextId: 'local', pairId, endpoints: ['claude:sender-full-id', 'codex:full-thread-id'], names: ['同名', '同名'], ref: null, updatedAt: 100, channel: 'local', turn: 3, status: 'queued', receipt: 'unconfirmed', parked: 2, localSessionRefs: [sessionRef] };
const queue: OutboxThreadMetadata = { id: 'queue-full-id', contextId: 'local', providerId: 'codex', threadId: 'full-thread-id', toName: '同名', count: 2, oldestParkedAt: 100, mailboxFile: 'D:/fixture/mailbox/full-thread-id.md', state: 'ready', items: [{ id: 'item-one', parkedAt: 100, attempts: 2, toName: '同名', callerKey: 'claude:sender-full-id', deliveryState: 'uncertain' }, { id: 'item-two', parkedAt: 110, attempts: 0, toName: '同名', callerKey: 'claude:sender-full-id', deliveryMode: 'queue' }] };
function resources(communicationItems = [item], queueItems = [queue]) {
  const readCommunications = vi.fn(async () => ({ items: communicationItems, completeness: 'complete' as const, observedAt: 500, errors: [] }));
  const readOutbox = vi.fn(async () => ({ items: queueItems, completeness: 'complete' as const, observedAt: 500, errors: [] }));
  return { ...createCommunicationResources({ readCommunications, readOutbox }), readCommunications, readOutbox };
}
const request = () => ({ context, signal: new AbortController().signal });

describe('read-only TUI communication resources', () => {
  it('renders audit facts, full metadata and exact routes without describing task completion or permitting resend', async () => {
    const factory = resources();
    const page = await factory.deliveries.adapter.read(request());
    expect(page.rows[0]).toMatchObject({ id: item.id, cells: { name: '同名 → 同名', status: '已排队<queued>' }, actionRoutes: { outbox: { resourceId: 'outbox', contextId: 'local', query: { pairId } }, logs: { resourceId: 'logs', contextId: 'local', query: { source: 'send-log', pairId } } } });
    expect(JSON.stringify(page)).toContain('不代表任务完成');
    expect(page.rows[0].actionAvailability?.copy).toMatchObject({ enabled: false, reason: expect.any(String) });
    expect(factory.deliveries.resource.actions.every((action) => !action.mutation)).toBe(true);
    expect(factory.deliveries.adapter.mutate).toBeUndefined();
    expect(factory.deliveries.resource.actions).toContainEqual(expect.objectContaining({ shortcut: 'i', viewId: 'read-summary', selectionPolicy: 'none' }));
  });

  it('copies only existing full refs and mailbox paths and never manufactures a continuation handle', async () => {
    const factory = resources([{ ...item, ref: savedRef }]);
    const delivery = await factory.deliveries.adapter.read(request());
    expect(delivery.rows[0].copyValue).toBe(savedRef);
    const outbox = await factory.outbox.adapter.read(request());
    expect(outbox.rows[0].copyValue).toBe(queue.mailboxFile);
    expect(outbox.rows[0].actionRoutes?.deliveries).toMatchObject({ resourceId: 'deliveries', contextId: 'local', query: { pairId } });
    expect(outbox.rows[0].actionAvailability?.logs).toMatchObject({ enabled: false, reason: expect.stringMatching(/看门狗|watchdog/) });
    expect(JSON.stringify(outbox)).toContain('待核实');
  });

  it('filters related resources by complete local SessionRef rather than names or short native prefixes', async () => {
    const collision = { ...item, id: 'other-communication', localSessionRefs: [{ ...sessionRef, nativeId: 'full-thread-id-other' }] };
    const factory = resources([item, collision], [queue, { ...queue, id: 'other-queue', threadId: 'full-thread-id-other' }]);
    const route = { resourceId: 'deliveries', contextId: 'local', query: { sessionRef: JSON.stringify(sessionRef) } };
    expect((await factory.deliveries.adapter.read({ ...request(), route })).rows.map((row) => row.id)).toEqual([item.id]);
    expect((await factory.outbox.adapter.read({ ...request(), route: { ...route, resourceId: 'outbox' } })).rows.map((row) => row.id)).toEqual([queue.id]);
    const third = { ...sessionRef, providerId: 'future-tool' };
    expect((await factory.deliveries.adapter.read({ ...request(), route: { ...route, query: { sessionRef: JSON.stringify(third) } } })).rows).toEqual([]);
  });

  it('does not expose unrelated records for invalid, cross-context or process scopes', async () => {
    const factory = resources();
    for (const value of ['{bad', JSON.stringify({ ...sessionRef, contextId: 'ssh:remote' }), JSON.stringify({ ...sessionRef, referenceKind: 'process' })]) {
      const page = await factory.deliveries.adapter.read({ ...request(), route: { resourceId: 'deliveries', contextId: 'local', query: { sessionRef: value } } });
      expect(page.rows).toEqual([]);
      expect(page.completeness).toBe('unavailable');
    }
    expect(factory.readCommunications).not.toHaveBeenCalled();
  });

  it('keeps pair-scoped queue counts and related routes within the exact selected communication pair', async () => {
    const mixedQueue = { ...queue, count: 3, items: [...queue.items, { ...queue.items[0], id: 'other-sender', callerKey: 'claude:neighbor-full-id' }] };
    const factory = resources([item], [mixedQueue]);
    const page = await factory.outbox.adapter.read({ ...request(), route: { resourceId: 'outbox', contextId: 'local', query: { pairId } } });
    expect(page.rows[0].cells.count).toBe('2');
    expect(page.rows[0].actionRoutes?.deliveries).toMatchObject({ query: { pairId } });
    expect(JSON.stringify(page.rows[0].detail)).not.toContain('neighbor-full-id');
    expect(JSON.stringify(page.rows[0].detail)).toContain('3');
  });

  it('retains an unknown oversized queue when its complete target matches the scoped pair instead of hiding it', async () => {
    const factory = resources([item], [{ ...queue, count: null, items: [], oldestParkedAt: null, state: 'oversized' }]);
    const page = await factory.outbox.adapter.read({ ...request(), route: { resourceId: 'outbox', contextId: 'local', query: { pairId } } });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].cells.count).toBe('未知');
    expect(JSON.stringify(page.rows[0].detail)).toMatch(/关联.*未知|范围.*核实/);
  });

  it('does not broaden a multi-pair queue into a SessionRef association when stored machine identity is unverified', async () => {
    const mixedQueue = { ...queue, count: 3, items: [...queue.items, { ...queue.items[0], id: 'other-sender', callerKey: 'claude:neighbor-full-id' }] };
    const page = await resources([item], [mixedQueue]).outbox.adapter.read(request());
    expect(page.rows[0].actionAvailability?.deliveries).toMatchObject({ enabled: false, reason: expect.any(String), nextStep: expect.any(String) });
    expect(page.rows[0].actionRoutes?.deliveries).toBeUndefined();
  });

  it('rejects a route bound to a different context instead of applying a local fallback', async () => {
    const factory = resources();
    const page = await factory.deliveries.adapter.read({ ...request(), route: { resourceId: 'deliveries', contextId: 'ssh:elsewhere' } });
    expect(page.completeness).toBe('unavailable');
    expect(factory.readCommunications).not.toHaveBeenCalled();
  });

  it('keeps unknown queue counts distinct from empty and exposes partial sources even on zero matching rows', async () => {
    const factory = createCommunicationResources({
      readCommunications: async () => ({ items: [], completeness: 'partial', observedAt: 500, errors: [{ source: 'fixture/send-log', kind: 'unreadable', message: '审计来源无法读取', nextStep: '核对路径权限' }] }),
      readOutbox: async () => ({ items: [{ ...queue, count: null, oldestParkedAt: null, state: 'oversized', items: [] }], completeness: 'partial', observedAt: 500, errors: [{ source: 'fixture/outbox/huge', kind: 'unavailable', message: '来源超过读取限制', nextStep: '请检查本地文件' }] }),
    });
    const delivery = await factory.deliveries.adapter.read(request());
    expect(delivery.rows).toEqual([]);
    expect(JSON.stringify(delivery.detailViews?.['read-summary'])).toContain('核对路径权限');
    const outbox = await factory.outbox.adapter.read(request());
    expect(outbox.rows[0].cells.count).toBe('未知');
    expect(outbox.completeness).toBe('partial');
    expect(JSON.stringify(outbox.detailViews?.['read-summary'])).toContain('超过读取限制');
  });

  it('requires a local selected context and preserves cancellation without querying real defaults', async () => {
    const factory = resources();
    expect((await factory.deliveries.adapter.read({ signal: new AbortController().signal })).completeness).toBe('unavailable');
    expect((await factory.outbox.adapter.read({ context: { ...context, kind: 'ssh' }, signal: new AbortController().signal })).completeness).toBe('unavailable');
    expect(factory.readCommunications).not.toHaveBeenCalled();
    expect(factory.readOutbox).not.toHaveBeenCalled();
    const owner = new AbortController(); owner.abort();
    expect((await factory.deliveries.adapter.read({ context, signal: owner.signal })).completeness).toBe('cancelled');
    expect(factory.readCommunications).not.toHaveBeenCalled();
  });
});
