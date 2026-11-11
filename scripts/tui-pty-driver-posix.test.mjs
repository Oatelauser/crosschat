import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { launchPty } from '../test/helpers/tui-pty-driver.mjs';

test('POSIX PTY forwards terminal input, reports output, resizes and releases its child', { skip: process.platform !== 'linux' }, async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'crosschat-posix-pty-test-'));
  context.after(async () => rm(root, { recursive: true, force: true }));

  const probe = [
    "const report = () => process.stdout.write(`TTY:${process.stdin.isTTY}:${process.stdout.isTTY}:${process.stdout.columns}x${process.stdout.rows}\\n`);",
    "process.on('SIGWINCH', report);",
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
