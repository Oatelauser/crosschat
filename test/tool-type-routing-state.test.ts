import { Buffer } from 'node:buffer';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { decodeRef, encodeRef, newConversationRef, nextTurnRef } from '../src/ref.js';
import { endpointOfIdentity, identityKey, identityMatchesEndpoint, resolveCallerIdentity } from '../src/identity.js';
import { continueConversation, continueFromRef, handleForRef, pairKeyOf, pairKeyOfEntry, recordConversation, resolveHandle } from '../src/conversations.js';
import { buildSshArgv, decodeOriginIdentity, encodeOrigin, validateRemoteFlagValues } from '../src/federation.js';
import { drain, mailboxFileFor, outboxCount, outboxPairCounts, outboxSummary, park, retryableOutbox } from '../src/outbox.js';
import { appendSendLog, confirmInRollout, createReceiptMarker } from '../src/send-log.js';
import { MultichatError } from '../src/errors.js';
import { RATE_LIMIT_MAX } from '../src/rate-limit.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-c14-route-state-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const freshDir = () => mkdtempSync(join(root, 'case-'));
const scan = { sessions: [], malformed: 0 };
const cli = { p: 'codex' as const, id: 'same-native-id', endpointType: 'cli' };
const desktop = { p: 'codex' as const, id: cli.id, endpointType: 'desktop' };
const caller = { p: 'claude' as const, id: 'sender', endpointType: 'cli' };

function readQueueFiles(directory: string): unknown[] {
  const values: unknown[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) values.push(...readQueueFiles(file));
    else if (entry.name.endsWith('.json')) values.push(JSON.parse(readFileSync(file, 'utf8')));
  }
  return values;
}

describe('typed conversation endpoint codec', () => {
  it.each([
    { p: 'claude' as const, id: 'native-a', endpointType: 'cli' },
    cli,
    desktop,
    { p: 'opencode' as const, id: 'opaque/session@雪', endpointType: 'shared' },
    { p: 'dsh' as const, id: 'session-host', endpointType: 'host' },
    { p: 'dsh' as const, id: 'session-desktop', endpointType: 'desktop' },
  ])('preserves the verified endpoint and machine through refs and turns: %j', (endpoint) => {
    const ref = { ...newConversationRef(caller, { ...endpoint, m: 'node-a', mid: 'machine-a' }), starId: 'abcdef123456' };
    expect(decodeRef(encodeRef(ref))).toEqual(ref);
    expect(decodeRef(encodeRef(nextTurnRef(ref)))).toEqual({ ...ref, c: 2 });
  });

  it('does not collapse CLI and Desktop refs with the same native IDs', () => {
    const ref = { ...newConversationRef(caller, cli), n: '01020304' };
    expect(encodeRef(ref)).not.toBe(encodeRef({ ...ref, t: desktop }));
  });

  it.each([
    { p: 'claude' as const, id: 'a', endpointType: 'desktop' },
    { p: 'codex' as const, id: 'a', endpointType: 'shared' },
    { p: 'opencode' as const, id: 'a', endpointType: 'cli' },
    { p: 'dsh' as const, id: 'a', endpointType: 'unregistered' },
  ])('rejects a type unsupported by its provider rather than dropping it: %j', (endpoint) => {
    expect(() => encodeRef(newConversationRef(caller, endpoint))).toThrow(expect.objectContaining({ code: 'INVALID_CONVERSATION_REF' }));
  });

  it('keeps the established no-type encoding byte-for-byte', () => {
    const ref = { ...newConversationRef({ p: 'human' }, { p: 'codex', id: 'x' }), n: '01' };
    expect(encodeRef(ref)).toBe('mc2_JgF4AQEB');
    expect(decodeRef(encodeRef(ref))).toEqual(ref);
  });

  it('rejects an unknown or truncated type field in a typed mc2 payload', () => {
    const ref = { ...newConversationRef({ p: 'human' }, { p: 'codex', id: 'x' }), n: '01' };
    const bytes = Buffer.from(encodeRef(ref).slice(4), 'base64url');
    const baseFlags = bytes[0]!;
    const flags = baseFlags | 0x1000;
    const header = Buffer.from([(flags & 0x7f) | 0x80, flags >> 7]);
    const unknown = Buffer.concat([header, bytes.subarray(1), Buffer.from([1, 120])]);
    expect(() => decodeRef(`mc2_${unknown.toString('base64url')}`)).toThrow(expect.objectContaining({ code: 'INVALID_CONVERSATION_REF' }));
    expect(() => decodeRef(`mc2_${Buffer.concat([header, bytes.subarray(1), Buffer.from([7, 99])]).toString('base64url')}`))
      .toThrow(expect.objectContaining({ code: 'INVALID_CONVERSATION_REF' }));
  });

  it('rejects endpoint types attached to a human in legacy JSON refs', () => {
    const legacyRef = { ...newConversationRef({ p: 'human' }, cli), f: { p: 'human', endpointType: 'cli' } };
    const legacy = `mc1_${Buffer.from(JSON.stringify(legacyRef)).toString('base64url')}`;
    expect(() => decodeRef(legacy)).toThrow(expect.objectContaining({ code: 'INVALID_CONVERSATION_REF' }));
  });
});

