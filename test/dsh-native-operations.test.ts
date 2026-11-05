import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeOperationProviders } from '../src/application/native-operation-providers.js';
import { DiscoveryService } from '../src/application/discovery/service.js';
import { createNativeSessionOperations } from '../src/application/session-operations.js';
import { createDshSessionReader } from '../src/application/sessions/dsh-reader.js';
import type { DiscoverySession } from '../src/application/discovery/model.js';
import type { DshRegistration } from '../src/dsh/registry.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((done) => { release = done; });
  return { promise, release };
}

async function fixture(timeoutMs = 300, freshDiscovery = false) {
  const temporary = await realpath(tmpdir());
  const root = await mkdtemp(join(temporary, 'crosschat-dsh-operations-'));
  const instancesDir = join(root, 'instances');
  await mkdir(instancesDir, { mode: 0o700 });
  const servers: Server[] = [];
  const gates: Array<ReturnType<typeof gate>> = [];
  const requests: Array<{ method: string; path: string }> = [];
  const id = 'native/session A';
  const registration: DshRegistration = { schema: 1, protocol: 1, provider: 'dsh', instanceId: randomUUID(), pid: process.pid,
    url: '', token: 'c'.repeat(64), runtimeVersion: '0.2.1-rc.2', profile: 'web', endpointType: 'host', createdAt: 100 };
  const state = { unauthorized: false, missing: false, details: 0, infoPid: process.pid,
    onInfo: undefined as (() => Promise<void>) | undefined, onDetail: undefined as (() => void | Promise<void>) | undefined };
  const native = { id, name: 'before', cwd: root, originalCwd: root, status: 'idle', createdAt: 200 };
  const publish = async () => writeFile(join(instancesDir, registration.instanceId + '.json'), JSON.stringify(registration), { mode: 0o600 });
  async function listen(identity = registration): Promise<string> {
    const server = createServer((request, response) => {
      void (async () => {
        requests.push({ method: request.method ?? '', path: request.url ?? '' });
        response.setHeader('content-type', 'application/json');
        if (state.unauthorized || request.headers.authorization !== 'Bearer ' + identity.token) {
          response.writeHead(401); response.end('{}'); return;
        }
        if (request.url === '/v1/info') {
          await state.onInfo?.();
          if (response.destroyed) return;
          response.end(JSON.stringify({ schema: identity.schema, protocol: identity.protocol, provider: identity.provider,
            instanceId: identity.instanceId, runtimeVersion: identity.runtimeVersion, profile: identity.profile,
            endpointType: identity.endpointType, callerIdentity: identity.callerIdentity, pid: state.infoPid })); return;
        }
        if (request.url === '/v1/sessions/' + encodeURIComponent(id)) {
          state.details++; await state.onDetail?.();
          response.end(JSON.stringify({ item: state.missing ? null : native })); return;
        }
        response.writeHead(404); response.end('{}');
      })().catch(() => { if (!response.destroyed) { response.writeHead(500); response.end('{}'); } });
    });
    servers.push(server);
    await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', () => { server.removeListener('error', fail); done(); }); });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Fixture must own a loopback port');
    return 'http://127.0.0.1:' + address.port;
  }
  cleanup.push(async () => {
    for (const pending of gates) pending.release();
    for (const server of servers) {
      server.closeAllConnections();
      if (server.listening) await new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done()));
    }
    const inside = relative(resolve(temporary), resolve(root));
    if (inside.startsWith('..') || inside === '' || resolve(root) === resolve(temporary)) throw new Error('Fixture root escaped its temporary parent');
    await rm(root, { recursive: true, force: true });
  });
  registration.url = await listen();
  await publish();
  const reader = createDshSessionReader({ instancesDir });
  const read = async (endpointType = registration.endpointType) => {
    const detail = await reader.get({ contextId: 'local', nativeId: id, ...(endpointType === undefined ? {} : { endpointType }) });
    if (!detail.item) throw new Error('Fixture discovery unavailable: ' + detail.errors.map(error => error.kind).join(','));
    return detail.item;
  };
  let item: DiscoverySession = await read();
  requests.length = 0; state.details = 0;
  const adopt = vi.fn<(item: DiscoverySession, tool: string, signal?: AbortSignal) => Promise<void>>(async () => undefined);
  // A retained detail snapshot makes the separate native revalidation observable.
  const operations = createNativeSessionOperations({ discovery: freshDiscovery ? new DiscoveryService([reader]) : { execute: async () => ({ op: 'detail',
    providers: [{ providerId: 'dsh', capabilities: item.capabilities }], detail: { item, completeness: 'complete', errors: [], observedAt: 1 } }) },
    providers: createNativeOperationProviders({ dsh: { instancesDir } }), adopt, timeoutMs });
  return { operations, adopt, state, registration, requests, publish, native, ref: item.ref,
    refresh: async () => { item = await read(); return item.ref; },
    setItem: (change: (current: DiscoverySession) => DiscoverySession) => { item = change(item); },
    move: async () => { registration.url = await listen(); await publish(); },
    duplicate: async (endpointType = 'host') => {
      const second = { ...registration, instanceId: randomUUID(), profile: endpointType === 'desktop' ? 'desktop' : 'web', endpointType };
      second.url = await listen(second);
      await writeFile(join(instancesDir, second.instanceId + '.json'), JSON.stringify(second), { mode: 0o600 });
    },
    holdInfo: () => { const started = gate(), pending = gate(); gates.push(started, pending); state.onInfo = async () => { started.release(); await pending.promise; }; return { started: started.promise, release: pending.release }; },
  };
}

