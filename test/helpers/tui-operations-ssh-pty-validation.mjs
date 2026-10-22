import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { launchPty } from './tui-pty-driver.mjs';

const directory = await mkdtemp(join(tmpdir(), 'crosschat-tui-operations-ssh-validation-'));
const fixture = fileURLToPath(new URL('./tui-operations-ssh-fixture.mjs', import.meta.url));
const results = [];
const escape = '\x1b';
const home = '\x1b[H';
const end = '\x1b[F';
const down = '\x1b[B';
async function session(name, scenario = 'keyboard') {
  const evidence = join(directory, `${name}.jsonl`);
  const pty = await launchPty({ executable: process.execPath, args: [fixture], columns: 100, rows: 28,
    env: { TUI_OPERATIONS_HOME: join(directory, name), TUI_OPERATIONS_EVIDENCE: evidence, TUI_OPERATIONS_SCENARIO: scenario }, logPath: join(directory, `${name}-pty.jsonl`) });
  async function events() {
    try { return (await readFile(evidence, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function waitEvent(predicate, from = 0) {
    const expires = Date.now() + 6000;
    while (Date.now() < expires) { const all = await events(); const event = all.slice(from).find(predicate); if (event) return event; await delay(25); }
    throw new Error(`Operations evidence did not match: ${evidence}`);
  }
  async function send(input, expected) { const mark = pty.output.length; pty.write(input); if (expected) await pty.waitForOutput(expected, 10_000, mark); }
  async function copy(key = 'y') { const mark = (await events()).length; pty.write(key); return waitEvent((event) => event.event === 'clipboard', mark); }
  async function resize(columns, rows, expected = 'crosschat') { const mark = pty.output.length; pty.resize(columns, rows); await pty.waitForOutput(expected, 10_000, mark); await waitEvent((event) => event.event === 'resize' && event.columns === columns && event.rows === rows); }
  return { pty, send, copy, resize, events, waitEvent, async finish(expectedCode) {
    const exited = await pty.exited; assert.equal(exited.code, expectedCode); assert.equal(exited.hostCode, 0);
    const all = await events(); const restored = all.find((event) => event.event === 'exit'); assert(restored, 'fixture reported teardown');
    assert.deepEqual(restored.after, restored.before, 'raw input and owned listeners return to the warmed baseline');
    for (const mode of ['1049', '25', '2004']) {
      const enabled = pty.output.lastIndexOf(`\x1b[?${mode}h`), disabled = pty.output.lastIndexOf(`\x1b[?${mode}l`);
      assert(mode === '25' ? enabled > disabled : disabled > enabled, `terminal mode ${mode} restored`);
    }
    assert(!pty.output.includes('operations-fixture-private-error'));
    assert(!pty.output.includes('\ufffd'), 'terminal preserves valid UTF-8');
    assert(!Array.from(pty.output).some((character) => { const value = character.codePointAt(0); return value >= 0xd800 && value <= 0xdfff; }), 'terminal emits no isolated surrogate');
    results.push({ name, code: exited.code, terminalRestored: true, evidence, log: pty.logPath }); return all;
  } };
}

const normal = await session('operations-ssh-keyboard-resize');
try {
  await normal.pty.waitForOutput('本机操作fixture');
  const ready = await normal.waitEvent((event) => event.event === 'fixture-ready');
  await normal.send('g', '连接配置与执行位置');
  await normal.send(escape, ':ctx');
  await normal.send('t', ':status');
  await normal.waitEvent((event) => event.event === 'status-read' && event.contextId === 'local');
  await normal.send(':ctx\r', '本机操作fixture');
  await normal.send(home + down + 'g', '连接配置与执行位置');
  await normal.send(end, '失败处理');
  await normal.send(escape, ':ctx');
  await normal.send('t', '只读接口有响应');
  await normal.waitEvent((event) => event.event === 'ssh-inspect' && event.contextId === ready.remoteId);
  await normal.send(':ssh\r', '已有 SSH Host');
  await normal.send('a', '选择已有 SSH Host');
  await normal.send('d', '只读详情');
  await normal.send(escape, '选择已有 SSH Host');
  await normal.send(home + '\r', '3 个可发现会话');
  await normal.send('u', '仅命名会话');
  await normal.send('u', '所有会话（含匿名）');
  await normal.send(`/${ready.anonymousId}\r`, '匿名');
  const anonymous = JSON.parse((await normal.copy('Y')).value);
  assert.deepEqual(anonymous, { contextId: ready.remoteId, providerId: 'codex', nativeId: ready.anonymousId });
  await normal.send('g', '执行位置');
  await normal.send(end, '寻址指引');
  await normal.send('a\x04'); // Native detail never dispatches local mutations.
  await normal.send(escape, ':sessions');
  await normal.send(escape, 'REMOTE-NAMED-FIXTURE');
  await normal.send(':ssh\r', '已有 SSH Host');
  await normal.send(home + 'D', '体检未完成');
  await normal.send('i', '远端退出码');
  await normal.send(end, 'PATH fixture');
  await normal.send(escape, ':doctor');
  await normal.send('r', '读取中');
  await normal.send('\x03', '已取消');
  await normal.waitEvent((event) => event.event === 'ssh-doctor-aborted');
  await normal.send('r', 'Node 版本');
  assert((await normal.copy()).value.includes('fixture-remote'), 'remote doctor guidance keeps the SSH execution user and Host');
  await normal.send('d', '只读详情');
  await normal.send(end, '24.7.0');
  await normal.send(escape, ':doctor');
  await normal.send(':ssh\r', '已有 SSH Host');
  await normal.send(home + down + 't', '检测未完成');
  await normal.send('i', 'SSH 认证未通过 fixture');
  await normal.send(escape, ':ssh');
  await normal.send(':ctx\r', '本机操作fixture');
  await normal.send(home + '\r', 'LOCAL-SESSION-FIXTURE');
  await normal.send(':services\r', 'SERVICE-FIXTURE');
  await normal.send('d', '只读详情');
  await normal.send('a\x04');
  await normal.send(escape, ':services');
  await normal.send('a', '确认提交');
  await normal.send('\r', '已取消操作');
  assert.equal((await normal.events()).filter((event) => event.event === 'service-effect').length, 0);
  await normal.send('a', '确认提交');
  await normal.resize(24, 12, '请放大终端');
  await normal.send('\t\r');
  await normal.send(escape, '已取消操作');
  assert.equal((await normal.events()).filter((event) => event.event === 'service-effect').length, 0, 'hidden confirmation never submits');
  await normal.resize(48, 16);
  await normal.resize(100, 28);
  await normal.send('a', '确认提交');
  await normal.send(end + '\t\r', 'SERVICE-START-READY');
  await normal.send('l', 'SERVICE-LOG-LATEST');
  await normal.copy();
  await normal.send(escape, ':services');
  await normal.send('\x04', '确认提交');
  await normal.send(end + '\t\r', 'SERVICE-STOP-CONFIRMED');
  await normal.send(':files\r', '只读元数据');
  const copiedFile = await normal.copy(); assert(copiedFile.value.startsWith(ready.baseDir));
  await normal.send('m', ':maintenance');
  await normal.send('\r', '确认提交');
  await normal.send('\r', '已取消操作');
  assert.equal((await normal.events()).filter((event) => event.event === 'maintenance-effect').length, 0);
  await normal.send('\r', '确认提交');
  await normal.send(end, 'MAINTENANCE-PREVIEW-FULL');
  await normal.send('\t\r', 'MAINTENANCE-FIXTURE-COMPLETE');
  await normal.send('d', '只读详情');
  await normal.send(end, '模拟已删除');
  await normal.copy();
  await normal.send('a\x04\r'); // Result details remain readonly.
  await normal.send(escape, ':maintenance');
  await normal.send('?', '全部按键');
  await normal.send(escape, ':maintenance');
  await normal.send('q');
  const events = await normal.finish(0);
  assert.deepEqual(events.filter((event) => event.event === 'service-effect').map(({ operation, id, revision, contextId }) => ({ operation, id, revision, contextId })), [
    { operation: 'start', id: 'service:node:full-fixture-target', revision: 'not-running', contextId: 'local' },
    { operation: 'stop', id: 'service:node:full-fixture-target', revision: 'running-1234', contextId: 'local' },
  ]);
  assert.deepEqual(events.filter((event) => event.event === 'maintenance-effect').map(({ operationId, expectedFingerprint, target }) => ({ operationId, expectedFingerprint, target })), [{ operationId: 'cleanup', expectedFingerprint: 'a'.repeat(64), target: ready.target }]);
  assert.equal(await readFile(ready.target, 'utf8'), 'FIXTURE-CONTENT-MUST-REMAIN', 'maintenance effects are simulated and fixture bytes remain');
  assert(events.filter((event) => event.event === 'remote-sessions' || event.event === 'ssh-doctor').every((event) => event.contextId === ready.remoteId));
  assert(events.some((event) => event.event === 'ssh-inspect' && event.contextId === 'ssh:fixture-error'));
  for (const [columns, rows] of [[24, 12], [48, 16], [100, 28]]) assert(events.some((event) => event.event === 'resize' && event.columns === columns && event.rows === rows));
} finally { await normal.pty.dispose(); }

const idle = await session('operations-ssh-ctx-interrupt', 'idle');
try {
  await idle.pty.waitForOutput('本机操作fixture');
  await idle.send('\x03');
  const events = await idle.finish(0);
  assert(!events.some((event) => /(?:read|effect|preview|inspect|doctor|sessions)$/.test(event.event)), 'ctx startup and idle interruption perform no application read or effect');
} finally { await idle.pty.dispose(); }

const failure = await session('operations-ssh-process-failure', 'failure');
try {
  await failure.pty.waitForOutput('本机操作fixture');
  await failure.pty.waitForOutput('异常退出');
  await failure.finish(1);
} finally { await failure.pty.dispose(); }

process.stdout.write(`${JSON.stringify({ directory, results }, null, 2)}\n`);
