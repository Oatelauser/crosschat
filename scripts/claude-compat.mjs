#!/usr/bin/env node
import { replySendArgs } from '../test/helpers/compat-reply.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { decodeRef, encodeRef, newConversationRef } from '../dist/ref.js';
import { keyFileName } from '../dist/claude/key-file.js';
import { assessClaudeIdentityEvidence, claudeBashCommand, createClaudeFixture, pollClaude } from '../test/helpers/claude-live-fixture.mjs';
import { claudeCompatibilityScope, claudeRequiredChecks } from './claude-compat-ci.mjs';

if (process.env.CROSSCHAT_LIVE !== '1') throw new Error('CROSSCHAT_LIVE=1 is required for the isolated official Claude Code probe');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This Claude Code probe covers Windows x64 only');
const argument = (name) => { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; };
const reportArgument = argument('--report'); const runId = argument('--run-id');
if (!reportArgument || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(runId ?? '')) throw new Error('--report <path> and --run-id <UUID v4> are required');
const reportPath = resolve(reportArgument);
const report = { schema: 1, tool: 'claude-code-cli', platform: process.platform, arch: process.arch, runId,
  version: process.env.CLAUDE_EXPECTED_VERSION ?? null, scope: claudeCompatibilityScope, startedAt: new Date().toISOString(),
  status: 'failed', category: 'infrastructure', stage: 'setup', check: claudeRequiredChecks[0], checks: [] };
const states = new Map(); const barriers = []; const marker = `CC_CI_${runId.replaceAll('-', '')}`;
let fixture; let sender; let receiver;

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function contentText(content) {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.filter(record).map((part) => {
    if (part.type === 'text' && typeof part.text === 'string') return part.text;
    // Claude can append a native next-step message inside a tool result's visible text.
    return part.type === 'tool_result' ? contentText(part.content) : '';
  }).join('\n') : '';
}
function userText(body) {
  return (Array.isArray(body?.messages) ? body.messages : []).filter((item) => item?.role === 'user').map((item) => contentText(item.content)).join('\n');
}
function toolResults(body) {
  return (Array.isArray(body?.messages) ? body.messages : []).filter((item) => item?.role === 'user' && Array.isArray(item.content))
    .flatMap((item) => item.content.filter((part) => record(part) && part.type === 'tool_result'));
}
function markerSources(body, needle) {
  const sources = [];
  for (const [messageIndex, message] of (Array.isArray(body?.messages) ? body.messages : []).entries()) {
    const role = ['user', 'assistant', 'system', 'tool'].includes(message?.role) ? message.role : 'other';
    if (typeof message?.content === 'string') {
      if (message.content.includes(needle)) sources.push({ messageIndex, role, blockType: 'string' });
    } else if (Array.isArray(message?.content)) {
      for (const [blockIndex, block] of message.content.entries()) {
        if (!JSON.stringify(block)?.includes(needle)) continue;
        const blockType = ['text', 'tool_result', 'tool_use', 'thinking', 'redacted_thinking'].includes(block?.type) ? block.type : 'other';
        sources.push({ messageIndex, blockIndex, role, blockType });
      }
    }
  }
  return sources;
}
function stateFor(id) {
  if (!states.has(id)) states.set(id, { id, bootstrapTool: false, bootstrapComplete: false, requests: [], scenario: undefined });
  return states.get(id);
}
const bash = (command, id) => ({ tool: { id, name: 'Bash', input: { command, description: 'Run the isolated compatibility check', timeout: 60000 } } });
const answer = (text) => ({ text });

