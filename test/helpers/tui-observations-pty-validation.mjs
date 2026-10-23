import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { launchPty } from './tui-pty-driver.mjs';

const directory = await mkdtemp(join(tmpdir(), 'crosschat-tui-observations-validation-'));
const fixture = fileURLToPath(new URL('./tui-observations-fixture.mjs', import.meta.url));
const results = [];
const escape = '\x1b';
const home = '\x1b[H';
const end = '\x1b[F';
const up = '\x1b[A';
const down = '\x1b[B';

async function session(name, scenario = 'keyboard') {
  const evidence = join(directory, `${name}.jsonl`);
  const fixtureHome = join(directory, name);
  const pty = await launchPty({ executable: process.execPath, args: [fixture], columns: 100, rows: 28,
    env: { TUI_OBSERVATIONS_HOME: fixtureHome, TUI_OBSERVATIONS_EVIDENCE: evidence, TUI_OBSERVATIONS_SCENARIO: scenario },
    logPath: join(directory, `${name}-pty.jsonl`) });
  async function events() {
    try { return (await readFile(evidence, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function waitEvent(predicate, from = 0) {
    const expires = Date.now() + 6000;
    while (Date.now() < expires) {
      const all = await events();
      const match = all.slice(from).find(predicate);
      if (match) return match;
      await delay(25);
    }
    throw new Error(`Observation fixture evidence did not match; evidence: ${evidence}`);
  }
  async function send(input, expected) {
    const mark = pty.output.length;
    pty.write(input);
    if (expected) await pty.waitForOutput(expected, 10_000, mark);
  }
  async function copy() {
    const mark = (await events()).length;
    pty.write('y');
    return waitEvent((event) => event.event === 'clipboard', mark);
  }
  return { pty, send, copy, events, waitEvent, fixtureHome, async finish(expectedCode) {
    const exited = await pty.exited;
    assert.equal(exited.code, expectedCode); assert.equal(exited.hostCode, 0);
    const all = await events();
    const restored = all.find((event) => event.event === 'exit');
    assert(restored, 'fixture reported teardown');
    assert.deepEqual(restored.after, restored.before, 'raw mode and owned listeners return to the warmed baseline');
    for (const mode of ['1049', '25', '2004']) {
      const enabled = pty.output.lastIndexOf(`\x1b[?${mode}h`), disabled = pty.output.lastIndexOf(`\x1b[?${mode}l`);
      assert(mode === '25' ? enabled > disabled : disabled > enabled, `terminal mode ${mode} restored`);
    }
    assert(!pty.output.includes('observation-fixture-private-error'));
    assert(!pty.output.includes('observation-private-message'));
    assert(!pty.output.includes('observation-private-key'));
    assert(!pty.output.includes('\ufffd'), 'real UTF-8 terminal output contains no replacement characters');
    assert(!Array.from(pty.output).some((character) => { const point = character.codePointAt(0); return point >= 0xd800 && point <= 0xdfff; }), 'no isolated surrogate reaches the terminal');
    assert(all.filter((event) => event.event === 'clipboard').every((event) => !/observation-private-(?:message|key)/.test(event.value)), 'clipboard contains only safe rendered log metadata');
    results.push({ name, code: exited.code, terminalRestored: true, evidence, log: pty.logPath });
    return all;
  } };
}

const normal = await session('observations-keyboard-resize');
try {
  await normal.pty.waitForOutput('本机观察fixture');
  await normal.send('\r\r', '观察会话fixture');
  await normal.send(':status\r', ':status');
  await normal.copy();
  await normal.send('?', '全部按键');
  await normal.send(escape, ':status');
  await normal.send('d', '只读详情');
  await normal.send('a\x04'); // Status details stay readonly.
  await normal.send(escape, ':status');
  await normal.send('\r', '观察会话fixture');
  await normal.send('o', ':deliveries');
  await normal.copy();
  await normal.send('w', ':outbox');
  await normal.copy();
  await normal.send('l', '现有看门狗没有独立日志文件');
  await normal.send('o', ':deliveries');
  await normal.send('l', 'LOG-LATEST');
  await normal.send('/LONG-\r', 'LONG-');
  await normal.copy();
  await normal.send('d', '只读详情');
  await normal.send(end, 'DETAIL-END');
  await normal.send(escape, ':logs');
  await normal.send(escape, 'LOG-LATEST');
  await normal.send('t', '选择本机日志来源');
  await normal.send(home + down + 'd', '只读详情');
  await normal.send(end, 'broker.log');
  await normal.send(escape, '选择本机日志来源');
  await normal.send('\r', 'BROKER-LATEST');

  let mark = (await normal.events()).length;
  await normal.send(' ', '已暂停');
  await normal.waitEvent((event) => event.event === 'watch-aborted', mark);
  const broker = join(normal.fixtureHome, '.crosschat', 'tcp', 'broker.log');
  const pausedReads = (await normal.events()).filter((event) => event.event === 'watch-page').length;
  await appendFile(broker, 'APPEND-WHILE-PAUSED-中文👩‍💻\n');
  await delay(300);
  assert.equal((await normal.events()).filter((event) => event.event === 'watch-page').length, pausedReads, 'pause releases its observer and freezes the sampled rows');
  await normal.send(' ', 'APPEND-WHILE-PAUSED');
  await normal.copy();
  await normal.send(up, '已暂停');
  await normal.copy();
  await normal.send(end, '跟随中');
  await normal.copy();
  await normal.send('/MATCH-之后\r', '0项');
  await normal.send('i', '日志读取信息');
  await normal.send(escape, '0项');
  await appendFile(broker, 'MATCH-之后-中文👩‍💻\n');
  await normal.pty.waitForOutput('MATCH-之后-中文');
  await normal.copy();
  await normal.send(escape, 'BROKER-LATEST');

  const repeat = '重复行-同值👩‍💻';
  mark = (await normal.events()).length;
  await appendFile(broker, `${repeat}\n${repeat}\n`);
  const repeated = await normal.waitEvent((event) => event.event === 'watch-page' && event.texts.filter((text) => text === repeat).length === 2, mark);
  const repeatedIds = repeated.ids.filter((_id, index) => repeated.texts[index] === repeat);
  assert.equal(new Set(repeatedIds).size, 2, 'identical log text retains distinct source offsets');
  mark = (await normal.events()).length;
  await appendFile(broker, 'APPEND-AFTER-DUP\n');
  const appended = await normal.waitEvent((event) => event.event === 'watch-page' && event.texts.includes('APPEND-AFTER-DUP'), mark);
  assert.deepEqual(appended.ids.filter((_id, index) => appended.texts[index] === repeat), repeatedIds, 'appending does not renumber existing lines');
  mark = (await normal.events()).length;
  await rename(broker, `${broker}.old`);
  await writeFile(broker, 'ROTATED-FIRST\nROTATED-LATEST👩‍💻\n');
  const rotated = await normal.waitEvent((event) => event.event === 'watch-page' && event.texts.includes('ROTATED-LATEST👩‍💻'), mark);
  assert.match(rotated.notice, /轮转|缩短/);
  assert(!repeated.ids.includes(rotated.ids[0]), 'replacement file gets a new line identity');
  await normal.pty.waitForOutput('ROTATED-LATEST');
  await normal.copy();
  await normal.send('r', 'ROTATED-LATEST');

  for (const [columns, rows] of [[24, 12], [48, 16], [100, 28]]) {
    const output = normal.pty.output.length;
    normal.pty.resize(columns, rows);
    await normal.pty.waitForOutput('CC · 工作区', 10_000, output);
    await normal.waitEvent((event) => event.event === 'resize' && event.columns === columns && event.rows === rows);
  }
  await normal.send(':doctor\r', '读取中');
  await normal.send('\x03', '已取消');
  await normal.waitEvent((event) => event.event === 'doctor-aborted');
  await normal.send('r', '隔离体检fixture');
  await normal.copy();
  await normal.send('d', 'DOCTOR-FIXTURE-READY');
  await normal.send(escape, ':doctor');
  await normal.send('q');
  const events = await normal.finish(0);
  const ready = events.find((event) => event.event === 'fixture-ready');
  const copies = events.filter((event) => event.event === 'clipboard').map((event) => event.value);
  assert(copies.includes(ready.savedRef), 'delivery y copied the saved full continuation reference');
  assert(copies.some((value) => value.startsWith('原生会话来源：')), 'status y copied the selected observed state');
  assert(copies.includes(ready.mailboxFile), 'outbox y copied the complete local mirror path');
  assert(copies.includes(ready.longLine), 'long-line copy preserves the complete Unicode value');
  assert(copies.includes('BROKER-LATEST'), 'upward navigation paused and selected the previous sampled line');
  assert.equal(copies.filter((value) => value === 'APPEND-WHILE-PAUSED-中文👩‍💻').length, 2, 'resume and End each select the latest line');
  assert(copies.includes('MATCH-之后-中文👩‍💻'), 'zero-match filtering kept observing later matching lines');
  assert(copies.includes('ROTATED-LATEST👩‍💻'), 'rotation resumed on the new file');
  assert(copies.includes('仅示例：在本机检查fixture配置；不会自动修复。'));
  assert(events.some((event) => event.event === 'resource-read' && event.resourceId === 'deliveries' && JSON.parse(event.route.query?.sessionRef ?? 'null')?.nativeId === ready.sessionRef.nativeId), 'session relation uses the full SessionRef');
  assert(events.some((event) => event.event === 'resource-read' && event.resourceId === 'outbox' && event.route.query?.pairId === ready.pairId));
  assert(events.some((event) => event.event === 'resource-read' && event.resourceId === 'deliveries' && event.route.query?.pairId === ready.pairId));
  assert(events.some((event) => event.event === 'resource-read' && event.resourceId === 'logs' && event.route.query?.pairId === ready.pairId));
  assert.equal(events.filter((event) => event.event === 'doctor-read').length, 2, 'only explicit entry and r ran doctor');
  assert(normal.pty.output.includes('👩‍💻'));
} finally { await normal.pty.dispose(); }

const interrupt = await session('observations-ctrl-c', 'interrupt');
try {
  await interrupt.pty.waitForOutput('本机观察fixture');
  await interrupt.send('\x03');
  const events = await interrupt.finish(0);
  assert.equal(events.filter((event) => event.event === 'resource-read' || event.event === 'doctor-read').length, 0, 'ctx does not auto-read observation resources');
} finally { await interrupt.pty.dispose(); }

const failure = await session('observations-process-failure', 'failure');
try {
  await failure.pty.waitForOutput('本机观察fixture');
  await failure.pty.waitForOutput('异常退出');
  await failure.finish(1);
} finally { await failure.pty.dispose(); }

process.stdout.write(`${JSON.stringify({ directory, results }, null, 2)}\n`);
