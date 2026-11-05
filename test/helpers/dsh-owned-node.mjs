import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { Broker } from '../../dist/serve/broker.js';
import { NodeClient, attachPipePath } from '../../dist/serve/node.js';
import { connectAttachPipe } from '../../dist/serve/attach-client.js';
import { writeBrokerFile } from '../../dist/serve/registry.js';
import { FileInbox } from '../../dist/serve/file-channel.js';
import { listDshThreads } from '../../dist/dsh/client.js';
import { deliverToDshSession } from '../../dist/dsh/deliver.js';
import { createLocalDiscoveryService } from '../../dist/application/discovery/local.js';
import { createNativeOperationProviders } from '../../dist/application/native-operation-providers.js';

/** One real, loopback-only broker/node for an already verified fixture-owned native root. */
export async function createDshOwnedNode({ root, home, env, nativeId, endpointType, nativeOperations = false }) {
  const owner = JSON.parse(await readFile(join(root, 'ownership.json'), 'utf8'));
  assert(['c09-dsh-tui', 'c11-dsh-onboarding', 'c20-dsh-native-rename'].includes(owner.task)); assert.equal(await realpath(root), owner.root);
  const inside = relative(owner.root, await realpath(home));
  assert(inside && !inside.startsWith('..') && !isAbsolute(inside));
  const native = (await listDshThreads({ home })).find((thread) => thread.id === nativeId && thread.endpointType === endpointType);
  assert(native);
  const baseDir = join(home, '.crosschat'), tcpDir = join(baseDir, 'tcp'); await mkdir(tcpDir, { recursive: true });
  const machineId = '11111111222233334444555555555555', starId = 'c09-dsh-owned-star', registryFile = join(tcpDir, 'broker.json');
  const key = randomBytes(32).toString('hex');
  let broker, node, pipe, nodeRun, runFailure, closing;
  const close = () => closing ??= (async () => {
    const failures = [];
    try { pipe?.close(); } catch (error) { failures.push(error); }
    try { await node?.stop(); } catch (error) { failures.push(error); }
    await nodeRun;
    if (runFailure) failures.push(runFailure);
    try { await broker?.stop(); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Owned fixture node cleanup failed');
  })();
  try {
    writeBrokerFile(registryFile, { stars: [{ starId, name: 'C09-OWNED-STAR', nodes: [{ label: 'c09-node', key, addedAt: new Date().toISOString() }], roster: [] }] });
    broker = new Broker({ registryFile, statusFile: join(tcpDir, 'status-broker.json'), port: 0, version: 'c09-owned-fixture',
      machineId: () => '66666666777788889999aaaaaaaaaaaa', hostname: () => 'C09-broker', now: Date.now, log: () => {}, heartbeatMs: 60000,
      deliverLocal: async () => { throw new Error('This TUI fixture never sends a broker message'); } });
    const port = await broker.start();
    const entry = { host: '127.0.0.1', port, key, name: 'C09-OWNED-STAR', starId };
    await writeFile(registryFile, JSON.stringify({ ...JSON.parse(await readFile(registryFile, 'utf8')), port }));
    const configFile = join(tcpDir, 'node.json'); await writeFile(configFile, JSON.stringify({ brokers: [entry] }));
    const discovery = nativeOperations ? createLocalDiscoveryService({ home }) : undefined;
    node = new NodeClient({ config: { entries: [entry] }, configFile, machineId: () => machineId, now: Date.now, log: () => {}, memberCheckMs: 60000,
      ...(discovery ? { discover: (request, context) => discovery.execute(request, context), operationProviders: createNativeOperationProviders({ dsh: { home } }) } : {}),
      codexHome: join(home, '.codex'), fileInbox: new FileInbox({ inboxDir: join(baseDir, 'inbox'), partsDir: join(baseDir, 'parts') }),
      makeSendDeps: () => ({ env, listClaudeSessions: () => ({ sessions: [], malformed: 0 }), listCodexThreads: async () => [],
        listDshThreads: () => listDshThreads({ home }), deliverClaude: async () => { throw new Error('No Claude fixture'); },
        ...(nativeOperations ? { deliverDsh: (id, content, options) => deliverToDshSession(id, content, { ...options, home }) } : {}),
        deliverCodex: async () => { throw new Error('No Codex fixture'); }, sendLogFile: join(baseDir, 'send-log.jsonl'), outboxDir: join(baseDir, 'outbox'), now: Date.now }),
    });
    nodeRun = node.run().catch((error) => { runFailure = error; }); await node.waitForState('online');
    pipe = await connectAttachPipe(attachPipePath(entry, tcpDir));
    assert.equal((await pipe.send({ op: 'attach', sessionId: native.id, tool: 'dsh', endpointType: native.endpointType, name: native.name })).ok, true);
    return { starId, machineId, close, registryFile };
  } catch (error) {
    try { await close(); } catch (failure) { throw new AggregateError([error, failure], 'Owned fixture node setup failed'); }
    throw error;
  }
}
