import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drain, mailboxFileFor, outboxCount, park } from '../src/outbox.js';
import { MultichatError } from '../src/errors.js';

const directories: string[] = [];
function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'crosschat-outbox-owner-'));
  directories.push(directory);
  return directory;
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('outbox delivery ownership', () => {
  it.each(['../outside', '..\\outside', '/outside', '\\outside', 'drive:outside', 'nul\0tail', '.', '..', ''])('rejects unsafe thread path components before touching files: %j', (threadId) => {
    const directory = fixture();
    const outbox = join(directory, 'outbox');
    const outsideJson = join(directory, 'outside.json');
    const outsideMailbox = join(directory, 'outside.md');
    writeFileSync(outsideJson, 'outside JSON sentinel');
    writeFileSync(outsideMailbox, 'outside mailbox sentinel');
    for (const operation of [
      () => park(outbox, threadId, { envelope: 'must stay inside', toName: 'target' }),
      () => outboxCount(outbox, threadId),
      () => mailboxFileFor(outbox, threadId),
    ]) expect(operation).toThrowError(expect.objectContaining({ code: 'OUTBOX_INVALID_THREAD_ID' }));
    expect(readFileSync(outsideJson, 'utf8')).toBe('outside JSON sentinel');
    expect(readFileSync(outsideMailbox, 'utf8')).toBe('outside mailbox sentinel');
    expect(readdirSync(directory).sort()).toEqual(['outside.json', 'outside.md']);
  });

  it('keeps non-UUID names and punctuation on their unchanged filename keys', async () => {
    const directory = fixture();
    const threadId = 'native id_+@=..tail';
    park(directory, threadId, { envelope: 'input', toName: 'target' });
    expect(readdirSync(directory).filter((file) => file.endsWith('.json'))).toEqual([`${threadId}.json`]);
    expect(mailboxFileFor(directory, threadId)).toBe(join(directory, '..', 'mailbox', `${threadId}.md`));
    const deliver = vi.fn(async () => undefined);
    await drain(directory, deliver);
    expect(deliver).toHaveBeenCalledWith(threadId, 'input', expect.any(Number), { mode: 'queue' });
    expect(readdirSync(directory).filter((file) => file.endsWith('.json'))).toEqual([]);
  });

  it('preserves a Unicode native ID in the existing filename without imposing a UUID restriction', () => {
    const directory = fixture();
    const threadId = '本机会话';
    park(directory, threadId, { envelope: 'input', toName: 'target' });
    expect(outboxCount(directory, threadId)).toBe(1);
    expect(readFileSync(join(directory, `${threadId}.json`), 'utf8')).toContain('input');
  });

  it('does not submit the same head from two concurrent drain owners', async () => {
    const directory = fixture();
    park(directory, 'thread', { envelope: 'one input', toName: 'target' });
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const submitted = new Promise<void>((resolve) => { started = resolve; });
    const deliver = vi.fn(async () => { started(); await gate; });
    const first = drain(directory, deliver);
    await submitted;
    const second = drain(directory, deliver);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const callsBeforeRelease = deliver.mock.calls.length;
    release();
    await Promise.all([first, second]);
    expect(callsBeforeRelease).toBe(1);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(outboxCount(directory, 'thread')).toBe(0);
  });

  it('holds an uncertain write and its FIFO tail across later drain rounds', async () => {
    const directory = fixture();
    park(directory, 'thread', { envelope: 'first input', toName: 'target' });
    park(directory, 'thread', { envelope: 'next input', toName: 'target' });
    const deliver = vi.fn(async () => { throw new MultichatError('CODEX_WRITE_UNCERTAIN', 'Connection closed after write.'); });
    await drain(directory, deliver);
    await drain(directory, deliver);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(outboxCount(directory, 'thread')).toBe(2);
    expect(JSON.parse(readFileSync(join(directory, 'thread.json'), 'utf8')).items[0].deliveryState).toBe('uncertain');
  });

  it('does not replay a persisted in-flight claim whose owner disappeared', async () => {
    const directory = fixture();
    park(directory, 'thread', { envelope: 'possibly accepted input', toName: 'target' });
    const file = join(directory, 'thread.json');
    const value = JSON.parse(readFileSync(file, 'utf8'));
    value.items[0].deliveryState = 'in-flight';
    value.items[0].claim = { id: 'interrupted-claim', ownerPid: 0 };
    writeFileSync(file, JSON.stringify(value));
    const deliver = vi.fn(async () => undefined);
    await drain(directory, deliver);
    expect(deliver).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(file, 'utf8')).items[0].deliveryState).toBe('uncertain');
  });

  it('refuses a contended park without overwriting the existing queue', () => {
    const directory = fixture();
    park(directory, 'thread', { envelope: 'existing input', toName: 'target' });
    writeFileSync(join(directory, 'thread.lock'), process.pid + ' ' + Date.now());
    expect(() => park(directory, 'thread', { envelope: 'new input', toName: 'target' })).toThrowError(/busy|lock|occupied/i);
    expect(outboxCount(directory, 'thread')).toBe(1);
  });
});
