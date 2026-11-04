import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { isAbsolute, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { runDshDesktopProcess } from '../../scripts/dsh-compat-ci.mjs';
import { assessDshCallerSourceIdentity, dshIdentityBootstrapCommand, prepareDshProfile, pollDsh, repositoryRoot, runDshCommand, snapshotDshStoredChats } from './dsh-live-fixture.mjs';
import { createDshMockModel } from './dsh-mock-model.mjs';
import { assessDshDesktopNaturalExit, connectDshExitInspector, DSH_DESKTOP_MAIN_SHA256, locateDshDesktopExitBreakpoints, resolveOwnedDshDesktopProfile, serializeDshExitEvidence } from './dsh-desktop-exit-observer.mjs';
import { inspectDshBridges, listDshThreads } from '../../dist/dsh/client.js';

assert.equal(process.env.CROSSCHAT_LIVE, '1'); assert.equal(process.platform, 'win32');
const root = await realpath(process.env.DSH_DESKTOP_EXIT_ROOT);
const owner = JSON.parse(await readFile(join(root, 'ownership.json'), 'utf8'));
assert.equal(owner.task, 'c04-native-natural-exit'); assert.equal(owner.root, root);
const artifacts = await mkdtemp(join(root, 'round-'));
const binary = resolve('D:/soft/DeepSeek Harness/DeepSeek Harness.exe');
const appPackage = resolve('D:/soft/DeepSeek Harness/resources/app.asar/package.json');
const profileRoot = await resolveOwnedDshDesktopProfile(root, process.env.DSH_DESKTOP_EXIT_PROFILE_ROOT ?? join(artifacts, 'native'));
const live = process.env.DSH_DESKTOP_EXIT_LIVE === '1', marker = `C04_NATURAL_NATIVE_${randomUUID().slice(0, 8)}`;
let identityIssued = false;
const model = await createDshMockModel((body) => {
  if (live && !identityIssued && body.tools?.some((tool) => tool.name === 'pwsh') && JSON.stringify(body.messages).includes(marker)) {
    identityIssued = true; return { tool: { id: marker, name: 'pwsh', input: { command: dshIdentityBootstrapCommand(), description: 'Read the exact owned native Desktop caller identity' } } };
  }
  return { text: `${marker}_ACK` };
});
let env, project;
try {
  env = await prepareDshProfile(profileRoot, model.url); project = join(env.DSH_HOME, 'profiles', 'desktop');
  await mkdir(project, { recursive: true }); await mkdir(join(env.HOME, 'Documents'), { recursive: true });
  await writeFile(join(project, 'cordis.patch.yml'), JSON.stringify([
    { id: 'session-title-llm', disabled: true },
    { id: 'workspace-controller', config: { documentsDirectory: join(env.HOME, 'Documents') } },
    ...(live ? [{ id: 'crosschat-dsh-bridge', config: { home: env.HOME } }] : []),
  ]));
} catch (failure) { await model.close(); throw failure; }
const report = { expectedSourceSha256: DSH_DESKTOP_MAIN_SHA256, continuous: true, errors: [], events: [], pauses: [],
  nativeUiTurnRequested: live,
  scope: 'Fixed formal user-retained Desktop; passive debugger + native held handle; no application install/official uninstall/C2 execution' };
const electron = `process.getBuiltinModule('node:module').createRequire(${JSON.stringify(appPackage)})('electron')`;
const protocol = []; const points = new Map();
let main, renderer, child, mainResult, hostMonitor, hostReady, finishing, queue = Promise.resolve(), observing = false, ownMain = false, quitRequested = false, mainExited = false;

async function freePort() {
  const server = createServer(); await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const address = server.address(); assert(address && typeof address !== 'string');
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done())); return address.port;
}
async function save(name, value) { await writeFile(join(artifacts, name), serializeDshExitEvidence(value)); }
function error(label, failure) {
  const message = failure instanceof Error ? failure.message : String(failure);
  report.errors.push({ label, message, ...(failure instanceof Error ? { stack: failure.stack } : {}) }); process.stderr.write(`${label}: ${message}\n`);
}
async function step(phase) { report.phase = phase; await save('progress.json', { phase }); process.stdout.write(`${phase}\n`); }
async function bridgeRegistrations() {
  try { return await readdir(join(env.HOME, '.crosschat', 'dsh', 'instances')); }
  catch (failure) { if (failure.code !== 'ENOENT') throw failure; return []; }
}
async function ownedListener(port) {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR; assert(systemRoot);
  const listeners = await runDshCommand(join(systemRoot, 'System32', 'netstat.exe'), ['-ano', '-p', 'tcp'], { env, timeout: 5000 });
  assert.equal(listeners.code, 0); assert.equal(listeners.signal, null); assert.equal(listeners.timedOut, false);
  assert(listeners.stdout.split(/\r?\n/).some((line) => {
    const parts = line.trim().split(/\s+/); return parts[0] === 'TCP' && parts[1] === `127.0.0.1:${port}` && parts[3] === 'LISTENING' && Number(parts[4]) === child.pid;
  }), 'Inspector listener must belong to the exact child');
}
async function nativeUiTurn(rendererPort) {
  await step('verify-current-ui-session-and-native-caller'); await ownedListener(rendererPort);
  const target = await pollDsh(async () => {
    const response = await globalThis.fetch(`http://127.0.0.1:${rendererPort}/json/list`, { signal: globalThis.AbortSignal.timeout(1000) });
    return (await response.json()).find((entry) => entry.type === 'page' && entry.url === 'dsh-app://app/');
  }, 'owned formal renderer', 10000);
  renderer = await connectDshExitInspector(target.webSocketDebuggerUrl, (method, params) => { if (method === 'transport-error') error('renderer transport', params.message); });
  await pollDsh(() => renderer.value(`Boolean(document.querySelector('[contenteditable="true"]'))`), 'actual native composer', 20000);
  await renderer.value(`document.querySelector('[contenteditable="true"]').focus();true`);
  await renderer.call('Input.insertText', { text: marker });
  await renderer.value(`document.querySelector('button[aria-label="发送消息"]').click();true`);
  await pollDsh(() => renderer.value(`document.body.innerText.includes(${JSON.stringify(`${marker}_ACK`)})`), 'unique native UI identity answer', 30000);
  assert(identityIssued);
  const bridges = await inspectDshBridges({ home: env.HOME }); assert.equal(bridges.length, 1);
  assert.equal(bridges[0].endpointType, 'desktop'); assert.equal(bridges[0].pid, report.events[0].pid);
  const threads = await listDshThreads({ home: env.HOME }); assert.equal(threads.length, 1);
  const native = threads[0]; assert.equal(native.endpointType, 'desktop');
  const requests = model.requests.map((body) => ({ messages: body.messages.map((message) => ({ ...message,
    content: Array.isArray(message.content) ? message.content.filter((part) => part.type === 'tool_result' && part.tool_use_id === marker) : [],
  })) }));
  await save('native-tool-results.json', requests);
  await pollDsh(async () => (await listDshThreads({ home: env.HOME })).some((entry) => entry.id === native.id && entry.rawStatus.type === 'idle'), 'this exact native session idle', 10000);
  const identity = assessDshCallerSourceIdentity(requests, { session: native.id, profile: 'desktop', dshHome: env.DSH_HOME, sourceTool: 'dsh-desktop' });
  assert.equal(identity.ready, true); assert.equal(identity.source.sourceTool, 'dsh-desktop');
  const workspaces = JSON.parse(await readFile(join(env.DSH_HOME, 'storages', 'workspace.json'), 'utf8'));
  const paths = [];
  for (const entry of Object.values(workspaces.tables.workspaces)) {
    const path = await realpath(entry.path), inside = relative(profileRoot, path); assert(inside && !inside.startsWith('..') && !isAbsolute(inside)); paths.push(inside);
  }
  assert(paths.length > 0);
  report.nativeSessionIdentity = { nativeId: native.id, endpointType: native.endpointType, source: identity.source, hostPid: bridges[0].pid, marker, ownedWorkspacePaths: paths };
  await save('native-session-identity.json', { ...report.nativeSessionIdentity, actualToolResults: requests });
}
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
    ready: '({pid:child.pid,urlOrigin:new URL(message.url).origin})',
    shutdown: '({pid:child.pid,connected:child.connected,stopping:this.stopping})',
    ack: '({pid:child.pid,type:message.type,stopping:this.stopping})',
    inspection: '({pid:child.pid,activeTasks:message.activeTasks,scheduledTasks:message.scheduledTasks})',
    close: '({pid:child.pid,code,signal:child.signalCode})',
    complete: '({pid:child.pid,graceful,shutdownCompleted:this.shutdownCompleted,code:child.exitCode,signal:child.signalCode,stdoutDestroyed:child.stdout?.destroyed===true,stderrDestroyed:child.stderr?.destroyed===true,stderrTail:this.stderr})',
  };
  try {
    assert.equal(frame.location.scriptId, report.mainScriptId);
    const value = await main.value(expressions[point.kind] ?? '({pid:child.pid})', frame.callFrameId);
    if (point.kind === 'birth') { await observeHost(value.pid); report.events.push({ kind: 'birth', ...value }); }
    else if (point.kind === 'ready') report.ready = value;
    else if (point.kind === 'inspection') report.quitInspection = value;
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
    if (live && observing && !mainExited && report.events.some((entry) => entry.kind === 'birth')) {
      try {
        await pollDsh(async () => {
          const bridges = await inspectDshBridges({ home: env.HOME });
          assert.equal(bridges.length, 1); assert.equal(bridges[0].pid, report.events[0].pid);
          const roots = await listDshThreads({ home: env.HOME }); return roots.every((entry) => entry.rawStatus.type === 'idle');
        }, 'owned UI sessions idle before Quit', 10000);
        report.uiIdleBeforeQuit = true;
      } catch (failure) { error('owned UI idle before Quit', failure); }
    }
    try { await renderer?.close(); } catch (failure) { error('renderer close', failure); }
    try { await step('request-normal-quit'); } catch (failure) { error('Quit progress evidence', failure); }
    try { await quit(); } catch (failure) { error('normal Quit request', failure); }
    if (observing) {
      try {
        await pollDsh(() => mainExited || report.events.some((entry) => entry.kind === 'complete'), 'native shutdown completion before debugger release', 30000);
        await queue;
      } catch (failure) { report.continuous = false; error('native stop before debugger release', failure); }
    }
    // An attached Node inspector can itself hold process exit open. Release it only after the exact Host
    // completed, or explicitly mark the incomplete observation above; never wait for main close first.
    try { await step('release-observer-connection'); } catch (failure) { error('disconnect progress evidence', failure); }
    try { await main?.close(); } catch (failure) { error('inspector close', failure); }
    try { mainResult = await application; } catch (failure) { error('main process result', failure); mainResult = { failed: true }; }
  })();
}

