import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { MultichatError } from '../errors.js';

/** Desktop's local client-coordination protocol, independently of the CLI daemon. */
export interface DesktopThreadSnapshot {
  id: string;
  name: string | null;
  cwd: string | null;
  rawStatus: unknown;
  activeTurnId: string | null;
  idle: boolean;
  revision: number;
}

export interface DesktopThreadSession {
  readonly threadId: string;
  readonly ownerId: string;
  snapshot(): Promise<DesktopThreadSnapshot>;
  startTurn(text: string): Promise<string>;
  steerTurn(text: string): Promise<string>;
  close(): Promise<void>;
}

export interface DesktopIpcOptions {
  signal?: AbortSignal;
  pipePath?: string;
  codexHome?: string;
  /** Isolated transport seam. A returned stream emits connect/error like a Socket. */
  connect?: (pipePath: string) => Duplex;
  timeoutMs?: number;
  snapshotTimeoutMs?: number;
}

export type DesktopIpcStage = 'prewrite' | 'rejected' | 'uncertain';

/** An unknown write outcome must never fall back to another owner or be retried. */
export class DesktopIpcError extends MultichatError {
  constructor(
    code: string,
    message: string,
    readonly stage: DesktopIpcStage,
    readonly ownerBound: boolean,
    options?: { cause?: unknown },
  ) {
    super(code, message, options);
    this.name = code === 'CODEX_DESKTOP_CANCELLED' ? 'AbortError' : 'DesktopIpcError';
  }
}

const MAX_FRAME_BYTES = 32 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const ABSENT_CODES = new Set(['ENOENT', 'ECONNREFUSED']);
type RecordValue = Record<string, unknown>;

function record(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }

function abortError(): DOMException { return new DOMException('Desktop operation cancelled.', 'AbortError'); }

