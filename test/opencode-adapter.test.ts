import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { getOpenCodeThread, listOpenCodeThreadPage, listOpenCodeThreads } from '../src/opencode/client.js';
import { deliverToOpenCodeSession } from '../src/opencode/deliver.js';
import { createOpenCodeSessionReader } from '../src/application/sessions/opencode-reader.js';
import { createNativeOperationProviders } from '../src/application/native-operation-providers.js';
import { createNativeSessionOperations } from '../src/application/session-operations.js';
import type { DiscoveryResponse, DiscoverySession } from '../src/application/discovery/model.js';
import { connectOpenCode } from '../src/opencode/service.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).reverse().map((dispose) => dispose())); });

function reply(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

async function fixture(handler?: (request: IncomingMessage, response: ServerResponse) => void, serverInfo: unknown = { version: '2.1.3', pid: 765 }, infoStatus = 200) {
  const calls: string[] = [];
  const server = createServer((request, response) => {
    calls.push(`${request.method} ${request.url}`);
    if (request.url === '/api/info') return reply(response, serverInfo, infoStatus);
    if (request.url === '/api/session/active') return reply(response, { data: { ses_busy: { type: 'running' } } });
    if (handler) return handler(request, response);
    return reply(response, { data: [] , cursor: { next: null } });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing fixture address.');
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });
  return { url: `http://127.0.0.1:${address.port}`, calls };
}

function info(id: string, title?: string) {
  return { id, title, projectID: 'project', location: { directory: '/isolated/work' }, time: { created: 1, updated: 2 } };
}

async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'crosschat-opencode-'));
  cleanup.push(() => rm(path, { recursive: true, force: true }));
  return path;
}

