import { describe, expect, it, vi } from 'vitest';
import type { TcpApplication, TcpCredential, TcpMachine, TcpMember, TcpSession, TcpStar, TcpStarResult, TcpSessionsResult } from '../src/application/tcp/model.js';
import type { TcpManagement } from '../src/application/tcp/management.js';
import type { TuiAction, TuiActionRequest, TuiPage, TuiResource } from '../src/tui/model.js';
import { createTcpResources } from '../src/tui/resources/tcp.js';

const local = { id: 'local', kind: 'local', label: '本机' };
const context = { id: 'tcp:opaque-context', kind: 'tcp', label: '配置星' };
const signal = () => new AbortController().signal;
const star: TcpStar = { id: 'star:stable-id', contextId: context.id, starId: 'full-star-id', name: 'current-star', revision: 'star-revision', role: 'star-admin', host: 'fixture.invalid', port: 7260, health: 'reachable', onlineNodes: 1 };
const machines: TcpMachine[] = [
  { id: 'machine:first-full', contextId: context.id, starId: star.starId, machineId: '12345678-first-full-machine', mid8: '12345678', name: '节点一', labels: ['host-a'], presence: 'online', addedAt: '2026-01-01T00:00:00Z' },
  { id: 'machine:second-full', contextId: context.id, starId: star.starId, machineId: '12345678-second-full-machine', mid8: '12345678', name: '节点二', labels: ['host-b'], presence: 'offline', addedAt: '2026-01-02T00:00:00Z' },
];
const credentials: TcpCredential[] = [
  { id: 'credential:bound', contextId: context.id, starId: star.starId, kind: 'node', label: 'host-a', revision: 'credential-rev-a', machineId: machines[0].machineId, machineName: machines[0].name, addedAt: '2026-01-01' },
  { id: 'credential:unused', contextId: context.id, starId: star.starId, kind: 'node', label: 'unused-node-key', revision: 'credential-rev-unused', machineId: null, machineName: null, addedAt: '2026-01-02' },
  { id: 'credential:admin', contextId: context.id, starId: star.starId, kind: 'admin', label: 'peer-admin', revision: 'credential-rev-admin', machineId: null, machineName: null, addedAt: '2026-01-03' },
];
function member(index: number, over: Partial<TcpMember> = {}): TcpMember {
  return { id: `member:${index}`, contextId: context.id, starId: star.starId, machineId: machines[index % 2].machineId, machineName: machines[index % 2].name,
    nativeId: 'same-native-id', providerId: index ? 'future-tool' : 'claude', name: index ? null : '保留名称', presence: index ? 'offline' : 'online', temporary: false, ...over };
}
function session(index: number, over: Partial<TcpSession> = {}): TcpSession {
  const roster = member(index);
  return { id: `session:${index}`, contextId: context.id, starId: star.starId, machineId: roster.machineId, mid8: '12345678', machineName: roster.machineName,
    nativeId: roster.nativeId, providerId: roster.providerId, name: roster.name, ref: { contextId: `node:${roster.machineId}`, providerId: roster.providerId!, nativeId: roster.nativeId },
    rawStatus: null, capabilities: null, attributes: {}, member: roster, membership: 'member', presence: roster.presence, discovered: false, ...over };
}
function fixtures(over: Partial<TcpStarResult> = {}) {
  const current: TcpStarResult = { contextId: context.id, star, machines, credentials, members: [member(0), member(1, { extendsName: 'old-name', extendsMachine: 'old-machine-full' })], completeness: 'complete', observedAt: 42, errors: [], ...over };
  const sessions: TcpSessionsResult = { contextId: context.id, star: current.star, scope: 'members', items: [session(0), session(1)], nodes: [], completeness: 'complete', observedAt: 43, errors: [] };
  const tcp = {
    readStars: vi.fn<TcpApplication['readStars']>(async () => ({ contextId: context.id, role: current.star?.role ?? null, configured: true, items: current.star ? [current.star] : [], completeness: current.completeness, observedAt: 41, errors: current.errors })),
    readStar: vi.fn<TcpApplication['readStar']>(async () => current),
    readSessions: vi.fn<TcpApplication['readSessions']>(async () => sessions),
  };
  const management = {
    preview: vi.fn<TcpManagement['preview']>(async () => ({ enabled: true, revision: 'confirmed-preview-revision', fields: [], impact: [{ label: '固定目标', value: star.starId }] })),
    apply: vi.fn<TcpManagement['apply']>(async () => ({ kind: 'applied', message: '实际操作已生效。' })),
  };
  return { tcp, management, current, sessions, resources: createTcpResources({ tcp, management }) };
}
function actions(resource: TuiResource, page: TuiPage): readonly TuiAction[] { return page.presentation?.actions ?? resource.actions; }
function request(resource: TuiResource, page: TuiPage, actionId: string, targetIndex?: number, values: Record<string, string> = {}): TuiActionRequest {
  const action = actions(resource, page).find((entry) => entry.id === actionId);
  if (!action) throw new Error(`Missing action ${actionId}`);
  return { action, target: targetIndex === undefined ? undefined : page.rows[targetIndex], context, route: { resourceId: resource.id, contextId: context.id, query: { starId: star.starId } }, values, signal: signal() };
}

