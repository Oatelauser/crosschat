import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { runDshDesktopProcess } from '../../scripts/dsh-compat-ci.mjs';
import { prepareDshProfile, pollDsh, runDshCommand } from './dsh-live-fixture.mjs';
import { createDshMockModel } from './dsh-mock-model.mjs';
import { assessDshDesktopNaturalExit, connectDshExitInspector, DSH_DESKTOP_MAIN_SHA256, locateDshDesktopExitBreakpoints } from './dsh-desktop-exit-observer.mjs';

assert.equal(process.env.CROSSCHAT_LIVE, '1'); assert.equal(process.platform, 'win32');
const root = await realpath(process.env.DSH_DESKTOP_EXIT_ROOT);
const owner = JSON.parse(await readFile(join(root, 'ownership.json'), 'utf8'));
assert.equal(owner.task, 'c04-native-natural-exit'); assert.equal(owner.root, root);
const artifacts = await mkdtemp(join(root, 'round-'));
const binary = resolve('D:/soft/DeepSeek Harness/DeepSeek Harness.exe');
const appPackage = resolve('D:/soft/DeepSeek Harness/resources/app.asar/package.json');
const model = await createDshMockModel(() => ({ text: 'owned passive-exit fixture' }));
const env = await prepareDshProfile(join(artifacts, 'native'), model.url);
const project = join(env.DSH_HOME, 'profiles', 'desktop');
await mkdir(project, { recursive: true }); await mkdir(join(env.HOME, 'Documents'), { recursive: true });
await writeFile(join(project, 'cordis.patch.yml'), JSON.stringify([
  { id: 'session-title-llm', disabled: true },
  { id: 'workspace-controller', config: { documentsDirectory: join(env.HOME, 'Documents') } },
]));
const report = { expectedSourceSha256: DSH_DESKTOP_MAIN_SHA256, continuous: true, errors: [], events: [], pauses: [],
  scope: 'Fixed formal user-retained Desktop; passive debugger + native held handle; no install/uninstall/C2 execution' };
const electron = `process.getBuiltinModule('node:module').createRequire(${JSON.stringify(appPackage)})('electron')`;
const protocol = []; const points = new Map();
let main, child, mainResult, hostMonitor, hostReady, finishing, queue = Promise.resolve(), observing = false, ownMain = false, quitRequested = false, mainExited = false;

