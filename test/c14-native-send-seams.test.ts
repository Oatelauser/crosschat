import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sendMessage } from '../src/application/send/index.js';
import type { SendDeps } from '../src/application/send/types.js';
import { listCodexThreads } from '../src/codex/discovery.js';
import type { CodexSession } from '../src/codex/client.js';
import type { DesktopThreadSession } from '../src/codex/desktop-ipc.js';
import { decodeRef, encodeRef, newConversationRef } from '../src/ref.js';
import { decodeOriginIdentity, encodeOrigin } from '../src/federation.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-c14-native-send-seams-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const cliId = '11111111-1111-4111-8111-111111111111';

function cli(): CodexSession {
  return { initialize: vi.fn(async () => undefined),
    listThreads: vi.fn(async () => [{ id: cliId, name: 'CLI target', status: 'idle' as const }]),
    listThreadPage: vi.fn(async () => ({ data: [{ id: cliId, name: 'CLI target', rawStatus: { type: 'idle' }, attributes: {} }], nextCursor: null })),
    resumeThread: vi.fn(async () => 'idle'), startTurn: vi.fn(async () => ({ id: 'cli-turn', status: 'inProgress' })),
    steerTurn: vi.fn(async () => 'cli-turn'), unsubscribe: vi.fn(async () => undefined),
    startThread: vi.fn(async () => 'unused'), deleteThread: vi.fn(async () => undefined), notifications: () => [], close: vi.fn(async () => undefined) };
}

function desktop(id: string): DesktopThreadSession {
  return { threadId: id, ownerId: `desktop-owner/${id}`,
    snapshot: vi.fn(async () => ({ id, name: 'Desktop', cwd: '/fixture', rawStatus: { type: 'idle' }, activeTurnId: null, idle: true, revision: 1 })),
    startTurn: vi.fn(async () => 'desktop-turn'), steerTurn: vi.fn(async () => 'desktop-turn'), close: vi.fn(async () => undefined) };
}

function deps(): SendDeps {
  return { env: {}, listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
    listCodexThreads: async () => [], listOpenCodeThreads: async () => [], listDshThreads: async () => [],
    deliverClaude: vi.fn(async () => ({ status: 'delivered' })),
    deliverCodex: vi.fn(async () => ({ status: 'accepted', turnId: 'accepted-turn' })),
    sendLogFile: join(root, 'send.jsonl'), outboxDir: join(root, 'outbox'), now: () => 100 };
}

