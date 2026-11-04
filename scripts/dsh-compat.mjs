#!/usr/bin/env node
import { replySendArgs } from '../test/helpers/compat-reply.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { URL } from 'node:url';
import { decodeRef } from '../dist/ref.js';
import { assessDshCallerSourceIdentity, assessDshNativeIdentity, createDshFixture, diagnoseDshCallerSource, dshIdentityBootstrapCommand, dshNodeCommand, dshShellCommand, pollDsh } from '../test/helpers/dsh-live-fixture.mjs';

if (process.env.CROSSCHAT_LIVE !== '1') throw new Error('CROSSCHAT_LIVE=1 is required for the isolated official Harness probe');
const reportIndex = process.argv.indexOf('--report');
if (reportIndex < 0 || !process.argv[reportIndex + 1]) throw new Error('--report <path> is required');
const reportPath = resolve(process.argv[reportIndex + 1]);
const runId = process.env.DSH_EXPECTED_RUN_ID ?? randomUUID();
if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(runId)) throw new Error('DSH_EXPECTED_RUN_ID must be a UUID v4');
const report = { schema: 1, tool: 'dsh-web-runtime', platform: process.platform, arch: process.arch, runId, version: process.env.DSH_EXPECTED_VERSION ?? null,
  startedAt: new Date().toISOString(), status: 'failed', category: 'infrastructure', stage: 'setup', check: 'official-bundle-installation', checks: [],
  scope: { officialNpmRuntime: true, officialPluginManager: true, ordinaryWebSessions: true, scriptedLocalModel: true, browserUI: false, desktop: false, modelIntelligence: false } };
