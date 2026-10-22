import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTcpManagement } from '../src/application/tcp/management.js';
import type { TcpManagementConnection } from '../src/application/tcp/management.js';
import { performLocalManagement } from '../src/application/tcp/local-management.js';
import type { TcpStar } from '../src/application/tcp/model.js';

const directories: string[] = [];
const star: TcpStar = { id: 'actual-reader-star-row-id', contextId: 'tcp:configured', starId: 'full-star-id', name: 'fixture', revision: 'a'.repeat(64), role: 'star-admin', host: 'fixture.invalid', port: 7260, health: 'reachable', onlineNodes: 0 };
function catalog(current: TcpStar = star) {
  const base = { contextId: current.contextId, completeness: 'complete' as const, observedAt: 100, errors: [] };
  return { readStars: vi.fn(async () => ({ ...base, role: current.role, configured: true, items: [current] })), readStar: vi.fn(async () => ({ ...base, star: current, machines: [], members: [], credentials: [] })) };
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('TCP management lifecycle and result boundaries', () => {
  it('closes an oversized controlled admin-pipe receipt promptly without cold writes', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'crosschat-tcp-admin-limit-')); directories.push(baseDir); mkdirSync(join(baseDir, 'tcp'));
    const file = join(baseDir, 'tcp', 'broker.json'); writeFileSync(file, JSON.stringify({ port: 7260, stars: [{ starId: star.starId, name: 'before', nodes: [], roster: [] }] }));
    const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\crosschat-tcp-management-fixture-${randomUUID()}` : join(baseDir, 'controlled.sock');
    const sockets = new Set<Socket>();
    let sent!: () => void;
    const payloadSent = new Promise<void>((resolve) => { sent = resolve; });
    const server = createServer((socket) => {
      sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
      socket.once('data', () => { socket.write(Buffer.alloc(2 * 1024 * 1024 + 1, 120)); sent(); });
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(pipe, resolve); });
    const operation = performLocalManagement({ op: 'set-name', starId: star.starId, name: 'after' }, { baseDir, readStatus: async () => ({ state: 'running', pid: 1234, port: 7260, adminPipe: pipe }), processes: () => [{ pid: 1234, cmdline: 'controlled/dist/cli.js serve' }], alive: () => true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await payloadSent;
      const result = await Promise.race([operation, new Promise<'still-waiting'>((resolve) => { timer = setTimeout(() => resolve('still-waiting'), 2_000); })]);
      expect(result).not.toBe('still-waiting');
      expect(result).toMatchObject({ kind: 'failed' });
      expect(JSON.parse(readFileSync(file, 'utf8')).stars[0].name).toBe('before');
    } finally {
      clearTimeout(timer); for (const socket of sockets) socket.destroy(); await operation;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 10_000);

  it('returns the newly created star actual catalog row ID instead of a different full-ID selector', async () => {
    const before: TcpStar = { ...star, contextId: 'local', role: 'broker-owner' }; const source = catalog(before);
    const created = { ...before, id: 'new-actual-catalog-row', starId: 'new-full-star-id', name: 'newstar' };
    const executeLocal = vi.fn(async () => { source.readStar.mockResolvedValue({ contextId: 'local', completeness: 'complete', observedAt: 101, errors: [], star: created, machines: [], members: [], credentials: [] }); return { kind: 'applied' as const, mode: 'cold' as const, value: { starId: created.starId, stars: 2 } }; });
    const service = createTcpManagement({ baseDir: '/never-read-real-user', catalog: source, executeLocal });
    const request = { contextId: 'local', action: 'add-star' as const, values: { name: 'newstar' } }; const preview = await service.preview(request);
    expect(await service.apply({ ...request, expectedPreviewRevision: preview.revision })).toMatchObject({ kind: 'applied', selectedId: created.id });
  });

  it('releases a late authenticated connection after cancellation without issuing a write', async () => {
    const owner = new AbortController(); let started!: () => void; let finish!: (value: TcpManagementConnection) => void;
    const opening = new Promise<TcpManagementConnection>((resolve) => { finish = resolve; }); const pending = new Promise<void>((resolve) => { started = resolve; });
    const connection = { starId: star.starId, request: vi.fn(async () => ({})), removeMember: vi.fn(), close: vi.fn() };
    const service = createTcpManagement({ baseDir: '/never-read-real-user', catalog: catalog(), openRemote: async () => { started(); return opening; } });
    const request = { contextId: star.contextId, starId: star.starId, action: 'generate-node-key' as const, values: { count: '1', host: 'reachable.invalid' }, signal: owner.signal }; const preview = await service.preview(request);
    const result = service.apply({ ...request, expectedPreviewRevision: preview.revision }); await pending; owner.abort();
    expect(await result).toMatchObject({ kind: 'rejected' }); finish(connection); await Promise.resolve(); await Promise.resolve();
    expect(connection.close).toHaveBeenCalled(); expect(connection.request).not.toHaveBeenCalled();
  });

  it('closes a request already sent on cancellation and reports an unconfirmed outcome', async () => {
    const owner = new AbortController(); let started!: () => void; let rejectReply!: (error: Error) => void;
    const pending = new Promise<void>((resolve) => { started = resolve; });
    const reply = new Promise<unknown>((_resolve, reject) => { rejectReply = reject; });
    const connection = { starId: star.starId, request: vi.fn(async () => { started(); return reply; }), removeMember: vi.fn(), close: vi.fn(() => rejectReply(new Error('controlled closed'))) };
    const service = createTcpManagement({ baseDir: '/never-read-real-user', catalog: catalog(), openRemote: async () => connection });
    const request = { contextId: star.contextId, starId: star.starId, action: 'generate-node-key' as const, values: { count: '1', host: 'reachable.invalid' }, signal: owner.signal }; const preview = await service.preview(request);
    const result = service.apply({ ...request, expectedPreviewRevision: preview.revision }); await pending; owner.abort();
    expect(await result).toMatchObject({ kind: 'uncertain' }); expect(connection.close).toHaveBeenCalled(); expect(connection.request).toHaveBeenCalledOnce();
  });
});
