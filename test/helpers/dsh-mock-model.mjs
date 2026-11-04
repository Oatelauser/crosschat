import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Follows the official 0.2.1-rc.2 Messages fixture, including message_stop (no OpenAI [DONE]).
function messageStream(result, index) {
  const tool = isRecord(result?.tool) ? result.tool : undefined;
  if ((!tool && typeof result?.text !== 'string') || (tool && (typeof tool.name !== 'string' || !tool.name || !isRecord(tool.input)))) throw new Error('Invalid model script result');
  const frames = [
    { type: 'message_start', message: { id: `crosschat-fixture-${index}`, type: 'message', role: 'assistant', model: 'deepseek-flash', content: [], usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: tool ? { type: 'tool_use', id: tool.id ?? `fixture-tool-${index}`, name: tool.name, input: {} } : { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: tool ? { type: 'input_json_delta', partial_json: JSON.stringify(tool.input) } : { type: 'text_delta', text: result.text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } },
    { type: 'message_stop' },
  ];
  return frames.map((frame) => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join('');
}

/** Only provider output is scripted; the tested Harness owns Agent, inbox, tools and shell identity. */
export async function createDshMockModel(respond, options = {}) {
  if (typeof respond !== 'function') throw new TypeError('A model response function is required');
  const maxRequestBytes = options.maxRequestBytes ?? 2 * 1024 * 1024;
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1 || maxRequestBytes > 16 * 1024 * 1024) throw new RangeError('Invalid model request byte limit');
  const requests = [];
  const errors = [];
  const pending = new Set();
  let closing;
  const sendError = (response, status, code) => {
    if (!response.destroyed && !response.headersSent) { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { type: 'crosschat_fixture_error', code } })); }
  };
  const server = createServer((request, response) => {
    const controller = new globalThis.AbortController();
    pending.add(controller);
    response.once('close', () => { controller.abort(); pending.delete(controller); });
    void (async () => {
      if (request.method !== 'POST' || request.url !== '/v1/messages') { sendError(response, 404, 'UNEXPECTED_MODEL_ENDPOINT'); request.resume(); return; }
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
      if (!isRecord(body) || typeof body.model !== 'string' || !Array.isArray(body.messages) || body.stream !== true) { sendError(response, 400, 'INVALID_MESSAGES_REQUEST'); return; }
      const index = requests.length;
      requests.push(body);
      const result = await respond(body, { index, signal: controller.signal });
      if (!response.destroyed) { const stream = messageStream(result, index); response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' }); response.end(stream); }
    })().catch(() => {
      if (controller.signal.aborted) return;
      // Do not copy arbitrary script errors (which could include request values) into reports or HTTP.
      errors.push('MODEL_SCRIPT_FAILED');
      sendError(response, 500, 'MODEL_SCRIPT_FAILED');
    });
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Model fixture did not bind loopback');
  return {
    url: `http://127.0.0.1:${address.port}/v1`, requests, errors,
    async waitForRequests(count, timeout = 10000) {
      const deadline = Date.now() + timeout;
      while (requests.length < count && Date.now() < deadline) await delay(20);
      if (requests.length < count) throw new Error(`Expected ${count} DSH model requests, observed ${requests.length}`);
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
