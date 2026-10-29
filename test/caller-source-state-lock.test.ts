import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import ts from 'typescript';
import { withStateLock } from '../src/state-lock.js';
import { sourceStateDirectory } from './helpers/caller-source-directory.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function directory(): Promise<string> {
  const result = await sourceStateDirectory('crosschat-source-lock-', ['same-record', 'held-record']);
  directories.push(result);
  return result;
}

describe('shared state OS mutex', () => {
  it('never steals a live lock and releases it after an operation fails', async () => {
    const root = await directory();
    await expect(withStateLock(root, 'same-record', async () => {
      expect(await withStateLock(join(root, '.'), 'same-record', async () => 'must not run', 20)).toEqual({ acquired: false });
      throw new Error('fixture-operation-failure');
    })).rejects.toThrow('fixture-operation-failure');
    expect(await withStateLock(root, 'same-record', async () => 'recovered', 100))
      .toEqual({ acquired: true, value: 'recovered' });
  });

  it('automatically releases a real child process lock after that process is killed', async () => {
    const root = await directory();
    // Compile the current single-module source in memory; no stale dist or repository writes.
    const source = await readFile(new URL('../src/state-lock.ts', import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2023 } }).outputText;
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      const { withStateLock } = await import(process.argv[1]);
      await withStateLock(process.argv[2], 'held-record', async () => {
        process.send({ held: true });
        return new Promise(() => {});
      });
    `, moduleUrl, root], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: { ...process.env, CROSSCHAT_LIVE: undefined } });
    const exited = once(child, 'exit');
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const ready = await Promise.race([once(child, 'message'), exited.then(() => { throw new Error(`Lock child exited before acquiring: ${stderr}`); }),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Lock child did not acquire its OS mutex.')), 7_000); })]);
      clearTimeout(timer);
      expect(ready[0]).toEqual({ held: true });
      expect(await withStateLock(root, 'held-record', async () => 'must not run', 20)).toEqual({ acquired: false });
      child.kill('SIGKILL');
      await exited;
      expect(await withStateLock(root, 'held-record', async () => 'recovered', 500))
        .toEqual({ acquired: true, value: 'recovered' });
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
    }
  }, 15_000);
});
