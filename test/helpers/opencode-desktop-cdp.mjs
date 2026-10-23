import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import { URL } from 'node:url';
import WebSocket from 'ws';

const record = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function positive(value, fallback, name) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`${name} must be a positive integer.`);
  return result;
}

/** The caller must first prove this endpoint belongs to its owned official desktop process. */
export async function connectDesktopCDP(websocketURL, options = {}) {
  const url = new URL(websocketURL);
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw new Error('A CDP WebSocket URL without embedded credentials is required.');
  const connectionTimeoutMs = positive(options.connectionTimeoutMs, 10_000, 'connectionTimeoutMs');
  const commandTimeoutMs = positive(options.commandTimeoutMs, 10_000, 'commandTimeoutMs');
  const maxMessageBytes = positive(options.maxMessageBytes, 8 * 1024 * 1024, 'maxMessageBytes');
  const maxPending = positive(options.maxPending, 32, 'maxPending');
  const socket = new WebSocket(url, { maxPayload: maxMessageBytes, handshakeTimeout: connectionTimeoutMs, followRedirects: false });
  const pending = new Map();
  let nextID = 0;
  let ended = false;
  let closePromise;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });

  const settle = (id, error, result) => {
    const command = pending.get(id);
    if (!command) return;
    pending.delete(id);
    clearTimeout(command.timer);
    if (error) command.reject(error);
    else command.resolve(result);
  };

  const end = (error) => {
    if (ended) return;
    ended = true;
    clearTimeout(connectionTimer);
    rejectReady(error);
    for (const id of pending.keys()) settle(id, error);
  };

  const terminate = (error) => {
    end(error);
    socket.terminate();
  };

  const connectionTimer = setTimeout(() => terminate(failure('CDP_CONNECT_TIMEOUT', 'Desktop CDP connection timed out.')), connectionTimeoutMs);
  socket.once('open', () => { clearTimeout(connectionTimer); resolveReady(); });
  socket.on('error', () => end(failure('CDP_TRANSPORT_ERROR', 'Desktop CDP transport failed.')));
  socket.once('unexpected-response', (_request, response) => {
    response.destroy();
    terminate(failure('CDP_CONNECT_REJECTED', `Desktop CDP handshake was rejected (HTTP ${response.statusCode ?? 'unknown'}).`));
  });
  socket.once('close', () => end(failure('CDP_CLOSED', 'Desktop CDP connection closed.')));
  socket.on('message', (data, binary) => {
    if (ended) return;
    const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
    if (binary || bytes.byteLength > maxMessageBytes) {
      terminate(failure('CDP_PROTOCOL_ERROR', 'Desktop CDP returned a binary or oversized message.'));
      return;
    }
    let message;
    try { message = JSON.parse(bytes.toString('utf8')); }
    catch { terminate(failure('CDP_PROTOCOL_ERROR', 'Desktop CDP returned malformed JSON.')); return; }
    if (!record(message)) { terminate(failure('CDP_PROTOCOL_ERROR', 'Desktop CDP returned an invalid message.')); return; }
    if (message.id === undefined && typeof message.method === 'string') return; // Events are live-only and not retained.
    if (!Number.isSafeInteger(message.id) || message.id <= 0) {
      terminate(failure('CDP_PROTOCOL_ERROR', 'Desktop CDP response has an invalid request ID.'));
      return;
    }
    const command = pending.get(message.id);
    if (!command) return; // A timed-out request can still produce one late response.
    if (message.error !== undefined) {
      if (!record(message.error) || !Number.isInteger(message.error.code)) {
        terminate(failure('CDP_PROTOCOL_ERROR', 'Desktop CDP returned an invalid command error.'));
        return;
      }
      settle(message.id, failure('CDP_COMMAND_REJECTED', `Desktop CDP ${command.method} was rejected (code ${message.error.code}).`));
    } else if (!Object.hasOwn(message, 'result') || !record(message.result)) {
      terminate(failure('CDP_PROTOCOL_ERROR', 'Desktop CDP returned an invalid command result.'));
    } else settle(message.id, undefined, message.result);
  });

  try { await ready; }
  catch (error) { socket.terminate(); throw error; }

  const send = (method, params = {}, timeoutMs = commandTimeoutMs) => {
    if (ended || socket.readyState !== WebSocket.OPEN) return Promise.reject(failure('CDP_CLOSED', 'Desktop CDP connection is closed.'));
    if (typeof method !== 'string' || method.length === 0 || method.length > 256 || !record(params)) return Promise.reject(new Error('A CDP method and object parameters are required.'));
    if (pending.size >= maxPending) return Promise.reject(failure('CDP_PENDING_LIMIT', 'Desktop CDP pending command limit reached.'));
    const timeout = positive(timeoutMs, commandTimeoutMs, 'timeoutMs');
    const id = ++nextID;
    let payload;
    try { payload = JSON.stringify({ id, method, params }); }
    catch { return Promise.reject(new Error('CDP command parameters are not JSON serializable.')); }
    if (Buffer.byteLength(payload, 'utf8') > maxMessageBytes) return Promise.reject(failure('CDP_MESSAGE_LIMIT', 'Desktop CDP command exceeded the message limit.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => settle(id, failure('CDP_COMMAND_TIMEOUT', `Desktop CDP ${method} timed out; it was not retried.`)), timeout);
      pending.set(id, { method, resolve, reject, timer });
      try {
        socket.send(payload, (error) => {
          if (error) settle(id, failure('CDP_TRANSPORT_ERROR', `Desktop CDP ${method} could not be sent; it was not retried.`));
        });
      } catch { settle(id, failure('CDP_TRANSPORT_ERROR', `Desktop CDP ${method} could not be sent; it was not retried.`)); }
    });
  };

  return {
    send,
    async evaluate(expression, evaluateOptions = {}) {
      if (typeof expression !== 'string') throw new Error('A CDP expression string is required.');
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...evaluateOptions.params }, evaluateOptions.timeoutMs ?? commandTimeoutMs);
      if (result.exceptionDetails !== undefined) throw failure('CDP_EVALUATION_FAILED', 'Desktop CDP evaluation raised an exception.');
      if (!record(result.result)) throw failure('CDP_PROTOCOL_ERROR', 'Desktop CDP evaluation returned an invalid remote object.');
      return result.result.value;
    },
    async screenshot(path) {
      if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('An absolute screenshot output path is required.');
      const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
      if (typeof result.data !== 'string' || result.data.length > maxMessageBytes || !/^[A-Za-z0-9+/]+={0,2}$/.test(result.data)) {
        throw failure('CDP_PROTOCOL_ERROR', 'Desktop CDP screenshot returned invalid image data.');
      }
      const png = Buffer.from(result.data, 'base64');
      if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw failure('CDP_PROTOCOL_ERROR', 'Desktop CDP screenshot is not a PNG image.');
      await writeFile(path, png);
      return path;
    },
    close() {
      if (closePromise) return closePromise;
      end(failure('CDP_CLOSED', 'Desktop CDP connection closed by its owner.'));
      closePromise = new Promise((resolve) => {
        if (socket.readyState === WebSocket.CLOSED) { resolve(); return; }
        const timer = setTimeout(() => socket.terminate(), 1_000);
        socket.once('close', () => { clearTimeout(timer); resolve(); });
        if (socket.readyState === WebSocket.OPEN) socket.close(1000, 'Fixture complete');
        else socket.terminate();
      });
      return closePromise;
    },
  };
}
