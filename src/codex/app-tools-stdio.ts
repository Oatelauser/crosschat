import { randomUUID } from 'node:crypto';
import type { Readable, Writable } from 'node:stream';
import { MultichatError } from '../errors.js';
import type { AppToolsInvoker } from './app-tools.js';

const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const TOOLS = new Set(['list_threads', 'read_thread', 'send_message_to_thread']);

interface PendingRequest {
  id: string;
  resolve: (result: unknown) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The host executes requests through its normal tools and returns the raw MCP result. */
export function createAppToolsStdio(options: {
  input: Readable;
  output: Writable;
  timeoutMs?: number;
}): { invoke: AppToolsInvoker; close(): void } {
  const { input, output, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new MultichatError('CODEX_APP_TOOLS_PROTOCOL_ERROR', 'Host tool timeout must be positive bounded milliseconds.');
  }
  let closed = input.destroyed || input.readableEnded || output.destroyed || output.writableEnded;
  let pending: PendingRequest | undefined;
  let frame: Buffer = Buffer.alloc(0);
  let frameBytes = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });

  function terminate(error: MultichatError): void {
    if (closed) return;
    closed = true;
    input.off('data', onData);
    input.off('end', onInputEnd);
    input.off('close', onInputEnd);
    input.off('error', onInputError);
    output.off('close', onOutputEnd);
    output.off('finish', onOutputEnd);
    output.off('error', onOutputError);
    // These streams belong to the caller. Stop consuming, but do not close them.
    if (input.listenerCount('data') === 0) input.pause();
    frame = Buffer.alloc(0);
    frameBytes = 0;
    if (pending !== undefined) {
      clearTimeout(pending.timer);
      pending.reject(error);
      pending = undefined;
    }
  }

  function unavailable(message: string, cause?: unknown): void {
    terminate(new MultichatError('CODEX_APP_TOOLS_CLOSED', `${message} A submitted tool's outcome may be unknown; it was not retried.`, { cause }));
  }

  function onInputEnd(): void { unavailable('Host response stream closed.'); }
  function onInputError(cause: Error): void { unavailable('Host response stream failed.', cause); }
  function onOutputEnd(): void { unavailable('Host request stream closed.'); }
  function onOutputError(cause: Error): void { unavailable('Host request stream failed.', cause); }

  function receive(line: string): void {
    const response: unknown = JSON.parse(line);
    if (!isRecord(response) || typeof response.id !== 'string' || pending === undefined || response.id !== pending.id) {
      throw new Error('Host response did not match the pending request.');
    }
    const hasResult = Object.hasOwn(response, 'result');
    const hasError = Object.hasOwn(response, 'error');
    if (hasResult === hasError || hasError && typeof response.error !== 'string') {
      throw new Error('Host response must contain exactly one result or string error.');
    }
    const request = pending;
    pending = undefined;
    clearTimeout(request.timer);
    if (hasError) {
      request.reject(new MultichatError('CODEX_APP_TOOLS_HOST_ERROR', `Host tool failed: ${String(response.error).slice(0, 2000)}`));
    } else request.resolve(response.result);
  }

  function onData(chunk: unknown): void {
    if (closed) return;
    try {
      if (typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) throw new Error('Host response was not UTF-8 bytes.');
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      let offset = 0;
      while (offset < bytes.length && !closed) {
        const newline = bytes.indexOf(0x0a, offset);
        const end = newline === -1 ? bytes.length : newline;
        const nextBytes = frameBytes + end - offset;
        if (nextBytes > MAX_FRAME_BYTES) throw new Error('Host response exceeds 8 MiB.');
        if (frame.length < nextBytes) {
          const capacity = Math.min(MAX_FRAME_BYTES, Math.max(nextBytes, frame.length * 2, 4096));
          const expanded = Buffer.allocUnsafe(capacity);
          frame.copy(expanded, 0, 0, frameBytes);
          frame = expanded;
        }
        frame.set(bytes.subarray(offset, end), frameBytes);
        frameBytes = nextBytes;
        if (newline === -1) return;
        // Preserve split UTF-8 sequences as bytes until the complete JSONL frame arrives.
        const line = decoder.decode(frame.subarray(0, frameBytes));
        frameBytes = 0;
        receive(line);
        offset = newline + 1;
      }
    } catch (cause) {
      terminate(new MultichatError('CODEX_APP_TOOLS_PROTOCOL_ERROR', 'Invalid host tool response; a submitted tool outcome is unconfirmed and was not retried.', { cause }));
    }
  }

  const invoke: AppToolsInvoker = async (tool, args) => {
    if (closed) throw new MultichatError('CODEX_APP_TOOLS_CLOSED', 'Host tool bridge is closed.');
    if (pending !== undefined) throw new MultichatError('CODEX_APP_TOOLS_BUSY', 'A host tool request is already pending.');
    if (!TOOLS.has(tool) || !isRecord(args)) throw new MultichatError('CODEX_APP_TOOLS_PROTOCOL_ERROR', 'Unsupported host tool request.');
    const id = randomUUID();
    let encoded: string;
    try {
      encoded = JSON.stringify({ type: 'tool-request', id, tool, arguments: args });
      if (Buffer.byteLength(encoded) > MAX_FRAME_BYTES) throw new Error('Host request exceeds 8 MiB.');
    } catch (cause) {
      throw new MultichatError('CODEX_APP_TOOLS_PROTOCOL_ERROR', 'Host tool request could not be encoded within 8 MiB.', { cause });
    }
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        terminate(new MultichatError('CODEX_APP_TOOLS_TIMEOUT', 'Host tool response timed out; the outcome is unconfirmed and was not retried.'));
      }, timeoutMs);
      pending = { id, resolve, reject, timer };
      try { output.write(`${encoded}\n`); }
      catch (cause) { unavailable('Host tool request could not be written.', cause); }
    });
  };

  if (!closed) {
    input.on('data', onData);
    input.on('end', onInputEnd);
    input.on('close', onInputEnd);
    input.on('error', onInputError);
    output.on('close', onOutputEnd);
    output.on('finish', onOutputEnd);
    output.on('error', onOutputError);
  }

  return { invoke, close: () => unavailable('Host tool bridge closed.') };
}
