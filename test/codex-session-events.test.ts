import { describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { createCodexSessionBinding } from '../src/codex/session-events.js';
import type { SessionSelectionEvent } from '../src/application/session-selection.js';
import type { CodexMessageChannel } from '../src/codex/transport.js';

describe('Codex per-window native protocol selection', () => {
  it('isolates resume picker request IDs and discards late replies after a newer choice', async () => {
    const sources: Array<{ sent: Array<{ id: number }>; receive(data: string): void; close: ReturnType<typeof vi.fn> }> = [];
    const events: SessionSelectionEvent[] = [];
    const binding = await createCodexSessionBinding({ exe: 'fixture', args: [], env: {}, onSelection: (event) => events.push(event),
      openSession: async () => {
        const source: (typeof sources)[number] = { sent: [], receive: () => undefined, close: vi.fn(async () => undefined) };
        const channel: CodexMessageChannel = { send: (data) => source.sent.push(JSON.parse(data)),
          onMessage: (receive) => { source.receive = receive; return () => undefined; }, onClose: () => () => undefined,
          close: source.close, stderrText: '' };
        sources.push(source); return { channel, close: source.close };
      } });
    const connect = async () => {
      const socket = new WebSocket(binding.url, { headers: { authorization: `Bearer ${binding.token}` } });
      await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
      return socket;
    };
    const window = await connect(); const picker = await connect();
    const reply = async (socket: WebSocket, source: number, id: number, sessionId: string) => {
      const received = new Promise<void>((resolve) => socket.once('message', () => resolve()));
      sources[source]!.receive(JSON.stringify({ id, result: { thread: { id: sessionId } } })); await received;
    };
    try {
      window.send(JSON.stringify({ id: 1, method: 'thread/resume', params: { threadId: 'old-A' } }));
      await vi.waitFor(() => expect(sources[0]?.sent).toHaveLength(1));
      picker.send(JSON.stringify({ id: 1, method: 'thread/resume', params: { threadId: 'new-B' } }));
      await vi.waitFor(() => expect(sources[1]?.sent).toHaveLength(1));
      await reply(picker, 1, 1, 'new-B');
      await reply(window, 0, 1, 'old-A');
      expect(events).toEqual([{ kind: 'selected', sessionId: 'new-B' }]);
      picker.close();
      await vi.waitFor(() => expect(sources[1]!.close).toHaveBeenCalledOnce());
      expect(events).toHaveLength(1);
    } finally { window.close(); picker.close(); await binding.close(); }
    expect(sources[0]!.close).toHaveBeenCalledOnce();
  });

  it('only successful native selection and first accepted input affect this window, never global notifications or failed resume', async () => {
    let receive!: (data: string) => void;
    const sent: string[] = []; const events: SessionSelectionEvent[] = [];
    const close = vi.fn(async () => undefined);
    const channel: CodexMessageChannel = { send: (value) => sent.push(value), onMessage: (listener) => { receive = listener; return () => undefined; }, onClose: () => () => undefined, close, stderrText: '' };
    const binding = await createCodexSessionBinding({ exe: 'fixture', args: [], env: {}, onSelection: (value) => events.push(value), openSession: async () => ({ channel, close }) });
    const client = new WebSocket(binding.url, { headers: { authorization: `Bearer ${binding.token}` } });
    await new Promise<void>((resolve, reject) => { client.once('open', resolve); client.once('error', reject); });
    const invoke = async (id: number, method: string, params: unknown, reply: unknown) => {
      client.send(JSON.stringify({ id, method, params }));
      await vi.waitFor(() => expect(sent.some((value) => JSON.parse(value).id === id)).toBe(true));
      const received = new Promise<void>((resolve) => client.once('message', () => resolve())); receive(JSON.stringify({ id, ...reply as object })); await received;
    };
    try {
      await invoke(1, 'thread/start', { ephemeral: false, threadSource: 'user' }, { result: { thread: { id: 'A' } } });
      expect(events).toEqual([{ kind: 'empty', sessionId: 'A' }]);
      await invoke(2, 'turn/start', { threadId: 'A' }, { result: { turn: { id: 'turn-a' } } });
      await invoke(20, 'thread/start', { ephemeral: true, threadSource: 'thread_title' }, { result: { thread: { id: 'title-task' } } });
      await invoke(21, 'turn/start', { threadId: 'title-task' }, { result: { turn: { id: 'title-turn' } } });
      await invoke(3, 'thread/resume', { threadId: 'missing' }, { error: { code: -1, message: 'missing' } });
      await invoke(4, 'thread/resume', { threadId: 'B' }, { result: { thread: { id: 'B', name: 'Native B' } } });
      receive(JSON.stringify({ method: 'thread/started', params: { thread: { id: 'other-window' } } }));
      expect(events.slice(1)).toEqual([{ kind: 'selected', sessionId: 'A' }, { kind: 'selected', sessionId: 'B', name: 'Native B' }]);
    } finally { client.close(); await binding.close(); }
    expect(close).toHaveBeenCalledOnce();
  });
});
