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
    const result = await sendMessage({ to: 'opencode/ses_one', bodyArg: 'Review these changes', delivery: 'steer' }, deps);
    expect(deliverOpenCode).toHaveBeenCalledWith('ses_one', expect.stringContaining('Review these changes'), { mode: 'steer' });
    expect(deliverOpenCode).toHaveBeenCalledTimes(1);
    expect(deps.deliverCodex).not.toHaveBeenCalled();
    expect(decodeRef(result.receipt.replyRef).t).toEqual({ p: 'opencode', id: 'ses_one' });
    expect(result.status).toBe('delivered');
  });

  it('retains OpenCode caller identity and independently chooses queue for its reply', async () => {
    const { deps, deliverOpenCode } = fixture();
    deps.env = { OPENCODE_SESSION_ID: 'ses_sender' };
    const first = await sendMessage({ to: 'reviewer', bodyArg: 'question', delivery: 'steer' }, deps);
    const ref = decodeRef(first.receipt.replyRef);
    expect(ref.f).toEqual({ p: 'opencode', id: 'ses_sender' });
    deps.env = { OPENCODE_SESSION_ID: 'ses_one' };
    await sendMessage({ conversation: first.receipt.replyRef, bodyArg: 'answer' }, deps);
    expect(deliverOpenCode).toHaveBeenLastCalledWith('ses_sender', expect.stringContaining('answer'), { mode: 'queue' });
  });

  it('reports a durable native queue without sending it into the Codex outbox', async () => {
    const { deps, deliverOpenCode } = fixture();
    deliverOpenCode.mockResolvedValue({ status: 'accepted', messageId: 'msg_one', queued: true });
    const result = await sendMessage({ to: 'opencode/reviewer', bodyArg: 'later' }, deps);
    expect(result.status).toBe('queued');
    expect(result.receipt.queued).toBe(true);
  });

  it('does not repeat an uncertain native write', async () => {
    const { deps, deliverOpenCode } = fixture();
    deliverOpenCode.mockRejectedValue(new Error('uncertain write'));
    await expect(sendMessage({ to: 'opencode/reviewer', bodyArg: 'once' }, deps)).rejects.toThrow('uncertain write');
    expect(deliverOpenCode).toHaveBeenCalledTimes(1);
  });
  it('explains a configured OpenCode outage for its qualified target', async () => {
    const { deps, deliverOpenCode } = fixture();
    deps.listOpenCodeThreads = async () => { throw new MultichatError('OPENCODE_AUTH_REQUIRED', 'Service authentication rejected.'); };
    await expect(sendMessage({ to: 'opencode/ses_one', bodyArg: 'once' }, deps)).rejects.toMatchObject({ code: 'OPENCODE_AUTH_REQUIRED' });
    expect(deliverOpenCode).not.toHaveBeenCalled();
  });
});

describe('OpenCode qualified addressing', () => {
  it('resolves an explicit tool qualifier and opaque ID', () => {
    expect(resolveTargetByName('opencode/ses_one', [], [], [{ id: 'ses_one', name: 'reviewer' }])).toEqual({ side: 'opencode', thread: { id: 'ses_one', name: 'reviewer' } });
  });
  it('does not silently choose OpenCode when an exact name exists in another tool', () => {
    expect(() => resolveTargetByName('reviewer', [{ sessionId: 'claude_one', name: 'reviewer' }], [], [{ id: 'ses_one', name: 'reviewer' }])).toThrow(/reviewer/);
  });
  it('makes a qualified full native ID authoritative over a different session title', () => {
    expect(resolveTargetByName('opencode/ses_one', [], [], [{ id: 'ses_one', name: 'reviewer' }, { id: 'ses_two', name: 'ses_one' }])).toMatchObject({ side: 'opencode', thread: { id: 'ses_one' } });
  });
});
