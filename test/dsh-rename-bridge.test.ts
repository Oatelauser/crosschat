import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountDshBridge } from '../integrations/dsh/bridge.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture(profile = 'web', version = '0.2.1-rc.5', serviceAvailable = true) {
  const home = await mkdtemp(join(tmpdir(), 'crosschat-dsh-title-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const id = 'root/+?雪', session = { id, header: { id, createdAt: 123, cwd: '/original' } };
  let title = 'before';
  const agent = { id, status: 'idle', session };
  const agents = new Map([[id, agent]]);
  const rename = vi.fn((target: typeof session, name: string) => {
    if (target !== session) throw new Error('Must use exact live session');
    title = name; return { title: name };
  });
  const ctx = { agents: { get: (key: string) => agents.get(key), roots: () => [...agents.values()] },
    get: (key: string) => key === 'profileContext' ? { name: profile } : key === 'sessionTitle' && serviceAvailable ? { rename }
      : key === 'sessionProjections' ? { stateOf: () => title } : undefined,
    effect: () => undefined,
  };
  const bridge = await mountDshBridge(ctx, { getDshRuntimeVersion: () => version, createUserMessage: () => ({ id: randomUUID(), role: 'user' }) }, { home });
  cleanup.push(() => bridge.close());
  const directory = join(home, '.crosschat/dsh/instances'), [file] = await readdir(directory);
  const registration = JSON.parse(await readFile(join(directory, file), 'utf8')) as { url: string; token: string; instanceId: string };
  const headers = { authorization: `Bearer ${registration.token}`, 'content-type': 'application/json' };
  const path = registration.url + '/v1/sessions/' + encodeURIComponent(id) + '/title';
  const observed: unknown = await (await fetch(path, { headers })).json();
  const targetRevision = typeof observed === 'object' && observed !== null && 'targetRevision' in observed ? observed.targetRevision : 'not-implemented';
  const input = () => ({ name: 'after', instanceId: registration.instanceId, createdAt: session.header.createdAt, targetRevision });
  return { path, headers, input, rename, agents, session, ctx, title: () => title };
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
