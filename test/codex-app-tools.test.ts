import { describe, expect, it, vi } from 'vitest';
import { deliverAppToolsMessage, listAppToolsThreads, readAppToolsThread } from '../src/codex/app-tools.js';
import type { AppToolsInvoker } from '../src/codex/app-tools.js';

const target = 'native/opaque target';
const steer = { mode: 'steer' as const, endpointType: 'desktop' };
const mcp = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false });
const listed = (id = target, status = 'idle') => ({ id, kind: 'codex', hostId: 'local', title: '工作会话', status });
const metadata = (status: unknown = { type: 'idle' }) => ({ schemaVersion: 1, thread: { ...listed(), status }, turns: [] });

describe('Codex Desktop app tools reads', () => {
  it('reads complete local history, including an empty intermediate page and anonymous opaque IDs', async () => {
    const invoke = vi.fn<AppToolsInvoker>()
      .mockResolvedValueOnce(mcp({ threads: [listed('first', 'active')], nextCursor: 'cursor/1' }))
      .mockResolvedValueOnce(mcp({ threads: [], nextCursor: 'cursor/2' }))
      .mockResolvedValueOnce(mcp({ threads: [{ ...listed('last', 'notLoaded'), title: null }], nextCursor: null }));
    expect(await listAppToolsThreads(invoke)).toEqual([
      { id: 'first', endpointType: 'desktop', name: '工作会话', status: 'busy' },
      { id: 'last', endpointType: 'desktop', name: null, status: 'not_loaded' },
    ]);
    expect(invoke.mock.calls).toEqual([
      ['list_threads', { mode: 'history', source: 'codex', hostId: 'local', archived: false, limit: 50 }],
      ['list_threads', { mode: 'history', source: 'codex', hostId: 'local', archived: false, limit: 50, cursor: 'cursor/1' }],
      ['list_threads', { mode: 'history', source: 'codex', hostId: 'local', archived: false, limit: 50, cursor: 'cursor/2' }],
    ]);
  });

  it('does not mistake an unreadable later page for a complete list', async () => {
    const invoke = vi.fn<AppToolsInvoker>()
      .mockResolvedValueOnce(mcp({ threads: [listed()], nextCursor: 'next' }))
      .mockRejectedValueOnce(new Error('host unavailable'));
    await expect(listAppToolsThreads(invoke)).rejects.toMatchObject({ code: 'CODEX_APP_TOOLS_UNAVAILABLE' });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it.each([
    { threads: [] },
    { threads: [], nextCursor: '' },
    { threads: [], nextCursor: 1 },
    { threads: [listed(target, 'future-status')], nextCursor: null },
    { threads: [{ ...listed(), kind: 'chatgpt' }], nextCursor: null },
    { threads: [{ ...listed(), hostId: 'remote' }], nextCursor: null },
    { threads: [{ ...listed(), title: 1 }], nextCursor: null },
    { threads: [{ ...listed(), id: '' }], nextCursor: null },
    { threads: [listed(), listed()], nextCursor: null },
  ])('rejects incomplete, unknown, or mismatched history data', async (value) => {
    await expect(listAppToolsThreads(async () => mcp(value))).rejects.toMatchObject({ code: 'CODEX_APP_TOOLS_PROTOCOL_ERROR' });
  });

  it('rejects cyclic pagination instead of returning a prefix', async () => {
    const invoke = vi.fn<AppToolsInvoker>()
      .mockResolvedValueOnce(mcp({ threads: [], nextCursor: 'first' }))
      .mockResolvedValueOnce(mcp({ threads: [], nextCursor: 'second' }))
      .mockResolvedValueOnce(mcp({ threads: [], nextCursor: 'first' }));
    await expect(listAppToolsThreads(invoke)).rejects.toMatchObject({ code: 'CODEX_APP_TOOLS_PROTOCOL_ERROR' });
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it('bounds never-ending pagination without claiming completeness', async () => {
    let page = 0;
    const invoke = vi.fn<AppToolsInvoker>(async () => mcp({ threads: [], nextCursor: `page/${page++}` }));
    await expect(listAppToolsThreads(invoke)).rejects.toMatchObject({ code: 'CODEX_DISCOVERY_INCOMPLETE' });
    expect(invoke.mock.calls.length).toBeLessThanOrEqual(100);
  });

  it('reads only metadata for the exact local thread and preserves the native title', async () => {
    const invoke = vi.fn<AppToolsInvoker>(async () => mcp(metadata({ type: 'active', activeFlags: ['waitingOnUserInput'] })));
    expect(await readAppToolsThread(invoke, target)).toEqual({
      id: target, endpointType: 'desktop', name: '工作会话', status: 'waiting_approval',
    });
    expect(invoke.mock.calls).toEqual([['read_thread', { threadId: target, hostId: 'local', includeTurns: false }]]);
  });

  it.each([
    { schemaVersion: 1, thread: { ...listed('another'), status: { type: 'idle' } } },
    { schemaVersion: 1, thread: { ...listed(), hostId: 'remote', status: { type: 'idle' } } },
    { schemaVersion: 1, thread: { ...listed(), kind: 'chatgpt', status: { type: 'idle' } } },
    { schemaVersion: 1, thread: { ...listed(), title: undefined, status: { type: 'idle' } } },
    metadata('idle'),
    metadata({ type: 'future-status' }),
    metadata({ type: 'active' }),
    metadata({ type: 'active', activeFlags: 'waitingOnApproval' }),
    metadata({ type: 'active', activeFlags: [42] }),
    metadata({ type: 'active', activeFlags: ['futureFlag'] }),
  ])('rejects invalid or ambiguous metadata evidence', async (value) => {
    await expect(readAppToolsThread(async () => mcp(value), target)).rejects.toMatchObject({ code: 'CODEX_APP_TOOLS_PROTOCOL_ERROR' });
  });

  it.each([
    undefined,
    { content: [], isError: false },
    { content: [{ type: 'text', text: '{' }], isError: false },
    { content: [{ type: 'image', text: '{}' }], isError: false },
    { content: [{ type: 'text', text: '{}' }, { type: 'text', text: '{}' }], isError: false },
    { ...mcp(metadata()), isError: 'false' },
  ])('validates the raw MCP envelope before trusting JSON', async (response) => {
    await expect(readAppToolsThread(async () => response, target)).rejects.toMatchObject({ code: 'CODEX_APP_TOOLS_PROTOCOL_ERROR' });
  });

  it('reports an explicit tool read rejection without including private response text', async () => {
    const invoke = vi.fn<AppToolsInvoker>(async () => ({ content: [{ type: 'text', text: 'PRIVATE ERROR' }], isError: true }));
    const error = await readAppToolsThread(invoke, target).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'CODEX_APP_TOOLS_REJECTED' });
    expect(String(error)).not.toContain('PRIVATE ERROR');
  });
});

describe('Codex Desktop app tools delivery', () => {
  it.each([{ type: 'idle' }, { type: 'active', activeFlags: [] }, { type: 'notLoaded' }])(
    'lets the native host wake or steer its existing thread without inventing a turn ID', async (status) => {
      const invoke = vi.fn<AppToolsInvoker>()
        .mockResolvedValueOnce(mcp(metadata(status)))
        .mockResolvedValueOnce(mcp({ threadId: target }));
      expect(await deliverAppToolsMessage(invoke, target, '完整信封\n"body"', steer)).toEqual({ status: 'accepted', queued: false });
      expect(invoke.mock.calls).toEqual([
        ['read_thread', { threadId: target, hostId: 'local', includeTurns: false }],
        ['send_message_to_thread', { threadId: target, hostId: 'local', prompt: '完整信封\n"body"' }],
      ]);
    },
  );

  it.each([
    {},
    { mode: 'queue' as const, endpointType: 'desktop' },
    { mode: 'steer' as const },
    { mode: 'steer' as const, endpointType: 'cli' },
  ])('rejects unsupported delivery intent before any host call', async (options) => {
    const invoke = vi.fn<AppToolsInvoker>();
    await expect(deliverAppToolsMessage(invoke, target, 'body', options)).rejects.toBeInstanceOf(Error);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    [{ type: 'active', activeFlags: ['waitingOnApproval'] }, 'CODEX_APPROVAL_REQUIRED'],
    [{ type: 'active', activeFlags: ['waitingOnUserInput'] }, 'CODEX_APPROVAL_REQUIRED'],
    [{ type: 'systemError' }, 'CODEX_APP_TOOLS_PROTOCOL_ERROR'],
    [{ type: 'future-status' }, 'CODEX_APP_TOOLS_PROTOCOL_ERROR'],
    [{ type: 'active', activeFlags: ['futureFlag'] }, 'CODEX_APP_TOOLS_PROTOCOL_ERROR'],
  ])('does not use a follow-up to bypass approval or an unrecognized state', async (status, code) => {
    const invoke = vi.fn<AppToolsInvoker>(async () => mcp(metadata(status)));
    await expect(deliverAppToolsMessage(invoke, target, 'body', steer)).rejects.toMatchObject({ code });
    expect(invoke.mock.calls.map(([tool]) => tool)).toEqual(['read_thread']);
  });

  it.each([
    mcp({ threadId: 'wrong-thread' }),
    mcp({}),
    mcp({ threadId: '', turnId: 'not-a-receipt' }),
    { content: [{ type: 'text', text: 'Rejected by the host' }], isError: true },
    { content: [{ type: 'text', text: 'not JSON' }], isError: false },
  ])('marks an unverified write outcome uncertain and never retries', async (response) => {
    const invoke = vi.fn<AppToolsInvoker>()
      .mockResolvedValueOnce(mcp(metadata()))
      .mockResolvedValueOnce(response);
    await expect(deliverAppToolsMessage(invoke, target, 'body', steer)).rejects.toMatchObject({ code: 'CODEX_WRITE_UNCERTAIN' });
    expect(invoke.mock.calls.map(([tool]) => tool)).toEqual(['read_thread', 'send_message_to_thread']);
  });

  it.each([new Error('disconnected'), new DOMException('cancelled', 'AbortError')])(
    'keeps an interrupted host send uncertain with its original cause', async (cause) => {
      const invoke = vi.fn<AppToolsInvoker>()
        .mockResolvedValueOnce(mcp(metadata()))
        .mockRejectedValueOnce(cause);
      await expect(deliverAppToolsMessage(invoke, target, 'body', steer)).rejects.toMatchObject({ code: 'CODEX_WRITE_UNCERTAIN', cause });
      expect(invoke).toHaveBeenCalledTimes(2);
    },
  );

  it('validates input before querying and never passes empty content to the host', async () => {
    const invoke = vi.fn<AppToolsInvoker>();
    await expect(deliverAppToolsMessage(invoke, '', 'body', steer)).rejects.toBeInstanceOf(Error);
    await expect(deliverAppToolsMessage(invoke, target, ' \n ', steer)).rejects.toBeInstanceOf(Error);
    expect(invoke).not.toHaveBeenCalled();
  });
});
