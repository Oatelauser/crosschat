import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { createDefaultResources } from '../src/tui/composition.js';
import { createTuiController } from '../src/tui/app/controller.js';
import { createResourceRegistry } from '../src/tui/resources/registry.js';
import { presentContext } from '../src/tui/resources/contexts.js';

const mocks = vi.hoisted(() => ({ local: vi.fn(), membership: vi.fn(), overview: vi.fn(), services: vi.fn(), maintenance: vi.fn(), ssh: vi.fn(), files: vi.fn(), localRead: vi.fn(), serviceRead: vi.fn(), preview: vi.fn(), execute: vi.fn(), remoteRead: vi.fn(), remoteDoctor: vi.fn(), inspect: vi.fn(), list: vi.fn() }));
const tcpMocks = vi.hoisted(() => ({ create: vi.fn(), management: vi.fn(), configuration: vi.fn(), stars: vi.fn(), star: vi.fn(), sessions: vi.fn(), preview: vi.fn(), apply: vi.fn() }));
vi.mock('../src/application/tcp/index.js', () => ({ createTcpApplication: tcpMocks.create }));
vi.mock('../src/application/tcp/management.js', () => ({ createTcpManagement: tcpMocks.management }));
vi.mock('../src/application/tcp/configuration.js', () => ({ createTcpConfiguration: tcpMocks.configuration }));
vi.mock('../src/application/discovery/local.js', () => ({ createLocalDiscoveryService: mocks.local }));
vi.mock('../src/application/session-membership/index.js', () => ({ createSessionMembershipService: mocks.membership }));
vi.mock('../src/application/observations/overview.js', async (original) => ({ ...await original<object>(), createLocalOverview: mocks.overview }));
vi.mock('../src/application/services/managed.js', () => ({ createLocalServices: mocks.services }));
vi.mock('../src/application/maintenance/index.js', () => ({ createLocalMaintenance: mocks.maintenance }));
vi.mock('../src/application/ssh/index.js', () => ({ createSshApplication: mocks.ssh }));
vi.mock('../src/application/queries/files.js', () => ({ queryManagedFiles: mocks.files }));
vi.mock('../src/application/observations/logs.js', () => ({ queryManagedLog: async () => ({ items: [], completeness: 'complete', observedAt: 42, errors: [], source: null, sources: [], bytesRead: 0, truncated: false, omittedLeadingLine: false, rotated: false }) }));

const source = { completeness: 'complete' as const, observedAt: 42, errors: [] };
const remoteContext = presentContext({ id: 'ssh:fixture', kind: 'ssh', label: 'fixture', target: 'fixture' });
const contexts = [presentContext({ id: 'local', kind: 'local', label: '本机' }), remoteContext];
const capabilities = { discovery: true, delivery: false, launch: false, diagnostics: false };
function discovery(contextId: string) { return { op: 'list', providers: [{ providerId: 'future-provider', capabilities }], page: { ...source, nextCursor: null,
  items: [{ ref: { contextId, providerId: 'future-provider', nativeId: 'native/full/完整' }, name: null, rawStatus: 'idle', attributes: {}, capabilities }] } }; }
