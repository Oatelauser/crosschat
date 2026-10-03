import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  aggregateSummaries,
  conversationSummaries,
} from '../src/conversation-summary.js';
import { appendSendLog, readSendLogTail, type SendLogEntry } from '../src/send-log.js';
import { pairKeyOf } from '../src/conversations.js';
import { park } from '../src/outbox.js';
import { encodeRef, newConversationRef } from '../src/ref.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-convsum-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const freshDir = (): string => mkdtempSync(join(root, 'case-'));

const claudeA = { p: 'claude', id: 'cs-1' } as const;
const codexB = { p: 'codex', id: 't-1' } as const;
const keyAB = pairKeyOf(claudeA, codexB);
const claudeC = { p: 'claude', id: 'abcdefghijklmnop' } as const;
const codexD = { p: 'codex', id: 'qrstuvwxyz12' } as const;
const keyCD = pairKeyOf(claudeC, codexD);

const entry = (fields: Partial<SendLogEntry>): SendLogEntry => ({
  ts: '2026-10-03T05:00:00.000Z',
  to: 'worker',
  target: 'codex:t-1',
  status: 'delivered',
  ...fields,
});

describe('readSendLogTail', () => {
  it('reads only the trailing window of a 500-line file', () => {
    const file = join(freshDir(), 'send-log.jsonl');
    const lines: string[] = [];
    for (let i = 1; i <= 500; i++) lines.push(JSON.stringify(entry({ turn: i })));
    writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
    const got = readSendLogTail(file, 200);
    expect(got).toHaveLength(200);
    expect(got[0]!.turn).toBe(301);
    expect(got[199]!.turn).toBe(500);
  });

  it('parses a final line without a trailing newline', () => {
    const file = join(freshDir(), 'send-log.jsonl');
    writeFileSync(
      file,
      `${JSON.stringify(entry({ turn: 1 }))}\n${JSON.stringify(entry({ turn: 2, to: 'last' }))}`,
      'utf8',
    );
    const got = readSendLogTail(file);
    expect(got).toHaveLength(2);
    expect(got[1]!.to).toBe('last');
  });

  it('drops the fragment cut at the window edge', () => {
    const file = join(freshDir(), 'send-log.jsonl');
    // First line is huge so the backward 64KB window lands mid-line inside it.
    const huge = JSON.stringify(entry({ turn: 0, to: 'x'.repeat(70_000) }));
    const lines: string[] = [];
    for (let i = 1; i <= 201; i++) lines.push(JSON.stringify(entry({ turn: i })));
    writeFileSync(file, `${huge}\n${lines.join('\n')}\n`, 'utf8');
    const got = readSendLogTail(file, 200);
    expect(got).toHaveLength(200);
    expect(got[0]!.turn).toBe(2);
    expect(got[199]!.turn).toBe(201);
  });

  it('skips unparsable lines and reads a missing file as empty', () => {
    const file = join(freshDir(), 'send-log.jsonl');
    writeFileSync(
      file,
      `${JSON.stringify(entry({ turn: 1 }))}\nnot json\n${JSON.stringify(entry({ turn: 2 }))}\n`,
      'utf8',
    );
    expect(readSendLogTail(file)).toHaveLength(2);
    expect(readSendLogTail(join(freshDir(), 'none.jsonl'))).toEqual([]);
  });
});

