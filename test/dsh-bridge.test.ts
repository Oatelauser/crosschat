import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mountDshBridge } from '../integrations/dsh/bridge.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

async function fixture() {
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
  const ctx = {
    agents: { get: (id: string) => agents.get(id), roots: () => [...agents.values()].filter((item) => item.id !== 'child'), list: () => [...agents.values()] },
    get: (key: string) => key === 'workingDirectory' ? { get: () => '/current' } : key === 'sessionTitle' ? { get: () => null } : undefined,
    effect: (setup: () => () => void | Promise<void>) => { const disposer = setup(); effects.push(disposer); return disposer; },
  };
  const host = { getDshRuntimeVersion: () => '0.2.1-rc.2', createUserMessage: (input: { content: Array<{ type: string; text: string }>; source: unknown }) => Object.freeze({ ...input, id: randomUUID(), role: 'user' }) };
  const bridge = await mountDshBridge(ctx, host, { home });
  cleanup.push(async () => { for (const dispose of effects.reverse()) await dispose(); });
  const dir = join(home, '.crosschat', 'dsh', 'instances');
  const [filename] = await readdir(dir);
  const file = join(dir, filename);
  const registration = JSON.parse(await readFile(file, 'utf8'));
  const headers = { authorization: `Bearer ${registration.token}` };
  return { home, dir, file, registration, headers, bridge, received, agents, agent, effects, ctx, host };
}

describe('DSH Host bridge', () => {
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
});