describe('typed identity, pair continuity and provenance', () => {
  it('retains known caller types and prevents a known other endpoint from matching', () => {
    expect(endpointOfIdentity(cli)).toEqual(cli);
    expect(identityKey(cli)).not.toBe(identityKey(desktop));
    expect(identityMatchesEndpoint(cli, cli)).toBe(true);
    expect(identityMatchesEndpoint(cli, desktop)).toBe(false);
    expect(identityMatchesEndpoint(desktop, cli)).toBe(false);
  });

  it('does not infer Codex CLI from the native ID alone', () => {
    expect(resolveCallerIdentity({ CODEX_THREAD_ID: cli.id }, scan)).toEqual({ p: 'codex', id: cli.id });
  });

  it('separates pair state and handles for two endpoint types with the same ID', async () => {
    const file = join(freshDir(), 'conversations.json');
    const cliRef = newConversationRef(caller, cli);
    const desktopRef = newConversationRef(caller, desktop);
    expect(pairKeyOf(caller, cli)).not.toBe(pairKeyOf(caller, desktop));
    await recordConversation(file, cliRef, 1_000);
    const cliHandle = await handleForRef(file, cliRef);
    await recordConversation(file, desktopRef, 2_000);
    const desktopHandle = await handleForRef(file, desktopRef);
    expect(cliHandle).not.toBe(desktopHandle);
    expect(decodeRef(resolveHandle(file, cliHandle))).toEqual(cliRef);
    expect(decodeRef(resolveHandle(file, desktopHandle))).toEqual(desktopRef);
    expect(continueConversation(file, caller, cli).ref).toEqual({ ...cliRef, c: 2 });
    expect(continueConversation(file, caller, desktop).ref).toEqual({ ...desktopRef, c: 2 });
    expect((await continueFromRef(file, cliRef)).ref.t).toEqual(cli);
    expect(pairKeyOfEntry({ from: identityKey(caller), target: identityKey(cli), replyRef: encodeRef(cliRef) }))
      .toBe(pairKeyOf(caller, cli));
  });

  it.each([cli, desktop, { ...caller, name: 'sender/name@雪' },
    { p: 'opencode' as const, id: 'opaque/session@雪', endpointType: 'shared' },
    { p: 'dsh' as const, id: 'harness/host@雪', endpointType: 'host' },
    { p: 'dsh' as const, id: 'harness/desktop@雪', endpointType: 'desktop' },
  ])('keeps endpoint type through both SSH and TCP origin codecs: %j', (identity) => {
    expect(decodeOriginIdentity(encodeOrigin(identity, 'host-a', 'machine-a'))).toEqual({ ...identity, host: 'host-a', mid: 'machine-a' });
    expect(decodeOriginIdentity(encodeOrigin(identity, 'aabbccdd', 'machine-a', 'tcp')))
      .toEqual({ ...identity, host: 'aabbccdd', mid: 'machine-a', via: 'tcp' });
  });

  it('does not reuse a handle when an equal nonce identifies another typed pair', async () => {
    const file = join(freshDir(), 'conversations.json');
    const cliRef = newConversationRef(caller, cli);
    const desktopRef = { ...cliRef, t: desktop };
    const first = await handleForRef(file, cliRef);
    const second = await handleForRef(file, desktopRef);
    expect(second).not.toBe(first);
    expect(decodeRef(resolveHandle(file, first)).t).toEqual(cli);
    expect(decodeRef(resolveHandle(file, second)).t).toEqual(desktop);
  });

  it('passes an explicit tool type to the authoritative SSH command', () => {
    const args = { to: cli.id, tool: 'codex-cli', delivery: 'steer' as const };
    const argv = buildSshArgv('host-a', args, 'encoded-origin');
    expect(argv.slice(argv.indexOf('--tool'), argv.indexOf('--tool') + 2)).toEqual(['--tool', 'codex-cli']);
    expect(argv).toContain('--delivery');
    expect(() => validateRemoteFlagValues({ ...args, tool: 'codex-cli;danger' })).toThrow(expect.objectContaining({ code: 'USAGE' }));
  });
});

