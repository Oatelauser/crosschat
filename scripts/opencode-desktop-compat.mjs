#!/usr/bin/env node
import { replySendArgs } from '../test/helpers/compat-reply.mjs';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { URL } from 'node:url';
import { decodeRef } from '../dist/ref.js';
import { connectDesktopCDP } from '../test/helpers/opencode-desktop-cdp.mjs';
import { createOpenCodeDesktopFixture } from '../test/helpers/opencode-desktop-live-fixture.mjs';
import { acknowledgementForDelivery, assertAcknowledgedDelivery, probeFailure, scriptedAcknowledgement } from '../test/helpers/opencode-desktop-probe-behavior.mjs';
import { crosschatShell, poll, runCommand, userText } from '../test/helpers/opencode-live-fixture.mjs';
import { textStream, toolStream } from '../test/helpers/opencode-mock-model.mjs';

// Installed official app only: ordinary npm test never starts or downloads it.
if (process.env.CROSSCHAT_LIVE !== '1') throw new Error('Set CROSSCHAT_LIVE=1 to run the isolated official OpenCode Desktop probe');
function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith('--')) throw new Error(`${name} requires a path`);
  return resolve(process.argv[index + 1]);
}
const reportPath = argument('--report');
const evidencePath = argument('--evidence') ?? (reportPath ? join(dirname(reportPath), 'desktop-evidence') : undefined);
const report = {
  schema: 1, tool: 'opencode-desktop', platform: process.platform, arch: process.arch,
  version: process.env.OPENCODE_EXPECTED_VERSION ?? null,
  startedAt: new Date().toISOString(), status: 'failed', stage: 'setup', category: 'infrastructure', checks: [],
  scope: {
    runtime: 'unmodified official installed Desktop and its bundled native CLI, default local sidecar only',
    ui: 'official renderer controlled through externally enabled loopback CDP; real Home DOM session selection',
    identity: 'native shell OPENCODE_SESSION_ID and full conversation reference endpoints',
    model: 'scripted local provider; no real API key or model intelligence assertion',
    onboarding: 'official firstLaunchOnboardingComplete setting seeded; first-run onboarding not tested',
    recovery: 'Desktop-only reopen and ordinary service stop/start with the same configuration, database, port and credentials',
    excluded: ['remote/WSL/manual server selection', 'rotated credentials', 'changed service port', 'database corruption', 'cloud login'],
  },
  logs: {}, cleanup: { started: false },
};
const marker = 'crosschat_desktop_fixture_';
const names = Object.fromEntries(['sender', 'receiver', 'busy', 'idle'].map((kind) => [kind, `${marker}${kind}`]));
const sessions = {};
const secrets = new Set();
const busyRequests = [];
let fixture;
let page;
let releaseBusy = () => {};
let holdBusy;
let startBusy;
let busyToolEmitted = false;
let senderToolEmitted = false;
let replyToolEmitted = false;
let bootstrapToolEmitted = false;
let allowBundledService = false;

function shell(command) { return toolStream('shell', { command, timeout: 10000 }); }
function respond(body) {
  const text = userText(body);
  if (text.includes(`${marker}bootstrap`) && !bootstrapToolEmitted) {
    bootstrapToolEmitted = true;
    return shell('echo crosschat-desktop-fixture-bootstrap');
  }
  if (text.includes(`${marker}busy-start`)) {
    busyRequests.push(text);
    if (!busyToolEmitted) {
      busyToolEmitted = true;
      startBusy();
      return holdBusy.then(() => shell('echo crosschat-desktop-fixture-boundary'));
    }
    return textStream(text.includes(`${marker}queued`) ? `${marker}queue-finished` : `${marker}steer-finished`);
  }
  if (text.includes(`${marker}begin-roundtrip`) && !senderToolEmitted) {
    senderToolEmitted = true;
    return shell(crosschatShell(['send', '--tool', 'opencode', '--to', sessions.receiver.id, '--body', `${marker}roundtrip-request`, '--json']));
  }
  if (text.includes(`${marker}roundtrip-request`) && !text.includes(`${marker}roundtrip-reply`) && !replyToolEmitted) {
    const reply = replySendArgs(text, { tool: 'opencode', requestBody: `${marker}roundtrip-request`, body: `${marker}roundtrip-reply` });
    replyToolEmitted = true;
    return shell(crosschatShell(reply));
  }
  return textStream(scriptedAcknowledgement(body, marker));
}

