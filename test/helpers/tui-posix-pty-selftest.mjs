import assert from 'node:assert/strict';
import console from 'node:console';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { launchPty } from './tui-pty-driver.mjs';

assert(['linux', 'darwin'].includes(process.platform), 'This native fixture requires a POSIX runner.');
assert(process.argv[2], 'Supply an owned development evidence directory.');
const evidence = resolve(process.argv[2]);
await mkdir(evidence, { recursive: true });
const checks = [];
let active;
async function check(name, work) {
  try { await work(); checks.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  finally { await active?.dispose(); active = undefined; }
}
async function launch(name, script, args = [], options = {}) {
  active = await launchPty({ executable: process.execPath, args: ['--input-type=module', '-e', script, ...args],
    columns: 80, rows: 24, logPath: join(evidence, name + '.jsonl'), ...options });
  return active;
}
function stopped(pid) {
  try { process.kill(pid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; }
}
const report = { platform: process.platform, arch: process.arch, node: process.version, scope: 'Owned POSIX PTY fixtures; no DSH or user session', status: 'failed', checks };
try {
  await check('real-tty-unicode-resize-and-normal-exit', async () => {
    const script = `
      import process from 'node:process';
      process.stdin.setRawMode(true); process.stdin.setEncoding('utf8');
      const report = () => console.log(JSON.stringify({tty:process.stdin.isTTY && process.stdout.isTTY,columns:process.stdout.columns,rows:process.stdout.rows}));
      process.stdout.on('resize',report); report();
      let text=''; process.stdin.on('data', chunk => { text+=chunk; console.log(JSON.stringify({input:text})); if(text.endsWith('DONE')) { process.stdin.setRawMode(false); process.stdout.write('RESTORED'); process.exit(0); } });
    `;
    const pty = await launch('terminal', script);
    await pty.waitForOutput('"tty":true,"columns":80,"rows":24');
    pty.resize(40, 12); await pty.waitForOutput('"columns":40,"rows":12');
    pty.write('中文😀'); await pty.waitForOutput('"input":"中文😀"');
    pty.write('DONE'); await pty.waitForOutput('RESTORED');
    assert.deepEqual(await pty.exited, { code: 0, hostCode: 0 }); assert(stopped(pty.childPid));
  });
  await check('literal-argv-and-split-utf8-output', async () => {
    const args = ['argument with spaces', 'literal $HOME $(printf SHOULD_NOT_RUN)', '中文😀'];
    const script = `
      import process from 'node:process';
      console.log(JSON.stringify({args:process.argv.slice(1)}));
      const bytes=Buffer.from('中文😀'); let at=0;
      const timer=setInterval(()=>{process.stdout.write(bytes.subarray(at,++at));if(at===bytes.length){clearInterval(timer);process.stdout.write('COMPLETE');}},5);
    `;
    const pty = await launch('arguments', script, args);
    await pty.waitForOutput(JSON.stringify({ args })); await pty.waitForOutput('中文😀COMPLETE');
    assert.deepEqual(await pty.exited, { code: 0, hostCode: 0 }); assert(stopped(pty.childPid));
  });
  await check('nonzero-child-exit-remains-visible', async () => {
    const pty = await launch('nonzero', 'console.log("NONZERO"); process.exit(7);');
    await pty.waitForOutput('NONZERO'); assert.deepEqual(await pty.exited, { code: 7, hostCode: 0 });
    await assert.rejects(pty.waitForOutput('will-not-appear', 100), /exited/i); assert(stopped(pty.childPid));
  });
  await check('raw-control-input-restores-and-exits', async () => {
    const pty = await launch('control', `process.stdin.setRawMode(true);console.log('CONTROL_READY');process.stdin.on('data',b=>{if(b.includes(3)){process.stdin.setRawMode(false);console.log('CONTROL_RESTORED');process.exit(0);}});`);
    await pty.waitForOutput('CONTROL_READY'); pty.write('\x03'); await pty.waitForOutput('CONTROL_RESTORED');
    assert.deepEqual(await pty.exited, { code: 0, hostCode: 0 }); assert(stopped(pty.childPid));
  });
  await check('dispose-reaps-owned-child-and-is-idempotent', async () => {
    const pty = await launch('dispose', `console.log('DISPOSE_READY');setInterval(()=>{},1000);`);
    await pty.waitForOutput('DISPOSE_READY'); await pty.dispose(); await pty.dispose();
    assert(stopped(pty.childPid)); assert.equal((await pty.exited).hostCode, 0);
  });
  await check('dispose-escalates-an-owned-term-resistant-child', async () => {
    const pty = await launch('force', `process.on('SIGTERM',()=>{});console.log('FORCE_READY');setInterval(()=>{},1000);`);
    await pty.waitForOutput('FORCE_READY'); const started = Date.now(); await pty.dispose();
    assert(Date.now() - started < 3000); assert(stopped(pty.childPid));
    assert.equal((await pty.exited).hostCode, 0);
    assert(pty.events.some(event => event.event === 'cleanup' && event.forced === true && event.groupReleased === true));
  });
  await check('startup-failure-does-not-return-a-controller', async () => {
    await assert.rejects(launchPty({ executable: join(evidence, 'missing-executable'), logPath: join(evidence, 'startup.jsonl') }), /No such file|not found|ENOENT/i);
  });
  report.status = 'passed';
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await active?.dispose();
  await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
