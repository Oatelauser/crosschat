import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES, runSend, type SendArgs, type SendDeps } from '../src/commands/send.js';
import { decodeRef, encodeRef, newConversationRef } from '../src/ref.js';
import { MultichatError } from '../src/errors.js';
import type { ClaudeRegistryScan, ClaudeSessionEntry } from '../src/claude/registry.js';
import type { CodexThreadSummary } from '../src/codex/client.js';

const sessions: ClaudeSessionEntry[] = [
  {
    pid: 101,
    sessionId: 'cs-alpha',
    kind: 'interactive',
    name: 'alpha',
    status: 'idle',
    messagingSocketPath: 'sock-alpha',
  },
  {
    pid: 102,
    sessionId: 'cs-beta',
    kind: 'bg',
    name: 'beta',
    status: 'busy',
    messagingSocketPath: 'sock-beta',
  },
];
const scan: ClaudeRegistryScan = { sessions, malformed: 0 };
const threads: CodexThreadSummary[] = [
  { id: 'team1111-aaaa', name: 'workteam', status: 'idle' },
  { id: 'other222-bbbb', name: null, status: 'idle' },
];

const rateDir = mkdtempSync(join(tmpdir(), 'multichat-send-'));
afterAll(() => rmSync(rateDir, { recursive: true, force: true }));

const claudeDeliveries: { pid: number; content: string }[] = [];
const codexDeliveries: { threadId: string; content: string }[] = [];

// All tests share one rateDir and a frozen clock: buckets persist across calls
// exactly like real consecutive CLI invocations would.
function makeDeps(env: Record<string, string | undefined> = {}, stdinText?: string): SendDeps {
  return {
    env,
    stdinText,
    listClaudeSessions: () => scan,
    listCodexThreads: async () => threads,
    deliverClaude: async (target, content) => {
      claudeDeliveries.push({ pid: target.pid, content });
      return { status: 'delivered' };
    },
    deliverCodex: async (threadId, content) => {
      codexDeliveries.push({ threadId, content });
      return { status: 'accepted', turnId: 'turn-1' };
    },
    rateDir,
    now: () => 9_000_000,
  };
}

const send = (args: SendArgs, env: Record<string, string | undefined> = {}, stdinText?: string) =>
  runSend(args, makeDeps(env, stdinText));

