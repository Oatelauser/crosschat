import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendMessage } from '../src/application/send/index.js';
import type { SendDeps } from '../src/application/send/types.js';
import { decodeRef } from '../src/ref.js';
import { resolveTargetByName } from '../src/resolve.js';
import { MultichatError } from '../src/errors.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'crosschat-opencode-send-')); roots.push(root);
  const deliverOpenCode = vi.fn(async () => ({ status: 'accepted' as const, messageId: 'msg_one', queued: false }));
  const deps = {
    env: {}, listClaudeSessions: () => ({ sessions: [], skipped: 0 }),
    listCodexThreads: async () => [],
    listOpenCodeThreads: async () => [{ id: 'ses_one', name: 'reviewer', cwd: root, rawStatus: 'inactive', attributes: {} }],
    deliverClaude: vi.fn(async () => ({ status: 'delivered' as const })),
    deliverCodex: vi.fn(async () => ({ status: 'accepted' as const, turnId: 'unused' })),
    deliverOpenCode, sendLogFile: join(root, 'send-log.jsonl'), outboxDir: join(root, 'outbox'), now: () => 100,
  } satisfies SendDeps & { listOpenCodeThreads: () => Promise<unknown[]>; deliverOpenCode: typeof deliverOpenCode };
  return { deps, deliverOpenCode };
}

describe('OpenCode communication through the application seam', () => {
  it('addresses an opaque native ID and delivers a real envelope through the new adapter', async () => {
    const { deps, deliverOpenCode } = fixture();
    const result = await sendMessage({ to: 'ses_one', tool: 'opencode', bodyArg: 'Review these changes', delivery: 'steer' }, deps);
    expect(deliverOpenCode).toHaveBeenCalledWith('ses_one', expect.stringContaining('Review these changes'), { mode: 'steer', endpointType: 'shared' });
    expect(deliverOpenCode).toHaveBeenCalledTimes(1);
    expect(deps.deliverCodex).not.toHaveBeenCalled();
    expect(decodeRef(result.receipt.replyRef).t).toEqual({ p: 'opencode', id: 'ses_one', endpointType: 'shared' });
    expect(result.status).toBe('delivered');
  });

  it('retains OpenCode caller identity and independently chooses queue for its reply', async () => {
    const { deps, deliverOpenCode } = fixture();
    deps.env = { OPENCODE_SESSION_ID: 'ses_sender' };
    const first = await sendMessage({ to: 'reviewer', tool: 'opencode', bodyArg: 'question', delivery: 'steer' }, deps);
    const ref = decodeRef(first.receipt.replyRef);
    expect(ref.f).toEqual({ p: 'opencode', id: 'ses_sender' });
    deps.env = { OPENCODE_SESSION_ID: 'ses_one' };
    deps.listOpenCodeThreads = async () => [{ id: 'ses_sender', name: 'sender', cwd: '', rawStatus: 'inactive', attributes: {} }];
    await sendMessage({ conversation: first.receipt.replyRef, tool: 'opencode', bodyArg: 'answer' }, deps);
    expect(deliverOpenCode).toHaveBeenLastCalledWith('ses_sender', expect.stringContaining('answer'), { mode: 'queue', endpointType: 'shared' });
  });

  it('reports a durable native queue without sending it into the Codex outbox', async () => {
    const { deps, deliverOpenCode } = fixture();
    deliverOpenCode.mockResolvedValue({ status: 'accepted', messageId: 'msg_one', queued: true });
    const result = await sendMessage({ to: 'reviewer', tool: 'opencode', bodyArg: 'later' }, deps);
    expect(result.status).toBe('queued');
    expect(result.receipt.queued).toBe(true);
  });

  it('does not repeat an uncertain native write', async () => {
    const { deps, deliverOpenCode } = fixture();
    deliverOpenCode.mockRejectedValue(new Error('uncertain write'));
    await expect(sendMessage({ to: 'reviewer', tool: 'opencode', bodyArg: 'once' }, deps)).rejects.toThrow('uncertain write');
    expect(deliverOpenCode).toHaveBeenCalledTimes(1);
  });
  it('explains a configured OpenCode outage for its selected target type', async () => {
    const { deps, deliverOpenCode } = fixture();
    deps.listOpenCodeThreads = async () => { throw new MultichatError('OPENCODE_AUTH_REQUIRED', 'Service authentication rejected.'); };
    await expect(sendMessage({ to: 'ses_one', tool: 'opencode', bodyArg: 'once' }, deps)).rejects.toMatchObject({ code: 'OPENCODE_AUTH_REQUIRED' });
    expect(deliverOpenCode).not.toHaveBeenCalled();
  });
  it('does not replace a missing OpenCode target with an unrelated Codex diagnosis', async () => {
    const { deps } = fixture();
    const diagnoseCodexTarget = vi.fn(async () => ({ kind: 'unavailable' as const, code: 'CODEX_UNAVAILABLE', message: 'Codex is unavailable.' }));
    await expect(sendMessage({ to: 'ses_missing', tool: 'opencode', bodyArg: 'once' }, { ...deps, diagnoseCodexTarget })).rejects.toMatchObject({ code: 'NAME_NOT_FOUND' });
    expect(diagnoseCodexTarget).not.toHaveBeenCalled();
  });
});

describe('OpenCode explicitly selected addressing', () => {
  const selected = { providerId: 'opencode', endpointType: 'shared' };
  it('resolves an explicit tool type and opaque ID', () => {
    expect(resolveTargetByName('ses_one', [], [], [{ id: 'ses_one', name: 'reviewer' }], [], selected)).toEqual({ side: 'opencode', thread: { id: 'ses_one', name: 'reviewer' } });
  });
  it('does not silently choose OpenCode when an exact name exists in another tool', () => {
    expect(() => resolveTargetByName('reviewer', [{ sessionId: 'claude_one', name: 'reviewer' }], [], [{ id: 'ses_one', name: 'reviewer' }])).toThrow(/reviewer/);
  });
  it('makes a selected full native ID authoritative over a different session title', () => {
    expect(resolveTargetByName('ses_one', [], [], [{ id: 'ses_one', name: 'reviewer' }, { id: 'ses_two', name: 'ses_one' }], [], selected)).toMatchObject({ side: 'opencode', thread: { id: 'ses_one' } });
  });
});
