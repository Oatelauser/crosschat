// Local native enhancement probe; official runtime is installed separately in an owned root.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { createLocalDiscoveryService } from '../../dist/application/discovery/local.js';
import { createNativeOperationProviders } from '../../dist/application/native-operation-providers.js';
import { createTcpSessionOperation } from '../../dist/application/tcp/session-operations.js';
import { Broker } from '../../dist/serve/broker.js';
import { NodeClient } from '../../dist/serve/node.js';
import { FileInbox } from '../../dist/serve/file-channel.js';
import { loadBrokerFile, writeBrokerFile } from '../../dist/serve/registry.js';
import { requestMemberRemoveExact, SenderConn } from '../../dist/serve/via-tcp.js';
import { listDshThreads } from '../../dist/dsh/client.js';
import { createDshFixture, pollDsh } from './dsh-live-fixture.mjs';
import { launchPty } from './tui-pty-driver.mjs';

assert.equal(process.env.CROSSCHAT_LIVE, '1');
const reportPath = resolve(process.env.DSH_NATIVE_REPORT), runId = randomUUID();
const report = { schema: 1, scope: 'DSH npm/Web local native manual membership and source recovery; no Desktop or rename acceptance',
  runId, platform: process.platform, arch: process.arch, node: process.version, checks: [], status: 'failed' };
