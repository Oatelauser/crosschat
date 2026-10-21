import { describe, expect, it } from 'vitest';
import { ChildProcess } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { normalizeThreadStatus, openCodexSession } from '../src/codex/client.js';
import type { CodexMessageChannel } from '../src/codex/transport.js';

class FakeProxyChild extends ChildProcess implements ChildProcessWithoutNullStreams {
  override stdin = new Writable({ write: (_chunk, _encoding, callback) => callback() });
  override stdout = new Readable({ read() {} });
  override stderr = new Readable({ read() {} });
  override stdio: ChildProcessWithoutNullStreams['stdio'] = [this.stdin, this.stdout, this.stderr, undefined, undefined];
  override exitCode = 0;
}

function spawnProxy(): ChildProcessWithoutNullStreams {
  const child = new FakeProxyChild();
  setImmediate(() => child.emit('spawn'));
  return child;
}

function channel() {
  const sent: Array<{ id?: number; method: string; params: Record<string, unknown> }> = [];
  const listeners = new Set<(payload: string) => void>();
  const channel: CodexMessageChannel = {
    send(payload) { sent.push(JSON.parse(payload)); },
    onMessage(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    onClose() { return () => undefined; },
    close: async () => undefined,
  };
  return { channel, sent, respond(result: unknown) { for (const listener of listeners) listener(JSON.stringify({ id: sent.at(-1)?.id, result })); } };
}

describe('Codex internal paged read contract', () => {
  it('keeps the legacy limit-20 non-archived request and rejecting unknown status unchanged', async () => {
    const fake = channel();
    const session = await openCodexSession({ spawnProxy, channelFactory: async () => fake.channel })();
    const list = session.listThreads();
    expect(fake.sent[0].params).toMatchObject({ limit: 20, archived: false });
    expect(fake.sent[0].params).not.toHaveProperty('cursor');
    fake.respond({ data: [{ id: 'old', name: null, status: { type: 'future-status' } }], nextCursor: 'next' });
    await expect(list).rejects.toMatchObject({ code: 'CODEX_PROTOCOL_ERROR' });
    expect(() => normalizeThreadStatus({ type: 'future-status' })).toThrow();
    await session.close();
  });

  it('provides cursor-based pages of 21 and 100 anonymous threads preserving raw unknown status', async () => {
    const fake = channel();
    const session = await openCodexSession({ spawnProxy, channelFactory: async () => fake.channel })();
    try {
      const first = session.listThreadPage({ limit: 21 });
      expect(fake.sent[0].params).toMatchObject({ limit: 21, archived: false });
      fake.respond({ data: Array.from({ length: 21 }, (_, index) => ({ id: `native/${index}`, status: { type: 'future-status', extra: 'kept' } })), nextCursor: 'opaque/cursor' });
      const page = await first;
      expect(page.data).toHaveLength(21);
      expect(page.data[0]).toMatchObject({ name: null, rawStatus: { type: 'future-status', extra: 'kept' } });
      expect(page.nextCursor).toBe('opaque/cursor');
      const second = session.listThreadPage({ cursor: page.nextCursor ?? undefined, limit: 100 });
      expect(fake.sent[1].params).toMatchObject({ cursor: 'opaque/cursor', limit: 100, archived: false });
      fake.respond({ data: Array.from({ length: 100 }, (_, index) => ({ id: `native/${index + 21}`, status: { type: 'idle' } })), nextCursor: null });
      const last = await second;
      expect(last.nextCursor).toBeNull();
      expect(last.data).toHaveLength(100);
    } finally {
      await session.close();
    }
  });

  it('does not assert completeness when an older response omits nextCursor', async () => {
    const fake = channel();
    const session = await openCodexSession({ spawnProxy, channelFactory: async () => fake.channel })();
    try {
      const request = session.listThreadPage({});
      fake.respond({ data: [] });
      expect(await request).toMatchObject({ data: [], nextCursor: null, completeness: 'partial' });
    } finally {
      await session.close();
    }
  });

  it('stops waiting for an in-flight page when it is cancelled', async () => {
    const fake = channel();
    const session = await openCodexSession({ spawnProxy, channelFactory: async () => fake.channel, requestTimeoutMs: 100 })();
    try {
      const controller = new AbortController();
      const request = session.listThreadPage({ signal: controller.signal });
      controller.abort();
      await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      await session.close();
    }
  });
});
