import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { launchPty } from './tui-pty-driver.mjs';

const directory = await mkdtemp(join(tmpdir(), 'crosschat-tui-sessions-validation-'));
const fixture = fileURLToPath(new URL('./tui-sessions-fixture.mjs', import.meta.url));
const results = [];
const end = '\x1b[F';
const home = '\x1b[H';
const down = '\x1b[B';
const escape = '\x1b';
const target = '11111111-1111-1111-1111-000000000000';
const anonymous = '11111111-1111-1111-1111-000000000120';
async function session(name, scenario = 'keyboard') {
  const evidence = join(directory, `${name}.jsonl`);
  const pty = await launchPty({ executable: process.execPath, args: [fixture], columns: 112, rows: 30,
    env: { TUI_SESSIONS_HOME: join(directory, name), TUI_SESSIONS_EVIDENCE: evidence, TUI_SESSIONS_SCENARIO: scenario }, logPath: join(directory, `${name}-pty.jsonl`) });
  const send = async (input, expected) => { const mark = pty.output.length; pty.write(input); if (expected) await pty.waitForOutput(expected, 10_000, mark); };
  return { pty, send, async finish(expectedCode) {
    const exited = await pty.exited;
    assert.equal(exited.code, expectedCode); assert.equal(exited.hostCode, 0);
    const events = (await readFile(evidence, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    const exit = events.find((event) => event.event === 'exit');
    assert.deepEqual(exit.after, exit.before);
    for (const mode of ['1049', '25', '2004']) {
      const enabled = pty.output.lastIndexOf(`\x1b[?${mode}h`), disabled = pty.output.lastIndexOf(`\x1b[?${mode}l`);
      assert(mode === '25' ? enabled > disabled : disabled > enabled, `terminal mode ${mode} restored`);
    }
    assert(!pty.output.includes('must-not-reach-terminal'));
    assert(!pty.output.includes('session-fixture-private-error'));
    results.push({ name, code: exited.code, terminalRestored: true, evidence, log: pty.logPath });
    return events;
  } };
}

const normal = await session('sessions-keyboard-resize');
try {
  await normal.pty.waitForOutput('本机会话fixture');
  await normal.send('\r', '124 个可发现会话');
  await normal.send('u', '仅命名会话');
  await normal.send('u', '所有会话（含匿名）');
  await normal.send('t', 'Enter应用');
  await normal.send(end + '\r', '未来工具fixture');
  await normal.send('d', '第三工具完整状态');
  await normal.send('a\x04'); // Read-only details must ignore list mutation shortcuts.
  await normal.send(escape, ':sessions');
  await normal.send('g', '原生界面操作');
  await normal.send(escape, ':sessions');
  await normal.send('Y', '已复制完整值');
  await normal.send('/fixture-does-not-exist\r', '0项');
  await normal.send('i', '会话读取信息');
  await normal.send(escape, ':sessions');
  await normal.send(escape, '未来工具fixture');
  await normal.send('t', 'Enter应用');
  await normal.send(home + '\r', '所有工具');
  await normal.send(`/${anonymous}\r`, '匿名');
  await normal.send('Y', '已复制完整值');
  await normal.send('r', '124 个可发现会话');
  await normal.send('Y', '已复制完整值');
  await normal.send(escape, ':sessions');
  await normal.send('s', 'Enter应用');
  await normal.send(home + down + down + '\r', '思考中<pondering>');
  await normal.send('s', 'Enter应用');
  await normal.send(home + '\r', '所有状态');
  await normal.send(`/${target}\r`, '当前fixture');
  await normal.send('a', '请选择目标星');
  let mark = normal.pty.output.length;
  normal.pty.resize(24, 12);
  await normal.pty.waitForOutput('请放大终端', 10_000, mark);
  await normal.send(down + '\r\t\r');
  await normal.send(escape, '已取消操作');
  mark = normal.pty.output.length;
  normal.pty.resize(112, 30);
  await normal.pty.waitForOutput('crosschat', 10_000, mark);
  await normal.send('a', '请选择目标星');
  await normal.send(down + '\r', '[取消]');
  await normal.send('\r', '已取消操作'); // Cancel is the default button.
  await normal.send('a', '请选择目标星');
  await normal.send(end + '\r', '[取消]');
  await normal.send('\t\r', '影响范围已更新');
  await normal.send('\t\r', 'fixture-adopt-applied');
  await normal.send('\x04', '请选择目标星');
  await normal.send(end + '\r\t\r', '影响范围已更新');
  await normal.send('\t\r', 'fixture-remove-applied');
  mark = normal.pty.output.length;
  normal.pty.resize(48, 16);
  await normal.pty.waitForOutput('crosschat', 10_000, mark);
  mark = normal.pty.output.length;
  normal.pty.resize(112, 30);
  await normal.pty.waitForOutput('crosschat', 10_000, mark);
  await normal.send('q');
  const events = await normal.finish(0);
  const copies = events.filter((event) => event.event === 'clipboard').map((event) => JSON.parse(event.value));
  assert(copies.some((ref) => ref.providerId === 'future-tool' && ref.nativeId === 'opaque/full/未来会话'));
  assert.equal(copies.filter((ref) => ref.providerId === 'claude' && ref.nativeId === anonymous).length, 2, 'refresh retains exact selected session');
  const writes = events.filter((event) => event.event === 'membership-apply');
  assert.deepEqual(writes.map(({ op, ref, starId }) => ({ op, ref, starId })), ['adopt', 'remove'].map((op) => ({ op, ref: { contextId: 'local', providerId: 'claude', nativeId: target }, starId: 'star-full-B' })));
  assert(events.some((event) => event.event === 'read-page' && event.providerId === 'claude' && event.cursor === '100'), 'anonymous page after 100 was read');
  assert(events.some((event) => event.event === 'resize' && event.columns === 24 && event.rows === 12));
  assert(events.some((event) => event.event === 'resize' && event.columns === 48 && event.rows === 16));
} finally { await normal.pty.dispose(); }

const cancel = await session('sessions-cancel-read', 'cancel');
try {
  await cancel.pty.waitForOutput('本机会话fixture');
  await cancel.send('\r', '124 个可发现会话');
  await cancel.send('r', '读取中');
  await cancel.send('\x03', '已取消');
  await cancel.send('q');
  const events = await cancel.finish(0);
  assert(events.some((event) => event.event === 'read-aborted'));
  assert.equal(events.filter((event) => event.event === 'membership-apply').length, 0);
} finally { await cancel.pty.dispose(); }

const failure = await session('sessions-process-failure', 'failure');
try {
  await failure.pty.waitForOutput('本机会话fixture');
  await failure.pty.waitForOutput('异常退出');
  await failure.finish(1);
} finally { await failure.pty.dispose(); }

process.stdout.write(JSON.stringify({ directory, results }, null, 2) + '\n');
