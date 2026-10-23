import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { clearTimeout, setTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import { createOpenCodeFixture, poll, repositoryRoot } from '../test/helpers/opencode-live-fixture.mjs';
import { textStream } from '../test/helpers/opencode-mock-model.mjs';
import { launchPty } from '../test/helpers/tui-pty-driver.mjs';

const self = fileURLToPath(import.meta.url);

async function crosschatTuiChild() {
  const home = process.env.OPENCODE_PTY_HOME;
  assert.equal(homedir(), home, 'the child must use only the isolated native home');
  const record = (event) => appendFile(process.env.OPENCODE_PTY_UI_EVENTS, JSON.stringify(event) + '\n');
  const { createElement } = await import('react');
  const { render, Text } = await import('ink');
  const { createOpenCodeSessionReader } = await import('../dist/application/sessions/opencode-reader.js');
  const { DiscoveryService } = await import('../dist/application/discovery/index.js');
  const { createSessionsResource } = await import('../dist/tui/resources/sessions.js');
  const { createResourceRegistry, defaultResources } = await import('../dist/tui/resources/registry.js');
  const { runTui } = await import('../dist/tui/main.js');
  // Use the real native OpenCode reader; do not connect to any personal Codex daemon.
  const sessions = createSessionsResource({ discovery: new DiscoveryService([createOpenCodeSessionReader()]) });
  const registry = createResourceRegistry(defaultResources.map((resource) => resource.id === 'sessions' ? sessions.resource : resource));
  const warmup = render(createElement(Text, null, 'OpenCode PTY baseline'), { interactive: true, patchConsole: false, exitOnCtrlC: false });
  await warmup.waitUntilRenderFlush(); warmup.unmount(); await warmup.waitUntilExit();
  const state = () => ({ raw: process.stdin.isRaw === true, resize: process.stdout.listenerCount('resize'),
    listeners: Object.fromEntries(['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'].map((event) => [event, process.listenerCount(event)])) });
  const before = state();
  const code = await runTui({ home, registry, contexts: [{ id: 'local', kind: 'local', label: 'OpenCode 实际服务验证', target: home }],
    adapters: { sessions: sessions.adapter }, clipboard: async (value) => record({ event: 'clipboard', value }) });
  await record({ event: 'exit', code, before, after: state() });
  process.exitCode = code;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function ptyEnvironment(env) {
  // launchPty overlays process.env. Explicit undefined entries prevent inherited
  // model credentials and personal caller identities reaching this test child.
  return { ...Object.fromEntries(Object.keys(process.env).map((key) => [key, undefined])), ...env };
}

async function within(promise, timeout, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), timeout); })]); }
  finally { clearTimeout(timer); }
}

