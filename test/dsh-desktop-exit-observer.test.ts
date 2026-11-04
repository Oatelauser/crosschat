import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { describe, expect, it } from 'vitest';
import { assessDshDesktopNaturalExit, connectDshExitInspector, DSH_DESKTOP_MAIN_SHA256, locateDshDesktopExitBreakpoints } from './helpers/dsh-desktop-exit-observer.mjs';

const expected = { parentPid: 4100, projectDir: 'D:/owned/profiles/desktop', binary: 'D:/soft/DeepSeek Harness/DeepSeek Harness.exe', sourceSha256: DSH_DESKTOP_MAIN_SHA256 };
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
});

describe('owned Desktop inspector transport', () => {
  async function server() {
    const value = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(value, 'listening');
    const address = value.address(); if (typeof address === 'string' || !address) throw new Error('Missing loopback listener');
    return { value, url: `ws://127.0.0.1:${address.port}/owned`, async close() { for (const client of value.clients) client.terminate(); await new Promise<void>((done) => value.close(() => done())); } };
  }

  it('rejects malformed protocol values explicitly instead of treating them as missing or late replies', async () => {
    const fixture = await server(), events: string[] = [];
    const client = await connectDshExitInspector(fixture.url, (method: string) => events.push(method));
    try {
      for (const peer of fixture.value.clients) peer.send('[]');
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