describe('C14 native discovery and reply integration seams', () => {
  it.each([
    { types: ['cli', 'desktop'] },
    { types: ['desktop'] },
    { types: [undefined] },
    { types: [] },
  ])('permits Q8 replies without turning recipient-list evidence into a source-owner gate: $types', async ({ types }) => {
    const scan = { sessions: [{ pid: 11, sessionId: 'claude-receiver', kind: 'interactive', name: 'Receiver', status: 'idle', messagingSocketPath: 'fixture-socket' }], malformed: 0 };
    const dependencies = { ...deps(), env: { CODEX_THREAD_ID: cliId }, listClaudeSessions: () => scan,
      listCodexThreads: vi.fn(async () => types.map((endpointType) => ({ id: cliId, name: null, status: 'idle' as const, endpointType }))),
    };
    const conversation = encodeRef(newConversationRef({ p: 'codex', id: cliId, endpointType: 'cli' }, { p: 'claude', id: 'claude-receiver', endpointType: 'cli' }));
    await sendMessage({ tool: 'claude', conversation, bodyArg: 'typed continuation' }, dependencies);
    expect(dependencies.listCodexThreads).not.toHaveBeenCalled();
    expect(dependencies.deliverClaude).toHaveBeenCalledOnce();
    expect(dependencies.deliverCodex).not.toHaveBeenCalled();
  });

  it('uses the fixed return endpoint without claiming the observed source type is known', async () => {
    const scan = { sessions: [{ pid: 11, sessionId: 'claude-receiver', kind: 'interactive', name: 'Receiver', status: 'idle', messagingSocketPath: 'fixture-socket' }], malformed: 0 };
    const list = vi.fn(async () => [{ id: cliId, name: null, status: 'idle' as const, endpointType: 'cli' }]);
    const dependencies = { ...deps(), env: { CODEX_THREAD_ID: cliId }, listClaudeSessions: () => scan, listCodexThreads: list };
    const conversation = encodeRef(newConversationRef({ p: 'codex', id: cliId, endpointType: 'cli' }, { p: 'claude', id: 'claude-receiver', endpointType: 'cli' }));
    const result = await sendMessage({ tool: 'claude', conversation, bodyArg: 'typed continuation' }, dependencies);
    expect(list).not.toHaveBeenCalled();
    expect(dependencies.deliverClaude).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('from-tool="pending"'), expect.anything());
    expect(dependencies.deliverClaude).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('--tool codex-cli'), expect.anything());
    expect(decodeRef(result.receipt.replyRef).f).toMatchObject({ p: 'codex', id: cliId, endpointType: 'cli' });
    expect(dependencies.deliverClaude).toHaveBeenCalledOnce();
  });

  it('permits a native-ID-matched reply when optional source metadata is unavailable', async () => {
    const scan = { sessions: [{ pid: 11, sessionId: 'claude-receiver', kind: 'interactive', name: 'Receiver', status: 'idle', messagingSocketPath: 'fixture-socket' }], malformed: 0 };
    const dependencies = { ...deps(), env: { CODEX_THREAD_ID: cliId }, listClaudeSessions: () => scan,
      listCodexThreads: vi.fn(async () => { throw new Error('native source incomplete'); }),
    };
    const conversation = encodeRef(newConversationRef({ p: 'codex', id: cliId, endpointType: 'cli' }, { p: 'claude', id: 'claude-receiver', endpointType: 'cli' }));
    await sendMessage({ tool: 'claude', conversation, bodyArg: 'typed continuation' }, dependencies);
    expect(dependencies.listCodexThreads).not.toHaveBeenCalled();
    expect(dependencies.deliverClaude).toHaveBeenCalledOnce();
  });

  it('dispatches a native-ID-matched SSH reply without requiring source candidate attestation', async () => {
    const conversation = encodeRef(newConversationRef({ p: 'codex', id: cliId, endpointType: 'cli' }, { p: 'claude', id: 'remote-receiver', endpointType: 'cli' }));
    const dependencies = { ...deps(), env: { CODEX_THREAD_ID: cliId },
      listCodexThreads: vi.fn(async () => { throw new Error('not a source-owner proof'); }),
      sshExec: vi.fn(async () => ({ code: 0, stdout: JSON.stringify({ status: 'delivered', to: 'receiver', turn: 2, replyRef: conversation }), stderr: '' })),
    };
    await sendMessage({ tool: 'claude', conversation, via: 'ssh:fixture', bodyArg: 'typed continuation' }, dependencies);
    expect(dependencies.sshExec).toHaveBeenCalledOnce();
    expect(dependencies.listCodexThreads).not.toHaveBeenCalled();
  });

  it('reaches normal TCP configuration validation without requiring a source candidate view', async () => {
    const dependencies = { ...deps(), env: { CODEX_THREAD_ID: cliId }, tcpBaseDir: root,
      listCodexThreads: vi.fn(async () => { throw new Error('not a source-owner proof'); }),
    };
    const conversation = encodeRef(newConversationRef({ p: 'codex', id: cliId, endpointType: 'cli' }, { p: 'claude', id: 'remote-receiver', endpointType: 'cli' }));
    await expect(sendMessage({ tool: 'claude', conversation, via: 'tcp:fixture', bodyArg: 'typed continuation' }, dependencies))
      .rejects.toThrow('本机未入网');
    expect(dependencies.listCodexThreads).not.toHaveBeenCalled();
  });

  it('retains an unknown sender type in the outbound origin without inferring it from candidates', async () => {
    const conversation = encodeRef(newConversationRef({ p: 'codex', id: cliId, endpointType: 'cli' }, { p: 'claude', id: 'remote-receiver', endpointType: 'cli' }));
    let sentOrigin: string | undefined;
    const dependencies = { ...deps(), env: { CODEX_THREAD_ID: cliId },
      listCodexThreads: async () => [{ id: cliId, name: null, status: 'idle' as const, endpointType: 'cli' }],
      sshExec: vi.fn(async (argv: readonly string[]) => {
        sentOrigin = argv[argv.indexOf('--origin') + 1];
        return { code: 0, stdout: JSON.stringify({ status: 'delivered', to: 'receiver', turn: 2, replyRef: conversation }), stderr: '' };
      }),
    };
    await sendMessage({ tool: 'claude', conversation, via: 'ssh:fixture', bodyArg: 'typed continuation' }, dependencies);
    expect(sentOrigin).toBeDefined();
    expect(decodeOriginIdentity(sentOrigin!)).toMatchObject({ p: 'codex', id: cliId });
    expect(decodeOriginIdentity(sentOrigin!)).not.toHaveProperty('endpointType');
  });

  it('never queries destination-local native candidates to validate a remote typed origin', async () => {
    const scan = { sessions: [{ pid: 11, sessionId: 'claude-receiver', kind: 'interactive', name: 'Receiver', status: 'idle', messagingSocketPath: 'fixture-socket' }], malformed: 0 };
    const dependencies = { ...deps(), listClaudeSessions: () => scan,
      listCodexThreads: vi.fn(async () => { throw new Error('remote sender is not a local candidate'); }),
    };
    const conversation = encodeRef(newConversationRef({ p: 'codex', id: cliId, endpointType: 'cli' }, { p: 'claude', id: 'claude-receiver', endpointType: 'cli' }));
    const origin = encodeOrigin({ p: 'codex', id: cliId, endpointType: 'cli' }, 'remote-node', 'remote-mid');
    await sendMessage({ tool: 'claude', conversation, origin, bodyArg: 'typed arrival' }, dependencies);
    expect(dependencies.listCodexThreads).not.toHaveBeenCalled();
    expect(dependencies.deliverClaude).toHaveBeenCalledOnce();
  });

  it('keeps the Harness type independent from the copyable full sender ID', async () => {
    const scan = { sessions: [{ pid: 11, sessionId: 'claude-receiver', kind: 'interactive', name: 'Receiver', status: 'idle', messagingSocketPath: 'fixture-socket' }], malformed: 0 };
    const dependencies = { ...deps(), listClaudeSessions: () => scan, fromMachine: 'remote-node', fromStarName: 'fixture-star' };
    const origin = encodeOrigin({ p: 'dsh', id: 'session-same', endpointType: 'host' }, 'remote-node', 'remote-mid', 'tcp');
    await sendMessage({ tool: 'claude', to: 'Receiver', origin, bodyArg: 'typed arrival' }, dependencies);
    expect(dependencies.deliverClaude).toHaveBeenCalledWith(expect.anything(),
      expect.stringContaining('from-addr="tcp:fixture-star:remote-node:session-same"'), expect.anything());
  });

  it('permits a native-ID-matched Harness reply without listing source endpoints', async () => {
    const scan = { sessions: [{ pid: 11, sessionId: 'claude-receiver', kind: 'interactive', name: 'Receiver', status: 'idle', messagingSocketPath: 'fixture-socket' }], malformed: 0 };
    const listDshThreads = vi.fn(async () => ['host', 'desktop'].map((endpointType) => ({
      id: 'session-same', name: null, endpointType, cwd: '/fixture', rawStatus: { type: 'idle' as const }, attributes: {},
    })));
    const dependencies = { ...deps(), env: { DSH_SESSION_ID: 'session-same' }, listClaudeSessions: () => scan, listDshThreads };
    const conversation = encodeRef(newConversationRef({ p: 'dsh', id: 'session-same', endpointType: 'host' }, { p: 'claude', id: 'claude-receiver' }));
    await sendMessage({ tool: 'claude', conversation, bodyArg: 'typed continuation' }, dependencies);
    expect(listDshThreads).not.toHaveBeenCalled();
    expect(dependencies.deliverClaude).toHaveBeenCalledOnce();
  });

  it('resolves an explicitly selected CLI target even when Desktop fills the legacy first twenty entries', async () => {
    const session = cli();
    const listMetadata = vi.fn(async () => ({ data: Array.from({ length: 20 }, (_, index) => ({
      id: `desktop-${index}`, name: `Desktop ${index}`, cwd: '/fixture', source: 'vscode', originator: 'Codex Desktop', createdAtMs: 1, updatedAtMs: 2, recencyAtMs: 3,
    })), nextCursor: null, completeness: 'complete' as const, observedAt: 1 }));
    const discovery = { sessionFactory: async () => session, codexHome: root,
      desktop: { listMetadata, openThread: async (id: string) => desktop(id) } };
    const dependencies = { ...deps(),
      listCodexThreads: (selected?: { endpointType?: string; complete?: boolean }) => listCodexThreads({ ...discovery, ...selected }),
    };
    await sendMessage({ tool: 'codex-cli', to: 'CLI target', bodyArg: 'one input' }, dependencies);
    expect(dependencies.deliverCodex).toHaveBeenCalledWith(cliId, expect.any(String), { mode: 'queue', endpointType: 'cli' });
    expect(listMetadata).not.toHaveBeenCalled();
  });

  it('does not deliver a new reply through an unverified Codex domain when the sender ID is live in both domains', async () => {
    const scan = { sessions: [{ pid: 11, sessionId: 'claude-receiver', kind: 'interactive', name: 'Receiver', status: 'idle', messagingSocketPath: 'fixture-socket' }], malformed: 0 };
    const dependencies = { ...deps(), env: { CODEX_THREAD_ID: cliId }, listClaudeSessions: () => scan,
      listCodexThreads: async () => [
        { id: cliId, name: 'CLI', status: 'idle' as const, endpointType: 'cli' },
        { id: cliId, name: 'Desktop', status: 'idle' as const, endpointType: 'desktop' },
      ],
    };
    const sent = await sendMessage({ tool: 'claude', to: 'Receiver', bodyArg: 'from native Codex shell' }, dependencies);
    expect(decodeRef(sent.receipt.replyRef).f).toEqual({ p: 'codex', id: cliId });
    await expect(sendMessage({ conversation: sent.receipt.replyRef, bodyArg: 'reply' }, {
      ...dependencies, env: { CLAUDE_CODE_MESSAGING_SOCKET: 'fixture-socket' },
    })).rejects.toMatchObject({ code: 'USAGE' });
    expect(dependencies.deliverCodex).not.toHaveBeenCalled();

    const reply = await sendMessage({ tool: 'codex-cli', conversation: sent.receipt.replyRef, bodyArg: 'reply' }, {
      ...dependencies, env: { CLAUDE_CODE_MESSAGING_SOCKET: 'fixture-socket' },
    });
    expect(dependencies.deliverCodex).toHaveBeenCalledOnce();
    expect(dependencies.deliverCodex).toHaveBeenCalledWith(cliId, expect.any(String), { mode: 'queue', endpointType: 'cli' });
    expect(decodeRef(reply.receipt.replyRef).f).toEqual({ p: 'codex', id: cliId, endpointType: 'cli' });
  });
});

