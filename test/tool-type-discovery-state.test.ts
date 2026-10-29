import { describe, expect, it } from 'vitest';
import { parseDiscoveryRequest, parseDiscoveryResponse } from '../src/application/discovery/boundary.js';
import { completeRemoteDiscoveryResponse } from '../src/application/discovery/remote.js';
import { DiscoveryService } from '../src/application/discovery/service.js';
import { SessionCatalog } from '../src/application/sessions/catalog.js';
import type { Session, SessionReader } from '../src/application/sessions/model.js';
import { sessionKey } from '../src/application/sessions/model.js';
import { createNativeSessionOperations } from '../src/application/session-operations.js';

const capabilities = { discovery: true, delivery: true, launch: false, diagnostics: false };
const ref = { contextId: 'local', providerId: 'codex', nativeId: 'same-id', endpointType: 'desktop' };
const item = (endpointType = 'desktop'): Session => ({ ref: { ...ref, endpointType }, key: sessionKey({ ...ref, endpointType }),
  name: 'Worker', rawStatus: 'idle', capabilities, attributes: {} });
const detail = (session: Session | null) => ({ item: session, completeness: 'complete' as const, observedAt: 100, errors: [] });
const response = (session = item()) => ({ op: 'detail', providers: [{ providerId: ref.providerId, capabilities }], detail: detail(session) });

describe('typed discovery authority', () => {
  it('rejects a known provider/type mismatch in request and response metadata', () => {
    expect(() => parseDiscoveryRequest({ op: 'detail', providerId: ref.providerId, nativeId: ref.nativeId, endpointType: 'shared' })).toThrow();
    expect(() => parseDiscoveryResponse(response(item('shared')))).toThrow();
    const third = item('editor');
    third.ref.providerId = 'third-provider';
    expect(parseDiscoveryResponse({ ...response(third), providers: [{ providerId: 'third-provider', capabilities }] }))
      .toMatchObject({ detail: { item: { ref: { providerId: 'third-provider', endpointType: 'editor' } } } });
  });

  it('passes the selected type to the reader and rejects a different type returned by it', async () => {
    const seen: unknown[] = [];
    const reader: SessionReader = { providerId: 'codex', capabilities,
      async list() { throw new Error('unused'); },
      async get(request) { seen.push(request.endpointType); return detail(item('cli')); },
    };
    const result = await new DiscoveryService([reader]).execute({ op: 'detail', providerId: ref.providerId, nativeId: ref.nativeId, endpointType: ref.endpointType });
    expect(seen).toEqual(['desktop']);
    expect(result).toMatchObject({ op: 'detail', detail: { item: null, completeness: 'unavailable', errors: [{ kind: 'malformed' }] } });
  });

  it('rejects a remote response for another type while retaining the requested context on valid results', () => {
    const request = { op: 'detail' as const, providerId: ref.providerId, nativeId: ref.nativeId, endpointType: ref.endpointType };
    const scope = { contextId: 'tcp:star:node', target: 'tcp:star:node' };
    expect(() => completeRemoteDiscoveryResponse(response(item('cli')), request, scope)).toThrow();
    expect(completeRemoteDiscoveryResponse(response(), request, scope))
      .toMatchObject({ detail: { item: { ref: { contextId: scope.contextId, endpointType: 'desktop' } } } });
  });

  it('does not expose a different typed detail through the catalog directly', async () => {
    const reader: SessionReader = { providerId: 'codex', capabilities,
      async list() { throw new Error('unused'); }, async get() { return detail(item('cli')); },
    };
    expect(await new SessionCatalog([reader]).detail(ref)).toMatchObject({
      item: null, completeness: 'unavailable', errors: [{ kind: 'malformed' }],
    });
  });

  it('binds a catalog page cursor to its endpoint selection and passes that type to its source', async () => {
    const seen: unknown[] = [];
    const reader: SessionReader = { providerId: 'codex', capabilities,
      async list(request) { seen.push(request.endpointType); return { items: [item('cli'), item('desktop')], nextCursor: 'more', completeness: 'partial', observedAt: 100, errors: [] }; },
      async get() { return detail(null); },
    };
    const catalog = new SessionCatalog([reader]);
    const page = await catalog.query({ contextId: 'local', endpointType: 'desktop' });
    expect(seen).toEqual(['desktop']);
    expect(page.items.map((session) => session.ref.endpointType)).toEqual(['desktop']);
    const changed = await catalog.query({ contextId: 'local', endpointType: 'cli', cursor: page.nextCursor! });
    expect(changed.errors).toMatchObject([{ kind: 'invalid-cursor' }]);
    expect(seen).toHaveLength(1);
  });

  it('keeps the exact typed selection through native operation revalidation', async () => {
    const seen: unknown[] = [];
    const adopted: unknown[] = [];
    const operations = createNativeSessionOperations({
      discovery: { async execute(request) { seen.push(request); return parseDiscoveryResponse(response()); } },
      providers: [{ providerId: 'codex', tool: 'codex', canAdopt: () => ({ allowed: true }) }],
      async adopt(session) { adopted.push(session.ref); },
    });
    const description = await operations.describe(ref);
    expect(description.actions.adopt.state).toBe('executable');
    expect(await operations.apply({ ref, operation: 'adopt', expectedRevision: description.revision })).toMatchObject({ kind: 'applied' });
    expect(seen).toEqual([
      expect.objectContaining({ op: 'detail', endpointType: 'desktop' }),
      expect.objectContaining({ op: 'detail', endpointType: 'desktop' }),
    ]);
    expect(adopted).toEqual([ref]);
  });
});
