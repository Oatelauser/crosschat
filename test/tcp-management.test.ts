import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTcpManagement } from '../src/application/tcp/management.js';
import type { TcpManagementRequest } from '../src/application/tcp/management.js';
import type { TcpStarResult, TcpStarsResult } from '../src/application/tcp/model.js';

const fullMachine = 'a'.repeat(32);
const contextId = 'local';
const star = { id: 'star-row-full', contextId, starId: 'full-star-id', name: 'fixture-star', revision: 'a'.repeat(64), role: 'broker-owner' as const, host: 'fixture.invalid', port: 7260, health: 'reachable' as const, onlineNodes: 1 };
const credential = { id: 'credential-row-full', contextId, starId: star.starId, kind: 'node' as const, label: 'node-1', revision: 'b'.repeat(64), machineId: fullMachine, machineName: '本机fixture', addedAt: '2026-10-22T00:00:00.000Z' };
const member = { id: 'member-row-full', contextId, starId: star.starId, machineId: fullMachine, machineName: '本机fixture', nativeId: 'opaque/full/会话', providerId: 'futuretool', name: null, presence: 'online' as const, temporary: false };
const base = { contextId, completeness: 'complete' as const, observedAt: 100, errors: [] };
function fixture() {
  const current: TcpStarResult = { ...base, star: { ...star }, machines: [{ id: 'machine-row-full', contextId, starId: star.starId, machineId: fullMachine, mid8: fullMachine.slice(0, 8), name: '本机fixture', labels: [credential.label], presence: 'online', addedAt: credential.addedAt }], members: [{ ...member }], credentials: [{ ...credential }] };
  const stars: TcpStarsResult = { ...base, role: 'broker-owner', configured: true, items: [current.star!] };
  const catalog = { readStars: vi.fn(async () => stars), readStar: vi.fn(async () => current) };
  const executeLocal = vi.fn(async () => ({ kind: 'applied' as const, mode: 'hot' as const, value: undefined }));
  const remote = { starId: star.starId, request: vi.fn(async () => ({ op: 'admin-op-result', id: 'controlled', ok: true })), removeMember: vi.fn(async () => ({ op: 'member-remove-exact-result' as const, id: 'controlled', ok: true, removed: true })), close: vi.fn() };
  const openRemote = vi.fn(async () => remote);
  const service = createTcpManagement({ baseDir: '/never-read-real-user', catalog, executeLocal, openRemote, machineId: () => fullMachine });
  const request = (action: TcpManagementRequest['action'], values: Record<string, string> = {}): TcpManagementRequest => ({ contextId, action, starId: star.starId, targetId: current.star!.id, values, signal: new AbortController().signal });
  async function apply(request: TcpManagementRequest) { const preview = await service.preview(request); return service.apply({ ...request, expectedPreviewRevision: preview.revision }); }
  return { current, stars, catalog, executeLocal, remote, openRemote, service, request, apply };
}
afterEach(() => vi.restoreAllMocks());

