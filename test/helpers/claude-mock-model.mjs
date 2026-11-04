import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function modelMessage(result, index, model) {
  if (!isRecord(result)) throw new Error('Invalid model script result');
  const tool = isRecord(result.tool) ? result.tool : undefined;
  if (tool) {
    if (typeof tool.name !== 'string' || !tool.name || !isRecord(tool.input) || (tool.id !== undefined && (typeof tool.id !== 'string' || !tool.id))) throw new Error('Invalid model script result');
  } else if (typeof result.text !== 'string' || result.tool !== undefined) throw new Error('Invalid model script result');
  return {
    id: `crosschat-claude-fixture-${index}`, type: 'message', role: 'assistant', model,
    content: [tool ? { type: 'tool_use', id: tool.id ?? `fixture-bash-${index}`, name: tool.name, input: tool.input } : { type: 'text', text: result.text }],
    stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

function messageStream(message) {
  const content = message.content[0];
  const tool = content.type === 'tool_use';
  const frames = [
    { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: tool ? { ...content, input: {} } : { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: tool ? { type: 'input_json_delta', partial_json: JSON.stringify(content.input) } : { type: 'text_delta', text: content.text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: message.usage.output_tokens } },
    { type: 'message_stop' },
  ];
  return frames.map((frame) => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join('');
}

/** Script only model output; Claude still owns native sessions, inboxes and actual tool execution. */
export async function createClaudeMockModel(respond, options = {}) {
  if (typeof respond !== 'function') throw new TypeError('A model response function is required');
  const maxRequestBytes = options.maxRequestBytes ?? 2 * 1024 * 1024;
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1 || maxRequestBytes > 16 * 1024 * 1024) throw new RangeError('Invalid model request byte limit');
  const requests = [];
  const errors = [];
  const pending = new Set();
  let closing;
  const sendError = (response, status, code) => {
    if (response.destroyed || response.headersSent) return;
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ type: 'error', error: { type: 'crosschat_fixture_error', message: code } }));
  };
  const server = createServer((request, response) => {
    const controller = new globalThis.AbortController();
    pending.add(controller);
    response.once('close', () => { controller.abort(); pending.delete(controller); });
    void (async () => {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      if (request.method === 'HEAD' && pathname === '/api/hello') { response.writeHead(204); response.end(); return; }
      if (request.method !== 'POST' || !['/v1/messages', '/v1/messages/count_tokens'].includes(pathname)) { sendError(response, 404, 'UNEXPECTED_MODEL_ENDPOINT'); request.resume(); return; }
      if (request.headers['x-api-key'] !== 'mock-key') { sendError(response, 401, 'INVALID_FIXTURE_KEY'); request.resume(); return; }
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > maxRequestBytes) { sendError(response, 413, 'MODEL_REQUEST_TOO_LARGE'); return; }
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { sendError(response, 400, 'INVALID_JSON'); return; }
      if (!isRecord(body) || typeof body.model !== 'string' || !body.model || !Array.isArray(body.messages) || (body.stream !== undefined && typeof body.stream !== 'boolean')) { sendError(response, 400, 'INVALID_MESSAGES_REQUEST'); return; }
      if (pathname === '/v1/messages/count_tokens') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ input_tokens: Math.max(1, Math.ceil(size / 4)) }));
        return;
      }
      const index = requests.length;
      requests.push(body);
      const result = await respond(body, { index, signal: controller.signal });
      if (response.destroyed || controller.signal.aborted) return;
      const message = modelMessage(result, index, body.model);
      const payload = body.stream ? messageStream(message) : JSON.stringify(message);
      response.writeHead(200, { 'content-type': body.stream ? 'text/event-stream; charset=utf-8' : 'application/json', 'cache-control': 'no-cache' });
      response.end(payload);
    })().catch(() => {
      if (controller.signal.aborted) return;
      // Script errors may include sensitive request data; reports and HTTP carry only this stable code.
      errors.push('MODEL_SCRIPT_FAILED');
      sendError(response, 500, 'MODEL_SCRIPT_FAILED');
    });
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Claude model fixture did not bind loopback');
  return {
    url: `http://127.0.0.1:${address.port}`, requests, errors,
    async waitForRequests(count, timeout = 10000) {
      const deadline = Date.now() + timeout;
      while (requests.length < count && Date.now() < deadline && !closing) await delay(20);
      if (requests.length < count) throw new Error(`Expected ${count} Claude model requests, observed ${requests.length}`);
    },
    close() {
      return closing ??= new Promise((done, reject) => {
        for (const controller of pending) controller.abort();
        server.close((error) => error ? reject(error) : done());
        server.closeAllConnections();
      });
    },
  };
}