/** Only provider output is scripted. Native inbox consumption, shell execution and scheduling remain Claude's. */
function respond(body, context) {
  const text = userText(body); const id = text.match(/CC_CI_BOOTSTRAP ([0-9a-f-]{36})/)?.[1];
  if (!id) return answer('CC_CI_WARMUP');
  const state = stateFor(id); const results = toolResults(body);
  state.requests.push({ index: context.index, text, results });
  const bootstrapId = `cc_bootstrap_${id.replaceAll('-', '')}`;
  if (!state.bootstrapTool) {
    state.bootstrapTool = true;
    return bash(claudeBashCommand(['-e', 'process.stdout.write(JSON.stringify({socket:process.env.CLAUDE_CODE_MESSAGING_SOCKET,session:process.env.CLAUDE_CODE_SESSION_ID,home:process.env.USERPROFILE,cwd:process.cwd()}))']), bootstrapId);
  }
  if (!state.bootstrapComplete) {
    state.identityResult = results.find((result) => result.tool_use_id === bootstrapId);
    state.bootstrapComplete = Boolean(state.identityResult);
    return answer(`CC_CI_BOOTSTRAP_ACK ${id}`);
  }
  const scenario = state.scenario;
  if (!scenario) return answer('CC_CI_QUIET');
  if (scenario.kind === 'idle') return answer(`${scenario.ack} ${text.includes(scenario.body) ? 'received' : 'missing'}`);
  if (scenario.kind === 'busy') {
    const deliverySources = markerSources(body, scenario.body);
    scenario.deliveryObservations ??= [];
    scenario.deliveryObservations.push({ requestIndex: context.index, userContentContainsMarker: text.includes(scenario.body), sources: deliverySources });
    if (!scenario.toolIssued && text.includes(scenario.start)) {
      scenario.toolIssued = true; return bash(scenario.gate.command, scenario.toolId);
    }
    const result = results.find((item) => item.tool_use_id === scenario.toolId);
    if (result && !scenario.afterTool) {
      scenario.afterTool = { requestIndex: context.index, sawDelivery: text.includes(scenario.body), deliverySources, result };
      return answer(scenario.mode === 'queue' ? scenario.originalAck : scenario.combinedAck);
    }
    if (scenario.afterTool && text.includes(scenario.body)) {
      scenario.nextTurn = { requestIndex: context.index, resultCountAtRequest: scenario.session.results().length,
        originalAckInHistory: (Array.isArray(body.messages) ? body.messages : []).some((message) => message.role === 'assistant' && contentText(message.content).includes(scenario.originalAck)) };
      return answer(scenario.queuedAck);
    }
    return answer('CC_CI_UNEXPECTED_BUSY_CONTINUATION');
  }
  if (scenario.kind === 'roundtrip-send') {
    if (!scenario.toolIssued && text.includes(scenario.start)) {
      scenario.toolIssued = true;
      return bash(fixture.shell(['send', '--tool', 'claude', '--to', receiver.name, '--body', scenario.requestBody, '--json']), scenario.toolId);
    }
    const result = results.find((item) => item.tool_use_id === scenario.toolId);
    if (result && !scenario.receiptResult) { scenario.receiptResult = result; return answer(`${marker}_REQUEST_SENT`); }
    if (text.includes(scenario.replyBody)) { scenario.replySeen = true; return answer(`${marker}_REPLY_RECEIVED`); }
    return answer('CC_CI_WAITING_FOR_REPLY');
  }
  if (scenario.kind === 'roundtrip-receive') {
    if (!scenario.toolIssued && text.includes(scenario.requestBody)) {
      scenario.incomingSeen = true;
      const envelope = [...text.matchAll(/<cross-session-message\b[^>]*>[\s\S]*?<\/cross-session-message>/g)]
        .map((match) => match[0]).find((value) => value.includes(scenario.requestBody));
      const reply = replySendArgs(envelope, { tool: 'claude', requestBody: scenario.requestBody, body: scenario.replyBody });
      scenario.reference = reply[2];
      scenario.toolIssued = true;
      return bash(fixture.shell(reply), scenario.toolId);
    }
    const result = results.find((item) => item.tool_use_id === scenario.toolId);
    if (result) scenario.receiptResult = result;
    return answer(`${marker}_REPLY_SENT`);
  }
  return answer('CC_CI_UNKNOWN_SCENARIO');
}

