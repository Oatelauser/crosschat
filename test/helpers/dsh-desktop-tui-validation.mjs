import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';
import { WebSocket } from 'ws';
import { prepareDshProfile, pollDsh, runDshCommand, dshIdentityBootstrapCommand } from './dsh-live-fixture.mjs';
import { runDshDesktopProcess } from '../../scripts/dsh-compat-ci.mjs';
import { createDshMockModel } from './dsh-mock-model.mjs';
import { inspectDshBridges, listDshThreads } from '../../dist/dsh/client.js';
import { launchPty } from './tui-pty-driver.mjs';
import { createDshOwnedNode } from './dsh-owned-node.mjs';

const binary = 'D:/soft/DeepSeek Harness/DeepSeek Harness.exe';
const appPackage = 'D:/soft/DeepSeek Harness/resources/app.asar/package.json';

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert(address && typeof address !== 'string');
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function connect(url) {
  const socket = new WebSocket(url); const pending = new Map(); let nextId = 0;
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.on('message', (raw) => {
    const message = JSON.parse(String(raw)); const request = pending.get(message.id); if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  const fail = () => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Owned inspector connection closed')); } pending.clear(); };
  socket.on('error', fail); socket.on('close', fail);
  return {
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Inspector deadline: ${method}`)); }, 10000);
        pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
      });
    },
    async evaluate(expression) {
      const result = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
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
}

async function bootstrap() {
  assert.equal(process.env.CROSSCHAT_LIVE, '1');
  const root = await realpath(process.env.DSH_DESKTOP_TUI_ROOT);
  const owner = JSON.parse(await readFile(join(root, 'ownership.json'), 'utf8'));
  assert.equal(owner.task, 'c09-dsh-tui'); assert.equal(owner.root, root);
  const artifacts = await mkdtemp(join(root, 'round-'));
  const marker = `C09_DESKTOP_NATIVE_IDENTITY_${randomUUID().slice(0, 8)}`;
  let identityRequested = false;
  const model = await createDshMockModel((body) => {
    if (!identityRequested && body.tools?.some((tool) => tool.name === 'pwsh') && JSON.stringify(body.messages).includes(marker)) {
      identityRequested = true; return { tool: { id: marker, name: 'pwsh', input: { command: dshIdentityBootstrapCommand(), description: 'Read native Desktop caller identity' } } };
    }
    return { text: `${marker}_ACK` };
  });
  const env = await prepareDshProfile(join(root, 'native'), model.url);
  const mainPort = await freePort(), rendererPort = await freePort();
  let main, renderer, child, processResult, hostMonitor, pty, node, failure;
  const cleanupFailures = [];
  const accepted = { scope: 'Formal user-retained Windows Desktop + production bridge/reader + real ConPTY; no install/uninstall acceptance', checks: [] };
  const monitorScript = join(artifacts, 'observe-owned-host.ps1');
  await writeFile(monitorScript, `param([int]$TargetPid,[string]$ReadyFile)\n$ErrorActionPreference='Stop'\n$observedProcess=[Diagnostics.Process]::GetProcessById($TargetPid)\n$null=$observedProcess.Handle\n@{pid=$observedProcess.Id;created=$observedProcess.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress | Set-Content -LiteralPath $ReadyFile\nif (-not $observedProcess.WaitForExit(180000)) { throw 'Owned Host did not exit within observation budget' }\n@{pid=$observedProcess.Id;exitCode=$observedProcess.ExitCode} | ConvertTo-Json -Compress\n$observedProcess.Dispose()\n`);
  await writeFile(join(env.DSH_HOME, 'profiles', 'desktop', 'cordis.patch.yml'), JSON.stringify([
    { id: 'crosschat-dsh-bridge', config: { home: env.HOME } },
    { id: 'workspace-controller', config: { documentsDirectory: join(env.HOME, 'Documents') } },
  ]));
  const electron = `process.getBuiltinModule('node:module').createRequire(${JSON.stringify(appPackage)})('electron')`;
  const appRun = runDshDesktopProcess(binary, [`--inspect=127.0.0.1:${mainPort}`, '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${rendererPort}`, `--user-data-dir=${join(root, 'native', 'electron-user-data')}`], {
    cwd: join(root, 'native', 'workspace'), env, timeoutMs: 120000,
    spawnImpl: (...args) => { child = spawn(...args); return child; },
  });
  try {
    const target = await pollDsh(async () => { const response = await globalThis.fetch(`http://127.0.0.1:${mainPort}/json/list`, { signal: globalThis.AbortSignal.timeout(1000) }); return (await response.json())[0]; }, 'owned Desktop inspector', 20000);
    main = await connect(target.webSocketDebuggerUrl);
    const facts = await main.evaluate(`({pid:process.pid,userData:${electron}.app.getPath('userData'),dshHome:process.env.DSH_HOME})`);
    assert.equal(facts.pid, child.pid); assert.equal(facts.userData, join(root, 'native', 'electron-user-data'));
    assert.equal(facts.dshHome, env.DSH_HOME);
    const bridges = await pollDsh(async () => { try { return await inspectDshBridges({ home: env.HOME }); } catch (error) { if (error.code !== 'DSH_NOT_CONFIGURED') throw error; } }, 'formal Desktop bridge', 30000);
    assert.equal(bridges.length, 1); assert.equal(bridges[0].endpointType, 'desktop');
    const hostReady = join(artifacts, 'host-handle-ready.json');
    hostMonitor = runDshCommand('pwsh', ['-NoProfile', '-NonInteractive', '-File', monitorScript, '-TargetPid', String(bridges[0].pid), '-ReadyFile', hostReady], { env, timeout: 190000 });
    await pollDsh(async () => { try { return await readFile(hostReady, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }, 'held native Host handle', 10000);
    const uiTarget = await pollDsh(async () => {
      const response = await globalThis.fetch(`http://127.0.0.1:${rendererPort}/json/list`, { signal: globalThis.AbortSignal.timeout(1000) });
      return (await response.json()).find((entry) => entry.type === 'page' && entry.url === 'dsh-app://app/');
    }, 'formal Desktop page', 10000);
    renderer = await connect(uiTarget.webSocketDebuggerUrl);
    const ui = await pollDsh(() => renderer.evaluate(`document.querySelector('[contenteditable="true"]') ? ({text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(b=>({text:b.innerText,label:b.getAttribute('aria-label')})),inputs:[...document.querySelectorAll('textarea,input,[contenteditable="true"]')].map(b=>({tag:b.tagName,placeholder:b.getAttribute('placeholder'),role:b.getAttribute('role')}))}) : null`), 'interactive Desktop composer', 20000);
    await writeFile(join(artifacts, 'desktop-ui-inspection.json'), JSON.stringify(ui, null, 2));
    await writeFile(join(artifacts, 'bridge-info.json'), JSON.stringify(bridges, null, 2));
    const workspaces = JSON.parse(await readFile(join(env.DSH_HOME, 'storages', 'workspace.json'), 'utf8'));
    for (const entry of Object.values(workspaces.tables.workspaces)) {
      const inside = relative(root, entry.path); assert(inside && !inside.startsWith('..') && !isAbsolute(inside));
    }
    await renderer.evaluate(`document.querySelector('[contenteditable="true"]').focus();true`);
    await renderer.call('Input.insertText', { text: marker });
    await renderer.evaluate(`document.querySelector('button[aria-label="发送消息"]').click();true`);
    await pollDsh(() => renderer.evaluate(`document.body.innerText.includes(${JSON.stringify(`${marker}_ACK`)})`), 'actual native UI identity answer', 30000);
    process.stdout.write('Actual Desktop UI answered; verifying native tool result.\n');
    const strings = (value) => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
    const toolResults = model.requests.flatMap((request) => request.messages.flatMap((message) => Array.isArray(message.content) ? message.content.filter((part) => part.type === 'tool_result' && part.tool_use_id === marker) : []));
    const identities = toolResults.flatMap(strings).flatMap((value) => { try { return [JSON.parse(value.trim())]; } catch { return []; } });
    const identity = identities.find((value) => value.profile === 'desktop' && value.dshHome === env.DSH_HOME && value.callerSource?.sourceTool === 'dsh-desktop');
    assert(identity); assert.equal(identity.callerSourceExit, 0);
    assert.equal(identity.callerSource.status, 'identified'); assert.equal(identity.callerSource.basis, 'native'); assert.equal(identity.callerSource.association, 'verified');
    const native = await pollDsh(async () => (await listDshThreads({ home: env.HOME })).find((thread) => thread.id === identity.session && thread.rawStatus.type === 'idle'), 'exact native session idle after identity tool', 10000);
    assert(native); assert.equal(native.endpointType, 'desktop');
    accepted.identity = { nativeId: native.id, source: identity.callerSource, name: native.name, endpointType: native.endpointType };
    accepted.checks.push('actual-Desktop-UI-native-shell-and-typed-source');
    await writeFile(join(artifacts, 'native-identity.json'), JSON.stringify(accepted.identity, null, 2));
    node = await createDshOwnedNode({ root, home: env.HOME, env, nativeId: native.id, endpointType: 'desktop' });
    const input = join(artifacts, 'tui-input.json'), eventsPath = join(artifacts, 'tui-application.jsonl');
    await writeFile(input, JSON.stringify({ home: env.HOME, dshHome: env.DSH_HOME }));
    const events = async () => { try { return (await readFile(eventsPath, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } };
    const event = (predicate, after = 0) => pollDsh(async () => (await events()).slice(after).find(predicate), 'Desktop terminal evidence', 10000);
    pty = await launchPty({ executable: process.execPath, args: [fileURLToPath(new globalThis.URL('./dsh-tui-pty-validation.mjs', import.meta.url)), '--fixture', root, input, eventsPath],
      env, columns: 140, rows: 36, logPath: join(artifacts, 'tui-terminal.jsonl') });
    const send = async (keys, expected) => { const mark = pty.output.length; pty.write(keys); if (expected) await pty.waitForOutput(expected, 10000, mark); };
    const copy = async (key = 'y') => { const after = (await events()).length; await send(key, '已复制完整值'); return (await event((entry) => entry.event === 'clipboard', after)).value; };
    await pty.waitForOutput('C09-HARNESS-NATIVE'); await send('\r\r', '个可发现会话');
    await send(`/${native.id}\r`, /1\/1/);
    assert.equal(await copy(), `crosschat send --to ${native.id} --tool dsh-desktop --body "<正文>"`);
    assert.equal(JSON.parse(await copy('Y')).endpointType, 'desktop');
    await send('d', '只读详情'); await send('\x1b', ':sessions'); await send('g', 'DeepSeek Harness 原生操作'); await send('\x1b', ':sessions');
    await send('t', 'Enter应用'); await send('\x1b[F\r', 'dsh-desktop'); await send('r', '个可发现会话');
    assert.equal(JSON.parse(await copy('Y')).nativeId, native.id);
    accepted.checks.push('Desktop-native-list-filter-full-typed-copy-guide-and-refresh');
    await send(':maintenance\r', '安装 / 更新技能'); await send('/install-skills\r', /1\/1/);
    await send('\r', '确认提交'); await send('\t\r', '成功 3 项');
    await event((entry) => entry.event === 'maintenance' && entry.result.status === 'complete');
    await send(':doctor\r', 'Harness 桥版本与身份');
    const doctor = (await event((entry) => entry.event === 'doctor')).page;
    assert(doctor.rows.some((row) => row.searchText.includes('harness-bridge-ready')));
    assert(doctor.rows.some((row) => row.searchText.includes('harness-profile-plugin-ready')));
    assert(doctor.rows.some((row) => row.searchText.includes('skill-match') && row.searchText.includes('harness')));
    accepted.checks.push('Desktop-profile-real-skill-maintenance-and-live-static-doctor');
    await send('/Harness\r'); await send('d', '只读详情'); let mark = pty.output.length;
    pty.resize(48, 16); await pty.waitForOutput('CC · 工作区', 10000, mark);
    mark = pty.output.length; pty.resize(140, 36); await pty.waitForOutput('CC · 工作区', 10000, mark);
    await send('\x1b', ':doctor'); await send(':stars\r', 'C09-OWNED-STAR'); await send('\r', '<members>');
    const members = (await event((entry) => entry.event === 'members')).page;
    assert.equal(members.completeness, 'complete'); assert.equal(members.rows.length, 1);
    const command = `crosschat send --via tcp:${node.starId}:${node.machineId}:${native.id} --tool dsh-desktop --body "<正文>"`;
    assert.equal(members.rows[0].copyValue, command); assert.equal(await copy(), command);
    await send('d', '只读详情'); await send('\x1b', ':members');
    accepted.checks.push('formal-Desktop-native-member-in-real-owned-broker-node-and-typed-copy');
    await send('q'); assert.deepEqual(await pty.exited, { code: 0, hostCode: 0 });
    const exit = (await events()).find((entry) => entry.event === 'exit'); assert.deepEqual(exit.after, exit.before);
    for (const mode of ['1049', '2004']) assert(pty.output.lastIndexOf(`\x1b[?${mode}l`) > pty.output.lastIndexOf(`\x1b[?${mode}h`));
    accepted.checks.push('terminal-resize-exit-restoration');
    await writeFile(join(artifacts, 'bootstrap-paths.json'), JSON.stringify(facts, null, 2));
    process.stdout.write('Desktop profile initialized; requesting normal Quit.\n');
  } catch (error) {
    failure = error; accepted.failure = { message: error.message, stack: error.stack };
  } finally {
    const release = async (label, operation) => { try { return await operation(); } catch (error) { cleanupFailures.push({ label, message: error.message }); } };
    await release('model evidence', () => writeFile(join(artifacts, 'model-observations.json'), JSON.stringify(model.requests.map((request) => ({ model: request.model,
      tools: request.tools?.map((tool) => tool.name), messages: request.messages.map((message) => ({ role: message.role,
        content: Array.isArray(message.content) ? message.content.map((part) => part.type === 'tool_result' ? part : { type: part.type, text: part.text?.slice(0,500), name: part.name }) : String(message.content).slice(0,500) })) })), null, 2)));
    await release('terminal', () => pty?.dispose());
    await release('owned node', () => node?.close());
    await release('renderer debugger', () => renderer?.close());
    if (main) {
      await release('normal app Quit request', () => main.evaluate(`setTimeout(()=>${electron}.app.quit(),100);true`));
      await release('main debugger', () => main.close());
    }
    processResult = await appRun;
    await release('model server', () => model.close());
    let hostExitedZero = false;
    if (hostMonitor) {
      const observed = await hostMonitor;
      await release('Host evidence', () => writeFile(join(artifacts, 'host-exit-observation.json'), JSON.stringify(observed, null, 2)));
      await release('held Host exit', () => { assert.equal(observed.code, 0); assert.equal(JSON.parse(observed.stdout).exitCode, 0); hostExitedZero = true; });
    }
    await release('normal main exit', () => { assert.equal(processResult.code, 0); assert.equal(processResult.failed, false); });
    accepted.cleanup = { mainExitedZero: processResult.code === 0 && !processResult.failed, hostExitedZero,
      hostNaturalExit: 'not-proven', failures: cleanupFailures };
    accepted.status = failure || cleanupFailures.length ? 'failed' : 'passed';
    await writeFile(join(artifacts, 'bootstrap-process.json'), JSON.stringify(processResult, null, 2));
    await writeFile(join(artifacts, 'desktop-tui-summary.json'), JSON.stringify(accepted, null, 2));
  }
  if (failure) throw failure;
  assert.equal(cleanupFailures.length, 0, JSON.stringify(cleanupFailures));
  process.stdout.write(`${JSON.stringify({ root, artifacts, validation: 'passed', mainPid: processResult.pid, mainExited: true, hostNaturalExit: 'not-proven' })}\n`);
}

await bootstrap();
