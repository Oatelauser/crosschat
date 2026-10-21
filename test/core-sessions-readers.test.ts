import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClaudeSessionReader, createCodexSessionReader } from '../src/application/sessions/index.js';
import type { CodexSession, CodexThreadPage } from '../src/codex/client.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'crosschat-core-sessions-'));
  directories.push(directory);
  return directory;
}

function codexSession(listThreadPage?: (options: { cursor?: string; limit?: number; signal?: AbortSignal }) => Promise<CodexThreadPage>): CodexSession {
  return {
    initialize: vi.fn(async () => undefined),
    listThreads: vi.fn(async () => [{ id: 'old-id', name: null, status: 'idle' as const }]),
    ...(listThreadPage ? { listThreadPage } : {}),
    resumeThread: vi.fn(async () => 'idle' as const),
    startTurn: vi.fn(async () => ({ id: 'turn', status: 'inProgress' })),
    steerTurn: vi.fn(async () => 'turn'),
    unsubscribe: vi.fn(async () => undefined),
    startThread: vi.fn(async () => 'new'),
    deleteThread: vi.fn(async () => undefined),
    notifications: () => [],
    close: vi.fn(async () => undefined),
  };
}

describe('Claude pure reader', () => {
  it('reads 100 anonymous sessions across pages without changing the registry', async () => {
    const directory = await fixture();
    await Promise.all(Array.from({ length: 100 }, (_, index) => writeFile(join(directory, `${index.toString().padStart(3, '0')}.json`), JSON.stringify({ pid: 100 + index, sessionId: `native/${index}`, kind: 'interactive', status: 'future-paused', messagingSocketPath: `test/${index}` }))));
    const before = await readdir(directory);
    const source = createClaudeSessionReader({ directory, isProcessAlive: async () => true, now: () => 500 });
    let cursor: string | undefined;
    const ids: string[] = [];
    do {
      const page = await source.list({ contextId: 'local', limit: 21, cursor });
      ids.push(...page.items.map((item) => item.ref.nativeId));
      expect(page.observedAt).toBe(500);
      expect(page.items[0].name).toBeNull();
      expect(page.items[0].rawStatus).toBe('future-paused');
      expect(page.completeness).toBe(page.nextCursor === null ? 'complete' : 'partial');
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    expect(new Set(ids).size).toBe(100);
    expect(await readdir(directory)).toEqual(before);
    expect(JSON.parse(await readFile(join(directory, '000.json'), 'utf8')).name).toBeUndefined();
    expect((await source.get({ contextId: 'local', nativeId: 'native/99' })).item?.ref.nativeId).toBe('native/99');
  });

  it('distinguishes empty, missing, unreadable and malformed registries and ignores non-session secrets', async () => {
    const directory = await fixture();
    const empty = await createClaudeSessionReader({ directory }).list({ contextId: 'local' });
    expect(empty).toMatchObject({ items: [], errors: [], completeness: 'complete' });
    const missing = await createClaudeSessionReader({ directory: join(directory, 'missing') }).list({ contextId: 'local' });
    expect(missing).toMatchObject({ completeness: 'unavailable', errors: [expect.objectContaining({ kind: 'missing' })] });
    const unreadable = await createClaudeSessionReader({ directory, io: { readDirectory: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); }, readText: async () => '' } }).list({ contextId: 'local' });
    expect(unreadable).toMatchObject({ completeness: 'unavailable', errors: [expect.objectContaining({ kind: 'unreadable' })] });
    await writeFile(join(directory, 'malformed.json'), 'null');
    await writeFile(join(directory, 'peer.key'), 'secret');
    const malformed = await createClaudeSessionReader({ directory }).list({ contextId: 'local' });
    expect(malformed).toMatchObject({ completeness: 'partial', errors: [expect.objectContaining({ kind: 'malformed' })] });
    expect(JSON.stringify(malformed)).not.toContain('secret');
  });

  it('reports an unreadable entry separately and cancellation performs no reads', async () => {
    const readDirectory = vi.fn(async () => ['one.json']);
    const readText = vi.fn(async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); });
    const source = createClaudeSessionReader({ directory: 'fixture', io: { readDirectory, readText } });
    expect(await source.list({ contextId: 'local' })).toMatchObject({ completeness: 'partial', errors: [expect.objectContaining({ kind: 'unreadable' })] });
    readDirectory.mockClear();
    const controller = new AbortController();
    controller.abort();
    expect(await source.list({ contextId: 'local', signal: controller.signal })).toMatchObject({ completeness: 'cancelled' });
    expect(readDirectory).not.toHaveBeenCalled();
  });

  it('preserves earlier source errors when a detail search reaches the final page', async () => {
    const names = Array.from({ length: 101 }, (_, index) => `${index}.json`);
    const source = createClaudeSessionReader({
      directory: 'fixture',
      isProcessAlive: () => true,
      io: {
        readDirectory: async () => names,
        readText: async (path) => path.endsWith('0.json') ? 'null' : JSON.stringify({ pid: 99, sessionId: path, kind: 'interactive', messagingSocketPath: 'fixture/socket' }),
      },
    });
    const detail = await source.get({ contextId: 'local', nativeId: 'does-not-exist' });
    expect(detail.item).toBeNull();
    expect(detail.errors.length).toBeGreaterThan(0);
    expect(detail.completeness).toBe('partial');
  });

  it('marks the pid reference used by old registry writers explicitly', async () => {
    const source = createClaudeSessionReader({
      directory: 'fixture', isProcessAlive: () => true,
      io: { readDirectory: async () => ['old.json'], readText: async () => JSON.stringify({ pid: 7, kind: 'interactive', messagingSocketPath: 'fixture/socket' }) },
    });
    expect((await source.list({ contextId: 'local' })).items[0]).toMatchObject({ ref: { nativeId: '7' }, attributes: { nativeIdSource: 'pid' } });
  });
});