beforeEach(() => {
  vi.clearAllMocks();
  mocks.localRead.mockImplementation(async () => discovery('local'));
  mocks.remoteRead.mockImplementation(async () => discovery(remoteContext.id));
  mocks.local.mockReturnValue({ execute: mocks.localRead });
  mocks.membership.mockReturnValue({ listTargets: async () => ({ ...source, stars: [] }) });
  mocks.overview.mockReturnValue({ readStatus: vi.fn(), readDoctor: vi.fn() });
  mocks.serviceRead.mockResolvedValue({ ...source, items: [{ id: 'broker', revision: 'revision', kind: 'broker', label: 'broker', state: 'not-running', target: 'local', sourceId: 'broker', start: { allowed: true, impact: [] }, stop: { allowed: false, impact: [] }, detail: [] }] });
  mocks.services.mockReturnValue({ read: mocks.serviceRead, check: vi.fn(), execute: vi.fn() });
  mocks.maintenance.mockReturnValue({ list: () => [{ id: 'cleanup', label: '清理fixture', description: '固定范围', guidance: '只读预览' }], preview: mocks.preview, execute: mocks.execute });
  mocks.files.mockResolvedValue({ ...source, items: [{ file: '/isolated/file', category: 'inbox', bytes: 1, modifiedAt: '2026-10-22T00:00:00Z' }] });
  mocks.inspect.mockResolvedValue({ ...source, contextId: remoteContext.id, host: 'fixture', providers: [], sampleCount: 0 });
  mocks.list.mockResolvedValue({ items: [{ id: remoteContext.id, kind: 'ssh', name: 'fixture', target: 'fixture', identityHint: '配置未认证', attributes: {} }], errors: [], observedAt: 42 });
  mocks.remoteDoctor.mockResolvedValue({ ...source, contextId: remoteContext.id, host: 'fixture', exitCode: 1, result: { groups: [{ context: { kind: 'environment' }, checks: [{ code: 'node-unsupported', level: 'error', data: { version: '20.0.0' } }] }], summary: { pass: 0, warn: 0, error: 1, failed: true } } });
  mocks.ssh.mockReturnValue({ list: mocks.list, discovery: { execute: mocks.remoteRead }, inspect: mocks.inspect, doctor: mocks.remoteDoctor });
  const star = (contextId: string) => ({ id: `row:${contextId}:star`, contextId, starId: 'full-star', name: '完整星', revision: 'a'.repeat(64), role: contextId === 'local' ? 'broker-owner' : 'member', host: 'fixture.invalid', port: 7260, health: 'reachable', onlineNodes: 1 });
  tcpMocks.stars.mockImplementation(async ({ contextId }) => ({ ...source, contextId, role: contextId === 'local' ? 'broker-owner' : 'member', configured: true, items: [star(contextId)] }));
  tcpMocks.star.mockImplementation(async ({ contextId }) => ({ ...source, contextId, star: star(contextId), machines: [{ id: `row:${contextId}:machine`, contextId, starId: 'full-star', machineId: 'a'.repeat(32), mid8: 'a'.repeat(8), name: '完整节点', labels: ['node-1'], presence: 'online', addedAt: '2026-01-01' }], members: [], credentials: [] }));
  tcpMocks.sessions.mockImplementation(async ({ contextId, scope }) => ({ ...source, contextId, star: star(contextId), scope, nodes: [], items: [{ id: `row:${contextId}:session`, contextId, starId: 'full-star', machineId: 'a'.repeat(32), mid8: 'a'.repeat(8), machineName: '完整节点', nativeId: 'native/full/id', providerId: 'future-provider', name: null, ref: { contextId: `node:${contextId}`, providerId: 'future-provider', nativeId: 'native/full/id' }, rawStatus: 'idle', capabilities, attributes: {}, member: null, membership: 'not-member', presence: 'online', discovered: true }] }));
  tcpMocks.create.mockReturnValue({ readStars: tcpMocks.stars, readStar: tcpMocks.star, readSessions: tcpMocks.sessions });
  tcpMocks.management.mockReturnValue({ preview: tcpMocks.preview, apply: tcpMocks.apply });
  tcpMocks.configuration.mockReturnValue({ preview: vi.fn(), apply: vi.fn() });
});
afterEach(() => { vi.unstubAllEnvs(); });
function command(controller: ReturnType<typeof createTuiController>, value: string) { for (const name of `:${value}`) controller.handleKey({ name, text: name }); controller.handleKey({ name: 'enter' }); }

