import { describe, expect, it } from 'vitest';
import { resolveTargetByName } from '../src/resolve.js';
import { MultichatError } from '../src/errors.js';
import type { ClaudeSessionEntry } from '../src/claude/registry.js';
import type { CodexThreadSummary } from '../src/codex/client.js';

const sessions: ClaudeSessionEntry[] = [
  {
    pid: 101,
    sessionId: 'cs-alpha',
    kind: 'interactive',
    name: 'alpha',
    status: 'idle',
    messagingSocketPath: 'sock-alpha',
  },
  {
    pid: 102,
    sessionId: 'cs-beta',
    kind: 'bg',
    name: 'beta',
    status: 'busy',
    messagingSocketPath: 'sock-beta',
  },
];

const threads: CodexThreadSummary[] = [
  { id: 'team1111-aaaa', name: 'workteam', status: 'idle' },
  { id: 'other222-bbbb', name: null, status: 'busy' },
];

function expectCode(fn: () => unknown, code: string): MultichatError {
  try {
    fn();
    expect.unreachable(`should have thrown ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(MultichatError);
    const me = err as MultichatError;
    expect(me.code).toBe(code);
    return me;
  }
}

describe('resolveTargetByName', () => {
  it('resolves a unique claude name', () => {
    const resolved = resolveTargetByName('alpha', sessions, threads);
    expect(resolved.side).toBe('claude');
    if (resolved.side === 'claude') expect(resolved.session.pid).toBe(101);
  });

  it('resolves a unique codex name', () => {
    const resolved = resolveTargetByName('workteam', sessions, threads);
    expect(resolved.side).toBe('codex');
    if (resolved.side === 'codex') expect(resolved.thread.id).toBe('team1111-aaaa');
  });

  it('throws NAME_COLLISION with candidates on claude duplicates', () => {
    const dup: ClaudeSessionEntry[] = [
      ...sessions,
      { ...sessions[0], pid: 103, sessionId: 'cs-alpha-2' },
    ];
    const err = expectCode(() => resolveTargetByName('alpha', dup, threads), 'NAME_COLLISION');
    expect(err.message).toContain('pid 101');
    expect(err.message).toContain('pid 103');
  });

  it('throws NAME_COLLISION with id prefixes on codex duplicates', () => {
    const dup: CodexThreadSummary[] = [
      ...threads,
      { id: 'team9999-cccc', name: 'workteam', status: 'idle' },
    ];
    const err = expectCode(() => resolveTargetByName('workteam', sessions, dup), 'NAME_COLLISION');
    expect(err.message).toContain('team1111');
    expect(err.message).toContain('team9999');
  });

  it('throws NAME_COLLISION when the name exists on both sides', () => {
    const both: CodexThreadSummary[] = [...threads, { id: 'cross444-dddd', name: 'alpha', status: 'idle' }];
    const err = expectCode(() => resolveTargetByName('alpha', sessions, both), 'NAME_COLLISION');
    expect(err.message).toContain('claude pid 101');
    expect(err.message).toContain('cross444');
  });

  it('throws NAME_NOT_FOUND listing every available name', () => {
    const err = expectCode(() => resolveTargetByName('gamma', sessions, threads), 'NAME_NOT_FOUND');
    expect(err.message).toContain('"alpha"');
    expect(err.message).toContain('"beta"');
    expect(err.message).toContain('"workteam"');
    expect(err.message).toContain('+1 unnamed');
  });

  it('reports honestly when nothing at all is routable', () => {
    const err = expectCode(() => resolveTargetByName('gamma', [], []), 'NAME_NOT_FOUND');
    expect(err.message).toContain('no named sessions');
    expect(err.message).toContain('no named threads');
  });
});
