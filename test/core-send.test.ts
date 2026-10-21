import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { MultichatError } from '../src/errors.js';
import type { SendDeps } from '../src/commands/send.js';
import { deliverViaRunSend } from '../src/serve/node.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-typed-send-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
function deps(queued = false): SendDeps {
  return {
    env: {},
    listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
    listCodexThreads: async () => [{ id: '01234567-0000-4000-8000-000000000000', name: 'worker', status: 'idle' }],
    deliverClaude: async () => ({ status: 'delivered' }),
    deliverCodex: async () => ({ status: 'accepted', turnId: 'turn-1', queued }),
    confirmReceipt: async () => 'unconfirmed',
    sendLogFile: join(root, 'send-log.jsonl'), outboxDir: join(root, 'outbox'), now: () => 10_000,
  };
}

describe('typed send application', () => {
  it('returns actual queue state without exposing presentation serialization to the core caller', async () => {
    const { sendMessage } = await import('../src/application/send/index.js');
    const { formatSendResult } = await import('../src/application/send/format.js');
    const probe = vi.fn(async () => 'confirmed' as const);
    const result = await sendMessage({ to: 'worker', bodyArg: 'test' }, { ...deps(true), confirmReceipt: probe });
    expect(result.status).toBe('queued');
    expect(result.receipt).toMatchObject({ status: 'delivered', queued: true, to: 'worker', turn: 1 });
    expect(probe).not.toHaveBeenCalled();
    const json = JSON.parse(formatSendResult(result, true));
    expect(json).toEqual({ status: 'delivered', queued: true, to: 'worker', turn: 1, replyRef: result.receipt.replyRef });
    expect(formatSendResult(result)).toContain('已入对方服务端队列');
  });

  it('keeps unconfirmed receipt evidence separate from legacy JSON and releases no delivery ownership', async () => {
    const { sendMessage } = await import('../src/application/send/index.js');
    const { formatSendResult } = await import('../src/application/send/format.js');
    const result = await sendMessage({ to: 'worker', bodyArg: 'test' }, deps());
    expect(result).toMatchObject({ status: 'delivered', confirmation: 'unconfirmed' });
    expect(formatSendResult(result)).toContain('回执: 暂未在对方会话记录中确认');
    expect(JSON.parse(formatSendResult(result, true))).not.toHaveProperty('confirmation');
  });

  it('maps typed receipt into the unchanged TCP result fields and preserves error codes', async () => {
    const { sendMessage } = await import('../src/application/send/index.js');
    expect(sendMessage).toBeTypeOf('function');
    const result = await deliverViaRunSend({ op: 'deliver', id: 'wire-1', to: 'worker', payload: 'test', origin: undefined }, deps(true));
    expect(result).toMatchObject({ op: 'result', id: 'wire-1', status: 'delivered', turn: '1' });
    expect(JSON.parse(result.output ?? '')).toMatchObject({ status: 'delivered', queued: true });
    const failure = await deliverViaRunSend({ op: 'deliver', id: 'wire-2', to: 'worker', payload: 'test', origin: undefined }, {
      ...deps(), deliverCodex: async () => { throw new MultichatError('CODEX_APPROVAL_REQUIRED', 'needs native approval'); },
    });
    expect(failure).toMatchObject({ status: 'error', code: 'CODEX_APPROVAL_REQUIRED', message: 'needs native approval' });
  });

  it('exposes structured SSH metadata while preserving the remote JSON contract', async () => {
    const { sendMessage } = await import('../src/application/send/index.js');
    const { formatSendResult } = await import('../src/application/send/format.js');
    const result = await sendMessage({ to: 'worker', bodyArg: 'test', via: 'ssh:fixture' }, {
      ...deps(), sshExec: async () => ({ code: 0, stdout: JSON.stringify({ status: 'queued', to: 'worker', turn: 7, replyRef: 'legacy-ref', extra: 'keep' }), stderr: '' }),
    });
    expect(result).toMatchObject({ status: 'queued', receipt: { turn: 7, via: 'ssh:fixture', extra: 'keep' } });
    expect(JSON.parse(formatSendResult(result, true))).toEqual({ status: 'queued', to: 'worker', turn: 7, replyRef: 'legacy-ref', extra: 'keep', via: 'ssh:fixture' });
    expect(formatSendResult(result)).toContain('queued to worker@fixture');
  });
});