let port, rendererPort;
try {
  if (live) {
    await step('official-desktop-cli-production-bridge-install');
    const entry = resolve('D:/soft/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js');
    const installed = await runDshCommand(binary, ['--expose-internals', entry, 'plugin', '--profile', 'desktop', 'add', `file:${join(repositoryRoot, 'integrations', 'dsh')}`, '--offline', '--ignore-scripts'],
      { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, cwd: join(profileRoot, 'workspace'), timeout: 120000 });
    await save('official-plugin-install.json', installed);
    assert.equal(installed.timedOut, false); assert.equal(installed.signal, null); assert.equal(installed.code, 0);
  }
  port = await freePort(); if (live) { rendererPort = await freePort(); assert.notEqual(rendererPort, port); }
} catch (failure) { error('prelaunch preparation', failure); await model.close(); await save('prelaunch-failure.json', report); throw failure; }
const application = runDshDesktopProcess(binary, [`--inspect-brk=127.0.0.1:${port}`,
  ...(live ? ['--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${rendererPort}`] : []),
  `--user-data-dir=${join(artifacts, 'electron-user-data')}`], {
  cwd: join(profileRoot, 'workspace'), env, timeoutMs: 180000,
  spawnImpl: (...args) => { child = spawn(...args); return child; },
});
void application.then(() => { mainExited = true; }, (failure) => { mainExited = true; error('main process runner', failure); });
try {
  const target = await pollDsh(async () => {
    const response = await globalThis.fetch(`http://127.0.0.1:${port}/json/list`, { signal: globalThis.AbortSignal.timeout(1000) });
    return (await response.json())[0];
  }, 'owned main debugger', 20000);
  await step('verify-owned-loopback-listener');
  await ownedListener(port);
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
  if (live) await nativeUiTurn(rendererPort);
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
  if (report.nativeSessionIdentity) {
    try {
      const files = await snapshotDshStoredChats(join(env.DSH_HOME, 'sessions'), [marker]);
      assert(Object.keys(files).some((name) => name.includes(`/${report.nativeSessionIdentity.nativeId}/`)));
      report.retainedSessionFiles = files;
      const registrations = await bridgeRegistrations();
      assert.equal(registrations.filter((name) => name.endsWith('.json')).length, 0); report.bridgeRegistrationRemoved = true;
    } catch (failure) { error('native session and bridge teardown evidence', failure); }
  }
  report.assessment = assessDshDesktopNaturalExit(report, { parentPid: child.pid, projectDir: project, binary, sourceSha256: DSH_DESKTOP_MAIN_SHA256 });
  report.c2AdmissibleRecordProduced = false;
  if (report.errors.length) await save('startup-debugger-scripts.json', protocol.filter((entry) => entry.method === 'Debugger.scriptParsed').map((entry) => ({ id: entry.params.scriptId, url: entry.params.url })));
  await save('exit-observation.json', report);
  process.stdout.write(JSON.stringify({ artifacts, assessment: report.assessment, errors: report.errors }) + '\n');
  if (!report.assessment.verified) process.exitCode = 1;
}