describe('TCP resource lists and readonly navigation', () => {
  it('does not infer local broker authority from an unreadable star source', async () => {
    const f = fixtures();
    f.tcp.readStars.mockResolvedValueOnce({ contextId: local.id, role: null, configured: false, items: [], completeness: 'unavailable', observedAt: 1,
      errors: [{ source: 'broker-source', kind: 'unreadable', message: '无法读取', nextStep: '核对读取权限' }] });
    const page = await f.resources.stars.adapter.read({ context: local, route: { resourceId: 'stars', contextId: local.id }, signal: signal() });
    expect(page.completeness).toBe('unavailable');
    expect(page.actionAvailability?.['add-star']?.enabled).toBe(false);
    expect(JSON.stringify(page.detailViews?.info)).toContain('核对读取权限');
    expect(f.management.preview).not.toHaveBeenCalled();
  });

  it('enters a star through its machine list and retains exact IDs, capped columns and authenticated role context', async () => {
    const f = fixtures();
    const selectedSignal = signal();
    const page = await f.resources.stars.adapter.read({ context, route: { resourceId: 'stars', contextId: context.id }, signal: selectedSignal });
    expect(f.tcp.readStars).toHaveBeenCalledExactlyOnceWith({ contextId: context.id, signal: selectedSignal });
    expect(page.rows[0]).toMatchObject({ id: star.id, copyValue: star.starId, actionRoutes: { open: { resourceId: 'machines', contextId: context.id, query: { starId: star.starId } } } });
    expect(page.contextSummary?.permissionLabel).toContain('星管理员');
    expect(actions(f.resources.stars.resource, page).find((entry) => entry.shortcut === 'Enter')?.kind).toBe('navigate');
    expect(actions(f.resources.stars.resource, page).find((entry) => entry.shortcut === 'd')?.mutation).toBe(false);
    expect((page.presentation?.columns ?? f.resources.stars.resource.columns).every((column) => column.width > 0)).toBe(true);
    expect(page.rows[0].detail).toContainEqual(expect.objectContaining({ value: star.starId }));
    expect(f.management.preview).not.toHaveBeenCalled();
  });

  it('keeps unbound node keys and admin credentials out of machines and enables page navigation even with no machine rows', async () => {
    const f = fixtures();
    const page = await f.resources.machines.adapter.read({ context, route: { resourceId: 'machines', contextId: context.id, query: { starId: star.starId } }, signal: signal() });
    expect(page.rows.map((row) => row.id)).toEqual(machines.map((machine) => machine.id));
    expect(page.rows[0]).toMatchObject({ copyValue: machines[0].machineId, cells: { mid8: '12345678' }, actionRoutes: { open: { resourceId: 'sessions', contextId: context.id, query: { starId: star.starId, machineId: machines[0].machineId, scope: 'members' } } } });
    expect(page.actionRoutes).toMatchObject({ sessions: { resourceId: 'sessions', contextId: context.id, query: { starId: star.starId, scope: 'members' } }, members: { resourceId: 'members', contextId: context.id, query: { starId: star.starId } }, keys: { resourceId: 'keys', contextId: context.id, query: { starId: star.starId } } });
    expect(JSON.stringify(page.rows)).not.toContain('unused-node-key');
    expect(JSON.stringify(page.rows)).not.toContain('peer-admin');
    f.current.machines = [];
    const empty = await f.resources.machines.adapter.read({ context, route: { resourceId: 'machines', contextId: context.id, query: { starId: star.starId } }, signal: signal() });
    expect(empty.rows).toEqual([]);
    expect(empty.actionRoutes?.sessions).toBeDefined();
    expect(actions(f.resources.machines.resource, empty).find((entry) => entry.shortcut === 'v')?.selectionPolicy).toBe('none');
  });

  it('distinguishes all-star Enter navigation from node-session detail while keeping node and native status independent', async () => {
    const f = fixtures();
    const all = await f.resources.sessions.adapter.read({ context, route: { resourceId: 'sessions', contextId: context.id, query: { starId: star.starId } }, signal: signal() });
    expect(f.tcp.readSessions).toHaveBeenLastCalledWith({ contextId: context.id, starId: star.starId, scope: 'members', signal: expect.any(AbortSignal) });
    expect(all.rows).toHaveLength(2);
    expect(all.rows[0].cells).toMatchObject({ machine: '节点一', mid8: '12345678', status: '未提供<—>' });
    expect(all.rows[1].cells.status).toBe('未提供<—>');
    expect(all.rows[1].facets).toMatchObject({ named: 'anonymous', presence: 'offline' });
    expect(all.rows[0].actionRoutes?.open).toMatchObject({ resourceId: 'sessions', query: { starId: star.starId, machineId: machines[0].machineId, scope: 'members' } });
    expect(actions(f.resources.sessions.resource, all).find((entry) => entry.shortcut === 'Enter')?.kind).toBe('navigate');
    const node = await f.resources.sessions.adapter.read({ context, route: { resourceId: 'sessions', contextId: context.id, query: { starId: star.starId, machineId: machines[0].machineId, scope: 'members' } }, signal: signal() });
    expect(actions(f.resources.sessions.resource, node).find((entry) => entry.shortcut === 'Enter / d')?.kind).toBe('detail');
    expect(node.actionRoutes?.machines).toMatchObject({ resourceId: 'machines', query: { starId: star.starId } });
  });

  it('uses a real scope route for discovery, preserves partial per-node failures and provides complete read information', async () => {
    const f = fixtures();
    f.sessions.scope = 'discoverable';
    f.sessions.completeness = 'partial';
    f.sessions.nodes = [{ machineId: machines[1].machineId, completeness: 'unavailable', observedAt: 44, errors: [{ source: 'node:full', kind: 'unavailable', message: '节点不可达', nextStep: '恢复该节点后刷新' }] }];
    f.sessions.items[0] = session(0, { discovered: true, providerId: 'future-tool', rawStatus: { type: 'new-state' }, attributes: { cwd: '/remote/完整/目录' } });
    const page = await f.resources.sessions.adapter.read({ context, route: { resourceId: 'sessions', contextId: context.id, query: { starId: star.starId, scope: 'discoverable' } }, signal: signal() });
    expect(page.completeness).toBe('partial');
    expect(page.rows[0].cells.status).toContain('<new-state>');
    expect(page.routeChoices?.scope.options).toEqual(expect.arrayContaining([expect.objectContaining({ route: { resourceId: 'sessions', contextId: context.id, query: { starId: star.starId, scope: 'members' } } })]));
    expect(JSON.stringify(page.detailViews?.info)).toContain(machines[1].machineId);
    expect(JSON.stringify(page.detailViews?.info)).toContain('恢复该节点后刷新');
    expect(actions(f.resources.sessions.resource, page).find((entry) => entry.shortcut === 'b')?.kind).toBe('route-choice');
    expect(page.filters?.find((filter) => filter.id === 'provider')?.options).toContainEqual(expect.objectContaining({ value: 'future-tool' }));
  });

  it('keeps online/offline roster membership, succession and unknown providers without guessing native activity or addresses', async () => {
    const f = fixtures();
    f.current.members = [member(1, { providerId: null }), member(0, { address: 'existing-supported-address' })];
    const page = await f.resources.members.adapter.read({ context, route: { resourceId: 'members', contextId: context.id, query: { starId: star.starId } }, signal: signal() });
    expect(page.rows.map((row) => row.id)).toEqual(['member:0', 'member:1']);
    expect(page.rows[0].copyValue).toBe('existing-supported-address');
    expect(page.rows[1].copyValue).toBeUndefined();
    expect(page.rows[1].actionAvailability?.copy?.enabled).toBe(false);
    expect(page.rows[1].cells.provider).toMatch(/未提供|未知/);
    expect(page.filters?.find((filter) => filter.id === 'presence')?.options.map((option) => option.value)).toEqual(expect.arrayContaining(['', 'online', 'offline']));
    expect(actions(f.resources.members.resource, page).find((entry) => entry.shortcut === 'a')?.selectionPolicy).toBe('none');
  });

  it('shows safe credential metadata and copies labels while keeping admin revocation unavailable to a star administrator', async () => {
    const f = fixtures();
    f.current.credentials = credentials.map((entry) => ({ ...entry, key: 'SECRET-NODE', adminKey: 'SECRET-ADMIN' }));
    const page = await f.resources.keys.adapter.read({ context, route: { resourceId: 'keys', contextId: context.id, query: { starId: star.starId } }, signal: signal() });
    expect(page.rows.map((row) => row.id)).toEqual(credentials.map((entry) => entry.id));
    expect(page.rows[2].copyValue).toBe('peer-admin');
    expect(JSON.stringify(page)).not.toContain('SECRET-');
    expect(page.rows[2].actionAvailability?.['revoke-credential']).toMatchObject({ enabled: false, reason: expect.any(String), nextStep: expect.any(String) });
    expect(page.actionAvailability?.['generate-admin-key']?.enabled).toBe(false);
    expect(actions(f.resources.keys.resource, page).every((entry) => entry.ownerResourceId === 'keys')).toBe(true);
  });

  it('rejects invalid context, route and query scopes before any source query or mutation', async () => {
    const f = fixtures();
    for (const request of [
      { context: { id: 'ssh:fixture', kind: 'ssh', label: 'SSH' }, signal: signal() },
      { context, route: { resourceId: 'machines', contextId: 'other', query: { starId: star.starId } }, signal: signal() },
      { context, route: { resourceId: 'sessions', contextId: context.id, query: { starId: star.starId, scope: 'invented' } }, signal: signal() },
    ]) {
      const adapter = request.route?.resourceId === 'sessions' ? f.resources.sessions.adapter : f.resources.machines.adapter;
      expect((await adapter.read(request)).completeness).toBe('unavailable');
    }
    expect(f.tcp.readStars).not.toHaveBeenCalled(); expect(f.tcp.readStar).not.toHaveBeenCalled(); expect(f.tcp.readSessions).not.toHaveBeenCalled();
    expect(f.management.preview).not.toHaveBeenCalled(); expect(f.management.apply).not.toHaveBeenCalled();
  });
});

