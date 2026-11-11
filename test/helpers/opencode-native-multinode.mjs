import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createElement } from 'react';
import { render, Text } from 'ink';
import { createTcpApplication } from '../../dist/application/tcp/index.js';
import { createTcpManagement } from '../../dist/application/tcp/management.js';
import { createLocalDiscoveryService } from '../../dist/application/discovery/local.js';
import { createTcpSessionOperation } from '../../dist/application/tcp/session-operations.js';
import { tcpContextId } from '../../dist/application/tcp/reading.js';
import { createResourceRegistry, defaultResources } from '../../dist/tui/resources/registry.js';
import { createTcpResources } from '../../dist/tui/resources/tcp.js';
import { Broker } from '../../dist/serve/broker.js';
import { loadBrokerFile, writeBrokerFile } from '../../dist/serve/registry.js';
import { DiscoveryService } from '../../dist/application/discovery/index.js';
import { FileInbox } from '../../dist/serve/file-channel.js';
import { NodeClient, attachPipePath } from '../../dist/serve/node.js';
import { connectAttachPipe, queryAttachStatus } from '../../dist/serve/attach-client.js';
import { createOpenCodeSessionReader } from '../../dist/application/sessions/opencode-reader.js';
import { createNativeOperationProviders } from '../../dist/application/native-operation-providers.js';
import { listOpenCodeThreads } from '../../dist/opencode/client.js';
import { deliverToOpenCodeSession } from '../../dist/opencode/deliver.js';
import { withLostBrokerReceipt } from './dsh-enhancement-broker-faults.mjs';
import { launchPty } from './tui-pty-driver.mjs';
import { createOpenCodeFixture, repositoryRoot } from './opencode-live-fixture.mjs';
import { textStream } from './opencode-mock-model.mjs';

const stars = [
  { id: `opencode-c22-a-${randomUUID().slice(0, 8)}`, name: `opencode-c22-a-${randomUUID().slice(0, 4)}` },
  { id: `opencode-c22-b-${randomUUID().slice(0, 8)}`, name: `opencode-c22-b-${randomUUID().slice(0, 4)}` },
];
const ansiSequence = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'gu');

function safeEnvironment(env) {
  return { ...Object.fromEntries(Object.keys(process.env).map((key) => [key, undefined])), ...env };
}

async function readEvents(file) {
  try { return (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function waitFor(read, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await delay(40);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function latestActionState(events, shortcut, label) {
  const needle = `<${shortcut}> ${label}`;
  let state;
  for (const [eventIndex, event] of events.entries()) {
    if (event.event !== 'output') continue;
    const output = Buffer.from(event.data, 'base64').toString('utf8')
      .replace(ansiSequence, '');
    for (const line of output.split(/\r?\n/u)) {
      if (line.includes(needle)) state = { enabled: line.includes('<?>') && !line.includes('×'), eventIndex };
    }
  }
  return state;
}

async function within(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), timeoutMs); })]);
  } finally { clearTimeout(timer); }
}

