import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';

const usage = { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 };
const frame = (delta, finish = null) => ({ choices: [{ index: 0, delta, finish_reason: finish }], usage: null });
const stream = (chunks) => chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';

// Wire shape follows OpenCode v2.1.3's own CLI acp/subprocess.ts model fixture.
export function textStream(text) {
  return stream([frame({ role: 'assistant' }), frame({ content: text }), frame({}, 'stop'), { choices: [], usage }]);
}

export function toolStream(name, input, id = 'call_crosschat_fixture') {
  return stream([
    frame({ role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: '' } }] }),
    frame({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(input) } }] }),
    frame({}, 'tool_calls'), { choices: [], usage },
  ]);
}

/** Only the model is scripted. OpenCode's session service and shell tools remain real. */
export async function createMockModel(respond) {
  const requests = [];
  const errors = [];
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        response.writeHead(404); response.end('Unexpected model endpoint'); return;
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) { response.writeHead(413); response.end(); return; }
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { response.writeHead(400); response.end('Invalid JSON'); return; }
      requests.push(body);
      const result = await respond(body, requests.length - 1);
      if (!response.destroyed) { response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); response.end(result); }
    })().catch((error) => {
      errors.push(error instanceof Error ? error.message : String(error));
      if (!response.destroyed) { response.writeHead(500); response.end('Fixture response failed'); }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Model fixture did not bind TCP');
  return {
    url: `http://127.0.0.1:${address.port}/v1`, requests, errors,
    async waitForRequests(count, timeout = 10000) {
      const deadline = Date.now() + timeout;
      while (requests.length < count && Date.now() < deadline) await delay(20);
      if (requests.length < count) throw new Error(`Expected ${count} model requests, observed ${requests.length}`);
    },
    async close() {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      await closed;
    },
  };
}
