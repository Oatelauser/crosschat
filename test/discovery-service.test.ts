import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscoveryService, parseDiscoveryRequest, parseDiscoveryResponse } from '../src/application/discovery/index.js';
import { createClaudeSessionReader, createCodexSessionReader, sessionKey } from '../src/application/sessions/index.js';
import type { SessionReader } from '../src/application/sessions/index.js';
import type { CodexSession } from '../src/codex/client.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const capabilities = { discovery: true, delivery: false, launch: false, diagnostics: true };

function thirdReader(): SessionReader {
  return {
    providerId: 'third-provider', capabilities,
    async list({ contextId }) {
      const ref = { contextId, providerId: 'third-provider', nativeId: 'opaque/full:id/unchanged' };
      return {
        items: [{ ref, key: sessionKey(ref), name: null, rawStatus: { type: 'future-state', code: 17 }, capabilities,
          attributes: { cwd: '/fixture', future: { hint: 42, key: 'hidden-key', adminKey: 'hidden-admin', brokerKey: 'hidden-broker', authResponse: 'hidden-proof' }, messagingSocketPath: 'hidden-socket', messages: ['hidden-chat'] } }],
        nextCursor: null, completeness: 'complete', errors: [], observedAt: 30,
      };
    },
    async get({ contextId }) {
      const page = await this.list({ contextId });
      return { item: page.items[0], completeness: page.completeness, errors: page.errors, observedAt: page.observedAt };
    },
  };
}