describe('complete native Codex selection', () => {
  it('pages all CLI targets for a strict selection while the legacy list remains capped', async () => {
    const session = cli();
    const rows = Array.from({ length: 21 }, (_, index) => ({ id: `cli-${index}`, name: `CLI ${index}`, status: 'idle' as const }));
    session.listThreads = vi.fn(async () => rows.slice(0, 20));
    session.listThreadPage = vi.fn(async ({ cursor }) => ({
      data: (cursor === undefined ? rows.slice(0, 20) : rows.slice(20)).map((row) => ({ ...row, rawStatus: { type: 'idle' }, attributes: {} })),
      nextCursor: cursor === undefined ? 'second-page' : null,
    }));
    const options = { sessionFactory: async () => session, codexHome: root, endpointType: 'cli', complete: true };
    expect((await listCodexThreads(options)).map((row) => row.id)).toEqual(rows.map((row) => row.id));
    expect(session.listThreads).not.toHaveBeenCalled();
    expect(session.listThreadPage).toHaveBeenCalledTimes(2);
    expect((await listCodexThreads({ ...options, complete: false })).map((row) => row.id)).toEqual(rows.slice(0, 20).map((row) => row.id));
    expect(session.listThreads).toHaveBeenCalledOnce();
  });

  it('refuses to claim a complete selection from a legacy-only native reader', async () => {
    const session = cli();
    delete session.listThreadPage;
    const options = { sessionFactory: async () => session, codexHome: root, endpointType: 'cli', complete: true };
    await expect(listCodexThreads(options)).rejects.toMatchObject({ code: 'CODEX_DISCOVERY_INCOMPLETE' });
  });

  it('retains a terminal source failure instead of resolving names from an incomplete typed list', async () => {
    const session = cli();
    session.listThreadPage = vi.fn(async ({ cursor }) => {
      if (cursor !== undefined) throw new Error('second page unavailable');
      return { data: [{ id: cliId, name: 'first visible name', rawStatus: { type: 'idle' }, attributes: {} }], nextCursor: 'unread-tail' };
    });
    const options = { sessionFactory: async () => session, codexHome: root, endpointType: 'cli', complete: true };
    await expect(listCodexThreads(options)).rejects.toMatchObject({ code: 'CODEX_DISCOVERY_INCOMPLETE' });
  });
});
