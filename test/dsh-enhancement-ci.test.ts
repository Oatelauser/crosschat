import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runDshEnhancementAttempt, runDshEnhancementSequence, readDshEnhancementPins } from '../scripts/dsh-enhancement-ci.mjs';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function directory() { const root = await mkdtemp(join(tmpdir(), 'c22-ci-test-')); roots.push(root); return root; }
const target = { platform: 'win32', arch: 'x64' };
const sourceHead = 'a'.repeat(40);
const result = { code: 0, signal: null, timedOut: false };

describe('C22 fresh process and evidence boundary', () => {
  it('rejects a missing report even when the child exits successfully', async () => {
    const output = await directory();
    const value = await runDshEnhancementAttempt({ output, sourceHead, target }, async () => result);
    expect(value).toMatchObject({ status: 'failed', category: 'infrastructure', released: false });
    expect(JSON.parse(await readFile(join(output, 'process.json'), 'utf8'))).toMatchObject(result);
  });

  it('rejects a stale or malformed report without inventing runtime cleanup', async () => {
    const output = await directory();
    const value = await runDshEnhancementAttempt({ output, sourceHead, target }, async ({ reportPath }: { reportPath: string }) => {
      await writeFile(reportPath, JSON.stringify({ status: 'passed', runId: 'old', unsafe: false, outerRemoved: true }));
      return result;
    });
    expect(value).toMatchObject({ category: 'infrastructure', released: false });
  });

  it('preserves a timeout as infrastructure even if a file claims success', async () => {
    const output = await directory();
    const value = await runDshEnhancementAttempt({ output, sourceHead, target }, async () => ({ ...result, timedOut: true }));
    expect(value).toMatchObject({ category: 'infrastructure', released: false });
  });

  it('refuses an unplanned target before running any child', async () => {
    const output = await directory(); let called = false;
    await expect(runDshEnhancementAttempt({ output, sourceHead, target: { platform: 'linux', arch: 'arm64' } }, async () => {
      called = true; return result;
    })).rejects.toThrow(/target/i);
    expect(called).toBe(false);
  });
});

describe('C22 single pinned qualification ownership', () => {
  it('pins rc.5 and the known official archive identity instead of looking up latest', async () => {
    const pins = await readDshEnhancementPins(target);
    expect(pins.runtime).toEqual({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.5', url: 'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.1-rc.5.tgz',
      integrity: 'sha512-WkyJZv4zl9sCAxSzRctGm58m0rilGqwR6pniBiLOz5CPDfHfDuAUicg0AAazXI7oj/Cph6/cjNTncA/rpLTXpw==' });
    expect(pins.manager.version).toBe('11.28.5');
  });

  it('retains an installation after unknown release, with no retry or second install', async () => {
    const calls: string[] = [];
    const value = await runDshEnhancementSequence({ target }, {
      async install() { calls.push('install'); return { root: '/owned/runtime', safe: true }; },
      async probe() { calls.push('probe'); return { status: 'failed', category: 'infrastructure', released: false }; },
      async remove() { calls.push('remove'); },
    });
    expect(calls).toEqual(['install', 'probe']);
    expect(value).toMatchObject({ status: 'failed', installationCleanup: 'retained', category: 'infrastructure', notify: false });
  });

  it('removes a released installation once and never retries a validation failure', async () => {
    const calls: string[] = [];
    const value = await runDshEnhancementSequence({ target }, {
      async install() { calls.push('install'); return { root: '/owned/runtime', safe: true }; },
      async probe() { calls.push('probe'); return { status: 'failed', category: 'validation-failed', released: true }; },
      async remove() { calls.push('remove'); },
    });
    expect(calls).toEqual(['install', 'probe', 'remove']);
    expect(value).toMatchObject({ status: 'failed', installationCleanup: 'removed', category: 'validation-failed', notify: false });
  });

  it('reports cleanup failure even after validation passes', async () => {
    const value = await runDshEnhancementSequence({ target }, {
      async install() { return { root: '/owned/runtime', safe: true }; },
      async probe() { return { status: 'passed', category: null, released: true }; },
      async remove() { throw new Error('owned cleanup refused'); },
    });
    expect(value).toMatchObject({ status: 'failed', category: 'infrastructure', installationCleanup: 'retained', notify: false });
  });
});