function errno(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

function encode(message: RecordValue): Buffer {
  const body = Buffer.from(JSON.stringify(message));
  if (body.length === 0 || body.length > MAX_FRAME_BYTES) throw new Error('Desktop IPC frame exceeds 32 MiB.');
  const result = Buffer.allocUnsafe(body.length + 4);
  result.writeUInt32LE(body.length);
  body.copy(result, 4);
  return result;
}

interface PendingRequest {
  method: string;
  mutation: boolean;
  sent: boolean;
  timer: ReturnType<typeof setTimeout>;
  resolve(value: RecordValue): void;
  reject(error: unknown): void;
}

interface SnapshotWaiter {
  timer: ReturnType<typeof setTimeout>;
  resolve(value: DesktopThreadSnapshot): void;
  reject(error: unknown): void;
}

function normalizeSnapshot(value: unknown, threadId: string, revision: unknown): DesktopThreadSnapshot {
  if (!record(value) || value.id !== threadId || !Number.isSafeInteger(revision)
    || (revision as number) < 0 || !record(value.threadRuntimeStatus) || !text(value.threadRuntimeStatus.type)
    || !Array.isArray(value.turns)) throw new Error('Malformed Desktop snapshot metadata.');
  if (value.hostId !== undefined && value.hostId !== 'local') throw new Error('Desktop snapshot belongs to a different host.');
  if (value.cwd !== undefined && value.cwd !== null && typeof value.cwd !== 'string') throw new Error('Malformed Desktop working directory.');
  if (value.name !== undefined && value.name !== null && typeof value.name !== 'string') throw new Error('Malformed Desktop name.');
  let turns: unknown[] = [...value.turns];
  let latest: unknown = turns.at(-1);
  let tailKnown = true;
  if (value.turnHistory !== undefined) {
    if (!record(value.turnHistory) || value.turnHistory.kind !== 'canonical' || !record(value.turnHistory.history)) throw new Error('Malformed Desktop turn metadata.');
    const history = value.turnHistory.history;
    if (!Array.isArray(history.islands) || !record(history.entitiesByKey)) throw new Error('Malformed Desktop canonical metadata.');
    turns = [...turns, ...Object.values(history.entitiesByKey)];
    const tail: unknown = history.islands.at(-1);
    tailKnown = record(tail) && record(tail.newerBoundary) && tail.newerBoundary.status === 'exhausted' && Array.isArray(tail.entries);
    const entries = record(tail) && Array.isArray(tail.entries) ? tail.entries : [];
    const entry: unknown = entries.at(-1);
    latest = tailKnown && record(entry) && text(entry.value) ? history.entitiesByKey[entry.value] : undefined;
  }
  if (turns.some((turn) => !record(turn) || typeof turn.status !== 'string')) throw new Error('Malformed Desktop turn status.');
  const active = turns.findLast((turn) => record(turn) && turn.status === 'inProgress');
  const activeTurnId = record(active) && text(active.turnId) ? active.turnId : null;
  const unconfirmed: unknown = value.unconfirmedTurnSubmissions ?? [];
  if (!Array.isArray(unconfirmed) || unconfirmed.some((item) => !record(item))) throw new Error('Malformed Desktop submission metadata.');
  const flags: unknown = value.threadRuntimeStatus.activeFlags;
  if (flags !== undefined && (!Array.isArray(flags) || flags.some((flag) => typeof flag !== 'string'))) throw new Error('Malformed Desktop active flags.');
  // Native TurnStatus also terminates on cancellation or failure. Unknown
  // statuses remain unsettled even when the runtime currently reports idle.
  const latestIsTerminal = record(latest)
    && (latest.status === 'completed' || latest.status === 'interrupted' || latest.status === 'failed');
  // Do not retain the raw conversation or title (which can contain the first prompt).
  return {
    id: threadId,
    name: typeof value.name === 'string' && value.name !== '' ? value.name : null,
    cwd: typeof value.cwd === 'string' ? value.cwd : null,
    rawStatus: { type: value.threadRuntimeStatus.type, ...(flags === undefined ? {} : { activeFlags: [...flags as string[]] }) },
    activeTurnId,
    idle: value.threadRuntimeStatus.type === 'idle' && tailKnown && active === undefined
      && (latestIsTerminal || turns.length === 0)
      && unconfirmed.every((item) => record(item) && item.terminal === true),
    revision: revision as number,
  };
}

class DesktopConnection implements DesktopThreadSession {
  ownerId = '';
  private clientId = 'initializing-client';
  private readonly pending = new Map<string, PendingRequest>();
  private snapshotWaiter: SnapshotWaiter | undefined;
  private buffer: Buffer = Buffer.alloc(0);
  private closed = false;
  private subscribed = false;
  private writing = false;
  private latestSnapshot: DesktopThreadSnapshot | undefined;
  private closePromise: Promise<void> | undefined;
  private readonly onAbort = () => this.terminate(abortError());

  constructor(readonly threadId: string, private readonly socket: Duplex, private readonly options: DesktopIpcOptions) {
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('close', this.onClose);
    options.signal?.addEventListener('abort', this.onAbort, { once: true });
  }

  private error(code: string, message: string, stage: DesktopIpcStage = 'prewrite', cause?: unknown): DesktopIpcError {
    return new DesktopIpcError(code, message, stage, this.ownerId !== '', { cause });
  }

  async initialize(): Promise<boolean> {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.socket.off('connect', connected); this.socket.off('error', failed); this.socket.off('close', disconnected); this.options.signal?.removeEventListener('abort', cancelled); };
      const connected = () => { cleanup(); resolve(); };
      const failed = (error: Error) => { cleanup(); reject(error); };
      const disconnected = () => { cleanup(); reject(this.error('CODEX_DESKTOP_UNAVAILABLE', 'Desktop IPC closed before initialization.')); };
      const cancelled = () => { cleanup(); reject(abortError()); };
      const timer = setTimeout(() => { cleanup(); reject(this.error('CODEX_DESKTOP_UNAVAILABLE', 'Desktop IPC connection timed out.')); }, this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      this.socket.once('connect', connected);
      this.socket.once('error', failed);
      this.socket.once('close', disconnected);
      this.options.signal?.addEventListener('abort', cancelled, { once: true });
      if (this.options.signal?.aborted) cancelled();
    });
    const initialized = await this.request('initialize', { clientType: 'crosschat' }, 0);
    if (!record(initialized.result) || !text(initialized.result.clientId) || initialized.handledByClientId !== initialized.result.clientId) {
      throw this.error('CODEX_DESKTOP_PROTOCOL_ERROR', 'Desktop IPC did not allocate a matching client identity.');
    }
    this.clientId = initialized.result.clientId;
    let owner: RecordValue;
    try { owner = await this.request('thread-owner-discovery', { hostId: 'local', conversationId: this.threadId }, 1); }
    catch (error) {
      if (error instanceof DesktopIpcError && error.code === 'CODEX_DESKTOP_OWNER_NOT_FOUND') return false;
      throw error;
    }
    if (!text(owner.handledByClientId)) throw this.error('CODEX_DESKTOP_PROTOCOL_ERROR', 'Desktop discovery returned no owner identity.');
    this.ownerId = owner.handledByClientId;
    if (!record(owner.result) || owner.result.supportsUntrustedAppInput !== true) throw this.error('CODEX_DESKTOP_UNSUPPORTED', 'The Desktop owner does not support external input.');
    return true;
  }

  private assertOpen(): void {
    if (this.options.signal?.aborted) throw this.error('CODEX_DESKTOP_CANCELLED', 'Desktop operation cancelled.');
    if (this.closed || !this.socket.writable) throw this.error('CODEX_DESKTOP_UNAVAILABLE', 'The bound Desktop owner or connection is unavailable.');
  }

  private request(method: string, params: RecordValue, version: number, mutation = false): Promise<RecordValue> {
    this.assertOpen();
    const requestId = randomUUID();
    let encoded: Buffer;
    try {
      encoded = encode({ type: 'request', requestId, sourceClientId: this.clientId, method, params, version,
        timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS, ...(this.ownerId === '' ? {} : { targetClientId: this.ownerId }) });
    } catch (cause) { throw this.error('CODEX_DESKTOP_PROTOCOL_ERROR', 'Desktop input exceeds the safe frame size.', 'prewrite', cause); }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(this.error(mutation ? 'CODEX_WRITE_UNCERTAIN' : 'CODEX_DESKTOP_TIMEOUT', 'Desktop request timed out; it was not retried.', mutation ? 'uncertain' : 'prewrite'));
        this.terminate(new Error('Desktop request timed out.'));
      }, this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const pending: PendingRequest = { method, mutation, sent: false, resolve, reject, timer };
      this.pending.set(requestId, pending);
      try { pending.sent = true; this.socket.write(encoded); }
      catch (cause) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(this.error(mutation ? 'CODEX_WRITE_UNCERTAIN' : 'CODEX_DESKTOP_UNAVAILABLE', 'Desktop request could not be written.', mutation ? 'uncertain' : 'prewrite', cause));
        this.terminate(cause);
      }
    });
  }

  private readonly onError = (error: Error) => this.terminate(error);
  private readonly onClose = () => this.terminate(new Error('Desktop IPC connection closed.'));
  private readonly onData = (chunk: Buffer) => {
    try {
      this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
      while (this.buffer.length >= 4) {
        const size = this.buffer.readUInt32LE();
        if (size === 0 || size > MAX_FRAME_BYTES) throw new Error('Desktop IPC frame exceeds 32 MiB.');
        if (this.buffer.length < size + 4) return;
        const value: unknown = JSON.parse(this.buffer.subarray(4, size + 4).toString('utf8'));
        this.buffer = this.buffer.length === size + 4 ? Buffer.alloc(0) : this.buffer.subarray(size + 4);
        if (!record(value)) throw new Error('Malformed Desktop IPC message.');
        this.receive(value);
      }
    } catch (cause) { this.terminate(this.error('CODEX_DESKTOP_PROTOCOL_ERROR', 'Desktop IPC supplied an invalid frame or snapshot.', 'prewrite', cause)); }
  };

  private receive(message: RecordValue): void {
    if (message.type === 'client-discovery-request' && text(message.requestId)) {
      this.socket.write(encode({ type: 'client-discovery-response', requestId: message.requestId, response: { canHandle: false } }));
      return;
    }
    if (message.type === 'response' && text(message.requestId)) {
      const pending = this.pending.get(message.requestId);
      if (pending === undefined) return;
      this.pending.delete(message.requestId);
      clearTimeout(pending.timer);
      if (message.resultType === 'error') {
        const reason = typeof message.error === 'string' ? message.error : '';
        const uncertain = pending.mutation && /timeout|disconnected|closed/i.test(reason);
        const code = !pending.mutation && pending.method === 'thread-owner-discovery' && reason === 'no-client-found' ? 'CODEX_DESKTOP_OWNER_NOT_FOUND'
          : pending.mutation && /no active turn|NoActiveTurn|active turn already ended/i.test(reason) ? 'CODEX_NO_ACTIVE_TURN'
            : uncertain ? 'CODEX_WRITE_UNCERTAIN' : 'CODEX_DESKTOP_REQUEST_REJECTED';
        pending.reject(this.error(code, 'Desktop rejected the native request.', uncertain ? 'uncertain' : pending.mutation ? 'rejected' : 'prewrite'));
        if (uncertain) this.terminate(new Error('Desktop request outcome is unknown.'));
        return;
      }
      if (message.resultType !== 'success' || message.method !== pending.method
        || (this.ownerId !== '' && message.handledByClientId !== this.ownerId)) {
        pending.reject(this.error(pending.mutation ? 'CODEX_WRITE_UNCERTAIN' : 'CODEX_DESKTOP_PROTOCOL_ERROR', 'Desktop response did not match the bound request and owner.', pending.mutation ? 'uncertain' : 'prewrite'));
        this.terminate(new Error('Desktop response identity mismatch.'));
      } else pending.resolve(message);
      return;
    }
    if (message.type !== 'broadcast' || !record(message.params)) return;
    if (message.method === 'client-status-changed' && message.params.clientId === this.ownerId && message.params.status === 'disconnected') {
      this.terminate(new Error('The bound Desktop owner disconnected.'));
      return;
    }
    if (message.method !== 'thread-stream-state-changed' || message.version !== 11 || message.sourceClientId !== this.ownerId
      || message.params.hostId !== 'local' || message.params.conversationId !== this.threadId
      || !record(message.params.change) || message.params.change.type !== 'snapshot' || this.snapshotWaiter === undefined) return;
    const normalized = normalizeSnapshot(message.params.change.conversationState, this.threadId, message.params.change.revision);
    const waiter = this.snapshotWaiter;
    this.snapshotWaiter = undefined;
    clearTimeout(waiter.timer);
    this.latestSnapshot = normalized;
    waiter.resolve(normalized);
  }

  snapshot(): Promise<DesktopThreadSnapshot> {
    try { this.assertOpen(); } catch (error) { return Promise.reject(error); }
    if (this.snapshotWaiter !== undefined) return Promise.reject(this.error('CODEX_DESKTOP_QUERY_PENDING', 'A Desktop snapshot is already pending.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.snapshotWaiter = undefined;
        reject(this.error('CODEX_DESKTOP_TIMEOUT', 'A fresh Desktop snapshot did not arrive.'));
        this.terminate(new Error('Desktop snapshot timed out.'));
      }, this.options.snapshotTimeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      this.snapshotWaiter = { timer, resolve, reject };
      try { this.following(true); }
      catch (cause) { this.terminate(this.error('CODEX_DESKTOP_UNAVAILABLE', 'Desktop snapshot request failed.', 'prewrite', cause)); }
    });
  }

  private following(following: boolean): void {
    this.socket.write(encode({ type: 'broadcast', method: 'thread-stream-following-changed', sourceClientId: this.clientId, version: 1,
      targetClientIds: [this.ownerId], params: { hostId: 'local', conversationId: this.threadId, following } }));
    this.subscribed = following;
  }

  startTurn(content: string): Promise<string> { return this.submit(content, 'start'); }
  steerTurn(content: string): Promise<string> { return this.submit(content, 'steer'); }

  private async submit(content: string, mode: 'start' | 'steer'): Promise<string> {
    this.assertOpen();
    if (!text(content)) throw this.error('CODEX_DESKTOP_PROTOCOL_ERROR', 'Desktop input must be a nonempty string.');
    if (this.writing) throw this.error('CODEX_DESKTOP_WRITE_PENDING', 'A Desktop submission is already pending.');
    this.writing = true;
    try {
      if (mode === 'steer' && this.latestSnapshot === undefined) await this.snapshot();
      const input = [{ type: 'text', text: content, text_elements: [] }];
      const clientUserMessageId = randomUUID();
      const cwd = this.latestSnapshot?.cwd;
      const params = mode === 'start'
        ? { conversationId: this.threadId, turnStart: { request: { threadId: this.threadId, input, clientUserMessageId }, context: { inheritThreadSettings: true } } }
        : { conversationId: this.threadId, input, attachments: [], clientUserMessageId,
          restoreMessage: { input, cwd: cwd ?? null, createdAt: Date.now(), context: { workspaceRoots: cwd === null || cwd === undefined ? [] : [cwd], commentAttachments: [] } } };
      const response = await this.request(`thread-follower-${mode}-turn`, params, mode === 'start' ? 2 : 1, true);
      const result = record(response.result) && record(response.result.result) ? response.result.result : undefined;
      const turnId = mode === 'start' ? result !== undefined && record(result.turn) ? result.turn.id : undefined : result?.turnId;
      if (!text(turnId)) {
        this.terminate(new Error('Desktop returned no native turn identity.'));
        throw this.error('CODEX_WRITE_UNCERTAIN', 'Desktop accepted the request without a matching native turn ID.', 'uncertain');
      }
      return turnId;
    } finally { this.writing = false; }
  }

  private terminate(cause: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.options.signal?.removeEventListener('abort', this.onAbort);
    const cancelled = this.options.signal?.aborted === true;
    const readError = cause instanceof DesktopIpcError ? cause : this.error(cancelled ? 'CODEX_DESKTOP_CANCELLED' : 'CODEX_DESKTOP_UNAVAILABLE', cancelled ? 'Desktop operation cancelled.' : 'The Desktop connection or bound owner became unavailable.', 'prewrite', cause);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(pending.mutation && pending.sent ? this.error('CODEX_WRITE_UNCERTAIN', 'Desktop write outcome could not be confirmed; it was not retried.', 'uncertain', cause) : readError);
    }
    this.pending.clear();
    if (this.snapshotWaiter !== undefined) { clearTimeout(this.snapshotWaiter.timer); this.snapshotWaiter.reject(readError); this.snapshotWaiter = undefined; }
    this.buffer = Buffer.alloc(0);
    this.socket.destroy();
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    this.closePromise = new Promise<void>((resolve) => {
      if (this.closed || this.socket.destroyed) { this.terminate(new Error('Desktop session closed.')); resolve(); return; }
      if (this.subscribed && this.ownerId !== '' && this.socket.writable) {
        try { this.following(false); } catch { /* Disconnect also releases the follower. */ }
      }
      const finish = () => { clearTimeout(timer); this.terminate(new Error('Desktop session closed.')); resolve(); };
      const timer = setTimeout(finish, 100);
      this.socket.end(finish);
    });
    return this.closePromise;
  }
}

