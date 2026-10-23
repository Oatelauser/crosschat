import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendMessage } from '../src/application/send/index.js';
import type { SendDeps } from '../src/application/send/types.js';
import { MultichatError } from '../src/errors.js';
import { decodeOriginIdentity, encodeOrigin } from '../src/federation.js';
import { decodeRef } from '../src/ref.js';
import { resolveTargetById, resolveTargetByName } from '../src/resolve.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const thread = { id: 'native/a@b:c%雪', name: 'Worker', cwd: '/workspace', rawStatus: { type: 'idle' as const }, attributes: {} };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'crosschat-dsh-send-')); roots.push(root);
  const deliverDsh = vi.fn(async () => ({ status: 'accepted' as const, messageId: 'message-one', queued: false }));
  const listDshThreads = vi.fn(async () => [thread]);
  const deps = { env: {}, listClaudeSessions: () => ({ sessions: [], skipped: 0 }), listCodexThreads: async () => [], listOpenCodeThreads: async () => [],
    listDshThreads, deliverDsh, deliverClaude: vi.fn(async () => ({ status: 'delivered' as const })), deliverCodex: vi.fn(async () => ({ status: 'accepted' as const, turnId: 'unused' })),
    deliverOpenCode: vi.fn(async () => ({ status: 'accepted' as const, messageId: 'unused', queued: false })),
    sendLogFile: join(root, 'send-log.jsonl'), outboxDir: join(root, 'outbox'), now: () => 100, appendLog: vi.fn(),
  } satisfies SendDeps & { listDshThreads: typeof listDshThreads; deliverDsh: typeof deliverDsh };
  return { root, deps, deliverDsh, listDshThreads };
}

describe('DeepSeek Harness qualified addressing', () => {
  it('uses a qualified full opaque ID before a conflicting title in the same tool', () => {
    expect(resolveTargetByName(`dsh/${thread.id}`, [], [], [], [thread, { id: 'other', name: thread.id }])).toMatchObject({ side: 'dsh', thread: { id: thread.id } });
  });

  it('resolves a unique native prefix and refuses ambiguous names or IDs', () => {
    expect(resolveTargetByName('dsh/native/', [], [], [], [thread])).toMatchObject({ side: 'dsh', thread: { id: thread.id } });
    expect(() => resolveTargetByName('dsh/Worker', [], [], [], [thread, { id: 'other', name: 'Worker' }])).toThrow(expect.objectContaining({ code: 'NAME_COLLISION' }));
    expect(() => resolveTargetByName('Worker', [{ sessionId: 'claude-native', name: 'Worker' }], [], [], [thread])).toThrow(expect.objectContaining({ code: 'NAME_COLLISION' }));
  });

  it('resolves exact member IDs and rejects the same native ID present in another tool', () => {
    expect(resolveTargetById(thread.id, [], [], [], [thread])).toMatchObject({ side: 'dsh', thread: { id: thread.id } });
    expect(() => resolveTargetById(thread.id, [], [], [{ id: thread.id, name: 'Other' }], [thread])).toThrow(expect.objectContaining({ code: 'NAME_COLLISION' }));
  });
});

