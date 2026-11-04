import { describe, expect, it } from 'vitest';
import { assessDshDesktopNaturalExit, DSH_DESKTOP_MAIN_SHA256 } from './helpers/dsh-desktop-exit-observer.mjs';

const expected = { parentPid: 4100, projectDir: 'D:/owned/profiles/desktop', binary: 'D:/soft/DeepSeek Harness/DeepSeek Harness.exe', sourceSha256: DSH_DESKTOP_MAIN_SHA256 };
function observed() {
  return { sourceSha256: DSH_DESKTOP_MAIN_SHA256, continuous: true, errors: [], events: [
    { kind: 'birth', parentPid: 4100, pid: 4200, projectDir: expected.projectDir, binary: expected.binary },
    { kind: 'shutdown', pid: 4200, connected: true, stopping: true },
    { kind: 'ack', pid: 4200, type: 'shutdown-complete', stopping: true },
    { kind: 'close', pid: 4200, code: 0, signal: null },
    { kind: 'complete', pid: 4200, graceful: true, shutdownCompleted: true, code: 0, signal: null, stdoutDestroyed: true, stderrDestroyed: true },
  ], hostHandle: { pid: 4200, heldBeforeShutdown: true, creationTime: '2026-11-04T03:00:00Z', exitCode: 0 },
  main: { pid: 4100, code: 0, signal: null, failed: false, closed: true, timedOut: false, cancelled: false } };
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
});
