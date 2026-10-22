import { describe, expect, it, vi } from 'vitest';
import { deliverToCodexThread } from '../src/codex/deliver.js';
import type { CodexSession, CodexThreadStatus } from '../src/codex/client.js';
import { DesktopIpcError } from '../src/codex/desktop-ipc.js';
import type { DesktopThreadSession } from '../src/codex/desktop-ipc.js';
import { CodexRpcRejectedError } from '../src/codex/rpc.js';

function desktop(active = false): DesktopThreadSession {
  return {
    threadId: 'exact-thread', ownerId: 'native-owner',
    snapshot: vi.fn(async () => ({ id: 'exact-thread', name: null, cwd: '/fixture', rawStatus: { type: active ? 'active' : 'idle' }, activeTurnId: active ? 'running-turn' : null, idle: !active, revision: 1 })),
    startTurn: vi.fn(async () => 'started-turn'), steerTurn: vi.fn(async () => 'running-turn'), close: vi.fn(async () => {}),
  };
}

function cli(status: CodexThreadStatus = 'busy') {
  const session: CodexSession = {
    initialize: vi.fn(async () => {}), listThreads: vi.fn(async () => []),
    resumeThread: vi.fn(async () => status),
    readThreadState: vi.fn(async () => ({ status, activeTurnId: status === 'busy' ? 'running-turn' : null })),
    startTurn: vi.fn(async () => ({ id: 'started-turn', status: 'inProgress' })),
    steerTurn: vi.fn(async () => 'running-turn'), unsubscribe: vi.fn(async () => {}),
    startThread: vi.fn(async () => 'unused'), deleteThread: vi.fn(async () => {}), notifications: () => [], close: vi.fn(async () => {}),
  };
  return session;
}

