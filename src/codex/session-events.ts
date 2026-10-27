import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import type { RawData } from 'ws';
import type { IncomingMessage } from 'node:http';
import { openCodexProxySession } from './transport.js';
import type { CodexProxySession } from './transport.js';
import type { LauncherSessionBinding, SessionSelectionEvent } from '../application/session-selection.js';
import { isRecord } from '../application/sessions/reading.js';
import { startInstalledCodexOwner } from './launcher-owner.js';

export interface CodexSessionBindingOptions {
  exe: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  onSelection(event: SessionSelectionEvent): void;
  openSession?(): Promise<CodexProxySession>;
}
export type CodexSessionBindingFactory = (options: CodexSessionBindingOptions) => Promise<LauncherSessionBinding>;

/** One window, including its native resume picker connections, sharing the existing native owner. */
export async function createCodexSessionBinding(options: CodexSessionBindingOptions): Promise<LauncherSessionBinding & { url: string; token: string }> {
  if (options.args.some((arg) => ['--remote', '--remote-auth-token-env', '--no-daemon'].includes(arg) || arg.startsWith('--remote=') || arg.startsWith('--remote-auth-token-env='))) {
    throw new Error('当前 Codex 连接选项没有已验证的窗口选择通道；请通过 TUI 选择具体会话入星。');
  }
  const open = options.openSession ?? (() => openCodexProxySession({ executable: options.exe, env: options.env }));
  let first: CodexProxySession | undefined;
  try { first = await open(); }
  catch (error) {
    if (options.openSession) throw error;
    await startInstalledCodexOwner({ executable: options.exe, env: options.env });
    first = await open();
  }
  const token = randomBytes(32).toString('hex');
  const expected = Buffer.from(`Bearer ${token}`);
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0, maxPayload: 16 * 1024 * 1024,
    verifyClient: (info: { req: IncomingMessage }) => { const got = Buffer.from(info.req.headers.authorization ?? ''); return got.length === expected.length && timingSafeEqual(got, expected); } });
  const connections = new Set<Promise<void>>();
  let disposed = false;
  let currentId: string | undefined;
  let requestOrder = 0;
  let selectionOrder = 0;
  server.on('connection', (socket) => {
    if (disposed || connections.size >= 8) { socket.close(1008, 'Window connection bound exceeded'); return; }
    // The /resume picker needs its own native RPC connection within this window.
    const queued: string[] = []; let queuedBytes = 0;
    let upstream: CodexProxySession | undefined;
    const pending = new Map<string, { method: string; params: Record<string, unknown>; order: number }>();
    const inspect = (input: unknown) => {
      if (!isRecord(input) || !('id' in input)) return;
      const key = JSON.stringify(input.id); const request = pending.get(key); if (!request) return;
      pending.delete(key);
      if (!isRecord(input.result) || input.error !== undefined) return;
      if (request.order < selectionOrder) return;
      const thread = input.result.thread;
      if (request.method === 'turn/start') {
        if (typeof request.params.threadId === 'string' && request.params.threadId === currentId && isRecord(input.result.turn)) options.onSelection({ kind: 'selected', sessionId: currentId });
      } else if (isRecord(thread) && typeof thread.id === 'string' && thread.id.length > 0) {
        if (request.method === 'thread/resume' && request.params.threadId !== thread.id) return;
        selectionOrder = request.order;
        currentId = thread.id;
        options.onSelection({ kind: request.method === 'thread/start' ? 'empty' : 'selected', sessionId: thread.id,
          ...(typeof thread.name === 'string' && !thread.name.includes(':') ? { name: thread.name } : {}) });
      }
    };
    socket.on('error', () => socket.terminate());
    socket.on('message', (data: RawData) => {
      const payload = data.toString();
      try {
        const value: unknown = JSON.parse(payload);
        if (isRecord(value) && (typeof value.id === 'number' || typeof value.id === 'string') && typeof value.method === 'string'
          && ['thread/start', 'thread/resume', 'thread/fork', 'turn/start'].includes(value.method) && isRecord(value.params)) {
          if (pending.size >= 128) { socket.close(1008, 'Window request bound exceeded'); return; }
          // Native title generation also calls thread/start + turn/start. It is not the selected chat.
          if (value.method !== 'thread/start' || (value.params.ephemeral === false && value.params.threadSource === 'user')) {
            pending.set(JSON.stringify(value.id), { method: value.method, params: value.params, order: ++requestOrder });
          }
        }
        if (upstream) upstream.channel.send(payload);
        else if (queuedBytes + Buffer.byteLength(payload) <= 1024 * 1024) { queued.push(payload); queuedBytes += Buffer.byteLength(payload); }
        else socket.close(1008, 'Window startup buffer exceeded');
      } catch { socket.close(1011, 'Native channel failed'); }
    });
    const initial = first; first = undefined;
    const lifetime = (async () => {
      const removers: Array<() => void> = [];
      try {
        upstream = initial ?? await open();
        if (disposed || socket.readyState !== WebSocket.OPEN) return;
        removers.push(upstream.channel.onMessage((payload) => {
          try { inspect(JSON.parse(payload)); } catch { /* Unknown native messages stay transparent. */ }
          if (socket.readyState === WebSocket.OPEN) socket.send(payload);
        }), upstream.channel.onClose(() => socket.close(1011, 'Native connection closed')));
        for (const payload of queued.splice(0)) upstream.channel.send(payload); queuedBytes = 0;
        await new Promise<void>((resolve) => { if (socket.readyState === WebSocket.CLOSED) resolve(); else socket.once('close', () => resolve()); });
      } catch { socket.close(1011, 'Native connection unavailable'); }
      finally { for (const remove of removers) remove(); pending.clear(); await upstream?.close(); }
    })();
    connections.add(lifetime); void lifetime.finally(() => connections.delete(lifetime)).catch(() => undefined);
  });
  try { await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); }); }
  catch (error) { await first?.close(); server.close(); throw error; }
  const address = server.address();
  if (typeof address !== 'object' || address === null) { await first?.close(); server.close(); throw new Error('Native window channel unavailable'); }
  let closing: Promise<void> | undefined;
  const url = `ws://127.0.0.1:${address.port}`;
  return { url, token, args: ['--remote', url, '--remote-auth-token-env', 'CROSSCHAT_CODEX_WINDOW_TOKEN', ...options.args],
    env: { ...options.env, CROSSCHAT_CODEX_WINDOW_TOKEN: token },
    close: () => closing ??= (async () => { disposed = true; for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve())); await first?.close(); await Promise.allSettled(connections); })() };
}