describe('OpenCode V2 native read contract', () => {
  it('retains the native registration instance id without treating it as shell provenance', async () => {
    const path = await directory();
    const service = await fixture();
    const file = join(path, 'service.json');
    await writeFile(file, JSON.stringify({ id: 'native-service-instance', version: '2.1.3', url: service.url, pid: 765 }));
    const connection = await connectOpenCode({ registrationFile: file, env: {} });
    expect(connection.serviceIdentity).toEqual({ registrationId: 'native-service-instance', pid: 765, version: '2.1.3', url: service.url });
  });

  it('rejects an unsupported frontend type before connecting to the shared service', async () => {
    const service = await fixture((_request, response) => reply(response, { data: { id: 'receipt', sessionID: 'same', type: 'user', delivery: 'queue' } }));
    const options = { endpoint: { url: service.url }, env: {}, endpointType: 'desktop' };
    await expect(deliverToOpenCodeSession('same', 'payload', options)).rejects.toMatchObject({ code: 'OPENCODE_INPUT_REJECTED' });
    expect(service.calls).toEqual([]);
  });

  it('reads all opaque pages, preserves anonymous sessions and native running state', async () => {
    const service = await fixture((request, response) => {
      const url = new URL(request.url ?? '', 'http://fixture');
      if (url.searchParams.get('cursor') === 'next/+?=') return reply(response, { data: [info('ses_busy', 'Working')], cursor: {} });
      expect(url.searchParams.get('limit')).toBe('50');
      reply(response, { data: [info('ses_one')], cursor: { next: 'next/+?=' } });
    });
    const options = { endpoint: { url: service.url }, env: {} };
    const threads = await listOpenCodeThreads(options);
    expect(threads).toHaveLength(2);
    expect(threads[0]).toMatchObject({ id: 'ses_one', endpointType: 'shared', name: null, cwd: '/isolated/work' });
    expect(threads[1]).toMatchObject({ id: 'ses_busy', name: 'Working', rawStatus: { type: 'running' } });
    expect(service.calls.every((call) => call.startsWith('GET '))).toBe(true);
  });

  it('uses the official XDG registration and Basic auth without modifying files', async () => {
    const path = await directory();
    const service = await fixture((request, response) => {
      expect(request.headers.authorization).toBe(`Basic ${Buffer.from('opencode:test-password').toString('base64')}`);
      reply(response, { data: [], cursor: {} });
    });
    const file = join(path, 'service.json');
    const registration = JSON.stringify({ id: 'owner', version: '2.1.3', url: service.url, pid: 765, password: 'test-password' });
    await writeFile(file, registration);
    await expect(listOpenCodeThreads({ registrationFile: file, env: {} })).resolves.toEqual([]);
    expect(await readFile(file, 'utf8')).toBe(registration);
    expect(await readdir(path)).toEqual(['service.json']);
  });

  it('resolves the standard path under an isolated XDG state directory', async () => {
    const path = await directory();
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(path, 'opencode'));
    const service = await fixture();
    await writeFile(join(path, 'opencode', 'service.json'), JSON.stringify({ version: '2.1.3', url: service.url, pid: 765 }));
    await expect(listOpenCodeThreads({ env: { XDG_STATE_HOME: path } })).resolves.toEqual([]);
  });

  it('honors explicit URL and token without consulting the missing registration', async () => {
    const service = await fixture((request, response) => {
      expect(request.headers.authorization).toBe(`Basic ${Buffer.from('opencode:test-token').toString('base64')}`);
      reply(response, { data: [], cursor: {} });
    });
    await expect(listOpenCodeThreads({ registrationFile: 'never-read-this', env: { CROSSCHAT_OPENCODE_URL: service.url, CROSSCHAT_OPENCODE_TOKEN: 'test-token' } })).resolves.toEqual([]);
  });

  it('gets the exact native session and distinguishes authoritative absence', async () => {
    const service = await fixture((request, response) => request.url === '/api/session/ses_one'
      ? reply(response, { data: info('ses_one') }) : reply(response, { _tag: 'SessionNotFoundError', sessionID: 'ses_missing' }, 404));
    const options = { endpoint: { url: service.url }, env: {} };
    await expect(getOpenCodeThread('ses_one', options)).resolves.toMatchObject({ id: 'ses_one' });
    await expect(getOpenCodeThread('ses_missing', options)).resolves.toBeNull();
    expect(service.calls).not.toContain('POST /api/session');
  });

  it('does not turn a missing API route or wrong-session 404 into authoritative absence', async () => {
    const missingRoute = await fixture((_request, response) => reply(response, { message: 'No route' }, 404));
    await expect(getOpenCodeThread('ses_one', { endpoint: { url: missingRoute.url }, env: {} })).rejects.toMatchObject({ code: 'OPENCODE_PROTOCOL_ERROR' });
    const wrongSession = await fixture((_request, response) => reply(response, { _tag: 'SessionNotFoundError', sessionID: 'ses_other' }, 404));
    await expect(getOpenCodeThread('ses_one', { endpoint: { url: wrongSession.url }, env: {} })).rejects.toMatchObject({ code: 'OPENCODE_PROTOCOL_ERROR' });
  });

  it('rejects malformed session bodies, malformed cursors and repeated pages', async () => {
    let payload: unknown = { data: [null], cursor: {} };
    const service = await fixture((_request, response) => reply(response, payload));
    const options = { endpoint: { url: service.url }, env: {} };
    await expect(listOpenCodeThreadPage(options)).rejects.toMatchObject({ code: 'OPENCODE_PROTOCOL_ERROR' });
    payload = { data: [], cursor: { next: 3 } };
    await expect(listOpenCodeThreadPage(options)).rejects.toMatchObject({ code: 'OPENCODE_PROTOCOL_ERROR' });
    payload = { data: [info('ses_one')], cursor: { next: 'same' } };
    await expect(listOpenCodeThreads(options)).rejects.toMatchObject({ code: 'OPENCODE_PROTOCOL_ERROR' });
  });

  it('does not mistake prototype names for native running sessions', async () => {
    const service = await fixture((_request, response) => reply(response, { data: [info('constructor')], cursor: {} }));
    const page = await listOpenCodeThreadPage({ endpoint: { url: service.url }, env: {} });
    expect(page.data[0].rawStatus).toEqual({ type: 'inactive' });
  });

  it('distinguishes missing, malformed and unreadable registrations without exposing file content', async () => {
    const path = await directory();
    const file = join(path, 'service.json');
    await expect(listOpenCodeThreads({ registrationFile: join(path, 'missing'), env: {} })).rejects.toMatchObject({ code: 'OPENCODE_NOT_CONFIGURED' });
    await writeFile(file, '{secret-test-unparseable');
    const malformed = await listOpenCodeThreads({ registrationFile: file, env: {} }).catch((error: unknown) => error);
    expect(malformed).toMatchObject({ code: 'OPENCODE_REGISTRATION_MALFORMED' });
    expect(String(malformed)).not.toContain('secret-test-unparseable');
    await writeFile(file, JSON.stringify({ url: 'http://localhost', pid: '765', password: 'private-password' }));
    await expect(listOpenCodeThreads({ registrationFile: file, env: {} })).rejects.toMatchObject({ code: 'OPENCODE_REGISTRATION_MALFORMED' });
    await expect(listOpenCodeThreads({ registrationFile: path, env: {} })).rejects.toMatchObject({ code: 'OPENCODE_REGISTRATION_MALFORMED' });
  });

  it('rejects owner mismatches and unsupported major versions without changing service state', async () => {
    const path = await directory();
    const file = join(path, 'service.json');
    const service = await fixture();
    await writeFile(file, JSON.stringify({ version: '2.1.3', url: service.url, pid: 999 }));
    await expect(listOpenCodeThreads({ registrationFile: file, env: {} })).rejects.toMatchObject({ code: 'OPENCODE_OWNER_MISMATCH' });
    expect(service.calls).toEqual(['GET /api/info']);
    const unsupported = await fixture(undefined, { version: '1.19.3', pid: 765 });
    await expect(listOpenCodeThreads({ endpoint: { url: unsupported.url }, env: {} })).rejects.toMatchObject({ code: 'OPENCODE_UNSUPPORTED_VERSION' });
    // Even an explicit endpoint must prove its V2 identity, rather than accepting a V1 route.
    await expect(listOpenCodeThreads({ endpoint: { url: unsupported.url + '/not-a-service' }, env: {} })).rejects.toMatchObject({ code: 'OPENCODE_INVALID_ENDPOINT' });
  });

  it.each([
    [null, 200, 'OPENCODE_PROTOCOL_ERROR'],
    [{ version: '1.19.3', pid: 765 }, 200, 'OPENCODE_UNSUPPORTED_VERSION'],
    [{ version: '2.1.3', pid: '765' }, 200, 'OPENCODE_PROTOCOL_ERROR'],
    [{ secret: 'test-private-info' }, 401, 'OPENCODE_AUTH_REQUIRED'],
  ])('never writes when native service identity or authentication fails (%#)', async (serverInfo, status, code) => {
    const service = await fixture(undefined, serverInfo, status);
    await expect(deliverToOpenCodeSession('ses_one', 'message', { endpoint: { url: service.url, token: 'test-private-token' }, env: {} })).rejects.toMatchObject({ code });
    expect(service.calls).toEqual(['GET /api/info']);
  });

  it('redacts authentication, upstream response bodies and redirects from read errors', async () => {
    const service = await fixture((_request, response) => reply(response, { secret: 'test-private-upstream-response' }, 401));
    const options = { endpoint: { url: service.url, token: 'test-secret-token' }, env: {} };
    const result = await listOpenCodeThreads(options).catch((error: unknown) => error);
    expect(result).toMatchObject({ code: 'OPENCODE_AUTH_REQUIRED' });
    expect(JSON.stringify(result)).not.toMatch(/test-secret-token|test-private-upstream-response/);
    expect(String(result)).not.toMatch(/test-secret-token|test-private-upstream-response/);
    const redirected = await fixture((_request, response) => {
      response.writeHead(302, { location: `${service.url}/leak` }); response.end();
    });
    await expect(listOpenCodeThreads({ endpoint: { url: redirected.url, token: 'test-secret-token' }, env: {} })).rejects.toMatchObject({ code: 'OPENCODE_PROTOCOL_ERROR' });
    expect(service.calls).not.toContain('GET /leak');
  });

  it('cancels before any reads and bounds stalled HTTP reads', async () => {
    const service = await fixture();
    const controller = new AbortController(); controller.abort();
    await expect(listOpenCodeThreads({ endpoint: { url: service.url }, env: {}, signal: controller.signal })).rejects.toMatchObject({ code: 'OPENCODE_CANCELLED' });
    expect(service.calls).toEqual([]);
    await expect(deliverToOpenCodeSession('ses_one', 'message', { endpoint: { url: service.url }, env: {}, signal: controller.signal })).rejects.toMatchObject({ code: 'OPENCODE_CANCELLED' });
    expect(service.calls).toEqual([]);
    const stalled = await fixture(() => undefined);
    await expect(listOpenCodeThreads({ endpoint: { url: stalled.url }, env: {}, timeoutMs: 30 })).rejects.toMatchObject({ code: 'OPENCODE_TIMEOUT' });
  });
});