describe('Harness native operation facts through the existing authenticated bridge', () => {
  it('isolates confirmations for identical native IDs in independent registries and keeps the other source usable after a move', async () => {
    const [left, right] = await Promise.all([fixture(), fixture()]);
    expect(left.ref).toEqual(right.ref);
    const [leftBefore, rightBefore] = await Promise.all([left.operations.describe(left.ref), right.operations.describe(right.ref)]);
    expect(leftBefore.actions.adopt.state).toBe('executable');
    expect(rightBefore.actions.adopt.state).toBe('executable');
    expect(leftBefore.revision).not.toBe(rightBefore.revision);
    expect(await left.operations.apply({ ref: left.ref, operation: 'adopt', expectedRevision: rightBefore.revision })).toMatchObject({ kind: 'rejected' });
    expect(left.adopt).not.toHaveBeenCalled();
    await left.move();
    expect(await left.operations.apply({ ref: left.ref, operation: 'adopt', expectedRevision: leftBefore.revision })).toMatchObject({ kind: 'rejected' });
    expect(await right.operations.apply({ ref: right.ref, operation: 'adopt', expectedRevision: rightBefore.revision })).toMatchObject({ kind: 'applied' });
    expect(right.adopt).toHaveBeenCalledOnce();
    expect(left.adopt).not.toHaveBeenCalled();
    const recovered = await left.operations.describe(left.ref);
    expect(recovered.actions.adopt.state).toBe('executable');
    expect(recovered.revision).not.toBe(leftBefore.revision);
    expect(left.adopt).not.toHaveBeenCalled();
  });

  it('cancels a blocked source without cancelling an independent same-ID source or replaying either write', async () => {
    const [left, right] = await Promise.all([fixture(), fixture()]);
    const rightBefore = await right.operations.describe(right.ref);
    const held = left.holdInfo(), controller = new AbortController();
    const pending = left.operations.describe(left.ref, controller.signal);
    try {
      await held.started;
      expect(await right.operations.apply({ ref: right.ref, operation: 'adopt', expectedRevision: rightBefore.revision })).toMatchObject({ kind: 'applied' });
      controller.abort();
      expect((await pending).actions.adopt.state).toBe('unavailable');
      expect(right.adopt).toHaveBeenCalledOnce();
      expect(left.adopt).not.toHaveBeenCalled();
    } finally {
      controller.abort(); held.release(); await pending;
      left.state.onInfo = undefined;
    }
    expect((await left.operations.describe(left.ref)).actions.adopt.state).toBe('executable');
    expect((await right.operations.describe(right.ref)).actions.adopt.state).toBe('executable');
    expect(left.adopt).not.toHaveBeenCalled();
    expect(right.adopt).toHaveBeenCalledOnce();
  });

  it('enables verified host adoption independently of unimplemented rename and exposes no bridge credentials', async () => {
    const f = await fixture();
    const result = await f.operations.describe(f.ref);
    expect(result.actions).toMatchObject({ adopt: { state: 'executable' }, rename: { state: 'needs-verification' } });
    expect(f.requests).toContainEqual({ method: 'GET', path: '/v1/info' });
    expect(f.requests).toContainEqual({ method: 'GET', path: '/v1/sessions/' + encodeURIComponent(f.ref.nativeId) });
    expect(JSON.stringify(result)).not.toContain(f.registration.token);
    expect(JSON.stringify(result)).not.toContain(f.registration.url);
    expect(f.requests.every(request => request.method === 'GET')).toBe(true);
    expect(f.adopt).not.toHaveBeenCalled();
  });

  it('keeps an untyped or unattested live record in needs-verification despite its delivery flag', async () => {
    const f = await fixture();
    f.setItem(item => ({ ...item, ref: { ...item.ref, endpointType: undefined }, attributes: {} }));
    const described = await f.operations.describe({ ...f.ref, endpointType: undefined });
    expect(described.actions.adopt.state).toBe('needs-verification');
    expect(f.requests).toEqual([]);
    expect(f.adopt).not.toHaveBeenCalled();
  });

  it('rechecks auth and owner, then recovers read-only without submitting adoption', async () => {
    const f = await fixture();
    const healthy = await f.operations.describe(f.ref);
    f.state.unauthorized = true;
    expect((await f.operations.describe(f.ref)).actions.adopt.state).toBe('unavailable');
    f.state.unauthorized = false; f.state.infoPid++;
    expect((await f.operations.describe(f.ref)).actions.adopt.state).toBe('unavailable');
    f.state.infoPid = process.pid;
    expect((await f.operations.describe(f.ref)).actions.adopt.state).toBe('executable');
    expect(healthy.actions.adopt.state).toBe('executable');
    expect(f.adopt).not.toHaveBeenCalled();
  });

  it('invalidates confirmation when the concrete URL changes even if UUID, pid and version do not', async () => {
    const f = await fixture();
    const before = await f.operations.describe(f.ref);
    await f.move();
    const after = await f.operations.describe(f.ref);
    expect(after.actions.adopt.state).toBe('executable');
    expect(after.revision).not.toBe(before.revision);
    expect(await f.operations.apply({ ref: f.ref, operation: 'adopt', expectedRevision: before.revision })).toMatchObject({ kind: 'rejected' });
    expect(f.adopt).not.toHaveBeenCalled();
  });

  it('rejects a version change until discovery and confirmation are refreshed', async () => {
    const f = await fixture();
    const before = await f.operations.describe(f.ref);
    f.registration.runtimeVersion = '0.2.1-rc.5'; await f.publish();
    expect(await f.operations.apply({ ref: f.ref, operation: 'adopt', expectedRevision: before.revision })).toMatchObject({ kind: 'rejected' });
    await f.refresh();
    expect((await f.operations.describe(f.ref)).actions.adopt.state).toBe('executable');
    expect(f.adopt).not.toHaveBeenCalled();
  });

  it('reports the current unsupported runtime window and recovers after a supported version returns', async () => {
    const f = await fixture();
    f.registration.runtimeVersion = '0.3.0'; await f.publish();
    expect((await f.operations.describe(f.ref)).actions.adopt.state).toBe('unsupported');
    f.registration.runtimeVersion = '0.2.1-rc.2'; await f.publish();
    expect((await f.operations.describe(f.ref)).actions.adopt.state).toBe('executable');
    expect(f.adopt).not.toHaveBeenCalled();
  });

  it('preserves the unsupported source result through fresh production discovery and recovers without a write', async () => {
    const f = await fixture(300, true);
    expect((await f.operations.describe(f.ref)).actions.adopt.state).toBe('executable');
    f.registration.runtimeVersion = '0.3.0'; await f.publish();
    expect((await f.operations.describe(f.ref)).actions.adopt.state).toBe('unsupported');
    f.registration.runtimeVersion = '0.2.1-rc.2'; await f.publish();
    expect((await f.operations.describe(f.ref)).actions.adopt.state).toBe('executable');
    expect(f.adopt).not.toHaveBeenCalled();
  });

  it('rejects same-type duplicate instances while isolating an identical ID on a different endpoint type', async () => {
    const f = await fixture();
    await f.duplicate('desktop');
    expect((await f.operations.describe(f.ref)).actions.adopt.state).toBe('executable');
    await f.duplicate('host');
    expect((await f.operations.describe(f.ref)).actions.adopt.state).toBe('unavailable');
    expect(f.adopt).not.toHaveBeenCalled();
  });

  it('does not cross from the selected host endpoint to an available desktop owner', async () => {
    const f = await fixture();
    f.registration.profile = 'desktop'; f.registration.endpointType = 'desktop'; await f.publish();
    expect((await f.operations.describe(f.ref)).actions.adopt.state).toBe('unavailable');
    expect(f.adopt).not.toHaveBeenCalled();
  });

  it('rechecks the native target immediately before the claim and rejects a disappearance without calling the writer', async () => {
    const f = await fixture();
    const before = await f.operations.describe(f.ref);
    f.state.onDetail = () => { if (f.state.details === 3) f.state.missing = true; };
    expect(await f.operations.apply({ ref: f.ref, operation: 'adopt', expectedRevision: before.revision })).toMatchObject({ kind: 'rejected' });
    expect(f.state.details).toBe(3);
    expect(f.adopt).not.toHaveBeenCalled();
  });

  it.each(['title', 'creation'] as const)('rejects changed native %s metadata until the discovery snapshot is refreshed', async (field) => {
    const f = await fixture();
    const before = await f.operations.describe(f.ref);
    if (field === 'title') f.native.name = 'after'; else f.native.createdAt++;
    expect(await f.operations.apply({ ref: f.ref, operation: 'adopt', expectedRevision: before.revision })).toMatchObject({ kind: 'rejected' });
    expect(f.adopt).not.toHaveBeenCalled();
    await f.refresh();
    const after = await f.operations.describe(f.ref);
    expect(await f.operations.apply({ ref: f.ref, operation: 'adopt', expectedRevision: after.revision })).toMatchObject({ kind: 'applied' });
    expect(f.adopt).toHaveBeenCalledOnce();
    expect(f.adopt.mock.calls[0]?.[0]).toMatchObject({ name: f.native.name, attributes: { createdAt: f.native.createdAt } });
  });

  it('rejects a registration move that occurs while the final native response is awaited', async () => {
    const f = await fixture();
    const before = await f.operations.describe(f.ref);
    f.state.onDetail = async () => { if (f.state.details === 3) await f.move(); };
    expect(await f.operations.apply({ ref: f.ref, operation: 'adopt', expectedRevision: before.revision })).toMatchObject({ kind: 'rejected' });
    expect(f.adopt).not.toHaveBeenCalled();
  });

  it('cancels a blocked native read and owns the late response without issuing a claim', async () => {
    const f = await fixture(3000), held = f.holdInfo(), controller = new AbortController();
    const pending = f.operations.describe(f.ref, controller.signal);
    await vi.waitFor(() => expect(f.requests.some(request => request.path === '/v1/info')).toBe(true), { timeout: 2000, interval: 5 });
    await held.started;
    controller.abort();
    expect((await pending).actions.adopt.state).toBe('unavailable');
    held.release();
    expect(f.adopt).not.toHaveBeenCalled();
  });

  it('keeps an unknown claim result uncertain and never repeats it during capability recovery', async () => {
    const f = await fixture();
    f.adopt.mockRejectedValue(new Error('claim receipt unavailable'));
    const before = await f.operations.describe(f.ref);
    expect(await f.operations.apply({ ref: f.ref, operation: 'adopt', expectedRevision: before.revision })).toMatchObject({ kind: 'uncertain' });
    expect((await f.operations.describe(f.ref)).actions.adopt.state).toBe('executable');
    expect(f.adopt).toHaveBeenCalledOnce();
    expect(f.requests.every(request => request.method === 'GET')).toBe(true);
  });
});
