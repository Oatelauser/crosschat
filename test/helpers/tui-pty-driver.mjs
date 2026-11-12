import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { StringDecoder } from 'node:string_decoder';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';

const hostScript = join(dirname(fileURLToPath(import.meta.url)), 'tui-pty-host.ps1');
const posixHostScript = join(dirname(fileURLToPath(import.meta.url)), 'tui-pty-host.py');
const linuxHostScript = join(dirname(fileURLToPath(import.meta.url)), 'tui-pty-host-linux.py');

/** Each platform host owns its terminal and child tree; one controller owns their JSONL protocol. */
export async function launchPty({ executable, args = [], cwd = process.cwd(), columns = 80, rows = 24, env = {}, logPath }) {
  const linux = process.platform === 'linux';
  const windows = process.platform === 'win32';
  if (!linux && !windows && process.platform !== 'darwin') throw new Error('PTY fixtures require Windows ConPTY or a POSIX PTY host.');
  const maximumDimension = process.platform === 'darwin' ? 1000 : 32767;
  for (const dimension of [columns, rows]) if (!Number.isInteger(dimension) || dimension < 1 || dimension > maximumDimension) throw new Error('Invalid PTY dimensions.');
  const evidenceDirectory = logPath ? undefined : mkdtempSync(join(tmpdir(), 'crosschat-tui-pty-'));
  logPath ??= join(evidenceDirectory, 'events.jsonl');
  const environment = { ...process.env, ...env };
  delete environment.CROSSCHAT_LIVE;
  const label = windows ? 'ConPTY' : 'POSIX PTY';
  const payload = Buffer.from(JSON.stringify({ executable, args, cwd, columns, rows })).toString('base64');
  const hostArgs = linux ? [linuxHostScript, payload] : windows ? [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-File', hostScript,
    '-Executable', executable,
    '-ArgumentsBase64', Buffer.from(JSON.stringify(args)).toString('base64'),
    '-WorkingDirectory', cwd,
    '-Columns', String(columns), '-Rows', String(rows),
  ] : ['-I', '-u', posixHostScript, payload];
  const host = spawn(windows ? 'pwsh' : 'python3', hostArgs, { cwd, env: environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

  let output = '';
  let stderr = '';
  let hostClosed = false;
  let childExit;
  let childPid;
  let failure;
  let disposal;
  const events = [];
  const pending = new Set();
  const decoder = new StringDecoder('utf8');
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  let resolveExit;
  let rejectExit;
  const exited = new Promise((resolve, reject) => { resolveExit = resolve; rejectExit = reject; });
  let resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });
  // The host may fail before the caller receives the controller.
  void exited.catch(() => {});
  const record = (value) => {
    try { appendFileSync(logPath, JSON.stringify({ at: Date.now(), ...value }) + '\n'); }
    catch (error) { fail(error); }
  };
  function fail(error) {
    failure ??= error;
    rejectReady(failure);
    for (const wait of pending) { clearTimeout(wait.timer); wait.reject(failure); }
    pending.clear();
    // Closing control stdin asks either host to release its owned terminal and process tree.
    host.stdin.end();
  }
  function matches(pattern, from = 0) {
    const text = output.slice(from);
    if (typeof pattern === 'string') return text.includes(pattern);
    pattern.lastIndex = 0;
    return pattern.test(text);
  }
  function notify() {
    for (const wait of pending) {
      if (matches(wait.pattern, wait.from)) { clearTimeout(wait.timer); pending.delete(wait); wait.resolve(output); }
    }
  }
  function event(value) {
    if (value === null || typeof value !== 'object' || typeof value.event !== 'string') throw new Error('Malformed PTY host event.');
    if (failure && value.event === 'output') return;
    record({ direction: 'host', ...value });
    events.push(value);
    if (value.event === 'ready') { childPid = value.pid; resolveReady(); }
    else if (value.event === 'output') {
      output += decoder.write(Buffer.from(value.data, 'base64'));
      if (output.length > 8 * 1024 * 1024) { output = output.slice(0, 8 * 1024 * 1024); fail(new Error('Fixture exceeded the 8 MiB output limit.')); }
      notify();
    } else if (value.event === 'exit') childExit = value;
    else if (value.event === 'error') fail(new Error(value.message));
  }
  let lines = '';
  host.stdout.setEncoding('utf8');
  host.stdout.on('data', (chunk) => {
    lines += chunk;
    let newline;
    while ((newline = lines.indexOf('\n')) !== -1) {
      const line = lines.slice(0, newline).trim();
      lines = lines.slice(newline + 1);
      if (!line) continue;
      try { event(JSON.parse(line)); } catch (error) { fail(new Error(`Invalid ${label} host event`, { cause: error })); }
    }
    if (lines.length > 1024 * 1024) { lines = ''; fail(new Error(`${label} host event exceeded the 1 MiB limit.`)); }
  });
  host.stderr.setEncoding('utf8');
  host.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-64000); });
  host.stdin.on('error', (error) => {
    if (!hostClosed && !(childExit && error.code === 'EPIPE')) fail(error);
  });
  host.on('error', (error) => { fail(error); rejectExit(error); });
  host.on('close', (hostCode) => {
    hostClosed = true;
    record({ direction: 'driver', event: 'host-exit', code: hostCode });
    output += decoder.end();
    if (!childExit || hostCode !== 0) fail(new Error(`${label} host exited ${hostCode}: ${stderr || lines || 'no child exit event'}`));
    if (linux && childExit?.cleanup?.complete !== true) fail(new Error('POSIX PTY host could not confirm owned process cleanup.'));
    notify();
    if (failure) rejectExit(failure);
    else resolveExit({ code: childExit.code, hostCode });
    for (const wait of pending) { clearTimeout(wait.timer); wait.reject(new Error(`Fixture exited before output matched ${String(wait.pattern)}`)); }
    pending.clear();
    resolveClosed();
  });
  const send = (value) => {
    if (failure) throw failure;
    if (hostClosed || host.stdin.writableEnded) throw new Error(`The ${label} host is already closing or closed.`);
    record({ direction: 'driver', ...value });
    host.stdin.write(JSON.stringify(value) + '\n');
  };
  async function waitUntilClosed(milliseconds) {
    let timer;
    try { return await Promise.race([closed.then(() => true), new Promise((resolve) => { timer = setTimeout(() => resolve(false), milliseconds); })]); }
    finally { clearTimeout(timer); }
  }
  async function dispose() {
    if (disposal) return disposal;
    disposal = (async () => {
      if (!hostClosed && !host.stdin.writableEnded) {
        send({ op: 'terminate' });
        host.stdin.end();
      }
      if (!await waitUntilClosed(6000)) {
        host.kill();
        if (!await waitUntilClosed(3000)) {
          host.kill('SIGKILL');
          await waitUntilClosed(1000);
          throw new Error(`${label} host exceeded its cleanup deadline; fixture release is unconfirmed.`);
        }
      }
      if (linux && childExit?.cleanup?.complete !== true) throw new Error('POSIX PTY process cleanup was not confirmed.');
    })();
    return disposal;
  }
  let startupTimer;
  try {
    await Promise.race([
      ready,
      new Promise((_, reject) => { startupTimer = setTimeout(() => reject(new Error(`${label} startup timed out: ${stderr}`)), 20_000); }),
    ]);
  } catch (error) {
    try { await dispose(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], `${label} startup and cleanup failed`, { cause: error }); }
    throw error;
  } finally { clearTimeout(startupTimer); }
  return {
    childPid,
    logPath,
    events,
    exited,
    get output() { return output; },
    write(text) { send({ op: 'write', data: Buffer.from(text).toString('base64') }); },
    resize(nextColumns, nextRows) { send({ op: 'resize', columns: nextColumns, rows: nextRows }); },
    waitForOutput(pattern, timeout = 10_000, from = 0) {
      if (matches(pattern, from)) return Promise.resolve(output);
      if (failure) return Promise.reject(failure);
      if (hostClosed) return Promise.reject(new Error(`Fixture exited before output matched ${String(pattern)}`));
      return new Promise((resolve, reject) => {
        const wait = { pattern, from, resolve, reject, timer: undefined };
        wait.timer = setTimeout(() => {
          pending.delete(wait);
          reject(new Error(`${label} output did not match ${String(pattern)}; log: ${logPath}; output tail: ${output.slice(-2000)}`));
        }, timeout);
        pending.add(wait);
      });
    },
    dispose,
  };
}
