import { spawn as spawnHelper } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSshApplication } from '../src/application/ssh/index.js';
import type { SshChallengeHandler } from '../src/application/ssh/index.js';

const homes: string[] = [];
afterEach(async () => { await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))); });
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'cc-native-auth-'));
  homes.push(home); await mkdir(join(home, '.ssh'));
  await writeFile(join(home, '.ssh', 'config'), 'Host fixture other\n');
  return home;
}
class Remote extends EventEmitter {
  stdin = new PassThrough(); stdout = new PassThrough(); stderr = new PassThrough();
  kill = vi.fn(() => { queueMicrotask(() => this.emit('close', null)); return true; });
  finish(code = 0, stderr = '') {
    if (code === 0) this.stdout.write(JSON.stringify({ op: 'list', providers: [], page: { items: [], nextCursor: null, completeness: 'complete', errors: [], observedAt: 1 } }));
    this.stderr.write(stderr); this.emit('close', code);
  }
}
async function ask(environment: NodeJS.ProcessEnv, prompt: string): Promise<{ code: number | null; answer: string }> {
  const helper = spawnHelper(environment.SSH_ASKPASS!, [prompt], { env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let answer = ''; helper.stdout.on('data', (chunk: Buffer) => { answer += chunk.toString('utf8'); });
  helper.stderr.resume();
  return new Promise((resolve, reject) => { helper.once('error', reject); helper.once('close', (code) => resolve({ code, answer })); });
}

describe('SSH application native ASKPASS integration', () => {
  it('reuses authentication across refreshes, retains strict host checking and forgets credentials when configuration changes', async () => {
    const home = await fixture();
    const onChallenge = vi.fn<SshChallengeHandler>(async () => 'isolated-test-password');
    const spawn = vi.fn((_command, _args, settings) => {
      const remote = new Remote();
      void ask(settings.env, "dev@fixture's password:").then((result) => remote.finish(result.code === 0 && result.answer === 'isolated-test-password\n' ? 0 : 255), () => remote.finish(255));
      return remote;
    });
    const application = createSshApplication({ home, onChallenge, spawn });
    application.setActiveContext('ssh:fixture');
    try {
      for (let i = 0; i < 2; i++) expect((await application.inspect({ contextId: 'ssh:fixture' })).completeness).toBe('complete');
      expect(onChallenge).toHaveBeenCalledOnce();
      for (const [, args, settings] of spawn.mock.calls) {
        expect(args).toContain('BatchMode=no'); expect(args).toContain('StrictHostKeyChecking=ask');
        expect(args).not.toContain('StrictHostKeyChecking=no');
        expect(JSON.stringify({ args, env: settings.env })).not.toContain('isolated-test-password');
      }
      await writeFile(join(home, '.ssh', 'config'), 'Host fixture other changed\n');
      expect((await application.inspect({ contextId: 'ssh:fixture' })).completeness).toBe('complete');
      expect(onChallenge).toHaveBeenCalledTimes(2);
    } finally { await application.dispose(); }
  }, 15_000);

  it('preserves full Windows ASKPASS fingerprints and offers no approval for a changed known host', async () => {
    const fingerprint = `SHA256:${'a/+'.repeat(14)}b`;
    const onChallenge = vi.fn<SshChallengeHandler>(async () => true);
    let changed = false;
    const spawn = vi.fn((_command, _args, settings) => {
      const remote = new Remote();
      if (changed) queueMicrotask(() => remote.finish(255, 'REMOTE HOST IDENTIFICATION HAS CHANGED! Host key verification failed.'));
      else void ask(settings.env, `The authenticity of host 'fixture' can't be established.\nED25519 key fingerprint is ${fingerprint}.\nAre you sure you want to continue connecting (yes/no/[fingerprint])?`).then((result) => remote.finish(result.answer === 'yes\n' ? 0 : 255), () => remote.finish(255));
      return remote;
    });
    const application = createSshApplication({ home: await fixture(), onChallenge, spawn });
    application.setActiveContext('ssh:fixture');
    try {
      expect((await application.inspect({ contextId: 'ssh:fixture' })).completeness).toBe('complete');
      expect(onChallenge.mock.calls[0][0]).toMatchObject({ kind: 'host-key', algorithm: 'ED25519', fingerprint });
      changed = true;
      const rejected = await application.inspect({ contextId: 'ssh:fixture' });
      expect(rejected).toMatchObject({ completeness: 'unavailable', errors: [expect.objectContaining({ nextStep: expect.stringMatching(/指纹|known_hosts/) })] });
      expect(onChallenge).toHaveBeenCalledOnce();
    } finally { await application.dispose(); }
  }, 15_000);

  it('cancels a pending native authentication helper when the active connection closes', async () => {
    let received: AbortSignal | undefined;
    const onChallenge: SshChallengeHandler = async (_challenge, signal) => { received = signal; return new Promise((resolve) => signal.addEventListener('abort', () => resolve(null), { once: true })); };
    const remote = new Remote();
    let helper: Promise<unknown> | undefined;
    const application = createSshApplication({ home: await fixture(), onChallenge, spawn: (_command, _args, settings) => {
      helper = ask(settings.env!, "dev@fixture's password:"); return remote;
    } });
    application.setActiveContext('ssh:fixture');
    const pending = application.inspect({ contextId: 'ssh:fixture' });
    await vi.waitFor(() => expect(received).toBeDefined());
    application.setActiveContext(null);
    expect((await pending).completeness).toBe('cancelled');
    expect(received?.aborted).toBe(true); expect(remote.kill).toHaveBeenCalledOnce();
    await helper; await application.dispose();
  }, 15_000);
});
