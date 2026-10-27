import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { launchPty } from './tui-pty-driver.mjs';
import { createCodexSession } from '../../dist/codex/client.js';
import { createLocalDiscoveryService } from '../../dist/application/discovery/local.js';
import { createCodexSessionReader } from '../../dist/application/sessions/codex-reader.js';
import { createNativeOperationProviders } from '../../dist/application/native-operation-providers.js';
import { createTcpSessionOperation } from '../../dist/application/tcp/session-operations.js';
import { Broker } from '../../dist/serve/broker.js';
import { NodeClient } from '../../dist/serve/node.js';
import { FileInbox } from '../../dist/serve/file-channel.js';
import { SenderConn } from '../../dist/serve/via-tcp.js';
import { loadBrokerFile, writeBrokerFile } from '../../dist/serve/registry.js';

/** Real native owner + real application adapter, broker/node and name routing. All state is isolated. */
export async function validateNativeCodexRename({ directory, codexHome, sessionId, openSession, ownerIdentity }) {
  const sessionFactory = async () => createCodexSession(await openSession(), 5000);
  const discovery = createLocalDiscoveryService({ readers: [createCodexSessionReader({ sessionFactory, codexHome })] });
  const tuiHome = join(directory, 'tui-home');
  const root = join(tuiHome, '.crosschat'); await mkdir(join(root, 'tcp'), { recursive: true });
  const registryFile = join(root, 'tcp', 'broker.json');
  const starId = 'native-rename-fixture-star'; const machineId = 'abcd'.repeat(8); const key = 'native-rename-isolated-key';
  writeBrokerFile(registryFile, { stars: [{ starId, name: 'rename-fixture', nodes: [{ label: 'fixture', key, addedAt: '2026-10-27' }], roster: [] }] });
  const logs = []; const routed = [];
  const broker = new Broker({ registryFile, statusFile: join(root, 'tcp', 'status-broker.json'), machineId: () => 'b'.repeat(32),
    hostname: () => 'isolated-broker', version: 'fixture', now: Date.now, log: (line) => logs.push(line), port: 0, resultTimeoutMs: 10000,
    deliverLocal: async () => { throw new Error('Must route to the actual owner node'); } });
  let node; let running; let conn; let tui;
  const nativeRead = async (work) => { const session = await sessionFactory(); try { await session.initialize(); return await work(session); } finally { await session.close(); } };
  const before = await nativeRead(async (session) => ({ identity: session.nativeIdentity, thread: await session.readThreadMetadata(sessionId) }));
  try {
    const port = await broker.start();
    const entry = { host: '127.0.0.1', port, starId, name: 'rename-fixture', key };
    const configFile = join(root, 'tcp', 'node.json'); await writeFile(configFile, JSON.stringify({ brokers: [entry] }));
    node = new NodeClient({ config: { entries: [entry] }, configFile, machineId: () => machineId, now: Date.now, log: (line) => logs.push(line),
      attachLabel: directory.split(/[\\/]/).at(-1), memberProviders: () => [], memberCheckMs: 60000,
      fileInbox: new FileInbox({ inboxDir: join(root, 'inbox'), partsDir: join(root, 'parts') }),
      discover: (request, options) => discovery.execute(request, options),
      operationProviders: createNativeOperationProviders({ codex: { sessionFactory, codexHome, ownerIdentity } }),
      makeSendDeps: () => ({ env: {}, now: Date.now, machineId: () => machineId,
        listClaudeSessions: () => ({ sessions: [], malformed: 0 }), listCodexThreads: () => nativeRead((session) => session.listThreads()),
        deliverClaude: async () => { throw new Error('Wrong provider'); },
        deliverCodex: async (id, text) => {
          assert.equal(id, sessionId); routed.push(id);
          const turn = await nativeRead((session) => session.startTurn(id, text));
          return { status: 'accepted', turnId: turn.id };
        }, sendLogFile: join(root, 'send.jsonl'), outboxDir: join(root, 'outbox'),
      }),
    });
    running = node.run(); await node.waitForState('online');
    const operate = createTcpSessionOperation({ baseDir: root, timeoutMs: 10000 });
    const target = { contextId: 'local', starId, machineId, providerId: 'codex', nativeId: sessionId };
    const description = await operate(target, { kind: 'describe' });
    assert.equal(description.description?.actions.rename.state, 'executable', JSON.stringify(description));
    const adopted = await operate(target, { kind: 'apply', operation: 'adopt', expectedRevision: description.description.revision });
    assert.equal(adopted.result?.kind, 'applied', JSON.stringify(adopted));
    const name = 'CROSSCHAT_NATIVE_RENAME_A';
    const tuiEvidence = join(directory, 'tui-evidence.json');
    const env = Object.fromEntries(Object.entries(process.env).map(([key, value]) => [key,
      /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TERM|ProgramFiles.*|SYSTEMDRIVE|OS)$/i.test(key) ? value : undefined]));
    Object.assign(env, { HOME: tuiHome, USERPROFILE: tuiHome, APPDATA: join(tuiHome, 'appdata'), LOCALAPPDATA: join(tuiHome, 'localappdata'),
      CODEX_HOME: join(tuiHome, '.codex'), CLAUDE_CONFIG_DIR: join(tuiHome, '.claude'), CROSSCHAT_CODEX_BIN: join(tuiHome, 'not-installed.exe'),
      NATIVE_RENAME_TUI_HOME: tuiHome, NATIVE_RENAME_TUI_EVIDENCE: tuiEvidence, TERM: 'xterm-256color' });
    tui = await launchPty({ executable: process.execPath, args: [fileURLToPath(new URL('./native-rename-tui-fixture.mjs', import.meta.url))],
      cwd: directory, env, columns: 100, rows: 28, logPath: join(directory, 'rename-tui-pty.jsonl') });
    await tui.waitForOutput('NATIVE-RENAME-TUI', 10000);
    tui.write(':stars\r'); await tui.waitForOutput('rename-fixture', 10000);
    tui.write('\r'); await tui.waitForOutput('<members>', 10000);
    tui.write('a'); await tui.waitForOutput('可发现', 10000); await delay(300);
    tui.write('e'); await tui.waitForOutput('原生会话新名称', 10000);
    tui.write(name); await delay(100); tui.write('\r'); await tui.waitForOutput('确认提交', 10000);
    tui.write('\t\r'); await tui.waitForOutput('原生名称及星内路由已确认更新', 10000);
    tui.resize(48, 16); await delay(100); tui.resize(100, 28); await delay(100);
    tui.write('q'); assert.equal((await tui.exited).code, 0);
    const terminal = JSON.parse(await readFile(tuiEvidence, 'utf8'));
    assert.deepEqual(terminal.after, terminal.before, 'TUI restores raw mode and owned listeners');
    const roster = loadBrokerFile(registryFile).stars[0].roster;
    assert.equal(roster.find((item) => item.sessionId === sessionId)?.name, name);
    const after = await nativeRead((session) => session.readThreadMetadata(sessionId));
    assert.equal(after.name, name); assert.equal(after.id, sessionId);
    conn = await SenderConn.open(`ws://127.0.0.1:${port}`, key, undefined, 5000);
    await conn.send({ op: 'send', id: 'verify-renamed-route', targetMachine: `${machineId.slice(0, 8)}:${name}`, body: 'native rename route validation' });
    const receipt = await conn.waitFor((frame) => (frame.op === 'receipt' || frame.op === 'error') && frame.id === 'verify-renamed-route', 10000);
    assert.equal(receipt.status, 'delivered', JSON.stringify(receipt));
    assert.deepEqual(routed, [sessionId]);
    return { initialized: before.identity, sessionId, beforeName: before.thread.name, afterName: after.name, sameNativeOwner: true,
      applicationAdapter: true, realTuiConfirmed: true, terminalRestored: true, brokerNodeConfirmed: true, persistedRosterConfirmed: true, renamedRouteConfirmed: true, logs };
  } finally { await tui?.dispose(); conn?.close(); await node?.stop(); await running; await broker.stop(); }
}