async function main() {
  assert.equal(process.platform, 'win32', 'This optional smoke test requires Windows ConPTY.');
  const binary = argument('--binary') ?? process.env.OPENCODE_BIN;
  const evidence = argument('--evidence');
  assert(binary && isAbsolute(binary), 'Provide an absolute --binary path to an already downloaded official OpenCode executable.');
  assert(evidence && isAbsolute(evidence), 'Provide an absolute --evidence directory outside the owned native fixture.');
  await mkdir(evidence, { recursive: true });
  const result = { tests: [], evidence: resolve(evidence), fixtureRemoved: false };
  let fixture; let native; let ui;
  let mainFailure; let testFailed = false;
  const cleanupFailures = [];
  try {
    fixture = await createOpenCodeFixture(binary, () => textStream('OPENCODE_PTY_MODEL_ACK'));
    result.fixtureRoot = fixture.root;
    result.servicePid = fixture.pid;
    result.version = (await fixture.api('/api/info')).version;
    const session = await fixture.createSession('OpenCode PTY Inbox');
    result.sessionId = session.id;
    const discovered = await fixture.cli(['discover'], JSON.stringify({ op: 'list', filter: { providerIds: ['opencode'] } }));
    assert.equal(discovered.code, 0, discovered.stderr);
    const discovery = JSON.parse(discovered.stdout);
    assert(discovery.page.items.some((item) => item.ref.providerId === 'opencode' && item.ref.nativeId === session.id));
    await writeFile(join(evidence, 'default-discovery.json'), JSON.stringify(discovery, null, 2) + '\n');
    result.tests.push({ name: 'default CLI discovery composition reads the real OpenCode native session', passed: true });
    const env = ptyEnvironment(fixture.env);
    native = await launchPty({ executable: binary, args: ['--session', session.id], cwd: fixture.workspace, columns: 112, rows: 30,
      env, logPath: join(evidence, 'native-opencode-pty.jsonl') });
    await native.waitForOutput(/OpenCode|opencode|PTY Inbox/, 30000);
    const marker = 'CROSSCHAT_NATIVE_PTY_INCOMING';
    const sent = await fixture.cli(['send', '--to', `opencode/${session.id}`, '--body', marker, '--json']);
    assert.equal(sent.code, 0, sent.stderr);
    await native.waitForOutput(marker, 30000);
    await native.waitForOutput('OPENCODE_PTY_MODEL_ACK', 30000);
    result.tests.push({ name: 'official OpenCode interactive session displays real crosschat input and model acknowledgment', passed: true });
    native.resize(60, 20);
    await poll(() => native.events.some((event) => event.event === 'resized' && event.columns === 60), 'native resize');
    native.resize(112, 30);

    const uiEvents = join(evidence, 'crosschat-ui-events.jsonl');
    ui = await launchPty({ executable: process.execPath, args: [self, '--tui-child'], cwd: repositoryRoot, columns: 112, rows: 30,
      env: { ...env, OPENCODE_PTY_HOME: fixture.root, OPENCODE_PTY_UI_EVENTS: uiEvents }, logPath: join(evidence, 'crosschat-opencode-pty.jsonl') });
    const input = async (value, expected) => {
      const start = ui.output.length; ui.write(value);
      if (expected) await ui.waitForOutput(expected, 15000, start);
    };
    await ui.waitForOutput('OpenCode 实际服务验证', 15000);
    await input('\r', 'OpenCode PTY Inbox');
    await input('d', '原生引用');
    assert(ui.output.includes(session.id), 'read-only detail retains the complete real OpenCode id');
    await input('\x1b', ':sessions');
    await input('g', 'OpenCode 原生操作');
    await input('\x1b', ':sessions');
    await input('y', '已复制完整值');
    await poll(async () => (await readFile(uiEvents, 'utf8')).includes(`opencode/${session.id}`), 'full native address copy');
    await input('Y', '已复制完整值');
    await poll(async () => (await readFile(uiEvents, 'utf8')).includes('providerId'), 'full session reference copy');
    const copies = (await readFile(uiEvents, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    const address = copies.find((event) => event.event === 'clipboard' && event.value === `opencode/${session.id}`)?.value;
    assert.equal(address, `opencode/${session.id}`);
    assert(copies.some((event) => event.event === 'clipboard' && JSON.parse(event.value.startsWith('{') ? event.value : '{}').nativeId === session.id));
    const copiedSend = await fixture.cli(['send', '--to', address, '--body', 'CROSSCHAT_TUI_COPIED_ADDRESS', '--json']);
    assert.equal(copiedSend.code, 0, copiedSend.stderr);
    await native.waitForOutput('CROSSCHAT_TUI_COPIED_ADDRESS', 30000);
    result.tests.push({ name: 'crosschat real OpenCode reader supports TUI detail, native guide and complete-address/reference copy', passed: true });
    result.tests.push({ name: 'address copied from TUI delivers through the real CLI and appears in native OpenCode', passed: true });
    ui.resize(48, 16);
    await poll(() => ui.events.some((event) => event.event === 'resized' && event.columns === 48), 'crosschat resize');
    ui.resize(112, 30);
    await input('q');
    assert.deepEqual(await within(ui.exited, 15000, 'crosschat TUI exit timeout'), { code: 0, hostCode: 0 });
    const terminalExit = (await readFile(uiEvents, 'utf8')).trim().split('\n').map((line) => JSON.parse(line)).find((event) => event.event === 'exit');
    assert.deepEqual(terminalExit.after, terminalExit.before);
    result.tests.push({ name: 'crosschat real terminal exits with raw mode and owned listeners restored', passed: true });
    let nativeFinished = false;
    void native.exited.then(() => { nativeFinished = true; }, () => { nativeFinished = true; });
    native.write('\x03');
    await delay(300);
    if (!nativeFinished) native.write('\x03');
    const nativeExit = await within(native.exited, 15000, 'native OpenCode exit timeout');
    assert.equal(nativeExit.hostCode, 0);
    result.nativeExitCode = nativeExit.code;
    result.tests.push({ name: 'official OpenCode interactive terminal exits after owned Ctrl+C input', passed: true });
    for (const [name, pty] of [['native-opencode', native], ['crosschat-opencode', ui]]) {
      assert(!pty.output.includes(fixture.info.password), 'native service password must not reach terminal evidence');
      await writeFile(join(evidence, `${name}-output.txt`), pty.output);
    }
  } catch (error) {
    result.failure = error instanceof Error ? error.message : String(error);
    mainFailure = error;
    testFailed = true;
  } finally {
    for (const pty of [ui, native]) {
      try { await pty?.dispose(); } catch (error) { cleanupFailures.push(error); }
    }
    if (fixture) {
      try { await fixture.close(); result.fixtureRemoved = true; } catch (error) { cleanupFailures.push(error); }
    }
    if (cleanupFailures.length) result.cleanupErrors = cleanupFailures.map((error) => String(error));
    try { await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2) + '\n'); }
    catch (error) { cleanupFailures.push(error); }
  }
  if (cleanupFailures.length) throw new AggregateError(testFailed ? [mainFailure, ...cleanupFailures] : cleanupFailures,
    'OpenCode PTY verification or owned fixture cleanup failed.', testFailed ? { cause: mainFailure } : undefined);
  if (testFailed) throw mainFailure;
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (process.argv.includes('--tui-child')) await crosschatTuiChild();
else await main();
