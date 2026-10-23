import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTcpManagement } from '../src/application/tcp/management.js';
import type { TcpManagementAction, TcpManagementRequest } from '../src/application/tcp/management.js';
import type { TcpRole, TcpStarResult } from '../src/application/tcp/model.js';

const machineId = '11111111000000000000000000000001';
const otherMachine = '22222222000000000000000000000002';
const starId = 'workspace-star';

function fixture(role: TcpRole = 'broker-owner') {
  const contextId = role === 'broker-owner' ? 'local' : 'tcp:workspace';
  const page: TcpStarResult = { contextId, completeness: 'complete', errors: [], observedAt: 1,
    star: { id: 'star-row', contextId, starId, name: 'alpha', revision: 'a'.repeat(64), role, host: 'fixture.invalid', port: 7260, health: 'reachable', onlineNodes: 1 },
    machines: [{ id: 'machine-row', contextId, starId, machineId, mid8: machineId.slice(0, 8), name: 'old-name', labels: ['node-a', 'node-b'], presence: 'online', addedAt: '2026-01-01' }],
    members: [{ id: 'member-row', contextId, starId, machineId, machineName: 'old-name', nativeId: 'persistent-session', providerId: 'futuretool', name: 'member', presence: 'online', temporary: false }],
    credentials: [
      { id: 'credential-a', contextId, starId, kind: 'node', label: 'node-a', revision: '1'.repeat(64), machineId, machineName: 'old-name', addedAt: '2026-01-01' },
      { id: 'credential-b', contextId, starId, kind: 'node', label: 'node-b', revision: '2'.repeat(64), machineId, machineName: 'old-name', addedAt: '2026-01-01' },
      { id: 'unbound', contextId, starId, kind: 'node', label: 'unused', revision: '3'.repeat(64), machineId: null, machineName: null, addedAt: '2026-01-01' },
      { id: 'admin', contextId, starId, kind: 'admin', label: 'operator', revision: '4'.repeat(64), machineId: null, machineName: null, addedAt: '2026-01-01' },
      { id: 'other-machine', contextId, starId, kind: 'node', label: 'other', revision: '5'.repeat(64), machineId: otherMachine, machineName: 'other', addedAt: '2026-01-01' },
    ] };
  const catalog = { readStar: vi.fn(async () => page), readStars: vi.fn(async () => ({ ...page, configured: true, role, items: [page.star!] })) };
  const executeLocal = vi.fn(async () => ({ kind: 'applied' as const, mode: 'hot' as const, value: { removed: true, machineId, removedLabels: ['node-a', 'node-b'] } }));
  const remote = { starId, request: vi.fn(async () => ({ ok: true, removed: true, machineId, removedLabels: ['node-a', 'node-b'] })),
    removeMember: vi.fn(async () => ({ op: 'member-remove-exact-result' as const, id: 'fixture', ok: true, removed: true })), close: vi.fn() };
  const service = createTcpManagement({ baseDir: '/never-read-user-data', catalog, executeLocal, openRemote: async () => remote, machineId: () => otherMachine });
  function request(action: TcpManagementAction, values: Record<string, string> = {}): TcpManagementRequest {
    return { contextId, action, starId, targetId: 'machine-row', values, signal: new AbortController().signal };
  }
  async function apply(selected: TcpManagementRequest) { const preview = await service.preview(selected); return service.apply({ ...selected, expectedPreviewRevision: preview.revision }); }
  return { page, catalog, executeLocal, remote, service, request, apply };
}
afterEach(() => vi.restoreAllMocks());

