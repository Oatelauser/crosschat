// Local native enhancement probe; official runtime is installed separately in an owned root.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
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

assert.equal(process.env.CROSSCHAT_LIVE, '1');
const reportPath = resolve(process.env.DSH_NATIVE_REPORT), runId = randomUUID();
const report = { schema: 1, scope: 'DSH npm/Web local native manual membership and source recovery; no Desktop or rename acceptance',
  runId, platform: process.platform, arch: process.arch, node: process.version, checks: [], status: 'failed' };
let fixture, broker;
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
  report.status = 'passed';
} catch (error) {
  report.error = { name: error.name, message: error.message, stack: error.stack };
} finally {
  const failures = [];
  for (const socket of sockets) try { socket.close(); } catch (error) { failures.push(error.message); }
  for (const state of nodes.reverse()) {
    try { await state.node.stop(); await state.running; } catch (error) { failures.push(error.message); }
    if (state.failure) failures.push(state.failure.message);
  }
  try { await broker?.stop(); } catch (error) { failures.push(error.message); }
  if (fixture) {
    const redact = (s) => s.replace(/([a-f0-9]{64})/gi, '<redacted-64hex>');
    report.nativeLogs = { stdout: redact(fixture.logs.stdout), stderr: redact(fixture.logs.stderr) };
    try { await fixture.close(); } catch (error) { failures.push(error.message); }
    report.cleanup = fixture.cleanup;
  }
  if (failures.length) { report.status = 'failed'; report.cleanupFailures = failures; }
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
}
assert.equal(report.status, 'passed', report.error?.message ?? report.cleanupFailures?.join('; '));