async function freePort() {
  const server = createServer(); await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const address = server.address(); assert(address && typeof address !== 'string');
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done())); return address.port;
}
async function save(name, value) { await writeFile(join(artifacts, name), JSON.stringify(value, null, 2) + '\n'); }
function error(label, failure) {
  const message = failure instanceof Error ? failure.message : String(failure);
  report.errors.push({ label, message }); process.stderr.write(`${label}: ${message}\n`);
}
async function step(phase) { report.phase = phase; await save('progress.json', { phase }); process.stdout.write(`${phase}\n`); }
async function observeHost(pid) {
  const ready = join(artifacts, 'host-handle-ready.json'), script = join(artifacts, 'hold-native-host.ps1');
  await writeFile(script, `param([int]$TargetPid,[string]$ReadyFile)\n$ErrorActionPreference='Stop'\n$heldHost=[Diagnostics.Process]::GetProcessById($TargetPid)\n$null=$heldHost.Handle\n$created=$heldHost.StartTime.ToUniversalTime().ToString('o')\n$executable=$heldHost.MainModule.FileName\n@{pid=$heldHost.Id;creationTime=$created;executable=$executable} | ConvertTo-Json -Compress | Set-Content -LiteralPath $ReadyFile\nif (-not $heldHost.WaitForExit(150000)) { throw 'Owned Host did not close within observation budget' }\n@{pid=$heldHost.Id;creationTime=$created;executable=$executable;exitCode=$heldHost.ExitCode} | ConvertTo-Json -Compress\n$heldHost.Dispose()\n`);
  hostMonitor = runDshCommand('pwsh', ['-NoProfile', '-NonInteractive', '-File', script, '-TargetPid', String(pid), '-ReadyFile', ready], { env, timeout: 160000 });
  hostReady = await pollDsh(async () => { try { return JSON.parse(await readFile(ready, 'utf8')); } catch (failure) { if (failure.code !== 'ENOENT') throw failure; } }, 'held actual Host handle', 10000);
  assert.equal(hostReady.pid, pid); assert.equal(hostReady.executable.toLowerCase(), binary.toLowerCase());
}
async function paused(params) {
  const point = params.hitBreakpoints?.map((id) => points.get(id)).find(Boolean);
  if (!point) { error('unexpected debugger pause', params.reason); await main.call('Debugger.resume'); return; }
  const started = performance.now(), frame = params.callFrames[0];
  const expressions = {
    birth: '({parentPid:process.pid,pid:child.pid,projectDir:this.projectDir,binary:child.spawnfile,spawnargs:child.spawnargs})',
    ready: '({pid:child.pid,url:message.url})',
    shutdown: '({pid:child.pid,connected:child.connected,stopping:this.stopping})',
    ack: '({pid:child.pid,type:message.type,stopping:this.stopping})',
    close: '({pid:child.pid,code,signal:child.signalCode})',
    complete: '({pid:child.pid,graceful,shutdownCompleted:this.shutdownCompleted,code:child.exitCode,signal:child.signalCode,stdoutDestroyed:child.stdout?.destroyed===true,stderrDestroyed:child.stderr?.destroyed===true,stderrTail:this.stderr})',
  };
  try {
    assert.equal(frame.location.scriptId, report.mainScriptId);
    const value = await main.value(expressions[point.kind] ?? '({pid:child.pid})', frame.callFrameId);
    if (point.kind === 'birth') { await observeHost(value.pid); report.events.push({ kind: 'birth', ...value }); }
    else if (point.kind === 'ready') report.ready = value;
    else if (point.kind.startsWith('kill-')) report.events.push({ kind: 'kill', site: point.kind, signal: point.kind === 'kill-kill' ? 'SIGKILL' : 'SIGTERM', ...value });
    else report.events.push({ kind: point.kind, ...value });
    await save('lifecycle-events.json', report.events);
  } catch (failure) { error(point.kind, failure); }
  finally {
    report.pauses.push({ kind: point.kind, elapsedMs: Math.round(performance.now() - started) });
    try { await main.call('Debugger.resume'); } catch (failure) { if (!report.events.some((event) => event.kind === 'complete')) error('debugger resume', failure); }
  }
}
function event(method, params) {
  if (method === 'Debugger.scriptParsed' || method === 'Debugger.paused') protocol.push({ method, params });
  if (method === 'transport-error') error('inspector transport', params.message);
  if (method === 'transport-closed' && observing && !report.events.some((entry) => entry.kind === 'complete')) report.continuous = false;
  if (observing && method === 'Debugger.paused') queue = queue.then(() => paused(params)).catch((failure) => error('pause handler', failure));
}
async function quit() {
  if (!main || !ownMain || quitRequested) return;
  quitRequested = true;
  await main.value(`setTimeout(()=>${electron}.app.quit(),100);true`);
}
async function finish() {
  return finishing ??= (async () => {
    await step('request-normal-quit');
    try { await quit(); } catch (failure) { error('normal Quit request', failure); }
    if (observing) {
      try {
        await pollDsh(() => mainExited || report.events.some((entry) => entry.kind === 'complete'), 'native shutdown completion before debugger release', 30000);
        await queue;
      } catch (failure) { report.continuous = false; error('native stop before debugger release', failure); }
    }
    // An attached Node inspector can itself hold process exit open. Release it only after the exact Host
    // completed, or explicitly mark the incomplete observation above; never wait for main close first.
    await step('release-observer-connection');
    try { await main?.close(); } catch (failure) { error('inspector close', failure); }
    mainResult = await application;
  })();
}

