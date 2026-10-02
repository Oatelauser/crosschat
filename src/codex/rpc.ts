import { MultichatError } from '../errors.js';
import type { CodexMessageChannel } from './transport.js';

/**
 * JSON-RPC client for the codex app-server wire protocol. Wire facts verified
 * on this machine (docs/research/codex-windows-feasibility.md §1.5): response and
 * notification frames carry NO `jsonrpc` field (`{id,result}` / `{method,params}`),
 * so parsing must not require it.
 */

/** Whitelist of client methods; anything else is a programming error. */
const WHITELISTED_METHODS = new Set([
  'initialize',
  'thread/list',
  'thread/resume',
  'turn/start',
  'turn/steer',
  'thread/unsubscribe',
  // Used only by the isolated live self-test (thread/start creates a fresh
  // thread owned by multichat; thread/delete removes it). deliver() and
  // discovery() never call these on user threads.
  'thread/start',
  'thread/delete',
]);

export interface CodexRpcNotification {
  method: string;
  params: unknown;
}

/** JSON-RPC error response (the server explicitly rejected the request). */
export class CodexRpcRejectedError extends MultichatError {
  readonly rpcCode: number;

  constructor(rpcCode: number, message: string) {
    super('CODEX_RPC_REJECTED', message);
    this.name = 'CodexRpcRejectedError';
    this.rpcCode = rpcCode;
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class CodexRpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  /** Timed-out request ids: late matching responses are dropped, not faults. */
  private readonly abandoned = new Set<number>();
  private readonly notificationListeners = new Set<(n: CodexRpcNotification) => void>();
  private closed = false;

  /** Every notification received, in order (turn/started, item/completed, ...). */
  readonly notifications: CodexRpcNotification[] = [];
  /**
   * Server-initiated requests (approval family etc.), recorded as evidence.
   * multichat never answers approvals, so no response is ever sent back.
   */
  readonly serverRequests: CodexRpcNotification[] = [];

  constructor(
    private readonly channel: CodexMessageChannel,
    private readonly requestTimeoutMs = 30_000,
  ) {
    channel.onMessage((payload) => this.handlePayload(payload));
    channel.onClose(() => this.failAll(new MultichatError('CODEX_TRANSPORT_CLOSED', 'codex channel closed.')));
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!WHITELISTED_METHODS.has(method)) {
      throw new MultichatError('CODEX_PROTOCOL_ERROR', `codex rpc method not allowed: ${method}`);
    }
    if (this.closed) {
      throw new MultichatError('CODEX_TRANSPORT_CLOSED', 'codex channel closed.');
    }
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.abandoned.add(id);
        reject(new MultichatError('CODEX_REQUEST_TIMEOUT', `codex request timed out: ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.channel.send(JSON.stringify({ id, method, params }));
    });
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.channel.send(JSON.stringify({ method, params }));
  }

  onNotification(listener: (notification: CodexRpcNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  dispose(): void {
    this.closed = true;
    this.failAll(new MultichatError('CODEX_TRANSPORT_CLOSED', 'codex rpc client disposed.'));
  }

  private handlePayload(payload: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      this.protocolFailure();
      return;
    }
    if (!isRecord(parsed)) {
      this.protocolFailure();
      return;
    }
    if (typeof parsed.method === 'string') {
      const frame: CodexRpcNotification = { method: parsed.method, params: parsed.params };
      if (parsed.id !== undefined) {
        this.serverRequests.push(frame);
      } else {
        this.notifications.push(frame);
        for (const listener of [...this.notificationListeners]) listener(frame);
      }
      return;
    }
    if (typeof parsed.id !== 'number' || !Number.isSafeInteger(parsed.id)) {
      this.protocolFailure();
      return;
    }
    const pending = this.pending.get(parsed.id);
    if (pending === undefined) {
      // Responses to requests we already timed out arrive late; drop them.
      if (!this.abandoned.has(parsed.id)) this.protocolFailure();
      return;
    }
    const hasResult = Object.hasOwn(parsed, 'result');
    const hasError = Object.hasOwn(parsed, 'error');
    if (hasResult === hasError) {
      this.protocolFailure();
      return;
    }
    this.pending.delete(parsed.id);
    clearTimeout(pending.timer);
    if (hasError) {
      const err = parsed.error;
      const rpcCode = isRecord(err) && typeof err.code === 'number' ? err.code : 0;
      const message =
        isRecord(err) && typeof err.message === 'string' ? err.message : 'codex rpc error';
      pending.reject(new CodexRpcRejectedError(rpcCode, message));
      return;
    }
    pending.resolve(parsed.result);
  }

  private protocolFailure(): void {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new MultichatError('CODEX_PROTOCOL_ERROR', 'malformed codex rpc frame.'));
  }

  private failAll(error: MultichatError): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
