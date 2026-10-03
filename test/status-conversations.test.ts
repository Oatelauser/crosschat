import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { formatRelativeTime, runStatus, type StatusDeps } from '../src/commands/status.js';
import { conversationSummaries } from '../src/conversation-summary.js';
import { pairKeyOf } from '../src/conversations.js';
import { appendSendLog, type SendLogEntry } from '../src/send-log.js';
import { park } from '../src/outbox.js';

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
    listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
    listCodexThreads: () => Promise.resolve([]),
    listConversations: () => conversationSummaries({ conversationsFile, sendLogFile, outboxDir }),
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
  it('outputs the bare seven-field array (endpoints stripped)', async () => {
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
    });
  });

  it('pure --json keeps the {claude, codex} shape with the conversations dep wired', async () => {
    const parsed = JSON.parse(await runStatus(deps({ [keyAB]: { ref: 'r', updatedAt: NOW } }), true));
    expect(Object.keys(parsed).sort()).toEqual(['claude', 'codex']);
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
