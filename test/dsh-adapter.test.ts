import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getDshThread, listDshThreadPage, listDshThreads } from '../src/dsh/client.js';
import { deliverToDshSession } from '../src/dsh/deliver.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

function reply(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'crosschat-dsh-adapter-'));
  cleanup.push(() => rm(path, { recursive: true, force: true }));
  return path;
}

function nativeThread(id: string, status: 'idle' | 'running' = 'idle') {
  return { id, name: null, cwd: '/current/work', originalCwd: '/original/work', status, createdAt: 123 };
}

async function fixture(options: { home?: string; handler?: (request: IncomingMessage, response: ServerResponse) => void; info?: Record<string, unknown>; infoStatus?: number; runtimeVersion?: string; profile?: string; endpointType?: string } = {}) {
  const home = options.home ?? await directory();
  const instancesDir = join(home, '.crosschat', 'dsh', 'instances');
  await mkdir(instancesDir, { recursive: true, mode: 0o700 });
  const instanceId = randomUUID();
  const token = 'c'.repeat(64);
  const runtimeVersion = options.runtimeVersion ?? '0.2.1-rc.2';
  const endpoint = { ...(options.profile === undefined ? {} : { profile: options.profile }), ...(options.endpointType === undefined ? {} : { endpointType: options.endpointType }) };
  const info = { schema: 1, protocol: 1, provider: 'dsh', instanceId, pid: process.pid, runtimeVersion, ...endpoint, ...options.info };
  const calls: string[] = [];
  const server = createServer((request, response) => {
    calls.push(`${request.method} ${request.url}`);
    if (request.headers.authorization !== `Bearer ${token}`) return reply(response, { error: { code: 'DSH_AUTH_REQUIRED' } }, 401);
    if (request.url === '/v1/info') return reply(response, info, options.infoStatus ?? 200);
    if (options.handler) return options.handler(request, response);
    reply(response, { items: [nativeThread('native/+?雪'), nativeThread('busy', 'running')] });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing isolated service address');
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const url = `http://127.0.0.1:${address.port}`;
  const file = join(instancesDir, `${instanceId}.json`);
  const registration = { schema: 1, protocol: 1, provider: 'dsh', instanceId, pid: process.pid, url, token, runtimeVersion, createdAt: 123, ...endpoint };
  await writeFile(file, JSON.stringify(registration), { mode: 0o600 });
  return { home, instancesDir, instanceId, token, info, file, registration, calls, url };
}

describe('DSH native bridge adapter', () => {
  it('keeps same-ID Host and Desktop sessions separate and selects type before owner ambiguity', async () => {
    const handler = (request: IncomingMessage, response: ServerResponse) => request.method === 'POST'
      ? reply(response, { accepted: true, sessionId: 'same', mode: 'queue', messageId: randomUUID() })
      : reply(response, { items: [nativeThread('same')], item: nativeThread('same') });
    const host = await fixture({ profile: 'custom', endpointType: 'host', handler });
    const desktop = await fixture({ home: host.home, profile: 'desktop', endpointType: 'desktop', handler });
    const options = { home: host.home, endpointType: 'desktop' };
    expect(await listDshThreads({ home: host.home })).toMatchObject([
      expect.objectContaining({ id: 'same', endpointType: expect.stringMatching(/^(host|desktop)$/) }),
      expect.objectContaining({ id: 'same', endpointType: expect.stringMatching(/^(host|desktop)$/) }),
    ]);
    expect(await getDshThread('same', options)).toMatchObject({ id: 'same', endpointType: 'desktop' });
    expect(await deliverToDshSession('same', 'payload', options)).toMatchObject({ status: 'accepted' });
    expect(host.calls.some((call) => call.startsWith('POST '))).toBe(false);
    expect(desktop.calls.filter((call) => call.startsWith('POST '))).toHaveLength(1);
  });

  it('does not reinterpret an unclassified owner as Host or fall back from an absent requested type', async () => {
    const service = await fixture({ handler: (_request, response) => reply(response, { item: nativeThread('same'), items: [nativeThread('same')] }) });
    const options = { home: service.home, endpointType: 'host' };
    expect(await listDshThreads(options)).toEqual([]);
    expect(await getDshThread('same', options)).toBeNull();
    await expect(deliverToDshSession('same', 'payload', options)).rejects.toMatchObject({ code: 'DSH_SESSION_NOT_FOUND' });
    expect(service.calls.some((call) => call.startsWith('POST '))).toBe(false);
  });

  it('rejects a changed native profile or endpoint type during the authenticated owner handshake', async () => {
    const service = await fixture({ profile: 'desktop', endpointType: 'desktop', info: { profile: 'web', endpointType: 'host' } });
    await expect(listDshThreads({ home: service.home })).rejects.toMatchObject({ code: 'DSH_OWNER_MISMATCH' });
    expect(service.calls).toEqual(['GET /v1/info']);
  });

  it('rejects caller-association metadata changed by the responding owner', async () => {
    const service = await fixture({ profile: 'web', endpointType: 'host', info: { callerIdentity: { schema: 1, profileDir: '/different-native-profile' } } });
    await expect(listDshThreads({ home: service.home })).rejects.toMatchObject({ code: 'DSH_OWNER_MISMATCH' });
    expect(service.calls).toEqual(['GET /v1/info']);
  });

  it('does not probe an unrelated type and still rejects duplicate owners within the selected type', async () => {
    const handler = (_request: IncomingMessage, response: ServerResponse) => reply(response, { item: nativeThread('same'), items: [nativeThread('same')] });
    const host = await fixture({ profile: 'web', endpointType: 'host', handler });
    const unrelated = await fixture({ home: host.home, profile: 'desktop', endpointType: 'desktop', infoStatus: 503 });
    const options = { home: host.home, endpointType: 'host' };
    expect(await getDshThread('same', options)).toMatchObject({ endpointType: 'host' });
    expect(unrelated.calls).toEqual([]);
    const second = await fixture({ home: host.home, profile: 'custom', endpointType: 'host', handler });
    await expect(listDshThreads(options)).rejects.toMatchObject({ code: 'DSH_AMBIGUOUS_SESSION' });
    await expect(getDshThread('same', options)).rejects.toMatchObject({ code: 'DSH_AMBIGUOUS_SESSION' });
    await expect(deliverToDshSession('same', 'payload', options)).rejects.toMatchObject({ code: 'DSH_AMBIGUOUS_SESSION' });
    expect([...host.calls, ...second.calls].some((call) => call.startsWith('POST '))).toBe(false);
  });

  it('discovers authenticated live sessions under the isolated common state root without writes', async () => {
    const service = await fixture();
    const before = await readFile(service.file, 'utf8');
    const threads = await listDshThreads({ home: service.home });
    expect(threads).toMatchObject([
      { id: 'native/+?雪', name: null, cwd: '/current/work', rawStatus: { type: 'idle' }, attributes: { instanceId: service.instanceId, originalCwd: '/original/work', currentCwd: '/current/work' } },
      { id: 'busy', rawStatus: { type: 'running' } },
    ]);
    expect(service.calls).toEqual(['GET /v1/info', 'GET /v1/sessions']);
    expect(await readFile(service.file, 'utf8')).toBe(before);
    expect(await readdir(service.instancesDir)).toEqual([`${service.instanceId}.json`]);
  });

  it('gets the exact opaque native identity and returns null only for an authoritative absent item', async () => {
    const service = await fixture({ handler: (request, response) => reply(response, { item: request.url?.endsWith('missing') ? null : nativeThread('native/+?雪') }) });
    await expect(getDshThread('native/+?雪', { home: service.home })).resolves.toMatchObject({ id: 'native/+?雪' });
    await expect(getDshThread('missing', { home: service.home })).resolves.toBeNull();
    expect(service.calls).toContain('GET /v1/sessions/native%2F%2B%3F%E9%9B%AA');
    expect(service.calls.every((call) => call.startsWith('GET '))).toBe(true);
  });

  it('preserves unknown names and cwd without inventing a current directory', async () => {
    const service = await fixture({ handler: (_request, response) => reply(response, { items: [{ ...nativeThread('anonymous'), cwd: null, originalCwd: null }] }) });
    await expect(listDshThreads({ home: service.home })).resolves.toMatchObject([{ id: 'anonymous', name: null, cwd: '', attributes: { originalCwd: null, currentCwd: null } }]);
  });

  it('pages deterministically and rejects a cursor after the source membership changes', async () => {
    let items = [nativeThread('one'), nativeThread('two'), nativeThread('three')];
    const service = await fixture({ handler: (_request, response) => reply(response, { items }) });
    const options = { home: service.home, limit: 2 };
    const first = await listDshThreadPage(options);
    expect(first.data.map((item) => item.id)).toEqual(['one', 'two']);
    expect(first.completeness).toBe('partial');
    expect(first.nextCursor).toEqual(expect.any(String));
    await expect(listDshThreadPage({ ...options, cursor: first.nextCursor! })).resolves.toMatchObject({ data: [{ id: 'three' }], nextCursor: null, completeness: 'complete' });
    items = [nativeThread('replacement')];
    await expect(listDshThreadPage({ ...options, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'DSH_INVALID_CURSOR' });
  });

  it('refuses duplicate native identities across live instances for list, get and send', async () => {
    const first = await fixture({ handler: (_request, response) => reply(response, { items: [nativeThread('same')], item: nativeThread('same') }) });
    const second = await fixture({ home: first.home, handler: (_request, response) => reply(response, { items: [nativeThread('same')], item: nativeThread('same') }) });
    const options = { home: first.home };
    await expect(listDshThreads(options)).rejects.toMatchObject({ code: 'DSH_AMBIGUOUS_SESSION' });
    await expect(getDshThread('same', options)).rejects.toMatchObject({ code: 'DSH_AMBIGUOUS_SESSION' });
    await expect(deliverToDshSession('same', 'payload', options)).rejects.toMatchObject({ code: 'DSH_AMBIGUOUS_SESSION' });
    expect([...first.calls, ...second.calls].every((call) => call.startsWith('GET '))).toBe(true);
  });

  it('distinguishes missing registration from malformed records without leaking content', async () => {
    const home = await directory();
    await expect(listDshThreads({ home })).rejects.toMatchObject({ code: 'DSH_NOT_CONFIGURED' });
    const service = await fixture({ home });
    await writeFile(service.file, '{test-private-token');
    const error = await listDshThreads({ home }).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: 'DSH_REGISTRATION_MALFORMED' });
    expect(String(error)).not.toContain('test-private-token');
    expect(service.calls).toEqual([]);
  });

  it('ignores a confirmed dead owner record without removing it', async () => {
    const service = await fixture();
    const deadId = randomUUID();
    const deadFile = join(service.instancesDir, `${deadId}.json`);
    await writeFile(deadFile, JSON.stringify({ ...service.registration, instanceId: deadId, pid: 2147483647 }), { mode: 0o600 });
    await expect(listDshThreads({ home: service.home })).resolves.toHaveLength(2);
    expect(await readFile(deadFile, 'utf8')).toContain('2147483647');
  });

  it.each([
    ['url', 'http://example.com', 'DSH_INVALID_ENDPOINT'],
    ['url', 'http://localhost:3000', 'DSH_INVALID_ENDPOINT'],
    ['url', 'http://127.0.0.1:3000/path', 'DSH_INVALID_ENDPOINT'],
    ['protocol', 2, 'DSH_UNSUPPORTED_PROTOCOL'],
    ['instanceId', randomUUID(), 'DSH_REGISTRATION_MALFORMED'],
    ['token', '', 'DSH_REGISTRATION_MALFORMED'],
  ])('rejects unsafe registration %s before network access (%#)', async (field, value, code) => {
    const service = await fixture();
    await writeFile(service.file, JSON.stringify({ ...service.registration, [field]: value }));
    await expect(listDshThreads({ home: service.home })).rejects.toMatchObject({ code });
    expect(service.calls).toEqual([]);
  });

  it.each([
    [{ pid: process.pid + 1 }, 'DSH_OWNER_MISMATCH'],
    [{ instanceId: randomUUID() }, 'DSH_OWNER_MISMATCH'],
    [{ runtimeVersion: '0.2.2' }, 'DSH_OWNER_MISMATCH'],
    [{ provider: 'foreign' }, 'DSH_PROTOCOL_ERROR'],
    [{ protocol: 2 }, 'DSH_UNSUPPORTED_PROTOCOL'],
  ])('never writes after a failed live service identity handshake (%#)', async (info, code) => {
    const service = await fixture({ info });
    await expect(deliverToDshSession('target', 'payload', { home: service.home })).rejects.toMatchObject({ code });
    expect(service.calls).toEqual(['GET /v1/info']);
  });

  it('treats an unavailable live owner and malformed session response as errors, not empty discovery', async () => {
    const unavailable = await fixture({ infoStatus: 503 });
    await expect(listDshThreads({ home: unavailable.home })).rejects.toMatchObject({ code: 'DSH_UNAVAILABLE' });
    const malformed = await fixture({ handler: (_request, response) => reply(response, { items: [{ id: 'bad' }] }) });
    await expect(listDshThreads({ home: malformed.home })).rejects.toMatchObject({ code: 'DSH_PROTOCOL_ERROR' });
    const wrong = await fixture({ handler: (_request, response) => reply(response, { item: nativeThread('other') }) });
    await expect(getDshThread('target', { home: wrong.home })).rejects.toMatchObject({ code: 'DSH_PROTOCOL_ERROR' });
  });

  it('does not coerce a structured status value into the native idle/running contract', async () => {
    const service = await fixture({ handler: (_request, response) => reply(response, { items: [{ ...nativeThread('bad-status'), status: ['idle'] }] }) });
    await expect(listDshThreads({ home: service.home })).rejects.toMatchObject({ code: 'DSH_PROTOCOL_ERROR' });
  });

  it.each(['0.2.1-rc.2', '0.2.1-rc.10', '0.2.1', '0.2.2-alpha.1', '0.2.99+build.1'])('admits the experimental runtime window after exact owner confirmation (%s)', async (runtimeVersion) => {
    const service = await fixture({ runtimeVersion });
    await expect(listDshThreads({ home: service.home })).resolves.toHaveLength(2);
  });

  it.each(['0.2.0', '0.2.1-beta.1', '0.2.1-rc.1', '0.3.0-alpha.1', '0.3.0', '0.1.99', '0.2.01', '0.2.1-rc.02'])('refuses an unsupported or malformed runtime before reads (%s)', async (runtimeVersion) => {
    const service = await fixture({ runtimeVersion });
    await expect(listDshThreads({ home: service.home })).rejects.toMatchObject({ code: 'DSH_UNSUPPORTED_VERSION' });
    expect(service.calls).toEqual(['GET /v1/info']);
  });

  it.each(['queue', 'steer'] as const)('sends %s exactly once and checks the admission receipt', async (mode) => {
    const received: unknown[] = [];
    const service = await fixture({ handler: (request, response) => {
      if (request.method === 'GET') return reply(response, { item: nativeThread('target') });
      let body = '';
      request.setEncoding('utf8'); request.on('data', (part: string) => { body += part; });
      request.on('end', () => { received.push(JSON.parse(body)); reply(response, { accepted: true, sessionId: 'target', messageId: 'native-message-id', mode }); });
    } });
    await expect(deliverToDshSession('target', 'escaped "雪"\ntext', { home: service.home, mode })).resolves.toEqual({ status: 'accepted', messageId: 'native-message-id', queued: mode === 'queue' });
    expect(received).toEqual([{ text: 'escaped "雪"\ntext', mode }]);
    expect(service.calls.filter((call) => call.startsWith('POST '))).toEqual(['POST /v1/sessions/target/messages']);
  });

  it('rejects empty identities, empty messages, invalid mode and invalid paging before writes', async () => {
    const service = await fixture();
    const options = { home: service.home };
    await expect(deliverToDshSession('', 'payload', options)).rejects.toMatchObject({ code: 'DSH_INPUT_REJECTED' });
    await expect(deliverToDshSession('target', ' ', options)).rejects.toMatchObject({ code: 'DSH_INPUT_REJECTED' });
    await expect(deliverToDshSession('target', 'x'.repeat(1024 * 1024 + 1), options)).rejects.toMatchObject({ code: 'DSH_INPUT_REJECTED' });
    await expect(deliverToDshSession('target', 'payload', { ...options, mode: 'invalid' as 'queue' })).rejects.toMatchObject({ code: 'USAGE' });
    await expect(listDshThreadPage({ ...options, limit: 0 })).rejects.toMatchObject({ code: 'DSH_INVALID_CURSOR' });
    expect(service.calls).toEqual([]);
  });

  it('cancels before I/O and bounds a stalled read', async () => {
    const service = await fixture({ handler: () => undefined });
    const signal = AbortSignal.abort();
    await expect(listDshThreads({ home: service.home, signal })).rejects.toMatchObject({ code: 'DSH_CANCELLED' });
    expect(service.calls).toEqual([]);
    await expect(listDshThreads({ home: service.home, timeoutMs: 50 })).rejects.toMatchObject({ code: 'DSH_TIMEOUT' });
  });

  it('does not retry a write with a lost or wrong-session receipt, or leak server text', async () => {
    let writes = 0;
    const service = await fixture({ handler: (request, response) => {
      if (request.method === 'GET') return reply(response, { item: nativeThread('target') });
      writes += 1;
      reply(response, { accepted: true, sessionId: 'other', messageId: 'test-upstream-secret', mode: 'queue' });
    } });
    const result = await deliverToDshSession('target', 'payload', { home: service.home }).catch((error: unknown) => error);
    expect(result).toMatchObject({ code: 'DSH_WRITE_UNCERTAIN' });
    expect(String(result)).not.toMatch(/test-upstream-secret|cccccccc/);
    expect(writes).toBe(1);
  });

  it('reports timed-out writes as uncertain and leaves them unretied', async () => {
    let writes = 0;
    const service = await fixture({ handler: (request, response) => {
      if (request.method === 'GET') return reply(response, { item: nativeThread('target') });
      writes += 1;
    } });
    await expect(deliverToDshSession('target', 'payload', { home: service.home, timeoutMs: 100 })).rejects.toMatchObject({ code: 'DSH_WRITE_UNCERTAIN' });
    expect(writes).toBe(1);
  });
});
