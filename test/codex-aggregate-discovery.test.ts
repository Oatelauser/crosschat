import { describe, expect, it, vi } from 'vitest';
import type { CodexSession } from '../src/codex/client.js';
import type { DesktopMetadataRow } from '../src/codex/desktop-metadata.js';
import type { DesktopThreadSession } from '../src/codex/desktop-ipc.js';
import { listCodexThreadPage } from '../src/codex/aggregate-discovery.js';
import { createCodexSessionReader } from '../src/application/sessions/codex-reader.js';
import { listCodexThreads } from '../src/codex/discovery.js';

const metadata = (id: string, name: string | null = null): DesktopMetadataRow => ({ id, name, cwd: '/fixture', source: 'vscode', originator: 'Codex Desktop', createdAtMs: 1, updatedAtMs: 2, recencyAtMs: 3 });
function desktop(id: string): DesktopThreadSession {
  return { threadId: id, ownerId: `owner/${id}`, snapshot: vi.fn(async () => ({ id, name: 'ignored snapshot name', cwd: '/fixture', rawStatus: { type: 'future-runtime' }, activeTurnId: null, idle: false, revision: 1 })),
    startTurn: vi.fn(async () => 'never'), steerTurn: vi.fn(async () => 'never'), close: vi.fn(async () => undefined) };
}
function cli(): CodexSession {
  return { initialize: vi.fn(async () => undefined), listThreads: vi.fn(async () => []), listThreadPage: vi.fn(async () => ({ data: [], nextCursor: null })),
    resumeThread: vi.fn(async () => 'idle'), startTurn: vi.fn(async () => ({ id: 'never', status: 'inProgress' })), steerTurn: vi.fn(async () => 'never'),
    unsubscribe: vi.fn(async () => undefined), startThread: vi.fn(async () => 'never'), deleteThread: vi.fn(async () => undefined), notifications: () => [], close: vi.fn(async () => undefined) };
}

