// Controlled checks for W08-probe.mjs. Only local synthetic pipes and synthetic
// process tables: never reads the live process table, the user Desktop pipe, or
// any product state.
// Usage: node W08-probe-check.mjs [--out <new.json>]
/* global process */
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compareAnchors, pipeNameOf, sameInstance } from './W08-probe.mjs';

const probePath = fileURLToPath(new URL('./W08-probe.mjs', import.meta.url));
const BS = String.fromCharCode(92);
const pipePath = (name) => `${BS}${BS}.${BS}pipe${BS}${name}`;
const runProbe = (args, timeoutMs = 30_000, env = {}) => new Promise((resolve) => {
  execFile(process.execPath, [probePath, ...args], { timeout: timeoutMs, maxBuffer: 1024 * 1024, encoding: 'utf8', windowsHide: true, env: { ...process.env, ...env } },
    (error, stdout, stderr) => resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr }));
});
const json = (run) => { try { return JSON.parse(run.stdout); } catch { return undefined; } };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function listenPipe(name) {
  return new Promise((resolve, reject) => {
    const sockets = new Set();
    const stats = { accepted: 0, open: 0 };
    const server = net.createServer((socket) => {
      sockets.add(socket);
      stats.accepted += 1;
      stats.open += 1;
      socket.on('close', () => { sockets.delete(socket); stats.open -= 1; });
      socket.on('error', () => {});
    });
    server.on('error', reject);
    server.listen(pipePath(name), () => resolve({
      stats,
      close: () => new Promise((done) => { for (const socket of sockets) socket.destroy(); server.close(() => done()); }),
    }));
  });
}

/** A pipe server with exactly one instance: once a client takes it, a second
 *  client must wait. Node's own pipe server re-creates instances, so this uses
 *  a bounded native server instead. */
function startSingleInstancePipe(name) {
  const script = `$s=[System.IO.Pipes.NamedPipeServerStream]::new('${name}',[System.IO.Pipes.PipeDirection]::InOut,1,`
    + '[System.IO.Pipes.PipeTransmissionMode]::Byte,[System.IO.Pipes.PipeOptions]::Asynchronous);'
    + "$s.WaitForConnection();[Console]::Out.WriteLine('connected');[Console]::Out.Flush();Start-Sleep -Seconds 30";
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const ready = new Promise((resolve) => {
    const timer = setTimeout(resolve, 8000);
    child.stdout.on('data', (chunk) => { if (String(chunk).includes('connected')) { clearTimeout(timer); resolve(); } });
    child.on('exit', () => { clearTimeout(timer); resolve(); });
  });
  return { child, ready };
}

/** The server creates its pipe asynchronously, so retry until it accepts. */
async function takeSingleInstance(name) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const socket = net.createConnection(pipePath(name));
    const outcome = await new Promise((resolve) => {
      socket.once('connect', () => resolve('connected'));
      socket.once('error', (error) => resolve(error.code));
    });
    if (outcome === 'connected') return socket;
    socket.destroy();
    await wait(150);
  }
  return undefined;
}

/** Stand-in Desktop hub: records methods and answers only the two read-only calls. */
function fakeDesktopPipe(name, methods) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const size = buffer.readUInt32LE(0);
        if (buffer.length < size + 4) return;
        const message = JSON.parse(buffer.subarray(4, size + 4).toString('utf8'));
        buffer = buffer.subarray(size + 4);
        if (message.type !== 'request') continue;
        methods.push(message.method);
        const result = message.method === 'initialize'
          ? { type: 'response', requestId: message.requestId, method: message.method, resultType: 'success', handledByClientId: 'fake-client', result: { clientId: 'fake-client' } }
          : { type: 'response', requestId: message.requestId, method: message.method, resultType: 'success', handledByClientId: 'fake-owner', result: { supportsUntrustedAppInput: true } };
        const body = Buffer.from(JSON.stringify(result));
        const frame = Buffer.allocUnsafe(body.length + 4);
        frame.writeUInt32LE(body.length, 0);
        body.copy(frame, 4);
        socket.write(frame);
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(pipePath(name), () => resolve(
      () => new Promise((done) => { for (const socket of sockets) socket.destroy(); server.close(() => done()); }),
    ));
  });
}

const row = (pid, ppid, createdAt, name = 'node.exe', exeDigest = 'd'.repeat(12)) => ({ pid, ppid, createdAt, name, shape: 'node', exeDigest });