describe('typed delayed delivery state', () => {
  it('persists the original type and passes it to every delayed attempt', async () => {
    const dir = freshDir();
    park(dir, cli.id, { envelope: 'cli-envelope', toName: 'peer', endpointType: 'cli' }, 1_000);
    expect(JSON.stringify(readQueueFiles(dir))).toContain('"endpointType":"cli"');
    const seen: unknown[] = [];
    await drain(dir, async (id, content, _timeout, options) => { seen.push({ id, content, options }); });
    expect(seen).toEqual([{ id: cli.id, content: 'cli-envelope', options: { mode: 'queue', endpointType: 'cli' } }]);
  });

  it('keeps queues, mailbox files and uncertain claims isolated by endpoint type', async () => {
    const dir = freshDir();
    park(dir, cli.id, { envelope: 'cli-envelope', toName: 'peer', endpointType: 'cli' }, 1_000);
    park(dir, cli.id, { envelope: 'desktop-envelope', toName: 'peer', endpointType: 'desktop' }, 2_000);
    expect(outboxCount(dir, cli.id, 'cli')).toBe(1);
    expect(outboxCount(dir, cli.id, 'desktop')).toBe(1);
    expect(mailboxFileFor(dir, cli.id, 'cli')).not.toBe(mailboxFileFor(dir, cli.id, 'desktop'));
    const seen: string[] = [];
    const deliver = async (_id: string, content: string, _timeout: number, options?: { endpointType?: string }) => {
      seen.push(`${options?.endpointType}:${content}`);
      if (options?.endpointType === 'cli') throw new MultichatError('CODEX_WRITE_UNCERTAIN', 'accepted outcome unknown');
    };
    await drain(dir, deliver);
    expect(seen.sort()).toEqual(['cli:cli-envelope', 'desktop:desktop-envelope']);
    expect(outboxCount(dir, cli.id, 'cli')).toBe(1);
    expect(outboxCount(dir, cli.id, 'desktop')).toBe(0);
    expect(retryableOutbox(dir).pending).toBe(false);
    await drain(dir, deliver);
    expect(seen).toHaveLength(2);
  });

  it('uses typed endpoint attribution for queue counters', () => {
    const dir = freshDir();
    park(dir, cli.id, { envelope: 'cli-envelope', toName: 'peer', callerKey: identityKey(caller), endpointType: 'cli' }, 1_000);
    park(dir, cli.id, { envelope: 'desktop-envelope', toName: 'peer', callerKey: identityKey(caller), endpointType: 'desktop' }, 2_000);
    expect(outboxSummary(dir)).toEqual(expect.arrayContaining([
      expect.objectContaining({ threadId: cli.id, endpointType: 'cli', count: 1 }),
      expect.objectContaining({ threadId: cli.id, endpointType: 'desktop', count: 1 }),
    ]));
    const counts = outboxPairCounts(dir);
    expect(counts.get(pairKeyOf(caller, cli))).toBe(1);
    expect(counts.get(pairKeyOf(caller, desktop))).toBe(1);
  });

  it('keeps a full CLI rate window from blocking a Desktop queue with the same native ID', async () => {
    const dir = freshDir();
    const sendLogFile = join(freshDir(), 'send-log.jsonl');
    const from = identityKey(caller);
    park(dir, cli.id, { envelope: 'cli-envelope', toName: 'CLI', callerKey: from, endpointType: 'cli' }, 1_000);
    park(dir, desktop.id, { envelope: 'desktop-envelope', toName: 'Desktop', callerKey: from, endpointType: 'desktop' }, 1_000);
    for (let index = 0; index < RATE_LIMIT_MAX; index++) appendSendLog(sendLogFile, {
      ts: new Date(5_000).toISOString(), from, target: identityKey(cli), to: 'CLI', status: 'delivered',
    });
    const attempted: unknown[] = [];
    await drain(dir, async (_id, content, _timeout, options) => { attempted.push([content, options?.endpointType]); },
      { sendLogFile, now: () => 6_000 });
    expect(attempted).toEqual([['desktop-envelope', 'desktop']]);
    expect(outboxCount(dir, cli.id, 'cli')).toBe(1);
    expect(outboxCount(dir, desktop.id, 'desktop')).toBe(0);
  });

  it('skips malformed persisted queues before claiming or delivering them', async () => {
    const dir = freshDir();
    writeFileSync(join(dir, `${cli.id}.json`), JSON.stringify({ items: [{
      id: 'corrupt', envelope: 'must not send', toName: 42, parkedAt: 1_000, attempts: 0,
    }] }));
    const seen: string[] = [];
    expect(outboxSummary(dir)).toEqual([]);
    expect(await drain(dir, async (_id, content) => { seen.push(content); })).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('binds receipts to the requested endpoint type while preserving legacy markers', () => {
    const legacy = createReceiptMarker(cli.id, 'same-envelope');
    expect(createReceiptMarker(cli.id, 'same-envelope', 'cli')).not.toBe(legacy);
    expect(createReceiptMarker(cli.id, 'same-envelope', 'cli')).not.toBe(createReceiptMarker(cli.id, 'same-envelope', 'desktop'));
  });

  it('confirms a typed receipt only for the originally requested endpoint', async () => {
    const home = freshDir();
    const day = join(home, 'sessions', '2026', '10', '27');
    const id = 'aaaa1111-0000-0000-0000-000000000000';
    mkdirSync(day, { recursive: true });
    writeFileSync(join(day, `rollout-2026-10-27T05-00-00-${id}.jsonl`), `${JSON.stringify({
      type: 'event_msg', payload: { type: 'user_message', message: 'typed receipt' },
    })}\n`);
    const marker = createReceiptMarker(id, 'typed receipt', 'cli');
    expect(await confirmInRollout(home, id, marker, { tries: 1, delayMs: 0 }, 'cli')).toBe('confirmed');
    expect(await confirmInRollout(home, id, marker, { tries: 1, delayMs: 0 }, 'desktop')).toBe('unconfirmed');
    expect(await confirmInRollout(home, id, marker, { tries: 1, delayMs: 0 })).toBe('unconfirmed');
  });
});
