import { describe, expect, it, vi } from 'vitest';
import { snapshotDshRuntimeSession } from './helpers/dsh-runtime-snapshot.mjs';

const id = 'native-session:exact/opaque';
const header = { id, cwd: 'D:/owned/workspace', version: 4, createdAt: 1 };
const events = [{ type: 'session/title', seq: 0, time: 2, data: { title: 'Owned original title' } }];
function owner() { return { status: 'idle', inbox: { nextTurn: [], nextStep: [] } }; }

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
    const ctx = { agents, sessionController: { create: mutations, rename: mutations, prompt: mutations }, sessionQuery: { observeSession } };
    expect(await snapshotDshRuntimeSession(ctx, originals, id)).toEqual({
      id, sameAgent: true, status: 'idle', header, events, inbox: { nextTurn: [], nextStep: [] },
    });
    expect(observeSession).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(mutations).not.toHaveBeenCalled();
  });
});
