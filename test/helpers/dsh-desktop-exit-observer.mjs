import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { setTimeout, clearTimeout } from 'node:timers';
import { WebSocket } from 'ws';

export const DSH_DESKTOP_MAIN_SHA256 = '6f3d1ddd1106371452c2204be6dfb2e5460a8e8259cdd05cdccb5387b3f9a85a';
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export async function resolveOwnedDshDesktopProfile(root, requested) {
  const canonical = await realpath(root), owner = JSON.parse(await readFile(resolve(canonical, 'ownership.json'), 'utf8'));
  if (canonical !== root || !record(owner) || owner.task !== 'c04-native-natural-exit' || owner.root !== canonical)
    throw new Error('Native profile reuse requires the exact current task owner');
  const target = resolve(requested), child = relative(canonical, target);
  if (!child || isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`)) throw new Error('Native profile must stay within the owned task root');
  let current = canonical;
  for (const part of child.split(sep)) {
    current = resolve(current, part);
    let actual;
    try { actual = await realpath(current); }
    catch (failure) {
      if (failure.code !== 'ENOENT') throw failure;
      await mkdir(current); actual = await realpath(current);
    }
    if (actual !== current || !(await stat(actual)).isDirectory()) throw new Error('Native profile path must not redirect through a filesystem link');
  }
  return target;
}

export function serializeDshExitEvidence(value) {
  return JSON.stringify(value, null, 2).replace(/([?&]token=)[^&\s"'\\]+/g, '$1[fixture-token-redacted]') + '\n';
}

export function hasDshOwnedRegistrationRelease(before, after, instanceId) {
  void before; void instanceId;
  return Object.keys(after).length === 0;
}

export function locateDshDesktopExitBreakpoints(source) {
  if (typeof source !== 'string' || createHash('sha256').update(source).digest('hex') !== DSH_DESKTOP_MAIN_SHA256)
    throw new Error('Desktop observer only accepts the pinned official main script');
  const anchors = [
    ['birth', 'this.child = child;\n\t\tchild.stderr?.setEncoding("utf8");', 'child.stderr'],
    ['ready', 'if (message.type === "ready") this.readyResolve({', 'this.readyResolve', 'message.type === "ready"'],
    ['shutdown', 'if (child.connected) child.send({ type: "shutdown" }, (error) => {', 'child.send', 'child.connected === true'],
    ['ack', 'else if (message.type === "shutdown-complete") if (this.stopping) this.shutdownCompleted = true;', 'this.shutdownCompleted', 'message.type === "shutdown-complete" && this.stopping === true'],
    ['inspection', 'const request = this.controlRequests.get(message.requestId);\n\t\t\t\tif (message.error === void 0)', 'const request', 'message.type === "quit-inspection"'],
    ['close', 'child.once("close", (code) => {\n\t\t\t\tconst suffix = this.stderr.trim()', 'const suffix'],
    ['complete', 'this.child = void 0;\n\t\tif (requireGraceful', 'this.child'],
    ['kill-invalid', 'this.fail(/* @__PURE__ */ new Error("dsh desktop host sent an invalid IPC event"));\n\t\t\t\tchild.kill("SIGTERM");', 'child.kill'],
    ['kill-term', 'if (!graceful) child.kill("SIGTERM");', 'child.kill', '!graceful'],
    ['kill-kill', 'child.kill("SIGKILL");\n\t\t\tif (!await exitsWithin(exited, 5e3))', 'child.kill'],
  ];
  return anchors.map(([kind, anchor, statement, condition]) => {
    const at = source.indexOf(anchor);
    if (at < 0 || source.indexOf(anchor, at + 1) >= 0) throw new Error(`Pinned Host observer anchor is missing or ambiguous: ${kind}`);
    const offset = at + anchor.indexOf(statement), before = source.slice(0, offset);
    const lineNumber = before.split('\n').length - 1, columnNumber = offset - (before.lastIndexOf('\n') + 1);
    return { kind, lineNumber, columnNumber, condition };
  });
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
    || main.closed !== true || main.timedOut !== false || main.cancelled !== false || main.truncated !== false
    || !Array.isArray(main.releaseUnclear) || main.releaseUnclear.length || !Array.isArray(main.secondaryProblems) || main.secondaryProblems.length)
    return unknown('The owning Desktop did not close normally');
  return { verified: true, hostPid: birth.pid, parentPid: expected.parentPid, scope: 'fixed formal Desktop with passive debugger and held OS handle' };
}

/** A bounded, disposable transport for the fixture-owned loopback main-process debugger. */
export async function connectDshExitInspector(url, onEvent) {
  const address = new globalThis.URL(url);
  if (address.protocol !== 'ws:' || address.hostname !== '127.0.0.1' || address.username || address.password || address.search || address.hash)
    throw new Error('The owned Desktop inspector must be an exact loopback WebSocket');
  const socket = new WebSocket(url, { maxPayload: 1024 * 1024, handshakeTimeout: 5000 });
  const pending = new Map(); let nextId = 0, closed = false;
  const fail = () => { closed = true; for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Owned inspector connection closed')); } pending.clear(); };
  socket.on('error', (error) => { fail(); onEvent('transport-error', { message: error.message }); });
  socket.on('close', () => { fail(); onEvent('transport-closed', {}); });
  socket.on('message', (raw) => {
    let message;
    try { message = JSON.parse(String(raw)); } catch { fail(); socket.terminate(); onEvent('transport-error', { message: 'Invalid inspector JSON' }); return; }
    if (!record(message) || (typeof message.method === 'string'
      ? message.params !== undefined && !record(message.params)
      : !Number.isSafeInteger(message.id) || (!record(message.result) && !record(message.error)))) {
      fail(); socket.terminate(); onEvent('transport-error', { message: 'Invalid inspector packet shape' }); return;
    }
    if (typeof message.method === 'string') { onEvent(message.method, message.params ?? {}); return; }
    const request = pending.get(message.id); if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const client = {
    call(method, params = {}) {
      if (closed) return Promise.reject(new Error('Owned inspector is closed'));
      if (pending.size >= 32) return Promise.reject(new Error('Owned inspector request budget exceeded'));
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Owned inspector deadline: ${method}`)); }, 5000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }), (error) => { if (error) { const request = pending.get(id); pending.delete(id); clearTimeout(timer); request?.reject(error); } });
      });
    },
    async value(expression, callFrameId) {
      const result = await client.call(callFrameId ? 'Debugger.evaluateOnCallFrame' : 'Runtime.evaluate', {
        expression, returnByValue: true, ...(callFrameId ? { callFrameId } : {}),
      });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    },
    async close() {
      if (socket.readyState === WebSocket.CLOSED) return;
      await new Promise((resolve) => {
        const timer = setTimeout(() => { socket.terminate(); resolve(); }, 1000);
        socket.once('close', () => { clearTimeout(timer); resolve(); }); socket.close();
      });
    },
  };
  return client;
}