describe('complete read-only discovery service', () => {
  it('shares the Claude reader and reaches all 100 anonymous sessions through bounded pages without writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'crosschat-discovery-'));
    directories.push(directory);
    await Promise.all(Array.from({ length: 100 }, (_, index) => writeFile(join(directory, `${String(index).padStart(3, '0')}.json`), JSON.stringify({
      pid: index + 100, sessionId: `native/full/${index}`, kind: 'interactive', status: 'future-state', messagingSocketPath: `secret/${index}`,
    }))));
    const before = await readdir(directory);
    const firstFile = await readFile(join(directory, '000.json'), 'utf8');
    const service = new DiscoveryService([createClaudeSessionReader({ directory, isProcessAlive: () => true })], () => 123);
    let cursor: string | undefined;
    const ids: string[] = [];
    do {
      const response = await service.execute({ op: 'list', limit: 21, cursor }, { contextId: 'local' });
      if (response.op !== 'list') throw new Error('Expected a list response');
      expect(response.page.items.length).toBeLessThanOrEqual(21);
      expect(response.page.items.every((item) => item.name === null)).toBe(true);
      expect(response.page.observedAt).toBe(123);
      expect(response.page.completeness).toBe(response.page.nextCursor === null ? 'complete' : 'partial');
      expect(JSON.stringify(response)).not.toContain('secret/');
      ids.push(...response.page.items.map((item) => item.ref.nativeId));
      cursor = response.page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    expect(new Set(ids).size).toBe(100);
    expect(await readdir(directory)).toEqual(before);
    expect(await readFile(join(directory, '000.json'), 'utf8')).toBe(firstFile);
    const detail = await service.execute({ op: 'detail', providerId: 'claude', nativeId: 'native/full/99' });
    expect(detail).toMatchObject({ op: 'detail', detail: { item: { ref: { nativeId: 'native/full/99' } } } });
    expect(JSON.stringify(detail)).not.toContain('messagingSocketPath');
  });

  it('keeps an extensible provider, capabilities, raw state and safe detail metadata while removing secrets and chat', async () => {
    const service = new DiscoveryService([thirdReader()]);
    const response = await service.execute({ op: 'list' }, { contextId: 'tcp:star/node' });
    expect(response).toMatchObject({
      op: 'list', providers: [{ providerId: 'third-provider', capabilities }],
      page: { items: [{ ref: { contextId: 'tcp:star/node', providerId: 'third-provider', nativeId: 'opaque/full:id/unchanged' }, name: null, rawStatus: { type: 'future-state', code: 17 }, attributes: { cwd: '/fixture', future: { hint: 42 } } }] },
    });
    if (response.op !== 'list') throw new Error('Expected a list response');
    expect(response.page.items[0]).not.toHaveProperty('key');
    expect(JSON.stringify(response)).not.toMatch(/hidden-|messagingSocketPath|adminKey|messages/);
    expect(parseDiscoveryResponse(JSON.parse(JSON.stringify(response)))).toEqual(response);
    expect(await service.execute({ op: 'detail', providerId: 'third-provider', nativeId: 'opaque/full:id/unchanged' })).toMatchObject({
      op: 'detail', detail: { item: { attributes: { future: { hint: 42 } } } },
    });
  });

  it('retains source errors and partial completeness after the remaining source reaches its final page', async () => {
    const successful = thirdReader();
    const list = vi.fn(successful.list);
    list.mockResolvedValueOnce({ items: [], nextCursor: 'next', completeness: 'partial', errors: [], observedAt: 1 });
    successful.list = list;
    const failed = { ...thirdReader(), providerId: 'failed-provider', list: vi.fn().mockRejectedValue(new Error('hidden-secret')) };
    const service = new DiscoveryService([successful, failed]);
    const first = await service.execute({ op: 'list', limit: 21 });
    if (first.op !== 'list') throw new Error('Expected a list response');
    const last = await service.execute({ op: 'list', cursor: first.page.nextCursor ?? undefined, limit: 21 });
    expect(last).toMatchObject({ op: 'list', page: { completeness: 'partial', nextCursor: null, errors: [expect.objectContaining({ source: { providerId: 'failed-provider', contextId: 'local' }, kind: 'unavailable' })] } });
    expect(JSON.stringify(last)).not.toContain('hidden-secret');
  });

  it('passes modern Codex pagination including unloaded anonymous threads without invoking mutation methods', async () => {
    const listThreadPage = vi.fn(async ({ cursor }: { cursor?: string }) => ({
      data: Array.from({ length: cursor ? 79 : 21 }, (_, index) => ({ id: `codex/full/${index + (cursor ? 21 : 0)}`, name: null, rawStatus: { type: 'notLoaded' }, attributes: { originator: 'exec' } })),
      nextCursor: cursor ? null : 'native-codex-page',
    }));
    const session: CodexSession = {
      initialize: vi.fn(async () => undefined), listThreads: vi.fn(async () => []), listThreadPage,
      resumeThread: vi.fn(), startTurn: vi.fn(), steerTurn: vi.fn(), unsubscribe: vi.fn(), startThread: vi.fn(), deleteThread: vi.fn(),
      notifications: () => [], close: vi.fn(async () => undefined),
    };
    const service = new DiscoveryService([createCodexSessionReader({ sessionFactory: async () => session })]);
    const first = await service.execute({ op: 'list', limit: 21 });
    if (first.op !== 'list') throw new Error('Expected a list response');
    const next = await service.execute({ op: 'list', limit: 100, cursor: first.page.nextCursor ?? undefined });
    if (next.op !== 'list') throw new Error('Expected a list response');
    expect(first.page.items).toHaveLength(21);
    expect(next.page.items).toHaveLength(79);
    expect(next.page.completeness).toBe('complete');
    expect(next.page.items[0]).toMatchObject({ name: null, rawStatus: { type: 'notLoaded' }, attributes: { originator: 'exec' } });
    expect(listThreadPage.mock.calls[1][0]).toMatchObject({ cursor: 'native-codex-page', limit: 100 });
    for (const method of [session.listThreads, session.resumeThread, session.startTurn, session.steerTurn, session.startThread, session.deleteThread]) expect(method).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledTimes(2);
  });

  it('does not start a cancelled read and discards a late detail result', async () => {
    const source = thirdReader();
    source.list = vi.fn(source.list);
    const controller = new AbortController();
    controller.abort();
    const service = new DiscoveryService([source]);
    expect(await service.execute({ op: 'list' }, { signal: controller.signal })).toMatchObject({ page: { completeness: 'cancelled', items: [] } });
    expect(source.list).not.toHaveBeenCalled();
    const late = new AbortController();
    source.get = async () => {
      late.abort();
      return { item: null, completeness: 'complete', errors: [], observedAt: 2 };
    };
    expect(await service.execute({ op: 'detail', providerId: 'third-provider', nativeId: 'full' }, { signal: late.signal })).toMatchObject({ detail: { completeness: 'cancelled', item: null } });
  });

  it('isolates malformed source metadata and retains the other providers with a source-specific error', async () => {
    const valid = thirdReader();
    const malformed: SessionReader = {
      ...thirdReader(), providerId: 'malformed-provider',
      async list({ contextId }) {
        const ref = { contextId, providerId: 'malformed-provider', nativeId: 'opaque-id' };
        const attributes: Record<string, unknown> = {};
        attributes.circular = attributes;
        return { items: [{ ref, key: sessionKey(ref), name: null, rawStatus: 'unknown', capabilities, attributes }], nextCursor: null, completeness: 'complete', errors: [], observedAt: 1 };
      },
    };
    const response = await new DiscoveryService([valid, malformed]).execute({ op: 'list' });
    expect(response).toMatchObject({ op: 'list', page: { completeness: 'partial', items: [{ ref: { providerId: 'third-provider' } }], errors: [expect.objectContaining({ source: { contextId: 'local', providerId: 'malformed-provider' }, kind: 'malformed' })] } });
  });

  it('rejects a detail reader returning a different full native ID', async () => {
    const response = await new DiscoveryService([thirdReader()]).execute({ op: 'detail', providerId: 'third-provider', nativeId: 'another-full-id' });
    expect(response).toMatchObject({ detail: { item: null, completeness: 'unavailable', errors: [expect.objectContaining({ source: { contextId: 'local', providerId: 'third-provider' }, kind: 'malformed' })] } });
  });
});

