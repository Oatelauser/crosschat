import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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

async function launchProbe(root, source, command = { executable: process.execPath, args: ['-e', source] }) {
  const pty = await launchPty({ ...command, cwd: root, columns: 92, rows: 28,
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

test('POSIX PTY disposal releases a descendant that starts a separate session', linux, async (context) => {
  const root = await temporaryRoot(context);
  const grandchild = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);";
  const source = `const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], {detached:true, stdio:'ignore'}); console.log('DESCENDANT:'+child.pid); setInterval(() => {}, 1000);`;
  const { pty, finish } = await launchProbe(root, source);
  let descendant;
  try {
    await pty.waitForOutput(/DESCENDANT:\d+/, 5000);
    descendant = Number(/DESCENDANT:(\d+)/.exec(pty.output)[1]);
    await within(pty.dispose(), 6000);
    assert.equal(alive(descendant), false, 'dispose cannot report success with an adopted detached descendant alive');
  } finally {
    if (descendant && alive(descendant)) process.kill(descendant, 'SIGKILL');
    await finish();
  }
});

test('POSIX PTY host cleans its process group after its event reader disconnects', linux, async (context) => {
  const root = await temporaryRoot(context);
  const source = "process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {}); console.log('CHILD_PID:'+process.pid); setTimeout(() => { process.stdout.write('OWNED_OUTPUT\\n', () => { for (const fd of [0,1,2]) require('node:fs').closeSync(fd); setInterval(() => {}, 1000); }); }, 500);";
  const spec = Buffer.from(JSON.stringify({ executable: process.execPath, args: ['-e', source], cwd: root, columns: 80, rows: 24 })).toString('base64');
  const host = spawn('python3', [fileURLToPath(new URL('../test/helpers/tui-pty-host.py', import.meta.url)), spec], {
    cwd: root, env: cleanEnvironment(), stdio: ['pipe', 'pipe', 'pipe'],
  });
  const hostPid = host.pid;
  let childPid;
  let hostCode;
  let hostClosed;
  const closed = new Promise((resolve) => { hostClosed = resolve; });
  let buffer = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PTY host did not report its owned child')), 5000);
    host.stdout.setEncoding('utf8');
    host.stdout.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const event = JSON.parse(line);
          if (event.event === 'output' && Buffer.from(event.data, 'base64').includes(Buffer.from('CHILD_PID:'))) {
            childPid = Number(/CHILD_PID:(\d+)/.exec(Buffer.from(event.data, 'base64').toString('utf8'))?.[1]);
            clearTimeout(timer);
            resolve();
            host.stdout.destroy();
          }
        } catch (error) { clearTimeout(timer); reject(error); }
      }
    });
    host.on('error', (error) => { clearTimeout(timer); reject(error); });
  });
  host.on('close', (code) => { hostCode = code; hostClosed(); });
  try {
    await ready;
    await within(closed, 6000);
    assert.equal(hostCode, 0, 'a closed event channel does not fail owned process cleanup');
    assert.equal(alive(childPid), false, 'event delivery failure must not interrupt owned process teardown');
  } finally {
    if (hostPid && alive(hostPid)) {
      if (childPid) {
        try { process.kill(-childPid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
      process.kill(hostPid, 'SIGKILL');
    }
    await within(closed, 2000);
  }
});

test('POSIX PTY releases a live child after it closes its terminal descriptors', linux, async (context) => {
  const root = await temporaryRoot(context);
  const source = "import os, time; print('CLOSING_TTY', flush=True); time.sleep(0.1); [os.close(fd) for fd in [0, 1, 2]]; time.sleep(30)";
  const { pty, finish } = await launchProbe(root, source, { executable: 'python3', args: ['-c', source] });
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
