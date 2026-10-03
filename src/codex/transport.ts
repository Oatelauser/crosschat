import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { Duplex, type Duplex as DuplexStream } from 'node:stream';
import WebSocket from 'ws';
import { MultichatError } from '../errors.js';

/**
 * Transport for the Codex app-server on Windows (docs/research/codex-windows-feasibility.md):
 * spawn `codex app-server proxy`, use its stdin/stdout as a transparent byte pipe,
 * and run a WebSocket upgrade (`ws://localhost/rpc`) over that pipe. JSON-RPC
 * frames travel as ws text messages. The proxy is short-lived and every session
 * kills the exact process tree it spawned; the user's daemon is never started
 * or stopped by this module.
 */

export interface CodexMessageChannel {
  send(payload: string): void;
  onMessage(listener: (payload: string) => void): () => void;
  onClose(listener: () => void): () => void;
  /** Close the channel itself (WebSocket close frame); never throws. */
  close(): Promise<void>;
  readonly stderrText: string;
}

export interface CodexProxySession {
  readonly channel: CodexMessageChannel;
  close(): Promise<void>;
}

/** Seam for unit tests: builds the message channel over the proxy stdio duplex. */
export type CodexChannelFactory = (duplex: DuplexStream) => Promise<CodexMessageChannel>;

/** Seam for unit tests: spawns the proxy process. */
export type CodexProxySpawner = (
  command: string,
  args: readonly string[],
) => ChildProcessWithoutNullStreams;

const MAX_STDERR_BYTES = 64 * 1024;
const SPAWN_TIMEOUT_MS = 10_000;
const WS_CLOSE_TIMEOUT_MS = 2_000;
const GRACEFUL_EXIT_MS = 2_000;
const KILL_EXIT_TIMEOUT_MS = 1_500;

/**
 * Identity vars that must never leak into the spawned codex proxy: a parent
 * Claude Code or Codex CLI session would otherwise make the codex side see a
 * dual identity (CALLER_IDENTITY_CONFLICT, measured 2026-10-02 B5).
 */
const STRIP_ENV_KEYS = [
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SESSION_ID',
  'CODEX_THREAD_ID',
  'CODEX_SESSION_ID',
];

export function sanitizeProxyEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = { ...env };
  for (const key of STRIP_ENV_KEYS) delete clean[key];
  return clean;
}

/**
 * Resolve the codex executable. On Windows the npm shim (`codex.cmd`) cannot be
 * spawned without a shell, so the native exe is located explicitly.
 */
export function resolveCodexExecutable(): string {
  const override = process.env.CROSSCHAT_CODEX_BIN;
  if (override) return override;
  if (process.platform !== 'win32') return 'codex';
  const candidates: string[] = [];
  if (process.env.APPDATA) {
    candidates.push(
      join(
        process.env.APPDATA,
        'npm',
        'node_modules',
        '@openai',
        'codex',
        'node_modules',
        '@openai',
        'codex-win32-x64',
        'vendor',
        'x86_64-pc-windows-msvc',
        'bin',
        'codex.exe',
      ),
    );
  }
  const where = spawnSync('where.exe', ['codex'], { encoding: 'utf8' });
  if (where.status === 0) {
    for (const line of where.stdout.split(/\r?\n/)) {
      if (line.trim().toLowerCase().endsWith('.exe')) candidates.push(line.trim());
    }
  }
  candidates.push(
    join(homedir(), '.codex', 'packages', 'app-server-daemon', 'current', 'bin', 'codex.exe'),
  );
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new MultichatError(
      'CODEX_PROXY_SPAWN_FAILED',
      `codex executable not found; tried: ${candidates.join(', ')}`,
    );
  }
  return found;
}

