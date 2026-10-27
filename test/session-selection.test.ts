import { describe, expect, it, vi } from 'vitest';
import { createSessionSelectionFollower } from '../src/application/session-selection.js';

describe('window-owned native selection membership', () => {
  it('waits for input, selects a resumed ID, and releases A before B without reopening stale selections', async () => {
    const calls: string[] = [];
    const follower = createSessionSelectionFollower(async (session, signal) => {
      calls.push(`join:${session.sessionId}`);
      return { close: async () => { calls.push(`release:${session.sessionId}:${signal.aborted}`); } };
    });
    follower.select({ kind: 'empty', sessionId: 'blank' });
    await follower.idle(); expect(calls).toEqual([]);
    follower.select({ kind: 'selected', sessionId: 'A' });
    await follower.idle();
    follower.select({ kind: 'selected', sessionId: 'B' });
    follower.select({ kind: 'selected', sessionId: 'C' });
    await follower.idle();
    expect(calls).toEqual(['join:A', 'release:A:true', 'join:C']);
    await follower.close();
    expect(calls.at(-1)).toBe('release:C:true');
  });

  it('closes a late starting owner after navigation or exit and ignores duplicate native selection', async () => {
    let finish!: (lease: { close(): Promise<void> }) => void;
    const close = vi.fn(async () => undefined);
    const start = vi.fn((session: import('../src/application/session-selection.js').SessionSelectionEvent, signal: AbortSignal) => {
      expect(session.sessionId).toBe('A'); expect(signal.aborted).toBe(false);
      return new Promise<{ close(): Promise<void> }>((done) => { finish = done; });
    });
    const follower = createSessionSelectionFollower(start);
    follower.select({ kind: 'selected', sessionId: 'A' });
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    follower.select({ kind: 'selected', sessionId: 'A' });
    const closed = follower.close();
    finish({ close }); await closed;
    expect(close).toHaveBeenCalledOnce();
    expect(start.mock.calls[0][1].aborted).toBe(true);
  });
});