describe('aggregateSummaries', () => {
  it('merges both directions: max turn, ts-latest status/from, entry-based names', () => {
    const pairs = {
      [keyAB]: { ref: 'mc1_ab', updatedAt: 2_000 },
      [keyCD]: { ref: 'mc1_cd', updatedAt: 1_000 },
    };
    const tail: SendLogEntry[] = [
      entry({ ts: '2026-10-03T05:00:00.000Z', from: 'claude:cs-1', turn: 3 }),
      entry({
        ts: '2026-10-03T06:00:00.000Z',
        from: 'codex:t-1',
        to: 'Alice',
        target: 'claude:cs-1',
        status: 'queued',
        turn: 5,
      }),
      // Physically last but ts-older: must not win lastStatus/lastFrom.
      entry({ ts: '2026-10-03T04:00:00.000Z', from: 'claude:cs-1', status: 'failed', code: 'X', turn: 2 }),
    ];
    const rows = aggregateSummaries(pairs, tail, new Map([[keyAB, 2]]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      pair: ['Alice', 'worker'],
      ref: 'mc1_ab',
      updatedAt: 2_000,
      turn: 5,
      lastStatus: 'queued',
      lastFrom: 'codex:t-1',
      parked: 2,
    });
    expect(rows[1]).toMatchObject({ ref: 'mc1_cd', turn: null, lastStatus: null, lastFrom: null, parked: 0 });
  });

  it('yields null fields and id8-style descriptor names for a pair absent from the tail', () => {
    const rows = aggregateSummaries({ [keyCD]: { ref: 'mc1_cd', updatedAt: 1 } }, [], new Map());
    expect(rows).toEqual([
      {
        pair: ['claude/abcdefgh', 'codex/qrstuvwx'],
        endpoints: ['claude:abcdefghijklmnop', 'codex:qrstuvwxyz12'],
        ref: 'mc1_cd',
        updatedAt: 1,
        turn: null,
        lastStatus: null,
        lastFrom: null,
        parked: 0,
      },
    ]);
  });

  it('drops send-log traffic for pairs not recorded in conversations.json', () => {
    const rows = aggregateSummaries(
      { [keyAB]: { ref: 'r', updatedAt: 1 } },
      [entry({ from: 'claude:zz', target: 'codex:qq', to: 'stranger', turn: 9 })],
      new Map(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.turn).toBeNull();
  });

  it('attributes pre-B16 entries (no from) via their embedded replyRef', () => {
    const ref = newConversationRef(claudeA, codexB);
    const rows = aggregateSummaries(
      { [keyAB]: { ref: 'r', updatedAt: 1 } },
      [entry({ replyRef: encodeRef(ref), turn: 4, status: 'parked' })],
      new Map(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.turn).toBe(4);
    expect(rows[0]!.lastFrom).toBeNull();
  });
});

describe('conversationSummaries', () => {
  it('joins all three sources from disk (conversations + send-log + outbox)', () => {
    const dir = freshDir();
    const conversationsFile = join(dir, 'conversations.json');
    const sendLogFile = join(dir, 'send-log.jsonl');
    const outboxDir = join(dir, 'outbox');
    writeFileSync(
      conversationsFile,
      JSON.stringify({ pairs: { [keyAB]: { ref: 'mc1_live', updatedAt: 5_000 } } }),
      'utf8',
    );
    appendSendLog(
      sendLogFile,
      entry({ ts: '2026-10-03T07:00:00.000Z', from: 'claude:cs-1', status: 'delivered', turn: 7, replyRef: 'mc1_x' }),
    );
    park(outboxDir, 't-1', { envelope: 'env-1', toName: 'worker', callerKey: 'claude:cs-1' }, 1_000);
    park(outboxDir, 't-1', { envelope: 'env-2', toName: 'worker', callerKey: 'claude:cs-1' }, 2_000);
    expect(conversationSummaries({ conversationsFile, sendLogFile, outboxDir })).toEqual([
      {
        pair: ['claude:cs-1', 'worker'],
        endpoints: ['claude:cs-1', 'codex:t-1'],
        ref: 'mc1_live',
        updatedAt: 5_000,
        turn: 7,
        lastStatus: 'delivered',
        lastFrom: 'claude:cs-1',
        parked: 2,
      },
    ]);
  });

  it('returns no rows when conversations.json is missing', () => {
    const dir = freshDir();
    expect(
      conversationSummaries({
        conversationsFile: join(dir, 'none.json'),
        sendLogFile: join(dir, 'none.jsonl'),
        outboxDir: join(dir, 'outbox'),
      }),
    ).toEqual([]);
  });
});
