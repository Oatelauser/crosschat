import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { listDesktopMetadata } from '../src/codex/desktop-metadata.js';
import type { DesktopMetadataQueryRequest } from '../src/codex/desktop-metadata.js';

const row = (id: string, recencyAtMs: number, name: string | null = null) => ({ id, name, cwd: '/fixture', source: 'vscode', originator: 'Codex Desktop', createdAtMs: 1, updatedAtMs: recencyAtMs, recencyAtMs });

describe('Desktop metadata candidates', () => {
  it('pages anonymous native IDs without reading prompt columns and binds cursors to the source', async () => {
    const query = vi.fn(async (request: DesktopMetadataQueryRequest) => request.after ? [row('native/b', 20)] : [row('native/c', 30, 'named'), row('native/b', 20)]);
    const first = await listDesktopMetadata({ codexHome: '/isolated', limit: 1, query, now: () => 123 });
    expect(first).toMatchObject({ data: [row('native/c', 30, 'named')], completeness: 'partial', observedAt: 123 });
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await listDesktopMetadata({ codexHome: '/isolated', limit: 1, cursor: first.nextCursor!, query });
    expect(second).toMatchObject({ data: [row('native/b', 20)], nextCursor: null, completeness: 'complete' });
    expect(query.mock.calls[1][0]).toMatchObject({ after: { id: 'native/c', recencyAtMs: 30 }, limit: 2 });
    await expect(listDesktopMetadata({ codexHome: '/different', cursor: first.nextCursor!, query })).rejects.toMatchObject({ code: 'CODEX_DESKTOP_METADATA_INVALID_CURSOR' });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('keeps metadata failure distinct from an empty complete source and validates rows', async () => {
    await expect(listDesktopMetadata({ query: async () => { throw new Error('unavailable'); } })).rejects.toMatchObject({ code: 'CODEX_DESKTOP_METADATA_UNAVAILABLE' });
    await expect(listDesktopMetadata({ query: async () => [{ ...row('native/a', 3), source: 'subagent', title: 'do not read' }] })).rejects.toMatchObject({ code: 'CODEX_DESKTOP_METADATA_PROTOCOL_ERROR' });
    const page = await listDesktopMetadata({ query: async () => [] });
    expect(page).toMatchObject({ data: [], nextCursor: null, completeness: 'complete' });
  });

  it('rejects a source that repeats a cursor boundary instead of advancing', async () => {
    const first = await listDesktopMetadata({ sqliteHome: '/cursor-fixture', limit: 1, query: async () => [row('c', 30), row('b', 20)] });
    await expect(listDesktopMetadata({ sqliteHome: '/cursor-fixture', limit: 1, cursor: first.nextCursor!, query: async () => [row('c', 30)] })).rejects.toMatchObject({ code: 'CODEX_DESKTOP_METADATA_PROTOCOL_ERROR' });
  });

  it('reads an isolated SQLite file through the worker, excludes archived/noninteractive rows, and never creates a missing DB', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'crosschat-desktop-metadata-'));
    const databasePath = join(directory, 'state_5.sqlite');
    try {
      let sqlite: typeof import('node:sqlite');
      try { sqlite = await import('node:sqlite'); } catch {
        await expect(listDesktopMetadata({ sqliteHome: directory })).rejects.toMatchObject({ code: 'CODEX_DESKTOP_METADATA_UNAVAILABLE' });
        expect(existsSync(databasePath)).toBe(false);
        return;
      }
      const database = new sqlite.DatabaseSync(databasePath);
      try {
        database.exec('CREATE TABLE threads(id TEXT,name TEXT,cwd TEXT,source TEXT,originator TEXT,created_at INTEGER,updated_at INTEGER,created_at_ms INTEGER,updated_at_ms INTEGER,recency_at_ms INTEGER,archived INTEGER,title TEXT,preview TEXT,first_user_message TEXT)');
        const insert = database.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
        for (const [id, source, archived, recency, name] of [['live', 'vscode', 0, 40, 'Visible name'], ['anonymous', 'exec', 0, 30, null], ['old', 'cli', 1, 50, 'Archived'], ['agent', 'subagent', 0, 60, 'Internal']] as const) {
          insert.run(id, name, '/fixture', source, 'origin', 1, 2, 1000, 2000, recency, archived, 'PRIVATE PROMPT', 'PRIVATE PREVIEW', 'PRIVATE USER MESSAGE');
        }
      } finally { database.close(); }
      const bytes = readFileSync(databasePath);
      const first = await listDesktopMetadata({ sqliteHome: directory, limit: 1 });
      const second = await listDesktopMetadata({ sqliteHome: directory, limit: 1, cursor: first.nextCursor! });
      expect(first.data.map((entry) => [entry.id, entry.name])).toEqual([['live', 'Visible name']]);
      expect(second.data.map((entry) => [entry.id, entry.name])).toEqual([['anonymous', null]]);
      expect(second.nextCursor).toBeNull();
      expect(JSON.stringify(first)).not.toContain('PRIVATE');
      expect(readFileSync(databasePath)).toEqual(bytes);
      const missing = join(directory, 'missing');
      await expect(listDesktopMetadata({ sqliteHome: missing })).rejects.toMatchObject({ code: 'CODEX_DESKTOP_METADATA_UNAVAILABLE' });
      expect(existsSync(join(missing, 'state_5.sqlite'))).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('uses sqliteHome explicitly, rejects bad limits, and cancels a late injected query', async () => {
    const query = vi.fn(async () => [row('native/a', 1)]);
    await listDesktopMetadata({ codexHome: '/wrong', sqliteHome: '/sqlite', query });
    expect(query.mock.calls[0][0]).toMatchObject({ databasePath: expect.stringContaining('sqlite'), limit: 101 });
    await expect(listDesktopMetadata({ limit: 0, query })).rejects.toMatchObject({ code: 'CODEX_DESKTOP_METADATA_PROTOCOL_ERROR' });
    const controller = new AbortController();
    let release: ((rows: unknown[]) => void) | undefined;
    const pending = listDesktopMetadata({ signal: controller.signal, query: () => new Promise((resolve) => { release = resolve; }) });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    release?.([row('late', 3)]);
  });
});
