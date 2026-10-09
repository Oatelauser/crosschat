import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { drainOutboxAtEntry, parseSendArgs, parseStatusArgs } from '../src/cli.js';
import { park } from '../src/outbox.js';
import { MultichatError } from '../src/errors.js';

function expectUsage(fn: () => unknown, needle: string): void {
  try {
    fn();
    expect.unreachable('should have thrown USAGE');
  } catch (err) {
    expect(err).toBeInstanceOf(MultichatError);
    const me = err as MultichatError;
    expect(me.code).toBe('USAGE');
    expect(me.message).toContain(needle);
  }
}

describe('parseSendArgs', () => {
  it('parses space-separated values', () => {
    expect(parseSendArgs(['--to', 'alpha', '--body', 'hello there'])).toEqual({
      to: 'alpha',
      bodyArg: 'hello there',
    });
  });

  it('parses --opt=value forms', () => {
    expect(parseSendArgs(['--to=alpha', '--body=hi', '--conversation=mc1_x'])).toEqual({
      to: 'alpha',
      bodyArg: 'hi',
      conversation: 'mc1_x',
    });
  });

  it('parses --json as a flag', () => {
    expect(parseSendArgs(['--json'])).toEqual({ json: true });
    expect(parseSendArgs(['--to', 'a', '--json'])).toEqual({ to: 'a', json: true });
  });

  it('keeps the last value when an option repeats', () => {
    expect(parseSendArgs(['--to', 'a', '--to', 'b'])).toEqual({ to: 'b' });
  });

  it('accepts an empty --body value (runtime rejects it as BODY_REQUIRED)', () => {
    expect(parseSendArgs(['--to', 'a', '--body='])).toEqual({ to: 'a', bodyArg: '' });
  });

  it('rejects unknown options, missing values, and positionals', () => {
    expectUsage(() => parseSendArgs(['--wat']), 'unknown option');
    expectUsage(() => parseSendArgs(['--to']), 'requires a value');
    expectUsage(() => parseSendArgs(['alpha']), 'unexpected argument');
    expectUsage(() => parseSendArgs(['--json=true']), 'takes no value');
    expectUsage(() => parseSendArgs(['--conversation']), 'requires a value');
  });

  it('parses --max-body-kb / --max-turn as raw strings (space and = forms)', () => {
    // 数值校验在 limits.ts（非法静默降级），解析层只留原文。
    expect(parseSendArgs(['--to', 'a', '--max-body-kb', '32', '--max-turn', '40'])).toEqual({
      to: 'a',
      maxBodyKb: '32',
      maxTurn: '40',
    });
    expect(parseSendArgs(['--max-body-kb=64', '--max-turn=60'])).toEqual({
      maxBodyKb: '64',
      maxTurn: '60',
    });
    expectUsage(() => parseSendArgs(['--max-body-kb']), 'requires a value');
    expectUsage(() => parseSendArgs(['--max-turn']), 'requires a value');
  });
});

describe('parseStatusArgs', () => {
  it('accepts nothing, --json, --conversations, or both', () => {
    expect(parseStatusArgs([])).toEqual({ json: false, conversations: false });
    expect(parseStatusArgs(['--json'])).toEqual({ json: true, conversations: false });
    expect(parseStatusArgs(['--conversations'])).toEqual({ json: false, conversations: true });
    expect(parseStatusArgs(['--conversations', '--json'])).toEqual({ json: true, conversations: true });
  });

  it('rejects anything else', () => {
    expectUsage(() => parseStatusArgs(['--to', 'x']), 'only --json');
    expectUsage(() => parseStatusArgs(['--json', '--json']), 'only --json');
    expectUsage(() => parseStatusArgs(['--conversations', '--conversations']), 'only --json');
    expectUsage(() => parseStatusArgs(['--wat']), 'only --json');
  });
});

describe('drainOutboxAtEntry', () => {
  const outboxDir = mkdtempSync(join(tmpdir(), 'crosschat-cli-drain-'));
  const rateDir = mkdtempSync(join(tmpdir(), 'crosschat-cli-rate-'));
  afterAll(() => {
    rmSync(outboxDir, { recursive: true, force: true });
    rmSync(rateDir, { recursive: true, force: true });
  });

  function run(
    deliverCodex: (threadId: string, content: string, busyTimeoutMs: number) => Promise<unknown>,
  ) {
    const lines: string[] = [];
    return drainOutboxAtEntry({
      outboxDir,
      rateDir,
      deliverCodex,
      err: (line) => lines.push(line),
    }).then(() => lines);
  }

  it('reports one stderr line per relieved thread, with the short drain wait', async () => {
    park(outboxDir, 't-cli-1', { envelope: 'e-1', toName: 'alpha' });
    park(outboxDir, 't-cli-1', { envelope: 'e-2', toName: 'alpha' });
    const calls: number[] = [];
    const lines = await run(async (_id, _c, busyTimeoutMs) => {
      calls.push(busyTimeoutMs);
    });
    expect(lines).toEqual(['outbox: 补投 2 条给 alpha']);
    expect(calls).toEqual([5_000, 5_000]);
  });

  it('stays silent when nothing was parked or nothing went through', async () => {
    expect(await run(async () => undefined)).toEqual([]);
    park(outboxDir, 't-cli-stuck', { envelope: 's-1', toName: 'beta' });
    const lines = await run(async () => {
      throw new MultichatError('CODEX_THREAD_BUSY_TIMEOUT', 'still busy');
    });
    expect(lines).toEqual([]);
  });

  it('dead-letters a deleted thread with one stderr line', async () => {
    park(outboxDir, 't-cli-dead', { envelope: 'd-1', toName: 'gamma' });
    park(outboxDir, 't-cli-dead', { envelope: 'd-2', toName: 'gamma' });
    const lines = await run(async (threadId) => {
      if (threadId === 't-cli-dead') {
        throw new MultichatError('CODEX_THREAD_NOT_FOUND', 'Codex thread t-cli-dead 不存在（可能已删除），无法投递。');
      }
      throw new MultichatError('CODEX_THREAD_BUSY_TIMEOUT', 'still busy');
    });
    expect(lines).toEqual(['outbox: 线程 t-cli-dead 已不存在，丢弃 2 条暂存消息']);
    expect(existsSync(join(outboxDir, 't-cli-dead.json'))).toBe(false);
  });
});
