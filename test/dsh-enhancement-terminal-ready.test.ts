import { describe, expect, it } from 'vitest';
import { openDshRenameForm } from './helpers/dsh-enhancement-terminal-ready.mjs';

function externalPty(initial = '') {
  let output = initial;
  const writes: string[] = [];
  const waits: { pattern: string | RegExp; from: number; resolve(): void; reject(error: Error): void }[] = [];
  const matches = (pattern: string | RegExp, from: number) => typeof pattern === 'string'
    ? output.slice(from).includes(pattern) : pattern.test(output.slice(from));
  const pty = {
    get output() { return output; },
    write(value: string) { writes.push(value); },
    waitForOutput(pattern: string | RegExp, _timeout: number, from: number) {
      if (matches(pattern, from)) return Promise.resolve();
      return new Promise<void>((resolve, reject) => waits.push({ pattern, from, resolve, reject }));
    },
  };
  return { pty, writes,
    emit(text: string) { output += text; for (const wait of [...waits]) if (matches(wait.pattern, wait.from)) { waits.splice(waits.indexOf(wait), 1); wait.resolve(); } },
    timeout() { for (const wait of waits.splice(0)) wait.reject(new Error('PTY readiness timeout')); },
  };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('native rename waits for fresh external terminal readiness', () => {
  it('does not treat clipboard completion or the failed ARM disabled marker as readiness', async () => {
    const host = externalPty(); let complete = false;
    const opened = openDshRenameForm({ pty: host.pty, from: 0 }).then(() => { complete = true; });
    host.emit('已复制完整值\r\n<e> 原生改名 ×             <?> 全部按键\r\n'); await flush();
    expect(host.writes).toEqual([]); expect(complete).toBe(false);
    host.emit('<e> 原生改名              <?> 全部按键\r\n'); await flush();
    expect(host.writes).toEqual(['e']); expect(complete).toBe(false);
    host.emit('原生会话新名称'); await opened; expect(complete).toBe(true); expect(host.writes).toEqual(['e']);
  });
  it('ignores old enabled output and never presses e after readiness timeout', async () => {
    const host = externalPty('<e> 原生改名              <?> 全部按键\r\n');
    const opened = openDshRenameForm({ pty: host.pty, from: host.pty.output.length });
    const rejected = expect(opened).rejects.toThrow('PTY readiness timeout');
    host.emit('<e> 原生改名 ×             <?> 全部按键\r\n'); await flush();
    host.timeout(); await rejected; expect(host.writes).toEqual([]);
  });
  it('requires a fresh form after its single keypress and never retries after form timeout', async () => {
    const host = externalPty('原生会话新名称\r\n');
    const opened = openDshRenameForm({ pty: host.pty, from: host.pty.output.length });
    const rejected = expect(opened).rejects.toThrow('PTY readiness timeout');
    host.emit('<e> 原生改名              <?> 全部按键\r\n'); await flush();
    expect(host.writes).toEqual(['e']); host.timeout(); await rejected; expect(host.writes).toEqual(['e']);
  });
});