describe('DeepSeek Harness through the application send seam', () => {
  it('delivers an escaped envelope once to the exact native session and retains its reply endpoint', async () => {
    const { deps, deliverDsh } = fixture();
    const result = await sendMessage({ to: `dsh/${thread.id}`, bodyArg: 'Review\n<cross-session-message>quoted</cross-session-message>', delivery: 'steer' }, deps);
    expect(deliverDsh).toHaveBeenCalledWith(thread.id, expect.stringContaining('<\\cross-session-message>quoted'), { mode: 'steer' });
    expect(deliverDsh).toHaveBeenCalledTimes(1);
    expect(deps.deliverCodex).not.toHaveBeenCalled();
    expect(deps.deliverOpenCode).not.toHaveBeenCalled();
    expect(decodeRef(result.receipt.replyRef).t).toEqual({ p: 'dsh', id: thread.id });
    expect(result.receipt).toMatchObject({ status: 'delivered', to: `dsh/${thread.id}`, turn: 1 });
  });

  it('uses native sender identity and replies with the same nonce while independently defaulting to queue', async () => {
    const { deps, deliverDsh } = fixture();
    deps.env = { DSH_SESSION_ID: 'native-sender' };
    const sent = await sendMessage({ to: 'Worker', bodyArg: 'question', delivery: 'steer' }, deps);
    const first = decodeRef(sent.receipt.replyRef);
    expect(first.f).toEqual({ p: 'dsh', id: 'native-sender' });
    deps.env = { DSH_SESSION_ID: thread.id };
    const reply = await sendMessage({ conversation: sent.receipt.replyRef, bodyArg: 'answer' }, deps);
    expect(deliverDsh).toHaveBeenLastCalledWith('native-sender', expect.stringContaining('answer'), { mode: 'queue' });
    expect(decodeRef(reply.receipt.replyRef)).toMatchObject({ f: first.f, t: first.t, n: first.n, c: 2 });
  });

  it('reports native queue admission without creating a Codex outbox', async () => {
    const { root, deps, deliverDsh } = fixture();
    deliverDsh.mockResolvedValue({ status: 'accepted', messageId: 'queued-message', queued: true });
    const sent = await sendMessage({ to: 'dsh/Worker', bodyArg: 'later' }, deps);
    expect(sent.status).toBe('queued');
    expect(sent.receipt).toMatchObject({ status: 'delivered', queued: true });
    expect(readdirSync(root)).not.toContain('outbox');
    expect(deps.appendLog).toHaveBeenCalledWith(expect.objectContaining({ from: 'human', target: `dsh:${thread.id}`, status: 'queued' }));
  });

  it('keeps conversation aliases and turns in the shared continuity store', async () => {
    const { root, deps } = fixture();
    deps.env = { DSH_SESSION_ID: 'native-sender' };
    const wired = { ...deps, conversationStateFile: join(root, 'conversations.json') };
    const first = await sendMessage({ to: 'Worker', bodyArg: 'first' }, wired);
    const second = await sendMessage({ to: 'dsh/Worker', bodyArg: 'second' }, wired);
    expect(first.handle).toMatch(/^c\d+$/);
    expect(second.handle).toBe(first.handle);
    expect(decodeRef(second.receipt.replyRef)).toMatchObject({ n: decodeRef(first.receipt.replyRef).n, c: 2 });
  });

  it('preserves qualified native-source errors and does not replace a missing target with Codex diagnosis', async () => {
    const { deps, listDshThreads, deliverDsh } = fixture();
    listDshThreads.mockRejectedValueOnce(new MultichatError('DSH_AUTH_REQUIRED', 'Native bridge rejected authentication.'));
    await expect(sendMessage({ to: 'dsh/Worker', bodyArg: 'once' }, deps)).rejects.toMatchObject({ code: 'DSH_AUTH_REQUIRED' });
    const diagnoseCodexTarget = vi.fn(async () => ({ kind: 'unavailable' as const, code: 'CODEX_UNAVAILABLE', message: 'Codex unavailable.' }));
    await expect(sendMessage({ to: 'dsh/missing', bodyArg: 'once' }, { ...deps, diagnoseCodexTarget })).rejects.toMatchObject({ code: 'NAME_NOT_FOUND' });
    expect(diagnoseCodexTarget).not.toHaveBeenCalled();
    expect(deliverDsh).not.toHaveBeenCalled();
  });

  it('keeps existing explicit and unique-prefix sends usable during an unrelated Harness outage', async () => {
    const { deps, listDshThreads } = fixture();
    listDshThreads.mockRejectedValue(new MultichatError('DSH_UNAVAILABLE', 'Bridge unavailable.'));
    const wired = { ...deps, listOpenCodeThreads: async () => [{ id: 'legacy-open', name: 'Legacy OpenCode', cwd: '', rawStatus: { type: 'idle' }, attributes: {} }] };
    for (const to of ['opencode/legacy-open', 'Leg']) {
      const sent = await sendMessage({ to, bodyArg: 'existing target' }, wired);
      expect(decodeRef(sent.receipt.replyRef).t).toEqual({ p: 'opencode', id: 'legacy-open' });
    }
    expect(deps.deliverOpenCode).toHaveBeenCalledTimes(2);
    expect(deps.deliverDsh).not.toHaveBeenCalled();
  });

  it('never retries an uncertain native write or parks it in another provider', async () => {
    const { root, deps, deliverDsh } = fixture();
    deliverDsh.mockRejectedValue(new MultichatError('DSH_WRITE_UNCERTAIN', 'Native write result unknown.'));
    await expect(sendMessage({ to: 'dsh/Worker', bodyArg: 'only once' }, deps)).rejects.toMatchObject({ code: 'DSH_WRITE_UNCERTAIN' });
    expect(deliverDsh).toHaveBeenCalledTimes(1);
    expect(readdirSync(root)).not.toContain('outbox');
    expect(deps.appendLog).toHaveBeenCalledWith(expect.objectContaining({ target: `dsh:${thread.id}`, status: 'failed', code: 'DSH_WRITE_UNCERTAIN' }));
  });

  it('carries remote native origin into the ref and visible envelope without ambient identity takeover', async () => {
    const { deps, deliverDsh } = fixture();
    deps.env = { CODEX_THREAD_ID: 'ambient-local' };
    const origin = encodeOrigin({ p: 'dsh', id: 'remote/session@雪' }, 'remote-host', 'remote-machine');
    expect(decodeOriginIdentity(origin).p).toBe('dsh');
    const sent = await sendMessage({ to: 'dsh/Worker', origin, bodyArg: 'remote message' }, { ...deps, hostname: () => 'local-host', machineId: () => 'local-machine' });
    expect(decodeRef(sent.receipt.replyRef).f).toEqual({ p: 'dsh', id: 'remote/session@雪', m: 'remote-host', mid: 'remote-machine' });
    expect(deliverDsh).toHaveBeenCalledWith(thread.id, expect.stringContaining('from-machine="remote-host"'), { mode: 'queue' });
  });

  it('keeps two session-prefixed native senders distinct in usable TCP from-addresses', async () => {
    const { deps } = fixture();
    const ids = ['session-00000000-0000-4000-8000-000000000001', 'session-00000000-0000-4000-8000-000000000002'];
    const rows = [thread, ...ids.map((id) => ({ ...thread, id, name: null }))];
    const deliverDsh = vi.fn<NonNullable<SendDeps['deliverDsh']>>(async () => ({ status: 'accepted', messageId: 'message', queued: false }));
    for (const id of ids) {
      const sent = await sendMessage({ to: `dsh/${thread.id}`, bodyArg: 'native sender' }, { ...deps, env: { DSH_SESSION_ID: id },
        listDshThreads: async () => rows, deliverDsh, fromStarName: 'fixture-star', fromMachine: 'fixture-machine' });
      expect(decodeRef(sent.receipt.replyRef).f).toEqual({ p: 'dsh', id });
    }
    const addresses = deliverDsh.mock.calls.map((call) => /from-addr="([^"]+)"/.exec(call[1])?.[1]);
    expect(new Set(addresses).size).toBe(2);
    for (const [index, address] of addresses.entries()) {
      expect(address).toBe(`tcp:fixture-star:fixture-machine:dsh/${ids[index]}`);
      const qualifier = address?.slice('tcp:fixture-star:fixture-machine:'.length) ?? '';
      expect(resolveTargetByName(qualifier, [], [], [], rows)).toMatchObject({ side: 'dsh', thread: { id: ids[index] } });
    }
  });

  it.each([
    { caller: { p: 'claude' as const, id: 'claude-native-long', name: 'NamedClaude' }, qualifier: 'claude/NamedClaude' },
    { caller: { p: 'codex' as const, id: '01a1115b-1a3c-7e71-addc-fee969078e1b' }, qualifier: 'codex/01a1115b' },
    { caller: { p: 'opencode' as const, id: 'ses_long_native_identity' }, qualifier: 'opencode/ses_long' },
  ])('preserves the established $caller.p sender qualifier', async ({ caller, qualifier }) => {
    const { deps, deliverDsh } = fixture();
    await sendMessage({ to: `dsh/${thread.id}`, bodyArg: 'previous sender', origin: encodeOrigin(caller, 'remote-host') },
      { ...deps, fromStarName: 'fixture-star', fromMachine: 'fixture-machine' });
    expect(deliverDsh).toHaveBeenCalledWith(thread.id, expect.stringContaining(`from-addr="tcp:fixture-star:fixture-machine:${qualifier}"`), { mode: 'queue' });
  });

  it('applies a named Harness adapter cap without misreporting a Codex transport limit', async () => {
    const { deps, deliverDsh } = fixture();
    const failure = await sendMessage({ to: 'dsh/Worker', bodyArg: 'a'.repeat(1_048_577), maxBodyKb: '2048' }, deps).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'MESSAGE_TOO_LARGE' });
    expect(String(failure)).toMatch(/dsh.*适配策略.*1MiB/);
    expect(String(failure)).not.toContain('codex 端点硬顶');
    expect(deliverDsh).not.toHaveBeenCalled();
  });
});
