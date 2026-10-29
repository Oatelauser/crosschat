import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { aggregateSummaries } from '../src/conversation-summary.js';
import { pairKeyOf, recordConversation } from '../src/conversations.js';
import { identityKey, parseIdentityKey } from '../src/identity.js';
import { encodeRef, newConversationRef } from '../src/ref.js';
import { park, mailboxFileFor } from '../src/outbox.js';
import { appendSendLog, createReceiptMarker } from '../src/send-log.js';
import { runStatus } from '../src/commands/status.js';
import { queryCommunications, queryOutbox, summarizeOutbox } from '../src/application/observations/communications.js';
import { queryManagedLog } from '../src/application/observations/logs.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-c14-observations-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const fixture = () => mkdtempSync(join(root, 'case-'));
const caller = { p: 'claude' as const, id: 'caller-full-id', endpointType: 'cli' };
const cli = { p: 'codex' as const, id: 'same-native-id', endpointType: 'cli' };
const desktop = { ...cli, endpointType: 'desktop' };
const ref = newConversationRef(caller, desktop);
const pair = pairKeyOf(ref.f, ref.t);
const stored = encodeRef(ref);
const pairs = { [pair]: { ref: stored, updatedAt: 1_000 } };

describe('typed communication observations', () => {
  it('parses registered typed and legacy identities without guessing unknown types', () => {
    expect(parseIdentityKey(identityKey(desktop))).toEqual(desktop);
    expect(parseIdentityKey('codex:opaque:full-id')).toEqual({ p: 'codex', id: 'opaque:full-id' });
    expect(parseIdentityKey('human')).toEqual({ p: 'human' });
    expect(parseIdentityKey('["third-provider","editor","opaque/id"]'))
      .toEqual({ p: 'third-provider', endpointType: 'editor', id: 'opaque/id' });
    for (const value of ['["codex","shared","same-id"]', '["human","cli","id"]', '["codex","cli"]', '[not-json', 'codex:']) {
      expect(parseIdentityKey(value)).toBeUndefined();
    }
  });

  it('carries exact receipt evidence into the later status confirmation', async () => {
    const marker = createReceiptMarker(desktop.id, 'envelope', desktop.endpointType);
    const rows = aggregateSummaries(pairs, [{ ts: '2026-10-27T01:00:00Z', from: identityKey(caller), target: identityKey(desktop),
      to: 'Desktop', status: 'delivered', receipt: 'unconfirmed', receiptMarker: marker }], new Map());
    expect(rows[0].receiptProbe).toEqual({ threadId: desktop.id, marker, endpointType: 'desktop' });
    const probes: unknown[] = [];
    const text = await runStatus({ listClaudeSessions: () => ({ sessions: [], malformed: 0 }), listCodexThreads: async () => [],
      listConversations: () => rows, confirmReceipt: async (id, evidence, type) => { probes.push([id, evidence, type]); return 'confirmed'; },
    }, false, true);
    expect(probes).toEqual([[desktop.id, marker, 'desktop']]);
    expect(text).toContain('已确认');
  });

  it('uses typed fallback labels and the exact native name for equal-ID owners', async () => {
    const rows = aggregateSummaries(pairs, [], new Map());
    expect(rows[0].pair).toContain('codex-desktop/same-nat');
    const text = await runStatus({ listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
      listCodexThreads: async () => [{ id: cli.id, name: 'CLI owner', endpointType: 'cli', status: { type: 'idle' } },
        { id: cli.id, name: 'Desktop owner', endpointType: 'desktop', status: { type: 'idle' } }],
      listConversations: () => rows,
    }, false, true);
    expect(text).toContain('Desktop owner');
    expect(text).not.toContain('CLI owner');
  });

  it('observes typed queues and mirror files independently without exposing bodies', async () => {
    const baseDir = fixture();
    const dir = join(baseDir, 'outbox');
    park(dir, cli.id, { toName: 'CLI', envelope: 'PRIVATE CLI BODY', callerKey: identityKey(caller), endpointType: 'cli' }, 1_000);
    park(dir, desktop.id, { toName: 'Desktop', envelope: 'PRIVATE DESKTOP BODY', callerKey: identityKey(caller), endpointType: 'desktop' }, 2_000);
    const result = await queryOutbox({ baseDir, contextId: 'local' });
    expect(result.completeness).toBe('complete');
    expect(result.items).toHaveLength(2);
    expect(new Set(result.items.map((item) => item.id)).size).toBe(2);
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ endpointType: 'cli', mailboxFile: mailboxFileFor(dir, cli.id, 'cli'), count: 1 }),
      expect.objectContaining({ endpointType: 'desktop', mailboxFile: mailboxFileFor(dir, desktop.id, 'desktop'), count: 1 }),
    ]));
    expect(summarizeOutbox(result.items)).toEqual({ threads: 2, items: 2 });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('refuses a typed store whose parent directory is a link to another source', async () => {
    const baseDir = fixture();
    const foreign = fixture();
    mkdirSync(join(baseDir, 'outbox'));
    mkdirSync(join(foreign, 'cli'));
    writeFileSync(join(foreign, 'cli', 'foreign-id.json'), JSON.stringify({ items: [{
      id: 'foreign', toName: 'PRIVATE FOREIGN NAME', endpointType: 'cli', parkedAt: 1_000, attempts: 0,
    }] }));
    symlinkSync(foreign, join(baseDir, 'outbox', 'types'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = await queryOutbox({ baseDir, contextId: 'local' });
    expect(result.items).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('PRIVATE FOREIGN NAME');
  });

  it('keeps typed queue counts, routed audit attribution and local session links separate', async () => {
    const baseDir = fixture();
    const file = join(baseDir, 'conversations.json');
    for (const endpoint of [cli, desktop]) {
      const current = newConversationRef(caller, endpoint);
      recordConversation(file, current, 1_000);
      park(join(baseDir, 'outbox'), endpoint.id, { envelope: 'PRIVATE', toName: endpoint.endpointType,
        callerKey: identityKey(caller), endpointType: endpoint.endpointType });
      appendSendLog(join(baseDir, 'send-log.jsonl'), { ts: '2026-10-27T01:00:00Z', from: identityKey(caller),
        to: endpoint.endpointType, target: 'via:tcp:remote', status: 'parked', replyRef: encodeRef(current) });
    }
    const result = await queryCommunications({ baseDir, contextId: 'local' });
    expect(result.completeness).toBe('complete');
    expect(result.items).toHaveLength(2);
    expect(result.items.every((item) => item.parked === 1 && item.status === 'parked')).toBe(true);
    expect(result.items.flatMap((item) => item.localSessionRefs)).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: 'codex', nativeId: cli.id, endpointType: 'cli' }),
      expect.objectContaining({ providerId: 'codex', nativeId: cli.id, endpointType: 'desktop' }),
    ]));
  });

  it('scopes local logs by verified endpoint type with and without an embedded ref', async () => {
    const baseDir = fixture();
    mkdirSync(join(baseDir, 'tcp'));
    for (const endpoint of [cli, desktop]) appendSendLog(join(baseDir, 'send-log.jsonl'), {
      ts: '2026-10-27T01:00:00Z', to: endpoint.endpointType, target: identityKey(endpoint), status: 'delivered',
      replyRef: encodeRef(newConversationRef(caller, endpoint)),
    });
    const selected = { contextId: 'local', providerId: 'codex', nativeId: cli.id, endpointType: 'desktop' };
    const first = await queryManagedLog({ baseDir, sessionRef: selected });
    expect(first.items).toHaveLength(1);
    expect(JSON.parse(first.items[0].text).to).toBe('desktop');
    writeFileSync(join(baseDir, 'send-log.jsonl'), [cli, desktop].map((endpoint) => JSON.stringify({
      ts: '2026-10-27T01:00:00Z', to: endpoint.endpointType, target: identityKey(endpoint), status: 'delivered',
    })).join('\n') + '\n');
    const direct = await queryManagedLog({ baseDir, sessionRef: selected });
    expect(direct.items).toHaveLength(1);
    expect(JSON.parse(direct.items[0].text).to).toBe('desktop');
  });
});
