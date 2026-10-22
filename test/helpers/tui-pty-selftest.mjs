import assert from 'node:assert/strict';
import { launchPty } from './tui-pty-driver.mjs';

if (process.platform !== 'win32') throw new Error('The ConPTY self-test requires Windows.');

const script = `
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  const report = (event, data = {}) => console.log(JSON.stringify({event, ...data}));
  report('dimensions', {columns: process.stdout.columns, rows: process.stdout.rows});
  process.stdout.on('resize', () => report('dimensions', {columns: process.stdout.columns, rows: process.stdout.rows}));
  let received = '';
  process.stdin.on('data', text => {
    received += text;
    report('input', {text: received});
    if (received.includes('DONE')) {
      process.stdin.setRawMode(false);
      report('restored', {raw: process.stdin.isRaw});
      process.exit(0);
    }
  });
`;

const pty = await launchPty({
  executable: process.execPath,
  args: ['--input-type=module', '-e', script],
  columns: 80,
  rows: 24,
});
try {
  await pty.waitForOutput('"columns":80,"rows":24');
  pty.resize(40, 12);
  await pty.waitForOutput('"columns":40,"rows":12');
  pty.write('中文😀');
  await pty.waitForOutput('"text":"中文😀"');
  pty.write('DONE');
  await pty.waitForOutput('"raw":false');
  const result = await pty.exited;
  assert.equal(result.code, 0);
  assert.equal(result.hostCode, 0);
  console.log(JSON.stringify({
    result: 'PASS',
    childPid: pty.childPid,
    dimensions: [[80, 24], [40, 12]],
    input: '中文😀',
    restored: true,
    childCode: result.code,
    hostCode: result.hostCode,
    log: pty.logPath,
  }));
} finally {
  await pty.dispose();
}