describe('TCP list-owned management and secret results', () => {
  it('previews and applies a full credential identity and revision from the fixed owner route', async () => {
    const f = fixtures();
    const page = await f.resources.keys.adapter.read({ context, route: { resourceId: 'keys', contextId: context.id, query: { starId: star.starId } }, signal: signal() });
    const selected = request(f.resources.keys.resource, page, 'revoke-credential', 0, { confirmation: 'host-a' });
    const availability = await f.resources.keys.adapter.checkAction!(selected);
    expect(availability).toMatchObject({ enabled: true, impact: expect.arrayContaining([expect.stringContaining(star.starId)]) });
    expect(f.management.preview).toHaveBeenCalledWith({ contextId: context.id, action: 'revoke-credential', starId: star.starId, targetId: credentials[0].id, targetRevision: credentials[0].revision, values: selected.values, signal: selected.signal });
    await f.resources.keys.adapter.mutate!(selected);
    expect(f.management.apply).toHaveBeenCalledWith(expect.objectContaining({ contextId: context.id, action: 'revoke-credential', targetId: credentials[0].id, targetRevision: credentials[0].revision, expectedPreviewRevision: 'confirmed-preview-revision' }));
  });

  it('keeps issued configuration exclusively in the dedicated sensitive result and never in a later normal page', async () => {
    const f = fixtures();
    f.management.apply.mockResolvedValueOnce({ kind: 'applied', message: '已实际发钥。', secret: { kind: 'node-configs', title: '一次性接入配置', materials: [{ label: 'new-node', content: '{"key":"SECRET-NEW"}', connectCommand: 'crosschat serve --connect full-star-id --detach' }], notice: '分发后离开并清屏；不会再次回显。' } });
    const page = await f.resources.machines.adapter.read({ context, route: { resourceId: 'machines', contextId: context.id, query: { starId: star.starId } }, signal: signal() });
    const selected = request(f.resources.machines.resource, page, 'generate-node-key', undefined, { count: '1', host: 'fixture.invalid' });
    await f.resources.machines.adapter.checkAction!(selected);
    const result = await f.resources.machines.adapter.mutate!(selected);
    expect(result.message).not.toContain('SECRET-NEW');
    expect(result.result?.copies).toContainEqual(expect.objectContaining({ shortcut: 'y', value: '{"key":"SECRET-NEW"}' }));
    expect(result.result?.copies).toContainEqual(expect.objectContaining({ shortcut: 'c', value: 'crosschat serve --connect full-star-id --detach' }));
    expect(result.result?.notice).toContain('清屏');
    const later = await f.resources.machines.adapter.read({ context, route: { resourceId: 'machines', contextId: context.id, query: { starId: star.starId } }, signal: signal() });
    expect(JSON.stringify(later)).not.toContain('SECRET-NEW');
    expect(f.management.apply).toHaveBeenCalledOnce();
  });

  it('requires a fresh matching preview, refuses replay and preserves uncertain outcomes without retrying', async () => {
    const f = fixtures();
    const page = await f.resources.keys.adapter.read({ context, route: { resourceId: 'keys', contextId: context.id, query: { starId: star.starId } }, signal: signal() });
    const selected = request(f.resources.keys.resource, page, 'revoke-credential', 0);
    await expect(f.resources.keys.adapter.mutate!(selected)).rejects.toThrow(/核验|预览|确认/);
    expect(f.management.apply).not.toHaveBeenCalled();
    await f.resources.keys.adapter.checkAction!(selected);
    f.management.apply.mockResolvedValueOnce({ kind: 'uncertain', message: '请求已发出，结果待核实。' });
    await expect(f.resources.keys.adapter.mutate!(selected)).rejects.toThrow('待核实');
    await expect(f.resources.keys.adapter.mutate!(selected)).rejects.toThrow(/核验|预览|确认/);
    expect(f.management.apply).toHaveBeenCalledOnce();
  });
});
