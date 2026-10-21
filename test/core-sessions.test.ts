import { describe, expect, it, vi } from 'vitest';
import { SessionCatalog, sessionKey } from '../src/application/sessions/index.js';
import type { Session, SessionReader } from '../src/application/sessions/index.js';

const capabilities = { discovery: true, delivery: false, launch: false, diagnostics: false };

function reader(providerId: string, contextId = 'local'): SessionReader {
  const session: Session = {
    ref: { contextId, providerId, nativeId: 'same/id:opaque' },
    key: sessionKey({ contextId, providerId, nativeId: 'same/id:opaque' }),
    name: null,
    rawStatus: { type: 'third-party-paused', reason: 'needs input' },
    capabilities,
    attributes: { thirdPartyHint: 42 },
  };
  return {
    providerId,
    capabilities,
    async list() {
      return { items: [session], nextCursor: null, completeness: 'complete', errors: [], observedAt: 123 };
    },
    async get() {
      return { item: session, completeness: 'complete', errors: [], observedAt: 123 };
    },
  };
}

describe('core provider-neutral session queries', () => {
  it('keeps opaque IDs isolated by provider and context and retains anonymous names and raw state', async () => {
    const catalog = new SessionCatalog([reader('claude'), reader('codex'), reader('third-provider')], () => 456);
    const result = await catalog.query({ contextId: 'local' });
    expect(result.items).toHaveLength(3);
    expect(new Set(result.items.map((item) => item.key)).size).toBe(3);
    expect(result.items[2]).toMatchObject({ name: null, rawStatus: { type: 'third-party-paused' }, attributes: { thirdPartyHint: 42 } });
    expect(sessionKey({ contextId: 'ssh:another', providerId: 'third-provider', nativeId: 'same/id:opaque' })).not.toBe(result.items[2].key);
    expect(sessionKey({ contextId: 'a:b', providerId: 'c', nativeId: 'd' })).not.toBe(sessionKey({ contextId: 'a', providerId: 'b:c', nativeId: 'd' }));
    expect(result.observedAt).toBe(456);
  });

  it('runs third-provider filtering and detail through the same interfaces', async () => {
    const third = reader('third-provider');
    const catalog = new SessionCatalog([reader('claude'), third]);
    const result = await catalog.query({ contextId: 'local', filter: { providerIds: ['third-provider'], text: 'third-party-paused' } });
    expect(result.items.map((item) => item.ref.providerId)).toEqual(['third-provider']);
    const detail = await catalog.detail({ contextId: 'local', providerId: 'third-provider', nativeId: 'same/id:opaque' });
    expect(detail.item).toEqual(result.items[0]);
  });

  it('retains successful sources when another source rejects and reports the source error', async () => {
    const failing = reader('unreachable-provider');
    failing.list = vi.fn().mockRejectedValue(new Error('offline'));
    const result = await new SessionCatalog([reader('third-provider'), failing]).query({ contextId: 'tcp:star/node' });
    expect(result.items).toHaveLength(1);
    expect(result.completeness).toBe('partial');
    expect(result.errors).toEqual([expect.objectContaining({ source: { contextId: 'tcp:star/node', providerId: 'unreachable-provider' }, kind: 'unavailable' })]);
  });

  it('does not treat a legacy partial page as complete and continues each source independently', async () => {
    const paged = reader('third-provider');
    const list = vi.fn(paged.list);
    list.mockResolvedValueOnce({ items: [], nextCursor: 'opaque/next', completeness: 'partial', observedAt: 1, errors: [] });
    paged.list = list;
    const catalog = new SessionCatalog([paged]);
    const first = await catalog.query({ contextId: 'local', limit: 20 });
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.completeness).toBe('partial');
    const second = await catalog.query({ contextId: 'local', cursor: first.nextCursor ?? undefined, limit: 20 });
    expect(list.mock.calls[1][0]).toMatchObject({ contextId: 'local', cursor: 'opaque/next', limit: 20 });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it('returns cancelled without starting sources and discards results that arrive after cancellation', async () => {
    const source = reader('third-provider');
    const controller = new AbortController();
    const list = vi.fn(source.list);
    source.list = list;
    controller.abort();
    const first = await new SessionCatalog([source]).query({ contextId: 'local', signal: controller.signal });
    expect(first.completeness).toBe('cancelled');
    expect(list).not.toHaveBeenCalled();
    const lateController = new AbortController();
    source.list = async () => {
      lateController.abort();
      return reader('third-provider').list({ contextId: 'local' });
    };
    const late = await new SessionCatalog([source]).query({ contextId: 'local', signal: lateController.signal });
    expect(late.completeness).toBe('cancelled');
    expect(late.items).toEqual([]);
  });

  it('rejects a cursor reused in a different context without reading sources', async () => {
    const source = reader('third-provider');
    source.list = vi.fn().mockResolvedValue({ items: [], nextCursor: 'next', completeness: 'partial', errors: [], observedAt: 1 });
    const catalog = new SessionCatalog([source]);
    const first = await catalog.query({ contextId: 'local' });
    const other = await catalog.query({ contextId: 'ssh:other', cursor: first.nextCursor ?? undefined });
    expect(other).toMatchObject({ completeness: 'unavailable', errors: [expect.objectContaining({ kind: 'invalid-cursor' })] });
    expect(source.list).toHaveBeenCalledOnce();
  });

  it('retains failed source completeness when another source finishes on a later page', async () => {
    const unavailable = reader('failed-provider');
    unavailable.list = vi.fn().mockRejectedValue(new Error('offline'));
    const paged = reader('third-provider');
    paged.list = vi.fn().mockResolvedValueOnce({ items: [], nextCursor: 'next', completeness: 'partial', errors: [], observedAt: 1 }).mockResolvedValueOnce({ items: [], nextCursor: null, completeness: 'complete', errors: [], observedAt: 2 });
    const catalog = new SessionCatalog([unavailable, paged]);
    const first = await catalog.query({ contextId: 'local' });
    expect(first.completeness).toBe('partial');
    const last = await catalog.query({ contextId: 'local', cursor: first.nextCursor ?? undefined });
    expect(last.completeness).toBe('partial');
    expect(last.errors).toEqual([expect.objectContaining({ source: { contextId: 'local', providerId: 'failed-provider' }, kind: 'unavailable' })]);
  });
});
