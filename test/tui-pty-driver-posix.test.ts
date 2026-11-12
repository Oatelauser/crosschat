import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const suite = fileURLToPath(new URL('../scripts/tui-pty-driver-posix.test.mjs', import.meta.url));

function runPosixPtySuite(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ['--test', '--test-reporter=tap', suite], {
      cwd: repositoryRoot,
      env: { ...process.env, CROSSCHAT_LIVE: undefined },
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`POSIX PTY behavior suite failed.\n${stdout}\n${stderr}`, { cause: error }));
        return;
      }
      resolve(stdout);
    });
  });
}

it.skipIf(process.platform !== 'linux')('runs the real Linux PTY behavior suite with no failures or skipped cases', async () => {
  const output = await runPosixPtySuite();
  expect(output).toMatch(/^# tests [1-9]\d*$/mu);
  expect(output).toMatch(/^# fail 0$/mu);
  expect(output).toMatch(/^# cancelled 0$/mu);
  expect(output).toMatch(/^# skipped 0$/mu);
  expect(output).toMatch(/^# todo 0$/mu);
  expect(output).not.toMatch(/^not ok\b/mu);
}, 35_000);
