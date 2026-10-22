import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { appendSendLog, confirmInRollout, createReceiptMarker, defaultSendLogFile, readSendLogTail } from '../src/send-log.js';
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

  it('persists only target-bound envelope evidence for later probes, without the message body', () => {
    const file = join(freshDir(), 'send-log.jsonl');
    const envelope = 'private receipt probe body 中文';
    const receiptMarker = createReceiptMarker('t-1', envelope);
    appendSendLog(file, { ts: '2026-10-03T06:00:00.000Z', to: 'peer', target: 'codex:t-1', status: 'delivered', receipt: 'unconfirmed', receiptMarker });
    expect(readSendLogTail(file)[0]?.receiptMarker).toBe(receiptMarker);
    expect(readFileSync(file, 'utf8')).not.toContain(envelope);
    expect(receiptMarker).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(createReceiptMarker('other-target', envelope)).not.toBe(receiptMarker);
  });

  it('defaultSendLogFile lives under the unified ~/.crosschat state root', () => {
    expect(defaultSendLogFile()).toMatch(/\.crosschat[\\/]send-log\.jsonl$/);
  });

  it('rotates past 5MiB instead of truncating: the bulk moves whole to .old, the new entry starts a fresh file', () => {
    const file = join(freshDir(), 'send-log.jsonl');
    const filler = JSON.stringify({ ts: 'old', to: 'x', target: 'codex:t', status: 'delivered' });
    const lineLen = Buffer.byteLength(`${filler}\n`, 'utf8');
    writeFileSync(file, `${filler}\n`.repeat(Math.ceil((5 * 1024 * 1024 + 4096) / lineLen)), 'utf8');
    const bulkBytes = Buffer.byteLength(readFileSync(file, 'utf8'), 'utf8');
    appendSendLog(file, { ts: '2026-10-06T00:00:00.000Z', to: 'new', target: 'codex:t-9', status: 'parked' });
    const text = readFileSync(file, 'utf8');
    expect(text.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(text)).toMatchObject({ to: 'new', status: 'parked' });
    // history is preserved verbatim in .old (014: 轮转不截断)
    expect(Buffer.byteLength(readFileSync(`${file}.old`, 'utf8'), 'utf8')).toBe(bulkBytes);
    for (const line of readFileSync(`${file}.old`, 'utf8').trim().split('\n')) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    // 慢机先例（同 f111d39 重连窗口）：5MiB 同步写+三次全量读在 CI 慢盘上可拖过默认 5s
  }, 20_000);
});

describe('confirmInRollout', () => {
  it('confirms the actual short-handle envelope after decoding its user message JSON', async () => {
    const home = freshDir();
    const dayDir = join(home, 'sessions', '2026', '10', '03');
    mkdirSync(dayDir, { recursive: true });
    const threadId = 'aaaa1111-0000-0000-0000-000000000000';
    const rollout = join(dayDir, `rollout-2026-10-03T05-00-00-${threadId}.jsonl`);
    const envelope = '<cross-session-message from-name="测试" turn="2">\n<crosschat-reply-hint>crosschat send --conversation c6</crosschat-reply-hint>\n正文 "quotes" \\path 😀\n</cross-session-message>';
    writeFileSync(rollout, `${JSON.stringify({ type: 'response_item', payload: {
      type: 'message', role: 'user', content: [{ type: 'input_text', text: envelope }],
    } })}\n`, 'utf8');
    expect(await confirmInRollout(home, threadId, createReceiptMarker(threadId, envelope), {
      tries: 1, delayMs: 0,
    })).toBe('confirmed');
  });

  it('confirms an event user message after its late rollout write', async () => {
    const home = freshDir();
    const dayDir = join(home, 'sessions', '2026', '10', '03');
    mkdirSync(dayDir, { recursive: true });
    const threadId = 'aaaa1111-0000-0000-0000-000000000000';
    const rollout = join(dayDir, `rollout-2026-10-03T05-00-00-${threadId}.jsonl`);
    writeFileSync(rollout, '{"payload":{"type":"session_meta"}}\n', 'utf8');
    expect(findRolloutFile(home, threadId)).toBe(rollout);
    const envelope = '<cross-session-message turn="3">\nlate receipt, reply using c6\n</cross-session-message>';
    // The rollout write lags the turn/start acceptance.
    setTimeout(() => {
      appendFileSyncUtf8(rollout, `${JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: envelope } })}\n`);
    }, 30);
    const verdict = await confirmInRollout(home, threadId, createReceiptMarker(threadId, envelope), { tries: 8, delayMs: 20 });
    expect(verdict).toBe('confirmed');
  });

  it('does not confuse a reused handle, assistant/tool text or another recipient with the sent envelope', async () => {
    const home = freshDir();
    const dayDir = join(home, 'sessions', '2026', '10', '03');
    mkdirSync(dayDir, { recursive: true });
    const threadId = 'cccc3333-0000-0000-0000-000000000000';
    const rollout = join(dayDir, `rollout-2026-10-03T05-00-00-${threadId}.jsonl`);
    const envelope = '<cross-session-message turn="4">\nreply using c6\nnew body\n</cross-session-message>';
    const marker = createReceiptMarker(threadId, envelope);
    writeFileSync(rollout, [
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: envelope.replace('new body', 'old body') }] } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: envelope }] } },
      { type: 'response_item', payload: { type: 'function_call_output', output: envelope } },
      { type: 'event_msg', payload: { type: 'agent_message', message: envelope } },
      { type: 'turn_context', payload: { turn_id: 'same-busy-turn', marker } },
    ].map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
    expect(await confirmInRollout(home, threadId, marker, { tries: 1, delayMs: 0 })).toBe('unconfirmed');
    appendFileSyncUtf8(rollout, `${JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: envelope } })}\n`);
    expect(await confirmInRollout(home, threadId, createReceiptMarker('other-target', envelope), { tries: 1, delayMs: 0 })).toBe('unconfirmed');
  });

  it('decodes user text across UTF-8 chunk boundaries and ignores partial or malformed records', async () => {
    const home = freshDir();
    const dayDir = join(home, 'sessions', '2026', '10', '03');
    mkdirSync(dayDir, { recursive: true });
    const threadId = 'dddd4444-0000-0000-0000-000000000000';
    const rollout = join(dayDir, `rollout-2026-10-03T05-00-00-${threadId}.jsonl`);
    const envelope = '😀中文'.repeat(9000) + '\n"quoted" \\path';
    const record = JSON.stringify({ type: 'response_item', payload: {
      type: 'message', role: 'user', content: [{ type: 'input_text', text: envelope }],
    } });
    writeFileSync(rollout, `invalid JSON\n${record}`, 'utf8');
    const marker = createReceiptMarker(threadId, envelope);
    expect(await confirmInRollout(home, threadId, marker, { tries: 1, delayMs: 0 })).toBe('unconfirmed');
    appendFileSyncUtf8(rollout, '\n');
    expect(await confirmInRollout(home, threadId, marker, { tries: 1, delayMs: 0 })).toBe('confirmed');
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
