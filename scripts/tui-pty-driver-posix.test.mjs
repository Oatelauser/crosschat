import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { launchPty } from '../test/helpers/tui-pty-driver.mjs';

const linux = { skip: process.platform !== 'linux' };
const cleanEnvironment = () => ({ ...Object.fromEntries(Object.keys(process.env).map((key) => [key, undefined])), TERM: 'xterm-256color' });

async function temporaryRoot(context) {
  const root = await mkdtemp(join(tmpdir(), 'crosschat-posix-pty-test-'));
  context.after(async () => rm(root, { recursive: true, force: true }));
  return root;
}

async function within(promise, milliseconds) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PTY did not finish bounded cleanup')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

async function launchProbe(root, source) {
  const pty = await launchPty({ executable: process.execPath, args: ['-e', source], cwd: root, columns: 92, rows: 28,
    env: cleanEnvironment(), logPath: join(root, 'events.jsonl') });
  const fields = (await readFile(`/proc/${pty.childPid}/stat`, 'utf8')).split(') ')[1].split(' ');
  const hostPid = Number(fields[1]);
  return { pty, async finish() {
    // Test failure recovery targets only this known live host and its own process group.
    if (alive(hostPid)) {
      try { process.kill(-pty.childPid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      process.kill(hostPid, 'SIGKILL');
    }
    await within(pty.exited.catch(() => {}), 2000);
  } };
}

test('POSIX PTY forwards terminal input, reports output, resizes and releases its child', linux, async (context) => {
  const root = await temporaryRoot(context);

  const probe = [
    "const report = () => process.stdout.write(`TTY:${process.stdin.isTTY}:${process.stdout.isTTY}:${process.stdout.columns}x${process.stdout.rows}\\n`);",
    "process.stdout.on('resize', report);",
    "report();",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.once('data', value => { process.stdout.write(`INPUT:${value.trim()}\\n`); process.exit(0); });",
  ].join('');
  const pty = await launchPty({ executable: process.execPath, args: ['-e', probe], cwd: root, columns: 92, rows: 28,
    env: { ...Object.fromEntries(Object.keys(process.env).map((key) => [key, undefined])), TERM: 'xterm-256color' },
    logPath: join(root, 'events.jsonl') });

  try {
    await pty.waitForOutput('TTY:true:true:92x28', 5000);
    pty.resize(47, 19);
    await pty.waitForOutput('TTY:true:true:47x19', 5000);
    assert.ok(pty.events.some((event) => event.event === 'resized' && event.columns === 47 && event.rows === 19));
    pty.write('posix-pty-input\n');
    await pty.waitForOutput('INPUT:posix-pty-input', 5000);
    assert.deepEqual(await pty.exited, { code: 0, hostCode: 0 });
  } finally {
    await pty.dispose();
  }
});

test('POSIX PTY rejects failed executable startup and closes its host', linux, async (context) => {
  const root = await temporaryRoot(context);
  await assert.rejects(within(launchPty({ executable: join(root, 'does-not-exist'), cwd: root,
    env: cleanEnvironment(), logPath: join(root, 'events.jsonl') }), 5000), /No such file|not found/);
});

test('POSIX PTY disposal kills and reaps a TERM-ignoring child and its descendant', linux, async (context) => {
  const root = await temporaryRoot(context);
  const grandchild = "process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {}); console.log('DESCENDANT:'+process.pid); setInterval(() => {}, 1000);";
  const source = `process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {}); require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], {stdio:'inherit'}); setInterval(() => {}, 1000);`;
  const { pty, finish } = await launchProbe(root, source);
  try {
    await pty.waitForOutput(/DESCENDANT:\d+/, 5000);
    const descendant = Number(/DESCENDANT:(\d+)/.exec(pty.output)[1]);
    await within(pty.dispose(), 6000);
    assert.equal(alive(pty.childPid), false, 'dispose waits for the direct child to be reaped');
    assert.equal(alive(descendant), false, 'dispose waits for the adopted descendant to be reaped');
  } finally { await finish(); }
});

test('POSIX PTY releases descendants holding the slave after the leader exits', linux, async (context) => {
  const root = await temporaryRoot(context);
  const grandchild = "process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {}); console.log('DESCENDANT:'+process.pid); setInterval(() => {}, 1000);";
  const source = `const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], {stdio:['inherit','pipe','inherit']}); child.stdout.once('data', data => { process.stdout.write(data, () => process.exit(0)); });`;
  const { pty, finish } = await launchProbe(root, source);
  try {
    await pty.waitForOutput(/DESCENDANT:\d+/, 5000);
    const descendant = Number(/DESCENDANT:(\d+)/.exec(pty.output)[1]);
    assert.deepEqual(await within(pty.exited, 6000), { code: 0, hostCode: 0 });
    assert.equal(alive(descendant), false, 'leader exit cannot leave an owned descendant holding the terminal');
  } finally { await finish(); }
});

test('POSIX PTY releases a live child after it closes its terminal descriptors', linux, async (context) => {
  const root = await temporaryRoot(context);
  const source = "console.log('CLOSING_TTY'); setTimeout(() => { for (const fd of [0,1,2]) require('node:fs').closeSync(fd); setInterval(() => {}, 1000); }, 100);";
  const { pty, finish } = await launchProbe(root, source);
  try {
    await pty.waitForOutput('CLOSING_TTY', 5000);
    await within(pty.exited, 6000);
    assert.equal(alive(pty.childPid), false, 'a closed slave does not leave child.wait hanging');
  } finally { await finish(); }
});

test('POSIX PTY preserves a large raw input across partial terminal writes', linux, async (context) => {
  const root = await temporaryRoot(context);
  const input = 'partial-input-中文😀'.repeat(16000);
  const bytes = Buffer.byteLength(input);
  const digest = createHash('sha256').update(input).digest('hex');
  const source = `process.stdin.setRawMode(true); const chunks=[]; let size=0; console.log('RAW_READY'); process.stdin.on('data', chunk => { chunks.push(chunk); size+=chunk.length; if(size === ${bytes}) { console.log('SHA:'+require('node:crypto').createHash('sha256').update(Buffer.concat(chunks)).digest('hex')); process.exit(0); } });`;
  const { pty, finish } = await launchProbe(root, source);
  try {
    await pty.waitForOutput('RAW_READY', 5000);
    pty.write(input);
    await pty.waitForOutput(`SHA:${digest}`, 5000);
    assert.deepEqual(await within(pty.exited, 6000), { code: 0, hostCode: 0 });
  } finally { await finish(); }
});