/** stdin/stdout of the proxy child exposed as one socket-like Duplex for ws. */
class ChildProxyDuplex extends Duplex {
  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    super();
    this.on('error', () => undefined);
    child.stdout.pause();
    child.stdout.on('data', (chunk: Buffer) => {
      if (!this.push(chunk)) child.stdout.pause();
    });
    child.stdout.on('end', () => this.push(null));
    child.stdout.on('error', () => this.destroy(new Error('proxy stdout failed')));
    child.stdin.on('error', () => this.destroy(new Error('proxy stdin failed')));
    child.on('error', () => this.destroy(new Error('proxy process failed')));
  }

  override _read(): void {
    this.child.stdout.resume();
  }

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (!this.child.stdin.writable) {
      callback(new Error('proxy stdin closed'));
      return;
    }
    this.child.stdin.write(chunk, encoding, callback);
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.child.stdin.end(callback);
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.child.stdin.destroy();
    this.child.stdout.destroy();
    callback(error);
  }

  setKeepAlive(): this {
    return this;
  }

  setNoDelay(): this {
    return this;
  }

  setTimeout(_timeout: number, callback?: () => void): this {
    if (callback) this.once('timeout', callback);
    return this;
  }
}

/** Bounded stderr capture: keeps at most MAX_STDERR_BYTES for diagnostics. */
class StderrCapture {
  private chunks: Buffer[] = [];
  private bytes = 0;

  push(chunk: Buffer): void {
    if (this.bytes >= MAX_STDERR_BYTES) return;
    const room = MAX_STDERR_BYTES - this.bytes;
    const kept = chunk.length > room ? chunk.subarray(0, room) : chunk;
    this.chunks.push(kept);
    this.bytes += kept.length;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

function waitForSpawn(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('spawn', onSpawn);
      child.off('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onSpawn = () => finish();
    const onError = (error: Error) => finish(error);
    const timer = setTimeout(
      () => finish(new Error('codex proxy spawn timed out')),
      timeoutMs,
    );
    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
}

function closeWebSocket(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off('close', finish);
      resolve();
    };
    const timer = setTimeout(() => {
      socket.terminate();
      finish();
    }, WS_CLOSE_TIMEOUT_MS);
    socket.once('close', finish);
    if (socket.readyState === WebSocket.CLOSED) finish();
    else socket.close(1000);
  });
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (closed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('close', onClose);
      resolve(closed);
    };
    const onClose = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('close', onClose);
  });
}

/** Kill the exact process tree this session spawned. Never throws. */
async function killProxyTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  try {
    child.stdin.end();
  } catch {
    // already closed
  }
  if (await waitForExit(child, GRACEFUL_EXIT_MS)) return;
  const pid = child.pid;
  if (pid !== undefined) {
    if (process.platform === 'win32') {
      spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try {
        child.kill('SIGKILL');
      } catch {
        // already dead
      }
    }
  }
  await waitForExit(child, KILL_EXIT_TIMEOUT_MS);
}

function rawDataToBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.concat(data);
}

