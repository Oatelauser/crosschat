import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { isRecord } from '../application/sessions/reading.js';
import type { LauncherSessionBinding, SessionSelectionEvent } from '../application/session-selection.js';

export interface ClaudeSessionBindingOptions {
  args: readonly string[]; onSelection(event: SessionSelectionEvent): void; hookFile?: string;
  /** Exact spawned child only. Registry absence never falls back to another window. */
  currentSessionId?(): string | undefined;
  onUnavailable?(error: Error): void;
}
export type ClaudeSessionBindingFactory = (options: ClaudeSessionBindingOptions) => Promise<LauncherSessionBinding>;
const quote = (value: string): string => `'${value.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`;

/** A private channel per native child, supplied only through this invocation's settings. */
export async function createClaudeSessionBinding(options: ClaudeSessionBindingOptions): Promise<LauncherSessionBinding & { path: string; token: string }> {
  if (options.args.includes('--bare') || options.args.some((arg) => arg === '--settings' || arg.startsWith('--settings='))) throw new Error('当前 Claude 启动选项禁止或覆盖会话 hooks，无法自动跟随；请通过 TUI 选择会话入星。');
  const token = randomBytes(24).toString('hex');
  const directory = process.platform === 'win32' ? undefined : await mkdtemp(join(tmpdir(), 'cc-session-'));
  if (directory) await chmod(directory, 0o700);
  const path = directory ? join(directory, 'events.sock') : `\\\\.\\pipe\\crosschat-session-${token}`;
  const sockets = new Set<Socket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;
  let selectedId: string | undefined;
  let received = false;
  let readySince: number | undefined;
  const readCurrentId = (): string | undefined => {
    try { return options.currentSessionId?.(); }
    catch { return undefined; } // A source outage cannot select another window or crash a timer.
  };
  const readiness = options.currentSessionId ? setInterval(() => {
    if (disposed || received) { clearInterval(readiness); return; }
    if (readCurrentId() === undefined) { readySince = undefined; return; }
    readySince ??= Date.now();
    if (Date.now() - readySince >= 5000) {
      clearInterval(readiness);
      options.onUnavailable?.(new Error('Claude 已就绪，但没有收到本窗口的会话 hooks；自动入星暂不可核实，请检查 hooks 设置，或在 TUI 选择具体会话入星。'));
    }
  }, 1000) : undefined;
  const emit = (selection: SessionSelectionEvent, source?: unknown) => {
    if (disposed || (selection.kind === 'empty' && (selectedId === selection.sessionId || (source === 'startup' && selectedId !== undefined)))) return;
    const deadline = Date.now() + 600;
    const attempt = () => {
      if (disposed) return;
      if (selection.kind === 'empty' && (selectedId === selection.sessionId || (source === 'startup' && selectedId !== undefined))) return;
      if (!options.currentSessionId || readCurrentId() === selection.sessionId) {
        if (selection.kind === 'selected') selectedId = selection.sessionId;
        options.onSelection(selection); return;
      }
      if (Date.now() >= deadline) return; // Late background hooks cannot switch ownership.
      const timer = setTimeout(() => { timers.delete(timer); attempt(); }, 25); timers.add(timer);
    };
    attempt();
  };
  const server = createServer((socket) => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    socket.setTimeout(1000, () => socket.destroy());
    let input = '';
    socket.on('data', (chunk: Buffer) => {
      input += chunk.toString('utf8');
      if (Buffer.byteLength(input) > 32 * 1024) { socket.destroy(); return; }
      if (!input.includes('\n')) return;
      try {
        const value: unknown = JSON.parse(input.slice(0, input.indexOf('\n')));
        if (isRecord(value) && value.token === token && isRecord(value.input)) {
          received = true;
          const event = value.input;
          if (typeof event.session_id === 'string' && event.session_id.length > 0 && event.session_id.length <= 4096) {
            const session = { sessionId: event.session_id, ...(typeof event.session_title === 'string' && !event.session_title.includes(':') ? { name: event.session_title } : {}) };
            if (event.hook_event_name === 'UserPromptSubmit' || (event.hook_event_name === 'SessionStart' && event.source === 'resume')) emit({ kind: 'selected', ...session }, event.source);
            else if (event.hook_event_name === 'SessionStart' && ['startup', 'clear', 'fork'].includes(String(event.source))) emit({ kind: 'empty', ...session }, event.source);
          }
        }
      } catch { /* A malformed native event cannot change window ownership. */ }
      socket.end();
    });
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
    if (directory) await chmod(path, 0o600);
  } catch (error) { clearInterval(readiness); server.close(); if (directory) await rm(directory, { recursive: true, force: true }); throw error; }
  const hookFile = options.hookFile ?? fileURLToPath(new URL('../commands/session-event-hook.js', import.meta.url));
  const command = [process.execPath, hookFile, path, token].map(quote).join(' ');
  const handler = { matcher: '.*', hooks: [{ type: 'command', command, timeout: 1 }] };
  let closing: Promise<void> | undefined;
  return { path, token, args: ['--settings', JSON.stringify({ crossSessionInbound: 'accept', hooks: { SessionStart: [handler], UserPromptSubmit: [handler] } }), ...options.args],
    close: () => closing ??= (async () => { disposed = true; clearInterval(readiness); for (const timer of timers) clearTimeout(timer); timers.clear();
      for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve) => server.close(() => resolve())); if (directory) await rm(directory, { recursive: true, force: true }); })() };
}
