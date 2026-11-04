import { EventEmitter } from 'node:events';
import { mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClaudeFixture } from './helpers/claude-live-fixture.mjs';

const boundary = vi.hoisted(() => ({
  denyProfile: false, denyRegistry: false, spawn: vi.fn(),
  models: [] as Array<{ url: string; close(): Promise<void> }>,
}));
vi.mock('node:child_process', async (original) => ({ ...await original<typeof import('node:child_process')>(), spawn: boundary.spawn }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdir: (...args: Parameters<typeof actual.mkdir>) => {
      if (boundary.denyProfile && String(args[0]).endsWith(`${sep}profile`)) throw Object.assign(new Error('Fixture profile denied'), { code: 'EACCES' });
      return actual.mkdir(...args);
    },
    readdir: (...args: Parameters<typeof actual.readdir>) => {
      if (boundary.denyRegistry && String(args[0]).endsWith(`${sep}sessions`)) throw Object.assign(new Error('Fixture registry denied'), { code: 'EACCES' });
      return actual.readdir(...args);
    },
  };
});
vi.mock('./helpers/claude-mock-model.mjs', async (original) => {
  const actual = await original<typeof import('./helpers/claude-mock-model.mjs')>();
  return { ...actual, createClaudeMockModel: async (...args: Parameters<typeof actual.createClaudeMockModel>) => {
    const model = await actual.createClaudeMockModel(...args); boundary.models.push(model); return model;
  } };
});

const roots: string[] = [];
beforeEach(() => {
  boundary.denyProfile = false; boundary.denyRegistry = false; boundary.spawn.mockReset();
  vi.stubEnv('CROSSCHAT_LIVE', '1');
  boundary.spawn.mockImplementation((_binary: string, args: string[]) => {
    if (JSON.stringify(args) !== '["--version"]') throw new Error('This lifecycle test cannot launch a real tool or session');
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), pid: 987654321 });
    queueMicrotask(() => { child.stdout.end('2.1.309 (Claude Code)\n'); child.stderr.end(); child.emit('close', 0, null); });
    return child;
  });
});
afterEach(async () => {
  boundary.denyProfile = false; boundary.denyRegistry = false; vi.unstubAllEnvs();
  await Promise.all(boundary.models.splice(0).map((model) => model.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function options() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crosschat-claude-lifecycle-unit-'))); roots.push(root);
  const binary = join(root, 'controlled-input.exe'); await writeFile(binary, 'Only a file-copy fixture; spawn is mocked.');
  return { binary, parentRoot: root, expectedVersion: '2.1.309' };
}
async function expectModelClosed() {
  expect(boundary.models).toHaveLength(1);
  await expect(fetch(`${boundary.models[0].url}/api/hello`, { method: 'HEAD' })).rejects.toThrow();
}

describe('Claude fixture setup and teardown resource ownership', () => {
  it('closes an already bound model when profile setup fails, and returns evidence for the owned root', async () => {
    const input = await options(); boundary.denyProfile = true;
    await expect(createClaudeFixture(input, () => ({ text: 'synthetic' }))).rejects.toMatchObject({
      code: 'EACCES', fixtureRoot: expect.stringContaining(input.parentRoot),
      cleanup: { modelClosed: true, runtimeStopped: true, registrationRemoved: true, removed: true, forced: false, errors: [] },
    });
    await expectModelClosed();
    expect(boundary.spawn).not.toHaveBeenCalled();
  });

  it('keeps root ownership evidence when model creation itself fails before any child is started', async () => {
    const input = await options();
    await expect(createClaudeFixture(input, undefined)).rejects.toMatchObject({
      fixtureRoot: expect.stringContaining(input.parentRoot),
      cleanup: { modelClosed: true, runtimeStopped: true, registrationRemoved: true, removed: true, forced: false, errors: [] },
    });
    expect(boundary.models).toEqual([]);
    expect(boundary.spawn).not.toHaveBeenCalled();
  });

  it('continues stopping every owned session and the model after a barrier release fails, retaining the unresolved fixture', async () => {
    const fixture = await createClaudeFixture(await options(), () => ({ text: 'synthetic' }));
    const barrier = await fixture.barrier('cleanup-failure');
    barrier.release = async () => { throw new Error('Owned barrier release failed'); };
    const failedStop = vi.fn(async () => { throw new Error('First owned session stop failed'); });
    const laterStop = vi.fn(async () => {});
    fixture.sessions.push({ stop: failedStop, child: { exitCode: 0, signalCode: null } }, { stop: laterStop, child: { exitCode: 0, signalCode: null } });
    await expect(fixture.close()).rejects.toMatchObject({ cleanup: fixture.cleanup });
    expect(failedStop).toHaveBeenCalledOnce(); expect(laterStop).toHaveBeenCalledOnce();
    expect(fixture.cleanup.modelClosed).toBe(true); expect(fixture.cleanup.removed).toBe(false);
    expect(fixture.cleanup.errors).toEqual(expect.arrayContaining(['Owned barrier release failed', 'First owned session stop failed']));
    expect((await stat(fixture.root)).isDirectory()).toBe(true);
    await expectModelClosed();
  });

  it('still closes the model when registration inspection fails, keeping release unknown and retaining evidence', async () => {
    const fixture = await createClaudeFixture(await options(), () => ({ text: 'synthetic' }));
    boundary.denyRegistry = true;
    await expect(fixture.close()).rejects.toMatchObject({ cleanup: fixture.cleanup });
    expect(fixture.cleanup).toMatchObject({ modelClosed: true, registrationRemoved: false, removed: false, forced: false });
    expect(fixture.cleanup.errors).toContain('Fixture registry denied');
    expect((await stat(fixture.root)).isDirectory()).toBe(true);
    await expectModelClosed();
  });
});