let fixture, broker, pty, terminalApplicationFile;
const redact = (value) => {
  const text = fixture?.info?.token ? value.replaceAll(fixture.info.token, '[fixture-token-redacted]') : value;
  return text.replace(/([?&]token=)[^&\s"'\\]+/g, '$1[fixture-token-redacted]');
};
const nodes = [], sockets = [];
const check = async (name, work) => { await work(); report.checks.push({ name, status: 'passed' }); process.stdout.write(name + '\n'); };
try {
  fixture = await createDshFixture({ runtime: process.env.DSH_RUNTIME_DIR, parentRoot: process.env.DSH_TASK_ROOT }, () => { throw new Error('Membership must not call the model'); });
  report.version = fixture.info.version; assert.equal(report.version, process.env.DSH_EXPECTED_VERSION);
  const native = await fixture.createSession(`C24-${runId.slice(0, 8)}`), before = await fixture.snapshot(native.id);
  report.nativeId = native.id; report.pid = fixture.pid;
  const baseDir = join(fixture.env.HOME, '.crosschat'), tcpDir = join(baseDir, 'tcp'); await mkdir(tcpDir, { recursive: true });
  const registryFile = join(tcpDir, 'broker.json'), machineId = '1'.repeat(32);
  const stars = ['native-a', 'native-b'].map((starId) => ({ starId, name: starId,
    nodes: [{ label: 'owned-node', key: randomBytes(32).toString('hex'), addedAt: new Date().toISOString() }], roster: [] }));
  writeBrokerFile(registryFile, { stars });
  broker = new Broker({ registryFile, statusFile: join(tcpDir, 'status-broker.json'), port: 0, version: 'c24-native-probe',
    machineId: () => '2'.repeat(32), hostname: () => 'owned-loopback', now: Date.now, log: () => {}, heartbeatMs: 60000,
    deliverLocal: async () => { throw new Error('Membership must not send a message'); } });
  const port = await broker.start();
  await writeFile(registryFile, JSON.stringify({ ...loadBrokerFile(registryFile), port }));
  const entries = stars.map((star) => ({ host: '127.0.0.1', port, key: star.nodes[0].key, name: star.name, starId: star.starId }));
  const configFile = join(tcpDir, 'node.json'); await writeFile(configFile, JSON.stringify({ brokers: entries }));
  const discovery = createLocalDiscoveryService({ home: fixture.env.HOME });
  for (const entry of entries) {
    const node = new NodeClient({ config: { entries: [entry] }, configFile, machineId: () => machineId, now: Date.now, log: () => {}, memberCheckMs: 60000,
      codexHome: join(fixture.env.HOME, '.codex'), fileInbox: new FileInbox({ inboxDir: join(baseDir, 'inbox'), partsDir: join(baseDir, 'parts') }),
      discover: (request, context) => discovery.execute(request, context), operationProviders: createNativeOperationProviders({ dsh: { home: fixture.env.HOME } }),
      makeSendDeps: () => ({ env: fixture.env, listClaudeSessions: () => ({ sessions: [], malformed: 0 }), listCodexThreads: async () => [],
        listDshThreads: () => listDshThreads({ home: fixture.env.HOME }), deliverClaude: async () => { throw new Error('No Claude'); },
        deliverCodex: async () => { throw new Error('No Codex'); }, sendLogFile: join(baseDir, 'send-log.jsonl'), outboxDir: join(baseDir, 'outbox'), now: Date.now }),
    });
    const state = { node, failure: undefined }; nodes.push(state);
    state.running = node.run().catch((error) => { state.failure = error; }); await node.waitForState('online');
  }
  const operate = createTcpSessionOperation({ baseDir, timeoutMs: 10000 });
  const target = (starId, endpointType = 'host') => ({ contextId: 'local', starId, machineId, providerId: 'dsh', nativeId: native.id, endpointType });
  const roster = (starId) => loadBrokerFile(registryFile).stars.find((star) => star.starId === starId).roster;
  const describe = async (starId = 'native-a', endpointType = 'host') => (await operate(target(starId, endpointType), { kind: 'describe' })).description;
  const adopt = (starId, revision) => operate(target(starId), { kind: 'apply', operation: 'adopt', expectedRevision: revision });
  let original;
  await check('authenticated-source-and-readonly-description', async () => {
    original = await describe(); assert.equal(original.actions.adopt.state, 'executable'); assert.notEqual(original.actions.rename.state, 'executable');
    assert.deepEqual(roster('native-a'), []); assert.deepEqual(roster('native-b'), []);
    assert.equal((await describe('native-a', 'desktop')).actions.adopt.state, 'unavailable');
  });
  await check('exact-manual-adoption-and-independent-stars', async () => {
    for (const star of stars) {
      const description = await describe(star.starId); assert.equal((await adopt(star.starId, description.revision)).result.kind, 'applied');
      await pollDsh(async () => roster(star.starId).length === 1, 'authoritative exact native roster');
      const member = roster(star.starId)[0]; assert.equal(member.sessionId, native.id); assert.equal(member.tool, 'dsh');
      assert.equal(member.endpointType, 'host'); assert.equal(member.name, native.title); assert.notEqual(member.temporary, true);
    }
  });
  await check('exact-removal-is-independent-of-native-capability', async () => {
    const conn = await SenderConn.open(`ws://127.0.0.1:${port}`, entries[0].key, undefined, 10000); sockets.push(conn);
    const receipt = await requestMemberRemoveExact(conn, { sessionId: native.id, machine: machineId, tool: 'dsh', endpointType: 'host' }, 10000);
    assert.equal(receipt.ok, true); await pollDsh(async () => roster('native-a').length === 0, 'selected star removal'); assert.equal(roster('native-b').length, 1);
  });
  await check('bridge-loss-rejects-old-confirmation-without-claim', async () => {
    await fixture.controller('/bridge', { enabled: false });
    assert.equal((await describe()).actions.adopt.state, 'unavailable');
    assert.equal((await adopt('native-a', original.revision)).result.kind, 'rejected'); assert.equal(roster('native-a').length, 0);
    assert.equal((await fixture.snapshot(native.id)).sameAgent, true);
  });
  await check('native-source-recovery-requires-new-confirmation', async () => {
    await fixture.controller('/bridge', { enabled: true });
    const recovered = await pollDsh(async () => { const value = await describe(); return value.actions.adopt.state === 'executable' && value; }, 'native bridge recovery');
    assert.notEqual(recovered.revision, original.revision);
    assert.equal((await adopt('native-a', original.revision)).result.kind, 'rejected'); assert.equal(roster('native-a').length, 0);
    assert.equal((await adopt('native-a', recovered.revision)).result.kind, 'applied');
    await pollDsh(async () => roster('native-a').length === 1, 'fresh-confirmation roster');
    report.confirmations = { original, recovered };
  });
  await check('unverified-rename-remains-disabled-and-chat-is-unchanged', async () => {
    const description = await describe();
    const result = await operate(target('native-a'), { kind: 'apply', operation: 'rename', name: 'must-not-rename', expectedRevision: description.revision });
    assert.equal(result.result.kind, 'rejected');
    const after = await fixture.snapshot(native.id); assert.equal(after.sameAgent, true); assert.deepEqual(after.events, before.events);
    assert.equal(fixture.model.requests.length, 0); report.rosters = stars.map((star) => ({ starId: star.starId, members: roster(star.starId) }));
  });
  await check('real-terminal-cancel-confirm-exact-membership-and-restoration', async () => {
    const conn = await SenderConn.open(`ws://127.0.0.1:${port}`, entries[0].key, undefined, 10000); sockets.push(conn);
    assert.equal((await requestMemberRemoveExact(conn, { sessionId: native.id, machine: machineId, tool: 'dsh', endpointType: 'host' })).ok, true);
    await pollDsh(async () => roster('native-a').length === 0, 'empty selected star before keyboard adoption');
    const input = join(fixture.root, 'terminal-input.json'), eventsPath = join(fixture.root, 'terminal-events.jsonl');
    terminalApplicationFile = eventsPath;
    await writeFile(input, JSON.stringify({ home: fixture.env.HOME, owner: await readFile(join(fixture.root, '.fixture-owner'), 'utf8') }));
    const events = async () => { try { return (await readFile(eventsPath, 'utf8')).trim().split('\n').filter(Boolean).map((s) => JSON.parse(s)); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } };
    const event = (predicate, after = 0) => pollDsh(async () => (await events()).slice(after).find(predicate), 'native membership terminal event', 10000);
    const terminalLog = join(dirname(reportPath), `terminal-${runId}.jsonl`);
    pty = await launchPty({ executable: process.execPath, args: [fileURLToPath(new URL('./dsh-native-members-pty.mjs', import.meta.url)), fixture.root, input, eventsPath],
      env: fixture.env, columns: 140, rows: 36, logPath: terminalLog });
    const send = async (keys, expected) => { const mark = pty.output.length; pty.write(keys); if (expected) await pty.waitForOutput(expected, 10000, mark); };
    await pty.waitForOutput('C18-NATIVE-MEMBERS'); await send(':stars\r', 'native-a'); await send('/native-a\r', /1\/1/);
    await send('\r', '按在线 / 下线分组'); await send('a', native.title);
    await event((entry) => entry.event === 'availability' && entry.result['adopt-session']?.enabled);
    await send('a', '确认提交');
    const afterCancel = (await events()).length;
    await send('\r', '已取消操作'); assert.equal(roster('native-a').length, 0);
    assert(!(await events()).some((entry) => entry.event === 'mutation'));
    await event((entry) => entry.event === 'availability' && entry.result['adopt-session']?.enabled, afterCancel);
    await send('a', '确认提交'); await send('\t\r'); await event((entry) => entry.event === 'mutation' && entry.action === 'adopt-session');
    await pollDsh(async () => roster('native-a').length === 1, 'keyboard-adopted exact native roster');
    assert.equal(roster('native-a')[0].sessionId, native.id); assert.equal(roster('native-a')[0].endpointType, 'host'); assert.equal(roster('native-b').length, 1);
    let mark = pty.output.length; pty.resize(48, 16); await pty.waitForOutput('CC · 工作区', 10000, mark);
    mark = pty.output.length; pty.resize(140, 36); await pty.waitForOutput('CC · 工作区', 10000, mark);
    await send('q'); assert.deepEqual(await pty.exited, { code: 0, hostCode: 0 });
    const exited = await event((entry) => entry.event === 'exit'); assert.deepEqual(exited.after, exited.before);
    const terminalEvents = join(dirname(reportPath), `terminal-application-${runId}.jsonl`); await copyFile(eventsPath, terminalEvents);
    report.terminal = { kind: process.platform === 'win32' ? 'ConPTY' : 'POSIX PTY', terminalLog, terminalEvents, exit: exited };
    await pty.dispose(); pty = undefined;
    assert.equal((await fixture.snapshot(native.id)).sameAgent, true); assert.deepEqual((await fixture.snapshot(native.id)).events, before.events);
  });
  report.status = 'passed';
} catch (error) {
  report.error = { name: error.name, message: error.message, stack: error.stack };
} finally {
  const failures = [];
  try { await pty?.dispose(); } catch (error) { failures.push(error.message); }
  if (terminalApplicationFile && !report.terminal) {
    try {
      const saved = join(dirname(reportPath), `terminal-failed-application-${runId}.jsonl`);
      await copyFile(terminalApplicationFile, saved); report.failedTerminalApplication = saved;
    } catch (error) { failures.push('Terminal evidence: ' + error.message); }
  }
  for (const socket of sockets) try { socket.close(); } catch (error) { failures.push(error.message); }
  for (const state of nodes.reverse()) {
    try { await state.node.stop(); await state.running; } catch (error) { failures.push(error.message); }
    if (state.failure) failures.push(state.failure.message);
  }
  try { await broker?.stop(); } catch (error) { failures.push(error.message); }
  if (fixture) {
    report.nativeLogs = { stdout: redact(fixture.logs.stdout), stderr: redact(fixture.logs.stderr) };
    try { await fixture.close(); } catch (error) { failures.push(error.message); }
    report.cleanup = fixture.cleanup;
  }
  if (failures.length) { report.status = 'failed'; report.cleanupFailures = failures; }
  await writeFile(reportPath, redact(JSON.stringify(report, null, 2)) + '\n');
}
assert.equal(report.status, 'passed', report.error?.message ?? report.cleanupFailures?.join('; '));
