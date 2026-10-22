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

/** Windows ConPTY fixture host. All inputs and outputs belong to the spawned fixture. */
export async function launchPty({ executable, args = [], cwd = process.cwd(), columns = 80, rows = 24, env = {}, logPath }) {
  if (process.platform !== 'win32') throw new Error('ConPTY fixtures require Windows.');
  const evidenceDirectory = logPath ? undefined : mkdtempSync(join(tmpdir(), 'crosschat-tui-pty-'));
  logPath ??= join(evidenceDirectory, 'events.jsonl');
  const environment = { ...process.env, ...env };
  delete environment.CROSSCHAT_LIVE;
  const host = spawn('pwsh', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-File', hostScript,
    '-Executable', executable,
    '-ArgumentsBase64', Buffer.from(JSON.stringify(args)).toString('base64'),
    '-WorkingDirectory', cwd,
    '-Columns', String(columns), '-Rows', String(rows),
  ], { cwd, env: environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

  let output = '';
  let stderr = '';
  let hostClosed = false;
  let childExit;
  let childPid;
  let failure;
  const events = [];
  const pending = new Set();
  const decoder = new StringDecoder('utf8');
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  let resolveExit;
  let rejectExit;
  const exited = new Promise((resolve, reject) => { resolveExit = resolve; rejectExit = reject; });
  // The host may fail before the caller receives the controller.
  void exited.catch(() => {});
  const record = (value) => appendFileSync(logPath, JSON.stringify({ at: Date.now(), ...value }) + '\n');
  function fail(error) {
    failure ??= error;
    rejectReady(failure);
    for (const wait of pending) { clearTimeout(wait.timer); wait.reject(failure); }
    pending.clear();
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
    record({ direction: 'host', ...value });
    events.push(value);
    if (value.event === 'ready') { childPid = value.pid; resolveReady(); }
    else if (value.event === 'output') {
      output += decoder.write(Buffer.from(value.data, 'base64'));
      if (output.length > 8 * 1024 * 1024) fail(new Error('Fixture exceeded the 8 MiB output limit.'));
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
      try { event(JSON.parse(line)); } catch (error) { fail(new Error(`Invalid ConPTY host event: ${line}`, { cause: error })); }
    }
  });
  host.stderr.setEncoding('utf8');
  host.stderr.on('data', (chunk) => { stderr += chunk; });
  host.stdin.on('error', (error) => {
    if (!hostClosed && !(childExit && error.code === 'EPIPE')) fail(error);
  });
  host.on('error', (error) => { fail(error); rejectExit(error); });
  host.on('close', (hostCode) => {
    hostClosed = true;
    record({ direction: 'driver', event: 'host-exit', code: hostCode });
    output += decoder.end();
    if (!childExit || hostCode !== 0) fail(new Error(`ConPTY host exited ${hostCode}: ${stderr || lines || 'no child exit event'}`));
    notify();
    if (failure) rejectExit(failure);
    else resolveExit({ code: childExit.code, hostCode });
    for (const wait of pending) { clearTimeout(wait.timer); wait.reject(new Error(`Fixture exited before output matched ${String(wait.pattern)}`)); }
    pending.clear();
  });
  const send = (value) => {
    if (hostClosed) throw new Error('The ConPTY host is already closed.');
    record({ direction: 'driver', ...value });
    host.stdin.write(JSON.stringify(value) + '\n');
  };
  let startupTimer;
  try {
    await Promise.race([
      ready,
      new Promise((_, reject) => { startupTimer = setTimeout(() => reject(new Error(`ConPTY startup timed out: ${stderr}`)), 20_000); }),
    ]);
  } catch (error) {
    host.stdin.end();
    host.kill();
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
          reject(new Error(`ConPTY output did not match ${String(pattern)}; log: ${logPath}; output tail: ${output.slice(-2000)}`));
        }, timeout);
        pending.add(wait);
      });
    },
    async dispose() {
      if (hostClosed) return;
      send({ op: 'terminate' });
      host.stdin.end();
      let timer;
      await Promise.race([
        exited.catch(() => {}),
        new Promise((resolve) => { timer = setTimeout(() => { host.kill(); resolve(); }, 3000); }),
      ]);
      clearTimeout(timer);
    },
  };
}
