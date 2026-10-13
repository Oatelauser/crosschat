import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { conversationFamily, runStatus, type StatusDeps } from '../src/commands/status.js';
import { conversationSummaries, type ConversationSummary } from '../src/conversation-summary.js';
import type { ClaudeSessionEntry } from '../src/claude/registry.js';
import type { CodexThreadWithMeta } from '../src/codex/discovery.js';
import { encodeRef, newConversationRef } from '../src/ref.js';

const root = mkdtempSync(join(tmpdir(), 'cchat-g0sum-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const NOW = Date.parse('2026-10-13T10:00:00.000Z');
const iso = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString();

const claudeEntry = (id: string, name: string | undefined, updatedAt?: number): ClaudeSessionEntry => ({
  pid: 1,
  sessionId: id,
  kind: 'interactive',
  status: 'idle',
  name,
  messagingSocketPath: `sock-${id}`,
  ...(updatedAt === undefined ? {} : { updatedAt }),
});
const codexEntry = (id: string, name: string | null, createdAt?: string): CodexThreadWithMeta => ({
  id,
  name,
  status: 'idle',
  ...(createdAt === undefined ? {} : { meta: { cwd: undefined, createdAt, originator: undefined } }),
});

/** ssh 族存档 ref：codex 端点带 m。 */
const sshRef = encodeRef(newConversationRef({ p: 'claude', id: 'sc-1' }, { p: 'codex', id: 't-9', m: 'host-b' }));
const localRef = encodeRef(newConversationRef({ p: 'claude', id: 'sc-1' }, { p: 'codex', id: 't-2' }));

const convRow = (fields: Partial<ConversationSummary>): ConversationSummary => ({
  pair: ['Alice', 'worker'],
  endpoints: ['claude:sc-1', 'codex:t-9'],
  ref: sshRef,
  updatedAt: NOW - 5 * 60_000,
  turn: 5,
  lastStatus: 'delivered',
  lastFrom: 'claude:sc-1',
  parked: 0,
  receipt: null,
  handle: 'c3',
  ...fields,
});

interface SummaryFixture {
  claude?: ClaudeSessionEntry[];
  codex?: CodexThreadWithMeta[];
  rows?: ConversationSummary[];
  tcp?: { nodeJson?: unknown; nodeStatus?: Array<[file: string, status: Record<string, unknown>]>; roster?: (entry?: { name?: string }) => Promise<Array<{ name?: string; mid8: string; online: boolean }> | undefined> };
  watchdogRunning?: () => boolean;
}

function summaryDeps(fx: SummaryFixture = {}): StatusDeps {
  const dir = mkdtempSync(join(root, 'case-'));
  const tcpDir = join(dir, 'tcp');
  if (fx.tcp !== undefined) {
    mkdirSync(tcpDir, { recursive: true });
    if (fx.tcp.nodeJson !== undefined) writeFileSync(join(tcpDir, 'node.json'), JSON.stringify(fx.tcp.nodeJson));
    for (const [file, status] of fx.tcp.nodeStatus ?? []) writeFileSync(join(tcpDir, file), JSON.stringify(status));
  }
  return {
    listClaudeSessions: () => ({ sessions: fx.claude ?? [], malformed: 0 }),
    listCodexThreads: async () => fx.codex ?? [],
    listConversations: () => fx.rows ?? [],
    ...(fx.tcp === undefined ? {} : { tcpDir }),
    ...(fx.tcp?.roster === undefined ? {} : { roster: fx.tcp.roster }),
    ...(fx.watchdogRunning === undefined ? {} : { watchdogRunning: fx.watchdogRunning }),
    now: () => NOW,
  };
}

const onlineDaemon = (alias: string): [string, Record<string, unknown>] => [
  'status-node.json',
  { state: 'online', brokerAlias: alias, since: iso(-3_600_000), lastUpdated: iso(-5_000) },
];

describe('G0 status 裸跑三段式摘要', () => {
  it('full snapshot：本机会话/tcp/ssh 三段齐备', async () => {
    const deps = summaryDeps({
      claude: [claudeEntry('sc-1', 'Mapper', NOW - 3 * 60_000), claudeEntry('sc-2', 'Old', NOW - 2 * 3_600_000)],
      codex: [codexEntry('t-9', 'Drill', iso(-30 * 60_000))],
      rows: [convRow({ parked: 1 })],
      tcp: {
        nodeJson: { brokers: [{ host: 'h1', port: 1, name: 'cloud', key: 'k1' }] },
        nodeStatus: [onlineDaemon('cloud')],
        roster: async () => [
          { name: 'hub', mid8: 'a1b2c3d4', online: true },
          { name: 'beta', mid8: 'bbbb0000', online: false },
        ],
      },
      watchdogRunning: () => true,
    });
    expect(await runStatus(deps, false)).toBe(
      [
        '本机会话: claude 2 · codex 1 · 滞留 1（看门狗运行中）',
        '  claude Mapper  3 分钟前',
        '  codex Drill  30 分钟前',
        '  claude Old  2 小时前',
        '（全量: --claude|--codex|--name）',
        'tcp: 共 1 星',
        '  cloud ✓ 可达，1 机器在线 · 客户端 online',
        '    hub(a1b2c3d4)、beta(bbbb0000)',
        '（星内明细: --stars）',
        'ssh: 共 1 段对话',
        '  worker@host-b turn 5  5 分钟前',
        '（明细: --conversations --via ssh）',
      ].join('\n'),
    );
  });

  it('滞留子句两态：看门狗未运行时点名，滞留为 0 时整句缺席', async () => {
    const stopped = await runStatus(summaryDeps({ rows: [convRow({ parked: 2 })], watchdogRunning: () => false }), false);
    expect(stopped).toContain('· 滞留 2（看门狗未运行）');
    const clean = await runStatus(summaryDeps({ rows: [convRow({ parked: 0 })], watchdogRunning: () => true }), false);
    expect(clean).not.toContain('滞留');
  });

  it('空 ssh 一行：ssh: 无（提示行仍在）', async () => {
    const out = await runStatus(summaryDeps({ rows: [convRow({ ref: localRef })] }), false);
    expect(out).toContain('ssh: 无');
    expect(out).toContain('（明细: --conversations --via ssh）');
  });

  it('机器行封顶 5（在线优先）', async () => {
    const machines = Array.from({ length: 7 }, (_, i) => ({ name: `m${i}`, mid8: `mid00${i}0`, online: i >= 2 }));
    const deps = summaryDeps({
      tcp: {
        nodeJson: { brokers: [{ host: 'h1', port: 1, name: 'cloud', key: 'k1' }] },
        roster: async () => machines,
      },
    });
    const out = await runStatus(deps, false);
    expect(out).toContain(`  cloud ✓ 可达，${7 - 2} 机器在线 · 客户端 未运行`);
    const machineLine = out.split('\n').find((l) => l.startsWith('    ')) ?? '';
    expect(machineLine).toBe('    m2(mid0020)、m3(mid0030)、m4(mid0040)、m5(mid0050)、m6(mid0060)');
  });
});

describe('G0 status --stars 星内明细', () => {
  const starFx = (): SummaryFixture => ({
    tcp: {
      nodeJson: {
        brokers: [
          { host: 'h1', port: 1, name: 'cloud', key: 'k1' },
          { host: 'h2', port: 2, name: 'work', key: 'k2' },
        ],
      },
      nodeStatus: [
        onlineDaemon('cloud'),
        ['status-node-work.json', { state: 'online', brokerAlias: 'work', since: iso(-3_600_000), lastUpdated: iso(-600_000) }],
      ],
      roster: async (entry) =>
        entry?.name === 'cloud'
          ? [
              { name: 'hub', mid8: 'a1b2c3d4', online: true },
              { name: 'beta', mid8: 'bbbb0000', online: false },
            ]
          : undefined,
    },
  });

  it('text：每星可达行+守护行+全量机器表（含离线星与未跑守护）', async () => {
    const out = await runStatus(summaryDeps(starFx()), false, false, {}, undefined, true);
    expect(out).toBe(
      [
        'tcp: 共 2 星',
        'cloud ✓ 可达，1 机器在线',
        '  守护: 默认: online',
        '  hub(a1b2c3d4) 在线',
        '  beta(bbbb0000) 离线',
        'work ✗ 不可达',
        '  守护: work: 未运行',
      ].join('\n'),
    );
  });

  it('--json：stars 分组新键 + 旧键全保留', async () => {
    const parsed = JSON.parse(await runStatus(summaryDeps(starFx()), true, false, {}, undefined, true)) as {
      claude: unknown[];
      codex: unknown[];
      stars: Array<{ name: string; reachable: boolean; machinesOnline: number; machines: Array<{ name?: string; mid8: string; online: boolean }>; daemons: Array<{ selector: string; state: string }> }>;
    };
    expect(parsed.claude).toEqual([]);
    expect(parsed.codex).toEqual([]);
    expect(parsed.stars).toHaveLength(2);
    expect(parsed.stars[0]).toMatchObject({ name: 'cloud', reachable: true, machinesOnline: 1 });
    expect(parsed.stars[0]!.daemons).toEqual([{ selector: '默认', state: 'online' }]);
    expect(parsed.stars[1]).toMatchObject({ name: 'work', reachable: false, machines: [] });
  });

  it('未接线 tcpDir：教学一行', async () => {
    expect(await runStatus(summaryDeps(), false, false, {}, undefined, true)).toContain('tcp: 未入网');
  });
});

describe('G0 传输分类器（存档 ref 解码为权威）', () => {
  it('ref 三态：带 m 无 starId=ssh；带 starId=tcp；无 m=单机', () => {
    expect(conversationFamily(sshRef)).toBe('ssh');
    expect(conversationFamily(encodeRef({ ...newConversationRef({ p: 'claude', id: 'a' }, { p: 'codex', id: 'b' }), starId: 'aaaabbbbcccc' }))).toBe('tcp');
    expect(conversationFamily(localRef)).toBe('local');
  });

  it('不可解码 ref 回退 send-log via: 痕迹', () => {
    expect(conversationFamily('mc1_zzz', new Set(['ssh']))).toBe('ssh');
    expect(conversationFamily('mc1_zzz', new Set(['tcp']))).toBe('tcp');
    expect(conversationFamily('mc1_zzz')).toBe('local');
  });

  it('--conversations --via 走同一分类器：ssh 星 m 命中、无痕迹也对得上', async () => {
    const dir = mkdtempSync(join(root, 'case-'));
    const conversationsFile = join(dir, 'conversations.json');
    writeFileSync(
      conversationsFile,
      JSON.stringify({
        pairs: {
          'claude:sc-1\ncodex:t-9': { ref: sshRef, updatedAt: NOW - 60_000 },
          'claude:sc-1\ncodex:t-2': { ref: localRef, updatedAt: NOW - 30_000 },
        },
      }),
      'utf8',
    );
    const deps: StatusDeps = {
      listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
      listCodexThreads: async () => [],
      listConversations: () => conversationSummaries({ conversationsFile, sendLogFile: join(dir, 'none.jsonl'), outboxDir: join(dir, 'outbox') }),
      now: () => NOW,
    };
    const ssh = await runStatus(deps, false, true, { via: 'ssh' });
    expect(ssh.split('\n')).toHaveLength(2); // header + the ssh pair only
    expect(ssh).toContain('codex/t-9');
    expect(await runStatus(deps, false, true, { via: 'tcp' })).toBe('会话:\n  (none)');
  });
});

describe('G0 --conversations 柄列', () => {
  function depsWith(handles: Record<string, string> | undefined): StatusDeps {
    const dir = mkdtempSync(join(root, 'case-'));
    const conversationsFile = join(dir, 'conversations.json');
    const record: Record<string, unknown> = { ref: sshRef, updatedAt: NOW - 60_000 };
    if (handles !== undefined) record.handles = handles;
    writeFileSync(conversationsFile, JSON.stringify({ pairs: { 'claude:sc-1\ncodex:t-9': record } }), 'utf8');
    return {
      listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
      listCodexThreads: async () => [],
      listConversations: () => conversationSummaries({ conversationsFile, sendLogFile: join(dir, 'none.jsonl'), outboxDir: join(dir, 'outbox') }),
      now: () => NOW,
    };
  }

  it('有柄行尾显示 cN，无柄显示 -', async () => {
    const withHandle = await runStatus(depsWith({ c3: sshRef }), false, true);
    expect((withHandle.split('\n')[1] ?? '').trimEnd().endsWith('c3')).toBe(true);
    const bare = await runStatus(depsWith(undefined), false, true);
    expect((bare.split('\n')[1] ?? '').trimEnd().endsWith('-')).toBe(true);
  });

  it('--json 剥离柄列、保留完整 ref 字段（八键契约不动）', async () => {
    const parsed = JSON.parse(await runStatus(depsWith({ c3: sshRef }), true, true)) as Array<Record<string, unknown>>;
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
    expect(parsed[0]!.ref).toBe(sshRef);
  });
});

describe('G0 人眼零长引用红线', () => {
  // ≥30 连续 base64 字符 = 长引用泄漏（--json 与分片内部除外）
  const LONG_B64 = /[A-Za-z0-9+/_=-]{30,}/;

  it('三段式/--stars/--conversations/旗标明细/send 人眼输出全无 30+ 连续 base64', async () => {
    const outputs: string[] = [
      await runStatus(summaryDeps({ claude: [claudeEntry('sc-1', 'Mapper', NOW - 60_000)], rows: [convRow({ handle: 'c3' })] }), false),
      await runStatus(summaryDeps(), false, false, {}, undefined, true),
      await runStatus(summaryDeps(), false, true),
      await runStatus(summaryDeps(), false, false, { section: 'claude' }),
      await runStatus(summaryDeps(), false, false, { name: 'x' }),
    ];
    for (const out of outputs) expect(out.match(LONG_B64)).toBeNull();
  });
});
