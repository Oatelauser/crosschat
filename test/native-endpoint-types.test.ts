import { describe, expect, it, vi } from 'vitest';
import { sessionKey } from '../src/application/sessions/model.js';
import { createClaudeSessionReader } from '../src/application/sessions/claude-reader.js';
import { createCodexSessionReader } from '../src/application/sessions/codex-reader.js';
import { createOpenCodeSessionReader } from '../src/application/sessions/opencode-reader.js';
import { listCodexThreadPage } from '../src/codex/aggregate-discovery.js';
import { listCodexThreads } from '../src/codex/discovery.js';
import { deliverToCodexThread } from '../src/codex/deliver.js';
import type { CodexSession } from '../src/codex/client.js';
import type { DesktopThreadSession } from '../src/codex/desktop-ipc.js';

const openCode = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn() }));
vi.mock('../src/opencode/client.js', () => ({ listOpenCodeThreadPage: openCode.list, getOpenCodeThread: openCode.get }));

function cli(): CodexSession {
  return { initialize: vi.fn(async () => undefined),
    listThreads: vi.fn(async () => [{ id: 'same', name: 'CLI', status: 'idle' as const }]),
    listThreadPage: vi.fn(async () => ({ data: [{ id: 'same', name: 'CLI', rawStatus: { type: 'idle' }, attributes: {} }], nextCursor: null })),
    resumeThread: vi.fn(async () => 'idle'), startTurn: vi.fn(async () => ({ id: 'cli-turn', status: 'inProgress' })),
    steerTurn: vi.fn(async () => 'cli-turn'), unsubscribe: vi.fn(async () => undefined),
    startThread: vi.fn(async () => 'unused'), deleteThread: vi.fn(async () => undefined), notifications: () => [], close: vi.fn(async () => undefined) };
}

function desktop(): DesktopThreadSession {
  return { threadId: 'same', ownerId: 'desktop-owner',
    snapshot: vi.fn(async () => ({ id: 'same', name: 'Desktop', cwd: '/fixture', rawStatus: { type: 'idle' }, activeTurnId: null, idle: true, revision: 1 })),
    startTurn: vi.fn(async () => 'desktop-turn'), steerTurn: vi.fn(async () => 'desktop-turn'), close: vi.fn(async () => undefined) };
}

function sources(session = cli()) {
  return { sessionFactory: vi.fn(async () => session), codexHome: '/isolated-fixture', desktop: {
    listMetadata: vi.fn(async () => ({ data: [{ id: 'same', name: 'Desktop', cwd: '/fixture', source: 'vscode', originator: 'Codex Desktop', createdAtMs: 1, updatedAtMs: 2, recencyAtMs: 3 }], nextCursor: null, completeness: 'complete' as const, observedAt: 1 })),
    openThread: vi.fn(async () => desktop()),
  } };
}

describe('native endpoint identity', () => {
  it('separates same-ID CLI, Desktop and unverified references without renaming the provider', () => {
    const base = { contextId: 'local', providerId: 'codex', nativeId: 'same' };
    const cliRef = { ...base, endpointType: 'cli' }; const desktopRef = { ...base, endpointType: 'desktop' };
    expect(new Set([sessionKey(base), sessionKey(cliRef), sessionKey(desktopRef)]).size).toBe(3);
  });

  it('keeps both native Codex owners across discovery pages and exact typed detail reads', async () => {
    const options = sources();
    const reader = createCodexSessionReader(options);
    const first = await reader.list({ contextId: 'local' });
    const second = await reader.list({ contextId: 'local', cursor: first.nextCursor ?? undefined });
    expect([...first.items, ...second.items].map((item) => item.ref)).toEqual([
      expect.objectContaining({ providerId: 'codex', nativeId: 'same', endpointType: 'desktop' }),
      expect.objectContaining({ providerId: 'codex', nativeId: 'same', endpointType: 'cli' }),
    ]);
    const cliRequest = { contextId: 'local', nativeId: 'same', endpointType: 'cli' };
    const desktopRequest = { ...cliRequest, endpointType: 'desktop' };
    expect((await reader.get(cliRequest)).item?.name).toBe('CLI');
    expect((await reader.get(desktopRequest)).item?.name).toBe('Desktop');
  });

  it('filters an explicitly typed Codex source before probing the other owner', async () => {
    const options = { ...sources(), endpointType: 'cli' };
    const page = await listCodexThreadPage(options);
    expect(page.data).toMatchObject([{ id: 'same', endpointType: 'cli' }]);
    expect(options.desktop.listMetadata).not.toHaveBeenCalled();
    const desktopOptions = { ...options, endpointType: 'desktop' };
    expect(await listCodexThreadPage(desktopOptions)).toMatchObject({ data: [{ id: 'same', endpointType: 'desktop' }], nextCursor: null });
    expect(options.sessionFactory).toHaveBeenCalledOnce();
  });

  it('preserves native transport types in legacy summaries used by send resolution', async () => {
    const threads = await listCodexThreads(sources());
    expect(threads).toMatchObject([{ id: 'same', endpointType: 'desktop' }, { id: 'same', endpointType: 'cli' }]);
  });

  it('uses only CLI when explicitly requested even if a Desktop owner has the same ID', async () => {
    const session = cli(); const owner = desktop();
    const desktopFactory = vi.fn(async () => owner);
    const options = { endpointType: 'cli', sessionFactory: async () => session, desktopFactory };
    expect(await deliverToCodexThread('same', 'payload', options)).toMatchObject({ turnId: 'cli-turn' });
    expect(desktopFactory).not.toHaveBeenCalled();
    expect(owner.startTurn).not.toHaveBeenCalled();
    expect(session.startTurn).toHaveBeenCalledOnce();
  });

  it('does not fall back to CLI when a requested Desktop owner is absent', async () => {
    const sessionFactory = vi.fn(async () => cli());
    const options = { endpointType: 'desktop', sessionFactory, desktopFactory: async () => null };
    await expect(deliverToCodexThread('same', 'payload', options)).rejects.toMatchObject({ code: 'CODEX_DESKTOP_OWNER_UNAVAILABLE' });
    expect(sessionFactory).not.toHaveBeenCalled();
  });

  it('declares the verified Claude CLI endpoint and rejects a mismatched typed detail', async () => {
    const reader = createClaudeSessionReader({ directory: '/isolated-fixture', isProcessAlive: () => true,
      io: { readDirectory: async () => ['one.json'], readText: async () => JSON.stringify({ pid: 7, sessionId: 'same', kind: 'interactive', messagingSocketPath: 'fixture/socket' }) } });
    expect((await reader.list({ contextId: 'local' })).items[0].ref).toMatchObject({ providerId: 'claude', endpointType: 'cli' });
    const request = { contextId: 'local', nativeId: 'same', endpointType: 'desktop' };
    expect((await reader.get(request)).item).toBeNull();
  });

  it('declares OpenCode shared HTTP independently of the frontend and rejects unsupported typed details', async () => {
    const thread = { id: 'same', name: null, cwd: '/fixture', rawStatus: { type: 'inactive' }, attributes: {} };
    openCode.list.mockResolvedValue({ data: [thread], nextCursor: null, completeness: 'complete' });
    openCode.get.mockResolvedValue(thread);
    const reader = createOpenCodeSessionReader();
    expect((await reader.list({ contextId: 'local' })).items[0].ref).toMatchObject({ providerId: 'opencode', endpointType: 'shared' });
    const request = { contextId: 'local', nativeId: 'same', endpointType: 'desktop' };
    expect((await reader.get(request)).item).toBeNull();
    expect(openCode.get).not.toHaveBeenCalled();
  });
});
