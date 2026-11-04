import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { launchPty } from './tui-pty-driver.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = fileURLToPath(new URL('./c14-tui-fixture.mjs', import.meta.url));
const tempBase = resolve(tmpdir());
const temporary = await mkdtemp(join(tempBase, 'crosschat-c14-tui-'));
const evidenceBase = join(workspace, 'docs/development/evidence/c14-tui-20261028');
await mkdir(evidenceBase, { recursive: true });
const directory = await mkdtemp(join(evidenceBase, 'run-'));
const results = [];
const controllers = new Set();
const end = '\x1b[F', home = '\x1b[H', down = '\x1b[B', esc = '\x1b';
const bounded = async (work, timeout, message) => {
  let timer;
  try { return await Promise.race([work, new Promise((_, reject) => { timer = globalThis.setTimeout(() => reject(new Error(message)), timeout); })]); }
  finally { globalThis.clearTimeout(timer); }
};
async function session(name, scenario = 'keyboard') {
  const evidence = join(directory, `${name}.jsonl`);
  const pty = await launchPty({ executable: process.execPath, args: [fixture], cwd: workspace, columns: 140, rows: 32,
    env: { C14_TUI_HOME: join(temporary, name), C14_TUI_EVIDENCE: evidence, C14_TUI_SCENARIO: scenario }, logPath: join(directory, `${name}-pty.jsonl`) });
  controllers.add(pty);
  const events = async () => { try { return (await readFile(evidence, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; } };
  const waitEvent = async (predicate, from = 0) => {
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) { const found = (await events()).slice(from).find(predicate); if (found) return found; await delay(25); }
    throw new Error(`C14 fixture evidence did not match: ${evidence}`);
  };
  const send = async (input, expected) => { const mark = pty.output.length; pty.write(input); if (expected) await pty.waitForOutput(expected, 10_000, mark); };
  const copy = async (key = 'Y') => { const from = (await events()).length; pty.write(key); return (await waitEvent((event) => event.event === 'clipboard', from)).value; };
  const resize = async (columns, rows) => { const mark = pty.output.length; pty.resize(columns, rows); await pty.waitForOutput('CC · 工作区', 10_000, mark);
    await waitEvent((event) => event.event === 'resize' && event.columns === columns && event.rows === rows); };
  const refresh = async (eventName) => { const from = (await events()).length; await send('r'); await waitEvent((event) => event.event === eventName, from); await delay(120); };
  return { pty, send, copy, events, waitEvent, resize, refresh, async finish(expectedCode, checks = {}) {
    const exited = await bounded(pty.exited, 12_000, `C14 fixture did not exit: ${evidence}`);
    assert.equal(exited.code, expectedCode); assert.equal(exited.hostCode, 0);
    const all = await events(), exit = all.find((event) => event.event === 'exit');
    assert(exit); assert.deepEqual(exit.after, exit.before, 'raw input and owned listeners restored');
    for (const mode of ['1049', '25', '2004']) {
      const enabled = pty.output.lastIndexOf(`\x1b[?${mode}h`), disabled = pty.output.lastIndexOf(`\x1b[?${mode}l`);
      assert(mode === '25' ? enabled > disabled : disabled > enabled, `terminal mode ${mode} restored`);
    }
    assert(!pty.output.includes('c14-private-fixture-failure'));
    assert(!pty.output.includes('\ufffd'), 'valid UTF-8 preserved');
    await writeFile(join(directory, `${name}-terminal.txt`), pty.output);
    results.push({ name, code: exited.code, terminalRestored: true, checks, evidence: basename(evidence), pty: basename(pty.logPath) });
    return all;
  } };
}
let failure;
try {
  const normal = await session('local-and-tcp-types');
  try {
    await normal.pty.waitForOutput('C14-LOCAL');
    await normal.send(home + '\r\r', '2 个可发现会话');
    const first = JSON.parse(await normal.copy());
    await normal.send(down);
    const second = JSON.parse(await normal.copy());
    assert.equal(first.nativeId, second.nativeId); assert.equal(first.providerId, 'codex');
    assert.deepEqual(new Set([first.endpointType, second.endpointType]), new Set(['cli', 'desktop']));
    assert.equal(await normal.copy('y'), `crosschat send --to ${second.nativeId} --tool codex-${second.endpointType} --body "<正文>"`);
    await normal.refresh('local-read');
    assert.deepEqual(JSON.parse(await normal.copy()), second, 'refresh preserves complete local endpoint identity after source order reverses');
    await normal.send('t', 'Enter应用'); await normal.send(end + '\r', 'codex-desktop');
    assert.equal(JSON.parse(await normal.copy()).endpointType, 'desktop');
    await normal.send('t', 'Enter应用'); await normal.send(home + down + down + '\r', 'codex-cli');
    assert.equal(JSON.parse(await normal.copy()).endpointType, 'cli');
    await normal.send('d', '只读详情'); await normal.send(esc, ':sessions');
    await normal.send(':ctx\r', 'C14-TCP');
    await normal.send(end + '\r', 'C14-STAR');
    await normal.send('\r', 'C14-SAME-NAME');
    const memberAddress = await normal.copy('y');
    assert.match(memberAddress, /^crosschat send --via tcp:c14-full-star-identity:12345678123456781234567812345678:11111111-2222-3333-4444-555555555555 --tool codex-(?:cli|desktop) --body "<正文>"$/);
    await normal.send('3', '节点可发现范围');
    const tcpFirst = JSON.parse(await normal.copy());
    await normal.send(down);
    const tcpSecond = JSON.parse(await normal.copy());
    assert.equal(tcpFirst.nativeId, second.nativeId);
    assert.equal(tcpFirst.contextId, tcpSecond.contextId);
    assert.deepEqual(new Set([tcpFirst.endpointType, tcpSecond.endpointType]), new Set(['cli', 'desktop']));
    assert.equal(await normal.copy('y'), `crosschat send --via tcp:c14-full-star-identity:12345678123456781234567812345678:${tcpSecond.nativeId} --tool codex-${tcpSecond.endpointType} --body "<正文>"`);
    await normal.refresh('tcp-sessions');
    assert.deepEqual(JSON.parse(await normal.copy()), tcpSecond, 'refresh preserves selected TCP endpoint identity');
    await normal.send('t', 'Enter应用'); await normal.send(end + '\r', 'codex-desktop');
    assert.equal(JSON.parse(await normal.copy()).endpointType, 'desktop');
    await normal.send('t', 'Enter应用'); await normal.send(home + down + '\r', 'codex-cli');
    assert.equal(JSON.parse(await normal.copy()).endpointType, 'cli');
    await normal.resize(48, 16); await normal.resize(140, 32);
    assert.equal(JSON.parse(await normal.copy()).endpointType, 'cli');
    await normal.send('q');
    const events = await normal.finish(0, { sameProviderAndNativeId: true, localAndTcpTypedCopies: true,
      localAndTcpToolFilters: true, reorderedRefreshPreservesSelection: true, resize: [[48, 16], [140, 32]], normalExit: true });
    assert.equal(events.filter((event) => event.event === 'local-membership-write').length, 0);
  } finally { await normal.pty.dispose(); controllers.delete(normal.pty); }
  const interrupt = await session('ctrl-c', 'interrupt');
  try { await interrupt.pty.waitForOutput('C14-LOCAL'); await interrupt.send(home + '\r\r', '2 个可发现会话'); await interrupt.send('\x03');
    await interrupt.finish(0, { interruptOnTypedSessionList: true }); }
  finally { await interrupt.pty.dispose(); controllers.delete(interrupt.pty); }
  const injected = await session('exception', 'failure');
  try { await injected.pty.waitForOutput('C14-LOCAL'); await injected.send(home + '\r\r', '2 个可发现会话'); await injected.pty.waitForOutput('异常退出');
    await injected.finish(1, { expectedInjectedFailure: true }); }
  finally { await injected.pty.dispose(); controllers.delete(injected.pty); }
} catch (error) { failure = { name: error.name, message: error.message }; }
finally {
  for (const pty of controllers) await pty.dispose();
  assert.equal(dirname(resolve(temporary)), tempBase); assert(basename(temporary).startsWith('crosschat-c14-tui-'));
  await rm(temporary, { recursive: true, force: true });
  const distHashes = {};
  for (const path of ['tui/main.js', 'tui/resources/sessions.js', 'tui/resources/tcp.js', 'tool-types.js']) {
    distHashes[path] = createHash('sha256').update(await readFile(join(workspace, 'dist', path))).digest('hex');
  }
  const summary = { recordedAt: new Date().toISOString(), platform: process.platform, node: process.version,
    source: 'Windows ConPTY; final built TUI, synthetic application inputs; no native tools or remote hosts',
    directory, temporaryRootRemoved: temporary, distHashes, results, ...(failure ? { failure } : {}) };
  await writeFile(join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
if (failure) process.exitCode = 1;
