import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Broker } from '../../dist/serve/broker.js';
import { NodeClient } from '../../dist/serve/node.js';
import { FileInbox } from '../../dist/serve/file-channel.js';
import { SenderConn } from '../../dist/serve/via-tcp.js';
import { createTcpSessionOperation } from '../../dist/application/tcp/session-operations.js';
import { DiscoveryService } from '../../dist/application/discovery/index.js';
import { createOpenCodeSessionReader } from '../../dist/application/sessions/opencode-reader.js';
import { createSessionMembershipService } from '../../dist/application/session-membership/index.js';
import { createSessionsResource } from '../../dist/tui/resources/sessions.js';
import { createResourceRegistry, defaultResources } from '../../dist/tui/resources/registry.js';
import { runTui } from '../../dist/tui/main.js';
import { connectAttachPipe, queryAttachStatus } from '../../dist/serve/attach-client.js';
import { attachPipePath } from '../../dist/serve/node.js';
import { createNativeOperationProviders } from '../../dist/application/native-operation-providers.js';
import { listOpenCodeThreads } from '../../dist/opencode/client.js';
import { deliverToOpenCodeSession } from '../../dist/opencode/deliver.js';
import { machineId, normalizeMid } from '../../dist/platform/machine-id.js';
import { launchPty } from './tui-pty-driver.mjs';
import { repositoryRoot } from './opencode-live-fixture.mjs';

const tool = 'opencode';
const endpointType = 'shared';
const brokerMachineId = '66666666777788889999aaaaaaaaaaaa';
const starId = 'opencode-native-validation-star';
const starName = 'opencode-native-validation';

function ptyEnvironment(env, extra = {}) {
  return { ...Object.fromEntries(Object.keys(process.env).map((key) => [key, undefined])), ...env, ...extra };
}

async function waitFor(read, description, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    last = value;
    await delay(40);
  }
  throw new Error(`Timed out waiting for ${description}${last === undefined ? '' : `: ${String(last)}`}`);
}

async function tuiChild() {
  const home = process.env.OPENCODE_NATIVE_TUI_HOME;
  const evidence = process.env.OPENCODE_NATIVE_TUI_EVIDENCE;
  assert(home && evidence, 'Explicit isolated paths are required');
  const discovery = new DiscoveryService([createOpenCodeSessionReader({ home, env: process.env })]);
  const membership = createSessionMembershipService({ baseDir: join(home, '.crosschat'), discovery,
    machineId: () => machineId(), spawnServeDetach: () => { throw new Error('The already-running owned node should handle this TUI operation'); } });
  const sessions = createSessionsResource({ discovery, membership, relatedResources: [] });
  const registry = createResourceRegistry(defaultResources.map((resource) => resource.id === 'sessions' ? sessions.resource : resource));
  const listeners = () => Object.fromEntries(['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'].map((name) => [name, process.listenerCount(name)]));
  const warmup = await import('ink').then(async ({ render, Text }) => {
    const React = await import('react');
    const instance = render(React.createElement(Text, null, 'OpenCode native membership baseline'), { interactive: true, patchConsole: false, exitOnCtrlC: false });
    await instance.waitUntilRenderFlush(); instance.unmount(); await instance.waitUntilExit();
  });
  void warmup;
  const before = { raw: process.stdin.isRaw === true, listeners: listeners(), resize: process.stdout.listenerCount('resize') };
  const code = await runTui({ home, registry, contexts: [{ id: 'local', kind: 'local', label: 'OpenCode native membership', target: home }], adapters: { sessions: sessions.adapter } });
  const after = { raw: process.stdin.isRaw === true, listeners: listeners(), resize: process.stdout.listenerCount('resize') };
  await writeFile(evidence, JSON.stringify({ code, before, after }));
  process.exitCode = code;
}