/** Default channel factory: WebSocket upgrade over the proxy stdio duplex. */
export async function wsChannelFactory(duplex: DuplexStream): Promise<CodexMessageChannel> {
  const socket = new WebSocket('ws://localhost/rpc', {
    createConnection: () => {
      // Node's HTTP upgrade client waits for the socket 'connect' event; the
      // child stdio duplex has no TCP tuning knobs to apply.
      queueMicrotask(() => duplex.emit('connect'));
      return duplex as never;
    },
    followRedirects: false,
    handshakeTimeout: 10_000,
    maxPayload: 16 * 1024 * 1024,
    perMessageDeflate: false,
  });
  // Permanent sink so a pre-listener error cannot become an uncaught exception.
  socket.on('error', () => undefined);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: MultichatError) => {
      if (settled) return;
      settled = true;
      socket.off('open', onOpen);
      socket.off('error', onError);
      socket.off('unexpected-response', onUnexpected);
      if (error) {
        socket.terminate();
        reject(error);
      } else {
        resolve();
      }
    };
    const onOpen = () => finish();
    const onError = () =>
      finish(new MultichatError('CODEX_TRANSPORT_CLOSED', 'codex proxy connection failed.'));
    const onUnexpected = () =>
      finish(new MultichatError('CODEX_PROTOCOL_ERROR', 'codex proxy rejected the WebSocket upgrade.'));
    socket.once('open', onOpen);
    socket.once('error', onError);
    socket.once('unexpected-response', onUnexpected);
  });

  const messageListeners = new Set<(payload: string) => void>();
  const closeListeners = new Set<() => void>();
  socket.on('message', (data, isBinary) => {
    if (isBinary) return;
    const payload = rawDataToBuffer(data).toString('utf8');
    for (const listener of [...messageListeners]) listener(payload);
  });
  socket.on('close', () => {
    for (const listener of [...closeListeners]) listener();
  });

  return {
    send(payload) {
      // Write failures surface through the 'error'/'close' events, which fail
      // every pending request; the per-request timeout bounds hangs.
      socket.send(payload, () => undefined);
    },
    onMessage(listener) {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    onClose(listener) {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    close() {
      return closeWebSocket(socket);
    },
    get stderrText() {
      return '';
    },
  };
}

export interface CodexProxySessionOptions {
  executable?: string;
  channelFactory?: CodexChannelFactory;
  spawnProxy?: CodexProxySpawner;
}

/**
 * Spawn `codex app-server proxy`, perform the WebSocket upgrade over its
 * stdio, and return the session. The caller must close() it; close() closes
 * the WebSocket, ends the proxy stdin, and force-kills the spawned tree if it
 * does not exit on its own.
 */
export async function openCodexProxySession(
  options: CodexProxySessionOptions = {},
): Promise<CodexProxySession> {
  // An injected spawnProxy ignores the command argument entirely: resolve the
  // real executable only when the default spawner will run, so hermetic tests
  // (and codex-less CI runners) do not require a local codex install.
  const command =
    options.executable ?? (options.spawnProxy !== undefined ? 'codex' : resolveCodexExecutable());
  const doSpawn: CodexProxySpawner =
    options.spawnProxy ??
    ((cmd, args) =>
      spawn(cmd, [...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
        env: sanitizeProxyEnv(process.env),
      }));
  const channelFactory = options.channelFactory ?? wsChannelFactory;

  let child: ChildProcessWithoutNullStreams;
  try {
    child = doSpawn(command, ['app-server', 'proxy']);
  } catch (err) {
    throw new MultichatError(
      'CODEX_PROXY_SPAWN_FAILED',
      `Failed to spawn the codex app-server proxy (${command}).`,
      { cause: err },
    );
  }
  const stderr = new StderrCapture();
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  const duplex = new ChildProxyDuplex(child);

  const spawnError = (message: string, cause?: unknown): MultichatError =>
    new MultichatError('CODEX_PROXY_SPAWN_FAILED', message, {
      cause: cause ?? (stderr.text() ? new Error(stderr.text()) : undefined),
      stderrText: stderr.text(),
    });

  try {
    await waitForSpawn(child, SPAWN_TIMEOUT_MS);
  } catch (err) {
    duplex.destroy();
    await killProxyTree(child).catch(() => undefined);
    throw spawnError(`The codex app-server proxy failed to start (${command}).`, err);
  }

  let channel: CodexMessageChannel;
  try {
    channel = await channelFactory(duplex);
  } catch (err) {
    duplex.destroy();
    await killProxyTree(child).catch(() => undefined);
    if (err instanceof MultichatError) {
      // The ws-level error knows nothing of the child; carry the bounded
      // stderr capture out so callers can report why the proxy died.
      if (err.stderrText === undefined && stderr.text() !== '') err.stderrText = stderr.text();
      throw err;
    }
    throw spawnError('The codex app-server proxy channel could not be established.', err);
  }

  const channelWithStderr: CodexMessageChannel = {
    send: (payload) => channel.send(payload),
    onMessage: (listener) => channel.onMessage(listener),
    onClose: (listener) => channel.onClose(listener),
    close: () => channel.close(),
    get stderrText() {
      return stderr.text();
    },
  };

  let closePromise: Promise<void> | undefined;
  const session: CodexProxySession = {
    channel: channelWithStderr,
    close(): Promise<void> {
      closePromise ??= (async () => {
        // Close the WebSocket first (close frame through the proxy), then reap
        // the child tree.
        await channel.close().catch(() => undefined);
        await killProxyTree(child).catch(() => undefined);
      })();
      return closePromise;
    },
  };
  // If the server side goes away, reap our own process tree.
  channel.onClose(() => {
    void session.close().catch(() => undefined);
  });
  return session;
}
