import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';
import process from 'node:process';
import { launchPty } from './tui-pty-driver.mjs';

const directory = await mkdtemp(join(tmpdir(), 'crosschat-tui-validation-'));
const fixture = fileURLToPath(new URL('./tui-fixture.mjs', import.meta.url));
const results = [];
async function session(name, failure = false) {
  const evidence = join(directory, `${name}.jsonl`);
  const pty = await launchPty({ executable: process.execPath, args: [fixture], columns: 100, rows: 28,
    env: { TUI_FIXTURE_HOME: join(directory, name), TUI_FIXTURE_EVIDENCE: evidence, TUI_FIXTURE_FAILURE: String(failure) }, logPath: join(directory, `${name}-pty.jsonl`) });
  const send = async (input, expected) => {
    const mark = pty.output.length;
    pty.write(input);
    if (expected) await pty.waitForOutput(expected, 10_000, mark);
  };
  return { pty, send, async finish(expectedCode) {
    const exited = await pty.exited;
    assert.equal(exited.code, expectedCode);
    assert.equal(exited.hostCode, 0);
    const events = (await readFile(evidence, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    const exit = events.find((event) => event.event === 'exit');
    assert.deepEqual(exit.after, exit.before);
    for (const mode of ['1049', '25', '2004']) {
      const lastEnable = pty.output.lastIndexOf(`\x1b[?${mode}h`);
      const lastDisable = pty.output.lastIndexOf(`\x1b[?${mode}l`);
      if (mode === '25') assert(lastEnable > lastDisable, 'cursor restored');
      else assert(lastDisable > lastEnable, `mode ${mode} restored`);
    }
    assert(!pty.output.includes('never-print-private-fixture'));
    results.push({ name, code: exited.code, terminalRestored: true, log: pty.logPath });
    return events;
  } };
}

const normal = await session('keyboard-resize');
try {
  await normal.pty.waitForOutput('本机fixture');
  await normal.send(':s', 'sessions');
  assert(normal.pty.output.includes('SSHfixture'));
  await normal.send('\x1b', ':ctx');
  await normal.send('\x1b[200~q\x1b[201~');
  await normal.send('d', '只读详情');
  await normal.send('\x1b', ':ctx');
  await normal.send('j\r', '未认证');
  await normal.send('\x1b', ':ctx');
  await normal.send('k\r', '匿名');
  await normal.send('/future/native/29\r', '会话29');
  await normal.send('d', '只读详情');
  await normal.send('\x1b[F', '详情终点');
  await normal.send('y', '已复制完整值');
  await normal.send('\x1b', ':sessions');
  await normal.send('\x1b', '30/30');
  await normal.send('\x1b[H', '匿名');
  await normal.send('e', '修改显示名');
  let mark = normal.pty.output.length;
  normal.pty.resize(24, 12);
  await normal.pty.waitForOutput('请放大终端', 10_000, mark);
  await normal.send('\x1b[200~hidden-edit-must-not-submit\x1b[201~\r\t\r');
  await normal.send('\x1b', '已取消操作');
  mark = normal.pty.output.length;
  normal.pty.resize(100, 28);
  await normal.pty.waitForOutput('crosschat', 10_000, mark);
  await normal.send('e', '修改显示名');
  await normal.send('\x1b[200~更名👩‍💻\x1b[201~\r', '[取消]');
  await normal.send('\x1b[F', 'IMPACT-END');
  await normal.send('\t\r', 'fixture显示名已更新');
  mark = normal.pty.output.length;
  normal.pty.resize(48, 16);
  await normal.pty.waitForOutput('crosschat', 10_000, mark);
  mark = normal.pty.output.length;
  normal.pty.resize(100, 28);
  await normal.pty.waitForOutput('crosschat', 10_000, mark);
  await normal.send(':slow\r', '读取中');
  await normal.send('\x03', '取消');
  await normal.send(':ctx\r', '本机fixture');
  await normal.send('q');
  const events = await normal.finish(0);
  assert(events.some((event) => event.event === 'clipboard' && event.value.endsWith('详情终点')));
  assert(events.some((event) => event.event === 'mutate' && event.targetId === 'future/native/0' && event.values.name.includes('更名👩‍💻')));
  assert.equal(events.filter((event) => event.event === 'mutate').length, 1, 'small form cannot submit hidden edits');
  assert(events.some((event) => event.event === 'resize' && event.columns === 48 && event.rows === 16));
  assert(events.some((event) => event.event === 'resize' && event.columns === 100 && event.rows === 28));
  assert(events.some((event) => event.event === 'read-aborted'));
} finally { await normal.pty.dispose(); }

const interrupt = await session('ctrl-c');
try {
  await interrupt.pty.waitForOutput('本机fixture');
  await interrupt.send('\x03');
  await interrupt.finish(0);
} finally { await interrupt.pty.dispose(); }

const failure = await session('process-failure', true);
try {
  await failure.pty.waitForOutput('本机fixture');
  await failure.pty.waitForOutput('异常退出');
  await failure.finish(1);
} finally { await failure.pty.dispose(); }

process.stdout.write(JSON.stringify({ directory, results }, null, 2) + '\n');
