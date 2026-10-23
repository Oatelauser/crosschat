import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSshApplication } from '../src/application/ssh/index.js';
import type { SshApplicationOptions } from '../src/application/ssh/index.js';

class ControlledSsh extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn(() => true);
  complete() {
    this.stdout.write(JSON.stringify({ op: 'list', providers: [], page: { items: [], nextCursor: null, completeness: 'complete', errors: [], observedAt: 1 } }));
    this.emit('close', 0);
  }
}
const homes: string[] = [];
afterEach(async () => { await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))); });
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'crosschat-ssh-owner-')); homes.push(home);
  await mkdir(join(home, '.ssh'));
  await writeFile(join(home, '.ssh', 'config'), 'Host external\n');
  return home;
}
const contexts = async () => ({ items: [{ id: 'ssh:fixture', kind: 'ssh', name: 'fixture', target: 'fixture', identityHint: 'isolated', attributes: {} }], errors: [], observedAt: 1 });
function expectNoOwnedListeners(child: ControlledSsh) {
  expect(child.listenerCount('close')).toBe(0);
  expect(child.listenerCount('error')).toBe(0);
  for (const stream of [child.stdin, child.stdout, child.stderr]) expect(stream.listenerCount('error')).toBe(0);
}

describe('SSH target identity and process completion', () => {
  it('keeps a managed profile distinct from an external Host with the same synthetic SSH alias', async () => {
    const home = await fixture();
    const spawn = vi.fn<NonNullable<SshApplicationOptions['spawn']>>(() => { const child = new ControlledSsh(); queueMicrotask(() => child.complete()); return child; });
    const application = createSshApplication({ home, spawn });
    try {
      const request = { operation: 'create' as const, profile: { name: 'Managed target', host: 'managed.example', user: 'managed-user', port: 2222 } };
      const preview = await application.configuration.preview(request);
      const saved = await application.configuration.apply({ ...request, expectedRevision: preview.revision });
      const managed = (await application.list()).items.find((item) => item.id === saved.contextId)!;
      await writeFile(join(home, '.ssh', 'config'), `Host ${managed.target}\n  HostName external.example\n`);
      const listed = await application.list();
      expect(new Set(listed.items.map((item) => item.id)).size).toBe(listed.items.length);
      expect(managed.id).not.toBe(`ssh:${encodeURIComponent(managed.target)}`);

      expect((await application.inspect({ contextId: managed.id })).completeness).toBe('complete');
      expect(spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['HostName=managed.example', '-l', 'managed-user', '-p', '2222']));
      expect((await application.inspect({ contextId: `ssh:${encodeURIComponent(managed.target)}` })).completeness).toBe('complete');
      expect(spawn.mock.calls[1][1]).toEqual(['-T', '-o', 'BatchMode=yes', '--', managed.target, 'crosschat', 'discover']);
    } finally { await application.dispose(); }
  });

  it.each(['discovery', 'doctor'] as const)('waits for the owned %s child close before cancellation and disposal complete', async (operation) => {
    const child = new ControlledSsh();
    const spawn = vi.fn(() => child);
    const application = createSshApplication({ spawn, readContexts: contexts });
    let readSettled = false; let disposed = false;
    const pending = (operation === 'discovery' ? application.inspect({ contextId: 'ssh:fixture' }) : application.doctor({ contextId: 'ssh:fixture' })).then((result) => { readSettled = true; return result; });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    const disposing = application.dispose().then(() => { disposed = true; });
    try {
      await vi.waitFor(() => expect(child.kill).toHaveBeenCalledOnce());
      await delay(25);
      expect(readSettled).toBe(false); expect(disposed).toBe(false);
      child.emit('close', null);
      expect((await pending).completeness).toBe('cancelled');
      await disposing;
      expectNoOwnedListeners(child);
    } finally { child.emit('close', null); await pending; await disposing; }
  });

  it('bounds a child that never closes, reports incomplete cleanup, and removes its owned listeners', async () => {
    const child = new ControlledSsh();
    const spawn = vi.fn(() => child);
    const application = createSshApplication({ spawn, readContexts: contexts });
    const pending = application.inspect({ contextId: 'ssh:fixture' });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    const disposing = application.dispose().then(() => ({ succeeded: true }), (error: unknown) => ({ error }));
    try {
      const result = await Promise.race([pending, delay(1500).then(() => null)]);
      expect(result).toMatchObject({ completeness: 'unavailable', errors: [expect.objectContaining({ message: expect.stringMatching(/回收|清理|释放/) })] });
      expect(await disposing).toMatchObject({ error: expect.objectContaining({ message: expect.stringMatching(/回收|清理|释放/) }) });
      expectNoOwnedListeners(child);
    } finally { child.emit('close', null); await pending; await disposing; }
  });
});
