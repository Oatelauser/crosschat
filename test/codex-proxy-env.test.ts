import { ChildProcess } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openCodexSession } from '../src/codex/client.js';
import type { CodexMessageChannel } from '../src/codex/transport.js';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async (original) => ({ ...await original<typeof import('node:child_process')>(), spawn: mocks.spawn }));

class ProxyChild extends ChildProcess implements ChildProcessWithoutNullStreams {
  override stdin = new Writable({ write: (_chunk, _encoding, callback) => callback() });
  override stdout = new Readable({ read() {} });
  override stderr = new Readable({ read() {} });
  override stdio: ChildProcessWithoutNullStreams['stdio'] = [this.stdin, this.stdout, this.stderr, undefined, undefined];
  override exitCode = 0;
}

const channel: CodexMessageChannel = {
  send() {}, onMessage: () => () => undefined, onClose: () => () => undefined,
  close: async () => undefined, stderrText: '',
};

beforeEach(() => {
  mocks.spawn.mockReset();
  mocks.spawn.mockImplementation(() => {
    const child = new ProxyChild();
    setImmediate(() => child.emit('spawn'));
    return child;
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('Codex proxy environment ownership', () => {
  it('passes an explicit isolated environment through the client and strips caller identity without mutating it', async () => {
    vi.stubEnv('CODEX_HOME', 'parent-codex-home');
    vi.stubEnv('CODEX_SQLITE_HOME', 'parent-sqlite-home');
    const env = { CODEX_HOME: 'fixture-codex-home', PATH: 'fixture-path', CLAUDE_CODE_SESSION_ID: 'private-caller' };
    const session = await openCodexSession({ executable: 'fixture-codex', env, channelFactory: async () => channel })();
    try {
      expect(mocks.spawn.mock.calls[0]?.[0]).toBe('fixture-codex');
      expect(mocks.spawn.mock.calls[0]?.[1]).toEqual(['app-server', 'proxy']);
      const spawned = mocks.spawn.mock.calls[0]?.[2];
      expect(spawned?.shell).toBe(false);
      expect(spawned?.env.CODEX_HOME).toBe('fixture-codex-home');
      expect(spawned?.env.PATH).toBe('fixture-path');
      expect(Object.hasOwn(spawned?.env ?? {}, 'CODEX_SQLITE_HOME')).toBe(false);
      expect(Object.hasOwn(spawned?.env ?? {}, 'CLAUDE_CODE_SESSION_ID')).toBe(false);
      expect(env.CLAUDE_CODE_SESSION_ID).toBe('private-caller');
      expect(process.env.CODEX_HOME).toBe('parent-codex-home');
      expect(process.env.CODEX_SQLITE_HOME).toBe('parent-sqlite-home');
    } finally { await session.close(); }
  });

  it('preserves native home overrides and sanitizes identity when no explicit environment is supplied', async () => {
    vi.stubEnv('CODEX_HOME', 'parent-codex-home');
    vi.stubEnv('CODEX_SQLITE_HOME', 'parent-sqlite-home');
    vi.stubEnv('CODEX_THREAD_ID', 'private-thread');
    const session = await openCodexSession({ executable: 'fixture-codex', channelFactory: async () => channel })();
    try {
      const env = mocks.spawn.mock.calls[0]?.[2].env;
      expect(env?.CODEX_HOME).toBe('parent-codex-home');
      expect(env?.CODEX_SQLITE_HOME).toBe('parent-sqlite-home');
      expect(Object.hasOwn(env ?? {}, 'CODEX_THREAD_ID')).toBe(false);
      expect(process.env.CODEX_THREAD_ID).toBe('private-thread');
    } finally { await session.close(); }
  });
});
