import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { sendMessage } from '../src/application/send/index.js';
import type { SendDeps } from '../src/application/send/types.js';
import { continueConversation, continueFromRef, HANDLE_MAX, handleForRef, latestKnownConversationRef, loadAllPairs, machineNameOfPair, pairKeyOf, recordConversation, resolveHandle } from '../src/conversations.js';
import { decodeRef, encodeRef, newConversationRef } from '../src/ref.js';
import type { ConversationRef } from '../src/ref.js';
import { writeConversationShards } from './helpers/conversation-shards.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-c14-refinement-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); });

const shardPath = (file: string, pair: string): string => join(dirname(file), 'conversations', `${createHash('sha256').update(pair, 'utf8').digest('hex')}.json`);

function fixture(): { file: string; deps: SendDeps; typedDeps: SendDeps } {
  const dir = mkdtempSync(join(root, 'case-'));
  const file = join(dir, 'conversations.json');
  const deps: SendDeps = {
    env: { CODEX_THREAD_ID: 'sender' },
    listClaudeSessions: () => ({ sessions: [{ pid: 11, sessionId: 'receiver', kind: 'interactive', name: 'Receiver', status: 'idle', messagingSocketPath: 'isolated-fake-socket' }], malformed: 0 }),
    listCodexThreads: async () => [],
    deliverClaude: vi.fn(async () => ({ status: 'delivered' as const })),
    deliverCodex: vi.fn(async () => ({ status: 'accepted' as const, turnId: 'isolated-fake-turn' })),
    sendLogFile: join(dir, 'send.jsonl'), outboxDir: join(dir, 'outbox'), now: () => 100,
    conversationStateFile: file,
  };
  const typedDeps: SendDeps = { ...deps, enrichCallerIdentity: async (caller) => caller.p === 'codex' ? { ...caller, endpointType: 'cli' } : caller };
  return { file, deps, typedDeps };
}

