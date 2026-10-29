import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDshBridge } from '../integrations/dsh/bridge.js';

// Controlled native-capability failure: the temporary registration is on disk but
// linking it into place fails, which is the one mount step that leaves a real
// temporary file behind for the mount catch to remove.
const boundary = vi.hoisted(() => ({ failLink: false, linkSourceBytes: 0 }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, link: async (...args: Parameters<typeof actual.link>) => {
    if (boundary.failLink) {
      boundary.failLink = false;
      boundary.linkSourceBytes = (await actual.stat(args[0])).size;
      throw new Error('link injection failed');
    }
    return actual.link(...args);
  } };
});

const cleanup: Array<() => Promise<void>> = [];
// A memoized rejected close hands the same injected error back to whoever asks.
const expected: unknown[] = [];
// Every fixture-owned release is attempted; an injected failure must not skip the
// remaining cleanup of the temporary root.
afterEach(async () => {
  const failures: unknown[] = [];
  for (const dispose of cleanup.splice(0).reverse()) {
    try { await dispose(); } catch (error) { if (!expected.includes(error)) failures.push(error); }
  }
  expected.length = 0;
  if (failures.length > 0) throw new AggregateError(failures, `fixture cleanup failed: ${failures.map((error) => String((error as Error)?.message ?? error)).join('; ')}`);
});
beforeEach(() => { boundary.failLink = false; boundary.linkSourceBytes = 0; });

type Faults = { releaseThrows?: boolean; disposeRejects?: boolean };

