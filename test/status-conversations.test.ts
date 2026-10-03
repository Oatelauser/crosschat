import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { formatRelativeTime, runStatus, type StatusDeps } from '../src/commands/status.js';
import { conversationSummaries } from '../src/conversation-summary.js';
import { pairKeyOf } from '../src/conversations.js';
import { appendSendLog, type SendLogEntry } from '../src/send-log.js';
import { park } from '../src/outbox.js';
import type { ClaudeSessionEntry } from '../src/claude/registry.js';
import type { CodexThreadWithMeta } from '../src/codex/discovery.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-statusconv-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const NOW = Date.parse('2026-10-03T10:00:00.000Z');
const claudeA = { p: 'claude', id: 'sc-1' } as const;
const codexB = { p: 'codex', id: 't-9' } as const;
const keyAB = pairKeyOf(claudeA, codexB);

const entry = (fields: Partial<SendLogEntry>): SendLogEntry => ({
  ts: '2026-10-03T09:00:00.000Z',
  to: 'peer',
  target: 'codex:t-9',
  status: 'delivered',
  ...fields,
});

/** Deps wired to a temp trio: conversations.json + send-log tail + outbox. */
function deps(
  pairs: Record<string, { ref: string; updatedAt: number }>,
  tail: SendLogEntry[] = [],
  parked = 0,
  confirmReceipt?: (threadId: string, marker: string) => Promise<'confirmed' | 'unconfirmed'>,
  listings?: { claude?: ClaudeSessionEntry[]; codex?: CodexThreadWithMeta[]; codexError?: Error },
): StatusDeps {
  const dir = mkdtempSync(join(root, 'case-'));
  const conversationsFile = join(dir, 'conversations.json');
  const sendLogFile = join(dir, 'send-log.jsonl');
  const outboxDir = join(dir, 'outbox');
  writeFileSync(conversationsFile, JSON.stringify({ pairs }), 'utf8');
  for (const e of tail) appendSendLog(sendLogFile, e);
  for (let i = 0; i < parked; i++) {
    park(outboxDir, 't-9', { envelope: `e-${i}`, toName: 'peer', callerKey: 'claude:sc-1' }, NOW - 60_000);
  }
  return {
    listClaudeSessions: () => ({ sessions: listings?.claude ?? [], malformed: 0 }),
    listCodexThreads: () =>
      listings?.codexError !== undefined
        ? Promise.reject(listings.codexError)
        : Promise.resolve(listings?.codex ?? []),
    listConversations: () => conversationSummaries({ conversationsFile, sendLogFile, outboxDir }),
    confirmReceipt,
    now: () => NOW,
  };
}

const firstRow = async (d: StatusDeps): Promise<string> => {
  const lines = (await runStatus(d, false, true)).split('\n');
  return lines[1] ?? '';
};

describe('status --conversations (text)', () => {
  it('renders the direction arrow via identity slots when both names are display names', async () => {
    const d = deps(
      { [keyAB]: { ref: 'mc1_x', updatedAt: NOW - 3 * 60_000 } },
      [
        entry({ from: 'claude:sc-1', to: '架构', turn: 3 }),
        entry({
          ts: '2026-10-03T09:30:00.000Z',
          from: 'codex:t-9',
          to: 'Alice',
          target: 'claude:sc-1',
          status: 'queued',
          turn: 5,
        }),
      ],
    );
    const text = await runStatus(d, false, true);
    expect(text.split('\n')[0]).toBe('会话:');
    const row = text.split('\n')[1] ?? '';
    expect(row).toContain('架构 → Alice');
    expect(row).toContain('3 分钟前');
    expect(row).toContain('turn 5');
    expect(row).toContain('queued');
    expect(row).not.toContain('滞留');
  });

  it('renders the reverse direction with a raw identity name', async () => {
    const d = deps(
      { [keyAB]: { ref: 'mc1_x', updatedAt: NOW - 2 * 3_600_000 } },
      [entry({ from: 'claude:sc-1', to: '架构', turn: 2 })],
    );
    const row = await firstRow(d);
    expect(row).toContain('claude:sc-1 → 架构');
    expect(row).toContain('2 小时前');
  });

  it('falls back to ↔, turn ? and 未知 for a pair with no tail traffic', async () => {
    const d = deps({ [keyAB]: { ref: 'mc1_x', updatedAt: NOW - 3 * 86_400_000 } });
    const row = await firstRow(d);
    expect(row).toContain('↔');
    expect(row).toContain('turn ?');
    expect(row).toContain('未知');
  });

  it('appends 滞留 N when messages are parked', async () => {
    const d = deps(
      { [keyAB]: { ref: 'mc1_x', updatedAt: NOW - 60_000 } },
      [entry({ from: 'claude:sc-1', turn: 1 })],
      2,
    );
    expect(await firstRow(d)).toContain('滞留 2');
  });

  it('shows absolute MM-DD HH:mm beyond a week', async () => {
    const d = deps({ [keyAB]: { ref: 'mc1_x', updatedAt: NOW - 8 * 86_400_000 } });
    expect(await firstRow(d)).toMatch(/\d{2}-\d{2} \d{2}:\d{2}/);
  });

  it('shows (none) when there are no recorded conversations', async () => {
    expect(await runStatus(deps({}), false, true)).toBe('会话:\n  (none)');
  });
});

