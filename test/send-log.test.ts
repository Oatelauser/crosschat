import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { appendSendLog, confirmInRollout, defaultSendLogFile, readSendLogTail } from '../src/send-log.js';
import { findRolloutFile } from '../src/codex/rollout-meta.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-sendlog-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const freshDir = (): string => mkdtempSync(join(root, 'case-'));

describe('appendSendLog', () => {
  it('appends one JSON line per entry and never throws on a bad path', () => {
    const file = join(freshDir(), 'send-log.jsonl');
    appendSendLog(file, {
      ts: '2026-10-03T05:00:00.000Z',
      to: 'workteam',
      target: 'codex:t-1',
      status: 'queued',
      turn: 1,
      replyRef: 'mc1_x',
      receipt: 'confirmed',
    });
    appendSendLog(file, {
      ts: '2026-10-03T05:01:00.000Z',
      to: 'workteam',
      target: 'codex:t-1',
      status: 'failed',
      code: 'CODEX_TURN_REJECTED',
    });
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ status: 'queued', receipt: 'confirmed' });
    expect(JSON.parse(lines[1]!)).toMatchObject({ status: 'failed', code: 'CODEX_TURN_REJECTED' });
    expect(() => appendSendLog(join(freshDir(), 'nope', 'deep', 'x.jsonl'), {
      ts: 'x', to: 'a', target: 'claude:1', status: 'delivered',
    })).not.toThrow();
  });

  it('round-trips the optional fromName field through the tail reader (B21)', () => {
    const file = join(freshDir(), 'send-log.jsonl');
    appendSendLog(file, {
      ts: '2026-10-03T06:00:00.000Z',
      from: 'claude:cs-1',
      fromName: '代码优化3',
      to: 'workteam',
      target: 'codex:t-1',
      status: 'delivered',
      turn: 2,
    });
    expect(readSendLogTail(file)).toEqual([
      expect.objectContaining({ from: 'claude:cs-1', fromName: '代码优化3', status: 'delivered' }),
    ]);
  });

  it('defaultSendLogFile lives under the crosschat state root', () => {
    expect(defaultSendLogFile()).toMatch(/crosschat[\\/]send-log\.jsonl$/);
  });

  it('caps the file past 5MiB, keeping whole tail lines and the new entry', () => {
    const file = join(freshDir(), 'send-log.jsonl');
    const filler = JSON.stringify({ ts: 'old', to: 'x', target: 'codex:t', status: 'delivered' });
    const lineLen = Buffer.byteLength(`${filler}\n`, 'utf8');
    writeFileSync(file, `${filler}\n`.repeat(Math.ceil((5 * 1024 * 1024 + 4096) / lineLen)), 'utf8');
    appendSendLog(file, { ts: '2026-10-06T00:00:00.000Z', to: 'new', target: 'codex:t-9', status: 'parked' });
    const text = readFileSync(file, 'utf8');
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(2 * 1024 * 1024);
    const lines = text.trim().split('\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    expect(JSON.parse(lines[lines.length - 1]!)).toMatchObject({ to: 'new', status: 'parked' });
  });
});

describe('confirmInRollout', () => {
  it('confirms once the marker lands in the rollout, including a late write', async () => {
    const home = freshDir();
    const dayDir = join(home, 'sessions', '2026', '10', '03');
    mkdirSync(dayDir, { recursive: true });
    const threadId = 'aaaa1111-0000-0000-0000-000000000000';
    const rollout = join(dayDir, `rollout-2026-10-03T05-00-00-${threadId}.jsonl`);
    writeFileSync(rollout, '{"payload":{"type":"session_meta"}}\n', 'utf8');
    expect(findRolloutFile(home, threadId)).toBe(rollout);
    // The rollout write lags the turn/start acceptance: marker appears after ~2 polls.
    setTimeout(() => {
      appendFileSyncUtf8(rollout, '{"payload":{"type":"message","content":[{"text":"reply-ref: mc1_marker_abc"}]}}\n');
    }, 450);
    const verdict = await confirmInRollout(home, threadId, 'mc1_marker_abc', { tries: 8, delayMs: 150 });
    expect(verdict).toBe('confirmed');
  });

  it('returns unconfirmed (never throws) when the marker never shows up', async () => {
    const home = freshDir();
    const verdict = await confirmInRollout(home, 'bbbb2222-0000-0000-0000-000000000000', 'nope', {
      tries: 2,
      delayMs: 10,
    });
    expect(verdict).toBe('unconfirmed');
  });
});

function appendFileSyncUtf8(path: string, text: string): void {
  writeFileSync(path, readFileSync(path, 'utf8') + text, 'utf8');
}
