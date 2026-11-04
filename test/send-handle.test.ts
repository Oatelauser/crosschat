import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runSend, type SendDeps } from '../src/commands/send.js';
import { MultichatError } from '../src/errors.js';
import type { ClaudeRegistryScan, ClaudeSessionEntry } from '../src/claude/registry.js';
import type { CodexThreadSummary } from '../src/codex/client.js';
import { pairKeyOf } from '../src/conversations.js';
import { encodeRef, newConversationRef } from '../src/ref.js';
import { writeConversationShards } from './helpers/conversation-shards.js';

const root = mkdtempSync(join(tmpdir(), 'cchat-g0send-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const NOW = 9_000_000;
const sessions: ClaudeSessionEntry[] = [
  { pid: 101, sessionId: 'cs-alpha', kind: 'interactive', name: 'alpha', status: 'idle', messagingSocketPath: 'sock-alpha' },
];
const scan: ClaudeRegistryScan = { sessions, malformed: 0 };
const threads: CodexThreadSummary[] = [{ id: 'team1111-aaaa', name: 'workteam', status: 'idle', endpointType: 'cli' }];

function makeDeps(stateFile: string | undefined, overrides: Partial<SendDeps> = {}): SendDeps {
  return {
    env: { CLAUDE_CODE_MESSAGING_SOCKET: 'sock-alpha' },
    listClaudeSessions: () => scan,
    listCodexThreads: async () => threads,
    deliverClaude: async () => ({ status: 'delivered' }),
    deliverCodex: async () => ({ status: 'accepted', turnId: 'turn-1' }),
    sendLogFile: join(root, 'send-log.jsonl'),
    outboxDir: join(root, 'outbox'),
    now: () => NOW,
    ...(stateFile === undefined ? {} : { conversationStateFile: stateFile }),
    ...overrides,
  };
}

const freshState = (): string => join(mkdtempSync(join(root, 'state-')), 'conversations.json');

describe('G0 send 输出换柄（长引用退场）', () => {
  it('rejects a legacy numeric parameter before invoking a native delivery adapter', async () => {
    let deliveries = 0;
    const deps = makeDeps(freshState(), { deliverCodex: async () => { deliveries++; return { status: 'accepted', turnId: 'not-used' }; } });
    await expect(runSend({ tool: 'codex-cli', conversation: 'c14', bodyArg: 'old hint' }, deps)).rejects.toThrow(/旧.*短柄.*停用/);
    expect(deliveries).toBe(0);
  });
  it('delivered 行尾追加五字符续话柄，不再有 reply-ref 行', async () => {
    const out = await runSend({ tool: 'codex-cli', to: 'workteam', bodyArg: 'hello' }, makeDeps(freshState()));
    expect(out).toBe('delivered to workteam (turn 1) · 续话 cA000');
    expect(out).not.toContain('reply-ref');
  });

  it('parked 同样分配：寄存输出第三行为五字符续话柄', async () => {
    const out = await runSend(
      { tool: 'codex-cli', to: 'workteam', bodyArg: 'stuck' },
      makeDeps(freshState(), {
        outboxDir: join(mkdtempSync(join(root, 'box-')), 'outbox'),
        deliverCodex: async () => {
          throw new MultichatError('CODEX_THREAD_BUSY_TIMEOUT', 'busy');
        },
      }),
    );
    expect(out).toContain('已寄存给 workteam');
    expect(out.split('\n')[2]).toMatch(/^续话: c[A-Z]\d{3}$/);
    expect(out).not.toContain('reply-ref');
  });

  it('--json 的 replyRef 保留完整 ref（且无 reply-ref 行混入）', async () => {
    const out = await runSend({ tool: 'codex-cli', to: 'workteam', bodyArg: 'hello', json: true }, makeDeps(freshState()));
    expect(out).not.toContain('\n');
    const parsed = JSON.parse(out) as { status: string; turn: number; replyRef: string };
    expect(parsed.status).toBe('delivered');
    expect(parsed.turn).toBe(1);
    expect(parsed.replyRef).toMatch(/^mc2_[A-Za-z0-9_-]{30,}$/);
  });

  it('状态未接线（异常路径）回退完整 reply-ref 行，续话不断', async () => {
    const out = await runSend({ tool: 'codex-cli', to: 'workteam', bodyArg: 'hello' }, makeDeps(undefined));
    expect(out).toMatch(/^delivered to workteam \(turn 1\)\nreply-ref: mc2_[A-Za-z0-9_-]+$/);
  });

  it.each(['exhausted', 'corrupt', 'write-failed'] as const)('optional handle state %s still delivers exactly once with the same full ref in hint and output', async (failure) => {
    const state = freshState();
    const directory = join(dirname(state), 'conversations');
    mkdirSync(directory);
    if (failure === 'exhausted') {
      const anchor = newConversationRef({ p: 'claude', id: 'anchor' }, { p: 'codex', id: 'anchor' });
      writeConversationShards(state, {
        [pairKeyOf(anchor.f, anchor.t)]: { ref: encodeRef(anchor), updatedAt: 0, handleSequence: 26_000 },
      });
    } else if (failure === 'corrupt') {
      writeFileSync(join(directory, 'damaged.json'), '{broken', 'utf8');
    } else {
      const pair = pairKeyOf({ p: 'claude', id: 'cs-alpha' }, { p: 'codex', id: 'team1111-aaaa', endpointType: 'cli' });
      // The snapshot is readable but the atomic allocation rename cannot replace this directory.
      mkdirSync(join(directory, `${createHash('sha256').update(pair).digest('hex')}.json`));
    }
    const contents: string[] = [];
    const deps = makeDeps(state, {
      deliverCodex: async (_thread, content) => { contents.push(content); return { status: 'accepted', turnId: 'accepted-once' }; },
    });
    const out = await runSend({ tool: 'codex-cli', to: 'workteam', bodyArg: 'fallback body' }, deps);
    expect(contents).toHaveLength(1);
    const ref = out.match(/\nreply-ref: (mc2_[A-Za-z0-9_-]+)$/)?.[1];
    expect(ref).toBeDefined();
    expect(contents[0]).toContain(`保留会话引用 ${ref}；`);
    expect(contents[0]).toContain('收件类型待核实');
    expect(contents[0]).toContain('fallback body');
    expect(out).toContain('delivered to workteam (turn 1)');
    expect(readdirSync(directory).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('续话柄真的可续：--conversation cA000 第二发 turn 递增', async () => {
    const state = freshState();
    const deps = makeDeps(state);
    await runSend({ tool: 'codex-cli', to: 'workteam', bodyArg: 'one' }, deps);
    const second = await runSend({ tool: 'codex-cli', conversation: 'cA000', bodyArg: 'two' }, deps);
    expect(second).toContain('delivered to workteam (turn 2) · 续话 cA000');
  });
});

describe('G0 via 腿输出换柄', () => {
  it('ssh 腿（runViaSend）：我方分片落柄，delivered 行尾五字符续话柄', async () => {
    // 远端回执里的 ref 是远机签发的完整 ref；本机记账后分配我方柄。
    const { runViaSend } = await import('../src/federation.js');
    const { encodeRef, newConversationRef } = await import('../src/ref.js');
    const remoteRef = encodeRef(newConversationRef({ p: 'claude', id: 'cs-x', m: 'build01' }, { p: 'codex', id: 't-x' }));
    const deps = makeDeps(freshState(), {
      sshExec: async () => ({
        code: 0,
        stdout: `{"status":"delivered","to":"worker2","turn":3,"replyRef":"${remoteRef}"}\n`,
        stderr: '',
      }),
    });
    const out = await runViaSend({ tool: 'codex-cli', via: 'ssh:build01', to: 'worker2' }, '干活', deps);
    expect(out).toBe('delivered to worker2@build01 (turn 3) · 续话 cA000');
  });
});
