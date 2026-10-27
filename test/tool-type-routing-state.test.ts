import { Buffer } from 'node:buffer';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { decodeRef, encodeRef, newConversationRef, nextTurnRef } from '../src/ref.js';
import { endpointOfIdentity, identityKey, identityMatchesEndpoint, resolveCallerIdentity } from '../src/identity.js';
import { continueConversation, continueFromRef, handleForRef, pairKeyOf, pairKeyOfEntry, recordConversation, resolveHandle } from '../src/conversations.js';
import { buildSshArgv, decodeOriginIdentity, encodeOrigin, validateRemoteFlagValues } from '../src/federation.js';
import { drain, mailboxFileFor, outboxCount, outboxPairCounts, outboxSummary, park, retryableOutbox } from '../src/outbox.js';
import { createReceiptMarker } from '../src/send-log.js';
import { MultichatError } from '../src/errors.js';

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

  it('separates pair state and handles for two endpoint types with the same ID', () => {
    const file = join(freshDir(), 'conversations.json');
    const cliRef = newConversationRef(caller, cli);
    const desktopRef = newConversationRef(caller, desktop);
    expect(pairKeyOf(caller, cli)).not.toBe(pairKeyOf(caller, desktop));
    recordConversation(file, cliRef, 1_000);
    const cliHandle = handleForRef(file, cliRef);
    recordConversation(file, desktopRef, 2_000);
    const desktopHandle = handleForRef(file, desktopRef);
    expect(cliHandle).not.toBe(desktopHandle);
    expect(decodeRef(resolveHandle(file, cliHandle))).toEqual(cliRef);
    expect(decodeRef(resolveHandle(file, desktopHandle))).toEqual(desktopRef);
    expect(continueConversation(file, caller, cli).ref).toEqual({ ...cliRef, c: 2 });
    expect(continueConversation(file, caller, desktop).ref).toEqual({ ...desktopRef, c: 2 });
    expect(continueFromRef(file, cliRef).ref.t).toEqual(cli);
    expect(pairKeyOfEntry({ from: identityKey(caller), target: identityKey(cli), replyRef: encodeRef(cliRef) }))
      .toBe(pairKeyOf(caller, cli));
  });

  it.each([cli, desktop])('keeps endpoint type through both SSH and TCP origin codecs: %j', (identity) => {
    expect(decodeOriginIdentity(encodeOrigin(identity, 'host-a', 'machine-a'))).toEqual({ ...identity, host: 'host-a', mid: 'machine-a' });
    expect(decodeOriginIdentity(encodeOrigin(identity, 'aabbccdd', 'machine-a', 'tcp')))
      .toEqual({ ...identity, host: 'aabbccdd', mid: 'machine-a', via: 'tcp' });
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

  it('uses typed endpoint attribution for queue counters and rate windows', () => {
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

  it('binds receipts to the requested endpoint type while preserving legacy markers', () => {
    const legacy = createReceiptMarker(cli.id, 'same-envelope');
    expect(createReceiptMarker(cli.id, 'same-envelope', 'cli')).not.toBe(legacy);
    expect(createReceiptMarker(cli.id, 'same-envelope', 'cli')).not.toBe(createReceiptMarker(cli.id, 'same-envelope', 'desktop'));
  });
});