async function tuiChild() {
  const [ownedRoot, configFile, eventsFile] = process.argv.slice(2);
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  assert.equal(await readFile(join(ownedRoot, '.c22-multinode-owner'), 'utf8'), config.owner);
  for (const path of [configFile, eventsFile, config.home]) {
    const absolute = resolve(path);
    const pathWithinRoot = relative(ownedRoot, absolute);
    assert(pathWithinRoot && pathWithinRoot !== '..' && !pathWithinRoot.startsWith('..\\') && !isAbsolute(pathWithinRoot));
  }
  assert.equal(config.task, 'opencode-native-multinode');
  assert(Array.isArray(config.contexts) && config.contexts.length === 1 && config.contexts[0].kind === 'tcp');

  const record = async (value) => writeFile(eventsFile, JSON.stringify(value) + '\n', { flag: 'a' });
  const baseDir = join(config.home, '.crosschat');
  const tcp = createTcpApplication({ baseDir });
  const resources = createTcpResources({ tcp, management: createTcpManagement({ baseDir, catalog: tcp,
    discovery: createLocalDiscoveryService({ home: config.home }) }) });
  const bindings = new Map(Object.values(resources).map((binding) => [binding.resource.id, binding]));
  for (const binding of bindings.values()) {
    const read = binding.adapter.read;
    binding.adapter.read = async (request) => {
      const page = await read(request);
      await record({ event: 'read', resource: binding.resource.id, rows: page.rows.map((row) => ({ id: row.id, name: row.cells.name,
        provider: row.cells.provider, machine: row.cells.machine })), completeness: page.completeness });
      return page;
    };
    if (binding.adapter.checkAction) {
      const checkAction = binding.adapter.checkAction;
      binding.adapter.checkAction = async (request) => {
        const result = await checkAction(request);
        await record({ event: 'preview', action: request.action.id, targetId: request.target?.id,
          operationTarget: request.target?.copyValues?.operationTarget,
          ...(request.action.id === 'rename-session' ? { values: request.values } : {}), result });
        return result;
      };
    }
    if (binding.adapter.mutate) {
      const mutate = binding.adapter.mutate;
      binding.adapter.mutate = async (request) => {
        await record({ event: 'mutation-start', action: request.action.id, targetId: request.target?.id,
          operationTarget: request.target?.copyValues?.operationTarget,
          ...(request.action.id === 'rename-session' ? { values: request.values } : {}) });
        const result = await mutate(request);
        await record({ event: 'mutation', action: request.action.id, targetId: request.target?.id, result });
        return result;
      };
    }
  }

  const warmup = render(createElement(Text, null, 'OpenCode C22 member observer'), { interactive: true, patchConsole: false, exitOnCtrlC: false });
  await warmup.waitUntilRenderFlush(); warmup.unmount(); await warmup.waitUntilExit();
  const state = () => ({ raw: process.stdin.isRaw === true, resize: process.stdout.listenerCount('resize'),
    listeners: Object.fromEntries(['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'].map((name) => [name, process.listenerCount(name)])) });
  const before = state();
  const { runTui } = await import('../../dist/tui/main.js');
  const registry = createResourceRegistry(defaultResources.map((resource) => bindings.get(resource.id)?.resource ?? resource));
  const code = await runTui({ home: config.home, contexts: config.contexts, registry,
    adapters: Object.fromEntries([...bindings].map(([id, binding]) => [id, binding.adapter])) });
  await record({ event: 'exit', code, before, after: state() });
  process.exitCode = code;
}

function nodeEntries(starKeys, role, port) {
  return stars.map((star, index) => ({ host: '127.0.0.1', port, key: starKeys[index][role], name: star.name, starId: star.id }));
}

function roster(registryFile, starId) {
  return loadBrokerFile(registryFile).stars.find((star) => star.starId === starId)?.roster ?? [];
}