describe('OpenCode V2 durable inbox delivery', () => {
  it.each(['queue', 'steer'] as const)('uses native %s delivery with an exact receipt and no session creation', async (mode) => {
    const service = await fixture((request, response) => {
      expect(request.url).toBe('/api/session/ses_busy/prompt');
      expect(request.method).toBe('POST');
      let body = '';
      request.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      request.on('end', () => {
        expect(JSON.parse(body)).toEqual({ text: 'review this', delivery: mode, resume: true });
        reply(response, { data: { id: 'msg_receipt', sessionID: 'ses_busy', type: 'user', delivery: mode } });
      });
    });
    await expect(deliverToOpenCodeSession('ses_busy', 'review this', { endpoint: { url: service.url }, env: {}, mode })).resolves.toMatchObject({ status: 'accepted', messageId: 'msg_receipt', queued: mode === 'queue' });
    expect(service.calls.filter((call) => call.startsWith('POST'))).toEqual(['POST /api/session/ses_busy/prompt']);
  });

  it('does not replay a write after an unconfirmed receipt or disconnect', async () => {
    const service = await fixture((_request, response) => reply(response, { data: { id: 'msg_wrong', sessionID: 'ses_other', type: 'user', delivery: 'queue' } }));
    await expect(deliverToOpenCodeSession('ses_one', 'message', { endpoint: { url: service.url }, env: {} })).rejects.toMatchObject({ code: 'OPENCODE_WRITE_UNCERTAIN' });
    expect(service.calls.filter((call) => call.startsWith('POST'))).toHaveLength(1);
    const disconnected = await fixture((request) => request.socket.destroy());
    await expect(deliverToOpenCodeSession('ses_one', 'message', { endpoint: { url: disconnected.url }, env: {} })).rejects.toMatchObject({ code: 'OPENCODE_WRITE_UNCERTAIN' });
    expect(disconnected.calls.filter((call) => call.startsWith('POST'))).toHaveLength(1);
  });

  it('does not follow write redirects, and treats server failures as uncertain writes', async () => {
    const redirected = await fixture((_request, response) => {
      response.writeHead(307, { location: 'http://127.0.0.1:1/forbidden' }); response.end();
    });
    await expect(deliverToOpenCodeSession('ses_one', 'message', { endpoint: { url: redirected.url, token: 'test-private-token' }, env: {} })).rejects.toMatchObject({ code: 'OPENCODE_WRITE_UNCERTAIN' });
    expect(redirected.calls.filter((call) => call.startsWith('POST'))).toHaveLength(1);
    const failed = await fixture((_request, response) => reply(response, { secret: 'test-private-failure' }, 500));
    await expect(deliverToOpenCodeSession('ses_one', 'message', { endpoint: { url: failed.url }, env: {} })).rejects.toMatchObject({ code: 'OPENCODE_WRITE_UNCERTAIN' });
    expect(failed.calls.filter((call) => call.startsWith('POST'))).toHaveLength(1);
  });

  it('distinguishes rejected input, missing targets, and uncertainty after a write timeout', async () => {
    const missing = await fixture((_request, response) => reply(response, { _tag: 'SessionNotFoundError', sessionID: 'ses_missing', secret: 'private' }, 404));
    await expect(deliverToOpenCodeSession('ses_missing', 'message', { endpoint: { url: missing.url }, env: {} })).rejects.toMatchObject({ code: 'OPENCODE_SESSION_NOT_FOUND' });
    const conflict = await fixture((_request, response) => reply(response, {}, 409));
    await expect(deliverToOpenCodeSession('ses_one', 'message', { endpoint: { url: conflict.url }, env: {} })).rejects.toMatchObject({ code: 'OPENCODE_INPUT_REJECTED' });
    const stalled = await fixture(() => undefined);
    await expect(deliverToOpenCodeSession('ses_one', 'message', { endpoint: { url: stalled.url }, env: {}, timeoutMs: 30 })).rejects.toMatchObject({ code: 'OPENCODE_WRITE_UNCERTAIN' });
    expect(stalled.calls.filter((call) => call.startsWith('POST'))).toHaveLength(1);
  });

  it('cancellation after dispatch stops waiting and reports uncertainty without replaying', async () => {
    const controller = new AbortController();
    const service = await fixture(() => controller.abort());
    await expect(deliverToOpenCodeSession('ses_one', 'message', { endpoint: { url: service.url }, env: {}, signal: controller.signal })).rejects.toMatchObject({ code: 'OPENCODE_WRITE_UNCERTAIN' });
    expect(service.calls.filter((call) => call.startsWith('POST'))).toHaveLength(1);
  });
});