describe('C14 conversation refinement', () => {
  it('retains historical handles and their latest known type after another nonce advances the pair', async () => {
    const { file, deps, typedDeps } = fixture();
    const first = await sendMessage({ tool: 'claude', to: 'Receiver', bodyArg: 'first' }, deps);
    const original = decodeRef(first.receipt.replyRef);
    await recordConversation(file, original, 100, { peer: 'retained-machine-name' });
    const historical = encodeRef({ ...newConversationRef(original.f, original.t), c: 5 });
    const second = await sendMessage({ tool: 'claude', conversation: historical, bodyArg: 'another historical conversation' }, deps);

    const refined = await sendMessage({ tool: 'claude', conversation: first.handle, bodyArg: 'native source now resolves to CLI' }, typedDeps);
    expect(refined.handle).toBe(first.handle);
    expect(decodeRef(refined.receipt.replyRef)).toMatchObject({ n: original.n, c: 2, f: { endpointType: 'cli' } });
    const stale = await sendMessage({ tool: 'claude', conversation: encodeRef(original), bodyArg: 'late reply' }, typedDeps);
    expect(stale.handle).toBe(first.handle);
    expect(decodeRef(resolveHandle(file, first.handle!))).toMatchObject({ n: original.n, c: 3, f: { endpointType: 'cli' } });
    expect(machineNameOfPair(file, decodeRef(stale.receipt.replyRef), 'peer')).toBe('retained-machine-name');

    const other = await sendMessage({ tool: 'claude', conversation: second.receipt.replyRef, bodyArg: 'advance the other typed conversation' }, typedDeps);
    expect(other.handle).toBe(second.handle);
    expect(decodeRef(resolveHandle(file, second.handle!))).toMatchObject({ n: decodeRef(historical).n, c: 7 });
    expect(latestKnownConversationRef(file, original)).toMatchObject({ n: original.n, c: 3, f: { endpointType: 'cli' } });
  });

  it('rejects a failed refinement write before delivery and keeps the original handle valid', async () => {
    const { file, deps, typedDeps } = fixture();
    const first = await sendMessage({ tool: 'claude', to: 'Receiver', bodyArg: 'first' }, deps);
    const original = decodeRef(first.receipt.replyRef);
    const typed = { ...original, f: { ...original.f, endpointType: 'cli' } };
    mkdirSync(shardPath(file, pairKeyOf(typed.f, typed.t)));
    vi.mocked(deps.deliverClaude).mockClear();

    await expect(sendMessage({ tool: 'claude', conversation: first.handle, bodyArg: 'refinement write blocked' }, typedDeps))
      .rejects.toMatchObject({ code: 'CONVERSATION_STATE_WRITE_FAILED' });
    expect(deps.deliverClaude).not.toHaveBeenCalled();
    expect(decodeRef(resolveHandle(file, first.handle!))).toEqual(original);
  });

  it('rejects a failed recipient refinement write before the selected native adapter is called', async () => {
    const { file, deps } = fixture();
    const original = { ...newConversationRef({ p: 'claude', id: 'receiver', endpointType: 'cli' }, { p: 'codex', id: 'target' }), c: 4 };
    await recordConversation(file, original, 100);
    const handle = await handleForRef(file, original);
    const typed = { ...original, t: { ...original.t, endpointType: 'desktop' } };
    mkdirSync(shardPath(file, pairKeyOf(typed.f, typed.t)));
    const receiverDeps: SendDeps = { ...deps, env: { CLAUDE_CODE_MESSAGING_SOCKET: 'isolated-fake-socket' },
      listCodexThreads: async () => [{ id: 'target', name: null, status: 'idle', endpointType: 'desktop' }],
    };

    await expect(sendMessage({ tool: 'codex-desktop', conversation: handle, bodyArg: 'recipient refinement blocked' }, receiverDeps))
      .rejects.toMatchObject({ code: 'CONVERSATION_STATE_WRITE_FAILED' });
    expect(deps.deliverClaude).not.toHaveBeenCalled();
    expect(deps.deliverCodex).not.toHaveBeenCalled();
    expect(decodeRef(resolveHandle(file, handle))).toEqual(original);
  });

  it('preserves the typed pair latest conversation when a historical refinement delivery fails', async () => {
    const { file, deps, typedDeps } = fixture();
    const old = await sendMessage({ tool: 'claude', to: 'Receiver', bodyArg: 'unknown source' }, deps);
    const latest = await sendMessage({ tool: 'claude', to: 'Receiver', bodyArg: 'known source' }, typedDeps);
    const latestRef = decodeRef(latest.receipt.replyRef);
    vi.mocked(deps.deliverClaude).mockRejectedValueOnce(new Error('isolated delivery failure'));

    await expect(sendMessage({ tool: 'claude', conversation: old.handle, bodyArg: 'historical reply' }, typedDeps))
      .rejects.toThrow('isolated delivery failure');
    expect(continueConversation(file, latestRef.f, latestRef.t).ref).toMatchObject({ n: latestRef.n, c: 2 });
    expect(decodeRef(resolveHandle(file, old.handle!))).toMatchObject({ n: decodeRef(old.receipt.replyRef).n, f: { endpointType: 'cli' } });
  });

  it('keeps the migrated handle within the target LRU limit even when delivery fails', async () => {
    const { file, deps, typedDeps } = fixture();
    const first = await sendMessage({ tool: 'claude', to: 'Receiver', bodyArg: 'unknown source' }, deps);
    const original = decodeRef(first.receipt.replyRef);
    const typedSource = { ...original.f, endpointType: 'cli' };
    const pair = pairKeyOf(typedSource, original.t);
    const targetHandles: string[] = [];
    for (let i = 0; i < HANDLE_MAX; i++) {
      const history = newConversationRef(typedSource, original.t);
      targetHandles.push(await handleForRef(file, history));
      await recordConversation(file, history, 200 + i);
    }
    const before = loadAllPairs(file)[pair]!;
    vi.mocked(deps.deliverClaude).mockClear();
    vi.mocked(deps.deliverClaude).mockRejectedValueOnce(new Error('isolated delivery failure'));

    await expect(sendMessage({ tool: 'claude', conversation: first.handle, bodyArg: 'historical reply' }, typedDeps))
      .rejects.toThrow('isolated delivery failure');

    const after = loadAllPairs(file)[pair]!;
    expect(Object.keys(after.handles ?? {})).toEqual([...targetHandles.slice(1), first.handle]);
    expect(after.ref).toBe(before.ref);
    expect(after.updatedAt).toBe(before.updatedAt);
    for (const handle of targetHandles.slice(1)) expect(after.handles?.[handle]).toBe(before.handles?.[handle]);
    expect(() => resolveHandle(file, targetHandles[0]!)).toThrow(expect.objectContaining({ code: 'INVALID_CONVERSATION_REF' }));
    expect(decodeRef(resolveHandle(file, first.handle!))).toMatchObject({ n: original.n, c: original.c, f: { endpointType: 'cli' } });
    expect(deps.deliverClaude).toHaveBeenCalledOnce();
  });

  it('rejects failed old-shard cleanup before delivery while the safely refined duplicate stays readable', async () => {
    const { file, deps, typedDeps } = fixture();
    const first = await sendMessage({ tool: 'claude', to: 'Receiver', bodyArg: 'first' }, deps);
    const original = decodeRef(first.receipt.replyRef);
    const sourceShard = shardPath(file, pairKeyOf(original.f, original.t));
    const before = fs.readFileSync(sourceShard, 'utf8');
    const rename = fs.renameSync;
    const cleanupFailure = vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (String(destination) === sourceShard) throw new Error('isolated old-shard cleanup failure');
      return rename(source, destination);
    });
    syncBuiltinESMExports();
    vi.mocked(deps.deliverClaude).mockClear();

    await expect(sendMessage({ tool: 'claude', conversation: first.handle, bodyArg: 'cleanup blocked' }, typedDeps))
      .rejects.toMatchObject({ code: 'CONVERSATION_STATE_WRITE_FAILED' });
    expect(deps.deliverClaude).not.toHaveBeenCalled();
    expect(fs.readFileSync(sourceShard, 'utf8')).toBe(before);
    expect(decodeRef(resolveHandle(file, first.handle!))).toMatchObject({ n: original.n, c: original.c, f: { endpointType: 'cli' } });
    expect(deps.deliverClaude).not.toHaveBeenCalled();

    cleanupFailure.mockRestore();
    syncBuiltinESMExports();
    const retried = await sendMessage({ tool: 'claude', conversation: first.handle, bodyArg: 'explicit retry after persistence recovers' }, typedDeps);
    expect(retried.handle).toBe(first.handle);
    expect(decodeRef(retried.receipt.replyRef)).toMatchObject({ n: original.n, c: original.c + 1 });
    expect(JSON.parse(fs.readFileSync(sourceShard, 'utf8')).handles?.[first.handle!]).toBeUndefined();
    expect(deps.deliverClaude).toHaveBeenCalledOnce();
  });

  const collisions: { name: string; change: (ref: ConversationRef) => ConversationRef }[] = [
    { name: 'different nonce', change: (ref) => ({ ...ref, n: '0000000000000000' }) },
    { name: 'different source native ID', change: (ref) => ({ ...ref, f: { p: 'codex', id: 'other', endpointType: 'cli' } }) },
    { name: 'different recipient native ID', change: (ref) => ({ ...ref, t: { p: 'codex', id: 'other', endpointType: 'cli' } }) },
    { name: 'different machine name', change: (ref) => ({ ...ref, f: { ...ref.f, m: 'another-machine' } }) },
    { name: 'different machine ID', change: (ref) => ({ ...ref, f: { ...ref.f, mid: 'cccccccc' } }) },
    { name: 'missing machine name', change: (ref) => { const f = { ...ref.f }; if (f.p !== 'human') delete f.m; return { ...ref, f }; } },
    { name: 'missing machine ID', change: (ref) => { const f = { ...ref.f }; if (f.p !== 'human') delete f.mid; return { ...ref, f }; } },
    { name: 'different star', change: (ref) => ({ ...ref, starId: 'bbbbbbbbbbbb' }) },
    { name: 'missing star', change: (ref) => { const next = { ...ref }; delete next.starId; return next; } },
    { name: 'different known recipient endpoint', change: (ref) => ({ ...ref, t: { ...ref.t, endpointType: 'desktop' } }) },
  ];

  it.each(collisions)('rejects handle copies with $name while reconciling a source type', ({ change }) => {
    const { file } = fixture();
    const original: ConversationRef = { ...newConversationRef({ p: 'codex', id: 'sender', m: 'source', mid: 'aaaaaaaa' },
      { p: 'codex', id: 'recipient', endpointType: 'cli', m: 'target', mid: 'bbbbbbbb' }), starId: 'aaaaaaaaaaaa' };
    const typed = change({ ...original, f: { ...original.f, endpointType: 'cli' } });
    writeConversationShards(file, {
      [pairKeyOf(original.f, original.t)]: { ref: encodeRef(original), updatedAt: 100, handleSequence: 1, handles: { cA000: encodeRef(original) } },
      [pairKeyOf(typed.f, typed.t)]: { ref: encodeRef(typed), updatedAt: 100, handleSequence: 1, handles: { cA000: encodeRef(typed) } },
    });
    expect(() => resolveHandle(file, 'cA000')).toThrow(expect.objectContaining({ code: 'INVALID_CONVERSATION_REF' }));
  });

  it('keeps known CLI and Desktop handle copies distinct even when their native IDs and nonce are identical', () => {
    const { file } = fixture();
    const cli = newConversationRef({ p: 'codex', id: 'sender', endpointType: 'cli' }, { p: 'claude', id: 'recipient', endpointType: 'cli' });
    const desktop = { ...cli, f: { ...cli.f, endpointType: 'desktop' } };
    writeConversationShards(file, {
      [pairKeyOf(cli.f, cli.t)]: { ref: encodeRef(cli), updatedAt: 100, handleSequence: 1, handles: { cA000: encodeRef(cli) } },
      [pairKeyOf(desktop.f, desktop.t)]: { ref: encodeRef(desktop), updatedAt: 100, handleSequence: 1, handles: { cA000: encodeRef(desktop) } },
    });
    expect(() => resolveHandle(file, 'cA000')).toThrow(expect.objectContaining({ code: 'INVALID_CONVERSATION_REF' }));
    const unknown = { ...cli, f: { p: 'codex' as const, id: 'sender' } };
    expect(() => latestKnownConversationRef(file, unknown)).toThrow(expect.objectContaining({ code: 'TARGET_CONFLICT' }));
  });

  it.each(collisions.filter(({ name }) => ['different machine name', 'different machine ID', 'different star'].includes(name)))(
    'rejects fully typed copies with $name despite an identical persisted identity pair', ({ change }) => {
      const { file } = fixture();
      const original = { ...newConversationRef({ p: 'codex', id: 'sender', endpointType: 'cli', m: 'source', mid: 'aaaaaaaa' },
        { p: 'codex', id: 'recipient', endpointType: 'cli', m: 'target', mid: 'bbbbbbbb' }), starId: 'aaaaaaaaaaaa' };
      const other = change(original);
      writeConversationShards(file, {
        firstCopy: { ref: encodeRef(original), updatedAt: 100, handleSequence: 1, handles: { cA000: encodeRef(original) } },
        secondCopy: { ref: encodeRef(other), updatedAt: 100, handleSequence: 1, handles: { cA000: encodeRef(other) } },
      });
      expect(() => resolveHandle(file, 'cA000')).toThrow(expect.objectContaining({ code: 'INVALID_CONVERSATION_REF' }));
    });

  // ---- W04-R1 P1: refinement must not pick a winner for an existing collision ----

  it('refinement leaves a foreign same-number handle and the collision untouched', async () => {
    const { file } = fixture();
    const original = { ...newConversationRef({ p: 'codex', id: 'sender' }, { p: 'claude', id: 'receiver', endpointType: 'cli' }), c: 4 };
    await recordConversation(file, original, 100);
    expect(await handleForRef(file, original)).toBe('cA000');
    const typed = { ...original, f: { ...original.f, endpointType: 'cli' } };
    const typedPair = pairKeyOf(typed.f, typed.t);
    const foreign = newConversationRef(typed.f, typed.t);
    mkdirSync(dirname(shardPath(file, typedPair)), { recursive: true });
    writeFileSync(shardPath(file, typedPair),
      JSON.stringify({ pair: typedPair, ref: encodeRef(foreign), updatedAt: 5, handleSequence: 1, handles: { cA000: encodeRef(foreign) } }), 'utf8');
    const untypedBefore = fs.readFileSync(shardPath(file, pairKeyOf(original.f, original.t)), 'utf8');
    const typedBefore = fs.readFileSync(shardPath(file, typedPair), 'utf8');
    expect(() => resolveHandle(file, 'cA000')).toThrow(/撞号/);

    const refined = await continueFromRef(file, typed, original);

    expect(refined.ref).toMatchObject({ n: original.n, f: { endpointType: 'cli' } });
    // No winner was picked and nothing was "recovered": both shards byte-identical.
    expect(fs.readFileSync(shardPath(file, typedPair), 'utf8')).toBe(typedBefore);
    expect(fs.readFileSync(shardPath(file, pairKeyOf(original.f, original.t)), 'utf8')).toBe(untypedBefore);
    expect(() => resolveHandle(file, 'cA000')).toThrow(/撞号/);
    // The conversation still gets a fresh safe handle on its typed pair.
    const safe = await handleForRef(file, refined.ref);
    expect(safe).toBe('cA001');
    expect(decodeRef(resolveHandle(file, safe!))).toMatchObject({ n: original.n, f: { endpointType: 'cli' } });
  });

  it('a full-ref send through a foreign-handle conflict delivers once and hints a safe handle', async () => {
    const { file, deps, typedDeps } = fixture();
    const first = await sendMessage({ tool: 'claude', to: 'Receiver', bodyArg: 'first' }, deps);
    const original = decodeRef(first.receipt.replyRef);
    expect(first.handle).toBe('cA000');
    const typedPair = pairKeyOf({ ...original.f, endpointType: 'cli' }, original.t);
    const foreign = newConversationRef({ ...original.f, endpointType: 'cli' }, original.t);
    mkdirSync(dirname(shardPath(file, typedPair)), { recursive: true });
    writeFileSync(shardPath(file, typedPair),
      JSON.stringify({ pair: typedPair, ref: encodeRef(foreign), updatedAt: 5, handleSequence: 1, handles: { cA000: encodeRef(foreign) } }), 'utf8');
    vi.mocked(deps.deliverClaude).mockClear();

    const sent = await sendMessage({ tool: 'claude', conversation: encodeRef(original), bodyArg: 'refine and send' }, typedDeps);

    expect(sent.status).toBe('delivered');
    expect(deps.deliverClaude).toHaveBeenCalledTimes(1); // exactly one delivery
    expect(sent.handle).toBe('cA001'); // a safe new handle, never the colliding cA000
    expect(decodeRef(sent.receipt.replyRef)).toMatchObject({ n: original.n, f: { endpointType: 'cli' } });
    expect(decodeRef(resolveHandle(file, 'cA001'))).toMatchObject({ n: original.n });
    expect(() => resolveHandle(file, 'cA000')).toThrow(/撞号/); // conflict preserved
    // The ambiguous short handle keeps its explicit zero-delivery rejection.
    vi.mocked(deps.deliverClaude).mockClear();
    await expect(sendMessage({ tool: 'claude', conversation: 'cA000', bodyArg: 'ambiguous short handle' }, typedDeps))
      .rejects.toMatchObject({ code: 'INVALID_CONVERSATION_REF' });
    expect(deps.deliverClaude).not.toHaveBeenCalled();
  });

  it('refinement racing a same-nonce refresh ends with one uniquely resolving handle', async () => {
    const { file } = fixture();
    const original = { ...newConversationRef({ p: 'codex', id: 'sender' }, { p: 'claude', id: 'receiver', endpointType: 'cli' }), c: 3 };
    await recordConversation(file, original, 100);
    expect(await handleForRef(file, original)).toBe('cA000');
    const typed = { ...original, f: { ...original.f, endpointType: 'cli' } };

    await Promise.all([
      continueFromRef(file, typed, original),
      recordConversation(file, { ...original, c: original.c + 1 }, 200),
    ]);

    // Whichever write took the lock last, cA000 exists exactly once and resolves to
    // the typed conversation: no duplicate copy, no lost binding.
    const hit = decodeRef(resolveHandle(file, 'cA000'));
    expect(hit).toMatchObject({ n: original.n, f: { endpointType: 'cli' } });
    const shard = loadAllPairs(file)[pairKeyOf(typed.f, typed.t)]!;
    expect(shard.handles?.cA000).toBe(encodeRef(hit));
    expect(loadAllPairs(file)[pairKeyOf(original.f, original.t)]?.handles?.cA000).toBeUndefined();
  });

  it('a delivered send stays delivered with no resend when post-delivery accounting cannot write', async () => {
    const { file, deps } = fixture();
    const original = { ...newConversationRef({ p: 'codex', id: 'sender' }, { p: 'claude', id: 'receiver', endpointType: 'cli' }), c: 2 };
    const shard = shardPath(file, pairKeyOf(original.f, original.t));
    vi.mocked(deps.deliverClaude).mockImplementation(async () => {
      // Replace the shard the allocation just wrote with a directory, so the
      // post-delivery recordConversation write fails after acceptance.
      fs.rmSync(shard, { force: true });
      fs.mkdirSync(shard);
      return { status: 'delivered' as const };
    });

    const sent = await sendMessage({ tool: 'claude', conversation: encodeRef(original), bodyArg: 'accounting blocked' }, deps);

    expect(sent.status).toBe('delivered');
    expect(deps.deliverClaude).toHaveBeenCalledTimes(1); // no resend, no requeue
    expect(sent.handle).toBe('cA000'); // the hint handed out before delivery stays
    // The failed best-effort write left no scratch file behind.
    expect(fs.readdirSync(dirname(shard)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
