import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { launchPty } from './tui-pty-driver.mjs';

const directory = await mkdtemp(join(tmpdir(), 'crosschat-tui-tcp-validation-'));
const fixture = fileURLToPath(new URL('./tui-tcp-fixture.mjs', import.meta.url));
const results = [];
const esc = '\x1b';
const home = '\x1b[H';
const end = '\x1b[F';
const down = '\x1b[B';
async function session(name, scenario = 'keyboard') {
  const evidence = join(directory, `${name}.jsonl`);
  const pty = await launchPty({ executable: process.execPath, args: [fixture], columns: 100, rows: 28,
    env: { TUI_TCP_HOME: join(directory, name), TUI_TCP_EVIDENCE: evidence, TUI_TCP_SCENARIO: scenario }, logPath: join(directory, `${name}-pty.jsonl`) });
  async function events() {
    try { return (await readFile(evidence, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function waitEvent(predicate, from = 0) {
    const expires = Date.now() + 7000;
    while (Date.now() < expires) { const all = await events(); const found = all.slice(from).find(predicate); if (found) return found; await delay(25); }
    throw new Error(`TCP evidence did not match: ${evidence}`);
  }
  async function send(input, expected) { const mark = pty.output.length; pty.write(input); if (expected) await pty.waitForOutput(expected, 10_000, mark); }
  async function copy(key = 'y') { const mark = (await events()).length; pty.write(key); return waitEvent((event) => event.event === 'clipboard', mark); }
  async function resize(columns, rows, expected = 'crosschat') { const mark = pty.output.length; pty.resize(columns, rows); await pty.waitForOutput(expected, 10_000, mark); await waitEvent((event) => event.event === 'resize' && event.columns === columns && event.rows === rows); }
  return { pty, events, waitEvent, send, copy, resize, async finish(expectedCode) {
    let timer;
    let exited;
    try { exited = await Promise.race([pty.exited, new Promise((_, reject) => { timer = globalThis.setTimeout(() => reject(new Error(`TCP fixture did not exit: ${evidence}; ${pty.output.slice(-1500)}`)), 12_000); })]); }
    finally { globalThis.clearTimeout(timer); }
    assert.equal(exited.code, expectedCode); assert.equal(exited.hostCode, 0);
    const all = await events(); const restored = all.find((event) => event.event === 'exit'); assert(restored);
    assert.deepEqual(restored.after, restored.before, 'raw input and owned listeners return to the warmed baseline');
    for (const mode of ['1049', '25', '2004']) { const enabled = pty.output.lastIndexOf(`\x1b[?${mode}h`), disabled = pty.output.lastIndexOf(`\x1b[?${mode}l`); assert(mode === '25' ? enabled > disabled : disabled > enabled, `terminal mode ${mode} restored`); }
    assert(!pty.output.includes('tcp-fixture-private-error'));
    assert(!pty.output.includes('\ufffd'), 'valid UTF-8 is preserved');
    assert(!Array.from(pty.output).some((character) => { const value = character.codePointAt(0); return value >= 0xd800 && value <= 0xdfff; }), 'no isolated surrogate');
    results.push({ name, code: exited.code, terminalRestored: true, evidence, log: pty.logPath }); return all;
  } };
}

const normal = await session('tcp-keyboard-resize');
try {
  await normal.pty.waitForOutput('本机TCP-FIXTURE');
  const ready = await normal.waitEvent((event) => event.event === 'fixture-ready');
  await normal.send(home + '\r', 'LOCAL-FIXTURE-SESSION');
  await normal.send(':stars\r', 'STAR-FIXTURE');
  await normal.send('e', '确认提交');
  await normal.send('\r\r', '已取消操作');
  assert.equal((await normal.events()).filter((event) => event.event === 'tcp-effect').length, 0, 'confirmation starts at cancel');
  await normal.send('e', '确认提交');
  await normal.send('\r\t\r', 'TCP-FIXTURE-MUTATION-CONFIRMED');
  await normal.send('\r', 'NODE-SECOND-FIXTURE');
  await normal.send(home + down);
  assert.equal((await normal.copy()).value, ready.machineB);
  const refreshMark = (await normal.events()).length;
  await normal.waitEvent((event) => event.event === 'tcp-star', refreshMark);
  assert.equal((await normal.copy()).value, ready.machineB, 'automatic refresh retains exact selected machine');
  await normal.send('v', '全星会话');
  await normal.send('b', '会话来源范围');
  await normal.send(end + '\r', '节点可发现范围');
  await normal.waitEvent((event) => event.event === 'tcp-sessions' && event.scope === 'discoverable' && !event.machineId);
  await normal.send(home + '\r', '星内成员册');
  await normal.waitEvent((event) => event.event === 'tcp-sessions' && event.machineId === ready.machineA && event.scope === 'members');
  const fullRef = JSON.parse((await normal.copy('Y')).value);
  assert(fullRef.contextId.includes(ready.machineA));
  await normal.send('d', '只读详情');
  await normal.send(end);
  await normal.copy();
  await normal.send('a\x04');
  await normal.send(esc, ':sessions');
  await normal.send(esc, '节点可发现范围');
  await normal.send(esc, '星内成员册');
  await normal.send(esc, 'NODE-SECOND-FIXTURE');
  await normal.send(home + down + '\x04', '确认提交');
  await normal.send('\r', '已取消操作');
  await normal.send('\x04', '确认提交');
  await normal.send('\t\r', 'TCP-FIXTURE-MUTATION-CONFIRMED');
  const removed = (await normal.events()).find((event) => event.event === 'tcp-effect' && event.action === 'remove-node');
  assert.equal(removed.targetId, `machine:${ready.machineB}`);
  assert.equal(removed.starId, ready.starId);
  await normal.send('a', '确认提交');
  await normal.resize(24, 12, '请放大终端');
  await normal.send('\r\r\t\r');
  await normal.send(esc, '已取消操作');
  assert.equal((await normal.events()).filter((event) => event.event === 'tcp-effect' && event.action === 'generate-node-key').length, 0, 'hidden form never submits');
  await normal.resize(48, 16);
  await normal.resize(100, 28);
  await normal.send('a', '确认提交');
  await normal.send('\r\r\t\r', 'TCP-FIXTURE-ONE-TIME-CONFIG');
  assert.equal((await normal.copy()).value, '{"fixture":"TCP-SYNTHETIC-SECRET-NEVER-A-REAL-KEY"}');
  assert.equal((await normal.copy('c')).value, 'crosschat serve --connect fixture-star --detach');
  const issueCount = (await normal.events()).filter((event) => event.event === 'tcp-effect' && event.action === 'generate-node-key').length;
  await normal.send('a\x04\r'); // Results have no list mutation dispatch.
  const clearStart = normal.pty.output.length;
  await normal.send(esc, 'NODE-LONG');
  assert(normal.pty.output.slice(clearStart).includes('\x1b[2J\x1b[H'), 'closing a secret clears the current terminal surface');
  assert(!normal.pty.output.slice(clearStart).includes('TCP-SYNTHETIC-SECRET-NEVER-A-REAL-KEY'), 'a normal page never redraws issued secret');
  await normal.pty.waitForOutput('NODE-BOUND-FIXTURE', 10_000, clearStart);
  assert.equal((await normal.events()).filter((event) => event.event === 'tcp-effect' && event.action === 'generate-node-key').length, issueCount, 'result keys cannot reissue a credential');
  await normal.send(':ctx\r', 'TCP-MEMBER-FIXTURE');
  await normal.send(end + '\r', '普通成员');
  const deniedMark = (await normal.events()).length;
  await normal.send('a', '没有发钥');
  await normal.send('e', '需要 broker');
  assert(!(await normal.events()).slice(deniedMark).some((event) => event.event === 'tcp-preview' || event.event === 'tcp-effect'), 'disabled role actions never dispatch');
  await normal.send('q');
  const all = await normal.finish(0);
  const effects = all.filter((event) => event.event === 'tcp-effect');
  assert.deepEqual(effects.map((event) => event.action), ['rename-star', 'remove-node', 'generate-node-key']);
  assert.equal(effects[0].targetId, 'star:fixed-fixture-row');
  assert.equal(effects[0].starId, ready.starId);
  assert(effects.every((event) => event.contextId === 'local' && event.expectedPreviewRevision.startsWith('preview:')));
  for (const [columns, rows] of [[24, 12], [48, 16], [100, 28]]) assert(all.some((event) => event.event === 'resize' && event.columns === columns && event.rows === rows));
} finally { await normal.pty.dispose(); }

const idle = await session('tcp-ctx-interrupt', 'idle');
try {
  await idle.pty.waitForOutput('本机TCP-FIXTURE');
  await idle.send('\x03');
  const all = await idle.finish(0);
  assert(!all.some((event) => ['tcp-star', 'tcp-stars', 'tcp-sessions', 'tcp-preview', 'tcp-effect', 'local-sessions'].includes(event.event)), 'ctx startup and Ctrl+C do not query application sources');
} finally { await idle.pty.dispose(); }
const failure = await session('tcp-process-failure', 'failure');
try {
  await failure.pty.waitForOutput('本机TCP-FIXTURE');
  await failure.pty.waitForOutput('异常退出');
  await failure.finish(1);
} finally { await failure.pty.dispose(); }
process.stdout.write(`${JSON.stringify({ directory, results }, null, 2)}\n`);