/** null means a positively absent transport/owner, never a failure after binding. */
export async function openDesktopThread(threadId: string, options: DesktopIpcOptions = {}): Promise<DesktopThreadSession | null> {
  if (!text(threadId)) throw new DesktopIpcError('CODEX_DESKTOP_PROTOCOL_ERROR', 'A complete native thread ID is required.', 'prewrite', false);
  if ([options.timeoutMs, options.snapshotTimeoutMs].some((value) => value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647))) {
    throw new DesktopIpcError('CODEX_DESKTOP_PROTOCOL_ERROR', 'Desktop timeouts must be positive bounded milliseconds.', 'prewrite', false);
  }
  if (options.signal?.aborted) throw abortError();
  const pipe = options.pipePath ?? (process.platform === 'win32' ? '\\\\.\\pipe\\codex-ipc' : join(options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'ipc', 'ipc.sock'));
  let socket: Duplex;
  try { socket = (options.connect ?? createConnection)(pipe); }
  catch (cause) {
    if (ABSENT_CODES.has(errno(cause) ?? '')) return null;
    throw new DesktopIpcError('CODEX_DESKTOP_UNAVAILABLE', 'Desktop IPC could not be opened.', 'prewrite', false, { cause });
  }
  const session = new DesktopConnection(threadId, socket, options);
  try {
    if (await session.initialize()) return session;
    await session.close();
    return null;
  } catch (cause) {
    await session.close();
    if (session.ownerId === '' && ABSENT_CODES.has(errno(cause) ?? '')) return null;
    if (cause instanceof DesktopIpcError || cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new DesktopIpcError('CODEX_DESKTOP_UNAVAILABLE', 'Desktop IPC initialization failed.', 'prewrite', session.ownerId !== '', { cause });
  }
}