describe('workspace atomic machine removal', () => {
  it('previews all bound node keys and submits a single complete machine transaction', async () => {
    const f = fixture(); const request = f.request('remove-node');
    const preview = await f.service.preview(request);
    expect(preview.enabled).toBe(true);
    expect(JSON.stringify(preview.impact)).toContain('node-a'); expect(JSON.stringify(preview.impact)).toContain('node-b');
    expect(await f.apply(request)).toMatchObject({ kind: 'applied' });
    expect(f.executeLocal).toHaveBeenCalledExactlyOnceWith({ op: 'remove-machine', starId, machineId, expected: { machineRevision: expect.stringMatching(/^[a-f0-9]{64}$/) } }, request.signal);
  });

  it('binds the complete key set even when a catalog returns an unchanged star revision', async () => {
    const f = fixture(); const request = f.request('remove-node'); const before = await f.service.preview(request);
    expect(before.enabled).toBe(true);
    f.page.credentials.push({ ...f.page.credentials[0], id: 'newly-bound', label: 'node-new', revision: '6'.repeat(64) });
    expect(await f.service.apply({ ...request, expectedPreviewRevision: before.revision })).toMatchObject({ kind: 'rejected' });
    expect(f.executeLocal).not.toHaveBeenCalled();
  });

  it('uses the authenticated star-admin channel and requires proof of the entire removed set', async () => {
    const f = fixture('star-admin'); const request = f.request('remove-node');
    expect(await f.apply(request)).toMatchObject({ kind: 'applied' });
    expect(f.remote.request).toHaveBeenCalledExactlyOnceWith('remove-machine', { machineId, expected: { machineRevision: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    expect(f.executeLocal).not.toHaveBeenCalled(); expect(f.remote.close).toHaveBeenCalled();
    f.remote.request.mockResolvedValue({ ok: true, removed: true, machineId, removedLabels: ['node-a'] });
    expect(await f.apply(request)).toMatchObject({ kind: 'uncertain' });
  });

  it('continues to deny ordinary-member destructive access', async () => {
    const f = fixture('member'); expect(await f.service.preview(f.request('remove-node'))).toMatchObject({ enabled: false });
    expect(f.executeLocal).not.toHaveBeenCalled(); expect(f.remote.request).not.toHaveBeenCalled();
  });
});

describe('workspace online peer naming', () => {
  it('previews the selected online peer and confines editing to its current-star name', async () => {
    const f = fixture('star-admin');
    const preview = await f.service.preview(f.request('rename-node', { name: 'peer-new' }));
    expect(preview.enabled).toBe(true);
    expect(preview.fields).toContainEqual(expect.objectContaining({ id: 'name', initialValue: 'old-name' }));
    expect(preview.fields.some((field) => field.id === 'scope')).toBe(false);
    expect(JSON.stringify(preview.impact)).toContain(machineId);
    expect(f.remote.request).not.toHaveBeenCalled();
  });

  it('rejects offline, wrong-target, global-scope and ordinary-member peer changes', async () => {
    const f = fixture('star-admin'); const request = f.request('rename-node', { name: 'peer-new' });
    f.page.machines[0].presence = 'offline'; expect(await f.service.preview(request)).toMatchObject({ enabled: false });
    f.page.machines[0].presence = 'online';
    expect(await f.service.preview({ ...request, targetId: 'another-machine' })).toMatchObject({ enabled: false });
    expect(await f.service.preview({ ...request, values: { name: 'peer-new', scope: 'global' } })).toMatchObject({ enabled: false });
    const ordinary = fixture('member'); expect(await ordinary.service.preview(ordinary.request('rename-node', { name: 'peer-new' }))).toMatchObject({ enabled: false });
    expect(f.executeLocal).not.toHaveBeenCalled(); expect(f.remote.request).not.toHaveBeenCalled();
  });

  it('requires remote proof that the exact peer saved and applied the requested current-star value', async () => {
    const f = fixture('star-admin'); const request = f.request('rename-node', { name: 'peer-new' });
    f.remote.request.mockResolvedValue({ ok: true, renamed: true, starId, machineId, showName: 'peer-new', saved: true, applied: true });
    expect(await f.apply(request)).toMatchObject({ kind: 'applied' });
    expect(f.remote.request).toHaveBeenCalledWith('rename-node', { machineId, name: 'peer-new' });
    expect(f.executeLocal).not.toHaveBeenCalled();
    f.remote.request.mockResolvedValue({ ok: true, renamed: true, starId, machineId, showName: 'peer-new', saved: true, applied: false });
    expect(await f.apply(request)).toMatchObject({ kind: 'uncertain' });
    expect(f.remote.close).toHaveBeenCalled();
  });

  it('uses the local broker management channel for peer naming without writing this TUI host showName', async () => {
    const f = fixture(); const request = f.request('rename-node', { name: '' });
    f.executeLocal.mockResolvedValue({ kind: 'applied', mode: 'hot', value: { renamed: true, starId, machineId, showName: '', saved: true, applied: true, name: 'peer-default' } });
    expect(await f.apply(request)).toMatchObject({ kind: 'applied' });
    expect(f.executeLocal).toHaveBeenCalledExactlyOnceWith({ op: 'rename-node', starId, machineId, name: '' }, request.signal);
  });
});