describe('status --conversations --json', () => {
  it('outputs the bare eight-field array (endpoints stripped; B22 added receipt)', async () => {
    const d = deps(
      { [keyAB]: { ref: 'mc1_x', updatedAt: NOW - 3 * 60_000 } },
      [entry({ from: 'codex:t-9', to: 'Alice', target: 'claude:sc-1', status: 'parked', turn: 4 })],
    );
    const parsed = JSON.parse(await runStatus(d, true, true)) as Array<Record<string, unknown>>;
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
    expect(parsed[0]).toEqual({
      pair: ['Alice', 'codex:t-9'],
      ref: 'mc1_x',
      updatedAt: NOW - 3 * 60_000,
      turn: 4,
      lastStatus: 'parked',
      lastFrom: 'codex:t-9',
      parked: 0,
      receipt: null,
    });
  });

  it('pure --json keeps the {claude, codex} shape with the conversations dep wired', async () => {
    const parsed = JSON.parse(await runStatus(deps({ [keyAB]: { ref: 'r', updatedAt: NOW } }), true));
    expect(Object.keys(parsed).sort()).toEqual(['claude', 'codex']);
  });
});

describe('status --conversations receipt recheck (B22)', () => {
  it('re-probes an unconfirmed codex delivery with the row ref and flips to 已确认', async () => {
    const probes: Array<[string, string]> = [];
    const d = deps(
      { [keyAB]: { ref: 'mc1_probe', updatedAt: NOW - 60_000 } },
      [entry({ from: 'claude:sc-1', turn: 2, receipt: 'unconfirmed', replyRef: 'mc1_probe' })],
      0,
      async (threadId, marker) => {
        probes.push([threadId, marker]);
        return 'confirmed';
      },
    );
    const row = await firstRow(d);
    expect(probes).toEqual([['t-9', 'mc1_probe']]); // codex endpoint of the pair, row ref as marker
    expect(row).toContain('delivered');
    expect(row).toContain('已确认');
    expect(row).not.toContain('回执未确认');
    // JSON reflects the post-recheck verdict, not the stale log value.
    const parsed = JSON.parse(await runStatus(d, true, true)) as Array<{ receipt: string }>;
    expect(parsed[0]!.receipt).toBe('confirmed');
  });

  it('keeps 回执未确认 when the recheck still cannot see the rollout write', async () => {
    const d = deps(
      { [keyAB]: { ref: 'mc1_slow', updatedAt: NOW - 60_000 } },
      [entry({ from: 'claude:sc-1', turn: 1, receipt: 'unconfirmed', replyRef: 'mc1_slow' })],
      0,
      async () => 'unconfirmed',
    );
    const row = await firstRow(d);
    expect(row).toContain('delivered');
    expect(row).toContain('回执未确认');
  });

  it('skips the recheck for a pair with no codex endpoint (claude has no rollout)', async () => {
    const probes: Array<[string, string]> = [];
    const keyAAC = pairKeyOf(claudeA, { p: 'claude', id: 'sc-2' });
    const d = deps(
      { [keyAAC]: { ref: 'mc1_cc', updatedAt: NOW - 60_000 } },
      [entry({ from: 'claude:sc-1', target: 'claude:sc-2', turn: 3, receipt: 'unconfirmed', replyRef: 'mc1_cc' })],
      0,
      async (threadId, marker) => {
        probes.push([threadId, marker]);
        return 'confirmed';
      },
    );
    const row = await firstRow(d);
    expect(probes).toEqual([]); // nothing probed
    expect(row).toContain('delivered');
    expect(row).toContain('回执未确认'); // log value passes through untouched
  });

  it('does not probe rows that are already confirmed or not delivered', async () => {
    const probes: Array<[string, string]> = [];
    const confirm = async (threadId: string, marker: string) => {
      probes.push([threadId, marker]);
      return 'confirmed';
    };
    const d = deps(
      {
        [keyAB]: { ref: 'mc1_ok', updatedAt: NOW - 60_000 },
        [pairKeyOf(claudeA, { p: 'claude', id: 'sc-3' })]: { ref: 'mc1_q', updatedAt: NOW - 120_000 },
      },
      [
        entry({ ts: '2026-10-03T09:00:00.000Z', from: 'claude:sc-1', turn: 1, receipt: 'confirmed', replyRef: 'mc1_ok' }),
        entry({ ts: '2026-10-03T08:00:00.000Z', from: 'claude:sc-1', target: 'claude:sc-3', status: 'queued', turn: 2 }),
      ],
      0,
      confirm,
    );
    const text = await runStatus(d, false, true);
    expect(probes).toEqual([]);
    expect(text).toContain('已确认');
    expect(text).not.toContain('回执未确认');
    expect(text).toContain('queued');
  });
});