describe('default local and SSH resource composition', () => {
  it('installs TCP adapters lazily and dispatches local star sessions separately from ordinary local sessions', async () => {
    const composed = createDefaultResources({ home: '/isolated', isolatedHome: true });
    expect(tcpMocks.create).toHaveBeenCalledWith(expect.objectContaining({ baseDir: join('/isolated', '.crosschat') }));
    for (const method of [tcpMocks.stars, tcpMocks.star, tcpMocks.sessions, tcpMocks.preview, tcpMocks.apply]) expect(method).not.toHaveBeenCalled();
    const controller = createTuiController({ registry: createResourceRegistry(composed.resources), contexts, adapters: composed.adapters });
    try {
      command(controller, 'stars'); await vi.waitFor(() => expect(controller.getSnapshot().rows[0]?.cells.name).toBe('完整星'));
      controller.handleKey({ name: 'enter' }); await vi.waitFor(() => expect(controller.getSnapshot().route.resourceId).toBe('members'));
      await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
      controller.handleKey({ name: '2' }); await vi.waitFor(() => expect(controller.getSnapshot().rows[0]?.cells.name).toBe('完整节点'));
      controller.handleKey({ name: '3' }); await vi.waitFor(() => expect(tcpMocks.sessions).toHaveBeenCalled());
      await vi.waitFor(() => expect(controller.getSnapshot().resource?.columns.some((column) => column.id === 'machine')).toBe(true));
      expect(mocks.localRead).not.toHaveBeenCalled();
      command(controller, 'local'); command(controller, 'sessions'); await vi.waitFor(() => expect(mocks.localRead).toHaveBeenCalled());
    } finally { controller.dispose(); }
  });

  it('routes a selected TCP connection to its machines and keeps failed remote reads away from local discovery', async () => {
    const composed = createDefaultResources({ home: '/isolated', isolatedHome: true });
    const context = presentContext({ id: 'tcp:fixture', kind: 'tcp', label: 'TCPfixture', target: 'fixture.invalid:7260' });
    const controller = createTuiController({ registry: createResourceRegistry(composed.resources), contexts: [...contexts, context], initialSelectedContextId: context.id, adapters: composed.adapters });
    try {
      controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
      command(controller, 'machines');
      await vi.waitFor(() => expect(tcpMocks.star).toHaveBeenCalledWith(expect.objectContaining({ contextId: context.id })));
      expect(controller.getSnapshot().route.resourceId).toBe('machines');
      command(controller, 'sessions'); await vi.waitFor(() => expect(tcpMocks.sessions).toHaveBeenCalledWith(expect.objectContaining({ contextId: context.id })));
      expect(mocks.localRead).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(controller.getSnapshot().resource?.columns.some((column) => column.id === 'machine')).toBe(true));
    } finally { controller.dispose(); }
  });
  it.each(['unavailable', 'partial', 'cancelled'] as const)('keeps empty TCP session read information accessible through the default composition: %s', async (completeness) => {
    const composed = createDefaultResources({ home: '/isolated', isolatedHome: true });
    const context = presentContext({ id: 'tcp:fixture', kind: 'tcp', label: 'TCPfixture', target: 'fixture.invalid:7260' });
    tcpMocks.sessions.mockResolvedValueOnce({ ...source, contextId: context.id, scope: 'members', star: null, items: [], nodes: [], completeness,
      errors: [{ source: 'tcp-fixture', kind: 'unavailable', message: '未取得该星快照', nextStep: '核对该星地址与凭证后重试' }] });
    const controller = createTuiController({ registry: createResourceRegistry(composed.resources), contexts: [...contexts, context], initialSelectedContextId: context.id, adapters: composed.adapters });
    try {
      controller.handleKey({ name: 'enter' });
      command(controller, 'sessions');
      await vi.waitFor(() => expect(controller.getSnapshot()).toMatchObject({ route: { resourceId: 'sessions' }, loading: false, completeness }));
      expect(controller.getSnapshot().rows).toEqual([]);
      expect(controller.getSnapshot().actions.find((action) => action.shortcut === 'i')).toMatchObject({ enabled: true });
      controller.handleKey({ name: 'i' });
      expect(controller.getSnapshot().mode).toBe('detail');
      expect(JSON.stringify(controller.getSnapshot().detail)).toContain('核对该星地址与凭证后重试');
      expect(mocks.localRead).not.toHaveBeenCalled();
    } finally { controller.dispose(); }
  });
  it('retains the actual source recovery guidance after a scoped star becomes unavailable', async () => {
    const composed = createDefaultResources({ home: '/isolated', isolatedHome: true });
    const context = presentContext({ id: 'tcp:fixture', kind: 'tcp', label: 'TCPfixture', target: 'fixture.invalid:7260' });
    tcpMocks.sessions.mockResolvedValueOnce({ ...source, contextId: context.id, scope: 'members', star: null, items: [], nodes: [], completeness: 'unavailable',
      errors: [{ source: 'selected-star', kind: 'unavailable', message: '已选择的星当前不可达', nextStep: '核对原连接凭证并重新检测' }] });
    const controller = createTuiController({ registry: createResourceRegistry(composed.resources), contexts: [...contexts, context], initialSelectedContextId: context.id, adapters: composed.adapters });
    try {
      controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
      command(controller, 'machines');
      await vi.waitFor(() => expect(controller.getSnapshot().rows[0]?.id).toBe(`row:${context.id}:machine`));
      controller.handleKey({ name: '3' });
      await vi.waitFor(() => expect(controller.getSnapshot()).toMatchObject({ route: { resourceId: 'sessions', query: { starId: 'full-star' } }, loading: false, completeness: 'unavailable' }));
      controller.handleKey({ name: 'i' });
      expect(JSON.stringify(controller.getSnapshot().detail)).toContain('核对原连接凭证并重新检测');
      expect(JSON.stringify(controller.getSnapshot().detail)).not.toContain('返回了其他连接');
    } finally { controller.dispose(); }
  });
  it.each(['complete', 'unknown', 'blocked'] as const)('does not recreate removed preferences after an uninstall attempt: %s', async (outcome) => {
    mocks.maintenance.mockReturnValue({ list: () => [{ id: 'uninstall-data', label: '卸载fixture', description: '固定范围', guidance: '不执行npm' }], preview: mocks.preview, execute: mocks.execute });
    mocks.preview.mockResolvedValue({ operationId: 'uninstall-data', label: '卸载fixture', observedAt: 42, fingerprint: 'f'.repeat(64), enabled: true, targets: [], effects: ['删除当前fixture数据'] });
    if (outcome === 'unknown') mocks.execute.mockRejectedValue(new Error('controlled owner failure'));
    else mocks.execute.mockResolvedValue({ operationId: 'uninstall-data', status: outcome, startedAt: 42, finishedAt: 43, npm: 'not-run', items: [], message: 'fixture result' });
    const composed = createDefaultResources({ home: '/isolated', isolatedHome: true });
    expect(composed.shouldSavePreferences()).toBe(true);
    const resource = composed.resources.find((resource) => resource.id === 'maintenance')!;
    const adapter = composed.adapters.maintenance;
    const signal = new AbortController().signal;
    const page = await adapter.read({ context: contexts[0], signal });
    const request = { context: contexts[0], signal, target: page.rows[0], values: {}, action: resource.actions.find((action) => action.id === 'execute')! };
    await adapter.checkAction!(request);
    await adapter.mutate!(request).catch(() => undefined);
    expect(composed.shouldSavePreferences()).toBe(outcome === 'blocked');
  });
  it('constructs lazily and binds explicit home child environments to the isolated scope', () => {
    vi.stubEnv('LOCALAPPDATA', '/outside/local'); vi.stubEnv('CODEX_HOME', '/outside/native');
    createDefaultResources({ home: '/isolated', isolatedHome: true });
    for (const read of [mocks.localRead, mocks.serviceRead, mocks.preview, mocks.execute, mocks.remoteRead, mocks.remoteDoctor, mocks.inspect, mocks.files, mocks.list]) expect(read).not.toHaveBeenCalled();
    const serviceOptions = mocks.services.mock.calls[0][0];
    expect(serviceOptions.env.HOME).toBe('/isolated');
    expect(serviceOptions.env.LOCALAPPDATA).not.toBe('/outside/local');
    expect(serviceOptions.env.CODEX_HOME).not.toBe('/outside/native');
    expect(mocks.maintenance.mock.calls[0][0].env.LOCALAPPDATA).not.toBe('/outside/local');
    expect(mocks.ssh.mock.calls[0][0].configFile).toBe(join('/isolated', '.ssh', 'config'));
    expect(mocks.ssh.mock.calls[0][0].env.HOME).toBe('/isolated');
  });

  it('installs local services/files/maintenance and preserves related navigation without executing a task', async () => {
    const composed = createDefaultResources({ home: '/isolated', isolatedHome: true });
    const controller = createTuiController({ registry: createResourceRegistry(composed.resources), contexts, adapters: composed.adapters });
    try {
      command(controller, 'services'); await vi.waitFor(() => expect(controller.getSnapshot().rows).toHaveLength(1));
      controller.handleKey({ name: 'l' });
      expect(controller.getSnapshot().route.query?.source).toBe('broker');
      command(controller, 'files'); await vi.waitFor(() => expect(controller.getSnapshot().rows[0]?.copyValue).toBe('/isolated/file'));
      expect(mocks.files).toHaveBeenCalledWith(expect.objectContaining({ baseDir: expect.stringContaining('.crosschat') }));
      controller.handleKey({ name: 'm' }); await vi.waitFor(() => expect(controller.getSnapshot().rows[0]?.id).toBe('cleanup'));
      expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
    } finally { controller.dispose(); }
  });

  it('selects SSH discovery and typed doctor by context and never falls back to local on remote failure', async () => {
    const composed = createDefaultResources({ home: '/isolated', isolatedHome: true });
    const controller = createTuiController({ registry: createResourceRegistry(composed.resources), contexts, adapters: composed.adapters });
    try {
      command(controller, 'ssh');
      await vi.waitFor(() => expect(controller.getSnapshot().rows).toHaveLength(1));
      controller.handleKey({ name: 't' });
      await vi.waitFor(() => expect(mocks.inspect).toHaveBeenCalledOnce());
      controller.handleKey({ name: 'escape' }); controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller.getSnapshot().rows[0]?.cells.name).toBe('匿名'));
      expect(mocks.remoteRead).toHaveBeenCalled(); expect(mocks.localRead).not.toHaveBeenCalled();
      command(controller, 'doctor'); await vi.waitFor(() => expect(mocks.remoteDoctor).toHaveBeenCalledOnce());
      expect(controller.getSnapshot().context?.id).toBe(remoteContext.id);
      await vi.waitFor(() => expect(controller.getSnapshot().rows[0]?.cells.state).toContain('<error>'));
      mocks.remoteRead.mockRejectedValueOnce(new Error('controlled remote failure'));
      command(controller, 'sessions'); await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
      expect(mocks.localRead).not.toHaveBeenCalled();
    } finally { controller.dispose(); }
  });
});
