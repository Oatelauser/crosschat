import { request } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createDshMockModel } from './helpers/dsh-mock-model.mjs';

const models: Array<{ close(): Promise<void> }> = [];
afterEach(async () => { await Promise.all(models.splice(0).map((model) => model.close())); });

const body = { model: 'deepseek-flash', stream: true, messages: [{ role: 'user', content: [{ type: 'text', text: 'unique-request-123' }] }] };
const headers = { 'content-type': 'application/json', 'x-api-key': 'mock-key' };
function events(text: string): Array<Record<string, unknown>> {
  return text.trim().split('\n\n').map((block) => {
    const lines = block.split('\n');
    const payload = JSON.parse(lines.find((line) => line.startsWith('data: '))!.slice(6));
    expect(lines[0]).toBe(`event: ${payload.type}`);
    return payload;
  });
}

describe('DSH local Messages model', () => {
  it('runs real HTTP text streaming and rejects unauthenticated or invalid traffic before consuming the script', async () => {
    const model = await createDshMockModel((value: unknown) => ({ text: JSON.stringify(value).includes('unique-request-123') ? 'ACK-current-123' : 'unexpected' }));
    models.push(model);
    expect(new URL(model.url).hostname).toBe('127.0.0.1');
    const unauthorized = await fetch(`${model.url}/messages`, { method: 'POST', headers: { ...headers, 'x-api-key': 'wrong' }, body: JSON.stringify(body) });
    expect(unauthorized.status).toBe(401);
    const malformed = await fetch(`${model.url}/messages`, { method: 'POST', headers, body: '{' });
    expect(malformed.status).toBe(400);
    const wrongRoute = await fetch(`${model.url}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) });
    expect(wrongRoute.status).toBe(404);
    const response = await fetch(`${model.url}/messages`, { method: 'POST', headers, body: JSON.stringify(body) });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const stream = events(await response.text());
    expect(stream.map((entry) => entry.type)).toEqual(['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
    expect(stream[2]).toMatchObject({ delta: { type: 'text_delta', text: 'ACK-current-123' } });
    expect(stream[4]).toMatchObject({ delta: { stop_reason: 'end_turn' } });
    expect(model.requests).toEqual([body]);
    expect(model.errors).toEqual([]);
  });

  it('streams a Messages tool_use with JSON argument deltas and a tool_use stop reason', async () => {
    const input = { description: 'Read native identity', command: 'Write-Output $env:DSH_SESSION_ID' };
    const model = await createDshMockModel(() => ({ tool: { name: 'pwsh', input, id: 'native-identity-123' } }));
    models.push(model);
    const response = await fetch(`${model.url}/messages`, { method: 'POST', headers, body: JSON.stringify(body) });
    const raw = await response.text();
    const stream = events(raw);
    expect(stream[1]).toMatchObject({ content_block: { type: 'tool_use', name: 'pwsh', id: 'native-identity-123', input: {} } });
    const deltas = stream.filter((entry) => entry.type === 'content_block_delta').map((entry) => entry.delta);
    expect(deltas).toEqual([{ type: 'input_json_delta', partial_json: JSON.stringify(input) }]);
    expect(stream.at(-2)).toMatchObject({ delta: { stop_reason: 'tool_use' } });
    expect(raw).not.toContain('[DONE]');
    expect(raw).not.toContain('tool_calls');
  });

  it('tears down a pending script and its open connection without waiting for a provider reply', async () => {
    let signal: AbortSignal | undefined;
    let entered!: () => void;
    const ready = new Promise<void>((done) => { entered = done; });
    const model = await createDshMockModel((_value: unknown, context: { signal: AbortSignal }) => {
      signal = context.signal; entered();
      return new Promise(() => {});
    });
    models.push(model);
    const response = fetch(`${model.url}/messages`, { method: 'POST', headers, body: JSON.stringify(body) }).then(() => 'resolved', () => 'closed');
    await ready;
    await model.close();
    expect(signal?.aborted).toBe(true);
    expect(await response).toBe('closed');
    await model.close();
  }, 3000);

  it('bounds request bytes and does not feed an oversized body to the model script', async () => {
    const model = await createDshMockModel(() => ({ text: 'must-not-run' }), { maxRequestBytes: 256 });
    models.push(model);
    const status = await new Promise<number>((done, reject) => {
      const outgoing = request(`${model.url}/messages`, { method: 'POST', headers }, (incoming: IncomingMessage) => {
        incoming.resume(); incoming.once('end', () => done(incoming.statusCode ?? 0));
      });
      outgoing.once('error', reject);
      outgoing.end(JSON.stringify({ ...body, padding: 'x'.repeat(1000) }));
    });
    expect(status).toBe(413);
    expect(model.requests).toEqual([]);
  });

  it('reports script failures without returning their secret text and remains usable', async () => {
    const model = await createDshMockModel((_value: unknown, context: { index: number }) => {
      if (context.index === 0) throw new Error('private-script-value');
      return { text: 'second-request-ACK' };
    });
    models.push(model);
    const first = await fetch(`${model.url}/messages`, { method: 'POST', headers, body: JSON.stringify(body) });
    expect(first.status).toBe(500);
    expect(await first.text()).not.toContain('private-script-value');
    const second = await fetch(`${model.url}/messages`, { method: 'POST', headers, body: JSON.stringify(body) });
    expect(second.status).toBe(200);
    expect(await second.text()).toContain('second-request-ACK');
    expect(model.errors).toHaveLength(1);
  });
});
