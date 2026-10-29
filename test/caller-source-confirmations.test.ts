import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectSource, confirmSource, releaseSourcePrompt } from '../src/application/caller-source/confirmations.js';
import { closeSourceStateListener, occupySourceStatePort, sourceStateDirectory, sourceStatePort } from './helpers/caller-source-directory.js';

const directories: string[] = [];
async function fixture() {
  const contexts = [source, ...['verified-cli-origin', 'another-user-desktop'].map((domain) => ({ ...source, domain })),
    ...['instance-1', 'instance-2'].flatMap((domain) => ['runtime-1', 'runtime-2'].map((runtime) => ({ ...source, scope: 'instance', domain, runtime })))];
  const directory = await sourceStateDirectory('crosschat-source-state-', contexts.map(stateKey));
  directories.push(directory);
  return { directory, now: () => 1_000, probePromptOwner: vi.fn(async () => 'active' as const) };
}
function stateKey(context: { providerId: string; scope: string; domain: string; runtime: string }): string {
  return createHash('sha256').update(JSON.stringify([context.providerId, context.scope, context.domain,
    context.scope === 'instance' ? context.runtime : null])).digest('hex');
}
const source = {
  providerId: 'codex', domain: 'verified-desktop-origin', runtime: 'runtime-1',
  scope: 'origin' as const, nativeId: 'session-A',
};
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe('source classification shared across native sessions', () => {
  it('reports bounded busy without mutating state when an unrelated listener occupies its mutex port', async () => {
    const options = await fixture();
    const listener = await occupySourceStatePort(await sourceStatePort(options.directory, stateKey(source)));
    if (listener === undefined) throw new Error('The isolated fixture mutex port was unexpectedly occupied.');
    try {
      await expect(inspectSource(source, { ...options, requestConfirmation: true })).rejects.toMatchObject({ code: 'SOURCE_STATE_BUSY' });
      expect(await readdir(options.directory)).toEqual([]);
      expect(listener.listening).toBe(true);
    } finally { await closeSourceStateListener(listener); }
    expect(await inspectSource(source, { ...options, requestConfirmation: true })).toMatchObject({ status: 'confirmation-required', shouldAsk: true });
  });

  it('does not create a confirmation or mutate state during a plain inspection', async () => {
    const options = await fixture();
    expect(await inspectSource(source, options)).toMatchObject({ status: 'unconfirmed', shouldAsk: false });
    expect(await readdir(options.directory)).toEqual([]);
  });

  it('one confirmation is reused by different sessions and after runtime revalidation', async () => {
    const options = await fixture();
    const first = await inspectSource(source, { ...options, requestConfirmation: true });
    expect(first).toMatchObject({ status: 'confirmation-required', shouldAsk: true });
    expect(first.context).toEqual(expect.any(String));
    expect(await confirmSource(first.context!, 'codex-desktop', source, options)).toMatchObject({ status: 'confirmed', sourceTool: 'codex-desktop' });
    const next = { ...source, nativeId: 'session-B', runtime: 'runtime-2' };
    expect(await inspectSource(next, { ...options, requestConfirmation: true })).toMatchObject({ status: 'confirmed', sourceTool: 'codex-desktop', shouldAsk: false, basis: 'user' });
  });

  it('coalesces concurrent first use and keeps an active unanswered question with its owner', async () => {
    const options = await fixture();
    const observations = await Promise.all(Array.from({ length: 12 }, (_, i) => inspectSource({ ...source, nativeId: `session-${i}` }, { ...options, requestConfirmation: true })));
    expect(observations.filter((result) => result.shouldAsk)).toHaveLength(1);
    expect(new Set(observations.map((result) => result.context)).size).toBe(1);
    expect(await inspectSource(source, { ...options, requestConfirmation: true, now: () => 10_000_000 })).toMatchObject({ status: 'confirmation-pending', shouldAsk: false });
  });

  it('lets another live session continue the same pending item after its display owner exits', async () => {
    const options = await fixture();
    const pending = await inspectSource(source, { ...options, requestConfirmation: true });
    await releaseSourcePrompt(pending.context!, source, options, pending.promptClaim!);
    const successor = await inspectSource({ ...source, nativeId: 'session-B' }, { ...options, requestConfirmation: true });
    expect(successor).toMatchObject({ context: pending.context, status: 'confirmation-required', shouldAsk: true });
  });

  it('does not let another window release a current prompt owner', async () => {
    const options = await fixture();
    const pending = await inspectSource(source, { ...options, requestConfirmation: true });
    await releaseSourcePrompt(pending.context!, { ...source, nativeId: 'session-B' }, options, pending.promptClaim!);
    expect(await inspectSource({ ...source, nativeId: 'session-C' }, { ...options, requestConfirmation: true })).toMatchObject({ context: pending.context, shouldAsk: false });
  });

  it('does not share classification between distinct native entries or users', async () => {
    const options = await fixture();
    const pending = await inspectSource(source, { ...options, requestConfirmation: true });
    await confirmSource(pending.context!, 'codex-desktop', source, options);
    for (const domain of ['verified-cli-origin', 'another-user-desktop']) {
      expect(await inspectSource({ ...source, domain }, options)).toMatchObject({ status: 'unconfirmed', shouldAsk: false });
      await expect(confirmSource(pending.context!, 'codex-desktop', { ...source, domain }, options)).rejects.toMatchObject({ code: 'SOURCE_CONTEXT_CHANGED' });
    }
  });

  it('keeps instance-only confirmations scoped to that instance', async () => {
    const options = await fixture();
    const instance = { ...source, scope: 'instance' as const, domain: 'instance-1' };
    const pending = await inspectSource(instance, { ...options, requestConfirmation: true });
    await confirmSource(pending.context!, 'codex-cli', instance, options);
    expect(await inspectSource({ ...instance, domain: 'instance-2', runtime: 'runtime-2' }, options)).toMatchObject({ status: 'unconfirmed' });
    expect(await inspectSource({ ...instance, runtime: 'runtime-2' }, options)).toMatchObject({ status: 'unconfirmed' });
  });

  it('rejects cross-family and contradictory native classifications without overwriting the answer', async () => {
    const options = await fixture();
    const pending = await inspectSource(source, { ...options, requestConfirmation: true });
    await expect(confirmSource(pending.context!, 'dsh', source, options)).rejects.toMatchObject({ code: 'SOURCE_TYPE_CONFLICT' });
    await confirmSource(pending.context!, 'codex-desktop', source, options);
    expect(await inspectSource({ ...source, observedTool: 'codex-cli' }, options)).toMatchObject({ status: 'conflict', shouldAsk: false });
    expect(await inspectSource(source, options)).toMatchObject({ status: 'confirmed', sourceTool: 'codex-desktop' });
  });

  it('uses native classification without asking and keeps its basis distinct', async () => {
    const options = await fixture();
    expect(await inspectSource({ ...source, observedTool: 'codex-cli' }, { ...options, requestConfirmation: true })).toMatchObject({ status: 'identified', sourceTool: 'codex-cli', basis: 'native', shouldAsk: false });
  });

  it('a duplicate same answer is idempotent but cannot change an already confirmed type', async () => {
    const options = await fixture();
    const pending = await inspectSource(source, { ...options, requestConfirmation: true });
    await confirmSource(pending.context!, 'codex-desktop', source, options);
    expect(await confirmSource(pending.context!, 'codex-desktop', source, options)).toMatchObject({ status: 'confirmed' });
    await expect(confirmSource(pending.context!, 'codex-cli', source, options)).rejects.toMatchObject({ code: 'SOURCE_TYPE_CONFLICT' });
  });

  it('preserves an answer made while the origin is temporarily unreadable, then revalidates it', async () => {
    const options = await fixture();
    const pending = await inspectSource(source, { ...options, requestConfirmation: true });
    expect(await confirmSource(pending.context!, 'codex-desktop', { providerId: 'codex', nativeId: source.nativeId }, options)).toMatchObject({ status: 'awaiting-verification', shouldAsk: false });
    expect(await inspectSource({ ...source, runtime: 'reconnected-runtime' }, options)).toMatchObject({ status: 'confirmed', sourceTool: 'codex-desktop', shouldAsk: false });
  });

  it('rejects an offline answer from another native session without changing the original pending item', async () => {
    const options = await fixture();
    const pending = await inspectSource(source, { ...options, requestConfirmation: true });
    const file = join(options.directory, `${pending.context!.split('.')[1]}.json`);
    const before = await readFile(file, 'utf8');
    await expect(confirmSource(pending.context!, 'codex-desktop', { providerId: 'codex', nativeId: 'unrelated-B' }, options))
      .rejects.toMatchObject({ code: 'SOURCE_CONTEXT_UNAVAILABLE' });
    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('only takes over an unanswered question after the native owner is confirmed inactive', async () => {
    const options = await fixture();
    const pending = await inspectSource(source, { ...options, requestConfirmation: true });
    const successor = await inspectSource({ ...source, nativeId: 'session-B', runtime: 'runtime-2' }, {
      ...options, requestConfirmation: true, probePromptOwner: async () => 'inactive' as const,
    });
    expect(successor).toMatchObject({ context: pending.context, status: 'confirmation-required', shouldAsk: true });
    expect(successor.promptClaim).not.toBe(pending.promptClaim);
    for (const state of ['active', 'unknown'] as const) expect(await inspectSource({ ...source, nativeId: 'session-C' }, {
      ...options, requestConfirmation: true, now: () => 100_000_000, probePromptOwner: async () => state,
    })).toMatchObject({ context: pending.context, status: 'confirmation-pending', shouldAsk: false });
  });

  it('does not let a late inactive observation or old release replace a newer owner claim', async () => {
    const options = await fixture();
    const pending = await inspectSource(source, { ...options, requestConfirmation: true });
    let finish!: (state: 'inactive') => void;
    let started!: () => void;
    const observing = new Promise<void>((resolve) => { started = resolve; });
    const late = inspectSource({ ...source, nativeId: 'session-B' }, { ...options, requestConfirmation: true,
      probePromptOwner: async () => { started(); return new Promise<'inactive'>((resolve) => { finish = resolve; }); },
    });
    await observing;
    await releaseSourcePrompt(pending.context!, source, options, pending.promptClaim!);
    const next = await inspectSource(source, { ...options, requestConfirmation: true });
    expect(next.shouldAsk).toBe(true);
    await releaseSourcePrompt(pending.context!, source, options, pending.promptClaim!);
    finish('inactive');
    expect(await late).toMatchObject({ context: next.context, status: 'confirmation-pending', shouldAsk: false });
    expect(await inspectSource({ ...source, nativeId: 'session-C' }, { ...options, requestConfirmation: true }))
      .toMatchObject({ context: next.context, status: 'confirmation-pending', shouldAsk: false });
  });

  it('bounds an unavailable native owner probe and releases its abort signal', async () => {
    const options = await fixture();
    await inspectSource(source, { ...options, requestConfirmation: true });
    let aborted = false;
    const result = await inspectSource({ ...source, nativeId: 'session-B' }, { ...options, requestConfirmation: true,
      promptOwnerTimeoutMs: 10, probePromptOwner: async (_owner, _source, signal) => {
        signal.addEventListener('abort', () => { aborted = true; });
        return new Promise<never>(() => {});
      },
    });
    expect(result).toMatchObject({ status: 'confirmation-pending', shouldAsk: false });
    expect(aborted).toBe(true);
  });

  it.each(['active', 'unknown'] as const)('reports a newly confirmed answer after a late %s owner observation', async (presence) => {
    const options = await fixture();
    const pending = await inspectSource(source, { ...options, requestConfirmation: true });
    let finish!: () => void;
    let started!: () => void;
    const observing = new Promise<void>((resolve) => { started = resolve; });
    const late = inspectSource({ ...source, nativeId: 'session-B' }, { ...options, requestConfirmation: true,
      probePromptOwner: async () => { started(); return new Promise<typeof presence>((resolve) => { finish = () => resolve(presence); }); },
    });
    await observing;
    await confirmSource(pending.context!, 'codex-desktop', source, options);
    finish();
    expect(await late).toMatchObject({ status: 'confirmed', sourceTool: 'codex-desktop', shouldAsk: false });
  });

  it('does not let a stale file-lock artifact permanently block the confirmation state', async () => {
    const options = await fixture();
    const pending = await inspectSource(source, { ...options, requestConfirmation: true });
    await writeFile(join(options.directory, `${pending.context!.split('.')[1]}.lock`), 'orphaned old lock');
    expect(await confirmSource(pending.context!, 'codex-desktop', source, options)).toMatchObject({ status: 'confirmed' });
  });

  it('rejects stale or malformed confirmation references', async () => {
    const options = await fixture();
    const pending = await inspectSource(source, { ...options, requestConfirmation: true });
    await expect(confirmSource(`${pending.context}stale`, 'codex-desktop', source, options)).rejects.toMatchObject({ code: 'SOURCE_CONTEXT_INVALID' });
    await expect(confirmSource('../outside', 'codex-desktop', source, options)).rejects.toMatchObject({ code: 'SOURCE_CONTEXT_INVALID' });
    await expect(confirmSource(pending.context!, 'codex-desktop', { ...source, providerId: 'dsh' }, options)).rejects.toMatchObject({ code: 'SOURCE_CONTEXT_CHANGED' });
  });

  it('does not replace corrupt state with a fresh prompt or a false classification', async () => {
    const options = await fixture();
    const pending = await inspectSource(source, { ...options, requestConfirmation: true });
    const key = pending.context!.split('.')[1];
    const file = join(options.directory, `${key}.json`);
    await writeFile(file, '{invalid');
    await expect(inspectSource(source, { ...options, requestConfirmation: true })).rejects.toMatchObject({ code: 'SOURCE_STATE_INVALID' });
    expect(await readFile(file, 'utf8')).toBe('{invalid');
  });
});
