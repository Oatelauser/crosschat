import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runDshEnhancementAttempt, runDshEnhancementSequence, readDshEnhancementPins } from '../scripts/dsh-enhancement-ci.mjs';
import { DSH_ENHANCEMENT_CHECKS, DSH_ENHANCEMENT_SCOPE } from '../scripts/dsh-enhancement-contract.mjs';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function directory() { const root = await mkdtemp(join(tmpdir(), 'c22-ci-test-')); roots.push(root); return root; }
const target = { platform: 'win32', arch: 'x64' };
const sourceHead = 'a'.repeat(40);
const result = { code: 0, signal: null, timedOut: false };
function freshReport(runId: string) {
  const state = { raw: false, resize: 0, listeners: { SIGINT: 1 } };
  return { schema: 1, tool: 'dsh-enhancement', runId, sourceHead, ...target, version: '0.2.1-rc.5', node: 'v22.23.4', scope: DSH_ENHANCEMENT_SCOPE,
    status: 'passed', checks: DSH_ENHANCEMENT_CHECKS.map((name: string) => ({ name, status: 'passed' })),
    hosts: [10, 11].map(pid => ({ pid, cleanup: { runtimeStopped: true, registrationRemoved: true, removed: true, forced: false } })),
    nodes: [12, 13].map(pid => ({ pid, exit: { code: 0, signal: null }, messages: [{ event: 'stopped', pid, failures: [] }] })),
    terminals: [0, 1].map(index => ({ index, exit: { event: 'exit', code: 0, before: state, after: state } })),
    nativeReceiptFault: { titlePosts: 1, acceptedWrites: 1, droppedReceipts: 1, registrationRestored: true, proxyClosed: true },
    brokerReceiptFault: { requests: 1, acceptedReceipts: 1, droppedReceipts: 1, configRestored: true, proxyClosed: true },
    unsafe: false, outerRemoved: true, cleanupFailures: [] };
}

describe('C22 fresh process and evidence boundary', () => {
  it('accepts the fresh complete report and its matching normal child exit', async () => {
    const output = await directory();
    const value = await runDshEnhancementAttempt({ output, sourceHead, target }, async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
      await writeFile(reportPath, JSON.stringify(freshReport(runId))); return result;
    });
    expect(value).toMatchObject({ status: 'passed', category: null, released: true });
  });

  it('rejects an earlier complete report and a child/report outcome mismatch', async () => {
    const output = await directory();
    const stale = await runDshEnhancementAttempt({ output, sourceHead, target }, async ({ reportPath }: { reportPath: string }) => {
      await writeFile(reportPath, JSON.stringify(freshReport('11111111-1111-4111-8111-111111111111'))); return result;
    });
    expect(stale).toMatchObject({ status: 'failed', category: 'infrastructure', released: false });
    const mismatch = await runDshEnhancementAttempt({ output, sourceHead, target }, async ({ reportPath, runId }: { reportPath: string; runId: string }) => {
      await writeFile(reportPath, JSON.stringify(freshReport(runId))); return { ...result, code: 1 };
    });
    expect(mismatch).toMatchObject({ status: 'failed', category: 'infrastructure', released: false });
  });

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
