import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { parseSendArgs } from '../src/cli.js';
import { sendMessage } from '../src/application/send/index.js';
import type { SendDeps } from '../src/application/send/types.js';
import { decodeRef, encodeRef, newConversationRef } from '../src/ref.js';
import { handleForRef, machineNameOfPair, recordConversation, resolveHandle } from '../src/conversations.js';
import { resolveTargetByName } from '../src/resolve.js';
import { encodeOrigin, sendViaSsh } from '../src/federation.js';
import { sendViaTcp } from '../src/serve/via-tcp.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-c14-explicit-send-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const senderId = 'native-codex-sender';
const receiverId = 'native-claude-receiver';
const scan = { sessions: [{ pid: 11, sessionId: receiverId, kind: 'interactive', name: 'Receiver', status: 'idle', messagingSocketPath: 'fixture-socket' }], malformed: 0 };

function deps(): SendDeps {
  return { env: {}, listClaudeSessions: vi.fn(() => scan),
    listCodexThreads: vi.fn(async () => []),
    deliverClaude: vi.fn(async () => ({ status: 'delivered' })),
    deliverCodex: vi.fn(async () => ({ status: 'accepted', turnId: 'fixture-turn' })),
    sendLogFile: join(root, 'send.jsonl'), outboxDir: join(root, 'outbox'), now: () => 100,
  };
}

