import { describe, expect, it } from 'vitest';
import { CodexRpcClient, CodexRpcRejectedError } from '../src/codex/rpc.js';
import type { CodexMessageChannel } from '../src/codex/transport.js';

class FakeChannel implements CodexMessageChannel {
  sent: string[] = [];
  closed = false;
  private readonly messageListeners = new Set<(payload: string) => void>();
  private readonly closeListeners = new Set<() => void>();

  send(payload: string): void {
    this.sent.push(payload);
  }

  onMessage(listener: (payload: string) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const listener of [...this.closeListeners]) listener();
  }

  /** Test helper: deliver one inbound ws text frame. */
  push(payload: string): void {
    for (const listener of [...this.messageListeners]) listener(payload);
  }

  emitClose(): void {
    for (const listener of [...this.closeListeners]) listener();
  }
}

function makeClient(requestTimeoutMs?: number): { channel: FakeChannel; client: CodexRpcClient } {
  const channel = new FakeChannel();
  const client = new CodexRpcClient(channel, requestTimeoutMs);
  return { channel, client };
}

describe('codex rpc client', () => {
  it('resolves responses that carry no jsonrpc field (verified wire behavior)', async () => {
    const { channel, client } = makeClient();
    const promise = client.request('initialize', { clientInfo: { name: 'crosschat' } });
    const frame = JSON.parse(channel.sent[0]) as { id: number; method: string };
    expect(frame.method).toBe('initialize');
    channel.push(JSON.stringify({ id: frame.id, result: { userAgent: 'codex' } }));
    await expect(promise).resolves.toEqual({ userAgent: 'codex' });
  });

  it('pairs responses to requests by id, even out of order', async () => {
    const { channel, client } = makeClient();
    const first = client.request('thread/list', {});
    const second = client.request('thread/resume', { threadId: 't1' });
    const id1 = (JSON.parse(channel.sent[0]) as { id: number }).id;
    const id2 = (JSON.parse(channel.sent[1]) as { id: number }).id;
    channel.push(JSON.stringify({ id: id2, result: { thread: { id: 't1' } } }));
    channel.push(JSON.stringify({ id: id1, result: { data: [] } }));
    await expect(first).resolves.toEqual({ data: [] });
    await expect(second).resolves.toEqual({ thread: { id: 't1' } });
  });

  it('rejects a request that times out', async () => {
    const { client } = makeClient(20);
    await expect(client.request('thread/list', {})).rejects.toMatchObject({
      code: 'CODEX_REQUEST_TIMEOUT',
    });
  });

  it('drops a late response for a timed-out request instead of faulting', async () => {
    const { channel, client } = makeClient(20);
    const slow = client.request('thread/list', {});
    const id = (JSON.parse(channel.sent[0]) as { id: number }).id;
    await expect(slow).rejects.toMatchObject({ code: 'CODEX_REQUEST_TIMEOUT' });
    const fast = client.request('thread/resume', { threadId: 't1' });
    const fastId = (JSON.parse(channel.sent[1]) as { id: number }).id;
    channel.push(JSON.stringify({ id, result: { data: [] } })); // late, must not fault
    channel.push(JSON.stringify({ id: fastId, result: { thread: { id: 't1' } } }));
    await expect(fast).resolves.toEqual({ thread: { id: 't1' } });
  });

  it('collects notifications and forwards them to listeners', async () => {
    const { channel, client } = makeClient();
    const seen: string[] = [];
    client.onNotification((n) => seen.push(n.method));
    channel.push(JSON.stringify({ method: 'turn/started', params: { threadId: 't1' } }));
    channel.push(JSON.stringify({ method: 'item/completed', params: { threadId: 't1' } }));
    channel.push(JSON.stringify({ method: 'turn/completed', params: { threadId: 't1' } }));
    channel.push(
      JSON.stringify({ method: 'thread/status/changed', params: { threadId: 't1', status: { type: 'idle' } } }),
    );
    expect(client.notifications.map((n) => n.method)).toEqual([
      'turn/started',
      'item/completed',
      'turn/completed',
      'thread/status/changed',
    ]);
    expect(seen).toEqual(client.notifications.map((n) => n.method));
  });

  it('records server approval requests but never answers them', () => {
    const { channel, client } = makeClient();
    const before = channel.sent.length;
    channel.push(
      JSON.stringify({
        id: 9001,
        method: 'item/commandExecution/requestApproval',
        params: { threadId: 't1', turnId: 'turn1' },
      }),
    );
    expect(client.serverRequests).toHaveLength(1);
    expect(client.serverRequests[0].method).toBe('item/commandExecution/requestApproval');
    expect(channel.sent.length).toBe(before); // no response frame sent, ever
  });

  it('rejects with the server error code on a JSON-RPC error response', async () => {
    const { channel, client } = makeClient();
    const promise = client.request('turn/start', { threadId: 't1', input: [] });
    const id = (JSON.parse(channel.sent[0]) as { id: number }).id;
    channel.push(JSON.stringify({ id, error: { code: -32001, message: 'thread not found: t1' } }));
    const rejection = await promise.then(
      () => undefined,
      (err: CodexRpcRejectedError) => err,
    );
    expect(rejection).toBeInstanceOf(CodexRpcRejectedError);
    expect(rejection?.rpcCode).toBe(-32001);
    expect(rejection?.message).toContain('thread not found');
  });

  it('refuses to send methods outside the whitelist', async () => {
    const { channel, client } = makeClient();
    expect(() => client.request('fs/read', { path: '/etc' })).toThrow(
      expect.objectContaining({ code: 'CODEX_PROTOCOL_ERROR' }),
    );
    expect(channel.sent).toHaveLength(0);
  });

  it('faults every pending request on a malformed frame', async () => {
    const { channel, client } = makeClient();
    const first = client.request('thread/list', {});
    const second = client.request('thread/resume', { threadId: 't1' });
    channel.push('this is not json');
    await expect(first).rejects.toMatchObject({ code: 'CODEX_PROTOCOL_ERROR' });
    await expect(second).rejects.toMatchObject({ code: 'CODEX_PROTOCOL_ERROR' });
  });

  it('fails all pending requests when the channel closes', async () => {
    const { channel, client } = makeClient();
    const promise = client.request('thread/list', {});
    channel.emitClose();
    await expect(promise).rejects.toMatchObject({ code: 'CODEX_TRANSPORT_CLOSED' });
  });

  it('sends notifications without an id', () => {
    const { channel, client } = makeClient();
    client.notify('initialized', {});
    expect(JSON.parse(channel.sent[0])).toEqual({ method: 'initialized', params: {} });
  });
});
