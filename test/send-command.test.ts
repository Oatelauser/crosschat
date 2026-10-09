import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterAll, describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES, runSend, type SendArgs, type SendDeps } from '../src/commands/send.js';
import { decodeRef, encodeRef, newConversationRef, nextTurnRef } from '../src/ref.js';
import { MultichatError } from '../src/errors.js';
import { drain, park } from '../src/outbox.js';
import { encodeOrigin } from '../src/federation.js';
import type { SendLogEntry } from '../src/send-log.js';
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

const rateDir = mkdtempSync(join(tmpdir(), 'crosschat-send-'));
const outboxDir = mkdtempSync(join(tmpdir(), 'crosschat-send-outbox-'));
afterAll(() => {
  rmSync(rateDir, { recursive: true, force: true });
  rmSync(outboxDir, { recursive: true, force: true });
});

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
    outboxDir,
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

const REF_RE = /mc[12]_[A-Za-z0-9_-]+/;

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
    expect(content).toContain('<crosschat-reply-hint conversation="mc2_');
    expect(content).toContain('reply-as="alpha"');
    expect(content).toContain('crosschat send --conversation mc2_');
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
    expect(parsed.replyRef.startsWith('mc2_')).toBe(true);
  });

  it('accepts a body of exactly 16KiB', async () => {
    const out = await send({ to: 'alpha', bodyArg: 'x'.repeat(MAX_BODY_BYTES) });
    expect(out).toContain('delivered to alpha');
  });

  it('codex delivery reports the single delivered state, never queued', async () => {
    const out = await send({ to: 'workteam', bodyArg: 'single state' });
    expect(out).toContain('delivered to workteam (turn 1)');
    expect(out).not.toContain('queued');
    expect(out).not.toContain('live window');
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
    expect(err.message).toContain(
      process.platform === 'win32' ? 'Remove-Item Env:CLAUDE_CODE_*' : 'unset CLAUDE_CODE_*',
    );
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

describe('runSend --to conversation continuity (B15)', () => {
  const freshOutbox = (): string => mkdtempSync(join(outboxDir, 'case-'));
  const freshState = (): string =>
    join(mkdtempSync(join(outboxDir, 'state-')), 'conversations.json');

  it('repeated --to sends to the same codex thread count turns 1, 2, 3', async () => {
    const state = freshState();
    const entries: SendLogEntry[] = [];
    const deps = {
      ...makeDeps({ CLAUDE_CODE_MESSAGING_SOCKET: 'sock-alpha' }),
      conversationStateFile: state,
      appendLog: (entry: SendLogEntry) => entries.push(entry),
    };
    const first = await runSend({ to: 'workteam', bodyArg: 'one' }, deps);
    const second = await runSend({ to: 'workteam', bodyArg: 'two' }, deps);
    const third = await runSend({ to: 'workteam', bodyArg: 'three' }, deps);
    expect(first).toContain('delivered to workteam (turn 1)');
    expect(second).toContain('delivered to workteam (turn 2)');
    expect(third).toContain('delivered to workteam (turn 3)');
    // B16: audit entries carry the sender identity, not just the recipient.
    expect(entries.map((entry) => entry.from)).toEqual([
      'claude:cs-alpha',
      'claude:cs-alpha',
      'claude:cs-alpha',
    ]);
    // B21: entries also carry the sender's display name (source-side accounting).
    expect(entries.map((entry) => entry.fromName)).toEqual(['alpha', 'alpha', 'alpha']);
  });

  it('a parked send still records the conversation for later continuation', async () => {
    const state = freshState();
    const okDeps = { ...makeDeps({ CLAUDE_CODE_MESSAGING_SOCKET: 'sock-alpha' }), conversationStateFile: state };
    await runSend({ to: 'workteam', bodyArg: 'hello' }, okDeps);
    const busyDeps = {
      ...okDeps,
      outboxDir: freshOutbox(),
      deliverCodex: async () => {
        throw new MultichatError('CODEX_THREAD_BUSY_TIMEOUT', 'busy');
      },
    };
    const parked = await runSend({ to: 'workteam', bodyArg: 'queued up' }, busyDeps);
    expect(parked).toContain('已寄存给 workteam');
    const again = await runSend({ to: 'workteam', bodyArg: 'next' }, okDeps);
    expect(again).toContain('delivered to workteam (turn 3)'); // 1 + parked 2 + this 3
  });
});

describe('runSend outbox parking (B10)', () => {
  // Fresh outbox per test: parking accumulates per thread file.
  const freshOutbox = (): string => mkdtempSync(join(outboxDir, 'case-'));

  function failingDeps(code: string, outDir: string): SendDeps {
    const deps = makeDeps({ CLAUDE_CODE_MESSAGING_SOCKET: 'sock-alpha' });
    return {
      ...deps,
      outboxDir: outDir,
      deliverCodex: async () => {
        throw new MultichatError(code, `simulated ${code}`);
      },
    };
  }

  it('parks on CODEX_THREAD_BUSY_TIMEOUT with the honest B12 output (exit 0 path)', async () => {
    const out = await runSend(
      { to: 'workteam', bodyArg: 'stuck message' },
      failingDeps('CODEX_THREAD_BUSY_TIMEOUT', freshOutbox()),
    );
    expect(out).toContain('已寄存给 workteam（对方忙，未送达）');
    expect(out).toContain('看门狗每 0.5–5 分钟自动重试');
    expect(out).toContain('reply-ref: mc2_');
  });

  it('parks on CODEX_THREAD_LOCKED as well', async () => {
    const out = await runSend(
      { to: 'workteam', bodyArg: 'locked out' },
      failingDeps('CODEX_THREAD_LOCKED', freshOutbox()),
    );
    expect(out).toContain('已寄存给 workteam');
  });

  it('joins the queue instead of jumping it when older items are parked (B12)', async () => {
    const dir = freshOutbox();
    // Seed one parked item straight into the outbox.
    park(dir, 'team1111-aaaa', { envelope: 'older', toName: 'workteam' }, 1_000);
    const calls: string[] = [];
    const deps = {
      ...makeDeps({ CLAUDE_CODE_MESSAGING_SOCKET: 'sock-alpha' }),
      outboxDir: dir,
      deliverCodex: async (_t: string, content: string) => {
        calls.push(content);
      },
    };
    const out = await runSend({ to: 'workteam', bodyArg: 'fresh' }, deps);
    // The fresh send must NOT go direct while the queue is non-empty.
    expect(calls).toEqual([]);
    expect(out).toContain('队列共 2 条');
    const items = (JSON.parse(readFileSync(join(dir, 'team1111-aaaa.json'), 'utf8')) as { items: { envelope: string }[] }).items;
    expect(items.map((item) => item.envelope)).toEqual(['older', expect.stringContaining('fresh')]);
  });

  it('reports status parked as single-line JSON with --json', async () => {
    const out = await runSend(
      { to: 'workteam', bodyArg: 'j', json: true },
      failingDeps('CODEX_THREAD_BUSY_TIMEOUT', freshOutbox()),
    );
    const parsed = JSON.parse(out) as { status: string; to: string; turn: number };
    expect(parsed).toMatchObject({ status: 'parked', to: 'workteam', turn: 1 });
    expect(out).not.toContain('\n');
  });

  it('parks the composed envelope verbatim and a drain delivers it unchanged', async () => {
    const dir = freshOutbox();
    await runSend({ to: 'workteam', bodyArg: 'round trip' }, failingDeps('CODEX_THREAD_BUSY_TIMEOUT', dir));
    const file = join(dir, 'team1111-aaaa.json');
    const parked = JSON.parse(readFileSync(file, 'utf8')) as { items: { envelope: string; toName: string }[] };
    expect(parked.items).toHaveLength(1);
    expect(parked.items[0]!.toName).toBe('workteam');
    expect(parked.items[0]!.envelope).toContain('round trip');
    expect(parked.items[0]!.envelope).toContain('<cross-session-message');
    const delivered: string[] = [];
    await drain(dir, async (_threadId, content) => {
      delivered.push(content);
    });
    expect(delivered).toEqual([parked.items[0]!.envelope]);
    expect(existsSync(file)).toBe(false);
  });

  it('does not park other codex errors', async () => {
    const dir = freshOutbox();
    await expectCode(
      runSend({ to: 'workteam', bodyArg: 'h' }, failingDeps('CODEX_APPROVAL_REQUIRED', dir)),
      'CODEX_APPROVAL_REQUIRED',
    );
    expect(existsSync(join(dir, 'team1111-aaaa.json'))).toBe(false);
  });
});

describe('runSend receipt probing (B19: queued never probes)', () => {
  const freshOutbox = (): string => mkdtempSync(join(outboxDir, 'case-'));

  function probingDeps(queued: boolean, probes: Array<[string, string]>): SendDeps {
    return {
      ...makeDeps({ CLAUDE_CODE_MESSAGING_SOCKET: 'sock-alpha' }),
      outboxDir: freshOutbox(),
      deliverCodex: async (threadId, content) => {
        codexDeliveries.push({ threadId, content });
        return queued
          ? { status: 'accepted', turnId: 'turn-1', queued: true }
          : { status: 'accepted', turnId: 'turn-1' };
      },
      confirmReceipt: async (threadId, marker) => {
        probes.push([threadId, marker]);
        return 'confirmed';
      },
    };
  }

  it('queued skips the receipt probe and points at status --conversations', async () => {
    const probes: Array<[string, string]> = [];
    const out = await runSend({ to: 'workteam', bodyArg: 'behind your turn' }, probingDeps(true, probes));
    // Never probed: the message sits behind the recipient's running turn, so
    // the 1.5s probe is structurally unconfirmable.
    expect(probes).toEqual([]);
    expect(out).toContain('对方正忙，已入队，本轮结束即处理'); // main queued line retained
    expect(out).toContain('已入对方服务端队列，本轮结束即处理；终态可查 crosschat status --conversations');
    expect(out).not.toContain('回执');
  });

  it('delivered still probes the receipt', async () => {
    const probes: Array<[string, string]> = [];
    const out = await runSend({ to: 'workteam', bodyArg: 'straight through' }, probingDeps(false, probes));
    expect(probes).toHaveLength(1);
    expect(probes[0]![0]).toBe('team1111-aaaa');
    expect(probes[0]![1]).toMatch(/^mc2_/);
    expect(out).toContain('delivered to workteam (turn 1)');
    expect(out).not.toContain('回执'); // confirmed → no caveat line
  });
});

describe('runSend --conversation stale-ref guard (B22)', () => {
  const freshState = (): string =>
    join(mkdtempSync(join(outboxDir, 'state-')), 'conversations.json');

  it('two repliers from the same old base get distinct turns, not a collision', async () => {
    const state = freshState();
    const base = { ...makeDeps({ CLAUDE_CODE_MESSAGING_SOCKET: 'sock-alpha' }), conversationStateFile: state };
    // claude alpha opens: turn 1, shard line c=1, envelope carries that ref.
    const first = await runSend({ to: 'workteam', bodyArg: 'one' }, base);
    expect(first).toContain('(turn 1)');
    const baseRef = first.match(REF_RE)![0];
    // codex replies via the copied ref: turn 2, shard advances to c=2.
    const reply = await runSend(
      { conversation: baseRef, bodyArg: 'two' },
      { ...base, env: { CODEX_THREAD_ID: 'team1111-aaaa' } },
    );
    expect(reply).toContain('(turn 2)');
    // claude alpha answers from the SAME stale baseRef: turn 3 (was 2 before B22 — collision).
    const late = await runSend({ conversation: baseRef, bodyArg: 'three' }, base);
    expect(late).toContain('(turn 3)');
    const lateRef = decodeRef(late.match(REF_RE)![0]);
    expect(lateRef.c).toBe(3);
  });

  it('without wired state the --conversation path keeps the exact legacy nextTurnRef behavior', async () => {
    const deps = makeDeps({ CODEX_THREAD_ID: 'team1111-aaaa' });
    const ref = newConversationRef({ p: 'claude', id: 'cs-alpha' }, { p: 'codex', id: 'team1111-aaaa' });
    const out = await runSend({ conversation: encodeRef(nextTurnRef(ref)), bodyArg: 'legacy' }, deps);
    expect(out).toContain('(turn 3)'); // passed c=2 -> 3, no state consulted
  });
});

describe('runSend with codex entirely absent (B2 unix deploy)', () => {
  it('delivers --to <claude name> when listCodexThreads rejects', async () => {
    const deps = {
      ...makeDeps({}),
      listCodexThreads: async () => {
        throw new MultichatError('CODEX_PROXY_SPAWN_FAILED', 'simulated codex absence');
      },
    };
    const before = claudeDeliveries.length;
    const out = await runSend({ to: 'alpha', bodyArg: 'hello from unix' }, deps);
    expect(out).toContain('alpha');
    expect(claudeDeliveries.length).toBe(before + 1);
  });
});

describe('runSend configurable body cap (票A)', () => {
  it('--max-body-kb 32 lets a 32KiB body through to codex', async () => {
    const out = await send(
      { to: 'workteam', bodyArg: 'x'.repeat(32 * 1_024), maxBodyKb: '32' },
      { CLAUDE_CODE_MESSAGING_SOCKET: 'sock-alpha' },
    );
    expect(out).toContain('delivered to workteam');
  });

  it('env CROSSCHAT_MAX_BODY_KIB raises the cap when the flag is absent', async () => {
    const out = await send({ to: 'alpha', bodyArg: 'x'.repeat(20_000) }, { CROSSCHAT_MAX_BODY_KIB: '64' });
    expect(out).toContain('delivered to alpha');
  });

  it('an invalid flag value silently falls to env, then to the default', async () => {
    const out = await send({ to: 'alpha', bodyArg: 'x'.repeat(20_000), maxBodyKb: 'wat' }, { CROSSCHAT_MAX_BODY_KIB: '64' });
    expect(out).toContain('delivered to alpha');
    await expectCode(send({ to: 'alpha', bodyArg: 'x'.repeat(20_000), maxBodyKb: 'wat' }, {}), 'MESSAGE_TOO_LARGE');
  });

  it('--max-body-kb 1024 still hits the claude 64KiB endpoint cap with hard-cap teaching', async () => {
    const before = claudeDeliveries.length;
    const err = await expectCode(
      send({ to: 'alpha', bodyArg: 'x'.repeat(100 * 1_024), maxBodyKb: '1024' }),
      'MESSAGE_TOO_LARGE',
    );
    expect(err.message).toContain('claude 端点硬顶 64KiB——提额无效');
    expect(claudeDeliveries.length).toBe(before); // rejected before delivery
  });

  it('oversized via-ssh bodies hit the local 1MiB pre-check, never the transport', async () => {
    let sshCalls = 0;
    const deps = {
      ...makeDeps({}),
      sshExec: async (): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> => {
        sshCalls++;
        return { code: 0, stdout: '', stderr: '', timedOut: false };
      },
    };
    const err = await expectCode(
      runSend({ to: 'worker2', via: 'ssh:peer', bodyArg: 'x'.repeat(1_100_000), maxBodyKb: '2048' }, deps),
      'MESSAGE_TOO_LARGE',
    );
    expect(err.message).toContain('1MiB');
    expect(err.message).toContain('远端自行复检');
    expect(sshCalls).toBe(0);
  });

  it('envelope teaching line stays static 16KiB even when the cap was raised (第六单政策)', async () => {
    await send(
      { to: 'workteam', bodyArg: 'y'.repeat(40 * 1_024), maxBodyKb: '64' },
      { CLAUDE_CODE_MESSAGING_SOCKET: 'sock-alpha' },
    );
    // 信封读者是收方、数字是发方的——动态值教错人；准确数字只住各侧报错里。
    expect(codexDeliveries.at(-1)!.content).toContain('超 16KiB 请写文件后只发路径');
    expect(codexDeliveries.at(-1)!.content).not.toContain('超 64KiB');
  });

  it('remote-origin rejections teach scp + receiver-side operator, never --max-body-kb (第六单)', async () => {
    const before = claudeDeliveries.length;
    const err = await expectCode(
      send({ to: 'alpha', bodyArg: 'x'.repeat(20_000), origin: 'ZmFrZUBvc3Q' }),
      'MESSAGE_TOO_LARGE',
    );
    expect(err.message).toContain('scp');
    expect(err.message).toContain('接收方');
    expect(err.message).toContain('CROSSCHAT_MAX_BODY_KIB');
    expect(err.message).not.toContain('--max-body-kb'); // 发送方本机提额管不到接收方，不得指这条路
    expect(claudeDeliveries.length).toBe(before);
  });

  it('remote-origin endpoint-cap rejections keep the hard-cap fact and teach scp only (第八单)', async () => {
    const before = claudeDeliveries.length;
    // 远端来件过了发送方的 1MiB 提额，但 claude 端点 64KiB 硬顶挡下：硬顶
    // 事实保留，尾巴换 scp 三步；接收方提额也过不了端点硬顶，绝不指那条路。
    const err = await expectCode(
      send({
        to: 'alpha',
        bodyArg: 'x'.repeat(100 * 1_024),
        maxBodyKb: '1024',
        origin: encodeOrigin({ p: 'human' }, 'hostA'),
      }),
      'MESSAGE_TOO_LARGE',
    );
    expect(err.message).toContain('claude 端点硬顶 64KiB');
    expect(err.message).toContain('scp');
    expect(err.message).not.toContain('--max-body-kb');
    expect(err.message).not.toContain('CROSSCHAT_MAX_BODY_KIB'); // hardCap 场景：调了也过不了端点硬顶
    expect(claudeDeliveries.length).toBe(before);
  });

  it('max-turn: --max-turn beats CROSSCHAT_MAX_TURN; unset keeps a bare turn number', async () => {
    await send({ to: 'alpha', bodyArg: 'flag wins', maxTurn: '40' }, { CROSSCHAT_MAX_TURN: '60' });
    expect(claudeDeliveries.at(-1)!.content).toContain('turn="1/40"');
    await send({ to: 'alpha', bodyArg: 'env only' }, { CROSSCHAT_MAX_TURN: '60' });
    expect(claudeDeliveries.at(-1)!.content).toContain('turn="1/60"');
    await send({ to: 'alpha', bodyArg: 'no budget' });
    expect(claudeDeliveries.at(-1)!.content).toContain('turn="1">');
    expect(claudeDeliveries.at(-1)!.content).not.toContain('budget=');
  });
});