describe('native Codex delivery routing', () => {
  it('keeps the Desktop owner open until the native start acknowledgement settles', async () => {
    const owner = desktop(); let acknowledge: (turnId: string) => void = () => {};
    vi.mocked(owner.startTurn).mockImplementation(() => new Promise((resolve) => { acknowledge = resolve; }));
    const pending = deliverToCodexThread('exact-thread', 'body', { desktopFactory: async () => owner, sessionFactory: async () => cli() });
    await vi.waitFor(() => expect(owner.startTurn).toHaveBeenCalledOnce());
    expect(owner.close).not.toHaveBeenCalled(); acknowledge('new-turn');
    expect(await pending).toMatchObject({ turnId: 'new-turn' }); expect(owner.close).toHaveBeenCalledOnce();
  });

  it('never starts another Desktop task if a no-active rejection is followed by a different busy turn', async () => {
    const owner = desktop(true);
    vi.mocked(owner.steerTurn).mockRejectedValue(new DesktopIpcError('CODEX_NO_ACTIVE_TURN', 'ended', 'rejected', true));
    await expect(deliverToCodexThread('exact-thread', 'body', { mode: 'steer', desktopFactory: async () => owner, sessionFactory: async () => cli() })).rejects.toMatchObject({ code: 'CODEX_NO_ACTIVE_TURN' });
    expect(owner.startTurn).not.toHaveBeenCalled();
  });

  it('never replaces user approval with a Desktop turn submission', async () => {
    const owner = desktop(true); const snapshot = await owner.snapshot();
    vi.mocked(owner.snapshot).mockResolvedValue({ ...snapshot, rawStatus: { type: 'active', activeFlags: ['waitingOnApproval'] } });
    await expect(deliverToCodexThread('exact-thread', 'body', { mode: 'steer', desktopFactory: async () => owner, sessionFactory: async () => cli() })).rejects.toMatchObject({ code: 'CODEX_APPROVAL_REQUIRED' });
    expect(owner.startTurn).not.toHaveBeenCalled(); expect(owner.steerTurn).not.toHaveBeenCalled();
  });
  it('routes a bound Desktop idle owner to start without opening CLI', async () => {
    const owner = desktop(); const fallback = vi.fn(async () => cli());
    expect(await deliverToCodexThread('exact-thread', 'full envelope', { desktopFactory: async () => owner, sessionFactory: fallback })).toMatchObject({ status: 'accepted', turnId: 'started-turn', queued: false });
    expect(owner.startTurn).toHaveBeenCalledWith('full envelope');
    expect(fallback).not.toHaveBeenCalled(); expect(owner.close).toHaveBeenCalledOnce();
  });

  it('parks queue on a busy Desktop without writing or pretending it was natively queued', async () => {
    const owner = desktop(true); const fallback = vi.fn(async () => cli());
    await expect(deliverToCodexThread('exact-thread', 'body', { desktopFactory: async () => owner, sessionFactory: fallback })).rejects.toMatchObject({ code: 'CODEX_THREAD_BUSY_TIMEOUT' });
    expect(owner.startTurn).not.toHaveBeenCalled(); expect(owner.steerTurn).not.toHaveBeenCalled(); expect(fallback).not.toHaveBeenCalled();
    expect(owner.close).toHaveBeenCalledOnce();
  });

  it('steers the bound Desktop busy owner and starts when idle', async () => {
    const owner = desktop(true); const fallback = vi.fn(async () => cli());
    expect(await deliverToCodexThread('exact-thread', 'body', { mode: 'steer', desktopFactory: async () => owner, sessionFactory: fallback })).toMatchObject({ turnId: 'running-turn', queued: false });
    expect(owner.steerTurn).toHaveBeenCalledWith('body'); expect(owner.startTurn).not.toHaveBeenCalled(); expect(fallback).not.toHaveBeenCalled();
    const idle = desktop();
    await deliverToCodexThread('exact-thread', 'body', { mode: 'steer', desktopFactory: async () => idle, sessionFactory: fallback });
    expect(idle.startTurn).toHaveBeenCalledWith('body');
  });

  it('starts once only after an explicit Desktop no-active rejection and fresh idle evidence', async () => {
    const owner = desktop(true); const idleSnapshot = await desktop().snapshot();
    vi.mocked(owner.snapshot).mockResolvedValueOnce(await owner.snapshot()).mockResolvedValue(idleSnapshot);
    vi.mocked(owner.steerTurn).mockRejectedValue(new DesktopIpcError('CODEX_NO_ACTIVE_TURN', 'ended', 'rejected', true));
    await deliverToCodexThread('exact-thread', 'body', { mode: 'steer', desktopFactory: async () => owner, sessionFactory: async () => cli() });
    expect(owner.steerTurn).toHaveBeenCalledOnce(); expect(owner.startTurn).toHaveBeenCalledOnce();
  });

  it.each(['prewrite', 'uncertain'] as const)('never falls back after a Desktop %s failure', async (stage) => {
    const owner = desktop(true); const fallback = vi.fn(async () => cli());
    vi.mocked(owner.steerTurn).mockRejectedValue(new DesktopIpcError(stage === 'uncertain' ? 'CODEX_WRITE_UNCERTAIN' : 'CODEX_DESKTOP_UNAVAILABLE', 'disconnected', stage, true));
    await expect(deliverToCodexThread('exact-thread', 'body', { mode: 'steer', desktopFactory: async () => owner, sessionFactory: fallback })).rejects.toMatchObject({ code: stage === 'uncertain' ? 'CODEX_WRITE_UNCERTAIN' : 'CODEX_DESKTOP_UNAVAILABLE' });
    expect(owner.startTurn).not.toHaveBeenCalled(); expect(owner.steerTurn).toHaveBeenCalledOnce(); expect(fallback).not.toHaveBeenCalled();
  });

  it('uses CLI only for an explicitly absent Desktop owner', async () => {
    const fallback = vi.fn(async () => cli('idle'));
    await deliverToCodexThread('exact-thread', 'body', { desktopFactory: async () => null, sessionFactory: fallback });
    expect(fallback).toHaveBeenCalledOnce();
    fallback.mockClear();
    await expect(deliverToCodexThread('exact-thread', 'body', { desktopFactory: async () => { throw new DesktopIpcError('CODEX_DESKTOP_TIMEOUT', 'timeout', 'prewrite', false); }, sessionFactory: fallback })).rejects.toMatchObject({ code: 'CODEX_DESKTOP_TIMEOUT' });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('CLI steer uses the active turn from a read-only query and releases its session', async () => {
    const session = cli();
    const result = await deliverToCodexThread('exact-thread', 'body', { mode: 'steer', sessionFactory: async () => session });
    expect(result).toMatchObject({ turnId: 'running-turn', queued: false });
    expect(session.readThreadState).toHaveBeenCalledWith('exact-thread');
    expect(session.steerTurn).toHaveBeenCalledWith('exact-thread', 'running-turn', 'body');
    expect(session.startTurn).not.toHaveBeenCalled(); expect(session.unsubscribe).toHaveBeenCalledOnce(); expect(session.close).toHaveBeenCalledOnce();
  });

  it('CLI idle steer starts once and busy queue waits without any write', async () => {
    const idle = cli('idle');
    await deliverToCodexThread('exact-thread', 'body', { mode: 'steer', sessionFactory: async () => idle });
    expect(idle.startTurn).toHaveBeenCalledOnce(); expect(idle.steerTurn).not.toHaveBeenCalled();
    const busy = cli();
    await expect(deliverToCodexThread('exact-thread', 'body', { sessionFactory: async () => busy })).rejects.toMatchObject({ code: 'CODEX_THREAD_BUSY_TIMEOUT' });
    expect(busy.startTurn).not.toHaveBeenCalled(); expect(busy.steerTurn).not.toHaveBeenCalled();
  });

  it('CLI retries as start once only for a definitive no-active rejection', async () => {
    const session = cli();
    vi.mocked(session.steerTurn).mockRejectedValue(new CodexRpcRejectedError(-32600, 'no active turn'));
    vi.mocked(session.readThreadState!).mockResolvedValueOnce({ status: 'busy', activeTurnId: 'running-turn' }).mockResolvedValue({ status: 'idle', activeTurnId: null });
    await deliverToCodexThread('exact-thread', 'body', { mode: 'steer', sessionFactory: async () => session });
    expect(session.steerTurn).toHaveBeenCalledOnce(); expect(session.startTurn).toHaveBeenCalledOnce();
  });

  it.each([new CodexRpcRejectedError(-32600, 'expected turn id does not match'), new Error('lost ack')])('does not replay CLI steer after a different rejection or unknown write', async (error) => {
    const session = cli(); vi.mocked(session.steerTurn).mockRejectedValue(error);
    await expect(deliverToCodexThread('exact-thread', 'body', { mode: 'steer', sessionFactory: async () => session })).rejects.toMatchObject({ code: error instanceof CodexRpcRejectedError ? 'CODEX_TURN_REJECTED' : 'CODEX_WRITE_UNCERTAIN' });
    expect(session.steerTurn).toHaveBeenCalledOnce(); expect(session.startTurn).not.toHaveBeenCalled();
  });
});
