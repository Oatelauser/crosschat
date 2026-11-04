import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { WebSocketServer } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assessDshDesktopNaturalExit, connectDshExitInspector, DSH_DESKTOP_MAIN_SHA256, locateDshDesktopExitBreakpoints, resolveOwnedDshDesktopProfile, serializeDshExitEvidence } from './helpers/dsh-desktop-exit-observer.mjs';
import { pollDsh } from './helpers/dsh-live-fixture.mjs';

const profileWrites = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, mkdir: async (...args: Parameters<typeof actual.mkdir>) => { profileWrites.paths.push(String(args[0])); return actual.mkdir(...args); } };
});

const expected = { parentPid: 4100, projectDir: 'D:/owned/profiles/desktop', binary: 'D:/soft/DeepSeek Harness/DeepSeek Harness.exe', sourceSha256: DSH_DESKTOP_MAIN_SHA256 };
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) { expect(basename(root)).toMatch(/^crosschat-dsh-exit-unit-/); await rm(root, { recursive: true, force: true }); } });
function observed() {
  return { sourceSha256: DSH_DESKTOP_MAIN_SHA256, continuous: true, errors: [], events: [
    { kind: 'birth', parentPid: 4100, pid: 4200, projectDir: expected.projectDir, binary: expected.binary },
    { kind: 'shutdown', pid: 4200, connected: true, stopping: true },
    { kind: 'ack', pid: 4200, type: 'shutdown-complete', stopping: true },
    { kind: 'close', pid: 4200, code: 0, signal: null },
    { kind: 'complete', pid: 4200, graceful: true, shutdownCompleted: true, code: 0, signal: null, stdoutDestroyed: true, stderrDestroyed: true },
  ], hostHandle: { pid: 4200, heldBeforeShutdown: true, creationTime: '2026-11-04T03:00:00Z', exitCode: 0 },
  main: { pid: 4100, code: 0, signal: null, failed: false, closed: true, timedOut: false, cancelled: false,
    truncated: false, releaseUnclear: [], secondaryProblems: [] } };
}

describe('formal Desktop natural-exit observation boundary', () => {
  it('accepts the actual owner, ordered private acknowledgement, close and independent held Host handle', () => {
    expect(assessDshDesktopNaturalExit(observed(), expected)).toMatchObject({ verified: true, hostPid: 4200 });
  });

  it('keeps a zero OS exit unknown without the real shutdown acknowledgement and stop completion', () => {
    for (const kind of ['ack', 'complete', 'birth', 'close']) {
      expect(assessDshDesktopNaturalExit({ ...observed(), events: observed().events.filter((event) => event.kind !== kind) }, expected).verified).toBe(false);
    }
  });

  it('rejects changed source, another parent/profile/binary and an unrelated Host handle', () => {
    for (const changed of [{ ...observed(), sourceSha256: '0'.repeat(64) },
      { ...observed(), hostHandle: { ...observed().hostHandle, pid: 4300 } },
      { ...observed(), hostHandle: { ...observed().hostHandle, heldBeforeShutdown: false } },
      ...['parentPid', 'projectDir', 'binary'].map((key) => ({ ...observed(), events: observed().events.map((event) => event.kind === 'birth' ? { ...event, [key]: 'foreign-owner' } : event) }))]) {
      expect(assessDshDesktopNaturalExit(changed, expected).verified).toBe(false);
    }
  });

  it('refuses any kill, non-graceful completion, missing stream close or abnormal main exit', () => {
    const report = observed();
    for (const changed of [
      { ...report, events: [...report.events, { kind: 'kill', pid: 4200, signal: 'SIGTERM' }] },
      { ...report, events: report.events.map((event) => event.kind === 'complete' ? { ...event, graceful: false } : event) },
      { ...report, events: report.events.map((event) => event.kind === 'complete' ? { ...event, stdoutDestroyed: false } : event) },
      { ...report, main: { ...report.main, failed: true } }, { ...report, main: { ...report.main, timedOut: true } },
      { ...report, hostHandle: { ...report.hostHandle, exitCode: 1 } },
    ]) expect(assessDshDesktopNaturalExit(changed, expected).verified).toBe(false);
  });

  it('requires continuous observation, one exact Host and the actual lifecycle order', () => {
    const report = observed();
    for (const changed of [{ ...report, continuous: false }, { ...report, errors: ['inspector detached before stop completed'] },
      { ...report, events: [...report.events, report.events[0]] },
      { ...report, events: [report.events[0], report.events[2], report.events[1], ...report.events.slice(3)] },
      { ...report, events: report.events.map((event) => event.kind === 'ack' ? { ...event, pid: 4300 } : event) },
    ]) expect(assessDshDesktopNaturalExit(changed, expected).verified).toBe(false);
  });

  it('does not infer complete process release from a truncated or unresolved owning Desktop record', () => {
    const report = observed();
    for (const main of [{ ...report.main, truncated: true }, { ...report.main, releaseUnclear: ['child'] },
      { ...report.main, secondaryProblems: ['stop failed'] }]) expect(assessDshDesktopNaturalExit({ ...report, main }, expected).verified).toBe(false);
  });

  it('refuses breakpoint relocation into any main script other than the pinned official bytes', () => {
    expect(() => locateDshDesktopExitBreakpoints('another build or injected lifecycle implementation')).toThrow();
  });

  it('redacts native authentication URLs in both structured facts and embedded process logs before writing evidence', () => {
    const value = { hash: DSH_DESKTOP_MAIN_SHA256, url: 'http://127.0.0.1:1234/?token=owned-secret&mode=test',
      stdout: 'native URL "http://127.0.0.1:1234/?token=owned-secret"' };
    const serialized = serializeDshExitEvidence(value);
    expect(serialized).not.toContain('owned-secret'); expect(JSON.parse(serialized).hash).toBe(DSH_DESKTOP_MAIN_SHA256);
    expect(JSON.parse(serialized).url).toBe('http://127.0.0.1:1234/?token=[fixture-token-redacted]&mode=test');
  });
});