describe('Codex pure reader', () => {
  it('passes page cursors and preserves unknown raw status without resuming or starting a thread', async () => {
    const list = vi.fn(async ({ cursor }: { cursor?: string }) => ({ data: [{ id: cursor ? '21' : '1', name: null, rawStatus: { type: 'future-status' }, attributes: { cwd: '/fixture' } }], nextCursor: cursor ? null : 'native-next' }));
    const session = codexSession(list);
    const source = createCodexSessionReader({ sessionFactory: async () => session, now: () => 600 });
    const first = await source.list({ contextId: 'local', limit: 20 });
    const second = await source.list({ contextId: 'local', limit: 20, cursor: first.nextCursor ?? undefined });
    expect(first).toMatchObject({ completeness: 'partial', nextCursor: 'native-next', observedAt: 600 });
    expect(second).toMatchObject({ completeness: 'complete', nextCursor: null, items: [expect.objectContaining({ rawStatus: { type: 'future-status' } })] });
    expect(list.mock.calls[1][0]).toMatchObject({ cursor: 'native-next', limit: 20 });
    expect(session.resumeThread).not.toHaveBeenCalled();
    expect(session.startThread).not.toHaveBeenCalled();
    expect(session.startTurn).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledTimes(2);
  });

  it('preserves a successful first page and marks a failed continuation unavailable', async () => {
    const session = codexSession(vi.fn().mockResolvedValueOnce({ data: [{ id: '1', name: null, rawStatus: { type: 'idle' }, attributes: {} }], nextCursor: 'page-2' }).mockRejectedValueOnce(new Error('disconnected')));
    const source = createCodexSessionReader({ sessionFactory: async () => session });
    const first = await source.list({ contextId: 'local' });
    const second = await source.list({ contextId: 'local', cursor: first.nextCursor ?? undefined });
    expect(first.items).toHaveLength(1);
    expect(second).toMatchObject({ completeness: 'unavailable', errors: [expect.objectContaining({ kind: 'unavailable' })] });
    expect(session.close).toHaveBeenCalledTimes(2);
  });

  it('marks old session implementations partial and never fabricates a continuation', async () => {
    const session = codexSession();
    const page = await createCodexSessionReader({ sessionFactory: async () => session }).list({ contextId: 'local' });
    expect(page).toMatchObject({ completeness: 'partial', nextCursor: null, items: [expect.objectContaining({ ref: expect.objectContaining({ nativeId: 'old-id' }) })], errors: [expect.objectContaining({ kind: 'legacy-limit' })] });
  });

  it('closes an in-flight session on abort and drops late results', async () => {
    const controller = new AbortController();
    const session = codexSession(async () => new Promise(() => undefined));
    const source = createCodexSessionReader({ sessionFactory: async () => session });
    const request = source.list({ contextId: 'local', signal: controller.signal });
    await vi.waitFor(() => expect(session.initialize).toHaveBeenCalledOnce());
    controller.abort();
    expect(await request).toMatchObject({ completeness: 'cancelled', items: [] });
    expect(session.close).toHaveBeenCalledOnce();
  });

  it('releases a session that is established after its query was cancelled', async () => {
    const controller = new AbortController();
    const session = codexSession();
    let resolveFactory: ((session: CodexSession) => void) | undefined;
    const source = createCodexSessionReader({ sessionFactory: () => new Promise((resolve) => { resolveFactory = resolve; }) });
    const request = source.list({ contextId: 'local', signal: controller.signal });
    controller.abort();
    expect(await request).toMatchObject({ completeness: 'cancelled', items: [] });
    resolveFactory?.(session);
    await vi.waitFor(() => expect(session.close).toHaveBeenCalledOnce());
    expect(session.initialize).not.toHaveBeenCalled();
  });
});
