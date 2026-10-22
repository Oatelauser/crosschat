import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedLogResult } from '../src/application/observations/logs.js';
import type { TuiReadRequest } from '../src/tui/model.js';

const request = (): TuiReadRequest => ({ context: { id: 'local', kind: 'local', label: 'fixture' }, route: { resourceId: 'logs', contextId: 'local' }, signal: new AbortController().signal });
function result(): ManagedLogResult {
  return { items: [{ id: 'full/line/identity', offset: 0, text: '完整日志👩‍💻'.repeat(100), terminated: true }],
    completeness: 'complete', observedAt: 42, errors: [], bytesRead: 100, truncated: false, omittedLeadingLine: false, rotated: false,
    source: { id: 'send-log', label: '投递日志', path: '/fixture/send-log.jsonl' },
    sources: [{ id: 'send-log', label: '投递日志', path: '/fixture/send-log.jsonl' }, { id: 'broker', label: 'broker日志', path: '/fixture/tcp/broker.log' }] };
}
afterEach(() => vi.useRealTimers());

describe('TUI log resource', () => {
  it('registers complete readonly controls and a route chooser, keeping full details and copy values', async () => {
    const { createLogsResource } = await import('../src/tui/resources/logs.js');
    const read = vi.fn(async () => result());
    const { resource, adapter } = createLogsResource({ read });
    const page = await adapter.read(request());
    expect(resource.sortable).toBe(false);
    expect(resource.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'source', shortcut: 't', kind: 'route-choice' }),
      expect.objectContaining({ shortcut: 'Space', kind: 'follow' }),
      expect.objectContaining({ id: 'read-summary', shortcut: 'i', selectionPolicy: 'none' }),
    ]));
    expect(resource.actions.every((action) => !action.mutation)).toBe(true);
    expect(page.canFollow).toBe(true);
    expect(page.rows[0]).toMatchObject({ id: 'full/line/identity', copyValue: result().items[0].text });
    expect(page.rows[0].detail).toContainEqual({ label: '完整日志行', value: result().items[0].text });
    expect(page.routeChoices?.source.options[1].route).toEqual({ resourceId: 'logs', contextId: 'local', query: { source: 'broker' } });
  });

  it('rejects remote, missing contexts and malformed exact scopes without falling back to local reads', async () => {
    const { createLogsResource } = await import('../src/tui/resources/logs.js');
    const read = vi.fn(async () => result());
    const { adapter } = createLogsResource({ read });
    for (const input of [
      { ...request(), context: undefined },
      { ...request(), context: { id: 'ssh:fixture', kind: 'ssh', label: 'fixture' } },
      { ...request(), route: { resourceId: 'logs', contextId: 'local', query: { sessionRef: '{broken' } } },
    ]) expect((await adapter.read(input)).completeness).toBe('unavailable');
    expect(read).not.toHaveBeenCalled();
  });

  it('owns bounded polling, awaits one read at a time and cancels even uncooperative pending work', async () => {
    const { createLogsResource } = await import('../src/tui/resources/logs.js');
    vi.useFakeTimers();
    const controller = new AbortController();
    let pendingSignal: AbortSignal | undefined;
    const read = vi.fn(async (input) => {
      pendingSignal = input.signal;
      if (read.mock.calls.length > 1) return new Promise<ManagedLogResult>(() => undefined);
      return result();
    });
    const { adapter } = createLogsResource({ read, intervalMs: 1000 });
    const publish = vi.fn();
    const active = adapter.watch!({ ...request(), signal: controller.signal }, publish);
    await vi.advanceTimersByTimeAsync(1000);
    expect(publish).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(read).toHaveBeenCalledTimes(2);
    controller.abort(); await active;
    expect(pendingSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(publish).toHaveBeenCalledOnce();
  });
});
