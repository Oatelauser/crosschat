#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { URL } from 'node:url';
import { createOpenCodeFixture, crosschatShell, poll, userText } from '../test/helpers/opencode-live-fixture.mjs';
import { textStream, toolStream } from '../test/helpers/opencode-mock-model.mjs';

// Explicit opt-in: npm test never downloads or starts an upstream tool.
if (process.env.CROSSCHAT_LIVE !== '1') throw new Error('Set CROSSCHAT_LIVE=1 to run the isolated real OpenCode compatibility probe');
const reportFlag = process.argv.indexOf('--report');
const reportPath = reportFlag < 0 ? undefined : process.argv[reportFlag + 1];
if (reportFlag >= 0 && !reportPath) throw new Error('--report requires a path');
const report = {
  schema: 1, tool: 'opencode-cli', platform: process.platform, arch: process.arch, version: process.env.OPENCODE_EXPECTED_VERSION ?? null,
  startedAt: new Date().toISOString(), status: 'failed', stage: 'setup', category: 'infrastructure', checks: [],
  scope: 'real service, real crosschat CLI, real shell tool; scripted model; no desktop UI or model intelligence assertion',
};
let fixture;
let releaseBusy = () => {};
let holdBusy;
let busyStarted;
let startBusy;
let busyToolEmitted = false;
let senderToolEmitted = false;
let replyToolEmitted = false;
let bootstrapToolEmitted = false;
const marker = 'crosschat_fixture_';
const names = { sender: `${marker}sender`, receiver: `${marker}receiver`, busy: `${marker}busy`, idle: `${marker}idle` };
const busyRequests = [];

function shell(command) { return toolStream('shell', { command, timeout: 10000 }); }
function respond(body) {
  const text = userText(body);
  if (text.includes(`${marker}bootstrap`) && !bootstrapToolEmitted) {
    bootstrapToolEmitted = true;
    return shell('echo crosschat-fixture-bootstrap');
  }
  if (text.includes(`${marker}busy-start`)) {
    busyRequests.push(text);
    if (!busyToolEmitted) {
      busyToolEmitted = true;
      startBusy();
      return holdBusy.then(() => shell('echo crosschat-fixture-boundary'));
    }
    return textStream(text.includes(`${marker}queued`) ? `${marker}queue-finished` : `${marker}steer-finished`);
  }
  if (text.includes(`${marker}begin-roundtrip`) && !senderToolEmitted) {
    senderToolEmitted = true;
    return shell(crosschatShell(['send', '--to', `opencode/${names.receiver}`, '--body', `${marker}roundtrip-request`, '--json']));
  }
  if (text.includes(`${marker}roundtrip-request`) && !text.includes(`${marker}roundtrip-reply`) && !replyToolEmitted) {
    const reference = text.match(/--conversation\s+(\S+)/)?.[1];
    assert.ok(reference, 'Incoming envelope must teach a reply route');
    replyToolEmitted = true;
    return shell(crosschatShell(['send', '--conversation', reference, '--body', `${marker}roundtrip-reply`, '--json']));
  }
  return textStream(`${marker}accepted`);
}

async function check(name, action) {
  report.check = name;
  const started = Date.now();
  await action();
  report.checks.push({ name, status: 'passed', elapsedMs: Date.now() - started });
  process.stdout.write(`PASS ${name}\n`);
}

function sent(result) {
  assert.equal(result.code, 0, `crosschat failed: ${result.stderr}\n${result.stdout}`);
  const receipt = JSON.parse(result.stdout.trim());
  assert.ok(['delivered', 'queued'].includes(receipt.status), `Unexpected receipt: ${result.stdout}`);
  return receipt;
}