describe('explicit recipient tool contract', () => {
  it('rejects a missing tool before native discovery or delivery', async () => {
    const dependencies = deps();
    await expect(sendMessage({ to: 'Receiver', bodyArg: 'body' }, dependencies)).rejects.toMatchObject({ code: 'USAGE' });
    expect(dependencies.listClaudeSessions).not.toHaveBeenCalled();
    expect(dependencies.deliverClaude).not.toHaveBeenCalled();
  });

  it('rejects a missing tool while parsing the CLI, before opportunistic drain or stdin', () => {
    expect(() => parseSendArgs(['--to', 'Receiver', '--body', 'body'])).toThrow(expect.objectContaining({ code: 'USAGE' }));
    expect(parseSendArgs(['--to', 'Receiver', '--tool', 'claude', '--body', 'body'])).toMatchObject({ tool: 'claude', to: 'Receiver' });
  });

  it.each(['ssh', 'tcp'])('rejects a missing tool at the direct %s application entry before transport or native discovery', async (transport) => {
    const dependencies = { ...deps(), tcpBaseDir: root, sshExec: vi.fn(async () => { throw new Error('must not dispatch'); }) };
    const args = { to: 'Receiver', via: `${transport}:fixture` };
    const sent = transport === 'ssh' ? sendViaSsh(args, 'body', dependencies) : sendViaTcp(args, 'body', dependencies);
    await expect(sent).rejects.toMatchObject({ code: 'USAGE' });
    expect(dependencies.listClaudeSessions).not.toHaveBeenCalled();
    expect(dependencies.sshExec).not.toHaveBeenCalled();
  });

  it('treats a tool-looking slash name as a literal inside the selected type', () => {
    const name = 'codex-cli/review';
    const selected = { providerId: 'codex', endpointType: 'desktop' };
    const target = { id: 'desktop-target', name, endpointType: 'desktop' };
    expect(resolveTargetByName(name, [], [target], [], [], selected)).toEqual({ side: 'codex', thread: target });
  });

  it.each(['codex-cli/full-native-id', 'tcp:star:machine:session', 'ssh:host/session'])('sends an opaque full native ID literally: %s', async (id) => {
    const dependencies = { ...deps(), listClaudeSessions: vi.fn(() => ({ sessions: [
      { ...scan.sessions[0]!, sessionId: id, name: 'original' },
      { ...scan.sessions[0]!, pid: 12, messagingSocketPath: 'shadow-socket', sessionId: 'shadow', name: id },
    ], malformed: 0 })) };
    await sendMessage({ tool: 'claude', to: id, bodyArg: 'body' }, dependencies);
    expect(dependencies.deliverClaude).toHaveBeenCalledExactlyOnceWith({ pid: 11, messagingSocketPath: 'fixture-socket' }, expect.any(String), { mode: 'queue', endpointType: 'cli' });
  });

  it.each(['unavailable', 'ambiguous'])('permits a native-ID-matched reply when source candidate discovery is %s', async (condition) => {
    const dependencies = { ...deps(), env: { CODEX_THREAD_ID: senderId },
      listCodexThreads: vi.fn(async () => {
        if (condition === 'unavailable') throw new Error('source unavailable');
        return ['cli', 'desktop'].map((endpointType) => ({ id: senderId, name: null, status: 'idle' as const, endpointType }));
      }),
    };
    const conversation = encodeRef(newConversationRef({ p: 'codex', id: senderId, endpointType: 'cli' }, { p: 'claude', id: receiverId, endpointType: 'cli' }));
    const sent = await sendMessage({ tool: 'claude', conversation, bodyArg: 'reply' }, dependencies);
    expect(sent.status).toBe('delivered');
    expect(dependencies.deliverClaude).toHaveBeenCalledOnce();
    expect(dependencies.listCodexThreads).not.toHaveBeenCalled();
  });

  it('keeps the handle, nonce and turns when an explicit recipient tool fills an unknown endpoint', async () => {
    const file = join(mkdtempSync(join(root, 'binding-')), 'conversations.json');
    const original = { ...newConversationRef({ p: 'claude' as const, id: receiverId }, { p: 'codex' as const, id: senderId }), c: 4 };
    await recordConversation(file, original, 10);
    const handle = await handleForRef(file, original);
    const dependencies = { ...deps(), env: { CLAUDE_CODE_MESSAGING_SOCKET: 'fixture-socket' }, conversationStateFile: file,
      listCodexThreads: vi.fn(async () => [{ id: senderId, name: null, status: 'idle' as const, endpointType: 'desktop' }]),
    };
    const sent = await sendMessage({ tool: 'codex-desktop', conversation: handle, bodyArg: 'reply' }, dependencies);
    expect(sent.handle).toBe(handle);
    expect(decodeRef(sent.receipt.replyRef)).toMatchObject({ n: original.n, c: 5, t: { p: 'codex', id: senderId, endpointType: 'desktop' } });
    expect(decodeRef(resolveHandle(file, handle))).toMatchObject({ n: original.n, c: 5, t: { endpointType: 'desktop' } });

    const stale = await sendMessage({ tool: 'codex-desktop', conversation: encodeRef(original), bodyArg: 'late reply' }, dependencies);
    expect(stale.handle).toBe(handle);
    expect(decodeRef(stale.receipt.replyRef).c).toBe(6);
    await expect(sendMessage({ tool: 'codex-cli', conversation: encodeRef(original), bodyArg: 'conflicting old ref' }, dependencies))
      .rejects.toMatchObject({ code: 'TARGET_CONFLICT' });
    expect(dependencies.deliverCodex).toHaveBeenCalledTimes(2);
  });

  it('does not let a native sender mismatch bypass conversation membership', async () => {
    const dependencies = { ...deps(), env: { CODEX_THREAD_ID: 'another-native-id' } };
    const conversation = encodeRef(newConversationRef({ p: 'codex', id: senderId }, { p: 'claude', id: receiverId, endpointType: 'cli' }));
    await expect(sendMessage({ tool: 'claude', conversation, bodyArg: 'reply' }, dependencies)).rejects.toMatchObject({ code: 'CALLER_NOT_IN_CONVERSATION' });
    expect(dependencies.deliverClaude).not.toHaveBeenCalled();
  });

  it('keeps the handle and latest turn when trusted source observation fills an unknown sender type', async () => {
    const file = join(mkdtempSync(join(root, 'source-binding-')), 'conversations.json');
    const original = { ...newConversationRef({ p: 'codex' as const, id: senderId }, { p: 'claude' as const, id: receiverId, endpointType: 'cli' }), c: 7 };
    await recordConversation(file, original, 10, { peer: 'kept-machine-name' });
    const handle = await handleForRef(file, original);
    const dependencies = { ...deps(), env: { CODEX_THREAD_ID: senderId }, conversationStateFile: file,
      enrichCallerIdentity: vi.fn(async (caller: import('../src/identity.js').CallerIdentity) => caller.p === 'codex' ? { ...caller, endpointType: 'cli' } : caller),
    };
    const sent = await sendMessage({ tool: 'claude', conversation: handle, bodyArg: 'reply' }, dependencies);
    expect(sent.handle).toBe(handle);
    expect(decodeRef(sent.receipt.replyRef)).toMatchObject({ n: original.n, c: 8, f: { p: 'codex', id: senderId, endpointType: 'cli' } });
    const next = await sendMessage({ tool: 'claude', conversation: encodeRef(original), bodyArg: 'stale reply' }, dependencies);
    expect(next.handle).toBe(handle);
    expect(decodeRef(resolveHandle(file, handle))).toMatchObject({ n: original.n, c: 9, f: { endpointType: 'cli' } });
    expect(machineNameOfPair(file, decodeRef(next.receipt.replyRef), 'peer')).toBe('kept-machine-name');
    expect(dependencies.deliverClaude).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('from-tool="codex-cli"'), expect.anything());
  });

  it.each(['cli', 'desktop'])('orients a same-native-ID conversation by the explicit %s recipient while the observed source stays unknown', async (endpointType) => {
    const conversation = encodeRef(newConversationRef({ p: 'codex', id: senderId, endpointType: 'cli' }, { p: 'codex', id: senderId, endpointType: 'desktop' }));
    const dependencies = { ...deps(), env: { CODEX_THREAD_ID: senderId } };
    await sendMessage({ tool: `codex-${endpointType}`, conversation, bodyArg: 'reply' }, dependencies);
    const replyType = endpointType === 'cli' ? 'codex-desktop' : 'codex-cli';
    expect(dependencies.deliverCodex).toHaveBeenCalledExactlyOnceWith(senderId, expect.stringContaining(`--tool ${replyType}`), { mode: 'queue', endpointType });
    expect(dependencies.deliverCodex).toHaveBeenCalledWith(senderId, expect.stringContaining('from-tool="pending"'), expect.anything());
  });

  it('uses the explicit recipient when both endpoints share the native ID and one endpoint is remote', async () => {
    const conversation = encodeRef(newConversationRef({ p: 'codex', id: senderId, endpointType: 'cli', m: 'local-host' },
      { p: 'codex', id: senderId, endpointType: 'desktop', m: 'remote-host' }));
    const dependencies = { ...deps(), env: { CODEX_THREAD_ID: senderId }, hostname: () => 'local-host', tcpBaseDir: root,
      sshExec: vi.fn(async () => ({ code: 0, stdout: JSON.stringify({ status: 'delivered', to: 'remote', turn: 2, replyRef: conversation }), stderr: '' })),
    };
    await sendMessage({ tool: 'codex-desktop', conversation, bodyArg: 'reply' }, dependencies);
    expect(dependencies.sshExec).toHaveBeenCalledOnce();
    expect(dependencies.sshExec).toHaveBeenCalledWith(expect.arrayContaining(['ssh', 'remote-host', '--tool', 'codex-desktop']), 'reply', expect.any(Number));
    expect(dependencies.deliverCodex).not.toHaveBeenCalled();
  });

  it.each(['cli', 'desktop'])('preserves the endpoint machines after a remote same-native-ID reply to %s with a pending source type', async (endpointType) => {
    const file = join(mkdtempSync(join(root, 'remote-same-id-')), 'conversations.json');
    const original = newConversationRef(
      { p: 'codex', id: senderId, endpointType: 'cli', m: 'machine-a', mid: 'aaaaaaaa' },
      { p: 'codex', id: senderId, endpointType: 'desktop', m: 'machine-b', mid: 'bbbbbbbb' },
    );
    await recordConversation(file, original, 10, { aaaaaaaa: 'machine-a', bbbbbbbb: 'machine-b' });
    const handle = await handleForRef(file, original);
    const local = endpointType === 'cli' ? original.f : original.t;
    const source = endpointType === 'cli' ? original.t : original.f;
    if (local.p === 'human' || source.p === 'human') throw new Error('Expected native endpoints');
    const dependencies = { ...deps(), conversationStateFile: file,
      hostname: () => local.m!, machineId: () => local.mid,
      fromMachine: source.m,
    };
    const sent = await sendMessage({ tool: `codex-${endpointType}`, conversation: handle, bodyArg: 'reply',
      origin: encodeOrigin({ p: 'codex', id: senderId }, source.m!, source.mid),
    }, dependencies);
    expect(dependencies.deliverCodex).toHaveBeenCalledExactlyOnceWith(senderId, expect.any(String), { mode: 'queue', endpointType });
    expect(sent.handle).toBe(handle);
    expect(decodeRef(sent.receipt.replyRef)).toMatchObject({ n: original.n, c: 2, f: original.f, t: original.t });
    expect(decodeRef(resolveHandle(file, handle))).toMatchObject({ n: original.n, c: 2, f: original.f, t: original.t });
    expect(machineNameOfPair(file, decodeRef(sent.receipt.replyRef), 'aaaaaaaa')).toBe('machine-a');
    expect(machineNameOfPair(file, decodeRef(sent.receipt.replyRef), 'bbbbbbbb')).toBe('machine-b');
  });

  const sameTypeMachines = [
    { label: 'machine IDs', fHost: 'machine-a', tHost: 'machine-b', fMid: 'aaaaaaaa', tMid: 'bbbbbbbb', omitOriginMid: false },
    { label: 'machine IDs despite a shared hostname', fHost: 'shared-host', tHost: 'shared-host', fMid: 'aaaaaaaa', tMid: 'bbbbbbbb', omitOriginMid: false },
    { label: 'hostnames without machine IDs', fHost: 'machine-a', tHost: 'machine-b', fMid: undefined, tMid: undefined, omitOriginMid: false },
    { label: 'origin host without borrowing the receiver machine ID', fHost: 'machine-a', tHost: 'machine-b', fMid: 'aaaaaaaa', tMid: 'bbbbbbbb', omitOriginMid: true },
  ];
  for (const machines of sameTypeMachines) {
    it.each(['f', 't'])('preserves same-ID CLI endpoints by ' + machines.label + ' when receiving at %s', async (localSide) => {
      const original = newConversationRef(
        { p: 'codex', id: senderId, endpointType: 'cli', m: machines.fHost, ...(machines.fMid === undefined ? {} : { mid: machines.fMid }) },
        { p: 'codex', id: senderId, endpointType: 'cli', m: machines.tHost, ...(machines.tMid === undefined ? {} : { mid: machines.tMid }) },
      );
      const local = localSide === 'f' ? original.f : original.t;
      const source = localSide === 'f' ? original.t : original.f;
      if (local.p === 'human' || source.p === 'human') throw new Error('Expected native endpoints');
      const dependencies = { ...deps(), hostname: () => local.m!, machineId: () => local.mid,
        sshExec: vi.fn(async () => { throw new Error('An incoming reply must remain local'); }),
      };
      const sent = await sendMessage({ tool: 'codex-cli', conversation: encodeRef(original), bodyArg: 'reply',
        origin: encodeOrigin({ p: 'codex', id: senderId, endpointType: 'cli' }, source.m!, machines.omitOriginMid ? undefined : source.mid),
      }, dependencies);
      expect(dependencies.deliverCodex).toHaveBeenCalledExactlyOnceWith(senderId, expect.any(String), { mode: 'queue', endpointType: 'cli' });
      expect(dependencies.sshExec).not.toHaveBeenCalled();
      expect(decodeRef(sent.receipt.replyRef)).toMatchObject({ n: original.n, c: 2, f: original.f, t: original.t });
    });
  }

  it.each(['f', 't'])('routes a same-ID CLI reply from %s to the endpoint on the other machine', async (localSide) => {
    const original = newConversationRef(
      { p: 'codex', id: senderId, endpointType: 'cli', m: 'machine-a', mid: 'aaaaaaaa' },
      { p: 'codex', id: senderId, endpointType: 'cli', m: 'machine-b', mid: 'bbbbbbbb' },
    );
    const local = localSide === 'f' ? original.f : original.t;
    const remote = localSide === 'f' ? original.t : original.f;
    if (local.p === 'human' || remote.p === 'human') throw new Error('Expected native endpoints');
    const conversation = encodeRef(original);
    const dependencies = { ...deps(), env: { CODEX_THREAD_ID: senderId }, hostname: () => local.m!, machineId: () => local.mid,
      sshExec: vi.fn(async () => ({ code: 0, stdout: JSON.stringify({ status: 'delivered', to: 'remote', turn: 2, replyRef: conversation }), stderr: '' })),
    };
    await sendMessage({ tool: 'codex-cli', conversation, bodyArg: 'reply' }, dependencies);
    expect(dependencies.sshExec).toHaveBeenCalledExactlyOnceWith(expect.arrayContaining(['ssh', remote.m, '--tool', 'codex-cli']), 'reply', expect.any(Number));
    expect(dependencies.deliverCodex).not.toHaveBeenCalled();
  });

  it('keeps a same-ID same-type reply available when there is no endpoint machine evidence', async () => {
    const conversation = encodeRef(newConversationRef({ p: 'codex', id: senderId, endpointType: 'cli' }, { p: 'codex', id: senderId, endpointType: 'cli' }));
    const dependencies = { ...deps(), env: { CODEX_THREAD_ID: senderId } };
    await sendMessage({ tool: 'codex-cli', conversation, bodyArg: 'reply' }, dependencies);
    expect(dependencies.deliverCodex).toHaveBeenCalledExactlyOnceWith(senderId, expect.any(String), { mode: 'queue', endpointType: 'cli' });
  });
});
