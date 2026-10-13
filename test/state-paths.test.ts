/** 014：stateRoot 单一来源（全平台 ~/.crosschat）+ 各 default* 引用同一来源 + 旧院清单 + 日志轮转。 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { legacyStateRoots, stateRoot } from '../src/state-root.js';
import { defaultConversationsFile } from '../src/conversations.js';
import { defaultOutboxDir } from '../src/outbox.js';
import { defaultSendLogFile } from '../src/send-log.js';
import { appendWithRotate, ROTATE_MAX_BYTES } from '../src/log-rotate.js';

describe('stateRoot single source', () => {
  it('is <home>/.crosschat for any injected home — same shape on every platform', () => {
    for (const home of ['/home/a', '/Users/b', 'C:\\Users\\c']) {
      expect(stateRoot(home)).toBe(join(home, '.crosschat'));
    }
  });

  it('ignores LOCALAPPDATA entirely (the pre-014 win split is gone)', () => {
    const before = stateRoot('/home/a');
    process.env.LOCALAPPDATA = 'C:\\Some\\AppData';
    try {
      expect(stateRoot('/home/a')).toBe(before);
    } finally {
      delete process.env.LOCALAPPDATA;
    }
  });

  it('every default* state path lands under stateRoot', () => {
    expect(defaultConversationsFile()).toBe(join(stateRoot(), 'conversations.json'));
    expect(defaultOutboxDir()).toBe(join(stateRoot(), 'outbox'));
    expect(defaultSendLogFile()).toBe(join(stateRoot(), 'send-log.jsonl'));
  });
});

describe('legacyStateRoots (uninstall-only cleanup targets)', () => {
  it('unix: the dotless home sibling only', () => {
    expect(legacyStateRoots('/home/a', {})).toEqual([join('/home/a', 'crosschat')]);
  });

  it('win-style env adds the LOCALAPPDATA court, deduped when they coincide', () => {
    expect(legacyStateRoots('/home/a', { LOCALAPPDATA: 'C:\\LA' })).toEqual([
      join('/home/a', 'crosschat'),
      join('C:\\LA', 'crosschat'),
    ]);
    expect(legacyStateRoots('/home/a', { LOCALAPPDATA: '/home/a' })).toEqual([join('/home/a', 'crosschat')]);
  });
});

const rotRoot = mkdtempSync(join(tmpdir(), 'crosschat-rotate-'));
afterAll(() => rmSync(rotRoot, { recursive: true, force: true }));

describe('appendWithRotate', () => {
  it('rotates past 5MB: current file restarts with the append, .old keeps the bulk', () => {
    const file = join(mkdtempSync(join(rotRoot, 'c-')), 'log.jsonl');
    const bulk = 'x'.repeat(1024);
    writeFileSync(file, `${bulk}\n`.repeat(Math.ceil((ROTATE_MAX_BYTES + 4096) / (bulk.length + 1))), 'utf8');
    const oldSize = readFileSync(file, 'utf8').length;
    appendWithRotate(file, 'new-line\n');
    expect(readFileSync(file, 'utf8')).toBe('new-line\n');
    expect(readFileSync(`${file}.old`, 'utf8').length).toBe(oldSize);
  });

  it('under the cap: plain append, no .old is ever created', () => {
    const file = join(mkdtempSync(join(rotRoot, 'c-')), 'log.jsonl');
    appendWithRotate(file, 'a\n');
    appendWithRotate(file, 'b\n');
    expect(readFileSync(file, 'utf8')).toBe('a\nb\n');
    expect(existsSync(`${file}.old`)).toBe(false);
  });

  it('overwrites a previous .old (win rename cannot, hence the unlink)', () => {
    const file = join(mkdtempSync(join(rotRoot, 'c-')), 'log.jsonl');
    writeFileSync(`${file}.old`, 'stale-old', 'utf8');
    writeFileSync(file, 'y'.repeat(ROTATE_MAX_BYTES + 1), 'utf8');
    appendWithRotate(file, 'tail\n');
    expect(readFileSync(file, 'utf8')).toBe('tail\n');
    expect(readFileSync(`${file}.old`, 'utf8')).toBe('y'.repeat(ROTATE_MAX_BYTES + 1));
  });

  it('a failed rotation never blocks the append', () => {
    const dir = mkdtempSync(join(rotRoot, 'c-'));
    const file = join(dir, 'log.jsonl');
    writeFileSync(file, 'y'.repeat(ROTATE_MAX_BYTES + 1), 'utf8');
    // .old occupied by a directory: rmSync(force) refuses dirs → rotation aborts
    mkdirSync(`${file}.old`);
    appendWithRotate(file, 'still appends\n');
    expect(readFileSync(file, 'utf8')).toBe('y'.repeat(ROTATE_MAX_BYTES + 1) + 'still appends\n');
  });
});
