import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { createCodexSessionBinding } from '../../dist/codex/session-events.js';
import { launchPty } from './tui-pty-driver.mjs';
import { validateNativeCodexRename } from './codex-rename-native-fixture.mjs';

const binary = process.env.CROSSCHAT_NATIVE_CODEX;
assert(binary, 'Set exact installed native Codex binary.');
const directory = await mkdtemp(join(tmpdir(), 'crosschat-codex-selection-'));
const profile = join(directory, 'profile'); const codexHome = join(profile, '.codex');
const workspace = join(directory, 'workspace');
await Promise.all([codexHome, workspace].map((path) => mkdir(path, { recursive: true })));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TERM|ProgramFiles.*|SYSTEMDRIVE|OS)$/i.test(key)));
Object.assign(env, { HOME: profile, USERPROFILE: profile, CODEX_HOME: codexHome, APPDATA: join(profile, 'appdata'), LOCALAPPDATA: join(profile, 'localappdata'), TERM: 'xterm-256color', NO_COLOR: '1', NO_PROXY: '127.0.0.1,localhost' });
const requests = [];
const model = createServer((req, res) => {
  requests.push(req.url); req.resume();
  const message = { id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'CODEX_SELECTION_ACK', annotations: [] }] };
  const response = { id: 'resp_fixture', object: 'response', status: 'completed', model: 'fixture', output: [message], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  const frames = [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...message, status: 'in_progress', content: [] } },
    { type: 'response.output_text.delta', item_id: message.id, output_index: 0, content_index: 0, delta: 'CODEX_SELECTION_ACK' },
    { type: 'response.output_item.done', output_index: 0, item: message }, { type: 'response.completed', response },
  ];
  res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(frames.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''));
});
await new Promise((done) => model.listen(0, '127.0.0.1', done));
const provider = `http://127.0.0.1:${model.address().port}/v1`;
await writeFile(join(codexHome, 'config.toml'), `model="fixture"\nmodel_provider="fixture"\n[model_providers.fixture]\nname="Fixture"\nbase_url=${JSON.stringify(provider)}\nwire_api="responses"\nrequires_openai_auth=false\nrequest_max_retries=0\nstream_max_retries=0\n[analytics]\nenabled=false\n`);
const reserve = createTcpServer(); await new Promise((done) => reserve.listen(0, '127.0.0.1', done));
const port = reserve.address().port; await new Promise((done) => reserve.close(done));
const nativeURL = `ws://127.0.0.1:${port}`;
const native = spawn(binary, ['app-server', '--listen', nativeURL], { cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; native.stdout.on('data', (data) => { logs += data; }); native.stderr.on('data', (data) => { logs += data; });
const nativeExit = new Promise((done) => native.once('exit', (code) => done(code)));
const events = []; const methods = [];
let renameEvidence;
let pty; let binding;
async function connect() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const socket = new WebSocket(nativeURL); await new Promise((done, fail) => { socket.once('open', done); socket.once('error', fail); }); return socket; }
    catch { await delay(50); }
  }
  throw new Error(`Owned native server unavailable: ${logs}`);
}
try {
  const openSession = async () => {
  const upstream = await connect();
  const messages = new Set(); const closed = new Set();
  upstream.on('error', () => undefined);
  upstream.on('message', (data) => { for (const listener of messages) listener(data.toString()); });
  upstream.on('close', () => { for (const listener of closed) listener(); });
  const channel = { send(payload) { const value = JSON.parse(payload); if (value.method) methods.push({ method: value.method, threadId: value.params?.threadId,
    ...(value.method === 'thread/start' ? { params: value.params } : {}) }); upstream.send(payload); },
    onMessage(listener) { messages.add(listener); return () => messages.delete(listener); }, onClose(listener) { closed.add(listener); return () => closed.delete(listener); },
    close: async () => upstream.terminate(), stderrText: '' };
  return { channel, close: channel.close };
  };
  binding = await createCodexSessionBinding({ exe: binary, args: ['--no-alt-screen'], env, onSelection: (event) => events.push(event), openSession });
  const clean = { ...Object.fromEntries(Object.keys(process.env).map((key) => [key, undefined])), ...binding.env };
  pty = await launchPty({ executable: binary, args: binding.args, env: clean, cwd: workspace, columns: 100, rows: 28, logPath: join(directory, 'native-pty.jsonl') });
  const waitEvent = async (predicate, from = 0) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) { const value = events.slice(from).find(predicate); if (value) return value; await delay(30); }
    throw new Error(`Native selection missing: ${JSON.stringify({ events, methods })}; ${pty.output.slice(-3000)}`);
  };
  const initial = await waitEvent((event) => event.kind === 'empty');
  await pty.waitForOutput('state=idle:app=codex', 20000);
  const enter = async (text) => { pty.write(text); await delay(250); pty.write('\r'); };
  assert.equal(events.filter((event) => event.kind === 'selected').length, 0);
  await enter('fixture native A');
  await waitEvent((event) => event.kind === 'selected' && event.sessionId === initial.sessionId);
  await pty.waitForOutput('CODEX_SELECTION_ACK', 20000); await delay(300);
  if (process.argv.includes('--rename')) {
    renameEvidence = await validateNativeCodexRename({ directory, codexHome, sessionId: initial.sessionId, openSession,
      ownerIdentity: async () => { assert.equal(native.exitCode, null); return `owned-fixture:${native.pid}`; } });
  }
  const first = events.length;
  await enter('/new');
  const next = await waitEvent((event) => event.kind === 'empty' && event.sessionId !== initial.sessionId, first);
  await enter('fixture native B');
  await waitEvent((event) => event.kind === 'selected' && event.sessionId === next.sessionId, first);
  await delay(500);
  const resume = events.length;
  await enter('/resume'); await delay(800);
  if (renameEvidence) { await pty.waitForOutput(renameEvidence.afterName, 5000); renameEvidence.frontendObserved = true; }
  pty.write('\x1b'); await delay(200);
  assert.equal(events.length, resume, 'cancel picker keeps current selection');
  await enter('/resume'); await delay(800); pty.write('\x1b[B'); await delay(100); pty.write('\r');
  await waitEvent((event) => event.kind === 'selected' && event.sessionId === initial.sessionId, resume);
  pty.resize(48, 16); await delay(100); pty.resize(100, 28);
  pty.write('\x03');
  if (!await Promise.race([pty.exited.then(() => true), delay(300).then(() => false)]) && !pty.events.some((event) => event.event === 'exit')) pty.write('\x03');
  assert.equal((await pty.exited).code, 0);
  await writeFile(join(directory, 'evidence.json'), JSON.stringify({ events, methods, requests, logs, renameEvidence }, null, 2));
  assert.equal(events.length, 5, 'only two user chats and the explicit resume select; no title-generation threads');
  console.log(JSON.stringify({ directory, events, requests, renameEvidence, passed: true }));
} finally {
  await pty?.dispose(); await binding?.close(); native.kill(); await nativeExit;
  await new Promise((done) => model.close(done));
  await writeFile(join(directory, 'server.log'), logs);
  await writeFile(join(directory, 'all-evidence.json'), JSON.stringify({ events, methods, requests, logs, renameEvidence }, null, 2));
}
