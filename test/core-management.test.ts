import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendAdminRequest } from '../src/application/management/transport.js';
import { executeRemoteManagement } from '../src/application/management/remote.js';
import {
  addStar,
  generateAdminKey,
  generateKeys,
  removeAdminKey,
  removeNode,
  removeStar,
  renameStar,
  setDisplayName,
  type ManagementDeps,
} from '../src/application/management/local.js';
import { loadBrokerFile, registryFileOf, writeBrokerFile } from '../src/serve/registry.js';

const roots: string[] = [];
function fixture(): { deps: ManagementDeps; file: string } {
  const baseDir = mkdtempSync(join(tmpdir(), 'crosschat-core-management-'));
  roots.push(baseDir);
  const file = registryFileOf(baseDir);
  writeBrokerFile(file, { stars: [{ starId: 'stable-star-id', name: 'before', nodes: [], roster: [] }] });
  return { file, deps: { baseDir, machineId: () => undefined, hostname: () => 'fixture-machine' } };
}

class FakeSocket extends EventEmitter {
  destroyed = false;
  writes: string[] = [];
  write(text: string): void { this.writes.push(text); }
  destroy(): void { this.destroyed = true; }
}

afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('local management application', () => {
  it('renames a stable star ID independently and preserves neighbouring state', async () => {
    const { deps, file } = fixture();
    const result = await renameStar({ starId: 'stable-star-id', name: 'after' }, {
      ...deps, adminTransport: async () => ({ kind: 'cold' }),
    });
    expect(result).toMatchObject({ kind: 'applied', mode: 'cold' });
    expect(loadBrokerFile(file).stars[0]).toMatchObject({ starId: 'stable-star-id', name: 'after', nodes: [], roster: [] });
  });

  it('uses successful hot receipts without mutating the local registry', async () => {
    const { deps, file } = fixture();
    const before = readFileSync(file, 'utf8');
    const transport = vi.fn(async () => ({ kind: 'hot' as const, reply: { ok: true } }));
    expect(await renameStar({ starId: 'stable-star-id', name: 'after' }, { ...deps, adminTransport: transport })).toMatchObject({ kind: 'applied', mode: 'hot' });
    expect(transport).toHaveBeenCalledWith({ op: 'set-name', starId: 'stable-star-id', name: 'after' });
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it.each(['failed', 'rejected'] as const)('never cold-writes after a %s hot operation', async (kind) => {
    const { deps, file } = fixture();
    const before = readFileSync(file, 'utf8');
    const d: ManagementDeps = {
      ...deps,
      adminTransport: async () => kind === 'failed'
        ? { kind: 'failed', error: 'receipt lost; verify before retry' }
        : { kind: 'hot', reply: { ok: false, error: 'permission denied' } },
    };
    const operations = [
      () => renameStar({ starId: 'stable-star-id', name: 'after' }, d),
      () => addStar({ name: 'new-star' }, d),
      () => removeStar({ starId: 'stable-star-id' }, d),
      () => setDisplayName({ name: 'new-machine' }, d),
      () => generateKeys({ starId: 'stable-star-id', n: 1, host: 'fixture-host', port: 7260 }, d),
      () => removeNode({ starId: 'stable-star-id', label: 'node-1' }, d),
      () => generateAdminKey({ starId: 'stable-star-id', label: 'ops' }, d),
      () => removeAdminKey({ starId: 'stable-star-id', label: 'ops' }, d),
    ];
    for (const operation of operations) expect(await operation()).toMatchObject({ kind });
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('returns typed generated credentials and preserves remove-node credential-only semantics', async () => {
    const { deps, file } = fixture();
    const d = { ...deps, adminTransport: async () => ({ kind: 'cold' as const }) };
    const keys = await generateKeys({ starId: 'stable-star-id', n: 1, host: 'fixture-host', port: 7260 }, d);
    expect(keys).toMatchObject({ kind: 'applied', mode: 'cold', value: { results: [{ label: 'node-1', nodeJsonContent: expect.any(String) }] } });
    const admin = await generateAdminKey({ starId: 'stable-star-id', label: 'ops' }, d);
    expect(admin).toMatchObject({ kind: 'applied', value: { result: { label: 'ops', adminKey: expect.any(String) } } });
    expect(await removeNode({ starId: 'stable-star-id', label: 'node-1' }, d)).toMatchObject({ kind: 'applied', value: { removed: true } });
    expect(loadBrokerFile(file).stars[0]?.nodes.map((node) => node.label)).toEqual(['ops']);
  });

  it('rejects malformed successful key receipts without using the cold path', async () => {
    const { deps, file } = fixture();
    const before = readFileSync(file, 'utf8');
    const result = await generateKeys({ starId: 'stable-star-id', n: 1, host: 'fixture-host', port: 7260 }, {
      ...deps, adminTransport: async () => ({ kind: 'hot', reply: { ok: true, results: [{ label: 'incomplete' }] } }),
    });
    expect(result).toMatchObject({ kind: 'failed' });
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
});

describe('local admin transport', () => {
  it('keeps pre-connect errors cold, but classifies connected socket errors as failed', async () => {
    const { deps } = fixture();
    const beforeConnect = new FakeSocket();
    const common = { ...deps, readStatus: () => ({ state: 'running', pid: 123, adminPipe: 'fixture-pipe' }), isProcessAlive: () => true };
    expect(await sendAdminRequest({ ...common, connect: () => {
      queueMicrotask(() => beforeConnect.emit('error', new Error('connection refused')));
      return beforeConnect;
    } }, { op: 'set-name', starId: 'stable-star-id', name: 'after' })).toEqual({ kind: 'cold' });
    const connected = new FakeSocket();
    expect(await sendAdminRequest({ ...common, connect: (_pipe, onConnect) => {
      queueMicrotask(() => { onConnect(); connected.emit('error', new Error('receipt lost')); });
      return connected;
    } }, { op: 'set-name', starId: 'stable-star-id', name: 'after' })).toMatchObject({ kind: 'failed' });
    expect(connected.writes).toHaveLength(1);
    expect(connected.destroyed).toBe(true);
  });

  it('bounds missing receipts and destroys the socket without returning cold', async () => {
    vi.useFakeTimers();
    const { deps } = fixture();
    const socket = new FakeSocket();
    const result = sendAdminRequest({ ...deps,
      readStatus: () => ({ state: 'running', pid: 123, adminPipe: 'fixture-pipe' }), isProcessAlive: () => true,
      connect: (_pipe, onConnect) => { queueMicrotask(onConnect); return socket; },
    }, { op: 'set-name', starId: 'stable-star-id', name: 'after' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toMatchObject({ kind: 'failed', error: expect.stringContaining('绝不回落直写') });
    expect(socket.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not cold-write when a real local fake admin socket closes after receiving a request', async () => {
    const { deps, file } = fixture();
    const before = readFileSync(file, 'utf8');
    const pipe = process.platform === 'win32'
      ? `\\\\.\\pipe\\crosschat-management-test-${process.pid}-${Date.now()}`
      : join(deps.baseDir, 'admin.sock');
    mkdirSync(deps.baseDir, { recursive: true });
    let received = '';
    const server = createServer((socket) => {
      socket.on('data', (chunk) => { received += chunk.toString(); socket.destroy(); });
      socket.on('error', () => {});
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(pipe, resolve); });
    try {
      const result = await renameStar({ starId: 'stable-star-id', name: 'after' }, {
        ...deps, adminTransport: (request) => sendAdminRequest({ ...deps,
          readStatus: () => ({ state: 'running', pid: process.pid, adminPipe: pipe }),
        }, request),
      });
      expect(received).toContain('"op":"set-name"');
      expect(result).toMatchObject({ kind: 'failed' });
      expect(readFileSync(file, 'utf8')).toBe(before);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('remote management adapter', () => {
  const entry = { host: 'fixture-host', port: 7260, key: 'fixture-member-key', name: 'cloud' };

  it('keeps read requests on member credentials and releases connections after a rejected request', async () => {
    const close = vi.fn();
    const openMember = vi.fn(async () => ({ request: async () => { throw new Error('remote unavailable'); }, close }));
    const openAdmin = vi.fn();
    await expect(executeRemoteManagement(entry, { op: 'list-nodes' }, { openMember, openAdmin })).rejects.toMatchObject({ code: 'TCP_TRANSPORT_FAILED' });
    expect(openMember).toHaveBeenCalledOnce();
    expect(openAdmin).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it('requires an admin key for remote mutation and uses the admin challenge transport when present', async () => {
    const request = vi.fn(async () => ({ op: 'admin-op-result', id: 'fixture', action: 'remove-node', removed: true }));
    const close = vi.fn();
    const openAdmin = vi.fn(async () => ({ request, close }));
    await expect(executeRemoteManagement(entry, { op: 'remove-node', label: 'node-1' }, { openAdmin })).rejects.toMatchObject({ code: 'USAGE' });
    expect(openAdmin).not.toHaveBeenCalled();
    expect(await executeRemoteManagement({ ...entry, adminKey: 'fixture-admin-key' }, { op: 'remove-node', label: 'node-1' }, { openAdmin })).toMatchObject({ removed: true });
    expect(request).toHaveBeenCalledWith('remove-node', { label: 'node-1' });
    expect(close).toHaveBeenCalledOnce();
  });
});
