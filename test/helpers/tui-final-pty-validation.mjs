import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { launchPty } from './tui-pty-driver.mjs';

const directory = await mkdtemp(join(tmpdir(), 'crosschat-tui-final-validation-'));
const evidence = join(directory, 'cross-resource-chain.jsonl');
const isolatedHome = join(directory, 'home');
const pty = await launchPty({ executable: process.execPath, args: [fileURLToPath(new URL('./tui-final-fixture.mjs', import.meta.url))], columns: 100, rows: 28,
  env: { TUI_FINAL_HOME: isolatedHome, TUI_FINAL_EVIDENCE: evidence }, logPath: join(directory, 'cross-resource-chain-pty.jsonl') });
const escape = '\x1b';
const home = '\x1b[H';
const end = '\x1b[F';
async function events() {
  try { return (await readFile(evidence, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function waitEvent(predicate, from = 0) {
  const expires = Date.now() + 7000;
  while (Date.now() < expires) { const event = (await events()).slice(from).find(predicate); if (event) return event; await delay(25); }
  throw new Error(`Final-chain evidence did not match: ${evidence}`);
}
async function send(input, expected) { const mark = pty.output.length; pty.write(input); if (expected) await pty.waitForOutput(expected, 10_000, mark); }
async function copy(key = 'y') { const mark = (await events()).length; pty.write(key); return waitEvent((event) => event.event === 'clipboard', mark); }
async function command(name, expected) { await send(`:${name}\r`, expected); }

try {
  await pty.waitForOutput('final-remote');
  const ready = await waitEvent((event) => event.event === 'fixture-ready');
  assert(!(await events()).some((event) => ['local-sessions', 'ssh-sessions', 'tcp-star', 'local-doctor', 'ssh-doctor'].includes(event.event)), 'ctx startup never probes application sources');
  await send(home + '\r', 'FINAL-LOCAL-SECOND');
  await send(end);
  assert.deepEqual(JSON.parse((await copy('Y')).value), ready.secondRef);
  await send(':ser', 'services');
  await send(escape, 'FINAL-LOCAL-SECOND');
  assert.deepEqual(JSON.parse((await copy('Y')).value), ready.secondRef, 'cancelling command/filter draft restores exact selection');
  await send(':FINAL-LOCAL-TARGET', 'Enter');
  await send('\r', 'FINAL-LOCAL-TARGET');
  assert.deepEqual(JSON.parse((await copy('Y')).value), ready.localRef, 'non-command input filters the same resource by its full original value');
  await send('?', '会话 · 全部按键');
  await send(end, '读取信息');
  await send(escape, 'FINAL-LOCAL-TARGET');
  assert.deepEqual(JSON.parse((await copy('Y')).value), ready.localRef, 'help restores the selected, filtered resource');
  await command('status', '原生会话来源');
  await command('doctor', 'FINAL-LOCAL-DOCTOR');
  await send(':ser', 'services');
  await send('\t\r', 'FINAL-SERVICE');
  await send('d', 'FINAL-SERVICE-READONLY');
  await send('a\x04');
  await send(escape, 'FINAL-SERVICE');
  await send('a', '确认提交');
  await send('\r', '已取消操作');
  await command('files', '只读元数据');
  await send('d', '只读详情');
  await send('a\x04');
  await send(escape, '只读元数据');
  await send('m', /维护任务[^\r\n]*范围[^\r\n]*最近结果/);
  await send('\r', '确认提交');
  await send('\r', '已取消操作');
  assert(!(await events()).some((event) => event.event === 'unexpected-effect'), 'readonly details and default cancel never execute service or maintenance');
  await command('ctx', 'final-remote');
  await send('a', '选择已有 SSH Host');
  await send(home + '\r', '已有 SSH Host');
  await send('a', '选择已有 SSH Host（当前配置已自动包含）');
  await send('\r', '1 个可发现会话');
  assert.equal(JSON.parse((await copy('Y')).value).contextId, ready.sshId);
  await command('ssh', '已有 SSH Host');
  await send(home + 'D', 'Node 版本');
  assert((await copy()).value.includes('final-remote'), 'SSH doctor retains remote Host execution guidance');
  await command('ctx', 'final-remote');
  await send('a', '导入现有 TCP 配置');
  await send(end + '\r', 'Enter/a 打开私密输入与确认');
  await send('\r', '现有 TCP 配置 JSON（私密）');
  const key = 'FINAL-SYNTHETIC-IMPORT-SECRET-NEVER-A-REAL-KEY';
  const content = JSON.stringify({ brokers: [{ host: 'fixture.invalid', port: 7260, starId: ready.starId, name: 'FINAL-IMPORTED-STAR', key }], fixturePreserved: true });
  await send(content);
  await send('\r', '确认提交');
  await send('\t\r', '影响范围已更新');
  await waitEvent((event) => event.event === 'import-preview' && event.enabled);
  assert(!pty.output.includes(key) && !pty.output.includes(content), 'private form and preview never expose imported credential');
  const beforeImport = (await events()).length;
  await send('\t\r', '已追加本机配置');
  await waitEvent((event) => event.event === 'import-applied' && event.status === 'applied', beforeImport);
  assert(!(await events()).slice(beforeImport).some((event) => ['tcp-star', 'tcp-sessions'].includes(event.event)), 'successful import does not authenticate or start a TCP read');
  assert.equal((await copy()).value, 'fixture.invalid:7260', 'authoritative ctx refresh selects the real imported row rather than the preceding SSH row');
  const saved = JSON.parse(await readFile(join(ready.baseDir, 'tcp', 'node.json'), 'utf8'));
  assert.deepEqual(saved, JSON.parse(content), 'real temporary import preserves exact current-format document');
  await send('\r', 'FINAL-TCP-MACHINE');
  await waitEvent((event) => event.event === 'tcp-star' && event.contextId === ready.importedId);
  assert.equal((await copy()).value, ready.machineId);
  await send('v', '全星会话');
  await waitEvent((event) => event.event === 'tcp-sessions' && event.contextId === ready.importedId && !event.machineId);
  await send('\r', '星内成员册');
  await waitEvent((event) => event.event === 'tcp-sessions' && event.machineId === ready.machineId);
  assert(JSON.parse((await copy('Y')).value).contextId.includes(ready.machineId));
  await send(escape, '全星会话');
  await send(escape, 'FINAL-TCP-MACHINE');
  assert.equal((await copy()).value, ready.machineId, 'back restores machine identity after nested all-star and node sessions');
  await send('m', 'FINAL-TCP-MEMBER');
  await send('?', '成员册 · 全部按键');
  await send(end, '读取信息');
  await send(escape, 'FINAL-TCP-MEMBER');
  await send(escape, 'FINAL-TCP-MACHINE');
  await send('p', 'FINAL-NODE-CREDENTIAL');
  await send('d', '只读详情');
  await send('a\x04');
  await send(escape, 'FINAL-NODE-CREDENTIAL');
  await send(escape, 'FINAL-TCP-MACHINE');
  await command('ctx', 'FINAL-IMPORTED-STAR');
  await send(home + '\r', 'FINAL-LOCAL-TARGET');
  assert.deepEqual(JSON.parse((await copy('Y')).value), ready.localRef, 'returning to local restores the earlier exact selection and filter using local sources');
  await command('ctx', 'FINAL-IMPORTED-STAR');
  await send('q');
  let timer;
  let exited;
  try { exited = await Promise.race([pty.exited, new Promise((_, reject) => { timer = globalThis.setTimeout(() => reject(new Error(`Final chain did not exit: ${evidence}`)), 12_000); })]); }
  finally { globalThis.clearTimeout(timer); }
  assert.equal(exited.code, 0); assert.equal(exited.hostCode, 0);
  const all = await events();
  const exit = all.find((event) => event.event === 'exit');
  assert(exit); assert.deepEqual(exit.after, exit.before); assert.equal(exit.fileUnchanged, true); assert(exit.contextIds.includes(ready.importedId));
  assert.deepEqual(all.filter((event) => event.event === 'import-applied').map((event) => event.status), ['applied']);
  assert(all.filter((event) => ['local-sessions', 'local-status', 'local-doctor', 'services'].includes(event.event)).every((event) => event.contextId === 'local'));
  assert(all.filter((event) => ['ssh-sessions', 'ssh-doctor'].includes(event.event)).every((event) => event.contextId === ready.sshId));
  assert(all.filter((event) => ['tcp-star', 'tcp-sessions'].includes(event.event)).every((event) => event.contextId === ready.importedId));
  assert(!all.some((event) => event.event === 'unexpected-effect'));
  assert(!pty.output.includes(key), 'private imported key never occurs in terminal output');
  for (const mode of ['1049', '25', '2004']) { const enabled = pty.output.lastIndexOf(`\x1b[?${mode}h`), disabled = pty.output.lastIndexOf(`\x1b[?${mode}l`); assert(mode === '25' ? enabled > disabled : disabled > enabled, `terminal mode ${mode} restored`); }
  assert(!pty.output.includes('\ufffd'), 'valid UTF-8 is preserved');
  process.stdout.write(`${JSON.stringify({ directory, results: [{ name: 'cross-resource-chain-and-private-import', code: exited.code, terminalRestored: true, evidence, log: pty.logPath, contextIds: exit.contextIds }] }, null, 2)}\n`);
} finally { await pty.dispose(); }
