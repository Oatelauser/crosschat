import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drain, outboxCount, park } from '../src/outbox.js';
import { MultichatError } from '../src/errors.js';

const directories: string[] = [];
function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'crosschat-outbox-owner-'));
  directories.push(directory);
  return directory;
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('outbox delivery ownership', () => {
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