const port = await freePort();
const application = runDshDesktopProcess(binary, [`--inspect-brk=127.0.0.1:${port}`, `--user-data-dir=${join(artifacts, 'electron-user-data')}`], {
  cwd: join(artifacts, 'native', 'workspace'), env, timeoutMs: 180000,
  spawnImpl: (...args) => { child = spawn(...args); return child; },
});
void application.then(() => { mainExited = true; });
try {
  const target = await pollDsh(async () => {
    const response = await globalThis.fetch(`http://127.0.0.1:${port}/json/list`, { signal: globalThis.AbortSignal.timeout(1000) });
    return (await response.json())[0];
  }, 'owned main debugger', 20000);
  await step('verify-owned-loopback-listener');
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR; assert(systemRoot);
  const listeners = await runDshCommand(join(systemRoot, 'System32', 'netstat.exe'), ['-ano', '-p', 'tcp'], { env, timeout: 5000 });
  assert.equal(listeners.code, 0); assert.equal(listeners.signal, null); assert.equal(listeners.timedOut, false);
  assert(listeners.stdout.split(/\r?\n/).some((line) => {
    const parts = line.trim().split(/\s+/); return parts[0] === 'TCP' && parts[1] === `127.0.0.1:${port}` && parts[3] === 'LISTENING' && Number(parts[4]) === child.pid;
  }), 'Inspector listener must belong to the exact child before startup is released');
  ownMain = true;
  main = await connectDshExitInspector(target.webSocketDebuggerUrl, event);
  await step('release-debugger-startup-gate');
  await main.call('Runtime.enable'); await main.call('Debugger.enable'); await main.call('Runtime.runIfWaitingForDebugger');
  await pollDsh(() => protocol.find((entry) => entry.method === 'Debugger.paused'), 'main paused before startup', 10000);
  const officialScript = () => protocol.find((entry) => entry.method === 'Debugger.scriptParsed' && typeof entry.params.url === 'string' && entry.params.url.replaceAll('\\', '/').endsWith('/resources/app.asar/lib/main.js'));
  let entryBreakpoint;
  if (!officialScript()) {
    const after = protocol.length;
    entryBreakpoint = (await main.call('Debugger.setBreakpointByUrl', { urlRegex: 'resources[/\\\\]app\\.asar[/\\\\]lib[/\\\\]main\\.js$', lineNumber: 0, columnNumber: 0 })).breakpointId;
    await main.call('Debugger.resume');
    await pollDsh(() => protocol.slice(after).find((entry) => entry.method === 'Debugger.paused' && entry.params.hitBreakpoints?.includes(entryBreakpoint)), 'official main entry before Host spawn', 10000);
  }
  await step('bind-pinned-main-lifecycle');
  const script = await pollDsh(officialScript, 'official main script before Host spawn', 10000);
  const startupPause = [...protocol].reverse().find((entry) => entry.method === 'Debugger.paused');
  assert.equal(await main.value('process.pid', startupPause.params.callFrames[0].callFrameId), child.pid);
  report.mainScriptId = script.params.scriptId;
  const source = await main.call('Debugger.getScriptSource', { scriptId: report.mainScriptId });
  report.observedScriptSha256 = createHash('sha256').update(source.scriptSource).digest('hex');
  const breakpoints = locateDshDesktopExitBreakpoints(source.scriptSource);
  report.sourceSha256 = DSH_DESKTOP_MAIN_SHA256;
  report.boundBreakpoints = [];
  for (const point of breakpoints) {
    const bound = await main.call('Debugger.setBreakpoint', { location: { scriptId: report.mainScriptId, lineNumber: point.lineNumber, columnNumber: point.columnNumber },
      ...(point.condition ? { condition: point.condition } : {}) });
    assert.equal(bound.actualLocation.lineNumber, point.lineNumber, `Breakpoint must stay on the exact ${point.kind} statement`);
    points.set(bound.breakpointId, point); report.boundBreakpoints.push({ kind: point.kind, ...bound.actualLocation });
  }
  if (entryBreakpoint) await main.call('Debugger.removeBreakpoint', { breakpointId: entryBreakpoint });
  await step('await-real-native-host-and-window');
  observing = true; await main.call('Debugger.resume');
  await pollDsh(() => report.ready && report.events.find((entry) => entry.kind === 'birth'), 'native Host ready under continuous observation', 60000);
  await queue;
  const facts = await main.value(`({pid:process.pid,dshHome:process.env.DSH_HOME,userData:${electron}.app.getPath('userData'),version:${electron}.app.getVersion()})`);
  assert.equal(facts.pid, child.pid); assert.equal(facts.dshHome, env.DSH_HOME); assert.equal(facts.userData, join(artifacts, 'electron-user-data')); assert.equal(facts.version, '0.2.1-rc.2');
  await pollDsh(() => main.value(`${electron}.BrowserWindow.getAllWindows().some(w=>w.webContents.getURL()==='dsh-app://app/'&&!w.webContents.isLoadingMainFrame())`), 'loaded formal app window', 30000);
  report.facts = facts;
  await finish();
} catch (failure) { error('native exit probe', failure); }
finally {
  if (!observing && main && ownMain) {
    try { await main.call('Runtime.runIfWaitingForDebugger'); } catch (failure) { error('release startup gate', failure); }
    try { await main.call('Debugger.resume'); } catch (failure) { error('release startup execution', failure); }
    try { await main.call('Debugger.disable'); } catch (failure) { error('release startup pause', failure); }
  }
  await finish();
  await queue;
  report.main = mainResult;
  if (hostMonitor) {
    try {
      const result = await hostMonitor; await save('host-handle-process.json', result);
      assert.equal(result.code, 0); assert.equal(result.signal, null); assert.equal(result.timedOut, false);
      report.hostHandle = { ...JSON.parse(result.stdout), heldBeforeShutdown: Boolean(hostReady) };
    } catch (failure) { error('held Host observation', failure); }
  }
  try { await model.close(); } catch (failure) { error('mock close', failure); }
  report.assessment = assessDshDesktopNaturalExit(report, { parentPid: child.pid, projectDir: project, binary, sourceSha256: DSH_DESKTOP_MAIN_SHA256 });
  report.c2AdmissibleRecordProduced = false;
  if (report.errors.length) await save('startup-debugger-scripts.json', protocol.filter((entry) => entry.method === 'Debugger.scriptParsed').map((entry) => ({ id: entry.params.scriptId, url: entry.params.url })));
  await save('exit-observation.json', report);
  process.stdout.write(JSON.stringify({ artifacts, assessment: report.assessment, errors: report.errors }) + '\n');
  if (!report.assessment.verified) process.exitCode = 1;
}