async function main() {
  const args = process.argv.slice(2);
  const outPath = args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined;
  if (args.includes('--out') && outPath === undefined) return { report: { error: '--out requires a path', wrote: false }, code: 2 };
  if (outPath !== undefined && existsSync(outPath)) return { report: { error: 'refusing to overwrite an existing output', out: outPath, wrote: false }, code: 3 };

  const checks = [];
  const record = (id, question, body) => {
    try {
      const { observed, pass } = body();
      checks.push({ id, question, pass, observed });
    } catch (error) { checks.push({ id, question, pass: false, observed: { error: String(error?.stack ?? error) } }); }
  };
  const recordAsync = async (id, question, body) => {
    try {
      const { observed, pass } = await body();
      checks.push({ id, question, pass, observed });
    } catch (error) { checks.push({ id, question, pass: false, observed: { error: String(error?.stack ?? error) } }); }
  };

  const suffix = `${process.pid}-${Date.now().toString(36)}`;

  await recordAsync('C1', 'Does the probe return the pid of the process that created the live pipe server?', async () => {
    const live = await listenPipe(`w08-check-live-${suffix}`);
    try {
      const run = await runProbe(['--pipe', `w08-check-live-${suffix}`, '--no-table']);
      const report = json(run);
      const query = report?.pipes?.[0]?.query;
      return { observed: { exitCode: run.code, query, expectedPid: process.pid, cleanup: report?.cleanup }, pass: run.code === 0 && query?.ok === true && query.serverPid === process.pid };
    } finally { await live.close(); }
  });

  await recordAsync('C2', 'Is a missing pipe reported as absent rather than as an empty success?', async () => {
    const run = await runProbe(['--pipe', `w08-check-absent-${suffix}`, '--no-table']);
    const query = json(run)?.pipes?.[0]?.query;
    return { observed: { exitCode: run.code, query }, pass: run.code === 0 && query?.ok === false && query?.errorKind === 'absent' && query?.nativeError === 2 };
  });

  await recordAsync('C3', 'Does the probe close its own connection after reading the pid?', async () => {
    const name = `w08-check-close-${suffix}`;
    const live = await listenPipe(name);
    try {
      await runProbe(['--pipe', name, '--no-table']);
      await wait(400);
      return { observed: { accepted: live.stats.accepted, open: live.stats.open }, pass: live.stats.accepted === 1 && live.stats.open === 0 };
    } finally { await live.close(); }
  });

  await recordAsync('C4', 'Does a pipe whose only instance is taken fail with a bounded timeout instead of hanging?', async () => {
    const name = `w08-check-busy-${suffix}`;
    const busy = startSingleInstancePipe(name);
    const taken = await takeSingleInstance(name);
    try {
      if (taken === undefined) return { observed: { taken: false }, pass: false };
      await busy.ready;
      const started = Date.now();
      const run = await runProbe(['--pipe', name, '--no-table']);
      const query = json(run)?.pipes?.[0]?.query;
      return { observed: { taken: true, elapsedMs: Date.now() - started, exitCode: run.code, query }, pass: query?.ok === false && query?.errorKind === 'timeout' && query?.nativeError === 121 };
    } finally {
      taken?.destroy();
      busy.child.kill();
    }
  });

  record('C5', 'Does an instance comparison refuse a reused pid and incomplete metadata?', () => {
    const base = { pid: 42, createdAt: 1_000 };
    const observed = {
      same: sameInstance(base, { pid: 42, createdAt: 1_000 }),
      reusedPid: sameInstance(base, { pid: 42, createdAt: 2_000 }),
      noCreationTime: sameInstance(base, { pid: 42 }),
      differentPid: sameInstance(base, { pid: 43, createdAt: 1_000 }),
      missing: sameInstance(base, undefined),
    };
    const pass = observed.same.same === true && observed.reusedPid.reason === 'pid-reused' && observed.noCreationTime.reason === 'missing-creation-time'
      && observed.differentPid.reason === 'different-pid' && observed.missing.reason === 'missing-metadata';
    return { observed, pass };
  });

  record('C6', 'Does an OS anchor distinguish same instance, shared ancestor only, unrelated and unverifiable?', () => {
    const ancestor = new Map([[300, row(300, 200, 30)], [200, row(200, 0, 20)]]);
    const shared = new Map([[300, row(300, 200, 30)], [200, row(200, 900, 20)], [900, row(900, 0, 10)], [100, row(100, 900, 15)]]);
    const unrelated = new Map([[300, row(300, 200, 30)], [200, row(200, 0, 20)], [555, row(555, 556, 25)], [556, row(556, 0, 12)]]);
    const observed = {
      sameProcess: compareAnchors({ serverPid: 300, selfPid: 300, table: ancestor }).relation,
      ancestor: compareAnchors({ serverPid: 200, selfPid: 300, table: ancestor }),
      sharedOnly: compareAnchors({ serverPid: 100, selfPid: 300, table: shared }).relation,
      unrelated: compareAnchors({ serverPid: 555, selfPid: 300, table: unrelated }).relation,
      absentPid: compareAnchors({ serverPid: 999, selfPid: 300, table: ancestor }),
      noPid: compareAnchors({ serverPid: undefined, selfPid: 300, table: ancestor }).relation,
    };
    const pass = observed.sameProcess === 'same-process' && observed.ancestor.relation === 'server-is-ancestor' && observed.ancestor.depth === 1
      && observed.sharedOnly === 'shared-ancestor-only' && observed.unrelated === 'unrelated'
      && observed.absentPid.relation === 'unverifiable' && observed.absentPid.reasons[0] === 'server-pid-not-in-process-table'
      && observed.noPid === 'unverifiable';
    return { observed, pass };
  });

  await recordAsync('C7', 'Is an existing --out refused before any pipe is opened?', async () => {
    const root = mkdtempSync(join(tmpdir(), 'w08-check-'));
    try {
      const existing = join(root, 'existing.json');
      writeFileSync(existing, 'sentinel-bytes', 'utf8');
      const run = await runProbe(['--pipe', `w08-check-refuse-${suffix}`, '--no-table', '--out', existing]);
      const bytes = readFileSync(existing, 'utf8');
      return { observed: { exitCode: run.code, bytesUnchanged: bytes === 'sentinel-bytes', report: json(run) }, pass: run.code === 3 && bytes === 'sentinel-bytes' };
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  record('C8', 'Does a pipe path reduce to the pipe name?', () => {
    const observed = { win: pipeNameOf(`${BS}${BS}.${BS}pipe${BS}codex-ipc`), bare: pipeNameOf('codex-ipc'), empty: pipeNameOf('') };
    return { observed, pass: observed.win === 'codex-ipc' && observed.bare === 'codex-ipc' && observed.empty === '' };
  });

  await recordAsync('C9', 'Does owner discovery send only initialize and thread-owner-discovery, and keep the owner id redacted?', async () => {
    const name = `w08-check-owner-${suffix}`;
    const methods = [];
    const close = await fakeDesktopPipe(name, methods);
    try {
      const run = await runProbe(['--pipe', name, '--no-table', '--owner'], 30_000, { CODEX_THREAD_ID: 'fake-thread' });
      const report = json(run);
      const owner = report?.owner;
      const digest = createHash('sha256').update('fake-owner').digest('hex').slice(0, 12);
      return {
        observed: { exitCode: run.code, methods, owner, ownerIdLeaked: JSON.stringify(report).includes('fake-owner') },
        pass: run.code === 0
          && methods.join(',') === 'initialize,thread-owner-discovery'
          && owner?.known === true && owner?.namespace === 'client-id' && owner?.osPidEquivalent === false && owner?.digest === digest
          && JSON.stringify(report).includes('fake-owner') === false,
      };
    } finally { await close(); }
  });

  const failed = checks.filter((check) => check.pass !== true).length;
  const report = { probe: 'c14-desktop-os-source-anchor-checks', version: 1, generatedAt: new Date().toISOString(), node: process.version, platform: process.platform, checks, passed: checks.length - failed, failed, wrote: false };
  if (outPath !== undefined) {
    try {
      writeFileSync(outPath, `${JSON.stringify({ ...report, wrote: true }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      report.wrote = true;
    } catch (error) { report.writeError = String(error?.code ?? error); }
  }
  return { report, code: failed === 0 && report.writeError === undefined ? 0 : 1 };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outcome = await main();
  process.stdout.write(`${JSON.stringify(outcome.report, null, 2)}\n`);
  if (typeof outcome.code === 'number') process.exitCode = outcome.code;
}
