import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runStatus, type StatusDeps } from '../src/commands/status.js';
import { conversationSummaries } from '../src/conversation-summary.js';
import { pairKeyOf } from '../src/conversations.js';
import { encodeRef, newConversationRef } from '../src/ref.js';
import { appendSendLog, type SendLogEntry } from '../src/send-log.js';
import { MultichatError } from '../src/errors.js';
import type { ClaudeSessionEntry } from '../src/claude/registry.js';
import type { CodexThreadWithMeta } from '../src/codex/discovery.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-status-filters-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const NOW = Date.parse('2026-10-12T10:00:00.000Z');
const iso = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString();

const claudeSession = (id: string, name: string | undefined): ClaudeSessionEntry => ({
  pid: 1,
  sessionId: id,
  kind: 'interactive',
  status: 'idle',
  name,
  messagingSocketPath: `sock-${id}`,
});
const codexThread = (id: string, name: string | null): CodexThreadWithMeta => ({ id, name, status: 'idle' });

/** Main-view deps: one named + one unnamed claude session and codex thread. */
function mainDeps(tcpDir?: string): StatusDeps {
  return {
    listClaudeSessions: () => ({
      sessions: [claudeSession('sc-1', 'Mapper'), claudeSession('sc-2', undefined)],
      malformed: 0,
    }),
    listCodexThreads: async () => [codexThread('t-9', 'Drill'), codexThread('t-8', null)],
    ...(tcpDir === undefined ? {} : { tcpDir }),
    now: () => NOW,
  };
}

const entry = (fields: Partial<SendLogEntry>): SendLogEntry => ({
  ts: '2026-10-12T09:00:00.000Z',
  to: 'peer',
  target: 'codex:t-9',
  status: 'delivered',
  ...fields,
});

/** Conversations deps wired to a temp trio; refs are real so --via attribution decodes. */
function convDeps(
  pairs: Record<string, { ref: string; updatedAt: number }>,
  tail: SendLogEntry[],
): StatusDeps {
  const dir = mkdtempSync(join(root, 'case-'));
  const conversationsFile = join(dir, 'conversations.json');
  const sendLogFile = join(dir, 'send-log.jsonl');
  writeFileSync(conversationsFile, JSON.stringify({ pairs }), 'utf8');
  for (const e of tail) appendSendLog(sendLogFile, e);
  return {
    listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
    listCodexThreads: async () => [],
    listConversations: () => conversationSummaries({ conversationsFile, sendLogFile, outboxDir: join(dir, 'outbox') }),
    sendLogTail: () => tail,
    now: () => NOW,
  };
}

describe('status 两行改名 + 别名截短', () => {
  it('node line prefixes 节点客户端 and truncates a >16 char alias to <first14>…', async () => {
    const dir = mkdtempSync(join(root, 't-'));
    writeFileSync(
      join(dir, 'status-node.json'),
      JSON.stringify({ state: 'online', brokerAlias: 'iv-yefd46fldsvr6olkju4j', since: '2026-10-10T08:00:00.000Z', lastUpdated: iso(-5_000) }),
    );
    const out = await runStatus(mainDeps(dir), false);
    expect(out).toContain('节点客户端: online tcp:iv-yefd46f… (since ');
    expect(out).not.toContain('转发器');
  });

  it('keeps a ≤16 char alias as-is', async () => {
    const dir = mkdtempSync(join(root, 't-'));
    writeFileSync(
      join(dir, 'status-node.json'),
      JSON.stringify({ state: 'online', brokerAlias: 'short-alias', since: '2026-10-10T08:00:00.000Z', lastUpdated: iso(-5_000) }),
    );
    const out = await runStatus(mainDeps(dir), false);
    expect(out).toContain('节点客户端: online tcp:short-alias (since ');
  });

  it('multi-daemon lines tag 节点客户端[<selector>]:', async () => {
    const dir = mkdtempSync(join(root, 't-'));
    mkdirSync(dir, { recursive: true });
    for (const [file, alias] of [
      ['status-node.json', 'br1'],
      ['status-node-cloud.json', 'br-cloud'],
    ] as const) {
      writeFileSync(join(dir, file), JSON.stringify({ state: 'online', brokerAlias: alias, since: '2026-10-10T08:00:00.000Z', lastUpdated: iso(-5_000) }));
    }
    const out = await runStatus(mainDeps(dir), false);
    expect(out).toContain('节点客户端[默认]: online tcp:br1 (since ');
    expect(out).toContain('节点客户端[cloud]: online tcp:br-cloud (since ');
  });

  it('roster lines prefix broker: 可达/不可达', async () => {
    const dir = mkdtempSync(join(root, 't-'));
    const deps = mainDeps(dir);
    deps.roster = async () => [
      { name: 'hub', mid8: 'a1b2c3d4', online: true },
      { name: 'beta', mid8: 'bbbb0000', online: false },
    ];
    const out = await runStatus(deps, false);
    expect(out).toContain('broker: 可达，1 机器在线');
    expect(out).toContain('在线机器: hub (a1b2c3d4)');
    deps.roster = async () => undefined;
    expect(await runStatus(deps, false)).toContain('broker: 不可达');
  });
});

