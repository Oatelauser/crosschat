import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { snapshotDshRuntimeRequest, snapshotDshRuntimeSession } from './helpers/dsh-runtime-snapshot.mjs';

const id = 'native-session:exact/opaque';
const header = { id, cwd: 'D:/owned/workspace', version: 4, createdAt: 1 };
const events = [{ type: 'session/title', seq: 0, time: 2, data: { title: 'Owned original title' } }];
function owner() { return { status: 'idle', inbox: { nextTurn: [], nextStep: [] } }; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function observedFixture() {
  const agent = owner(), agents = new Map([[id, agent]]), originals = new Map([[id, agent]]);
  const dispose = vi.fn(), mutations = vi.fn();
  const observation = { source: 'live', header: structuredClone(header), events: structuredClone(events), cursor: 0, [Symbol.dispose]: dispose };
  const observeSession = vi.fn<(sessionId: string, options: { signal: AbortSignal; projectionMode: string }) => Promise<typeof observation>>().mockResolvedValue(observation);
  const get = vi.fn((name: string) => name === 'sessionQuery' ? { observeSession } : undefined);
  return { agent, agents, originals, observation, observeSession, dispose, mutations,
    ctx: { agents, sessionController: { create: mutations, rename: mutations, prompt: mutations }, get } };
}
afterEach(() => { vi.useRealTimers(); });

describe('DSH fixture exact native snapshot', () => {
  it('retains the complete legacy inspect snapshot and the same live Agent', async () => {
    const agent = owner(), agents = new Map([[id, agent]]), originals = new Map([[id, agent]]);
    const inspect = vi.fn(async () => ({ meta: header, events }));
    const ctx = { agents, sessionController: { inspect } };
    expect(await snapshotDshRuntimeSession(ctx, originals, id)).toEqual({
      id, sameAgent: true, status: 'idle', header, events, inbox: { nextTurn: [], nextStep: [] },
    });
    expect(inspect).toHaveBeenCalledExactlyOnceWith(id);
  });

  it('reads the exact live full log when the new Controller no longer has inspect', async () => {
    const agent = owner(), agents = new Map([[id, agent]]), originals = new Map([[id, agent]]);
    const dispose = vi.fn(), mutations = vi.fn();
    const observeSession = vi.fn(async () => ({ source: 'live', header, events, cursor: 0, [Symbol.dispose]: dispose }));
    const ctx = { agents, sessionController: { create: mutations, rename: mutations, prompt: mutations }, get: (name: string) => name === 'sessionQuery' ? { observeSession } : undefined };
    expect(await snapshotDshRuntimeSession(ctx, originals, id)).toEqual({
      id, sameAgent: true, status: 'idle', header, events, inbox: { nextTurn: [], nextStep: [] },
    });
    expect(observeSession).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(mutations).not.toHaveBeenCalled();
  });

  it('keeps the complete observed log detached after releasing its lease', async () => {
    const f = observedFixture(), signal = new AbortController().signal;
    f.observation.events = Array.from({ length: 300 }, (_, seq) => ({ type: 'session/title', seq, time: seq + 2, data: { title: `Title ${seq}` } }));
    f.observation.cursor = 299;
    f.dispose.mockImplementation(() => { f.observation.header.cwd = 'unavailable after lease'; f.observation.events.length = 0; });
    const snapshot = await snapshotDshRuntimeSession(f.ctx, f.originals, id, signal);
    expect(snapshot.header.cwd).toBe('D:/owned/workspace');
    expect(snapshot.events).toHaveLength(300);
    expect(snapshot.events[299]).toEqual({ type: 'session/title', seq: 299, time: 301, data: { title: 'Title 299' } });
    expect(f.observeSession).toHaveBeenCalledExactlyOnceWith(id, { signal, projectionMode: 'none' });
    expect(f.dispose).toHaveBeenCalledOnce(); expect(f.mutations).not.toHaveBeenCalled();
  });

  it.each([
    { failure: 'prepared', expected: /observation is not live/ },
    { failure: 'wrong-id', expected: /exact native session/ },
    { failure: 'owner-replaced', expected: /Agent changed/ },
    { failure: 'event-read', expected: /Native event read failed/ },
    { failure: 'event-clone', expected: /could not be cloned/ },
  ])('rejects $failure snapshots while releasing the owned observation', async ({ failure, expected }) => {
    const f = observedFixture();
    if (failure === 'prepared') f.observation.source = 'prepared';
    if (failure === 'wrong-id') f.observation.header.id = 'another native session';
    if (failure === 'owner-replaced') f.observeSession.mockImplementation(async () => { f.agents.set(id, owner()); return f.observation; });
    if (failure === 'event-read') Object.defineProperty(f.observation, 'events', { get() { throw new Error('Native event read failed'); } });
    if (failure === 'event-clone') Object.defineProperty(f.observation.events[0], 'privateCallback', { value() {}, enumerable: true });
    await expect(snapshotDshRuntimeSession(f.ctx, f.originals, id)).rejects.toThrow(expected);
    expect(f.dispose).toHaveBeenCalledOnce(); expect(f.mutations).not.toHaveBeenCalled();
  });

  it('never observes a missing live Agent or manufactures missing read capabilities', async () => {
    const f = observedFixture(); f.agents.clear();
    await expect(snapshotDshRuntimeSession(f.ctx, f.originals, id)).rejects.toThrow('not live');
    expect(f.observeSession).not.toHaveBeenCalled();
    f.agents.set(id, f.agent); f.ctx.get.mockReturnValue(undefined);
    await expect(snapshotDshRuntimeSession(f.ctx, f.originals, id)).rejects.toThrow('reader is unavailable');
    expect(f.mutations).not.toHaveBeenCalled();
  });

  it('does not replace a failed legacy read with a newer read of another observation', async () => {
    const f = observedFixture(), inspect = vi.fn(async () => { throw new Error('Legacy native read failed'); });
    await expect(snapshotDshRuntimeSession({ ...f.ctx, sessionController: { ...f.ctx.sessionController, inspect } }, f.originals, id)).rejects.toThrow('Legacy native read failed');
    expect(f.observeSession).not.toHaveBeenCalled(); expect(f.mutations).not.toHaveBeenCalled();
  });

  it('rejects an Agent replacement while a legacy inspect is pending', async () => {
    const agent = owner(), agents = new Map([[id, agent]]), originals = new Map([[id, agent]]);
    const pending = deferred<{ meta: typeof header; events: typeof events }>();
    const result = snapshotDshRuntimeSession({ agents, sessionController: { inspect: () => pending.promise } }, originals, id);
    const rejected = expect(result).rejects.toThrow('Agent changed');
    agents.set(id, owner()); pending.resolve({ meta: header, events }); await rejected;
  });

  it('does not start an already cancelled read', async () => {
    const f = observedFixture(), controller = new AbortController(); controller.abort(new Error('Already cancelled'));
    await expect(snapshotDshRuntimeSession(f.ctx, f.originals, id, controller.signal)).rejects.toThrow('Already cancelled');
    expect(f.observeSession).not.toHaveBeenCalled(); expect(f.dispose).not.toHaveBeenCalled();
  });

  it('owns and releases an observation that arrives after caller cancellation', async () => {
    const f = observedFixture(), controller = new AbortController(), pending = deferred<typeof f.observation>();
    f.observeSession.mockImplementation(() => pending.promise);
    const result = snapshotDshRuntimeSession(f.ctx, f.originals, id, controller.signal);
    const rejected = expect(result).rejects.toThrow('Cancelled pending read');
    controller.abort(new Error('Cancelled pending read')); pending.resolve(f.observation); await rejected;
    expect(f.dispose).toHaveBeenCalledOnce(); expect(f.mutations).not.toHaveBeenCalled();
  });

  it('rejects observation failures without claiming a lease or retrying', async () => {
    const f = observedFixture(); f.observeSession.mockRejectedValue(new Error('Native query unavailable'));
    await expect(snapshotDshRuntimeSession(f.ctx, f.originals, id)).rejects.toThrow('Native query unavailable');
    expect(f.observeSession).toHaveBeenCalledOnce(); expect(f.dispose).not.toHaveBeenCalled();
  });

  it.each(['request-aborted', 'response-closed', 'timeout'])('cancels the read on %s and removes its listeners after a late lease', async (reason) => {
    vi.useFakeTimers();
    const f = observedFixture(), request = new EventEmitter(), response = new EventEmitter(), pending = deferred<typeof f.observation>();
    f.observeSession.mockImplementation(() => pending.promise);
    const result = snapshotDshRuntimeRequest(f.ctx, f.originals, id, request, response);
    const rejected = expect(result).rejects.toThrow(reason === 'timeout' ? 'timed out' : 'request closed');
    if (reason === 'timeout') await vi.advanceTimersByTimeAsync(30000);
    else if (reason === 'request-aborted') request.emit('aborted');
    else response.emit('close');
    expect(f.observeSession.mock.calls[0][1].signal.aborted).toBe(true);
    pending.resolve(f.observation); await rejected;
    expect(request.listenerCount('aborted')).toBe(0); expect(response.listenerCount('close')).toBe(0);
    expect(vi.getTimerCount()).toBe(0); expect(f.dispose).toHaveBeenCalledOnce();
  });

  it('removes request cancellation listeners and timeout after a successful snapshot', async () => {
    vi.useFakeTimers();
    const f = observedFixture(), request = new EventEmitter(), response = new EventEmitter();
    const otherRequestListener = vi.fn(), otherResponseListener = vi.fn();
    request.on('aborted', otherRequestListener); response.on('close', otherResponseListener);
    expect(await snapshotDshRuntimeRequest(f.ctx, f.originals, id, request, response)).toMatchObject({ id, sameAgent: true });
    expect(request.listeners('aborted')).toEqual([otherRequestListener]); expect(response.listeners('close')).toEqual([otherResponseListener]);
    expect(vi.getTimerCount()).toBe(0); expect(f.dispose).toHaveBeenCalledOnce();
  });

  it('does not start a snapshot for a response that has already closed', async () => {
    vi.useFakeTimers();
    const f = observedFixture(), request = new EventEmitter(), response = Object.assign(new EventEmitter(), { destroyed: true });
    await expect(snapshotDshRuntimeRequest(f.ctx, f.originals, id, request, response)).rejects.toThrow('request closed');
    expect(f.observeSession).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    expect(request.listenerCount('aborted')).toBe(0); expect(response.listenerCount('close')).toBe(0);
  });
});
