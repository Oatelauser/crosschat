import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { encodeRef } from '../src/ref.js';
import type { ConversationRef } from '../src/ref.js';
import { pairKeyOf } from '../src/conversations.js';
import { queryCommunications, queryOutbox, summarizeOutbox } from '../src/application/observations/communications.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function fixture() { const directory = await mkdtemp(join(tmpdir(), 'crosschat-communication-query-')); directories.push(directory); return directory; }
const ref: ConversationRef = { v: 1, f: { p: 'claude', id: 'sender-full-id' }, t: { p: 'codex', id: 'recipient-full-id' }, n: '01020304', c: 7 };
const pair = pairKeyOf(ref.f, ref.t);
function parked(id: string, overrides = {}) { return { id, envelope: 'SECRET-CHAT-BODY', toName: '接收者', callerKey: 'claude:sender-full-id', parkedAt: 100, attempts: 2, deliveryMode: 'queue', ...overrides }; }

describe('read-only communication observation queries', () => {
  it('treats an absent optional store as empty without creating folders, migrating or repairing', async () => {
    const baseDir = await fixture();
    expect(await queryCommunications({ baseDir, contextId: 'local' })).toMatchObject({ items: [], completeness: 'complete', errors: [] });
    expect(await queryOutbox({ baseDir, contextId: 'local' })).toMatchObject({ items: [], completeness: 'complete', errors: [] });
    expect(await readdir(baseDir)).toEqual([]);
  });

  it('returns safe queue metadata with full identities, unknown delivery states and mirror paths', async () => {
    const baseDir = await fixture(); await mkdir(join(baseDir, 'outbox'));
    await writeFile(join(baseDir, 'outbox', 'recipient-full-id.json'), JSON.stringify({ items: [parked('one'), parked('two', { parkedAt: 200, deliveryState: 'uncertain', claim: { id: 'SECRET-CLAIM', ownerPid: 123 }, extra: 'SECRET-EXTRA' })] }));
    const result = await queryOutbox({ baseDir, contextId: 'local', now: () => 500 });
    expect(result).toMatchObject({ completeness: 'complete', observedAt: 500, errors: [], items: [{ contextId: 'local', providerId: 'codex', threadId: 'recipient-full-id', count: 2, oldestParkedAt: 100, state: 'ready', items: [{ id: 'one', attempts: 2 }, { id: 'two', deliveryState: 'uncertain' }] }] });
    expect(result.items[0].mailboxFile).toBe(join(baseDir, 'mailbox', 'recipient-full-id.md'));
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(summarizeOutbox(result.items)).toEqual({ threads: 1, items: 2 });
  });

  it('retains oversized and malformed queue sources as unknown counts with source errors', async () => {
    const baseDir = await fixture(); await mkdir(join(baseDir, 'outbox'));
    const broken = 'broken SECRET';
    await writeFile(join(baseDir, 'outbox', 'broken.json'), broken);
    await writeFile(join(baseDir, 'outbox', 'huge.json'), JSON.stringify({ items: [parked('huge', { envelope: 'SECRET'.repeat(1000) })] }));
    const result = await queryOutbox({ baseDir, contextId: 'local', maxFileBytes: 256 });
    expect(result.completeness).toBe('partial');
    expect(result.items.map((item) => item.count)).toEqual([null, null]);
    expect(result.items.map((item) => item.state)).toEqual(['malformed', 'oversized']);
    expect(result.errors).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(summarizeOutbox(result.items)).toEqual({ threads: 2, items: null });
    expect(await readFile(join(baseDir, 'outbox', 'broken.json'), 'utf8')).toBe(broken);
    expect((await readdir(join(baseDir, 'outbox'))).sort()).toEqual(['broken.json', 'huge.json']);
  });

  it('validates every queue item instead of presenting malformed entries as a complete queue', async () => {
    const baseDir = await fixture(); await mkdir(join(baseDir, 'outbox'));
    await writeFile(join(baseDir, 'outbox', 'recipient-full-id.json'), JSON.stringify({ items: [parked('good'), { id: 'bad', attempts: 'not-an-integer', parkedAt: 100, envelope: 'SECRET' }] }));
    const result = await queryOutbox({ baseDir, contextId: 'local' });
    expect(result.completeness).toBe('partial');
    expect(result.items[0].count).toBeNull();
    expect(result.errors[0]).toMatchObject({ kind: 'malformed', nextStep: expect.any(String) });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('merges current legacy/shard stores with shard precedence and recent audit facts without assigning handles', async () => {
    const baseDir = await fixture(); await mkdir(join(baseDir, 'conversations')); await mkdir(join(baseDir, 'outbox'));
    const stored = encodeRef(ref);
    const legacy = JSON.stringify({ pairs: { [pair]: { ref: stored, updatedAt: 10, handles: { c9: stored } } } });
    await writeFile(join(baseDir, 'conversations.json'), legacy);
    const shard = JSON.stringify({ pair, ref: stored, updatedAt: 20, handles: { c9: stored } });
    await writeFile(join(baseDir, 'conversations', 'one.json'), shard);
    await writeFile(join(baseDir, 'send-log.jsonl'), JSON.stringify({ ts: '2026-01-01T00:00:00Z', from: 'claude:sender-full-id', fromName: '发送者', to: '接收者', target: 'codex:recipient-full-id', status: 'delivered', turn: 7, replyRef: stored, receipt: 'confirmed', receiptMarker: 'SECRET-DIGEST', envelope: 'SECRET-BODY' }) + '\n');
    await writeFile(join(baseDir, 'outbox', 'recipient-full-id.json'), JSON.stringify({ items: [parked('one')] }));
    const result = await queryCommunications({ baseDir, contextId: 'local', now: () => 500 });
    expect(result).toMatchObject({ completeness: 'complete', observedAt: 500, errors: [], items: [{ pairId: pair, endpoints: pair.split('\n'), names: ['发送者', '接收者'], ref: stored, updatedAt: 20, channel: 'local', status: 'delivered', receipt: 'confirmed', turn: 7, parked: 1 }] });
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(await readFile(join(baseDir, 'conversations.json'), 'utf8')).toBe(legacy);
    expect(await readFile(join(baseDir, 'conversations', 'one.json'), 'utf8')).toBe(shard);
    expect((await readdir(join(baseDir, 'conversations')))).toEqual(['one.json']);
  });

  it('keeps malformed stored refs visible as metadata but never as copyable continuation references', async () => {
    const baseDir = await fixture(); await mkdir(join(baseDir, 'conversations'));
    await writeFile(join(baseDir, 'conversations', 'bad-ref.json'), JSON.stringify({ pair, ref: 'invalid-ref', updatedAt: 10 }));
    await writeFile(join(baseDir, 'conversations', 'broken.json'), 'SECRET-MALFORMED');
    const result = await queryCommunications({ baseDir, contextId: 'local' });
    expect(result.completeness).toBe('partial');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ pairId: pair, ref: null, channel: 'unknown' });
    expect(result.errors.some((error) => error.source.endsWith('broken.json'))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('uses saved TCP/SSH reference fields for channels and rejects name/id8 assumptions', async () => {
    const baseDir = await fixture(); await mkdir(join(baseDir, 'conversations'));
    const tcp: ConversationRef = { ...ref, starId: 'full-star-id' };
    await writeFile(join(baseDir, 'conversations', 'tcp.json'), JSON.stringify({ pair, ref: encodeRef(tcp), updatedAt: 10 }));
    expect((await queryCommunications({ baseDir, contextId: 'local' })).items[0].channel).toBe('tcp');
    await writeFile(join(baseDir, 'conversations', 'tcp.json'), JSON.stringify({ pair, ref: encodeRef({ ...ref, t: { ...ref.t, p: 'codex', id: 'recipient-full-id', m: 'remote-host' } }), updatedAt: 10 }));
    expect((await queryCommunications({ baseDir, contextId: 'local' })).items[0].channel).toBe('ssh');
  });

  it('attributes routed audit entries through complete refs and declares local queue targets from positive queue evidence', async () => {
    const baseDir = await fixture(); await mkdir(join(baseDir, 'conversations')); await mkdir(join(baseDir, 'outbox'));
    const routed: ConversationRef = { ...ref, f: { p: 'claude', id: 'sender-full-id', m: 'remote-sender' }, t: { p: 'codex', id: 'recipient-full-id', m: 'unknown-owner-name' }, starId: 'star-full' };
    const stored = encodeRef(routed);
    await writeFile(join(baseDir, 'conversations', 'routed.json'), JSON.stringify({ pair, ref: stored, updatedAt: 20 }));
    await writeFile(join(baseDir, 'send-log.jsonl'), JSON.stringify({ ts: '2026-01-01T00:00:00Z', from: 'claude:sender-full-id', fromName: '远端发送者', to: '接收者', target: 'via:tcp:machine', status: 'parked', replyRef: stored }) + '\n');
    const before = await queryCommunications({ baseDir, contextId: 'local' });
    expect(before.items[0]).toMatchObject({ status: 'parked', channel: 'tcp', localSessionRefs: [] });
    await writeFile(join(baseDir, 'outbox', 'recipient-full-id.json'), JSON.stringify({ items: [parked('local-queue-proof')] }));
    const after = await queryCommunications({ baseDir, contextId: 'local' });
    expect(after.items[0].localSessionRefs).toEqual([{ contextId: 'local', providerId: 'codex', nativeId: 'recipient-full-id' }]);
  });

  it('reports a bounded audit window explicitly and keeps untouched pair inventory', async () => {
    const baseDir = await fixture(); await mkdir(join(baseDir, 'conversations'));
    await writeFile(join(baseDir, 'conversations', 'one.json'), JSON.stringify({ pair, ref: encodeRef(ref), updatedAt: 20 }));
    const logs = Array.from({ length: 20 }, (_, index) => JSON.stringify({ ts: `2026-01-01T00:00:${String(index).padStart(2, '0')}Z`, from: 'claude:sender-full-id', to: '接收者', target: 'codex:recipient-full-id', status: index === 19 ? 'queued' : 'delivered', turn: index }));
    await writeFile(join(baseDir, 'send-log.jsonl'), logs.join('\n') + '\n');
    const result = await queryCommunications({ baseDir, contextId: 'local', auditMaxLines: 2 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ status: 'queued', turn: 19 });
    expect(result.completeness).toBe('partial');
    expect(result.errors.some((error) => /窗口|window/.test(error.message))).toBe(true);
  });

  it('returns cancelled without creating files when the owner is already cancelled', async () => {
    const baseDir = await fixture();
    const owner = new AbortController(); owner.abort();
    expect(await queryCommunications({ baseDir, contextId: 'local', signal: owner.signal })).toMatchObject({ items: [], completeness: 'cancelled' });
    expect(await queryOutbox({ baseDir, contextId: 'local', signal: owner.signal })).toMatchObject({ items: [], completeness: 'cancelled' });
    expect(await readdir(baseDir)).toEqual([]);
  });
});