describe('status --claude/--codex 选段', () => {
  it('--claude keeps only the claude section', async () => {
    const out = await runStatus(mainDeps(), false, false, { section: 'claude' });
    expect(out).toContain('claude:');
    expect(out).not.toContain('codex:');
    expect(out).toContain('Mapper');
  });

  it('--codex keeps only the codex section', async () => {
    const out = await runStatus(mainDeps(), false, false, { section: 'codex' });
    expect(out).toContain('codex:');
    expect(out).not.toContain('claude:');
    expect(out).toContain('Drill');
  });

  it('--json composes with a section: the other key is absent, row shape unchanged', async () => {
    const parsed = JSON.parse(await runStatus(mainDeps(), true, false, { section: 'claude' })) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['claude']);
    expect(Object.keys((parsed.claude as Array<Record<string, unknown>>)[0]!).sort()).toEqual([
      'cwd',
      'kind',
      'name',
      'pid',
      'status',
    ]);
  });
});

describe('status --name 过滤', () => {
  it('main view filters rows by case-insensitive display-name substring', async () => {
    const out = await runStatus(mainDeps(), false, false, { name: 'map' });
    expect(out).toContain('claude:');
    expect(out).toContain('Mapper');
    expect(out).not.toContain('Drill');
    // F1 过滤抑制：--name 后零行的 codex 段整段沉默（段头与 (none) 占位都不出）
    expect(out).not.toContain('codex:');
    expect(out).not.toContain('(none)');
    const rows = out.split('\n').filter((l) => l.startsWith('  '));
    expect(rows).toHaveLength(1); // only the Mapper row
  });

  it('conversations keeps a pair when either side matches', async () => {
    const claudeA = { p: 'claude', id: 'sc-1' } as const;
    const codexB = { p: 'codex', id: 't-9' } as const;
    const key = pairKeyOf(claudeA, codexB);
    const d = convDeps(
      { [key]: { ref: 'mc1_x', updatedAt: NOW - 60_000 } },
      [entry({ from: 'claude:sc-1', to: '架构', turn: 1 })],
    );
    const out = await runStatus(d, false, true, { name: '架构' });
    expect(out.split('\n')).toHaveLength(2); // header + the one matching row
    expect(out).toContain('架构');
    expect(await runStatus(d, false, true, { name: 'nothing-matches' })).toBe('会话:\n  (none)');
  });
});

describe('status --conversations --via 传输族', () => {
  const claudeA = { p: 'claude', id: 'sc-1' } as const;
  const codexB = { p: 'codex', id: 't-9' } as const;
  const localC = { p: 'codex', id: 't-2' } as const;
  const keyRemote = pairKeyOf(claudeA, codexB);
  const keyLocal = pairKeyOf(claudeA, localC);
  const remoteRef = encodeRef(newConversationRef(claudeA, codexB));
  const localRef = encodeRef(newConversationRef(claudeA, localC));
  const deps = () =>
    convDeps(
      {
        [keyRemote]: { ref: remoteRef, updatedAt: NOW - 60_000 },
        [keyLocal]: { ref: localRef, updatedAt: NOW - 120_000 },
      },
      [
        // ssh 痕迹：target via:<host>（from+target 非双身份键，靠 replyRef 归对）
        entry({ from: 'claude:sc-1', to: 'peer@cloud', target: 'via:cloud', turn: 2, replyRef: remoteRef }),
        // 本机对话：身份键 target，无跨机痕迹
        entry({ ts: '2026-10-12T09:30:00.000Z', from: 'claude:sc-1', to: 'local-peer', target: 'codex:t-2', turn: 3, replyRef: localRef }),
      ],
    );

  it('--via ssh shows only the cross-machine ssh pair (local pairs hidden)', async () => {
    const out = await runStatus(deps(), false, true, { via: 'ssh' });
    expect(out).toContain('codex/t-9'); // the ssh pair's remote slot
    expect(out).not.toContain('local-peer');
    expect(out.split('\n')).toHaveLength(2);
  });

  it('--via tcp families from via:tcp: targets', async () => {
    const tcpDeps = convDeps(
      { [keyRemote]: { ref: remoteRef, updatedAt: NOW - 60_000 } },
      [entry({ from: 'claude:sc-1', to: 'peer@star', target: 'via:tcp:star-host', turn: 1, replyRef: remoteRef })],
    );
    const out = await runStatus(tcpDeps, false, true, { via: 'tcp' });
    expect(out).toContain('codex/t-9');
    expect(await runStatus(deps(), false, true, { via: 'tcp' })).toBe('会话:\n  (none)');
  });

  it('--json --via keeps the eight-field contract on the surviving rows', async () => {
    const parsed = JSON.parse(await runStatus(deps(), true, true, { via: 'ssh' })) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1);
    expect(Object.keys(parsed[0]!).sort()).toEqual([
      'lastFrom',
      'lastStatus',
      'pair',
      'parked',
      'receipt',
      'ref',
      'turn',
      'updatedAt',
    ]);
  });
});