async function environment(profileContext?: unknown, withShellEnv = false, dynamicShellEnv = false, faults: Faults = {}) {
  const home = await mkdtemp(join(tmpdir(), 'crosschat-dsh-bridge-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const received: Array<{ id: string; mode: string; message: { id: string; role: string; content: Array<{ type: string; text: string }>; source: unknown } }> = [];
  const agents = new Map<string, ReturnType<typeof agent>>();
  function agent(id: string, status = 'idle') {
    return { id, status, session: { id, header: { id, cwd: '/origin', createdAt: 123 } },
      followup: (message: typeof received[number]['message']) => { received.push({ id, mode: 'queue', message }); },
      steer: (message: typeof received[number]['message']) => { received.push({ id, mode: 'steer', message }); } };
  }
  agents.set('root/+?雪', agent('root/+?雪'));
  agents.set('busy', agent('busy', 'running'));
  const effects: Array<() => void | Promise<void>> = [];
  type Contributor = { name: string; variables: Record<string, { description: string }>; resolve: (execution: { agent?: unknown }) => Record<string, string> };
  const contributors = new Map<string, Contributor>();
  const stats = { releases: 0 };
  let shellEnvAvailable = withShellEnv;
  const shellEnv = { register: (contributor: Contributor) => {
    if (contributors.has(contributor.name)) throw new Error('Duplicate contributor');
    contributors.set(contributor.name, contributor);
    let pending = faults.releaseThrows === true;
    return () => {
      contributors.delete(contributor.name);
      stats.releases += 1;
      if (pending) { pending = false; const error = new Error('contributor release failed'); expected.push(error); throw error; }
    };
  } };
  // Cordis' public ctx.inject contract reruns a child scope after a dependency
  // appears or changes, disposing that scope when the dependency disappears.
  // Fixed native contract: 687f282e8625c6b8d11ff58211a90524be2e4317,
  // docs/cordis-api/registry.md and packages/shell/shell-env/src/index.ts.
  const bindings: Array<{ callback: (scope: unknown) => unknown; effects: Array<() => void | Promise<void>> }> = [];
  const activate = async (binding: typeof bindings[number]) => {
    const service = { register: (contributor: Contributor) => {
      const dispose = shellEnv.register(contributor);
      binding.effects.push(dispose);
      return dispose;
    } };
    await binding.callback({
      get: (key: string) => key === 'shellEnv' ? service : ctx.get(key),
      shellEnv: service,
      effect: (setup: () => () => void | Promise<void>) => { const dispose = setup(); binding.effects.push(dispose); return dispose; },
    });
  };
  const setShellEnv = async (available: boolean) => {
    for (const binding of bindings) for (const dispose of binding.effects.splice(0).reverse()) await dispose();
    shellEnvAvailable = available;
    if (available) for (const binding of bindings) await activate(binding);
  };
  const ctx = {
    agents: { get: (id: string) => agents.get(id), roots: () => [...agents.values()].filter((item) => item.id !== 'child'), list: () => [...agents.values()] },
    get: (key: string) => key === 'shellEnv' && shellEnvAvailable ? shellEnv : key === 'profileContext' ? profileContext : key === 'workingDirectory' ? { get: () => '/current' } : key === 'sessionTitle' ? { get: () => null } : undefined,
    effect: (setup: () => () => void | Promise<void>) => { const disposer = setup(); effects.push(disposer); return disposer; },
    ...(dynamicShellEnv ? { inject: (_dependencies: string[], callback: (scope: unknown) => unknown) => {
      const binding = { callback, effects: [] };
      bindings.push(binding);
      if (shellEnvAvailable) void activate(binding);
      let disposed = false;
      let rejected = false;
      const dispose = async () => {
        if (disposed) return;
        if (faults.disposeRejects === true && !rejected) { rejected = true; const error = new Error('scope dispose rejected'); expected.push(error); throw error; }
        disposed = true;
        bindings.splice(bindings.indexOf(binding), 1);
        for (const release of binding.effects.splice(0).reverse()) await release();
      };
      effects.push(dispose);
      return { dispose };
    } } : {}),
  };
  const host = { getDshRuntimeVersion: () => '0.2.1-rc.2', createUserMessage: (input: { content: Array<{ type: string; text: string }>; source: unknown }) => Object.freeze({ ...input, id: randomUUID(), role: 'user' }) };
  const dir = join(home, '.crosschat', 'dsh', 'instances');
  // The fixture owns its effects even when the mount itself fails.
  cleanup.push(async () => { for (const dispose of effects.reverse()) await dispose(); });
  return { home, dir, received, agents, agent, effects, ctx, host, contributors, setShellEnv, stats };
}

async function fixture(profileContext?: unknown, withShellEnv = false, dynamicShellEnv = false, faults: Faults = {}) {
  const value = await environment(profileContext, withShellEnv, dynamicShellEnv, faults);
  const bridge = await mountDshBridge(value.ctx, value.host, { home: value.home });
  const [filename] = await readdir(value.dir);
  const file = join(value.dir, filename);
  const registration = JSON.parse(await readFile(file, 'utf8'));
  const headers = { authorization: `Bearer ${registration.token}` };
  return { ...value, file, registration, headers, bridge };
}

describe('DSH Host bridge', () => {
  it('binds a late native shell service, releases unloaded ownership and binds its replacement', async () => {
    const value = await fixture({ name: 'web', dir: '/native-profile' }, false, true);
    const collect = () => Object.assign({ DSH_SHELL: '1', DSH_SESSION_ID: 'busy' },
      ...[...value.contributors.values()].map((contributor) => contributor.resolve({ agent: value.agents.get('busy') })));
    expect(collect()).not.toHaveProperty('DSH_CROSSCHAT_INSTANCE_ID');
    await value.setShellEnv(true);
    expect(collect()).toMatchObject({ DSH_CROSSCHAT_INSTANCE_ID: value.registration.instanceId, DSH_CROSSCHAT_HOME: value.home });
    expect(value.contributors.size).toBe(1);
    await value.setShellEnv(false);
    expect(collect()).not.toHaveProperty('DSH_CROSSCHAT_INSTANCE_ID');
    expect((await fetch(`${value.registration.url}/v1/info`, { headers: value.headers })).status).toBe(200);
    await value.setShellEnv(true);
    expect(collect()).toMatchObject({ DSH_CROSSCHAT_INSTANCE_ID: value.registration.instanceId });
    expect(value.contributors.size).toBe(1);
    await value.bridge.close();
    expect(collect()).not.toHaveProperty('DSH_CROSSCHAT_INSTANCE_ID');
  });

  it('does not retain a source contribution after the native shell service unloads', async () => {
    const value = await fixture({ name: 'web', dir: '/native-profile' }, true, true);
    expect(value.contributors.size).toBe(1);
    const contributor = [...value.contributors.values()][0];
    await value.setShellEnv(false);
    expect(value.contributors.size).toBe(0);
    expect(contributor.resolve({ agent: value.agents.get('busy') })).toEqual({});
    expect((await fetch(`${value.registration.url}/v1/sessions`, { headers: value.headers })).status).toBe(200);
    await value.bridge.close();
    await value.setShellEnv(true);
    expect(value.contributors.size).toBe(0);
  });

  it('contributes this bridge instance only to the actual live root execution and releases it on close', async () => {
    const value = await fixture({ name: 'web', dir: '/native-profile' }, true);
    expect(value.registration.callerIdentity).toEqual({ schema: 1, profileDir: '/native-profile' });
    expect(value.contributors.size).toBe(1);
    const contributor = [...value.contributors.values()][0];
    expect(Object.keys(contributor.variables).sort()).toEqual(['DSH_CROSSCHAT_HOME', 'DSH_CROSSCHAT_INSTANCE_ID']);
    expect(contributor.resolve({ agent: value.agents.get('busy') })).toEqual({
      DSH_CROSSCHAT_INSTANCE_ID: value.registration.instanceId, DSH_CROSSCHAT_HOME: value.home,
    });
    expect(contributor.resolve({})).toEqual({});
    expect(contributor.resolve({ agent: value.agent('busy') })).toEqual({});
    const current = value.agents.get('busy');
    value.agents.delete('busy');
    expect(contributor.resolve({ agent: current })).toEqual({});
    await value.bridge.close();
    expect(value.contributors.size).toBe(0);
    expect(contributor.resolve({ agent: value.agents.get('root/+?雪') })).toEqual({});
  });

  it('does not advertise caller association without the public per-execution shell service', async () => {
    const value = await fixture({ name: 'web', dir: '/native-profile' });
    expect(value.registration).not.toHaveProperty('callerIdentity');
    expect(value.contributors.size).toBe(0);
  });

  it.each([['desktop', 'desktop'], ['web', 'host'], ['custom-profile', 'host']])('reports the native %s profile without inferring frontend ownership', async (profile, endpointType) => {
    const value = await fixture({ name: profile, dir: '/native-profile', installAnchor: '/native-anchor' });
    expect(value.registration).toMatchObject({ profile, endpointType });
    const info = await fetch(`${value.registration.url}/v1/info`, { headers: value.headers }).then((response) => response.json());
    expect(info).toMatchObject({ profile, endpointType });
  });

  it.each([undefined, null, {}, { name: '' }, { name: 3 }])('does not invent host or Desktop type without a valid native profile (%#)', async (profile) => {
    const value = await fixture(profile);
    expect(value.registration).not.toHaveProperty('endpointType');
    expect(value.registration).not.toHaveProperty('profile');
  });

  it('publishes a private owned registration matching the authenticated service identity', async () => {
    const value = await fixture();
    expect(value.registration).toMatchObject({ schema: 1, protocol: 1, provider: 'dsh', instanceId: expect.any(String), pid: process.pid, runtimeVersion: '0.2.1-rc.2' });
    expect(value.registration.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(value.registration.token).toMatch(/^[a-f0-9]{64}$/);
    const info = await fetch(`${value.registration.url}/v1/info`, { headers: value.headers }).then((response) => response.json());
    expect(info).toEqual({ schema: 1, protocol: 1, provider: 'dsh', instanceId: value.registration.instanceId, pid: process.pid, runtimeVersion: '0.2.1-rc.2' });
    expect(JSON.stringify(info)).not.toContain(value.registration.token);
    if (process.platform !== 'win32') expect((await stat(value.file)).mode & 0o777).toBe(0o600);
  });

  it('requires authentication and refuses browser-origin requests', async () => {
    const value = await fixture();
    expect((await fetch(`${value.registration.url}/v1/info`)).status).toBe(401);
    expect((await fetch(`${value.registration.url}/v1/info`, { headers: { ...value.headers, origin: 'http://untrusted.example' } })).status).toBe(403);
    expect(value.received).toEqual([]);
  });

  it('lists existing roots and resolves exact opaque session ids without creating sessions', async () => {
    const value = await fixture();
    const list = await fetch(`${value.registration.url}/v1/sessions`, { headers: value.headers }).then((response) => response.json());
    expect(list.items).toMatchObject([{ id: 'root/+?雪', name: null, cwd: '/current', originalCwd: '/origin', status: 'idle' }, { id: 'busy', status: 'running' }]);
    const item = await fetch(`${value.registration.url}/v1/sessions/${encodeURIComponent('root/+?雪')}`, { headers: value.headers }).then((response) => response.json());
    expect(item.item.id).toBe('root/+?雪');
    const absent = await fetch(`${value.registration.url}/v1/sessions/missing`, { headers: value.headers }).then((response) => response.json());
    expect(absent).toEqual({ item: null });
    value.agents.delete('busy');
    const after = await fetch(`${value.registration.url}/v1/sessions`, { headers: value.headers }).then((response) => response.json());
    expect(after.items.map((item: { id: string }) => item.id)).toEqual(['root/+?雪']);
    expect(value.received).toEqual([]);
  });

  it('never discovers or admits input to a live subagent addressed directly', async () => {
    const value = await fixture();
    value.agents.set('child', value.agent('child'));
    const list = await fetch(`${value.registration.url}/v1/sessions`, { headers: value.headers }).then((response) => response.json());
    expect(list.items.map((item: { id: string }) => item.id)).not.toContain('child');
    const absent = await fetch(`${value.registration.url}/v1/sessions/child`, { headers: value.headers }).then((response) => response.json());
    expect(absent).toEqual({ item: null });
    const rejected = await fetch(`${value.registration.url}/v1/sessions/child/messages`, { method: 'POST', headers: { ...value.headers, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'do not send', mode: 'queue' }) });
    expect(rejected.status).toBe(404);
    expect(value.received).toEqual([]);
  });

  it('reads the public title projection without replaying history through the snapshot getter', async () => {
    const value = await fixture();
    const previous = value.ctx.get;
    Object.assign(value.ctx, { get: (key: string) => key === 'sessionProjections' ? { stateOf: () => 'Existing native title' }
      : key === 'sessionTitle' ? { get: () => { throw new Error('Full history getter must not be used for listing'); } } : previous(key) });
    const response = await fetch(`${value.registration.url}/v1/sessions`, { headers: value.headers });
    expect(response.status).toBe(200);
    expect((await response.json()).items[0].name).toBe('Existing native title');
  });

  it.each(['queue', 'steer'] as const)('admits one native %s message and returns its generated identity', async (mode) => {
    const value = await fixture();
    const response = await fetch(`${value.registration.url}/v1/sessions/busy/messages`, { method: 'POST', headers: { ...value.headers, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'native mock content', mode }) });
    expect(response.status).toBe(200);
    const receipt = await response.json();
    expect(value.received).toHaveLength(1);
    expect(value.received[0]).toMatchObject({ id: 'busy', mode, message: { id: receipt.messageId, role: 'user', content: [{ type: 'text', text: 'native mock content' }] } });
    expect(receipt).toEqual({ accepted: true, sessionId: 'busy', messageId: value.received[0].message.id, mode });
  });

  it('does not create or replace an absent target and rejects invalid content before admission', async () => {
    const value = await fixture();
    const send = (id: string, input: unknown) => fetch(`${value.registration.url}/v1/sessions/${id}/messages`, { method: 'POST', headers: { ...value.headers, 'content-type': 'application/json' }, body: JSON.stringify(input) });
    expect((await send('missing', { text: 'content', mode: 'queue' })).status).toBe(404);
    expect((await send('busy', { text: ' ', mode: 'queue' })).status).toBe(400);
    expect((await send('busy', { text: 'content', mode: 'inject' })).status).toBe(400);
    expect((await send('busy', { text: 'content', mode: 'queue', extra: true })).status).toBe(400);
    expect(value.received).toEqual([]);
    expect(value.agents.has('missing')).toBe(false);
  });

  it('accepts all legal escaped text within the content budget instead of truncating JSON', async () => {
    const value = await fixture();
    const text = '\u0001'.repeat(1024 * 1024);
    const response = await fetch(`${value.registration.url}/v1/sessions/busy/messages`, { method: 'POST', headers: { ...value.headers, 'content-type': 'application/json' }, body: JSON.stringify({ text, mode: 'queue' }) });
    expect(response.status).toBe(200);
    expect(value.received[0].message.content[0].text).toBe(text);
  });

  it('rejects an oversized body and unknown routes without native side effects', async () => {
    const value = await fixture();
    const response = await fetch(`${value.registration.url}/v1/sessions/busy/messages`, { method: 'POST', headers: { ...value.headers, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(1024 * 1024 + 1), mode: 'queue' }) });
    expect(response.status).toBe(413);
    expect((await fetch(`${value.registration.url}/v1/create`, { method: 'POST', headers: value.headers })).status).toBe(404);
    expect(value.received).toEqual([]);
  });

  it('disposes the bridge socket and only its owned registration while leaving native agents live', async () => {
    const value = await fixture();
    const second = await mountDshBridge(value.ctx, value.host, { home: value.home });
    const names = await readdir(value.dir);
    expect(names).toHaveLength(2);
    await value.bridge.close();
    expect(await readdir(value.dir)).toHaveLength(1);
    await expect(fetch(`${value.registration.url}/v1/info`, { headers: value.headers })).rejects.toThrow();
    expect(value.agents.size).toBe(2);
    await second.close();
    expect(await readdir(value.dir)).toEqual([]);
  });

  it('still stops the listener and removes its own registration when the contributor release fails', async () => {
    const value = await fixture({ name: 'web', dir: '/native-profile' }, true, false, { releaseThrows: true });
    await expect(value.bridge.close()).rejects.toThrow('contributor release failed');
    await expect(fetch(`${value.registration.url}/v1/info`, { headers: value.headers })).rejects.toThrow();
    expect(await readdir(value.dir)).toEqual([]);
    expect(value.contributors.size).toBe(0);
    expect(value.agents.size).toBe(2);
  });

  it('still stops the listener and removes its own registration when the dependency scope disposal rejects', async () => {
    const value = await fixture({ name: 'web', dir: '/native-profile' }, true, true, { disposeRejects: true });
    await expect(value.bridge.close()).rejects.toThrow('scope dispose rejected');
    await expect(fetch(`${value.registration.url}/v1/info`, { headers: value.headers })).rejects.toThrow();
    expect(await readdir(value.dir)).toEqual([]);
    expect(value.contributors.size).toBe(0);
    expect(value.agents.size).toBe(2);
  });

  it('shares one closing attempt between concurrent closes without releasing twice', async () => {
    const value = await fixture({ name: 'web', dir: '/native-profile' }, true);
    const first = value.bridge.close();
    const second = value.bridge.close();
    expect(second).toBe(first);
    await first;
    expect(value.stats.releases).toBe(1);
    expect(await readdir(value.dir)).toEqual([]);
  });

  it('closes through the plugin effect that owns the bridge', async () => {
    const value = await fixture();
    const dispose = value.effects.at(-1);
    expect(dispose).toBeTypeOf('function');
    await dispose?.();
    await expect(fetch(`${value.registration.url}/v1/info`, { headers: value.headers })).rejects.toThrow();
    expect(await readdir(value.dir)).toEqual([]);
  });

  it('leaves a replacement registration, other instances and borrowed agents untouched while closing', async () => {
    const value = await fixture();
    const second = await mountDshBridge(value.ctx, value.host, { home: value.home });
    const replacement = { ...value.registration, token: 'f'.repeat(64) };
    await writeFile(value.file, JSON.stringify(replacement));
    await value.bridge.close();
    // The replacement record and the second bridge's registration both survive.
    expect(await readdir(value.dir)).toHaveLength(2);
    expect(JSON.parse(await readFile(value.file, 'utf8')).token).toBe(replacement.token);
    expect(value.agents.size).toBe(2);
    await second.close();
    expect(await readdir(value.dir)).toHaveLength(1);
  });

  it('keeps the mount failure as the reason and removes the temporary registration it left behind', async () => {
    const value = await environment({ name: 'web', dir: '/native-profile' }, true, false, { releaseThrows: true });
    boundary.failLink = true;
    const failure = await mountDshBridge(value.ctx, value.host, { home: value.home }).then(() => undefined, (error: unknown) => error);
    // The mount really did leave a written temporary file behind before failing.
    expect(boundary.linkSourceBytes).toBeGreaterThan(0);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('link injection failed');
    expect((failure as Error & { cause?: Error }).cause?.message).toBe('contributor release failed');
    expect(await readdir(value.dir)).toEqual([]);
  });
});