describe('status --conversations bare-slot translation (B23)', () => {
  const claudeEntry = (id: string, name?: string): ClaudeSessionEntry => ({
    pid: 1,
    sessionId: id,
    kind: 'interactive',
    status: 'idle',
    messagingSocketPath: `sock-${id}`,
    name,
  });
  const codexEntry = (id: string, name: string | null): CodexThreadWithMeta => ({
    id,
    name,
    status: 'idle',
  });

  it('text: translates bare identity-key slots (claude:<id> and codex:<id>) into display names', async () => {
    const d = deps(
      { [keyAB]: { ref: 'mc1_x', updatedAt: NOW - 60_000 } },
      [entry({ from: 'codex:t-9', target: 'claude:sc-1', to: 'Alice', turn: 2 })],
      0,
      undefined,
      { claude: [claudeEntry('sc-1', 'Alice')], codex: [codexEntry('t-9', 'drill线程')] },
    );
    const row = await firstRow(d);
    expect(row).toContain('drill线程 → Alice'); // lastFrom codex:t-9 → pair[1] first
    expect(row).not.toContain('codex:t-9');
  });

  it('text: translates bare id8 descriptor slots (claude/<id8>, codex/<id8>) for tail-less pairs', async () => {
    const d = deps(
      { [keyAB]: { ref: 'mc1_x', updatedAt: NOW - 60_000 } },
      [],
      0,
      undefined,
      { claude: [claudeEntry('sc-1', 'Alice')], codex: [codexEntry('t-9', 'drill线程')] },
    );
    const row = await firstRow(d);
    expect(row).toContain('Alice ↔ drill线程');
    expect(row).not.toContain('claude/');
    expect(row).not.toContain('codex/');
  });

  it('keeps evidence display names: a to-name slot is never overwritten by the registry', async () => {
    const d = deps(
      { [keyAB]: { ref: 'mc1_x', updatedAt: NOW - 60_000 } },
      [entry({ from: 'claude:sc-1', to: '架构改造3', turn: 1 })],
      0,
      undefined,
      { claude: [claudeEntry('sc-1', 'Alice')], codex: [codexEntry('t-9', 'drill线程')] },
    );
    const row = await firstRow(d);
    expect(row).toContain('Alice → 架构改造3'); // bare claude slot translated, evidence name kept
    expect(row).not.toContain('drill线程');
  });

  it('degrades silently when the codex listing fails: no crash, codex slots untranslated', async () => {
    const d = deps(
      { [keyAB]: { ref: 'mc1_x', updatedAt: NOW - 60_000 } },
      [],
      0,
      undefined,
      { claude: [claudeEntry('sc-1', 'Alice')], codexError: new Error('codex down') },
    );
    const text = await runStatus(d, false, true);
    expect(text).not.toContain('unavailable');
    expect(text.split('\n')[1] ?? '').toContain('Alice ↔ codex/t-9'); // claude translated, codex bare
  });

  it('json: translated pair keeps the eight-field shape and lastFrom stays an identity key', async () => {
    const d = deps(
      { [keyAB]: { ref: 'mc1_x', updatedAt: NOW - 60_000 } },
      [entry({ from: 'codex:t-9', target: 'claude:sc-1', to: 'Alice', status: 'parked', turn: 4 })],
      0,
      undefined,
      { codex: [codexEntry('t-9', 'drill线程')] },
    );
    const parsed = JSON.parse(await runStatus(d, true, true)) as Array<Record<string, unknown>>;
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
    expect(parsed[0]!.pair).toEqual(['Alice', 'drill线程']);
    expect(parsed[0]!.lastFrom).toBe('codex:t-9');
  });
});

describe('formatRelativeTime', () => {
  it('rounds minutes and steps up through hours and days to absolute', () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe('1 分钟前');
    expect(formatRelativeTime(NOW - 90_000, NOW)).toBe('2 分钟前');
    expect(formatRelativeTime(NOW - 3 * 60_000, NOW)).toBe('3 分钟前');
    expect(formatRelativeTime(NOW - 2 * 3_600_000, NOW)).toBe('2 小时前');
    expect(formatRelativeTime(NOW - 3 * 86_400_000, NOW)).toBe('3 天前');
    expect(formatRelativeTime(NOW - 8 * 86_400_000, NOW)).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});