const marker = `crosschat_dsh_${report.runId.slice(0, 8)}_`;
const names = Object.fromEntries(['idle', 'busy', 'sender', 'receiver'].map((kind) => [kind, `${marker}${kind}`]));
const sessions = {};
let fixture; let releaseBusy = () => {}; let busyStarted; let startBusy;
let busyGate; let busyTool = false; let bootstrapTool = false; let senderTool = false; let receiverTool = false;
const busyRequests = [];
const userText = (body) => (body?.messages ?? []).filter((message) => message.role === 'user').flatMap((message) => typeof message.content === 'string' ? [message.content] : (message.content ?? []).filter((item) => item.type === 'text').map((item) => item.text)).join('\n');
const shell = (command) => ({ tool: { name: process.platform === 'win32' ? 'pwsh' : 'bash', input: { description: 'Run a fixed crosschat compatibility fixture command', command }, id: `fixture-${randomUUID()}` } });
const text = (value) => ({ text: value });
function respond(body) {
  const input = userText(body);
  if (input.includes(`${marker}bootstrap`) && !bootstrapTool) {
    bootstrapTool = true;
    return shell(dshIdentityBootstrapCommand());
  }
  if (input.includes(`${marker}busy-start`)) {
    busyRequests.push(input);
    if (!busyTool) { busyTool = true; startBusy(); return busyGate.then(() => shell(dshNodeCommand(['-e', 'console.log("crosschat-dsh-boundary")']))); }
    return text(input.includes(`${marker}queued`) ? `${marker}queue-ACK` : `${marker}steer-ACK`);
  }
  if (input.includes(`${marker}begin-roundtrip`) && !senderTool) {
    senderTool = true;
    return shell(dshShellCommand(['send', '--tool', 'dsh', '--to', sessions.receiver.id, '--body', `${marker}roundtrip-request`, '--json']));
  }
  if (input.includes(`${marker}roundtrip-request`) && !input.includes(`${marker}roundtrip-reply`) && !receiverTool) {
    const reply = replySendArgs(input, { tool: 'dsh', requestBody: `${marker}roundtrip-request`, body: `${marker}roundtrip-reply` });
    receiverTool = true;
    return shell(dshShellCommand(reply));
  }
  return text(input.includes(`${marker}after-lifecycle`) ? `${marker}lifecycle-ACK` : input.includes(`${marker}idle-message`) ? `${marker}idle-ACK` : `${marker}bootstrap-ACK`);
}
async function check(name, action) {
  report.check = name; const started = Date.now(); await action();
  report.checks.push({ name, status: 'passed', elapsedMs: Date.now() - started }); process.stdout.write(`PASS ${name}\n`);
}
function sent(result) {
  assert.equal(result.timedOut, false, 'crosschat command must finish within its deadline');
  assert.equal(result.code, 0, `crosschat command failed: ${result.stderr}\n${result.stdout}`);
  const receipt = JSON.parse(result.stdout.trim());
  assert.ok(['delivered', 'queued'].includes(receipt.status)); return receipt;
}
function redact(value) {
  let result = typeof value === 'string' ? value : JSON.stringify(value);
  if (fixture?.info?.token) result = result.replaceAll(fixture.info.token, '[fixture-token-redacted]');
  return result.replace(/([?&]token=)[^&\s"']+/g, '$1[redacted]').replace(/\b[a-f0-9]{64}\b/g, '[hex64-redacted]');
}
async function bridgeRegistration() {
  const directory = join(fixture.env.HOME, '.crosschat', 'dsh', 'instances');
  const records = (await readdir(directory)).filter((name) => name.endsWith('.json'));
  assert.equal(records.length, 1, 'Exactly one owned production bridge must be registered');
  const value = JSON.parse(await readFile(join(directory, records[0]), 'utf8'));
  assert.equal(value.pid, fixture.pid); return value;
}
function portIsClosed(url) {
  return new Promise((done, reject) => {
    const target = new URL(url);
    const socket = createConnection({ host: '127.0.0.1', port: Number(target.port) });
    const timer = setTimeout(() => { socket.destroy(); reject(Object.assign(new Error('Owned bridge port probe timed out'), { category: 'infrastructure', check: 'fixture-port-probe' })); }, 2000);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); done(false); });
    socket.once('error', (error) => { clearTimeout(timer); socket.destroy(); if (error.code === 'ECONNREFUSED') done(true); else reject(error); });
  });
}
try {
  fixture = await createDshFixture({ runtime: process.env.DSH_RUNTIME_DIR, parentRoot: process.env.DSH_TASK_ROOT }, respond);
  report.version = fixture.info.version;
  if (process.env.DSH_EXPECTED_VERSION && report.version !== process.env.DSH_EXPECTED_VERSION) throw new Error('Official runtime version differs from the requested artifact');
  report.installation = fixture.installation;
  await check('official-plugin-installation-and-owned-web-runtime', async () => {
    assert.equal(fixture.installation.code, 0);
    const health = await fixture.controller('/health');
    assert.equal(health.pid, fixture.pid); assert.equal(health.version, report.version);
    assert.ok(Number.isSafeInteger(health.webPort) && health.webPort > 0, 'The actual Web Host must own a listening port');
    report.runtimePid = fixture.pid; report.webPort = health.webPort;
  });
  report.stage = 'setup'; report.category = 'infrastructure';
  await check('public-web-session-controller-creates-interactive-sessions', async () => {
    for (const [kind, title] of Object.entries(names)) sessions[kind] = await fixture.createSession(title);
    assert.equal(new Set(Object.values(sessions).map((session) => session.id)).size, 4);
    for (const session of Object.values(sessions)) assert.equal((await fixture.snapshot(session.id)).header.cwd, fixture.workspace);
    report.sessionIds = Object.fromEntries(Object.entries(sessions).map(([kind, session]) => [kind, session.id]));
  });
  report.stage = 'model-fixture'; report.category = 'infrastructure';
  await check('messages-model-and-native-shell-identity-bootstrap', async () => {
    await fixture.prompt(sessions.idle.id, `${marker}bootstrap`); await fixture.idle(sessions.idle.id);
    const snapshot = await fixture.snapshot(sessions.idle.id); const serialized = JSON.stringify(snapshot.events);
    assert.ok(serialized.includes(sessions.idle.id) && serialized.includes(`${marker}bootstrap-ACK`));
    const outputs = JSON.stringify(fixture.model.requests);
    assert.ok(outputs.includes('tool_result'), 'A real tool result must reach the next official provider request');
    const identity = assessDshNativeIdentity(fixture.model.requests, { session: sessions.idle.id, profile: 'web', dshHome: fixture.env.DSH_HOME });
    if (!identity.ready) throw Object.assign(new Error('The actual shell output does not prove the current native Harness identity'), identity);
    report.bootstrapCallerSourceDiagnostics = diagnoseDshCallerSource(fixture.model.requests, { session: sessions.idle.id, profile: 'web', dshHome: fixture.env.DSH_HOME });
    const registration = await bridgeRegistration();
    report.bootstrapCallerSourceDiagnostics.bridge = { callerIdentityAdvertised: registration.callerIdentity?.schema === 1,
      endpointType: ['host', 'desktop'].includes(registration.endpointType) ? registration.endpointType : 'unknown', profileMatched: registration.profile === 'web' };
    const callerSource = assessDshCallerSourceIdentity(fixture.model.requests, { session: sessions.idle.id, profile: 'web', dshHome: fixture.env.DSH_HOME });
    if (!callerSource.ready) throw Object.assign(new Error('The native shellEnv contribution did not verify the current Harness instance; no source identity was injected'), callerSource);
    report.bootstrapCallerSource = callerSource.source;
    assert.ok(bootstrapTool && fixture.model.requests.length >= 2 && !fixture.model.errors.length);
    report.bootstrapModelRequests = fixture.model.requests.length;
  });
  report.stage = 'contract'; report.category = 'compatibility';
  await check('authenticated-production-discovery-and-pagination', async () => {
    const registration = await bridgeRegistration();
    assert.equal((await globalThis.fetch(`${registration.url}/v1/info`)).status, 401);
    const items = []; let cursor; let complete = false;
    for (let pageIndex = 0; pageIndex < 10; pageIndex++) {
      const result = await fixture.cli(['discover'], JSON.stringify({ op: 'list', filter: { providerIds: ['dsh'] }, limit: 2, ...(cursor ? { cursor } : {}) }));
      assert.equal(result.code, 0, result.stderr); const page = JSON.parse(result.stdout).page;
      assert.equal(page.errors.length, 0, JSON.stringify(page.errors)); items.push(...page.items);
      if (page.nextCursor === null) { assert.equal(page.completeness, 'complete'); complete = true; break; }
      assert.equal(page.completeness, 'partial'); cursor = page.nextCursor;
    }
    assert.ok(complete); assert.equal(items.length, 4);
    for (const session of Object.values(sessions)) assert.ok(items.some((item) => item.ref.providerId === 'dsh' && item.ref.nativeId === session.id && item.name === session.title));
  });
  await check('idle-production-delivery-wakes-the-existing-session', async () => {
    sent(await fixture.cli(['send', '--tool', 'dsh', '--to', sessions.idle.id, '--body', `${marker}idle-message`, '--json']));
    await fixture.idle(sessions.idle.id);
    const snapshot = JSON.stringify((await fixture.snapshot(sessions.idle.id)).events);
    assert.ok(snapshot.includes(`${marker}idle-message`) && snapshot.includes(`${marker}idle-ACK`));
    assert.ok(fixture.model.requests.some((body) => userText(body).includes(`${marker}idle-message`)));
    report.check = 'bridge-lifecycle';
    report.lifecycle = { status: 'failed', mechanism: 'official-plugin-manager-bundle-disable-enable' };
    const previous = await bridgeRegistration();
    const disabled = await fixture.controller('/bridge', { enabled: false });
    assert.equal(disabled.result.application, 'applied', 'Official manager must apply live disable, not require restart');
    assert.equal(disabled.pid, fixture.pid);
    const retained = async () => {
      for (const session of Object.values(sessions)) assert.equal((await fixture.snapshot(session.id)).sameAgent, true, 'Stopping the bridge must preserve the exact existing Agent objects');
    };
    await retained();
    const remaining = (await readdir(join(fixture.env.HOME, '.crosschat', 'dsh', 'instances'))).filter((name) => name.endsWith('.json'));
    assert.equal(remaining.length, 0, 'The disabled plugin must withdraw its own production registration');
    assert.equal(await portIsClosed(previous.url), true, 'The previous production endpoint must close');
    const unavailable = await fixture.cli(['send', '--tool', 'dsh', '--to', sessions.idle.id, '--body', `${marker}must-not-arrive-while-disabled`, '--json']);
    assert.notEqual(unavailable.code, 0); assert.equal(unavailable.timedOut, false);
    assert.ok(!JSON.stringify((await fixture.snapshot(sessions.idle.id)).events).includes(`${marker}must-not-arrive-while-disabled`));
    const enabled = await fixture.controller('/bridge', { enabled: true });
    assert.equal(enabled.result.application, 'applied', 'Official manager must remount the existing installed bundle');
    assert.equal(enabled.pid, fixture.pid); await retained();
    const replacement = await bridgeRegistration();
    assert.notEqual(replacement.instanceId, previous.instanceId); assert.notEqual(replacement.token, previous.token);
    assert.equal((await globalThis.fetch(`${replacement.url}/v1/info`, { headers: { authorization: `Bearer ${previous.token}` }, signal: globalThis.AbortSignal.timeout(5000) })).status, 401, 'The remounted endpoint must reject the previous instance credential');
    sent(await fixture.cli(['send', '--tool', 'dsh', '--to', sessions.idle.id, '--body', `${marker}after-lifecycle`, '--json']));
    await fixture.idle(sessions.idle.id);
    assert.ok(JSON.stringify((await fixture.snapshot(sessions.idle.id)).events).includes(`${marker}lifecycle-ACK`), 'The same existing session must answer a fresh post-remount message');
    report.lifecycle = { status: 'passed', mechanism: 'official-plugin-manager-bundle-disable-enable', pid: fixture.pid, retainedSessionIds: Object.values(sessions).map((session) => session.id),
      previousInstanceId: previous.instanceId, newInstanceId: replacement.instanceId, previousPort: Number(new URL(previous.url).port), newPort: Number(new URL(replacement.url).port), previousPortClosed: true, previousCredentialRejected: true, freshAck: true };
  });
  await check('busy-native-queue-and-steer-step-boundaries', async () => {
    busyGate = new Promise((done) => { releaseBusy = done; }); busyStarted = new Promise((done) => { startBusy = done; });
    await fixture.prompt(sessions.busy.id, `${marker}busy-start`);
    let timer;
    try { await Promise.race([busyStarted, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Busy request never reached the model fixture')), 30000); })]); }
    finally { clearTimeout(timer); }
    sent(await fixture.cli(['send', '--tool', 'dsh', '--to', sessions.busy.id, '--body', `${marker}queued`, '--delivery', 'queue', '--json']));
    sent(await fixture.cli(['send', '--tool', 'dsh', '--to', sessions.busy.id, '--body', `${marker}steered`, '--delivery', 'steer', '--json']));
    const pending = (await fixture.snapshot(sessions.busy.id)).inbox;
    assert.ok(JSON.stringify(pending.nextTurn).includes(`${marker}queued`));
    assert.ok(JSON.stringify(pending.nextStep).includes(`${marker}steered`));
    releaseBusy(); await fixture.idle(sessions.busy.id);
    assert.ok(busyRequests.length >= 3);
    assert.ok(busyRequests[1].includes(`${marker}steered`) && !busyRequests[1].includes(`${marker}queued`));
    assert.ok(busyRequests.slice(2).some((value) => value.includes(`${marker}queued`)));
    const drained = (await fixture.snapshot(sessions.busy.id)).inbox;
    assert.equal(drained.nextTurn.length + drained.nextStep.length, 0);
  });
  await check('native-shell-send-and-conversation-reply-have-full-session-identities', async () => {
    await fixture.prompt(sessions.sender.id, `${marker}begin-roundtrip`);
    await pollDsh(async () => JSON.stringify((await fixture.snapshot(sessions.sender.id)).events).includes(`${marker}roundtrip-reply`), 'native Harness round trip', 60000);
    await Promise.all([fixture.idle(sessions.sender.id), fixture.idle(sessions.receiver.id)]);
    assert.ok(senderTool && receiverTool);
    const raw = JSON.stringify(fixture.model.requests);
    const references = [...raw.matchAll(/mc2_[A-Za-z0-9_-]+/g)].flatMap(([value]) => { try { return [decodeRef(value)]; } catch { return []; } });
    const outgoing = references.find((ref) => ref.f.p === 'dsh' && ref.f.id === sessions.sender.id && ref.t.p === 'dsh' && ref.t.id === sessions.receiver.id && ref.c === 1);
    assert.ok(outgoing, 'A real native shell receipt must encode both complete Harness identities');
    assert.ok(references.some((ref) => ref.n === outgoing.n && ref.c === 2), 'The receiver must use the same conversation for its actual shell reply');
  });
  await check('missing-target-does-not-create-or-resume-a-replacement', async () => {
    const result = await fixture.cli(['send', '--tool', 'dsh', '--to', 'crosschat-fixture-missing', '--body', 'never create a session', '--json']);
    assert.notEqual(result.code, 0); assert.equal(result.timedOut, false);
    const discovered = await fixture.cli(['discover'], JSON.stringify({ op: 'list', filter: { providerIds: ['dsh'] }, limit: 10 }));
    assert.equal(discovered.code, 0); assert.equal(JSON.parse(discovered.stdout).page.items.length, 4);
  });
  report.status = 'passed'; report.stage = 'done'; report.category = null; delete report.check;
} catch (error) {
  report.error = redact(error instanceof Error ? error.message : String(error));
  if (error?.check) report.check = error.check;
  if (error?.category) report.category = error.category;
  if (error?.cleanup) report.cleanup = error.cleanup;
  if (error?.logs) report.logs = { stdout: redact(error.logs.stdout), stderr: redact(error.logs.stderr) };
  if (error?.fixtureRoot) report.retainedFixtureRoot = error.fixtureRoot;
} finally {
  releaseBusy();
  if (fixture) {
    try { await fixture.close(); } catch (error) { report.status = 'failed'; report.stage = 'cleanup'; report.category = 'infrastructure'; report.error = redact(error.message); report.retainedFixtureRoot = fixture.root; }
    report.cleanup = fixture.cleanup;
    report.logs = { stdout: redact(fixture.logs.stdout), stderr: redact(fixture.logs.stderr) };
  }
  report.finishedAt = new Date().toISOString();
  await mkdir(dirname(reportPath), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(`${JSON.stringify({ status: report.status, version: report.version, checks: report.checks.length, check: report.check, report: reportPath })}\n`);
  if (report.status !== 'passed') process.exitCode = 1;
}