describe('TCP management previews and fixed targets', () => {
  it('previews complete scoped fields and impacts without issuing management writes or revealing secrets', async () => {
    const f = fixture(); const preview = await f.service.preview(f.request('rename-star', { name: 'renamed' }));
    expect(preview).toMatchObject({ enabled: true, revision: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(preview.fields).toContainEqual(expect.objectContaining({ id: 'name', required: true }));
    expect(JSON.stringify(preview.impact)).toContain(star.starId);
    expect(f.executeLocal).not.toHaveBeenCalled(); expect(f.remote.request).not.toHaveBeenCalled();
  });

  it('requires the exact preview revision and refuses changed target state before writing', async () => {
    const f = fixture(); const request = f.request('rename-star', { name: 'renamed' }); const preview = await f.service.preview(request);
    expect(await f.service.apply({ ...request, expectedPreviewRevision: 'wrong' })).toMatchObject({ kind: 'rejected' });
    f.current.star!.revision = 'c'.repeat(64);
    expect(await f.service.apply({ ...request, expectedPreviewRevision: preview.revision })).toMatchObject({ kind: 'rejected' });
    expect(f.executeLocal).not.toHaveBeenCalled();
  });

  it('uses complete immutable star identity for local rename and does not cold-fallback after a failed hot receipt', async () => {
    const f = fixture(); const request = f.request('rename-star', { name: 'renamed' });
    expect(await f.apply(request)).toMatchObject({ kind: 'applied', mode: 'hot' });
    expect(f.executeLocal).toHaveBeenCalledWith({ op: 'set-name', starId: star.starId, name: 'renamed' }, request.signal);
    f.executeLocal.mockResolvedValue({ kind: 'failed', error: 'capability-pipe-must-not-leak' });
    const result = await f.apply(request);
    expect(result).toMatchObject({ kind: 'uncertain', message: expect.stringMatching(/核实/) });
    expect(JSON.stringify(result)).not.toContain('capability-pipe-must-not-leak');
  });

  it('denies broker-only operations in a remote star-admin context and always rebinds the connected full star ID', async () => {
    const f = fixture(); f.current.contextId = 'tcp:configured'; f.current.star!.contextId = 'tcp:configured'; f.current.star!.role = 'star-admin';
    const remote = { ...f.request('rename-star', { name: 'renamed' }), contextId: 'tcp:configured' };
    expect(await f.service.preview(remote)).toMatchObject({ enabled: false });
    f.remote.starId = 'different-full-star';
    expect(await f.apply({ ...remote, action: 'generate-node-key', values: { count: '1', host: 'reachable.invalid' } })).toMatchObject({ kind: 'rejected' });
    expect(f.executeLocal).not.toHaveBeenCalled(); expect(f.remote.request).not.toHaveBeenCalled();
    expect(f.remote.close).toHaveBeenCalled();
  });

  it('keeps generated credentials exclusively in the one-use secret result and validates the returned full scope', async () => {
    const f = fixture();
    const key = 'isolated-new-node-secret';
    const configuration = JSON.stringify({ brokers: [{ host: 'reachable.invalid', port: 7260, starId: star.starId, name: star.name, key }] });
    f.executeLocal.mockResolvedValue({ kind: 'applied', mode: 'hot', value: { results: [{ label: 'node-2', key, nodeJsonContent: configuration }] } });
    const request = f.request('generate-node-key', { count: '1', host: 'reachable.invalid' });
    const result = await f.apply(request);
    expect(result).toMatchObject({ kind: 'applied', secret: { kind: 'node-configs', materials: [{ content: configuration, connectCommand: expect.any(String) }] } });
    expect(JSON.stringify({ ...result, secret: undefined })).not.toContain(key);
    expect(JSON.stringify(await f.service.preview(request))).not.toContain(key);
    f.executeLocal.mockResolvedValue({ kind: 'applied', mode: 'hot', value: { results: [{ label: 'node-2', key, nodeJsonContent: JSON.stringify({ brokers: [{ host: 'reachable.invalid', port: 7260, starId: 'different-star', key }] }) }] } });
    const malformed = await f.apply(request);
    expect(malformed).toMatchObject({ kind: 'uncertain' });
    expect(malformed.secret).toBeUndefined();
  });

  it('requires a nonwildcard destination for new machines instead of silently copying a local bind address', async () => {
    const f = fixture(); f.current.star!.host = '0.0.0.0';
    const preview = await f.service.preview(f.request('generate-node-key'));
    expect(preview.fields.find((field) => field.id === 'host')).toMatchObject({ required: true, initialValue: '' });
    for (const host of ['0.0.0.0', 'localhost', '127.0.0.1']) expect(await f.service.preview(f.request('generate-node-key', { count: '1', host }))).toMatchObject({ enabled: false });
    expect(f.executeLocal).not.toHaveBeenCalled();
  });

  it('uses the existing atomic member removal on its complete machine/provider/native identity and releases the connection', async () => {
    const f = fixture(); const request = { ...f.request('remove-member'), targetId: member.id };
    expect(await f.apply(request)).toMatchObject({ kind: 'applied' });
    expect(f.remote.removeMember).toHaveBeenCalledWith({ sessionId: member.nativeId, machine: fullMachine, tool: 'futuretool' });
    expect(f.remote.close).toHaveBeenCalled();
    f.remote.removeMember.mockResolvedValue({ op: 'member-remove-exact-result', id: 'controlled', ok: false, removed: true, code: 'PERSIST_FAILED' });
    expect(await f.apply(request)).toMatchObject({ kind: 'uncertain' });
  });

  it('cancels before issuing writes and rejects unsupported machine identities instead of impersonating a remote user', async () => {
    const f = fixture(); const owner = new AbortController(); owner.abort();
    expect(await f.service.preview({ ...f.request('rename-star', { name: 'renamed' }), signal: owner.signal })).toMatchObject({ enabled: false });
    const request = { ...f.request('set-show-name', { name: 'renamed-machine', scope: 'star' }), targetId: 'different-machine-row' };
    expect(await f.service.preview(request)).toMatchObject({ enabled: false });
    expect(f.executeLocal).not.toHaveBeenCalled();
  });

  it('removes the selected single node credential with its exact revision and complete binding', async () => {
    const f = fixture(); f.executeLocal.mockResolvedValue({ kind: 'applied', mode: 'hot', value: { removed: true } });
    const request = { ...f.request('remove-node'), targetId: 'machine-row-full' };
    expect(await f.apply(request)).toMatchObject({ kind: 'applied', mode: 'hot' });
    expect(f.executeLocal).toHaveBeenCalledWith({ op: 'remove-node', starId: star.starId, label: credential.label, expected: { credentialRevision: credential.revision, machineId: fullMachine } }, request.signal);
    f.current.credentials.push({ ...credential, id: 'other-credential-id', label: 'node-2' });
    expect(await f.service.preview(request)).toMatchObject({ enabled: false, reason: expect.stringMatching(/逐把/) });
  });

  it('revokes only the complete selected admin credential and treats missing deletion proof as uncertain', async () => {
    const f = fixture();
    const admin = { ...credential, id: 'admin-row-full', kind: 'admin' as const, label: 'admin-long', machineId: null, machineName: null };
    f.current.credentials.push(admin); f.executeLocal.mockResolvedValue({ kind: 'applied', mode: 'hot', value: { removed: admin.label } });
    const request = { ...f.request('revoke-credential'), targetId: admin.id, targetRevision: admin.revision };
    expect(await f.apply(request)).toMatchObject({ kind: 'applied' });
    expect(f.executeLocal).toHaveBeenCalledWith({ op: 'remove-admin-key', starId: star.starId, label: admin.label, expected: { credentialRevision: admin.revision, machineId: null } }, request.signal);
    f.executeLocal.mockResolvedValue({ kind: 'applied', mode: 'hot', value: {} });
    expect(await f.apply(request)).toMatchObject({ kind: 'uncertain' });
  });

  it('shows the complete star destruction impact and sends its exact static revision', async () => {
    const f = fixture(); f.executeLocal.mockResolvedValue({ kind: 'applied', mode: 'hot', value: { removed: { name: star.name, nodes: 1, roster: 1 } } });
    const request = f.request('remove-star'); const preview = await f.service.preview(request);
    expect(preview.enabled).toBe(true);
    expect(JSON.stringify(preview.impact)).toContain(fullMachine);
    expect(JSON.stringify(preview.impact)).toContain(member.nativeId);
    expect(await f.service.apply({ ...request, expectedPreviewRevision: preview.revision })).toMatchObject({ kind: 'applied' });
    expect(f.executeLocal).toHaveBeenCalledWith({ op: 'remove-star', starId: star.starId, expected: { starRevision: star.revision } }, request.signal);
  });

  it('binds show-name without a selection to the unique proven local machine and reports cold activation honestly', async () => {
    const f = fixture(); f.executeLocal.mockResolvedValue({ kind: 'applied', mode: 'cold', value: undefined });
    const request = { ...f.request('set-show-name', { scope: 'star', name: '本机新名' }), targetId: undefined };
    expect(await f.apply(request)).toMatchObject({ kind: 'applied', mode: 'cold', message: expect.stringMatching(/重连/) });
    expect(f.executeLocal).toHaveBeenCalledWith({ op: 'set-showname', starId: star.starId, name: '本机新名' }, request.signal);
  });
});