export async function validateOpenCodeNativeMultinode({ binary, fixture, session, evidenceDirectory }) {
  assert(binary && fixture?.root && fixture?.env && fixture?.api && session?.id);
  await mkdir(evidenceDirectory, { recursive: true });
  const evidence = resolve(evidenceDirectory);
  const owner = randomUUID();
  const root = join(fixture.root, '.crosschat-opencode-c22');
  const tcpDir = join(root, 'tcp');
  await mkdir(tcpDir, { recursive: true });
  await writeFile(join(root, '.c22-multinode-owner'), owner);

  let secondFixture;
  let broker;
  const nodes = [];
  const terminals = [];
  const pipes = [];
  let failure;
  const report = { scope: 'Two same-host OpenCode services and logical nodes; two isolated operator HOME/TUI instances; not physical cross-machine acceptance',
    starIds: stars.map((star) => star.id), checks: [], cleanup: { complete: false } };
  const check = async (name, action) => { await action(); report.checks.push({ name, status: 'passed' }); };
  try {
    secondFixture = await createOpenCodeFixture(binary, () => textStream('OPENCODE_C22_SECOND_NODE_ACK'));
    const currentSession = await fixture.api(`/api/session/${encodeURIComponent(session.id)}`);
    assert.equal(currentSession.data.id, session.id);
    const nativeSessions = [currentSession.data, await secondFixture.createSession('C22Second')];
    const fixtures = [fixture, secondFixture];
    const machineIds = ['11111111222222223333333344444444', '55555555666666667777777788888888'];
    const starKeys = stars.map(() => Array.from({ length: 4 }, () => randomBytes(32).toString('hex')));
    const registryFile = join(tcpDir, 'broker.json');
    const now = new Date().toISOString();
    writeBrokerFile(registryFile, { stars: stars.map((star, index) => ({ starId: star.id, name: star.name,
      nodes: starKeys[index].map((key, role) => ({ label: `opencode-c22-role-${role}`, key, addedAt: now })), roster: [] })) });
    broker = new Broker({ registryFile, statusFile: join(tcpDir, 'status-broker.json'), listenHost: '127.0.0.1', machineId: () => '99999999aaaaaaaa99999999aaaaaaaa',
      hostname: () => 'opencode-c22-broker', version: 'native-multinode-validation', now: Date.now, log: () => {}, port: 0,
      deliverLocal: async () => { throw new Error('OpenCode native C22 must use an owned node'); } });
    const port = await broker.start();
    const entriesFor = (role) => nodeEntries(starKeys, role, port);

    const startNode = async (index) => {
      const nativeFixture = fixtures[index];
      const directory = join(tcpDir, `node-${index}`);
      await mkdir(directory, { recursive: true });
      const configFile = join(directory, 'node.json');
      const entries = entriesFor(index);
      await writeFile(configFile, JSON.stringify({ brokers: entries }));
      const env = { ...nativeFixture.env, HOME: nativeFixture.root, USERPROFILE: nativeFixture.root };
      const discovery = new DiscoveryService([
        createOpenCodeSessionReader({ home: nativeFixture.root, env }),
      ]);
      const operationProviders = createNativeOperationProviders({ opencode: { home: nativeFixture.root, env } });
      const attachLabel = `oc22-${index}-${randomUUID().slice(0, 8)}`;
      const node = new NodeClient({ config: { entries }, configFile, machineId: () => machineIds[index], now: Date.now,
        hostname: () => `opencode-c22-node-${index}`, networkInterfaces: () => ({}), env, version: 'native-multinode-validation',
        stdout: () => {}, onSignal: () => {}, log: () => {}, memberCheckMs: 60000, attachLabel,
        discover: (request, options) => discovery.execute(request, options), operationProviders,
        fileInbox: new FileInbox({ inboxDir: join(directory, 'inbox'), partsDir: join(directory, 'parts') }),
        makeSendDeps: () => ({ env, now: Date.now, machineId: () => machineIds[index],
          listClaudeSessions: () => ({ sessions: [], malformed: 0 }), listCodexThreads: async () => [],
          listOpenCodeThreads: () => listOpenCodeThreads({ home: nativeFixture.root, env }), listDshThreads: async () => [],
          deliverClaude: async () => { throw new Error('Unexpected Claude delivery'); }, deliverCodex: async () => { throw new Error('Unexpected Codex delivery'); },
          deliverOpenCode: (nativeId, body, options) => deliverToOpenCodeSession(nativeId, body, { ...options, home: nativeFixture.root, env }),
          deliverDsh: async () => { throw new Error('Unexpected Harness delivery'); }, sendLogFile: join(directory, 'send-log.jsonl'), outboxDir: join(directory, 'outbox') }),
      });
      const running = node.run();
      const state = { node, running, configFile, directory, entries, attachLabel, machineId: machineIds[index], fixture: nativeFixture, native: nativeSessions[index] };
      nodes.push(state);
      await node.waitForState('online');
      const pipe = await connectAttachPipe(attachPipePath(entries[0], directory, attachLabel));
      pipes.push(pipe);
      const status = await queryAttachStatus(pipe);
      assert.equal(status?.online, true);
      assert.equal(status?.machine, machineIds[index]);
      return state;
    };
    for (let index = 0; index < fixtures.length; index += 1) await startNode(index);

    const operatorHomes = [join(root, 'operator-a'), join(root, 'operator-b')];
    const operators = [];
    for (let index = 0; index < operatorHomes.length; index += 1) {
      const home = operatorHomes[index];
      const operatorTcp = join(home, '.crosschat', 'tcp');
      await mkdir(operatorTcp, { recursive: true });
      const entries = entriesFor(index + 2);
      await writeFile(join(operatorTcp, 'node.json'), JSON.stringify({ brokers: entries }));
      operators.push({ home, entries, operate: createTcpSessionOperation({ baseDir: join(home, '.crosschat'), timeoutMs: 15000 }) });
    }
    const target = (nodeIndex, starId = stars[0].id) => ({ contextId: 'local', starId, machineId: machineIds[nodeIndex],
      providerId: 'opencode', nativeId: nativeSessions[nodeIndex].id, endpointType: 'shared' });
    const describe = async (nodeIndex, operatorIndex, starId = stars[0].id) => (await operators[operatorIndex].operate(target(nodeIndex, starId), { kind: 'describe' })).description;
    const operate = async (nodeIndex, operatorIndex, starId, operation, extra = {}) => {
      const description = await describe(nodeIndex, operatorIndex, starId);
      const available = description.actions[operation];
      assert.equal(available.state, 'executable', JSON.stringify(available));
      return operators[operatorIndex].operate(target(nodeIndex, starId), { kind: 'apply', operation,
        expectedRevision: description.revision, ...extra });
    };
    const expectedMember = (nodeIndex, starId = stars[0].id) => roster(registryFile, starId).find((member) => member.machine === machineIds[nodeIndex]
      && member.sessionId === nativeSessions[nodeIndex].id && member.tool === 'opencode' && member.endpointType === 'shared');

    for (let index = 0; index < operatorHomes.length; index += 1) {
      const input = join(root, `operator-${index}.json`);
      const events = join(root, `operator-${index}-events.jsonl`);
      const contextEntry = operators[index].entries[0];
      await writeFile(input, JSON.stringify({ task: 'opencode-native-multinode', owner, home: operators[index].home,
        contexts: [{ id: tcpContextId(contextEntry), kind: 'tcp', label: `OpenCode C22 operator ${index}` }] }));
      const pty = await launchPty({ executable: process.execPath,
        args: [fileURLToPath(import.meta.url), root, input, events, '--tui-child'], cwd: repositoryRoot, columns: 140, rows: 36,
        env: safeEnvironment({ ...fixture.env, HOME: operators[index].home, USERPROFILE: operators[index].home,
          APPDATA: join(operators[index].home, 'appdata'), LOCALAPPDATA: join(operators[index].home, 'localappdata') }),
        logPath: join(evidence, `operator-${index}-pty.jsonl`) });
      terminals.push({ pty, events, index });
      await pty.waitForOutput(`OpenCode C22 operator ${index}`);
      let mark = pty.output.length;
      pty.write(':stars\r');
      await pty.waitForOutput(stars[0].name, 10000, mark);
      mark = pty.output.length;
      pty.write(`/${stars[0].id}\r`);
      await pty.waitForOutput(/1\/1/u, 10000, mark);
      mark = pty.output.length;
      pty.write('\r');
      await pty.waitForOutput('按在线 / 下线分组', 10000, mark);
      await waitFor(async () => (await readEvents(events)).some((event) => event.event === 'read' && event.resource === 'members'), 'members resource read');
    }

    const observeBoth = async (names) => Promise.all(terminals.map(async (terminal) => {
      const offset = (await readEvents(terminal.events)).length;
      await waitFor(async () => (await readEvents(terminal.events)).slice(offset).some((event) => event.event === 'read' && event.resource === 'members'
        && names.every((name) => event.rows.some((row) => row.name === name))), `operator ${terminal.index} refresh for ${names.join(', ')}`);
      for (const name of names) await terminal.pty.waitForOutput(name, 10000);
    }));

    await check('two-independent-node-identities-and-exact-operation-routing', async () => {
      assert.notEqual(nodes[0].machineId, nodes[1].machineId);
      assert.notEqual(nodes[0].fixture.pid, nodes[1].fixture.pid);
      for (let index = 0; index < nodes.length; index += 1) {
        const description = await describe(index, 0);
        assert.equal(description.ref.nativeId, nativeSessions[index].id);
        assert.equal(description.ref.endpointType, 'shared');
        assert.equal(description.actions.rename.state, 'executable');
      }
      const wrong = await operators[0].operate(target(1, stars[0].id), { kind: 'describe' });
      assert.equal(wrong.description.actions.adopt.state, 'executable');
      assert.notEqual(wrong.description.ref.nativeId, nativeSessions[0].id);
      assert.equal(roster(join(tcpDir, 'broker.json'), stars[0].id).length, 0);
    });

    await check('two-operator-tui-refreshes-and-star-isolation', async () => {
      for (let index = 0; index < nodes.length; index += 1) {
        const result = await operate(index, index, stars[0].id, 'adopt');
        assert.equal(result.result.kind, 'applied', JSON.stringify(result.result));
      }
      await waitFor(() => nodes.every((node, index) => expectedMember(index)?.name === nativeSessions[index].title), 'both exact roster members');
      await observeBoth(nativeSessions.map((native) => native.title));
      assert.equal(roster(registryFile, stars[1].id).length, 0);
      const renamed = `OpenCodeC22${randomBytes(4).toString('hex')}`;
      const result = await operate(0, 1, stars[0].id, 'rename', { name: renamed });
      assert.equal(result.result.kind, 'applied', JSON.stringify(result.result));
      await waitFor(() => expectedMember(0)?.name === renamed, 'authoritative renamed member');
      await observeBoth([renamed, nativeSessions[1].title]);
      const native = await fixture.api(`/api/session/${encodeURIComponent(nativeSessions[0].id)}`);
      assert.equal(native.data.title, renamed);
      report.renamed = renamed;
      report.operations = { nodeMachineIds: machineIds, nodeServicePids: fixtures.map((item) => item.pid), nativeIds: nativeSessions.map((item) => item.id),
        starId: stars[0].id, observers: terminals.length, exactMembers: nodes.map((node) => expectedMember(nodes.indexOf(node))),
        secondStarRosterCount: roster(registryFile, stars[1].id).length };
    });
    await check('broker-committed-rename-lost-receipt-is-uncertain-and-readonly-recovery-does-not-replay', async () => {
      const nativeId = nativeSessions[1].id;
      const name = `OpenCodeC22Lost${randomBytes(4).toString('hex')}`;
      const faultHome = join(root, 'operator-fault');
      const faultTcp = join(faultHome, '.crosschat', 'tcp');
      await mkdir(faultTcp, { recursive: true });
      await copyFile(join(operators[0].home, '.crosschat', 'tcp', 'node.json'), join(faultTcp, 'node.json'));
      const baseDir = join(faultHome, '.crosschat');
      const originalFetch = globalThis.fetch;
      let nativeTitlePatches = 0;
      globalThis.fetch = async (input, init = {}) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const method = (init.method ?? input.method ?? 'GET').toUpperCase();
        if (method === 'PATCH' && typeof url === 'string' && url.startsWith(secondFixture.info.url) && url.includes(encodeURIComponent(nativeId))) nativeTitlePatches++;
        return originalFetch(input, init);
      };
      try {
        report.brokerReceiptFault = await withLostBrokerReceipt({ home: faultHome, starId: stars[0].id, expectedPort: port, target: target(1), name }, async (fault) => {
          const catalog = createTcpApplication({ baseDir });
          const management = createTcpManagement({ baseDir, catalog, operateSession: createTcpSessionOperation({ baseDir, timeoutMs: 10000 }) });
          const proxyConfig = JSON.parse(await readFile(join(baseDir, 'tcp', 'node.json'), 'utf8'));
          const contextEntry = proxyConfig.brokers.find((entry) => entry.starId === stars[0].id);
          assert(contextEntry);
          const request = { contextId: tcpContextId(contextEntry), starId: stars[0].id, action: 'rename-session',
            sessionTarget: { machineId: machineIds[1], providerId: 'opencode', nativeId, endpointType: 'shared' }, values: { name } };
          const preview = await management.preview(request);
          assert.equal(preview.enabled, true, JSON.stringify(preview));
          const result = await management.apply({ ...request, expectedPreviewRevision: preview.revision });
          assert.equal(result.kind, 'uncertain', JSON.stringify(result));
          assert.equal(fault.state.requests, 1);
          assert.equal(fault.state.acceptedReceipts, 1);
          assert.equal(fault.state.droppedReceipts, 1);
          assert.equal(fault.state.correlations.length, 1);
          await waitFor(() => expectedMember(1)?.name === name, 'broker committed exact renamed member');
          const native = await secondFixture.api(`/api/session/${encodeURIComponent(nativeId)}`);
          assert.equal(native.data.title, name);
          await observeBoth([report.renamed, name]);
          fault.recover();
          const recovered = await management.preview(request);
          assert.equal(recovered.enabled, true, JSON.stringify(recovered));
          assert.equal((await secondFixture.api(`/api/session/${encodeURIComponent(nativeId)}`)).data.title, name);
          await delay(250);
          assert.equal(fault.state.requests, 1, 'read-only recovery must not replay the rename');
          assert.equal(nativeTitlePatches, 1, 'the exact native title endpoint must be written once');
          fault.state.operation = { nativeId, machineId: machineIds[1], name, result: result.kind,
            nativeTitlePatches, readonlyRecovery: recovered.enabled, observedByOperators: terminals.length };
          fault.state.status = 'passed';
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
      assert.equal(report.brokerReceiptFault.configRestored, true);
      assert.equal(report.brokerReceiptFault.proxyClosed, true);
    });
    await check('offline-confirmation-is-rejected-and-recovery-does-not-submit-the-held-form', async () => {
      const terminal = terminals[0];
      const pty = terminal.pty;
      const nativeId = nativeSessions[0].id;
      let mark = pty.output.length;
      const actionOutputMark = pty.events.length;
      pty.write(`/${nativeId}\r`);
      await pty.waitForOutput(/1\/1/u, 10000, mark);
      const actionState = await waitFor(() => {
        const state = latestActionState(pty.events.slice(actionOutputMark), 'e', '原生改名');
        return state?.enabled ? state : undefined;
      }, 'TUI to enable rename for the selected native member');
      report.actionAvailability = { shortcut: 'e', enabled: true, observedSelectedTuiOutputEvent: actionState.eventIndex };
      let eventMark = (await readEvents(terminal.events)).length;
      mark = pty.output.length;
      pty.write('e');
      await pty.waitForOutput('原生会话新名称', 10000, mark);
      await waitFor(async () => (await readEvents(terminal.events)).slice(eventMark).some((event) => event.event === 'preview'
        && event.action === 'rename-session' && event.result?.enabled === true), 'enabled rename confirmation');
      const unpublishedName = `OpenCodeC22Blocked${randomBytes(3).toString('hex')}`;
      pty.write(unpublishedName);
      await nodes[0].node.stop();
      await nodes[0].running;
      nodes.splice(0, 1);
      eventMark = (await readEvents(terminal.events)).length;
      pty.write('\t\t\r');
      const offlinePreview = await waitFor(async () => (await readEvents(terminal.events)).slice(eventMark).find((event) => event.event === 'preview'
        && event.action === 'rename-session' && event.result?.enabled === false), 'fresh preview to reject the offline node');
      assert.equal(JSON.parse(offlinePreview.operationTarget).nativeId, nativeId);
      assert(!(await readEvents(terminal.events)).slice(eventMark).some((event) => event.event === 'mutation-start'), 'offline target must not issue a write');
      report.offlineConfirmation = { nativeId, enabled: offlinePreview.result.enabled, reason: offlinePreview.result.reason,
        blockedName: unpublishedName, noMutationStarted: true };
      report.recoveryStage = 'offline-confirmation-rejected';
      const unchanged = await fixtures[0].api(`/api/session/${encodeURIComponent(nativeId)}`);
      assert.equal(unchanged.data.title, report.renamed);

      report.recoveryStage = 'restarting-node';
      await startNode(0);
      report.recoveryStage = 'node-reconnected';
      await waitFor(async () => (await describe(0, 0)).actions.rename.state === 'executable', 'readonly action recovery after node reconnect');
      report.recoveryStage = 'readonly-action-recovered';
      await delay(250);
      const recovered = await fixtures[0].api(`/api/session/${encodeURIComponent(nativeId)}`);
      assert.equal(recovered.data.title, report.renamed, 'recovery must not submit the old form');
      assert(!(await readEvents(terminal.events)).slice(eventMark).some((event) => event.event === 'mutation-start'));
      mark = pty.output.length;
      pty.write('\x1b');
      await pty.waitForOutput('已取消操作', 10000, mark);
      report.recoveryStage = 'complete';
      report.recovery = { nativeId, machineId: machineIds[0], blockedName: unpublishedName,
        lastConfirmedTitleRetained: recovered.data.title, noMutationStarted: true, actionRecovered: true };
    });
    report.status = 'passed';
  } catch (error) {
    failure = error;
    report.status = 'failed';
    report.error = error instanceof Error ? error.message : String(error);
  } finally {
    const cleanupErrors = [];
    for (const terminal of terminals) {
      try {
        terminal.pty.write('\x1b');
        await delay(100);
        terminal.pty.write('q');
        assert.deepEqual(await within(terminal.pty.exited, 8000, `operator ${terminal.index} TUI exit timeout`), { code: 0, hostCode: 0 });
        const exit = (await readEvents(terminal.events)).find((event) => event.event === 'exit');
        assert(exit);
        assert.deepEqual(exit.after, exit.before);
        terminal.exit = exit;
        await terminal.pty.dispose();
      } catch (error) { cleanupErrors.push(error); try { await terminal.pty.dispose(); } catch (disposeError) { cleanupErrors.push(disposeError); } }
      try { await copyFile(terminal.events, join(evidence, `operator-${terminal.index}-events.jsonl`)); } catch (error) { cleanupErrors.push(error); }
    }
    for (const pipe of pipes) { try { pipe.close(); } catch (error) { cleanupErrors.push(error); } }
    for (const node of nodes) {
      try { await node.node.stop(); await node.running; }
      catch (error) { cleanupErrors.push(error); }
    }
    try { await broker?.stop(); } catch (error) { cleanupErrors.push(error); }
    try { await secondFixture?.close(); } catch (error) { cleanupErrors.push(error); }
    report.operators = terminals.map((terminal) => ({ index: terminal.index, exit: terminal.exit }));
    report.cleanup = { complete: cleanupErrors.length === 0, errors: cleanupErrors.map(String), secondProfileRemoved: secondFixture !== undefined };
    if (cleanupErrors.length) {
      report.status = 'failed';
      report.cleanup.complete = false;
      report.cleanupErrors = cleanupErrors.map(String);
    }
    await writeFile(join(evidence, 'multinode-report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  if (failure) throw Object.assign(failure, { nativeMultinodeReport: report });
  assert.equal(report.cleanup.complete, true, JSON.stringify(report.cleanup));
  return report;
}

if (process.argv.includes('--tui-child')) await tuiChild();