describe('status F1 过滤抑制：零行段整段沉默', () => {
  it('--name 只命中 codex 时 claude 段整段沉默（段头也不出）', async () => {
    const out = await runStatus(mainDeps(), false, false, { name: 'drill' });
    expect(out).toContain('codex:');
    expect(out).toContain('Drill');
    expect(out).not.toContain('claude:');
  });

  it('--name 过滤下 codex 段零行时 unavailable 横幅（CODEX_PROXY_SPAWN_FAILED）一并静音', async () => {
    const deps = mainDeps();
    deps.listCodexThreads = async () => {
      throw new MultichatError('CODEX_PROXY_SPAWN_FAILED', 'spawn 失败');
    };
    // 无过滤：横幅照旧（零回归锚点）
    const bare = await runStatus(deps, false);
    expect(bare).toContain('codex:');
    expect(bare).toContain('unavailable (CODEX_PROXY_SPAWN_FAILED: spawn 失败)');
    // --name 只命中 claude → codex 段（含横幅）整段沉默
    const filtered = await runStatus(deps, false, false, { name: 'map' });
    expect(filtered).toContain('claude:');
    expect(filtered).toContain('Mapper');
    expect(filtered).not.toContain('codex:');
    expect(filtered).not.toContain('unavailable');
  });

  it('--claude 时 codex 段整段沉默（含 unavailable 横幅）', async () => {
    const deps = mainDeps();
    deps.listCodexThreads = async () => {
      throw new MultichatError('CODEX_PROXY_SPAWN_FAILED', 'spawn 失败');
    };
    const out = await runStatus(deps, false, false, { section: 'claude' });
    expect(out).toContain('claude:');
    expect(out).toContain('Mapper');
    expect(out).not.toContain('codex:');
    expect(out).not.toContain('unavailable');
  });

  it('--json 不受过滤抑制影响：零行的段仍以空数组/错误对象在场', async () => {
    const deps = mainDeps();
    deps.listCodexThreads = async () => {
      throw new MultichatError('CODEX_PROXY_SPAWN_FAILED', 'spawn 失败');
    };
    const parsed = JSON.parse(await runStatus(deps, true, false, { name: 'map' })) as {
      claude: unknown[];
      codex: unknown;
    };
    expect(parsed.claude).toHaveLength(1); // Mapper 命中
    expect(parsed.codex).toEqual({ error: 'CODEX_PROXY_SPAWN_FAILED: spawn 失败' });
  });

  it('裸输出零行段保持 (none) 占位（无过滤不沉默）', async () => {
    const deps: StatusDeps = {
      listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
      listCodexThreads: async () => [],
    };
    const out = await runStatus(deps, false);
    expect(out).toContain('claude:\n  (none)');
    expect(out).toContain('codex:\n  (none)');
  });
});

describe('status (unnamed) 默认隐藏', () => {
  it('default main view hides unnamed sessions and threads', async () => {
    const out = await runStatus(mainDeps(), false);
    expect(out).not.toContain('(unnamed)');
    expect(out).toContain('Mapper');
    expect(out).toContain('Drill');
  });

  it('--all brings unnamed rows back', async () => {
    const out = await runStatus(mainDeps(), false, false, { all: true });
    expect(out.match(/\(unnamed\)/g)).toHaveLength(2);
  });

  it('--all composes with --name (display name of an unnamed row is (unnamed))', async () => {
    const out = await runStatus(mainDeps(), false, false, { all: true, name: 'unnamed' });
    expect(out.match(/\(unnamed\)/g)).toHaveLength(2);
    expect(out).not.toContain('Mapper');
    expect(out).not.toContain('Drill');
  });
});