describe('discovery JSON boundary', () => {
  it('accepts opaque IDs and open provider IDs but rejects unsupported operations, invalid limits and scope fields', () => {
    expect(parseDiscoveryRequest({ op: 'detail', providerId: 'third/new', nativeId: 'id with quotes " $(value)', referenceKind: 'native' })).toEqual({ op: 'detail', providerId: 'third/new', nativeId: 'id with quotes " $(value)', referenceKind: 'native' });
    for (const input of [null, [], {}, { op: 'status' }, { op: 'list', limit: 0 }, { op: 'list', limit: 1001 }, { op: 'list', limit: 1.1 }, { op: 'list', contextId: 'other-user' }, { op: 'detail', providerId: 'x', nativeId: '' }, { op: 'list', filter: { providerIds: [17] } }, { op: 'list', filter: { providerIds: Array(40).fill('x'.repeat(65536)) } }]) {
      expect(() => parseDiscoveryRequest(input)).toThrow();
    }
  });

  it('rejects malformed results and a complete page with an outstanding cursor', () => {
    for (const input of [null, { op: 'list', providers: [], page: { items: [], nextCursor: 'next', completeness: 'complete', errors: [], observedAt: 1 } }, { op: 'detail', providers: [], detail: { item: null, completeness: 'complete', errors: [], observedAt: 'now' } }]) {
      expect(() => parseDiscoveryResponse(input)).toThrow();
    }
  });

  it('bounds recursive metadata and response size before consuming untrusted remote data', async () => {
    const response = await new DiscoveryService([thirdReader()]).execute({ op: 'list' });
    if (response.op !== 'list') throw new Error('Expected a list response');
    const attributes = response.page.items[0].attributes;
    expect(() => parseDiscoveryResponse({ ...response, page: { ...response.page, items: [{ ...response.page.items[0], attributes: { rows: Array(2001).fill(1) } }] } })).toThrow();
    let deep: Record<string, unknown> = { hint: 1 };
    for (let level = 0; level < 20; level++) deep = { nested: deep };
    expect(() => parseDiscoveryResponse({ ...response, page: { ...response.page, items: [{ ...response.page.items[0], attributes: deep }] } })).toThrow();
    expect(() => parseDiscoveryResponse({ ...response, page: { ...response.page, items: [{ ...response.page.items[0], attributes: { text: 'x'.repeat(2 * 1024 * 1024 + 1) } }] } })).toThrow();
    expect(attributes).toEqual({ cwd: '/fixture', future: { hint: 42 } });
  });
});