describe('read-only Desktop and CLI aggregate discovery', () => {
  it('finds Desktop names with opaque IDs while the CLI is unavailable and requires a live owner', async () => {
    const live = desktop('native/opaque id');
    const openThread = vi.fn(async (id: string) => id === live.threadId ? live : null);
    const options = { sessionFactory: async () => { throw new Error('CLI down'); }, desktop: {
      listMetadata: vi.fn(async () => ({ data: [metadata(live.threadId, '测试会话'), metadata('stale', 'closed')], nextCursor: null, completeness: 'complete' as const, observedAt: 1 })), openThread,
    } };
    const first = await listCodexThreadPage(options);
    expect(first.data).toMatchObject([{ id: live.threadId, name: '测试会话', rawStatus: { type: 'future-runtime' }, attributes: { transport: 'desktop' } }]);
    const last = await listCodexThreadPage({ ...options, cursor: first.nextCursor ?? undefined });
    expect(last).toMatchObject({ completeness: 'partial', nextCursor: null, errors: [expect.objectContaining({ source: 'cli', kind: 'unavailable' })] });
    expect(live.close).toHaveBeenCalledOnce();
    expect(live.startTurn).not.toHaveBeenCalled();
    expect(live.steerTurn).not.toHaveBeenCalled();
  });

  it('merges pages without duplicate IDs and retains anonymous sessions and native raw status', async () => {
    const session = cli();
    session.listThreadPage = vi.fn(async ({ cursor }) => cursor === undefined
      ? { data: [{ id: 'shared', name: 'CLI duplicate', rawStatus: { type: 'idle' }, attributes: {} }], nextCursor: 'cli-2' }
      : { data: [{ id: 'cli-only', name: null, rawStatus: { type: 'new-state' }, attributes: {} }], nextCursor: null });
    const listMetadata = vi.fn(async ({ cursor }: { cursor?: string }) => ({ data: [metadata(cursor === undefined ? 'shared' : 'desktop-only')], nextCursor: cursor === undefined ? 'desktop-2' : null, completeness: 'complete' as const, observedAt: 1 }));
    const reader = createCodexSessionReader({ sessionFactory: async () => session, desktop: { listMetadata, openThread: async (id) => desktop(id) }, now: () => 12 });
    let cursor: string | undefined;
    const ids: string[] = [];
    do {
      const page = await reader.list({ contextId: 'local', cursor, limit: 1 });
      ids.push(...page.items.map((item) => item.ref.nativeId));
      expect(page.observedAt).toBe(12);
      expect(page.errors).toEqual([]);
      if (page.nextCursor === null) expect(page.completeness).toBe('complete');
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    expect(ids).toEqual(['shared', 'desktop-only', 'cli-only']);
    expect(session.resumeThread).not.toHaveBeenCalled();
    expect(session.startTurn).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledTimes(2);
  });

  it('binds aggregate cursors to context and rejects repeating native metadata cursors', async () => {
    const session = cli();
    const listMetadata = vi.fn(async () => ({ data: [], nextCursor: 'repeat', completeness: 'partial' as const, observedAt: 1 }));
    const reader = createCodexSessionReader({ sessionFactory: async () => session, desktop: { listMetadata, openThread: async () => null } });
    const first = await reader.list({ contextId: 'local' });
    const otherContext = await reader.list({ contextId: 'ssh:other', cursor: first.nextCursor ?? undefined });
    expect(otherContext.errors).toContainEqual(expect.objectContaining({ kind: 'invalid-cursor' }));
    expect(listMetadata).toHaveBeenCalledOnce();
    const repeated = await reader.list({ contextId: 'local', cursor: first.nextCursor ?? undefined });
    expect(repeated.errors).toContainEqual(expect.objectContaining({ kind: 'malformed' }));
    expect(repeated.completeness).toBe('partial');
  });

  it('cancels owner probes promptly and closes sessions acquired after cancellation', async () => {
    const controller = new AbortController();
    const session = desktop('late');
    let finish: ((value: DesktopThreadSession) => void) | undefined;
    const request = listCodexThreadPage({ signal: controller.signal, sessionFactory: async () => cli(), desktop: {
      listMetadata: async () => ({ data: [metadata('late')], nextCursor: null, completeness: 'complete', observedAt: 1 }),
      openThread: () => new Promise((resolve) => { finish = resolve; }),
    } });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    finish?.(session);
    await vi.waitFor(() => expect(session.close).toHaveBeenCalledOnce());
    expect(session.snapshot).not.toHaveBeenCalled();
  });

  it('keeps the legacy aggregate total at 20 and uses the original CLI limit-20 operation', async () => {
    const session = cli();
    session.listThreads = vi.fn(async () => Array.from({ length: 20 }, (_, i) => ({ id: `cli/${i}`, name: null, status: 'idle' as const })));
    const rows = await listCodexThreads({ sessionFactory: async () => session, codexHome: '/isolated-fixture', desktop: {
      listMetadata: async () => ({ data: [metadata('desktop', 'visible')], nextCursor: null, completeness: 'complete', observedAt: 1 }), openThread: async (id) => desktop(id),
    } });
    expect(rows).toHaveLength(20);
    expect(rows[0]).toMatchObject({ id: 'desktop', name: 'visible' });
    expect(session.listThreads).toHaveBeenCalledOnce();
    expect(session.listThreadPage).not.toHaveBeenCalled();
  });

  it('reports a metadata failure while retaining a successful CLI result', async () => {
    const session = cli();
    session.listThreadPage = vi.fn(async () => ({ data: [{ id: 'cli', name: null, rawStatus: { type: 'new-status' }, attributes: {} }], nextCursor: null }));
    const page = await listCodexThreadPage({ sessionFactory: async () => session, desktop: {
      listMetadata: async () => { throw new Error('database unavailable'); }, openThread: vi.fn(async () => null),
    } });
    expect(page).toMatchObject({ data: [{ id: 'cli' }], completeness: 'partial', errors: [{ source: 'desktop', kind: 'unavailable' }] });
    expect(session.close).toHaveBeenCalledOnce();
  });

  it('limits owner-probe concurrency and closes a session after a failed snapshot', async () => {
    let active = 0, maximum = 0;
    const sessions: DesktopThreadSession[] = [];
    const page = await listCodexThreadPage({ sessionFactory: async () => cli(), limit: 12, desktop: {
      listMetadata: async () => ({ data: Array.from({ length: 12 }, (_, i) => metadata(`native/${i}`)), nextCursor: null, completeness: 'complete', observedAt: 1 }),
      concurrency: 3,
      openThread: async (id) => {
        maximum = Math.max(maximum, ++active);
        await new Promise((resolve) => setImmediate(resolve));
        active--;
        const session = desktop(id);
        if (id === 'native/2') session.snapshot = vi.fn(async () => { throw new Error('owner lost'); });
        sessions.push(session);
        return session;
      },
    } });
    expect(maximum).toBe(3);
    expect(page.data).toHaveLength(11);
    expect(page.errors).toEqual([{ source: 'desktop', kind: 'unavailable' }]);
    for (const session of sessions) expect(session.close).toHaveBeenCalledOnce();
  });

  it('retains an explicitly incomplete metadata source through the final CLI page', async () => {
    const options = { sessionFactory: async () => cli(), desktop: {
      listMetadata: async () => ({ data: [metadata('only-known')], nextCursor: null, completeness: 'partial' as const, observedAt: 1 }), openThread: async (id: string) => desktop(id),
    } };
    const first = await listCodexThreadPage(options);
    const last = await listCodexThreadPage({ ...options, cursor: first.nextCursor ?? undefined });
    expect(last).toMatchObject({ completeness: 'partial', errors: [{ source: 'desktop', kind: 'legacy-limit' }] });
  });

  it('closes an in-flight CLI page on cancellation even when the injected page ignores the signal', async () => {
    const controller = new AbortController();
    const session = cli();
    session.listThreadPage = vi.fn(async () => new Promise(() => undefined));
    const reader = createCodexSessionReader({ sessionFactory: async () => session, desktop: {
      listMetadata: async () => ({ data: [], nextCursor: null, completeness: 'complete', observedAt: 1 }), openThread: async () => null,
    } });
    const request = reader.list({ contextId: 'local', signal: controller.signal });
    await vi.waitFor(() => expect(session.listThreadPage).toHaveBeenCalledOnce());
    controller.abort();
    expect(await request).toMatchObject({ completeness: 'cancelled', items: [] });
    await vi.waitFor(() => expect(session.close).toHaveBeenCalledOnce(), { timeout: 100 });
  });

  it('preserves the legacy CLI-unavailable failure when no live Desktop thread is found', async () => {
    await expect(listCodexThreads({ codexHome: '/isolated-fixture', sessionFactory: async () => { throw new Error('CLI down'); }, desktop: {
      listMetadata: async () => ({ data: [metadata('stale')], nextCursor: null, completeness: 'complete', observedAt: 1 }), openThread: async () => null,
    } })).rejects.toMatchObject({ code: 'CODEX_PROXY_SPAWN_FAILED' });
  });

  it('keeps ordinary injected protocol-code errors unavailable in the aggregate summary', async () => {
    const page = await listCodexThreadPage({ sessionFactory: async () => cli(), desktop: {
      listMetadata: async () => ({ data: [metadata('native', 'worker')], nextCursor: null, completeness: 'complete', observedAt: 1 }),
      openThread: async () => { throw Object.assign(new Error('private detail'), { code: 'CUSTOM_PROTOCOL_FAILURE' }); },
    } });
    expect(page).toMatchObject({ completeness: 'partial', errors: [{ source: 'desktop', kind: 'unavailable' }] });
  });
});