describe('owned native Desktop profile reuse', () => {
  async function fixture() {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'crosschat-dsh-exit-unit-'))); roots.push(root);
    await writeFile(join(root, 'ownership.json'), JSON.stringify({ task: 'c04-native-natural-exit', root })); return root;
  }

  it('creates only a canonical child of the exact task-owned root for native initialization or reuse', async () => {
    const root = await fixture(), profile = join(root, 'round', 'native');
    expect(await resolveOwnedDshDesktopProfile(root, profile)).toBe(profile);
    expect((await stat(profile)).isDirectory()).toBe(true);
    expect(await resolveOwnedDshDesktopProfile(root, profile)).toBe(profile);
    expect(JSON.parse(await readFile(join(root, 'ownership.json'), 'utf8')).task).toBe('c04-native-natural-exit');
  });

  it('rejects the task root itself and outside paths before creating or writing a native profile', async () => {
    const root = await fixture(), outside = join(root, '..', `${basename(root)}-outside`);
    for (const requested of [root, outside]) await expect(resolveOwnedDshDesktopProfile(root, requested)).rejects.toThrow();
    await expect(stat(outside)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('requires the current owner marker before any new profile writes', async () => {
    const root = await fixture(), profile = join(root, 'native');
    await writeFile(join(root, 'ownership.json'), JSON.stringify({ task: 'foreign-task', root }));
    await expect(resolveOwnedDshDesktopProfile(root, profile)).rejects.toThrow();
    await expect(stat(profile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses an existing directory redirect before creating anything beneath its outside target', async () => {
    const root = await fixture(), outside = await fixture();
    await symlink(outside, join(root, 'redirect'), 'junction');
    const target = join(root, 'redirect', 'new-profile'), after = profileWrites.paths.length;
    await expect(resolveOwnedDshDesktopProfile(root, target)).rejects.toThrow();
    expect(profileWrites.paths.slice(after)).not.toContain(target);
    await expect(stat(join(outside, 'new-profile'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('owned Desktop inspector transport', () => {
  it('reads the owned process synchronously while paused, without waiting for blocked promise microtasks', async () => {
    const child = spawn(process.execPath, ['--inspect-brk=127.0.0.1:0', '-e', 'process.stdout.write("owned pause fixture")'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '', stdout = '', startupError: Error | undefined;
    const events: Array<{ method: string; params: { callFrames?: Array<{ callFrameId: string }> } }> = [];
    child.once('error', (error) => { startupError = error; });
    child.stderr.on('data', (value) => { stderr += String(value); }); child.stdout.on('data', (value) => { stdout += String(value); });
    const exited = new Promise<{ code: number | null; signal: string | null }>((done) => child.once('close', (code, signal) => done({ code, signal })));
    let client: Awaited<ReturnType<typeof connectDshExitInspector>> | undefined;
    try {
      const url = await pollDsh(() => { if (startupError) throw startupError; return stderr.match(/ws:\/\/127\.0\.0\.1:[0-9]+\/[a-z0-9-]+/)?.[0]; }, 'owned inspector URL', 3000);
      client = await connectDshExitInspector(url, (method: string, params: { callFrames?: Array<{ callFrameId: string }> }) => events.push({ method, params }));
      await client.call('Runtime.enable'); await client.call('Debugger.enable'); await client.call('Runtime.runIfWaitingForDebugger');
      const pause = await pollDsh(() => events.find((event) => event.method === 'Debugger.paused'), 'owned paused frame', 3000);
      expect(await client.value('process.pid', pause.params.callFrames?.[0].callFrameId)).toBe(child.pid);
      expect(await client.value('process.pid')).toBe(child.pid);
    } finally {
      await client?.call('Debugger.resume').catch(() => {}); await client?.close();
      const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); }, 1000);
      try { expect(await exited).toEqual({ code: 0, signal: null }); expect(stdout).toBe('owned pause fixture'); } finally { clearTimeout(timer); }
    }
  }, 10000);

  async function server() {
    const value = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(value, 'listening');
    const address = value.address(); if (typeof address === 'string' || !address) throw new Error('Missing loopback listener');
    return { value, url: `ws://127.0.0.1:${address.port}/owned`, async close() { for (const client of value.clients) client.terminate(); await new Promise<void>((done) => value.close(() => done())); } };
  }

  it.each(['[]', 'null', 'true'])('rejects malformed protocol values explicitly instead of treating them as missing or late replies (%s)', async (packet) => {
    const fixture = await server(), events: string[] = [];
    const client = await connectDshExitInspector(fixture.url, (method: string) => events.push(method));
    try {
      for (const peer of fixture.value.clients) peer.send(packet);
      await expect.poll(() => events.includes('transport-error'), { timeout: 1000 }).toBe(true);
    } finally { await client.close(); await fixture.close(); }
  });

  it('correlates actual responses and rejects pending reads when the owned connection closes', async () => {
    const fixture = await server();
    fixture.value.on('connection', (peer) => { peer.on('message', (raw) => {
      const request = JSON.parse(String(raw));
      if (request.method === 'Runtime.evaluate') peer.send(JSON.stringify({ id: request.id, result: { result: { value: 42 } } }));
    }); });
    const client = await connectDshExitInspector(fixture.url, () => {});
    try {
      expect(await client.value('42')).toBe(42);
      const stopped = expect(client.call('Runtime.enable')).rejects.toThrow('closed');
      for (const peer of fixture.value.clients) peer.close();
      await stopped;
    } finally { await client.close(); await fixture.close(); }
  });
});
