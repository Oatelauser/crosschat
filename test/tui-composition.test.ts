import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultResources } from '../src/tui/composition.js';
import { createTuiController } from '../src/tui/app/controller.js';
import { createResourceRegistry } from '../src/tui/resources/registry.js';
import { presentContext } from '../src/tui/resources/contexts.js';

const mocks = vi.hoisted(() => ({ local: vi.fn(), membership: vi.fn(), overview: vi.fn(), services: vi.fn(), maintenance: vi.fn(), ssh: vi.fn(), files: vi.fn(), localRead: vi.fn(), serviceRead: vi.fn(), preview: vi.fn(), execute: vi.fn(), remoteRead: vi.fn(), remoteDoctor: vi.fn(), inspect: vi.fn(), list: vi.fn() }));
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
});
afterEach(() => { vi.unstubAllEnvs(); });
function command(controller: ReturnType<typeof createTuiController>, value: string) { for (const name of `:${value}`) controller.handleKey({ name, text: name }); controller.handleKey({ name: 'enter' }); }

describe('default local and SSH resource composition', () => {
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
      controller.handleKey({ name: 'down' }); controller.handleKey({ name: 't' });
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
