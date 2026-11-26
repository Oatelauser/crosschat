import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppToolsStdio } from '../src/codex/app-tools-stdio.js';

interface ToolRequest {
  type: string;
  id: string;
  tool: string;
  arguments: Record<string, unknown>;
}

const cleanup: (() => void)[] = [];

function fixture(timeoutMs = 1000) {
  const input = new PassThrough();
  const output = new PassThrough();
  const frames: ToolRequest[] = [];
  output.on('data', (chunk: Buffer) => frames.push(JSON.parse(chunk.toString())));
  const bridge = createAppToolsStdio({ input, output, timeoutMs });
  cleanup.push(() => { bridge.close(); input.destroy(); output.destroy(); });
  return { input, output, frames, ...bridge };
}

function expectReleased(f: ReturnType<typeof fixture>): void {
  for (const event of ['data', 'end', 'close', 'error']) expect(f.input.listenerCount(event)).toBe(0);
  for (const event of ['close', 'error', 'finish']) expect(f.output.listenerCount(event)).toBe(0);
}

afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
  vi.useRealTimers();
});

describe('Codex app tools host stdio bridge', () => {
  it('writes only a tool request and returns the unchanged MCP result with fragmented UTF-8', async () => {
    const f = fixture();
    const args = { threadId: 'native/thread', prompt: '内部通信🙂' };
    const pending = f.invoke('send_message_to_thread', args);
    expect(f.frames).toHaveLength(1);
    expect(f.frames[0]).toEqual({ type: 'tool-request', id: expect.any(String), tool: 'send_message_to_thread', arguments: args });
    const result = { content: [{ type: 'text', text: '已接收🙂' }], structuredContent: { threadId: 'native/thread' }, isError: false };
    const response = Buffer.from(`${JSON.stringify({ id: f.frames[0].id, result })}\r\n`);
    for (const byte of response) f.input.write(Buffer.from([byte]));
    await expect(pending).resolves.toEqual(result);
    expect(f.frames).toHaveLength(1);
  });

  it('allows one pending request and uses a fresh id for the next request', async () => {
    const f = fixture();
    const first = f.invoke('list_threads', {});
    await expect(f.invoke('read_thread', { threadId: 'other' })).rejects.toMatchObject({ code: 'CODEX_APP_TOOLS_BUSY' });
    expect(f.frames).toHaveLength(1);
    f.input.write(`${JSON.stringify({ id: f.frames[0].id, result: null })}\n`);
    await expect(first).resolves.toBeNull();
    const next = f.invoke('read_thread', { threadId: 'native/thread' });
    expect(f.frames[1].id).not.toBe(f.frames[0].id);
    f.input.write(`${JSON.stringify({ id: f.frames[1].id, result: { content: [] } })}\n`);
    await expect(next).resolves.toEqual({ content: [] });
  });

  it('rejects a host tool error without retrying or synthesizing approval', async () => {
    const f = fixture();
    const pending = f.invoke('send_message_to_thread', { threadId: 'native/thread', prompt: 'test' });
    f.input.write(`${JSON.stringify({ id: f.frames[0].id, error: 'Approval rejected by host' })}\n`);
    await expect(pending).rejects.toMatchObject({ code: 'CODEX_APP_TOOLS_HOST_ERROR', message: expect.stringContaining('Approval rejected') });
    expect(f.frames).toHaveLength(1);
  });

  it.each([
    ['wrong id', (id: string) => JSON.stringify({ id: `${id}-other`, result: {} })],
    ['both result and error', (id: string) => JSON.stringify({ id, result: {}, error: 'no' })],
    ['non-string error', (id: string) => JSON.stringify({ id, error: {} })],
    ['missing result', (id: string) => JSON.stringify({ id })],
    ['approval request', (id: string) => JSON.stringify({ id, method: 'requestApproval', params: {} })],
    ['invalid JSON', () => '{broken'],
  ])('fails closed on %s without writing an answer', async (_label, response) => {
    const f = fixture();
    const pending = f.invoke('send_message_to_thread', { threadId: 'native/thread', prompt: 'test' });
    f.input.write(`${response(f.frames[0].id)}\n`);
    await expect(pending).rejects.toMatchObject({ code: 'CODEX_APP_TOOLS_PROTOCOL_ERROR' });
    expect(f.frames).toHaveLength(1);
    expectReleased(f);
    await expect(f.invoke('list_threads', {})).rejects.toMatchObject({ code: 'CODEX_APP_TOOLS_CLOSED' });
  });

  it.each(['end', 'close', 'error'] as const)('rejects pending work and releases listeners on input %s', async (event) => {
    const f = fixture();
    const pending = f.invoke('send_message_to_thread', { threadId: 'native/thread', prompt: 'test' });
    f.input.emit(event, new Error('input failed'));
    await expect(pending).rejects.toMatchObject({ code: 'CODEX_APP_TOOLS_CLOSED' });
    expect(f.frames).toHaveLength(1);
    expectReleased(f);
  });

  it.each(['close', 'finish', 'error'] as const)('rejects pending work and releases listeners on output %s', async (event) => {
    const f = fixture();
    const pending = f.invoke('read_thread', { threadId: 'native/thread' });
    f.output.emit(event, new Error('output failed'));
    await expect(pending).rejects.toMatchObject({ code: 'CODEX_APP_TOOLS_CLOSED' });
    expectReleased(f);
  });

  it('closes on timeout, clears its timer, and never retries', async () => {
    vi.useFakeTimers();
    const f = fixture(100);
    const pending = f.invoke('send_message_to_thread', { threadId: 'native/thread', prompt: 'test' });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'CODEX_APP_TOOLS_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(f.frames).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expectReleased(f);
  });

  it('close cancels pending work without destroying caller-owned streams', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const pending = f.invoke('list_threads', {});
    f.close();
    f.close();
    await expect(pending).rejects.toMatchObject({ code: 'CODEX_APP_TOOLS_CLOSED' });
    expect(vi.getTimerCount()).toBe(0);
    expect(f.input.destroyed).toBe(false);
    expect(f.output.destroyed).toBe(false);
    expectReleased(f);
  });

  it('clears the timeout after a successful response', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const pending = f.invoke('list_threads', {});
    f.input.write(`${JSON.stringify({ id: f.frames[0].id, result: { content: [] } })}\n`);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects invalid UTF-8 rather than accepting replacement characters', async () => {
    const f = fixture();
    const pending = f.invoke('list_threads', {});
    f.input.write(Buffer.concat([Buffer.from(`{"id":"${f.frames[0].id}","result":"`), Buffer.from([0xc3, 0x28]), Buffer.from('"}\n')]));
    await expect(pending).rejects.toMatchObject({ code: 'CODEX_APP_TOOLS_PROTOCOL_ERROR' });
    expectReleased(f);
  });

  it('bounds incomplete incoming lines at 8 MiB', async () => {
    const f = fixture();
    const pending = f.invoke('list_threads', {});
    const rejection = expect(pending).rejects.toMatchObject({ code: 'CODEX_APP_TOOLS_PROTOCOL_ERROR' });
    for (let index = 0; index < 9; index++) f.input.write(Buffer.alloc(1024 * 1024, 0x20));
    await rejection;
    expectReleased(f);
  });

  it('accepts a complete response exactly at the 8 MiB byte limit', async () => {
    const f = fixture();
    const pending = f.invoke('list_threads', {});
    const prefix = `{"id":"${f.frames[0].id}","result":"`;
    const text = 'x'.repeat(8 * 1024 * 1024 - Buffer.byteLength(prefix) - 2);
    f.input.write(`${prefix}${text}"}\n`);
    await expect(pending).resolves.toBe(text);
  });

  it('fails closed on a duplicate response instead of assigning it to later work', async () => {
    const f = fixture();
    const pending = f.invoke('list_threads', {});
    const response = `${JSON.stringify({ id: f.frames[0].id, result: { content: [] } })}\n`;
    f.input.write(response + response);
    await expect(pending).resolves.toEqual({ content: [] });
    await expect(f.invoke('list_threads', {})).rejects.toMatchObject({ code: 'CODEX_APP_TOOLS_CLOSED' });
    expect(f.frames).toHaveLength(1);
    expectReleased(f);
  });

  it('rejects oversized requests before writing', async () => {
    const f = fixture();
    await expect(f.invoke('send_message_to_thread', { prompt: 'x'.repeat(8 * 1024 * 1024) })).rejects.toMatchObject({ code: 'CODEX_APP_TOOLS_PROTOCOL_ERROR' });
    expect(f.frames).toHaveLength(0);
  });

  it('rejects an unsupported tool before writing', async () => {
    const f = fixture();
    await expect(Reflect.apply(f.invoke, undefined, ['approve', {}])).rejects.toMatchObject({ code: 'CODEX_APP_TOOLS_PROTOCOL_ERROR' });
    expect(f.frames).toHaveLength(0);
  });

  it('handles a Writable failure without an unhandled error or a retry', async () => {
    const input = new PassThrough();
    const output = new Writable({ write(_chunk, _encoding, callback) { callback(new Error('broken pipe')); } });
    const bridge = createAppToolsStdio({ input, output, timeoutMs: 1000 });
    cleanup.push(() => { bridge.close(); input.destroy(); output.destroy(); });
    await expect(bridge.invoke('send_message_to_thread', { prompt: 'test' })).rejects.toMatchObject({ code: 'CODEX_APP_TOOLS_CLOSED' });
    expect(input.listenerCount('data')).toBe(0);
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])('rejects invalid timeout %s before attaching listeners', (timeoutMs) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const inputEvents = input.eventNames();
    const outputEvents = output.eventNames();
    expect(() => createAppToolsStdio({ input, output, timeoutMs })).toThrow();
    expect(input.eventNames()).toEqual(inputEvents);
    expect(output.eventNames()).toEqual(outputEvents);
    input.destroy();
    output.destroy();
  });
});
