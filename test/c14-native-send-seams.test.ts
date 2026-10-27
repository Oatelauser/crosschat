import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sendMessage } from '../src/application/send/index.js';
import type { SendDeps } from '../src/application/send/types.js';
import { listCodexThreads } from '../src/codex/discovery.js';
import type { CodexSession } from '../src/codex/client.js';
import type { DesktopThreadSession } from '../src/codex/desktop-ipc.js';
import { decodeRef } from '../src/ref.js';

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
    })).rejects.toMatchObject({ code: 'TARGET_TYPE_REQUIRED' });
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