try {
  fixture = await createOpenCodeFixture(process.env.OPENCODE_BIN, respond);
  report.version = fixture.info.version;
  if (process.env.OPENCODE_EXPECTED_VERSION && report.version !== process.env.OPENCODE_EXPECTED_VERSION) throw Object.assign(new Error('Downloaded binary version does not match pinned manifest'), { category: 'compatibility', check: 'service-version' });
  report.stage = 'contract'; report.category = 'compatibility';
  const sessions = {};
  await check('native-session-create', async () => {
    for (const [kind, title] of Object.entries(names)) sessions[kind] = await fixture.createSession(title);
    assert.equal(new Set(Object.values(sessions).map((item) => item.id)).size, 4);
  });
  report.stage = 'model-fixture'; report.category = 'infrastructure';
  await check('scripted-provider-and-native-shell-bootstrap', async () => {
    await fixture.prompt(sessions.idle.id, `${marker}bootstrap`);
    await fixture.idle(sessions.idle.id);
    const transcript = await fixture.transcript(sessions.idle.id);
    assert.ok(transcript.some((message) => message.type === 'assistant' && message.content?.some((item) => item.type === 'tool' && item.state?.status === 'completed')), 'Native shell must execute the bootstrap tool successfully');
    assert.ok(JSON.stringify(transcript).includes(`${marker}accepted`), 'Scripted provider must complete before testing crosschat');
  });
  report.stage = 'contract'; report.category = 'compatibility';
  await check('authenticated-service-discovery', async () => {
    const unauthorized = await globalThis.fetch(new URL('/api/info', fixture.info.url), { signal: globalThis.AbortSignal.timeout(5000) });
    assert.equal(unauthorized.status, 401);
    let cursor; let complete = false;
    const items = [];
    for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
      const result = await fixture.cli(['discover'], JSON.stringify({ op: 'list', filter: { providerIds: ['opencode'] }, limit: 2, ...(cursor ? { cursor } : {}) }));
      assert.equal(result.code, 0, result.stderr);
      const page = JSON.parse(result.stdout).page;
      assert.equal(page.errors.length, 0, JSON.stringify(page.errors));
      items.push(...page.items);
      if (page.nextCursor === null) { assert.equal(page.completeness, 'complete'); complete = true; break; }
      assert.equal(page.completeness, 'partial'); cursor = page.nextCursor;
    }
    assert.ok(complete, 'Discovery pagination must finish');
    for (const session of Object.values(sessions)) assert.ok(items.some((item) => item.ref.providerId === 'opencode' && item.ref.nativeId === session.id && item.name === session.title), `Real session ${session.id} must be discoverable`);
  });
  await check('idle-delivery-and-model-wakeup', async () => {
    sent(await fixture.cli(['send', '--to', `opencode/${names.idle}`, '--body', `${marker}idle-message`, '--json']));
    await fixture.idle(sessions.idle.id);
    const transcript = await fixture.transcript(sessions.idle.id);
    assert.ok(JSON.stringify(transcript).includes(`${marker}idle-message`));
    assert.ok(JSON.stringify(transcript).includes(`${marker}accepted`));
    assert.ok(fixture.model.requests.some((body) => userText(body).includes(`${marker}idle-message`)));
  });
  await check('native-queue-and-steer-boundaries', async () => {
    holdBusy = new Promise((done) => { releaseBusy = done; });
    busyStarted = new Promise((done) => { startBusy = done; });
    await fixture.prompt(sessions.busy.id, `${marker}busy-start`);
    await Promise.race([busyStarted, new Promise((_, reject) => setTimeout(() => reject(new Error('Busy model request did not start')), 30000).unref())]);
    const queued = sent(await fixture.cli(['send', '--to', `opencode/${names.busy}`, '--body', `${marker}queued`, '--delivery', 'queue', '--json']));
    assert.equal(queued.queued, true, 'Busy native queue must carry the queued delivery flag');
    sent(await fixture.cli(['send', '--to', `opencode/${names.busy}`, '--body', `${marker}steered`, '--delivery', 'steer', '--json']));
    const inbox = await fixture.api(`/api/session/${sessions.busy.id}/inbox`);
    assert.ok(inbox.data.some((item) => JSON.stringify(item).includes(`${marker}queued`) && item.delivery === 'queue'));
    assert.ok(inbox.data.some((item) => JSON.stringify(item).includes(`${marker}steered`) && item.delivery === 'steer'));
    releaseBusy();
    await fixture.idle(sessions.busy.id);
    assert.ok(busyRequests.length >= 3, 'Seed tool step, steered continuation and next queued turn must all reach the model');
    assert.ok(busyRequests[1].includes(`${marker}steered`), 'Steer must arrive at the next tool step boundary');
    assert.ok(!busyRequests[1].includes(`${marker}queued`), 'Queue must not enter the current turn');
    assert.ok(busyRequests.slice(2).some((text) => text.includes(`${marker}queued`)), 'Queue must execute after current turn finishes');
    const remaining = await fixture.api(`/api/session/${sessions.busy.id}/inbox`);
    assert.equal(remaining.data.length, 0);
  });
  await check('native-shell-identity-and-bidirectional-reply', async () => {
    // No sender env is injected by the fixture: the real OpenCode shell must provide its session ID.
    await fixture.prompt(sessions.sender.id, `${marker}begin-roundtrip`);
    await poll(async () => JSON.stringify(await fixture.transcript(sessions.sender.id)).includes(`${marker}roundtrip-reply`), 'native OpenCode shell round-trip reply', 60000);
    await Promise.all([fixture.idle(sessions.sender.id), fixture.idle(sessions.receiver.id)]);
    const received = JSON.stringify(await fixture.transcript(sessions.receiver.id));
    assert.ok(received.includes(`opencode/${sessions.sender.id.slice(0, 8)}`), 'Sender must be the actual OpenCode session, not human');
    assert.ok(senderToolEmitted && replyToolEmitted);
  });
  await check('service-restart-preserves-exact-session', async () => {
    const previous = fixture.pid;
    await fixture.restart();
    assert.notEqual(fixture.pid, previous);
    const receipt = sent(await fixture.cli(['send', '--to', `opencode/${sessions.idle.id}`, '--body', `${marker}after-restart`, '--json']));
    assert.ok(receipt.to.includes(sessions.idle.id));
    await fixture.idle(sessions.idle.id);
    assert.ok(JSON.stringify(await fixture.transcript(sessions.idle.id)).includes(`${marker}after-restart`));
  });
  await check('missing-target-is-explicit', async () => {
    const result = await fixture.cli(['send', '--to', 'opencode/crosschat-fixture-does-not-exist', '--body', 'must not create a replacement session', '--json']);
    assert.notEqual(result.code, 0);
    assert.ok(!result.timedOut);
    const listed = await fixture.api('/api/session');
    assert.equal(listed.data.length, 4, 'Missing-target failure must not create a native session');
  });
  assert.equal(fixture.model.errors.length, 0, fixture.model.errors.join('\n'));
  report.status = 'passed'; report.stage = 'done'; delete report.category; delete report.check;
} catch (error) {
  if (error?.category === 'compatibility') { report.category = 'compatibility'; report.stage = 'startup-contract'; report.check = error.check; }
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  releaseBusy();
  if (fixture) {
    report.modelRequests = fixture.model.requests.map((body) => ({ model: body.model, userText: userText(body) }));
    report.serviceLogs = fixture.logs;
    try { await fixture.close(); report.cleanup = { removed: true, ownedRoot: fixture.root, ownedProcesses: fixture.processIds }; }
    catch (error) { report.status = 'failed'; report.category = 'infrastructure'; report.cleanup = { removed: false, ownedRoot: fixture.root, error: String(error) }; process.exitCode = 1; }
  }
  report.finishedAt = new Date().toISOString();
  if (reportPath) { const path = resolve(reportPath); await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(report, null, 2) + '\n'); }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