async function expectCode(promise: Promise<unknown>, code: string): Promise<MultichatError> {
  try {
    await promise;
    expect.unreachable(`should have thrown ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(MultichatError);
    const me = err as MultichatError;
    expect(me.code).toBe(code);
    return me;
  }
}

const REF_RE = /mc1_[A-Za-z0-9_-]+/;

describe('runSend happy paths', () => {
  it('delivers to a claude session by name and returns a usable reply ref', async () => {
    const out = await send({ to: 'alpha', bodyArg: 'hello world' });
    expect(out).toContain('delivered to alpha (turn 1)');
    const ref = decodeRef(out.match(REF_RE)![0]);
    expect(ref.f).toEqual({ p: 'human' });
    expect(ref.t).toEqual({ p: 'claude', id: 'cs-alpha' });
    expect(ref.c).toBe(1);
    expect(claudeDeliveries.at(-1)?.pid).toBe(101);
    const content = claudeDeliveries.at(-1)!.content;
    expect(content.startsWith('<cross-session-message from-name="human" turn="1">')).toBe(true);
    expect(content).toContain('<multichat-reply-hint conversation="mc1_');
    expect(content).toContain('reply-as="alpha"');
    expect(content).toContain('multichat send --conversation mc1_');
    expect(content).toContain('hello world');
    expect(content.endsWith('</cross-session-message>')).toBe(true);
  });

  it('delivers to a codex thread and names the sender from env identity', async () => {
    const out = await send(
      { to: 'workteam', bodyArg: 'ping' },
      { CLAUDE_CODE_MESSAGING_SOCKET: 'sock-alpha' },
    );
    expect(out).toContain('delivered to workteam (turn 1)');
    expect(codexDeliveries.at(-1)?.threadId).toBe('team1111-aaaa');
    expect(codexDeliveries.at(-1)!.content).toContain('from-name="alpha" turn="1"');
    expect(codexDeliveries.at(-1)!.content).toContain('reply-as="workteam"');
    const ref = decodeRef(out.match(REF_RE)![0]);
    expect(ref.f).toEqual({ p: 'claude', id: 'cs-alpha' });
  });

  it('reads the body from stdin when --body is absent', async () => {
    const out = await send({ to: 'beta' }, undefined, 'piped body');
    expect(out).toContain('delivered to beta (turn 1)');
    expect(claudeDeliveries.at(-1)!.content.startsWith('<cross-session-message')).toBe(true);
    expect(claudeDeliveries.at(-1)!.content).toContain('piped body');
  });

  it('emits single-line closed JSON with --json', async () => {
    const out = await send({ to: 'alpha', bodyArg: 'j', json: true });
    const parsed = JSON.parse(out) as { status: string; to: string; turn: number; replyRef: string };
    expect(parsed).toMatchObject({ status: 'delivered', to: 'alpha', turn: 1 });
    expect(out).not.toContain('\n');
    expect(parsed.replyRef.startsWith('mc1_')).toBe(true);
  });

  it('accepts a body of exactly 16KiB', async () => {
    const out = await send({ to: 'alpha', bodyArg: 'x'.repeat(MAX_BODY_BYTES) });
    expect(out).toContain('delivered to alpha');
  });

  it('reports the queued state when codex delivery went through an open window', async () => {
    // Thread 1: this conversation pair is fresh (human -> workteam) so no
    // rate-limit interference; deliverCodex reports the queue channel.
    const deps = makeDeps({ CODEX_THREAD_ID: 'other222-bbbb' });
    deps.deliverCodex = async () => ({ status: 'queued' });
    const out = await runSend({ to: 'workteam', bodyArg: 'live window ping' }, deps);
    expect(out).toContain('queued to workteam (turn 1, live window)');
    expect(out).not.toContain('delivered to');

    const jsonOut = await runSend({ to: 'workteam', bodyArg: 'again', json: true }, {
      ...deps,
      deliverCodex: async () => ({ status: 'queued' }),
    });
    const parsed = JSON.parse(jsonOut) as { status: string; to: string; turn: number };
    expect(parsed).toMatchObject({ status: 'queued', to: 'workteam', turn: 1 });
    expect(jsonOut).not.toContain('\n');
  });
});

describe('runSend validation', () => {
  it('rejects a body over 16KiB without delivering', async () => {
    const deliveriesBefore = claudeDeliveries.length;
    await expectCode(send({ to: 'alpha', bodyArg: 'x'.repeat(MAX_BODY_BYTES + 1) }), 'MESSAGE_TOO_LARGE');
    expect(claudeDeliveries.length).toBe(deliveriesBefore);
  });

  it('rejects --to together with --conversation', async () => {
    await expectCode(send({ to: 'alpha', conversation: 'mc1_x', bodyArg: 'h' }), 'TARGET_CONFLICT');
  });

  it('requires a target', async () => {
    await expectCode(send({ bodyArg: 'h' }), 'TARGET_REQUIRED');
  });

  it('rejects body given twice and body given never', async () => {
    await expectCode(send({ to: 'alpha', bodyArg: 'h' }, undefined, 'piped'), 'BODY_CONFLICT');
    await expectCode(send({ to: 'alpha' }), 'BODY_REQUIRED');
    await expectCode(send({ to: 'alpha', bodyArg: '' }), 'BODY_REQUIRED');
  });

  it('surfaces name resolution failures with available names', async () => {
    const err = await expectCode(send({ to: 'definitely-missing', bodyArg: 'hi' }), 'NAME_NOT_FOUND');
    expect(err.message).toContain('alpha');
    expect(err.message).toContain('workteam');
  });
});

describe('runSend identity rules', () => {
  it('refuses when both identity families are present in env, with self-fix guidance', async () => {
    const err = await expectCode(
      send(
        { to: 'alpha', bodyArg: 'h' },
        { CLAUDE_CODE_MESSAGING_SOCKET: 'sock-alpha', CODEX_THREAD_ID: 'team1111-aaaa' },
      ),
      'CALLER_IDENTITY_CONFLICT',
    );
    expect(err.message).toContain(
      'env -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN -u CLAUDE_CODE_SESSION_ID',
    );
    expect(err.message).toContain('Remove-Item Env:CLAUDE_CODE_*');
    expect(err.message).toContain('daemon stop');
  });

  it('refuses when the claude socket matches no routable session', async () => {
    await expectCode(
      send({ to: 'alpha', bodyArg: 'h' }, { CLAUDE_CODE_MESSAGING_SOCKET: 'sock-ghost' }),
      'IDENTITY_UNRESOLVED',
    );
  });

  it('prefers CODEX_THREAD_ID over CODEX_SESSION_ID', async () => {
    const out = await send(
      { to: 'alpha', bodyArg: 'h' },
      { CODEX_THREAD_ID: 'team1111-aaaa', CODEX_SESSION_ID: 't-other' },
    );
    const ref = decodeRef(out.match(REF_RE)![0]);
    expect(ref.f).toEqual({ p: 'codex', id: 'team1111-aaaa' });
  });
});

describe('runSend reply routing via --conversation', () => {
  let firstRef = '';

  it('routes a reply to the other endpoint and increments the turn', async () => {
    const out = await send(
      { to: 'workteam', bodyArg: 'round one' },
      { CLAUDE_CODE_MESSAGING_SOCKET: 'sock-alpha' },
    );
    firstRef = out.match(REF_RE)![0];

    // The codex side replies using the ref embedded in the delivered envelope.
    const embeddedRef = codexDeliveries.at(-1)!.content.match(REF_RE)![0];
    const reply = await send(
      { conversation: embeddedRef, bodyArg: 'round two' },
      { CODEX_THREAD_ID: 'team1111-aaaa' },
    );
    expect(reply).toContain('(turn 2)');
    expect(claudeDeliveries.at(-1)?.pid).toBe(101);
    expect(claudeDeliveries.at(-1)!.content).toContain('from-name="codex/team1111" turn="2"');
    expect(claudeDeliveries.at(-1)!.content).toContain('reply-as="alpha"');
    const next = decodeRef(reply.match(REF_RE)![0]);
    expect(next.c).toBe(2);
    expect(next.f).toEqual({ p: 'claude', id: 'cs-alpha' });
    expect(next.t).toEqual({ p: 'codex', id: 'team1111-aaaa' });
  });

  it('rejects a caller outside the conversation', async () => {
    await expectCode(
      send({ conversation: firstRef, bodyArg: 'h' }, { CLAUDE_CODE_MESSAGING_SOCKET: 'sock-beta' }),
      'CALLER_NOT_IN_CONVERSATION',
    );
    await expectCode(send({ conversation: firstRef, bodyArg: 'h' }), 'CALLER_NOT_IN_CONVERSATION');
  });

  it('refuses to route a reply back to a human initiator', async () => {
    const humanInitiated = encodeRef(newConversationRef({ p: 'human' }, { p: 'claude', id: 'cs-alpha' }));
    await expectCode(
      send({ conversation: humanInitiated, bodyArg: 'h' }, { CLAUDE_CODE_MESSAGING_SOCKET: 'sock-alpha' }),
      'CANNOT_REPLY_TO_HUMAN',
    );
  });

  it('rejects a target session that left the registry', async () => {
    const gone = encodeRef(newConversationRef({ p: 'codex', id: 'team1111-aaaa' }, { p: 'claude', id: 'cs-gone' }));
    await expectCode(
      send({ conversation: gone, bodyArg: 'h' }, { CODEX_THREAD_ID: 'team1111-aaaa' }),
      'TARGET_NOT_FOUND',
    );
  });

  it('rejects malformed refs', async () => {
    await expectCode(send({ conversation: 'garbage', bodyArg: 'h' }), 'INVALID_CONVERSATION_REF');
  });
});

describe('runSend rate limiting', () => {
  it('throws RATE_LIMITED on the 31st message within 60s for a pair', async () => {
    // Fresh pair: claude cs-beta <-> codex workteam.
    const env = { CLAUDE_CODE_MESSAGING_SOCKET: 'sock-beta' };
    for (let i = 0; i < 30; i++) {
      await send({ to: 'workteam', bodyArg: `spam ${i}` }, env);
    }
    const err = await expectCode(send({ to: 'workteam', bodyArg: 'one too many' }, env), 'RATE_LIMITED');
    expect(err.message).toContain('Retry');
    // Other pairs are unaffected.
    const ok = await send({ to: 'alpha', bodyArg: 'fine' });
    expect(ok).toContain('delivered to alpha');
  });
});
