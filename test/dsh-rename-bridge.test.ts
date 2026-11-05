import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountDshBridge } from '../integrations/dsh/bridge.js';
import { createDshRenameAdapter } from '../src/dsh/rename.js';
import { createNativeOperationProviders } from '../src/application/native-operation-providers.js';
import { createNativeSessionOperations } from '../src/application/session-operations.js';
import { createLocalDiscoveryService } from '../src/application/discovery/local.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture(profile = 'web', version = '0.2.1-rc.5', serviceAvailable = true, freshServiceProxy = false) {
  const home = await mkdtemp(join(tmpdir(), 'crosschat-dsh-title-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const id = 'root/+?雪', session = { id, header: { id, createdAt: 123, cwd: '/original' } };
  let title = 'before';
  let available = serviceAvailable;
  let disposeFailure = false;
  let expectedCloseFailure: unknown;
  const agent = { id, status: 'idle', session };
  const agents = new Map([[id, agent]]);
  const rename = vi.fn((target: typeof session, name: string) => {
    if (target !== session) throw new Error('Must use exact live session');
    title = name; return { title: name };
  });
  const titleService = { rename };
  const get = (key: string) => key === 'profileContext' ? { name: profile } : key === 'sessionTitle' && available
    ? freshServiceProxy ? new Proxy(titleService, {}) : titleService : key === 'sessionProjections' ? { stateOf: () => title } : undefined;
  type Scope = { get: typeof get; effect(setup: () => () => void): unknown };
  type Binding = { dependencies: string[]; callback(scope: Scope): unknown; effects: Array<() => void>; active: boolean };
  const bindings = new Set<Binding>();
  const activate = (binding: Binding) => {
    if (binding.active || !binding.dependencies.every((key) => get(key) !== undefined)) return;
    binding.active = true;
    binding.callback({ get, effect: (setup) => { binding.effects.push(setup()); } });
  };
  const ctx = { agents: { get: (key: string) => agents.get(key), roots: () => [...agents.values()] },
    get,
    inject: (dependencies: string[], callback: (scope: Scope) => unknown) => {
      const binding: Binding = { dependencies, callback, effects: [], active: false }; bindings.add(binding); activate(binding);
      return { dispose: async () => {
        for (const close of binding.effects.splice(0).reverse()) close(); bindings.delete(binding);
        if (disposeFailure && dependencies.includes('sessionTitle')) { disposeFailure = false; throw new Error('title scope dispose rejected'); }
      } };
    },
    effect: () => undefined,
  };
  const bridge = await mountDshBridge(ctx, { getDshRuntimeVersion: () => version, createUserMessage: () => ({ id: randomUUID(), role: 'user' }) }, { home });
  cleanup.push(async () => { try { await bridge.close(); } catch (error) { if (error !== expectedCloseFailure) throw error; } });
  const directory = join(home, '.crosschat/dsh/instances'), [file] = await readdir(directory);
  const registration = JSON.parse(await readFile(join(directory, file), 'utf8')) as { url: string; token: string; instanceId: string };
  const headers = { authorization: `Bearer ${registration.token}`, 'content-type': 'application/json' };
  const path = registration.url + '/v1/sessions/' + encodeURIComponent(id) + '/title';
  const observed: unknown = await (await fetch(path, { headers })).json();
  const targetRevision = typeof observed === 'object' && observed !== null && 'targetRevision' in observed ? observed.targetRevision : 'not-implemented';
  const input = () => ({ name: 'after', instanceId: registration.instanceId, createdAt: session.header.createdAt, targetRevision });
  const providers = createNativeOperationProviders({ dsh: { home } }).map((provider) => provider.providerId === 'dsh'
    ? { ...provider, rename: createDshRenameAdapter({ home }) } : provider);
  const adopt = vi.fn(), renamed = vi.fn();
  const operations = createNativeSessionOperations({ discovery: createLocalDiscoveryService({ home }), providers, adopt, renamed });
  const ref = { contextId: 'local', providerId: 'dsh', nativeId: id, endpointType: profile === 'desktop' ? 'desktop' : 'host' };
  return { path, headers, input, rename, agents, session, ctx, title: () => title, operations, ref, adopt, renamed,
    bridge, directory, failDispose: () => { disposeFailure = true; }, expectCloseFailure: (error: unknown) => { expectedCloseFailure = error; },
    replaceWithLateCleanup: () => {
      const previous: Array<() => void> = [];
      for (const binding of bindings) { previous.push(...binding.effects.splice(0)); binding.active = false; activate(binding); }
      for (const close of previous) close();
    },
    setService: (value: boolean) => {
      for (const binding of bindings) { for (const close of binding.effects.splice(0).reverse()) close(); binding.active = false; }
      available = value; for (const binding of bindings) activate(binding);
    } };
}

describe('Harness exact live native title bridge', () => {
  it('reads capabilities without a write and calls the public title service with the same live session', async () => {
    const f = await fixture();
    const observed = await fetch(f.path, { headers: f.headers });
    expect(observed.status).toBe(200); expect(await observed.json()).toMatchObject({ sessionId: f.session.id, createdAt: 123, availability: { state: 'executable' } });
    expect(f.rename).not.toHaveBeenCalled();
    const response = await fetch(f.path, { method: 'POST', headers: f.headers, body: JSON.stringify(f.input()) });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ accepted: true, sessionId: f.session.id, name: 'after' });
    expect(f.rename).toHaveBeenCalledExactlyOnceWith(f.session, 'after'); expect(f.title()).toBe('after');
  });

  it.each(['desktop', 'custom'])('does not enable %s solely because a native rename method exists', async (profile) => {
    const f = await fixture(profile);
    const response = await fetch(f.path, { headers: f.headers });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ availability: { state: 'needs-verification' } });
    expect((await fetch(f.path, { method: 'POST', headers: f.headers, body: JSON.stringify(f.input()) })).status).toBe(409);
    expect(f.rename).not.toHaveBeenCalled();
  });

  it('keeps an unverified version or unavailable native service disabled', async () => {
    for (const f of [await fixture('web', '0.2.9'), await fixture('web', '0.2.1-rc.5', false)]) {
      expect(await (await fetch(f.path, { headers: f.headers })).json()).toMatchObject({ availability: { state: 'needs-verification' } });
      expect(f.rename).not.toHaveBeenCalled();
    }
  });

  it.each(['instance', 'creation', 'live-object', 'missing'])('rejects changed %s before a native write', async (change) => {
    const f = await fixture(), input = f.input();
    if (change === 'instance') input.instanceId = randomUUID();
    if (change === 'creation') input.createdAt++;
    if (change === 'live-object') f.agents.set(f.session.id, { id: f.session.id, status: 'idle', session: { ...f.session } });
    if (change === 'missing') f.agents.clear();
    const response = await fetch(f.path, { method: 'POST', headers: f.headers, body: JSON.stringify(input) });
    expect(response.status).toBe(change === 'missing' ? 404 : 409); expect(f.rename).not.toHaveBeenCalled();
  });

  it.each(['', '  ', 'x:y', 'x\ny', 'x'.repeat(257)])('rejects invalid name before the native title service', async (name) => {
    const f = await fixture();
    expect((await fetch(f.path, { method: 'POST', headers: f.headers, body: JSON.stringify({ ...f.input(), name }) })).status).toBe(400);
    expect(f.rename).not.toHaveBeenCalled();
  });

  it('requires the existing authentication and forbids browser-origin writes', async () => {
    const f = await fixture();
    expect((await fetch(f.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f.input()) })).status).toBe(401);
    expect((await fetch(f.path, { method: 'POST', headers: { ...f.headers, origin: 'http://example.invalid' }, body: JSON.stringify(f.input()) })).status).toBe(403);
    expect(f.rename).not.toHaveBeenCalled();
  });

  it('keeps a native error after admission uncertain and never repeats the public call', async () => {
    const f = await fixture(); f.rename.mockImplementationOnce(() => { throw new Error('Native completion unavailable'); });
    const response = await fetch(f.path, { method: 'POST', headers: f.headers, body: JSON.stringify(f.input()) });
    expect(response.status).toBe(500); expect(await response.json()).toMatchObject({ error: { code: 'DSH_WRITE_UNCERTAIN' } });
    expect(f.rename).toHaveBeenCalledTimes(1);
  });
});