describe('OpenCode V2 native rename', () => {
  function renameFixture(options: { updateTitle?: boolean; disconnect?: boolean; missingOnPatch?: boolean; afterPatchCommit?: () => void } = {}) {
    let title = 'before';
    let serverVersion = '2.1.3';
    let cleanupRegistered = false;
    const calls: string[] = [];
    const server = createServer((request, response) => {
      calls.push(`${request.method} ${request.url}`);
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.url === '/api/info') return reply(response, { version: serverVersion, pid: 765 });
      if (request.url === '/api/session/active') return reply(response, { data: {} });
      if (requestUrl.pathname === '/api/session/ses_one') {
        if (request.method === 'GET') return reply(response, { data: info('ses_one', title) });
        if (request.method === 'PATCH') {
          if (options.missingOnPatch) return reply(response, { _tag: 'SessionNotFoundError', sessionID: 'ses_one' }, 404);
          let body = '';
          request.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          request.on('end', () => {
            expect(JSON.parse(body)).toEqual({ title: 'after' });
            if (options.updateTitle !== false) title = 'after';
            options.afterPatchCommit?.();
            if (options.disconnect) return request.socket.destroy();
            response.writeHead(204);
            response.end();
          });
          return;
        }
      }
      return reply(response, { data: [info('ses_one', title)], cursor: { next: null } });
    });
    return { server, calls, get title() { return title; }, set serverVersion(value: string) { serverVersion = value; },
      get cleanupRegistered() { return cleanupRegistered; }, markCleanupRegistered() { cleanupRegistered = true; } };
  }

  async function operationsFor(fixture: ReturnType<typeof renameFixture>, registrationFile?: string) {
    if (!fixture.server.listening) await new Promise<void>((resolve) => fixture.server.listen(0, '127.0.0.1', resolve));
    const address = fixture.server.address();
    if (address === null || typeof address === 'string') throw new Error('Missing fixture address.');
    if (!fixture.cleanupRegistered) {
      fixture.markCleanupRegistered();
      cleanup.push(async () => { fixture.server.closeAllConnections(); await new Promise<void>((resolve, reject) => fixture.server.close((error) => error ? reject(error) : resolve())); });
    }
    const item: DiscoverySession = {
      ref: { contextId: 'isolated-local', providerId: 'opencode', endpointType: 'shared', nativeId: 'ses_one' },
      name: 'before', rawStatus: { type: 'inactive' },
      capabilities: { discovery: true, delivery: true, deliveryModes: ['queue', 'steer'], launch: false, diagnostics: false },
      attributes: { location: { directory: '/isolated/work' }, cwd: '/isolated/work' },
    };
    const discovery = { execute: async (): Promise<DiscoveryResponse> => ({ op: 'detail', providers: [{ providerId: 'opencode', capabilities: item.capabilities }],
      detail: { item: { ...item, name: fixture.title }, completeness: 'complete', observedAt: Date.now(), errors: [] } }) };
    const url = `http://127.0.0.1:${address.port}`;
    const opencode = registrationFile === undefined ? { endpoint: { url }, env: {} } : { registrationFile, env: {} };
    const operations = createNativeSessionOperations({ discovery, adopt: async () => undefined,
      providers: createNativeOperationProviders({ opencode }), timeoutMs: 1_000 });
    return { operations, item, url, fixture, calls: fixture.calls };
  }

  it('does not accept a rename confirmation from another registration for the same native ID', async () => {
    const path = await directory();
    const fixture = renameFixture();
    const serviceA = join(path, 'service-a.json');
    const serviceB = join(path, 'service-b.json');
    const registration = { version: '2.1.3', url: 'http://placeholder', pid: 765 };
    const a = await operationsFor(fixture);
    await writeFile(serviceA, JSON.stringify({ ...registration, url: a.url, id: 'registration-a' }));
    await writeFile(serviceB, JSON.stringify({ ...registration, url: a.url, id: 'registration-b' }));
    const sourceA = await operationsFor(fixture, serviceA);
    const sourceB = await operationsFor(fixture, serviceB);

    expect(sourceA.item.ref).toEqual(sourceB.item.ref);
    const confirmationA = await sourceA.operations.describe(sourceA.item.ref);
    const confirmationB = await sourceB.operations.describe(sourceB.item.ref);
    expect(confirmationA.actions.rename.state).toBe('executable');
    expect(confirmationB.actions.rename.state).toBe('executable');
    expect(confirmationA.revision).not.toBe(confirmationB.revision);

    await expect(sourceB.operations.apply({ ref: sourceB.item.ref, operation: 'rename', name: 'after', expectedRevision: confirmationA.revision }))
      .resolves.toMatchObject({ kind: 'rejected' });
    expect(sourceA.calls.filter((call) => call.startsWith('PATCH '))).toHaveLength(0);
    expect(fixture.title).toBe('before');
  });

  it('invalidates a rename confirmation when the registration ID changes without changing PID or URL', async () => {
    const path = await directory();
    const fixture = renameFixture();
    const source = await operationsFor(fixture);
    const registrationFile = join(path, 'service.json');
    const registration = { version: '2.1.3', url: source.url, pid: 765 };
    await writeFile(registrationFile, JSON.stringify({ ...registration, id: 'registration-before' }));
    const registered = await operationsFor(fixture, registrationFile);
    const oldConfirmation = await registered.operations.describe(registered.item.ref);
    expect(oldConfirmation.actions.rename.state).toBe('executable');

    await writeFile(registrationFile, JSON.stringify({ ...registration, id: 'registration-after' }));
    await expect(registered.operations.apply({ ref: registered.item.ref, operation: 'rename', name: 'after', expectedRevision: oldConfirmation.revision }))
      .resolves.toMatchObject({ kind: 'rejected' });
    const refreshed = await registered.operations.describe(registered.item.ref);
    expect(refreshed.actions.rename.state).toBe('executable');
    expect(refreshed.revision).not.toBe(oldConfirmation.revision);
    expect(registered.calls.filter((call) => call.startsWith('PATCH '))).toHaveLength(0);
    expect(fixture.title).toBe('before');
  });

  it('recovers read-only after cancellation of a committed rename without replaying the old confirmation', async () => {
    const controller = new AbortController();
    const fixture = renameFixture({ disconnect: true, afterPatchCommit: () => controller.abort() });
    const f = await operationsFor(fixture);
    const confirmation = await f.operations.describe(f.item.ref);

    await expect(f.operations.apply({ ref: f.item.ref, operation: 'rename', name: 'after', expectedRevision: confirmation.revision, signal: controller.signal }))
      .resolves.toMatchObject({ kind: 'uncertain' });
    expect(fixture.title).toBe('after');

    const recovered = await f.operations.describe(f.item.ref);
    expect(recovered.actions.rename.state).toBe('executable');
    expect(recovered.revision).not.toBe(confirmation.revision);
    await expect(f.operations.apply({ ref: f.item.ref, operation: 'rename', name: 'after', expectedRevision: confirmation.revision }))
      .resolves.toMatchObject({ kind: 'rejected' });
    expect(f.calls.filter((call) => call.startsWith('PATCH '))).toHaveLength(1);
  });

  it('uses PATCH with a non-empty title, accepts 204, and confirms the reread', async () => {
    const fixture = renameFixture();
    const f = await operationsFor(fixture);
    const before = await f.operations.describe(f.item.ref);
    expect(before.actions.rename.state).toBe('executable');
    await expect(f.operations.apply({ ref: f.item.ref, operation: 'rename', name: 'after', expectedRevision: before.revision })).resolves.toMatchObject({ kind: 'applied' });
    expect(f.calls.filter((call) => call === 'PATCH /api/session/ses_one')).toHaveLength(1);
    expect(fixture.title).toBe('after');
  });

  it('returns uncertain when 204 is received but the reread does not show the requested title', async () => {
    const fixture = renameFixture({ updateTitle: false });
    const f = await operationsFor(fixture);
    const before = await f.operations.describe(f.item.ref);
    await expect(f.operations.apply({ ref: f.item.ref, operation: 'rename', name: 'after', expectedRevision: before.revision })).resolves.toMatchObject({ kind: 'uncertain' });
    expect(f.calls.filter((call) => call === 'PATCH /api/session/ses_one')).toHaveLength(1);
  });

  it('rejects an owner/version change before sending PATCH', async () => {
    const fixture = renameFixture();
    const f = await operationsFor(fixture);
    const before = await f.operations.describe(f.item.ref);
    fixture.serverVersion = '2.1.4';
    expect((await f.operations.describe(f.item.ref)).actions.rename.state).toBe('needs-verification');
    await expect(f.operations.apply({ ref: f.item.ref, operation: 'rename', name: 'after', expectedRevision: before.revision })).resolves.toMatchObject({ kind: 'rejected' });
    expect(f.calls.filter((call) => call.startsWith('PATCH '))).toHaveLength(0);
  });

  it('reports a disconnected PATCH as uncertain without replaying it', async () => {
    const fixture = renameFixture({ disconnect: true });
    const f = await operationsFor(fixture);
    const before = await f.operations.describe(f.item.ref);
    await expect(f.operations.apply({ ref: f.item.ref, operation: 'rename', name: 'after', expectedRevision: before.revision })).resolves.toMatchObject({ kind: 'uncertain' });
    expect(f.calls.filter((call) => call === 'PATCH /api/session/ses_one')).toHaveLength(1);
    expect(fixture.title).toBe('after');
  });

  it('treats an authoritative missing-session response as rejected without retrying', async () => {
    const fixture = renameFixture({ missingOnPatch: true });
    const f = await operationsFor(fixture);
    const before = await f.operations.describe(f.item.ref);
    await expect(f.operations.apply({ ref: f.item.ref, operation: 'rename', name: 'after', expectedRevision: before.revision })).resolves.toMatchObject({ kind: 'rejected' });
    expect(f.calls.filter((call) => call === 'PATCH /api/session/ses_one')).toHaveLength(1);
  });
});

