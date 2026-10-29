import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectCallerSource, enrichCallerSource, confirmCallerSource } from '../src/application/caller-source/service.js';
import type { CallerSourceObservation } from '../src/application/caller-source/providers.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function fixture(observation: CallerSourceObservation, approved = false) {
  const directory = await mkdtemp(join(tmpdir(), 'crosschat-source-service-'));
  directories.push(directory);
  return { directory, probe: vi.fn(async () => observation), manualConfirmationApproved: () => approved,
    probePromptOwner: vi.fn(async () => 'active' as const) };
}
const caller = { p: 'codex' as const, id: 'native-A' };
const associated: CallerSourceObservation = { status: 'unresolved', association: 'verified', basis: 'native',
  sourceDomain: 'verified-origin', runtimeFingerprint: 'runtime-1', scope: 'origin' };

describe('caller source application boundary', () => {
  it('enriches only a native type matching the caller Provider', async () => {
    const options = await fixture({ status: 'identified', association: 'unavailable', basis: 'native', sourceTool: 'codex-desktop' });
    expect(await enrichCallerSource(caller, options)).toEqual({ ...caller, endpointType: 'desktop' });
    options.probe.mockResolvedValue({ status: 'identified', association: 'verified', basis: 'native', sourceTool: 'dsh' });
    expect(await enrichCallerSource(caller, options)).toEqual(caller);
    expect(await readdir(options.directory)).toEqual([]);
  });

  it('never creates questions when called from send, including unresolved and unavailable origins', async () => {
    for (const observation of [associated, { status: 'unavailable' as const, association: 'unavailable' as const, basis: 'native' as const, reason: 'temporarily offline' }]) {
      const options = await fixture(observation, true);
      expect(await enrichCallerSource(caller, options)).toEqual(caller);
      expect(await readdir(options.directory)).toEqual([]);
    }
  });

  it('requires per-entry review before enabling an unapproved manual fallback', async () => {
    const options = await fixture(associated);
    expect(await inspectCallerSource(caller, options, true)).toMatchObject({ status: 'review-required', shouldAsk: false });
    expect(await readdir(options.directory)).toEqual([]);
  });

  it('does not open an approved manual fallback without a native prompt-owner lifecycle probe', async () => {
    const options = await fixture(associated, true);
    const noLifecycle = { directory: options.directory, probe: options.probe, manualConfirmationApproved: options.manualConfirmationApproved };
    expect(await inspectCallerSource(caller, noLifecycle, true)).toMatchObject({ status: 'review-required', shouldAsk: false, code: 'SOURCE_LIFECYCLE_REVIEW_REQUIRED' });
    expect(await readdir(options.directory)).toEqual([]);
    const question = await inspectCallerSource(caller, options, true);
    await expect(confirmCallerSource(caller, 'codex-desktop', question.context!, noLifecycle))
      .rejects.toMatchObject({ code: 'SOURCE_LIFECYCLE_REVIEW_REQUIRED' });
    expect(await inspectCallerSource(caller, options)).toMatchObject({ status: 'confirmation-pending', shouldAsk: false });
  });

  it('cannot turn a user choice into a persistent origin when invocation association is absent', async () => {
    const options = await fixture({ status: 'unresolved', association: 'unavailable', basis: 'native', code: 'NATIVE_ASSOCIATION_MISSING' }, true);
    expect(await inspectCallerSource(caller, options, true)).toMatchObject({ status: 'unresolved', shouldAsk: false });
    await expect(confirmCallerSource(caller, 'codex-desktop', 'not-a-context', options)).rejects.toMatchObject({ code: 'SOURCE_CONTEXT_UNAVAILABLE' });
    expect(await readdir(options.directory)).toEqual([]);
  });

  it('reuses an approved origin confirmation across sessions without polluting recipient selection', async () => {
    const options = await fixture(associated, true);
    const question = await inspectCallerSource(caller, options, true);
    expect(question).toMatchObject({ status: 'confirmation-required', shouldAsk: true });
    expect(await confirmCallerSource(caller, 'codex-desktop', question.context!, options)).toMatchObject({ status: 'confirmed', basis: 'user' });
    expect(await enrichCallerSource({ ...caller, id: 'native-B' }, options)).toEqual({ ...caller, id: 'native-B', endpointType: 'desktop' });
    expect(await inspectCallerSource({ ...caller, id: 'native-C' }, options, true)).toMatchObject({ status: 'confirmed', shouldAsk: false });
  });

  it('does not replace a known source type with a contradictory observation', async () => {
    const options = await fixture({ status: 'identified', association: 'unavailable', basis: 'native', sourceTool: 'codex-cli' });
    expect(await enrichCallerSource({ ...caller, endpointType: 'desktop' }, options)).toEqual({ ...caller, endpointType: 'desktop' });
    expect(await inspectCallerSource({ ...caller, endpointType: 'desktop' }, options)).toMatchObject({ status: 'conflict', shouldAsk: false });
  });

  it('does not let a shared manual classification override an already known caller endpoint', async () => {
    const options = await fixture(associated, true);
    const question = await inspectCallerSource(caller, options, true);
    await confirmCallerSource(caller, 'codex-cli', question.context!, options);
    const desktopCaller = { ...caller, endpointType: 'desktop' };
    expect(await inspectCallerSource(desktopCaller, options)).toMatchObject({ status: 'conflict', shouldAsk: false, code: 'SOURCE_TYPE_CONFLICT' });
    expect(await enrichCallerSource(desktopCaller, options)).toEqual(desktopCaller);
  });

  it('rejects a user answer conflicting with the current known caller endpoint before saving it', async () => {
    const options = await fixture(associated, true);
    const question = await inspectCallerSource(caller, options, true);
    await expect(confirmCallerSource({ ...caller, endpointType: 'desktop' }, 'codex-cli', question.context!, options))
      .rejects.toMatchObject({ code: 'SOURCE_TYPE_CONFLICT' });
    expect(await inspectCallerSource(caller, options)).toMatchObject({ status: 'confirmation-pending', shouldAsk: false });
  });

  it('temporary probe failures do not block existing native identity or Q8 replies', async () => {
    const options = await fixture(associated);
    options.probe.mockRejectedValue(new Error('private-upstream-details'));
    expect(await enrichCallerSource(caller, options)).toEqual(caller);
    const result = await inspectCallerSource(caller, options);
    expect(result).toMatchObject({ status: 'unavailable', shouldAsk: false });
    expect(JSON.stringify(result)).not.toContain('private-upstream-details');
  });

  it('human terminals remain human and cannot confirm a missing native identity', async () => {
    const options = await fixture(associated, true);
    expect(await inspectCallerSource({ p: 'human' }, options, true)).toMatchObject({ status: 'human', shouldAsk: false });
    expect(await enrichCallerSource({ p: 'human' }, options)).toEqual({ p: 'human' });
    expect(options.probe).not.toHaveBeenCalled();
    await expect(confirmCallerSource({ p: 'human' }, 'codex-cli', 'unknown', options)).rejects.toMatchObject({ code: 'SOURCE_CONTEXT_UNAVAILABLE' });
  });
});