describe('production DSH title operation adapter', () => {
  it('qualifies a late loaded title service without replaying a write', async () => {
    const f = await fixture('web', '0.2.1-rc.5', false, true);
    expect((await f.operations.describe(f.ref)).actions.rename.state).toBe('needs-verification');
    f.setService(true);
    const ready = await f.operations.describe(f.ref); expect(ready.actions.rename.state).toBe('executable');
    expect(f.rename).not.toHaveBeenCalled();
  });

  it('does not let stale scope cleanup disable a newer title service generation', async () => {
    const f = await fixture('web', '0.2.1-rc.5', true, true), previous = await f.operations.describe(f.ref);
    f.replaceWithLateCleanup();
    const current = await f.operations.describe(f.ref); expect(current.actions.rename.state).toBe('executable'); expect(current.revision).not.toBe(previous.revision);
    expect(await f.operations.apply({ ref: f.ref, operation: 'rename', name: 'after', expectedRevision: previous.revision })).toMatchObject({ kind: 'rejected' });
    expect(f.rename).not.toHaveBeenCalled();
  });

  it('still closes HTTP and removes its registration if the title dependency scope cannot dispose', async () => {
    const f = await fixture(); f.failDispose();
    const failure: unknown = await f.bridge.close().then(() => undefined, (error: unknown) => error); f.expectCloseFailure(failure);
    expect(failure).toBeInstanceOf(Error); expect((failure as Error).message).toBe('title scope dispose rejected');
    await expect(fetch(f.path, { headers: f.headers })).rejects.toThrow(); expect(await readdir(f.directory)).toEqual([]);
    expect(f.rename).not.toHaveBeenCalled();
  });
  it('keeps confirmation stable across fresh Cordis service proxies for the same loaded service', async () => {
    const f = await fixture('web', '0.2.1-rc.5', true, true);
    expect(f.ctx.get('sessionTitle')).not.toBe(f.ctx.get('sessionTitle'));
    const first = await f.operations.describe(f.ref), second = await f.operations.describe(f.ref);
    expect(second.actions.rename.state).toBe('executable'); expect(second.revision).toBe(first.revision);
    expect(await f.operations.apply({ ref: f.ref, operation: 'rename', name: 'after', expectedRevision: first.revision })).toMatchObject({ kind: 'applied' });
    expect(f.rename).toHaveBeenCalledTimes(1);
  });
  it('qualifies a concrete native target, writes once and confirms the native name before updating node metadata', async () => {
    const f = await fixture(), description = await f.operations.describe(f.ref);
    expect(description.actions).toMatchObject({ adopt: { state: 'executable' }, rename: { state: 'executable' } });
    expect(f.rename).not.toHaveBeenCalled();
    expect(await f.operations.apply({ ref: f.ref, operation: 'rename', name: 'after', expectedRevision: description.revision })).toMatchObject({ kind: 'applied' });
    expect(f.rename).toHaveBeenCalledExactlyOnceWith(f.session, 'after'); expect(f.title()).toBe('after');
    expect(f.renamed).toHaveBeenCalledWith(expect.objectContaining({ name: 'after' }), expect.anything()); expect(f.adopt).not.toHaveBeenCalled();
  });

  it('invalidates an old confirmation if the live Agent is replaced under identical native identity metadata', async () => {
    const f = await fixture(), description = await f.operations.describe(f.ref);
    f.agents.set(f.session.id, { id: f.session.id, status: 'idle', session: { ...f.session } });
    const current = await f.operations.describe(f.ref); expect(current.actions.rename.state).toBe('executable'); expect(current.revision).not.toBe(description.revision);
    expect(await f.operations.apply({ ref: f.ref, operation: 'rename', name: 'after', expectedRevision: description.revision })).toMatchObject({ kind: 'rejected' });
    expect(f.rename).not.toHaveBeenCalled(); expect(f.renamed).not.toHaveBeenCalled();
  });

  it('recovers a missing native service read-only without disabling adoption or replaying a pending rename', async () => {
    const f = await fixture(), description = await f.operations.describe(f.ref); f.setService(false);
    const missing = await f.operations.describe(f.ref); expect(missing.actions.adopt.state).toBe('executable'); expect(missing.actions.rename.state).not.toBe('executable');
    expect(await f.operations.apply({ ref: f.ref, operation: 'rename', name: 'after', expectedRevision: description.revision })).toMatchObject({ kind: 'rejected' });
    f.setService(true); expect((await f.operations.describe(f.ref)).actions.rename.state).toBe('executable');
    expect(await f.operations.apply({ ref: f.ref, operation: 'rename', name: 'after', expectedRevision: description.revision })).toMatchObject({ kind: 'rejected' });
    expect(f.rename).not.toHaveBeenCalled();
  });

  it('does not inherit native Web rename capability in the Desktop endpoint', async () => {
    const f = await fixture('desktop'), description = await f.operations.describe(f.ref);
    expect(description.actions).toMatchObject({ adopt: { state: 'executable' }, rename: { state: 'needs-verification' } });
    expect(f.rename).not.toHaveBeenCalled();
  });

  it('keeps an admitted native setter failure uncertain with zero automatic repeats', async () => {
    const f = await fixture(), description = await f.operations.describe(f.ref);
    f.rename.mockImplementationOnce(() => { throw new Error('Native completion unavailable'); });
    expect(await f.operations.apply({ ref: f.ref, operation: 'rename', name: 'after', expectedRevision: description.revision })).toMatchObject({ kind: 'uncertain' });
    await f.operations.describe(f.ref); expect(f.rename).toHaveBeenCalledTimes(1); expect(f.renamed).not.toHaveBeenCalled();
  });
});