describe('OpenCode session reader', () => {
  it('exposes a third provider using context-scoped keys, real pages and direct details', async () => {
    const service = await fixture((request, response) => {
      if (request.url === '/api/session/ses_busy') return reply(response, { data: info('ses_busy') });
      reply(response, { data: [info('ses_busy')], cursor: { next: 'more' } });
    });
    const reader = createOpenCodeSessionReader({ endpoint: { url: service.url }, env: {}, now: () => 123 });
    expect(reader.providerId).toBe('opencode');
    expect(reader.capabilities).toMatchObject({ discovery: true, delivery: true, deliveryModes: ['queue', 'steer'], launch: false });
    const page = await reader.list({ contextId: 'isolated-local', limit: 1 });
    expect(page).toMatchObject({ observedAt: 123, completeness: 'partial', nextCursor: 'more', errors: [] });
    expect(page.items[0]).toMatchObject({ ref: { contextId: 'isolated-local', providerId: 'opencode', nativeId: 'ses_busy' }, name: null, rawStatus: { type: 'running' } });
    expect(await reader.get({ contextId: 'isolated-local', nativeId: 'ses_busy' })).toMatchObject({ completeness: 'complete', item: { ref: { nativeId: 'ses_busy' } } });
  });

  it('distinguishes an unconfigured source from a configured empty one and handles cancellation', async () => {
    const path = await directory();
    const missing = createOpenCodeSessionReader({ registrationFile: join(path, 'missing'), env: {} });
    expect(await missing.list({ contextId: 'local' })).toMatchObject({ completeness: 'unavailable', errors: [expect.objectContaining({ kind: 'missing' })] });
    const service = await fixture();
    const empty = createOpenCodeSessionReader({ endpoint: { url: service.url }, env: {} });
    expect(await empty.list({ contextId: 'local' })).toMatchObject({ items: [], errors: [], completeness: 'complete' });
    const controller = new AbortController(); controller.abort();
    expect(await empty.list({ contextId: 'local', signal: controller.signal })).toMatchObject({ completeness: 'cancelled' });
  });
});
