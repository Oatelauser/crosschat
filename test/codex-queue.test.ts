import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { queueToCodexThread, type CodexQueueProcess } from '../src/codex/queue.js';

/**
 * Fake queue CLI child. Emits stderr (async, so the listener attaches first),
 * then 'close' (so stderr has drained, like a real pipe), or never closes
 * (timeout case). Records the argv it was spawned with.
 */
function makeFakeSpawner(script: {
  code?: number;
  stderr?: string;
  spawnError?: Error;
  neverClose?: boolean;
}): { calls: { command: string; args: string[] }[]; killed: boolean[] } & {
  spawn: (command: string, args: readonly string[]) => CodexQueueProcess;
} {
  const calls: { command: string; args: string[] }[] = [];
  const killed: boolean[] = [];
  return {
    calls,
    killed,
    spawn(command, args) {
      calls.push({ command, args: [...args] });
      if (script.spawnError) throw script.spawnError;
      const child = new EventEmitter() as unknown as CodexQueueProcess & { killed: boolean };
      child.stderr = {
        on(event, listener) {
          if (event === 'data' && script.stderr) {
            setTimeout(() => listener(Buffer.from(script.stderr)), 0);
          }
        },
      };
      child.kill = () => {
        killed.push(true);
      };
      if (!script.neverClose) {
        setTimeout(() => child.emit('close', script.code ?? 0, null), 5);
      }
      return child;
    },
  };
}

const base = { executable: 'codex' };

describe('queueToCodexThread', () => {
  it('spawns codex queue with exact flags and resolves queued on exit 0', async () => {
    const fake = makeFakeSpawner({});
    const result = await queueToCodexThread('t1', 'hello envelope', { ...base, spawnProcess: fake.spawn });
    expect(result).toEqual({ status: 'queued' });
    expect(fake.calls).toEqual([
      { command: 'codex', args: ['queue', '--thread', 't1', '--message', 'hello envelope'] },
    ]);
    expect(fake.killed).toEqual([]);
  });

  it('rejects with CODEX_QUEUE_FAILED and a stderr excerpt on non-zero exit', async () => {
    const fake = makeFakeSpawner({ code: 1, stderr: 'Error: failed to read thread: nope' });
    const err = (await queueToCodexThread('t1', 'x', {
      ...base,
      spawnProcess: fake.spawn,
    }).catch((e) => e)) as Error & { code?: string };
    expect(err.code).toBe('CODEX_QUEUE_FAILED');
    expect(err.message).toContain('exited with code 1');
    expect(err.message).toContain('failed to read thread: nope');
  });

  it('kills the process and rejects when the CLI exceeds the timeout', async () => {
    const fake = makeFakeSpawner({ neverClose: true });
    const err = (await queueToCodexThread('t1', 'x', {
      ...base,
      timeoutMs: 20,
      spawnProcess: fake.spawn,
    }).catch((e) => e)) as Error & { code?: string };
    expect(err.code).toBe('CODEX_QUEUE_FAILED');
    expect(err.message).toContain('timed out after 20ms');
    expect(fake.killed).toEqual([true]);
  });

  it('rejects with CODEX_QUEUE_FAILED when the process cannot even be spawned', async () => {
    const fake = makeFakeSpawner({ spawnError: new Error('ENOENT: codex not found') });
    const err = (await queueToCodexThread('t1', 'x', {
      ...base,
      spawnProcess: fake.spawn,
    }).catch((e) => e)) as Error & { code?: string };
    expect(err.code).toBe('CODEX_QUEUE_FAILED');
    expect(err.message).toContain('could not be spawned');
  });
});