function errorText(error) { return error instanceof Error ? error.message : String(error); }
function rememberCredentials() {
  if (fixture?.info.password) {
    secrets.add(fixture.info.password);
    secrets.add(Buffer.from(`opencode:${fixture.info.password}`).toString('base64'));
  }
}
function redact(value, key = '') {
  if (/^(password|token|authorization|apiKey)$/i.test(key)) return '<redacted>';
  if (typeof value === 'string') {
    let safe = value;
    for (const secret of secrets) safe = safe.replaceAll(secret, '<redacted>');
    return safe.replace(/\bBasic\s+[A-Za-z0-9+/]+=*/gi, 'Basic <redacted>')
      .replace(/("(?:password|token|authorization|apiKey)"\s*:\s*")[^"\r\n]*(")/gi, '$1<redacted>$2');
  }
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]));
  return value;
}
async function check(name, stage, category, action) {
  Object.assign(report, { check: name, stage, category });
  const started = Date.now();
  try {
    const detail = await action();
    report.checks.push({ name, status: 'passed', elapsedMs: Date.now() - started, ...(detail ? { detail } : {}) });
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    Object.assign(report, probeFailure(error, { stage, category, check: name }));
    report.checks.push({ name: report.check, status: 'failed', elapsedMs: Date.now() - started, error: errorText(error) });
    throw error;
  }
}
function sent(result) {
  assert.equal(result.code, 0, `crosschat failed: ${result.stderr}\n${result.stdout}`);
  assert.equal(result.timedOut, false);
  const receipt = JSON.parse(result.stdout.trim());
  assert.ok(['delivered', 'queued'].includes(receipt.status), 'Native delivery must return an accepted crosschat receipt');
  return receipt;
}
async function within(promise, timeoutMs, description) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(description)), timeoutMs); })]); }
  finally { clearTimeout(timer); }
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
function samePath(left, right) { return resolve(left).toLowerCase() === resolve(right).toLowerCase(); }
function ownedChild(parent, child) {
  const part = relative(parent, child);
  return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}
