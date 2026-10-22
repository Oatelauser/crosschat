import { mkdtemp, mkdir, rm, writeFile, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { encodeRef } from '../src/ref.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function fixture() {
  const baseDir = await mkdtemp(join(tmpdir(), 'crosschat-observation-logs-'));
  directories.push(baseDir); await mkdir(join(baseDir, 'tcp'));
  return { baseDir, file: join(baseDir, 'send-log.jsonl') };
}

describe('bounded observation log reads', () => {
  it('retains lossless filesystem identities for rotation on large Windows file IDs', async () => {
    const { queryLogWindow } = await import('../src/application/queries/logs.js');
    const { file } = await fixture();
    await writeFile(file, 'event\n');
    const metadata = await stat(file, { bigint: true });
    expect((await queryLogWindow({ file })).cursor?.identity).toBe(`${metadata.dev}:${metadata.ino}:${metadata.birthtimeNs}`);
  });
  it('retains readable sources when the node-log catalog cannot be read', async () => {
    const { queryManagedLog } = await import('../src/application/observations/logs.js');
    const { baseDir, file } = await fixture();
    await writeFile(file, 'readable local event\n');
    await rm(join(baseDir, 'tcp'), { recursive: true });
    await writeFile(join(baseDir, 'tcp'), 'not a directory');
    const page = await queryManagedLog({ baseDir });
    expect(page.items.map((line) => line.text)).toEqual(['readable local event']);
    expect(page.completeness).toBe('partial');
    expect(page.errors).toEqual(expect.arrayContaining([expect.objectContaining({ source: join(baseDir, 'tcp'), kind: 'unreadable' })]));
    expect(page.sources).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'send-log' })]));
  });
  it('does not infer a local sender from an audit entry lacking a scoped reply reference', async () => {
    const { queryManagedLog } = await import('../src/application/observations/logs.js');
    const { baseDir, file } = await fixture();
    await writeFile(file, JSON.stringify({ from: 'codex:same-native-id', target: 'claude:local-receiver', status: 'delivered' }));
    expect((await queryManagedLog({ baseDir, sessionRef: { contextId: 'local', providerId: 'codex', nativeId: 'same-native-id' } })).items).toHaveLength(0);
    expect((await queryManagedLog({ baseDir, sessionRef: { contextId: 'local', providerId: 'claude', nativeId: 'local-receiver' } })).items).toHaveLength(1);
  });
  it('uses the same decoded endpoint attribution as communications for routed audit records', async () => {
    const { queryManagedLog } = await import('../src/application/observations/logs.js');
    const { baseDir, file } = await fixture();
    const replyRef = encodeRef({ v: 1, f: { p: 'claude', id: 'caller-full' }, t: { p: 'codex', id: 'receiver-full', m: 'remote' }, n: '0123456789abcdef', c: 1 });
    await writeFile(file, JSON.stringify({ ts: '2026-10-22T00:00:00Z', from: 'claude:caller-full', target: 'via:tcp:star:node:receiver', to: 'receiver', replyRef, status: 'delivered' }));
    expect((await queryManagedLog({ baseDir, pairId: 'claude:caller-full\ncodex:receiver-full' })).items).toHaveLength(1);
    expect((await queryManagedLog({ baseDir, sessionRef: { contextId: 'local', providerId: 'codex', nativeId: 'receiver-full' } })).items).toHaveLength(0);
  });
  it('bounds visible row count and does not duplicate a discovered rotated node source', async () => {
    const { queryManagedLog } = await import('../src/application/observations/logs.js');
    const { baseDir, file } = await fixture();
    await writeFile(file, Array.from({ length: 1200 }, (_, index) => `row-${index}\n`).join(''));
    await writeFile(join(baseDir, 'tcp', 'node.log'), 'current\n');
    await writeFile(join(baseDir, 'tcp', 'node.log.old'), 'old\n');
    const page = await queryManagedLog({ baseDir });
    expect(page.items).toHaveLength(1000);
    expect(page.items[0].text).toBe('row-200');
    expect(page.completeness).toBe('partial');
    expect(page.sources.filter((source) => source.id === 'node:node.log.old')).toHaveLength(1);
  });
  it('keeps exact byte offsets for duplicate and Unicode lines while retaining the original tail contract', async () => {
    const { queryLogWindow, queryLogTail } = await import('../src/application/queries/logs.js');
    const { file } = await fixture();
    await writeFile(file, '中文👩‍💻\r\nsame\nsame\nunfinished');
    const page = await queryLogWindow({ file });
    expect(page.entries).toEqual([
      { offset: 0, text: '中文👩‍💻', terminated: true },
      { offset: Buffer.byteLength('中文👩‍💻\r\n'), text: 'same', terminated: true },
      { offset: Buffer.byteLength('中文👩‍💻\r\nsame\n'), text: 'same', terminated: true },
      { offset: Buffer.byteLength('中文👩‍💻\r\nsame\nsame\n'), text: 'unfinished', terminated: false },
    ]);
    expect((await queryLogTail({ file })).lines).toEqual(page.entries.map((entry) => entry.text));
  });

  it('reports the omitted oversized edge instead of publishing a fragment as a complete line', async () => {
    const { queryLogWindow } = await import('../src/application/queries/logs.js');
    const { file } = await fixture();
    await writeFile(file, '前'.repeat(100));
    const page = await queryLogWindow({ file, maxBytes: 20 });
    expect(page).toMatchObject({ entries: [], truncated: true, omittedLeadingLine: true, bytesRead: 20 });
    await writeFile(file, 'head\nkeep\n');
    expect(await queryLogWindow({ file, maxBytes: 5 })).toMatchObject({ entries: [{ offset: 5, text: 'keep', terminated: true }], omittedLeadingLine: false });
  });

  it('reads only known log sources and hides credentials, message payloads and local IPC capabilities', async () => {
    const { queryManagedLog } = await import('../src/application/observations/logs.js');
    const { baseDir } = await fixture();
    await writeFile(join(baseDir, 'tcp', 'broker.log'), [
      JSON.stringify({ message: 'safe event', key: 'private-key', adminKey: 'private-admin', proof: 'private-proof', envelope: 'private-body' }),
      '2026-10-22 admin 插座已监听：private-admin-pipe',
      '2026-10-22 ordinary event',
    ].join('\n'));
    const page = await queryManagedLog({ baseDir, sourceId: 'broker' });
    expect(page.items).toHaveLength(3);
    expect(JSON.stringify(page)).not.toMatch(/private-(key|admin|proof|body)/);
    expect(page.items[2].text).toContain('ordinary event');
    expect(page.sources).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'send-log' }), expect.objectContaining({ id: 'broker' })]));
    expect(await queryManagedLog({ baseDir, sourceId: '../../outside-secret' })).toMatchObject({ completeness: 'unavailable', items: [], source: null });
  });

  it('retains stable full line identities across appends and separates replacements and observed truncation', async () => {
    const { queryManagedLog } = await import('../src/application/observations/logs.js');
    const { baseDir, file } = await fixture();
    await writeFile(file, 'same\nsame\n');
    const first = await queryManagedLog({ baseDir });
    expect(first.items[0].id).not.toBe(first.items[1].id);
    await writeFile(file, 'same\nsame\nnext\n');
    const appended = await queryManagedLog({ baseDir, previous: first.checkpoint });
    expect(appended.items.slice(0, 2).map((line) => line.id)).toEqual(first.items.map((line) => line.id));
    await writeFile(file, 'tiny\n');
    const truncated = await queryManagedLog({ baseDir, previous: appended.checkpoint });
    expect(truncated.rotated).toBe(true);
    expect(truncated.items[0].id).not.toBe(first.items[0].id);
    await rename(file, `${file}.old`); await writeFile(file, 'fresh\n');
    const replaced = await queryManagedLog({ baseDir, previous: truncated.checkpoint });
    expect(replaced.rotated).toBe(true);
    expect(replaced.items[0].id).not.toBe(truncated.items[0].id);
  });

  it('filters only proven full local endpoints and preserves absent, cancelled and bounded states', async () => {
    const { queryManagedLog } = await import('../src/application/observations/logs.js');
    const { baseDir, file } = await fixture();
    await writeFile(file, [
      { ts: '2026-10-22T00:00:00Z', from: 'human', to: 'shared', target: 'codex:full-session', status: 'delivered' },
      { ts: '2026-10-22T00:00:01Z', from: 'human', to: 'shared', target: 'codex:full-session-longer', status: 'failed' },
      { ts: '2026-10-22T00:00:02Z', from: 'human', to: 'shared', target: 'claude:full-session', status: 'parked' },
    ].map((line) => JSON.stringify(line)).join('\n'));
    const scoped = await queryManagedLog({ baseDir, sessionRef: { contextId: 'local', providerId: 'codex', nativeId: 'full-session' } });
    expect(scoped.items).toHaveLength(1);
    expect(scoped.items[0].text).toContain('delivered');
    const controller = new AbortController(); controller.abort();
    expect(await queryManagedLog({ baseDir, signal: controller.signal })).toMatchObject({ completeness: 'cancelled', items: [] });
    expect(await queryManagedLog({ baseDir, sourceId: 'launcher' })).toMatchObject({ completeness: 'unavailable', items: [], errors: [{ kind: 'missing' }] });
    await writeFile(file, 'x'.repeat(100));
    expect(await queryManagedLog({ baseDir, maxBytes: 20 })).toMatchObject({ completeness: 'partial', items: [], omittedLeadingLine: true });
  });
});