function redact(value) {
  return String(value).replaceAll('mock-key', '[fixture-key]').replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [redacted]')
    .replace(/((?:authorization|x-api-key|peerToken|childToken|CLAUDE_CODE_MESSAGING_TOKEN)["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'[^']*'|[^\s,;]+)/gi, '$1[redacted]');
}
function samePath(left, right) {
  const canonical = (value) => resolve(String(value).startsWith('\\\\?\\') ? String(value).slice(4) : String(value)).toLowerCase();
  return typeof left === 'string' && typeof right === 'string' && canonical(left) === canonical(right);
}
async function check(name, action) {
  report.check = name; const started = Date.now();
  await action(); report.checks.push({ name, status: 'passed', elapsedMs: Date.now() - started }); process.stdout.write(`PASS ${name}\n`);
}
function successfulResult(result) {
  assert.equal(result?.type, 'result'); assert.equal(result.is_error, false, 'A real native turn must complete without an error'); assert.equal(result.subtype, 'success');
}
function nativeToolResult(result) {
  assert.ok(result, 'The next real model request must contain the native tool result'); assert.notEqual(result.is_error, true, 'The real Bash tool must succeed');
  return contentText(result.content);
}
/** Bash may append native notes after stdout. Parse only the leading object in this exact tool result. */
function nativeToolObject(result) {
  const text = nativeToolResult(result); let start = 0;
  while (start < text.length && /[ \t\r\n]/.test(text[start])) start++;
  assert.equal(text[start], '{', 'The native Bash tool output must begin with a JSON object');
  const stack = []; let quoted = false; let escaped = false;
  for (let index = start; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '{' || character === '[') stack.push(character);
    else if (character === '}' || character === ']') {
      assert.equal(stack.pop(), character === '}' ? '{' : '[', 'The leading native JSON object has mismatched brackets');
      if (stack.length === 0) {
        const value = JSON.parse(text.slice(start, index + 1)); assert.ok(record(value), 'The native tool result must contain a JSON object'); return value;
      }
    }
  }
  throw new Error('The native Bash tool output begins with an incomplete JSON object');
}
function sent(result, expectedNativeId) {
  assert.equal(result.timedOut, false); assert.equal(result.signal, null); assert.equal(result.code, 0, redact(result.stderr));
  const receipt = JSON.parse(result.stdout.trim()); assert.equal(receipt.status, 'delivered'); assert.equal(receipt.queued, false);
  assert.equal(typeof receipt.replyRef, 'string');
  const target = decodeRef(receipt.replyRef).t; assert.equal(target.p, 'claude'); assert.equal(target.id, expectedNativeId);
  return receipt;
}
async function idle(session) {
  let since;
  await pollClaude(() => {
    const entry = fixture.scan().sessions.find((item) => item.sessionId === session.id);
    if (entry?.status !== 'idle') { since = undefined; return false; }
    since ??= Date.now(); return Date.now() - since >= 150;
  }, `stable native idle ${session.id}`, 15000);
}
async function discover(limit = 1) {
  const items = []; let cursor; let complete = false;
  for (let index = 0; index < 10; index++) {
    const result = await fixture.cli(['discover'], JSON.stringify({ op: 'list', filter: { providerIds: ['claude'] }, limit, ...(cursor ? { cursor } : {}) }));
    assert.equal(result.code, 0, redact(result.stderr)); assert.equal(result.timedOut, false); assert.equal(result.signal, null);
    const page = JSON.parse(result.stdout).page; assert.equal(page.errors.length, 0);
    items.push(...page.items);
    if (page.nextCursor === null) { assert.equal(page.completeness, 'complete'); complete = true; break; }
    assert.equal(page.completeness, 'partial'); cursor = page.nextCursor;
  }
  assert.ok(complete, 'Production discovery must complete pagination'); return items;
}
async function busy(mode) {
  await idle(receiver);
  const gate = await fixture.barrier(`busy-${mode}`); barriers.push(gate);
  const before = receiver.results().length;
  const scenario = { kind: 'busy', mode, gate, session: receiver, start: `${marker}_BUSY_${mode}_START`, body: `${marker}_BUSY_${mode}_MESSAGE`,
    toolId: `cc_busy_${mode}_${runId}`, originalAck: `${marker}_ORIGINAL_FINISHED`, queuedAck: `${marker}_QUEUED_ACK`, combinedAck: `${marker}_STEER_COMBINED_ACK` };
  stateFor(receiver.id).scenario = scenario;
  receiver.prompt(scenario.start); await gate.waitReady();
  assert.equal(fixture.scan().sessions.find((item) => item.sessionId === receiver.id)?.status, 'busy');
  sent(await fixture.cli(['send', '--tool', 'claude', '--to', receiver.name, '--body', scenario.body, '--delivery', mode, '--json']), receiver.id);
  assert.equal(receiver.results().length, before, 'The original tool must still be running when delivery is submitted');
  await gate.release(); await receiver.waitResults(before + 1);
  const boundary = { nativeToolCompleted: false, gatePid: gate.pid, enteredAfterTool: scenario.afterTool?.sawDelivery ?? null,
    afterToolSources: scenario.afterTool?.deliverySources ?? [], deliveryObservations: scenario.deliveryObservations ?? [], deliveryCount: 1 };
  report[`${mode}Boundary`] = boundary;
  nativeToolResult(scenario.afterTool?.result);
  assert.ok(contentText(scenario.afterTool.result.content).includes(`CC_CI_GATE_COMPLETE ${gate.nonce}`), 'The exact original Bash gate must finish successfully');
  boundary.nativeToolCompleted = true;
  assert.equal(scenario.afterTool.sawDelivery, mode === 'steer', 'Queue waits until turn completion; steer joins after the original tool step');
  if (mode === 'queue') {
    await receiver.waitResults(before + 2);
    assert.ok(scenario.nextTurn, 'The queued message must reach a separate real model request');
    assert.ok(scenario.nextTurn.requestIndex > scenario.afterTool.requestIndex);
    assert.ok(scenario.nextTurn.originalAckInHistory, 'The queued request must include the original completed assistant response in its history');
    assert.ok(receiver.results()[before].result.includes(scenario.originalAck)); assert.ok(receiver.results()[before + 1].result.includes(scenario.queuedAck));
  } else assert.ok(receiver.results()[before].result.includes(scenario.combinedAck));
  await idle(receiver); assert.equal(receiver.results().length, before + (mode === 'queue' ? 2 : 1));
  for (const result of receiver.results().slice(before)) successfulResult(result);
  Object.assign(boundary, { resultCount: receiver.results().length - before,
    ...(scenario.nextTurn ? { originalAckInQueuedHistory: true, observedResultsAtQueuedRequest: scenario.nextTurn.resultCountAtRequest } : {}) });
  stateFor(receiver.id).scenario = undefined;
}

try {
  fixture = await createClaudeFixture({ binary: process.env.CLAUDE_COMPAT_BIN, parentRoot: process.env.CLAUDE_COMPAT_PARENT, expectedVersion: process.env.CLAUDE_EXPECTED_VERSION }, respond);
  report.version = fixture.version;
  await check(claudeRequiredChecks[0], async () => {
    sender = await fixture.start(`${marker}_sender`); receiver = await fixture.start(`${marker}_receiver`);
    await Promise.all([sender.waitResults(1), receiver.waitResults(1)]);
    for (const session of [sender, receiver]) {
      nativeToolObject(stateFor(session.id).identityResult);
      successfulResult(session.results()[0]);
      assert.ok(session.results()[0].result.includes(`CC_CI_BOOTSTRAP_ACK ${session.id}`));
    }
    assert.equal(fixture.model.errors.length, 0);
    report.stage = 'contract'; report.category = 'compatibility';
    for (const session of [sender, receiver]) {
      const originalPid = session.entry.pid; let observed;
      try {
        session.entry = await pollClaude(() => {
          observed = fixture.scan().sessions.find((item) => item.sessionId === session.id);
          return observed?.name === session.name ? observed : undefined;
        }, `requested native session name ${session.id}`, 15000);
      } catch {
        throw new Error(`Native registry did not publish the requested name for ${session.id} (observed: ${JSON.stringify(observed?.name ?? null)})`);
      }
      assert.equal(session.entry.pid, originalPid, 'The bootstrap must retain its exact native process');
    }
    const scan = fixture.scan(); assert.equal(scan.malformed, 0); assert.equal(scan.sessions.length, 2);
    assert.equal(new Set(scan.sessions.map((item) => item.sessionId)).size, 2);
    for (const session of [sender, receiver]) {
      assert.equal(session.entry.sessionId, session.id); assert.equal(session.entry.name, session.name); assert.equal(session.entry.kind, 'interactive');
      assert.ok(samePath(session.entry.cwd, fixture.workspace)); assert.ok(session.entry.messagingSocketPath.startsWith('\\\\.\\pipe\\'));
      assert.ok(Number.isSafeInteger(session.entry.pid) && session.entry.pid > 0);
      await access(join(fixture.sessionsDir, keyFileName(session.entry.pid, session.entry.messagingSocketPath)));
    }
    report.sessions = [sender, receiver].map((session) => ({ id: session.id, name: session.name, wrapperPid: session.child.pid, nativePid: session.entry.pid }));
  });
  report.stage = 'model-fixture'; report.category = 'infrastructure';
  await check(claudeRequiredChecks[1], async () => {
    await Promise.all([sender.waitResults(1), receiver.waitResults(1)]);
    for (const session of [sender, receiver]) {
      report.stage = 'model-fixture'; report.category = 'infrastructure';
      const state = stateFor(session.id); let identity;
      try { identity = nativeToolObject(state.identityResult); }
      catch (error) {
        const output = state.identityResult ? contentText(state.identityResult.content) : '';
        report.identityOutputDiagnostic = { sessionId: session.id, prefix: redact(output.slice(0, 200)), suffix: redact(output.slice(-200)) }; throw error;
      }
      const assessment = assessClaudeIdentityEvidence({ toolResult: state.identityResult, identity, turnResult: session.results()[0],
        ack: `CC_CI_BOOTSTRAP_ACK ${session.id}`, modelErrors: fixture.model.errors },
      { session: session.id, socket: session.entry.messagingSocketPath, home: fixture.env.USERPROFILE, cwd: fixture.workspace });
      if (assessment.category === 'infrastructure') throw new Error('The real Bash tool and model bootstrap acknowledgement did not establish a valid identity test');
      report.stage = 'contract'; report.category = 'compatibility';
      assert.equal(identity.session, session.id); assert.equal(identity.socket, session.entry.messagingSocketPath); assert.ok(samePath(identity.home, fixture.env.USERPROFILE));
      assert.ok(samePath(identity.cwd, fixture.workspace), 'The actual native Bash cwd must remain inside the owned workspace');
      successfulResult(session.results()[0]); assert.ok(session.results()[0].result.includes(`CC_CI_BOOTSTRAP_ACK ${session.id}`)); await idle(session);
    }
    assert.equal(fixture.model.errors.length, 0); report.nativeIdentity = { sessionsVerified: 2, actualBash: true, sessionAndSocketMatchRegistry: true, isolatedHome: true, isolatedCwd: true };
  });
  report.stage = 'contract'; report.category = 'compatibility';
  await check(claudeRequiredChecks[2], async () => {
    const items = await discover(); assert.equal(items.length, 2);
    for (const session of [sender, receiver]) assert.ok(items.some((item) => item.ref.providerId === 'claude' && item.ref.nativeId === session.id && item.name === session.name && samePath(item.attributes.cwd, fixture.workspace)));
    for (const mode of ['queue', 'steer']) {
      await idle(receiver); const before = receiver.results().length;
      const scenario = { kind: 'idle', body: `${marker}_IDLE_${mode}`, ack: `${marker}_IDLE_${mode}_ACK` }; stateFor(receiver.id).scenario = scenario;
      sent(await fixture.cli(['send', '--tool', 'claude', '--to', receiver.name, '--body', scenario.body, '--delivery', mode, '--json']), receiver.id);
      await receiver.waitResults(before + 1); await idle(receiver); assert.equal(receiver.results().length, before + 1);
      successfulResult(receiver.results()[before]); assert.ok(receiver.results()[before].result.includes(`${scenario.ack} received`));
      assert.ok(stateFor(receiver.id).requests.some((request) => request.text.includes(scenario.body))); stateFor(receiver.id).scenario = undefined;
    }
    report.idleDelivery = { discoveryCount: 2, pageLimit: 1, queue: true, steer: true, deliveriesPerMode: 1 };
  });
  await check(claudeRequiredChecks[3], () => busy('queue'));
  await check(claudeRequiredChecks[4], () => busy('steer'));
  await check(claudeRequiredChecks[5], async () => {
    await Promise.all([idle(sender), idle(receiver)]);
    const senderBefore = sender.results().length; const receiverBefore = receiver.results().length;
    const shared = { requestBody: `${marker}_ROUNDTRIP_REQUEST`, replyBody: `${marker}_ROUNDTRIP_REPLY` };
    const outgoing = { ...shared, kind: 'roundtrip-send', start: `${marker}_BEGIN_ROUNDTRIP`, toolId: `cc_send_${runId}` };
    const incoming = { ...shared, kind: 'roundtrip-receive', toolId: `cc_reply_${runId}` };
    stateFor(sender.id).scenario = outgoing; stateFor(receiver.id).scenario = incoming;
    sender.prompt(outgoing.start); await Promise.all([sender.waitResults(senderBefore + 2), receiver.waitResults(receiverBefore + 1)]);
    await Promise.all([idle(sender), idle(receiver)]);
    assert.ok(outgoing.toolIssued && outgoing.replySeen && incoming.incomingSeen && incoming.toolIssued && incoming.reference, 'The native shells must send and reply using the actual envelope route');
    const requestReceipt = nativeToolObject(outgoing.receiptResult); const replyReceipt = nativeToolObject(incoming.receiptResult);
    assert.equal(requestReceipt.status, 'delivered'); assert.equal(replyReceipt.status, 'delivered');
    const request = decodeRef(requestReceipt.replyRef); const reply = decodeRef(replyReceipt.replyRef);
    for (const ref of [request, reply]) {
      assert.equal(ref.f.p, 'claude'); assert.equal(ref.f.id, sender.id); assert.equal(ref.t.p, 'claude'); assert.equal(ref.t.id, receiver.id);
    }
    assert.equal(reply.n, request.n); assert.equal(reply.c, request.c + 1);
    for (const result of [...sender.results().slice(senderBefore), ...receiver.results().slice(receiverBefore)]) successfulResult(result);
    assert.ok(sender.results().slice(senderBefore).some((result) => result.result.includes(`${marker}_REPLY_RECEIVED`)));
    report.roundTrip = { nativeBashCalls: 2, fullNativeIdentities: true, replyHintCopied: true, sameNonce: true, requestTurn: request.c, replyTurn: reply.c };
    stateFor(sender.id).scenario = undefined; stateFor(receiver.id).scenario = undefined;
  });
  await check(claudeRequiredChecks[6], async () => {
    await receiver.stop(); assert.equal(fixture.scan().sessions.some((item) => item.sessionId === receiver.id), false);
    const before = fixture.model.requests.length;
    for (const id of [receiver.id, randomUUID()]) {
      const reference = encodeRef(newConversationRef({ p: 'human' }, { p: 'claude', id, endpointType: 'cli' }));
      const result = await fixture.cli(['send', '--tool', 'claude', '--conversation', reference, '--body', `${marker}_MUST_NOT_ARRIVE`, '--json']);
      assert.notEqual(result.code, 0); assert.equal(result.timedOut, false); assert.equal(result.signal, null);
      assert.ok(result.stderr.includes('TARGET_NOT_FOUND'), 'A complete native reference must fail because that exact session is unavailable');
    }
    const items = await discover(); assert.equal(items.length, 1); assert.equal(items[0].ref.nativeId, sender.id);
    assert.equal(fixture.scan().sessions.length, 1); assert.equal(fixture.model.requests.length, before);
    report.exitBoundary = { oldNativeTargetRejected: true, missingTargetRejected: true, explicitNativeReferences: true, replacementCreated: false, remainingSessions: 1 };
  });
  assert.equal(fixture.model.errors.length, 0); report.status = 'passed'; report.stage = 'done'; report.category = null; delete report.check;
} catch (error) {
  if (['infrastructure', 'compatibility'].includes(error?.category) && ['setup', 'model-fixture', 'contract'].includes(error?.stage)) {
    report.category = error.category; report.stage = error.stage;
  }
  report.error = redact(error instanceof Error ? error.message : String(error));
  if (error?.cleanup) report.cleanup = error.cleanup;
  if (error?.fixtureRoot && error.cleanup?.removed !== true) report.retainedFixtureRoot = error.fixtureRoot;
} finally {
  await Promise.allSettled(barriers.map((barrier) => barrier.release()));
  if (fixture) {
    if (fixture.model.errors.length) { report.status = 'failed'; report.stage = 'model-fixture'; report.category = 'infrastructure'; report.check = 'scripted-model'; report.error = 'The model script failed; upstream compatibility is inconclusive'; }
    report.modelRequestCount = fixture.model.requests.length;
    report.nativeResults = fixture.sessions.map((session) => ({ id: session.id, count: session.results().length, errors: session.results().filter((result) => result.is_error).length }));
    report.stderr = fixture.sessions.map((session) => ({ id: session.id, text: redact(session.logs.stderr).slice(-4000) }));
    try { await fixture.close(); }
    catch (error) { report.status = 'failed'; report.stage = 'cleanup'; report.category = 'infrastructure'; report.check = 'fixture-cleanup'; report.error = redact(error.message); report.retainedFixtureRoot = fixture.root; }
    report.cleanup = fixture.cleanup;
  }
  report.finishedAt = new Date().toISOString(); await mkdir(dirname(reportPath), { recursive: true }); await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: report.status, version: report.version, checks: report.checks.length, check: report.check, report: reportPath })}\n`);
  if (report.status !== 'passed') process.exitCode = 1;
}
