export const DSH_DESKTOP_MAIN_SHA256 = '6f3d1ddd1106371452c2204be6dfb2e5460a8e8259cdd05cdccb5387b3f9a85a';
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function locateDshDesktopExitBreakpoints(source) {
  void source;
  return [];
}

/** Only interprets observations supplied by the trusted, fixture-owned debugger/OS runner. */
export function assessDshDesktopNaturalExit(report, expected) {
  const unknown = (reason) => ({ verified: false, reason });
  if (!record(expected) || expected.sourceSha256 !== DSH_DESKTOP_MAIN_SHA256 || !Number.isSafeInteger(expected.parentPid) || expected.parentPid <= 0
    || typeof expected.projectDir !== 'string' || typeof expected.binary !== 'string') return unknown('Invalid expected native owner');
  if (!record(report) || report.sourceSha256 !== expected.sourceSha256 || report.continuous !== true
    || !Array.isArray(report.errors) || report.errors.length || !Array.isArray(report.events)) return unknown('Source or continuous observation is unverified');
  const events = report.events;
  if (events.length !== 5 || !events.every((event, index) => record(event) && event.kind === ['birth', 'shutdown', 'ack', 'close', 'complete'][index]))
    return unknown('Native teardown order is missing, repeated or includes termination');
  const [birth, shutdown, ack, closed, completed] = events;
  if (!Number.isSafeInteger(birth.pid) || birth.pid <= 0 || birth.parentPid !== expected.parentPid || birth.projectDir !== expected.projectDir
    || birth.binary !== expected.binary || !events.every((event) => event.pid === birth.pid)) return unknown('The observed process is not this exact native Host');
  if (shutdown.connected !== true || shutdown.stopping !== true || ack.type !== 'shutdown-complete' || ack.stopping !== true
    || closed.code !== 0 || closed.signal !== null || completed.graceful !== true || completed.shutdownCompleted !== true
    || completed.code !== 0 || completed.signal !== null || completed.stdoutDestroyed !== true || completed.stderrDestroyed !== true)
    return unknown('The Host did not prove acknowledged graceful teardown and stream closure');
  const handle = report.hostHandle, main = report.main;
  if (!record(handle) || handle.pid !== birth.pid || handle.heldBeforeShutdown !== true || handle.exitCode !== 0
    || typeof handle.creationTime !== 'string' || !Number.isFinite(Date.parse(handle.creationTime))) return unknown('A matching held Host handle and normal exit are required');
  if (!record(main) || main.pid !== expected.parentPid || main.code !== 0 || main.signal !== null || main.failed !== false
    || main.closed !== true || main.timedOut !== false || main.cancelled !== false) return unknown('The owning Desktop did not close normally');
  return { verified: true, hostPid: birth.pid, parentPid: expected.parentPid, scope: 'fixed formal Desktop with passive debugger and held OS handle' };
}
