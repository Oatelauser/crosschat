import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSshAskpassBridge } from '../src/application/ssh/askpass.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'cc-askpass-')); roots.push(root); return root; }
function invoke(environment: NodeJS.ProcessEnv, prompt: string) {
  const child = spawn(environment.SSH_ASKPASS!, [prompt], { env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
  const result = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    child.once('error', reject); child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
  return { child, result };
}

describe('owned native SSH ASKPASS bridge', () => {
  it('uses a real local helper to pass one bounded prompt without storing the password in files, argv or environment', async () => {
    const root = await fixture();
    const answer = vi.fn(async () => 'bridge-private-secret');
    const bridge = await createSshAskpassBridge({ answer, temporaryRoot: root });
    try {
      expect(JSON.stringify(bridge.environment)).not.toContain('bridge-private-secret');
      const started = invoke(bridge.environment, "dev@fixture's password:");
      expect(await started.result).toEqual({ code: 0, stdout: 'bridge-private-secret\n', stderr: '' });
      expect(answer).toHaveBeenCalledWith("dev@fixture's password:", expect.any(AbortSignal));
      const directory = join(root, (await readdir(root))[0]);
      for (const file of await readdir(directory)) {
        if (!file.endsWith('.exe')) expect(await readFile(join(directory, file), 'utf8')).not.toContain('bridge-private-secret');
      }
    } finally { await bridge.dispose(); }
    expect(await readdir(root)).toEqual([]);
  }, 15_000);

  it('closes a pending helper and cancels its challenge when the owned bridge is disposed', async () => {
    const answer = vi.fn((_prompt, signal: AbortSignal) => new Promise<string | null>((resolve) => signal.addEventListener('abort', () => resolve(null), { once: true })));
    const root = await fixture();
    const bridge = await createSshAskpassBridge({ answer, temporaryRoot: root });
    const started = invoke(bridge.environment, "dev@fixture's password:");
    await vi.waitFor(() => expect(answer).toHaveBeenCalledOnce());
    await bridge.dispose();
    expect((await started.result).code).not.toBe(0);
    expect(answer.mock.calls[0][1].aborted).toBe(true);
    expect(await readdir(root)).toEqual([]);
  }, 15_000);

  it('rejects an oversized or cancelled answer without writing any secret material to stderr', async () => {
    const root = await fixture();
    const bridge = await createSshAskpassBridge({ answer: async () => 'oversized-secret'.repeat(1000), temporaryRoot: root });
    try {
      const result = await invoke(bridge.environment, "dev@fixture's password:").result;
      expect(result.code).not.toBe(0);
      expect(result.stdout).toBe(''); expect(result.stderr).toBe('');
    } finally { await bridge.dispose(); }
  }, 15_000);
});