function websocketOwned(address) {
  const url = new URL(address);
  assert.equal(url.protocol, 'ws:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(Number(url.port), fixture.cdpPort);
  assert.equal(url.username + url.password, '');
}
async function ownership() {
  const appPid = fixture.pid;
  const nativePid = fixture.info.pid;
  const servicePort = Number(new URL(fixture.info.url).port);
  for (const number of [appPid, nativePid, fixture.cdpPort, servicePort]) assert.ok(Number.isSafeInteger(number) && number > 0);
  // Interpolate verified integers only. Do not collect command lines, env or registration secrets.
  const command = `$ErrorActionPreference='Stop'; $app=Get-CimInstance Win32_Process -Filter 'ProcessId = ${appPid}'; $native=Get-CimInstance Win32_Process -Filter 'ProcessId = ${nativePid}'; $cdp=@(Get-NetTCPConnection -LocalPort ${fixture.cdpPort} -State Listen | Select-Object LocalAddress,OwningProcess); $service=@(Get-NetTCPConnection -LocalPort ${servicePort} -State Listen | Select-Object LocalAddress,OwningProcess); [ordered]@{app=$app|Select-Object ProcessId,ParentProcessId,ExecutablePath;native=$native|Select-Object ProcessId,ParentProcessId,ExecutablePath;cdp=$cdp;service=$service}|ConvertTo-Json -Depth 5`;
  const result = await runCommand('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { env: fixture.env, cwd: fixture.workspace });
  assert.equal(result.code, 0, `Owned process inspection failed: ${result.stderr}`);
  const proof = JSON.parse(result.stdout);
  assert.equal(proof.app.ProcessId, appPid);
  assert.equal(proof.native.ProcessId, nativePid);
  assert.ok(samePath(proof.app.ExecutablePath, fixture.binary), 'App PID must run the owned official executable');
  const staged = join(fixture.env.OPENCODE_DESKTOP_TEST_ROOT, 'desktop', 'cli', `${report.version}-${process.arch}`, 'opencode-cli.exe');
  assert.ok(samePath(proof.native.ExecutablePath, staged)
    || (allowBundledService && samePath(proof.native.ExecutablePath, fixture.nativeBinary)), 'Service must run an exact owned official CLI path');
  // A shared service may survive its original GUI parent; after service start, that parent is the owned start command.
  for (const [ports, owner] of [[proof.cdp, appPid], [proof.service, nativePid]]) {
    assert.ok(Array.isArray(ports) && ports.length > 0);
    assert.ok(ports.every((port) => port.OwningProcess === owner && port.LocalAddress === '127.0.0.1'), 'All inspected listeners must belong to the exact owned PID on IPv4 loopback');
  }
  const [bundledSHA256, serviceSHA256] = await Promise.all([digest(fixture.nativeBinary), digest(proof.native.ExecutablePath)]);
  assert.equal(serviceSHA256, bundledSHA256, 'Service CLI must be unchanged from the installed release');
  const health = await fixture.api('/api/info');
  assert.equal(health.pid, nativePid);
  assert.equal(health.version, report.version);
  return { ...proof, bundledSHA256, serviceSHA256 };
}
async function attachPage() {
  await fixture.refreshCDP();
  assert.equal(fixture.cdp.ready, true, 'Official app must expose its externally requested CDP endpoint');
  const target = fixture.cdp.targets.find((item) => item.type === 'page' && item.url === 'oc://renderer/index.html');
  assert.ok(target, 'Official renderer page must exist');
  websocketOwned(target.webSocketDebuggerUrl);
  page = await connectDesktopCDP(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  assert.equal(await page.evaluate('location.href'), 'oc://renderer/index.html');
}
async function uiState() {
  return page.evaluate(`({url:location.href,title:document.title,text:document.body.innerText.slice(0,64000),routes:Object.fromEntries(Object.keys(localStorage).filter(key=>/^opencode\\.desktop\\.window\\..*\\.last-active-url$/.test(key)).map(key=>[key,localStorage.getItem(key)]))})`);
}
async function visible(markers, description) {
  await poll(async () => {
    const state = await uiState();
    return markers.every((text) => state.text.includes(text));
  }, description, 25000);
}
async function selectSession(id) {
  // Use the official Home button and its actual row click handlers; never alter router/store internals.
  const clickedHome = await page.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(item=>['主页','Home'].includes(item.getAttribute('aria-label')));if(!button)return false;button.click();return true})()`);
  await poll(async () => page.evaluate(`!!document.querySelector('[data-component="home-session-row-container"][data-session-id='+CSS.escape(${JSON.stringify(id)})+'] [data-component="home-session-row"]')`), `existing session ${id} in native Home${clickedHome ? '' : ' initial view'}`, 20000);
  await page.evaluate(`(()=>{const row=document.querySelector('[data-component="home-session-row-container"][data-session-id='+CSS.escape(${JSON.stringify(id)})+'] [data-component="home-session-row"]');row.scrollIntoView({block:'center'});row.click()})()`);
  await poll(async () => Object.values((await uiState()).routes).some((route) => route?.includes(`/session/${id}`)), 'native selected session route', 15000);
}
async function evidence(name, markers = []) {
  if (markers.length) await visible(markers, `desktop visible ${name}`);
  const state = await uiState();
  if (!evidencePath) return { markers, state };
  const screenshot = join(evidencePath, `${name}.png`);
  const dom = join(evidencePath, `${name}.json`);
  await page.screenshot(screenshot);
  await writeFile(dom, JSON.stringify(redact(state), null, 2) + '\n');
  return { screenshot, dom, markers };
}
function completedTools(transcript) {
  return transcript.filter((message) => message.type === 'assistant').flatMap((message) => message.content ?? [])
    .filter((part) => part.type === 'tool' && part.state?.status === 'completed');
}
function completedShellRefs(transcript) {
  return completedTools(transcript).flatMap((part) => [...JSON.stringify(part.state).matchAll(/\bmc[12]_[A-Za-z0-9_-]+/g)].map(([value]) => {
    try { return decodeRef(value); } catch { return null; }
  })).filter(Boolean);
}
async function sendExact(kind, body, extra = []) {
  const receipt = sent(await fixture.cli(['send', '--tool', 'opencode', '--to', sessions[kind].id, '--body', body, ...extra, '--json']));
  assert.ok(receipt.to.includes(sessions[kind].id), 'Receipt must preserve the full native target ID');
  return receipt;
}
async function acknowledgedDelivery(kind, bodyMarker, evidenceName) {
  const acknowledgement = acknowledgementForDelivery(bodyMarker, marker);
  await poll(async () => {
    const transcript = await fixture.transcript(sessions[kind].id);
    const uiText = (await uiState()).text;
    try { assertAcknowledgedDelivery({ transcript, uiText, bodyMarker, prefix: marker }); return true; }
    catch { return false; }
  }, `current assistant acknowledgement and Desktop display for ${bodyMarker}`, 25000);
  return { ...(await evidence(evidenceName, [bodyMarker, acknowledgement])), acknowledgement };
}
async function gracefulClose(owned) {
  if (!owned.cdp.browserWebSocketUrl) throw new Error('No owned browser endpoint is available for normal Desktop shutdown');
  // Ownership is checked before each run phase; this URL is obtained from that app's port by the fixture.
  const browser = await connectDesktopCDP(owned.cdp.browserWebSocketUrl);
  try { await browser.send('Browser.close').catch((error) => { if (error.code !== 'CDP_CLOSED') throw error; }); }
  finally { await browser.close(); }
}

try {
  for (const name of ['OPENCODE_DESKTOP_BIN', 'OPENCODE_DESKTOP_TASK_ROOT']) assert.ok(process.env[name] && isAbsolute(process.env[name]), `${name} must name an absolute owned path`);
  assert.match(process.env.OPENCODE_EXPECTED_VERSION ?? '', /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/, 'A pinned OPENCODE_EXPECTED_VERSION is required');
  if (evidencePath) await mkdir(evidencePath, { recursive: true });
  await check('official-desktop-startup', 'setup', 'infrastructure', async () => {
    fixture = await createOpenCodeDesktopFixture(process.env.OPENCODE_DESKTOP_BIN, respond, { parentRoot: process.env.OPENCODE_DESKTOP_TASK_ROOT, closeDesktop: gracefulClose });
    rememberCredentials();
    assert.ok(!evidencePath || !ownedChild(fixture.root, evidencePath), 'Evidence must survive owned run cleanup');
    assert.ok(!reportPath || !ownedChild(fixture.root, reportPath), 'Report must survive owned run cleanup');
    report.cleanup = { started: true, ownedRoot: fixture.root };
    report.version = fixture.info.version;
    assert.equal(report.version, process.env.OPENCODE_EXPECTED_VERSION, 'Official bundled service must match the pinned release');
    return { appPid: fixture.pid, servicePid: fixture.info.pid, onboarding: fixture.onboarding };
  });
  await check('owned-app-service-and-cdp', 'setup', 'infrastructure', async () => {
    const proof = await ownership();
    await attachPage();
    return proof;
  });
  await check('native-session-create-and-real-home-selection', 'ui-contract', 'compatibility', async () => {
    for (const [kind, title] of Object.entries(names)) sessions[kind] = await fixture.createSession(title);
    assert.equal(new Set(Object.values(sessions).map((item) => item.id)).size, 4);
    for (const session of Object.values(sessions)) await selectSession(session.id);
    return Object.fromEntries(Object.entries(sessions).map(([kind, session]) => [kind, session.id]));
  });
  await check('scripted-provider-and-native-shell-bootstrap', 'model-fixture', 'infrastructure', async () => {
    await fixture.prompt(sessions.idle.id, `${marker}bootstrap`);
    await fixture.idle(sessions.idle.id);
    const transcript = await fixture.transcript(sessions.idle.id);
    assert.ok(completedTools(transcript).length > 0, 'Real bundled native shell must execute the bootstrap tool');
    assert.ok(transcript.some((message) => message.type === 'assistant' && message.content?.some((part) => part.type === 'text'
      && part.text === acknowledgementForDelivery(`${marker}bootstrap`, marker))), 'Bootstrap must finish with its own scripted model acknowledgement');
  });
  await check('authenticated-service-discovery-and-pagination', 'contract', 'compatibility', async () => {
    const unauthorized = await globalThis.fetch(new URL('/api/info', fixture.info.url), { signal: globalThis.AbortSignal.timeout(5000), redirect: 'manual' });
    assert.equal(unauthorized.status, 401);
    let cursor; let complete = false; let pages = 0;
    const items = [];
    for (; pages < 20; pages++) {
      const result = await fixture.cli(['discover'], JSON.stringify({ op: 'list', filter: { providerIds: ['opencode'] }, limit: 2, ...(cursor ? { cursor } : {}) }));
      assert.equal(result.code, 0, result.stderr);
      const resultPage = JSON.parse(result.stdout).page;
      assert.deepEqual(resultPage.errors, []);
      items.push(...resultPage.items);
      if (resultPage.nextCursor === null) { assert.equal(resultPage.completeness, 'complete'); complete = true; pages++; break; }
      assert.equal(resultPage.completeness, 'partial'); cursor = resultPage.nextCursor;
    }
    assert.ok(complete && pages >= 2, 'Default composition must finish actual paged OpenCode discovery');
    for (const session of Object.values(sessions)) assert.ok(items.some((item) => item.ref.providerId === 'opencode' && item.ref.nativeId === session.id && item.name === session.title));
    return { pages, nativeIds: items.map((item) => item.ref.nativeId) };
  });
  await check('idle-delivery-and-visible-model-ack', 'ui-contract', 'compatibility', async () => {
    const receipt = await sendExact('idle', `${marker}idle-message`);
    await fixture.idle(sessions.idle.id);
    assert.ok(fixture.model.requests.some((body) => userText(body).includes(`${marker}idle-message`)));
    return { receipt, evidence: await acknowledgedDelivery('idle', `${marker}idle-message`, 'idle-incoming') };
  });
  await check('native-shell-identity-and-conversation-reply', 'ui-contract', 'compatibility', async () => {
    // No sender identity is injected. The bundled OpenCode shell provides its actual session ID.
    await fixture.prompt(sessions.sender.id, `${marker}begin-roundtrip`);
    await poll(async () => JSON.stringify(await fixture.transcript(sessions.sender.id)).includes(`${marker}roundtrip-reply`), 'native shell conversation round trip', 60000);
    await Promise.all([fixture.idle(sessions.sender.id), fixture.idle(sessions.receiver.id)]);
    const sender = await fixture.transcript(sessions.sender.id);
    const receiver = await fixture.transcript(sessions.receiver.id);
    const matchesEndpoints = (ref) => ref.f.p === 'opencode' && ref.f.id === sessions.sender.id && ref.t.p === 'opencode' && ref.t.id === sessions.receiver.id;
    const sentRef = completedShellRefs(sender).find((ref) => matchesEndpoints(ref) && ref.c === 1);
    assert.ok(sentRef, 'Completed real sender shell must return a ref containing both complete native session IDs');
    const replyRef = completedShellRefs(receiver).find((ref) => matchesEndpoints(ref) && ref.c === 2 && ref.n === sentRef.n);
    assert.ok(replyRef, 'Completed receiver shell must reply in the same native conversation');
    assert.ok(senderToolEmitted && replyToolEmitted);
    assert.ok(JSON.stringify(receiver).includes(`${marker}roundtrip-request`));
    await selectSession(sessions.receiver.id);
    const incoming = await evidence('native-shell-receiver', [`${marker}roundtrip-request`]);
    await selectSession(sessions.sender.id);
    const reply = await evidence('native-shell-sender-reply', [`${marker}roundtrip-reply`]);
    return { sentRef, replyRef, incoming, reply };
  });
  await check('native-queue-and-steer-step-boundaries', 'ui-contract', 'compatibility', async () => {
    await selectSession(sessions.busy.id);
    holdBusy = new Promise((done) => { releaseBusy = done; });
    const busyStarted = new Promise((done) => { startBusy = done; });
    await fixture.prompt(sessions.busy.id, `${marker}busy-start`);
    await within(busyStarted, 30000, 'Busy native model request did not start');
    const seed = await evidence('busy-seed', [`${marker}busy-start`]);
    const queued = await sendExact('busy', `${marker}queued`, ['--delivery', 'queue']);
    assert.equal(queued.queued, true);
    const steered = await sendExact('busy', `${marker}steered`, ['--delivery', 'steer']);
    const inbox = await fixture.api(`/api/session/${encodeURIComponent(sessions.busy.id)}/inbox`);
    assert.ok(inbox.data.some((item) => JSON.stringify(item).includes(`${marker}queued`) && item.delivery === 'queue'));
    assert.ok(inbox.data.some((item) => JSON.stringify(item).includes(`${marker}steered`) && item.delivery === 'steer'));
    releaseBusy();
    await fixture.idle(sessions.busy.id);
    assert.ok(busyRequests.length >= 3, 'Seed tool step, steered continuation and next queued turn must reach the real model client');
    assert.ok(busyRequests[1].includes(`${marker}steered`), 'Steer must reach the immediate next native tool step');
    assert.ok(!busyRequests[1].includes(`${marker}queued`), 'Queue must remain outside the currently executing turn');
    assert.ok(busyRequests.slice(2).some((text) => text.includes(`${marker}queued`)), 'Queue must execute after the active turn');
    assert.equal((await fixture.api(`/api/session/${encodeURIComponent(sessions.busy.id)}/inbox`)).data.length, 0);
    return { queued, steered, seed, final: await evidence('busy-queue-steer', [`${marker}busy-start`, `${marker}queued`, `${marker}steered`]), modelSteps: busyRequests.length };
  });
  await check('service-restart-reconnects-visible-existing-session', 'ui-contract', 'compatibility', async () => {
    await selectSession(sessions.idle.id);
    const previous = { appPid: fixture.pid, servicePid: fixture.info.pid, serviceId: fixture.info.id, url: fixture.info.url };
    const password = fixture.info.password; // Only a boolean comparison enters the report.
    const beforeRoute = (await uiState()).routes;
    const stop = await runCommand(fixture.nativeBinary, ['service', 'stop'], { env: fixture.env, cwd: fixture.workspace, timeout: 10000 });
    assert.equal(stop.code, 0, `Owned service stop failed: ${stop.stderr}`);
    await poll(() => !alive(previous.servicePid), 'old owned native service shutdown', 10000);
    // The Desktop SSE client may already have ensured it; official start is concurrency-safe.
    allowBundledService = true;
    const start = await runCommand(fixture.nativeBinary, ['service', 'start'], { env: fixture.env, cwd: fixture.workspace, timeout: 10000 });
    assert.equal(start.code, 0, `Owned service start failed: ${start.stderr}`);
    await fixture.refreshService(); rememberCredentials();
    assert.equal(fixture.pid, previous.appPid);
    assert.notEqual(fixture.info.pid, previous.servicePid);
    assert.ok(typeof previous.serviceId === 'string' && typeof fixture.info.id === 'string');
    assert.notEqual(fixture.info.id, previous.serviceId);
    assert.equal(fixture.info.url, previous.url);
    assert.equal(fixture.info.password, password);
    const proof = await ownership();
    const receipt = await sendExact('idle', `${marker}after-service-restart`);
    await fixture.idle(sessions.idle.id);
    // Keep this page, route and GUI intact: receipt must appear through native SSE recovery.
    const shown = await acknowledgedDelivery('idle', `${marker}after-service-restart`, 'service-reconnected');
    assert.deepEqual((await uiState()).routes, beforeRoute);
    return { previous, appPid: fixture.pid, servicePid: fixture.info.pid, serviceId: fixture.info.id, samePassword: true, receipt, proof, evidence: shown };
  });
  await check('desktop-reopen-preserves-service-and-selected-session', 'ui-contract', 'compatibility', async () => {
    const beforeRoute = (await uiState()).routes;
    const originalId = sessions.idle.id;
    await page.close(); page = undefined;
    const restart = await fixture.restartDesktop(); rememberCredentials();
    assert.notEqual(restart.appPid, restart.previousAppPid);
    assert.equal(restart.forcedAppStop, false, 'Desktop must close normally before reopening');
    assert.equal(restart.cdpReady, true);
    const proof = await ownership();
    await attachPage();
    await poll(async () => Object.values((await uiState()).routes).some((route) => route?.includes(`/session/${originalId}`)), 'native restored session route after Desktop reopen', 25000);
    const restored = await uiState();
    assert.ok(Object.values(beforeRoute).some((route) => Object.values(restored.routes).includes(route) && route?.includes(`/session/${originalId}`)), 'Original native route must reopen without test navigation');
    const receipt = await sendExact('idle', `${marker}after-desktop-reopen`);
    await fixture.idle(originalId);
    assert.ok(JSON.stringify(await fixture.transcript(originalId)).includes(`${marker}after-desktop-reopen`));
    return { restart, originalId, receipt, proof, evidence: await acknowledgedDelivery('idle', `${marker}after-desktop-reopen`, 'desktop-reopened') };
  });
  await check('missing-target-does-not-create-session', 'contract', 'compatibility', async () => {
    const result = await fixture.cli(['send', '--tool', 'opencode', '--to', 'crosschat-desktop-fixture-does-not-exist', '--body', 'must not create a replacement native session', '--json']);
    assert.notEqual(result.code, 0);
    assert.equal(result.timedOut, false);
    const listed = await fixture.api('/api/session');
    assert.equal(listed.data.length, 4);
    assert.deepEqual(new Set(listed.data.map((item) => item.id)), new Set(Object.values(sessions).map((item) => item.id)));
  });
  assert.deepEqual(fixture.model.errors, []);
  report.status = 'passed'; report.stage = 'done'; delete report.category; delete report.check;
} catch (error) {
  report.error = errorText(error);
  report.failure = { stage: report.stage, category: report.category, check: report.check, error: report.error };
  if (error?.evidence) { report.logs.startup = error.evidence.logs; report.cleanup = error.evidence.cleanup ?? report.cleanup; }
  process.exitCode = 1;
} finally {
  releaseBusy();
  if (fixture) {
    rememberCredentials();
    report.logs.modelRequests = fixture.model.requests.map((body) => ({ model: body.model, userText: userText(body).slice(0,64000) }));
    if (report.status !== 'passed' && page) {
      try { report.failureEvidence = await evidence('failure'); }
      catch (error) { report.logs.failureEvidenceError = errorText(error); }
    }
    const cleanupErrors = [];
    if (page) { try { await page.close(); } catch (error) { cleanupErrors.push(`CDP page close: ${errorText(error)}`); } }
    try {
      report.cleanup = { ownedRoot: fixture.root, ...(await fixture.close()) };
      assert.equal(report.cleanup.appStopped, true);
      assert.equal(report.cleanup.serviceStopped, true);
      assert.equal(report.cleanup.removed, true);
      assert.equal(report.cleanup.forcedAppStop, false, 'Desktop must close normally at the end of the probe');
    } catch (error) {
      report.cleanup = { ownedRoot: fixture.root, ...fixture.cleanup };
      cleanupErrors.push(errorText(error));
    }
    report.logs.desktop = fixture.logs;
    if (cleanupErrors.length) {
      report.status = 'failed'; report.stage = 'cleanup'; report.category = 'infrastructure'; report.check = 'owned-runtime-cleanup';
      report.cleanup.errors = [...(report.cleanup.errors ?? []), ...cleanupErrors];
      process.exitCode = 1;
    }
  }
  report.finishedAt = new Date().toISOString();
  const serialized = JSON.stringify(redact(report), null, 2) + '\n';
  if (reportPath) { await mkdir(dirname(reportPath), { recursive: true }); await writeFile(reportPath, serialized); }
  process.stdout.write(serialized);
}