export async function validateOpenCodeNativeEnhancement({ fixture, session, waitForNativeTitle, evidenceDirectory }) {
  assert(fixture?.root && fixture?.env && fixture?.api && session?.id && typeof waitForNativeTitle === 'function');
  await mkdir(evidenceDirectory, { recursive: true });
  const baseDir = join(fixture.root, '.crosschat');
  const tcpDir = join(baseDir, 'tcp');
  await mkdir(tcpDir, { recursive: true });
  const registryFile = join(tcpDir, 'broker.json');
  const nodeConfigFile = join(tcpDir, 'node.json');
  const key = randomBytes(32).toString('hex');
  const providerEnv = { ...fixture.env, HOME: fixture.root, USERPROFILE: fixture.root };
  const rawMachineId = machineId();
  assert(rawMachineId, 'OS machine identity must be readable for the real TCP node');
  const localMachineId = normalizeMid(rawMachineId);
  const discovery = new DiscoveryService([createOpenCodeSessionReader({ home: fixture.root, env: providerEnv })]);
  const operationProviders = createNativeOperationProviders({ opencode: { home: fixture.root, env: providerEnv } });
  let broker;
  let node;
  let nodeRun;
  let connection;
  let tui;
  const report = { provider: tool, endpointType, nativeId: session.id, starId, operations: [], cleanup: { complete: false } };
  let failure;

  try {
    const initial = await fixture.api(`/api/session/${encodeURIComponent(session.id)}`);
    assert.equal(initial.data.id, session.id);
    report.initialTitle = initial.data.title ?? null;

    const now = new Date().toISOString();
    broker = new Broker({ registryFile, statusFile: join(tcpDir, 'status-broker.json'), machineId: () => brokerMachineId,
      hostname: () => 'opencode-native-broker', version: 'native-validation', now: Date.now, log: () => {}, port: 0,
      deliverLocal: async () => { throw new Error('OpenCode native validation must use the owned node'); } });
    writeFileSyncOwned(registryFile, { stars: [{ starId, name: starName, nodes: [{ label: 'opencode-native-node', key, addedAt: now }], roster: [] }] });
    const port = await broker.start();
    const entry = { host: '127.0.0.1', port, starId, name: starName, key };
    writeFileSyncOwned(nodeConfigFile, { brokers: [entry] });

    node = new NodeClient({ config: { entries: [entry] }, configFile: nodeConfigFile, machineId: () => localMachineId, now: Date.now,
      hostname: () => 'opencode-native-node', networkInterfaces: () => ({}), env: providerEnv, version: 'native-validation',
      stdout: () => {}, onSignal: () => {}, log: () => {}, memberCheckMs: 60000, attachLabel: starName,
      discover: (request, options) => discovery.execute(request, options), operationProviders,
      fileInbox: new FileInbox({ inboxDir: join(baseDir, 'inbox'), partsDir: join(baseDir, 'parts') }),
      makeSendDeps: () => ({ env: providerEnv, now: Date.now, machineId: () => localMachineId,
        listClaudeSessions: () => ({ sessions: [], malformed: 0 }), listCodexThreads: async () => [],
        listOpenCodeThreads: () => listOpenCodeThreads({ home: fixture.root, env: providerEnv }),
        listDshThreads: async () => [],
        deliverClaude: async () => { throw new Error('Unexpected Claude delivery'); },
        deliverCodex: async () => { throw new Error('Unexpected Codex delivery'); },
        deliverOpenCode: (nativeId, body, options) => deliverToOpenCodeSession(nativeId, body, { ...options, home: fixture.root, env: providerEnv }),
        deliverDsh: async () => { throw new Error('Unexpected Harness delivery'); },
        sendLogFile: join(baseDir, 'send-log.jsonl'), outboxDir: join(baseDir, 'outbox') }),
    });
    nodeRun = node.run();
    await node.waitForState('online');
    const attachPipe = await connectAttachPipe(attachPipePath(entry, tcpDir));
    try {
      const status = await queryAttachStatus(attachPipe);
      assert.equal(status?.online, true);
      assert.equal(status?.machine, localMachineId);
    } finally { attachPipe.close(); }

    const tuiEvidence = join(evidenceDirectory, 'membership-tui.json');
    tui = await launchPty({ executable: process.execPath, args: [fileURLToPath(import.meta.url), '--tui-child'], cwd: repositoryRoot,
      columns: 112, rows: 30, env: ptyEnvironment(fixture.env, { OPENCODE_NATIVE_TUI_HOME: fixture.root,
        OPENCODE_NATIVE_TUI_EVIDENCE: tuiEvidence }), logPath: join(evidenceDirectory, 'membership-tui-pty.jsonl') });
    const sendAndWait = async (input, pattern, timeoutMs = 15000) => {
      const start = tui.output.length;
      tui.write(input);
      await tui.waitForOutput(pattern, timeoutMs, start);
    };
    await tui.waitForOutput('OpenCode native membership', 15000);
    await sendAndWait('\r\r', session.name ?? '匿名');
    await sendAndWait(`/${session.id}\r`, '1/1 · 完整');
    await sendAndWait('a', '收编已有会话 · 填写');
    await sendAndWait('\x1b[F\r', '›[取消]');
    await sendAndWait('\t\r', '所选星已确认该完整会话入册');
    const adopted = await waitFor(() => {
      const matches = readBrokerRoster(registryFile, session.id);
      return matches.length === 1 ? matches[0] : undefined;
    }, 'the exact OpenCode session to enter the star roster');
    assert.equal(adopted.machine, localMachineId);
    assert.equal(adopted.tool, tool);
    assert.equal(adopted.endpointType, endpointType);
    await tui.waitForOutput('所选星已确认该完整会话入册', 15000);
    report.operations.push({ name: 'tui-adopt-exact-selected-session', status: 'passed', member: adopted });

    const target = { contextId: 'local', starId, machineId: localMachineId, providerId: tool, nativeId: session.id, endpointType };
    const operate = createTcpSessionOperation({ baseDir, timeoutMs: 15000 });
    const described = await operate(target, { kind: 'describe' });
    assert.equal(described.description?.ref?.nativeId, session.id);
    assert.equal(described.description?.ref?.providerId, tool);
    assert.equal(described.description?.ref?.endpointType, endpointType);
    assert.equal(described.description?.actions.rename.state, 'executable', JSON.stringify(described));
    const newTitle = `CROSSCHAT_OPENCODE_RENAME_${randomBytes(5).toString('hex')}`;
    const renamed = await operate(target, { kind: 'apply', operation: 'rename', expectedRevision: described.description.revision, name: newTitle });
    assert.equal(renamed.result?.kind, 'applied', JSON.stringify(renamed));
    await waitFor(async () => {
      const current = await fixture.api(`/api/session/${encodeURIComponent(session.id)}`);
      return current.data.id === session.id && current.data.title === newTitle ? current.data : undefined;
    }, 'OpenCode 2.1.3 title write and exact native reread');
    const desktopEvidence = await waitForNativeTitle(newTitle);
    const renamedMember = await waitFor(() => {
      const matches = readBrokerRoster(registryFile, session.id);
      return matches.length === 1 && matches[0].name === newTitle ? matches[0] : undefined;
    }, 'the live star roster to receive the native title');
    assert.equal(renamedMember.machine, localMachineId);
    report.operations.push({ name: 'tcp-rename-live-native-title', status: 'passed', title: newTitle, descriptionRevision: described.description.revision,
      result: renamed.result, member: renamedMember, nativeUiRefresh: desktopEvidence ?? true });

    connection = await SenderConn.open(`ws://127.0.0.1:${port}`, key, undefined, 5000);
    const routeMarker = `CROSSCHAT_OPENCODE_RENAMED_ROUTE_${randomBytes(5).toString('hex')}`;
    const requestId = `opencode-renamed-route-${randomBytes(6).toString('hex')}`;
    await connection.send({ op: 'send', id: requestId, targetMachine: `${localMachineId.slice(0, 8)}:${newTitle}`,
      tool, body: routeMarker });
    const receipt = await connection.waitFor((frame) => (frame.op === 'receipt' || frame.op === 'error') && frame.id === requestId, 15000);
    assert.equal(receipt.status, 'delivered', JSON.stringify(receipt));
    await fixture.idle(session.id);
    const transcript = await fixture.transcript(session.id);
    assert.ok(JSON.stringify(transcript).includes(routeMarker), 'Renamed star address must deliver into the original native session');
    const sessions = await fixture.api('/api/session');
    assert.ok(sessions.data.some((item) => item.id === session.id && item.title === newTitle));
    assert.ok(!sessions.data.some((item) => item.title === routeMarker));
    report.operations.push({ name: 'renamed-star-route-delivers-to-same-native-session', status: 'passed', routeMarker, receipt,
      nativeId: session.id, remainingSessionCount: sessions.data.length });

    await sendAndWait('\x04', '删除星册位 · 填写', 15000);
    await sendAndWait('\x1b[F\r', '›[取消]', 15000);
    await sendAndWait('\t\r', '已从所选星精确删除该册位', 15000);
    await waitFor(() => readBrokerRoster(registryFile, session.id).length === 0, 'the exact OpenCode roster entry to be removed');
    await tui.waitForOutput('已从所选星精确删除该册位', 15000);
    const stillNative = await fixture.api(`/api/session/${encodeURIComponent(session.id)}`);
    assert.equal(stillNative.data.id, session.id);
    assert.equal(stillNative.data.title, newTitle);
    report.operations.push({ name: 'tui-removes-roster-with-native-chat-retained', status: 'passed', nativeId: stillNative.data.id, title: stillNative.data.title });

    tui.write('q');
    const exit = await tui.exited;
    assert.deepEqual(exit, { code: 0, hostCode: 0 });
    const terminal = JSON.parse(await readFile(tuiEvidence, 'utf8'));
    assert.deepEqual(terminal.after, terminal.before, 'TUI restores raw input, listeners and resize handler');
    report.tui = { code: exit.code, terminalRestored: true, evidence: tuiEvidence };
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    failure = error instanceof Error ? error : new Error(String(error));
  } finally {
    const cleanup = [];
    try { await tui?.dispose(); } catch (error) { cleanup.push(error); }
    try { connection?.close(); } catch (error) { cleanup.push(error); }
    try { await node?.stop(); } catch (error) { cleanup.push(error); }
    try { await nodeRun; } catch (error) { cleanup.push(error); }
    try { await broker?.stop(); } catch (error) { cleanup.push(error); }
    if (cleanup.length) {
      report.cleanup = { complete: false, errors: cleanup.map((error) => String(error)) };
      failure = new AggregateError(failure ? [failure, ...cleanup] : cleanup, 'OpenCode native enhancement resources did not cleanly stop');
    } else {
      report.cleanup = { complete: true, brokerStopped: true, nodeStopped: true, tuiStopped: true,
        crosschatRoot: baseDir, removedByFixtureOwner: true };
    }
  }
  if (failure) throw Object.assign(failure, { nativeEnhancementReport: report });
  return report;
}

function writeFileSyncOwned(path, value) { writeFileSync(path, JSON.stringify(value), { mode: 0o600 }); }

function readBrokerRoster(registryFile, nativeId) {
  const parsed = JSON.parse(readFileSync(registryFile, 'utf8'));
  return parsed.stars.flatMap((star) => star.roster).filter((member) => member.sessionId === nativeId);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--tui-child')) await tuiChild();
