import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import process from 'node:process';
import console from 'node:console';
import { listClaudeSessions } from '../../dist/claude/registry.js';
import { resolveClaudeExe } from '../../dist/claude/resolve-exe.js';
import { prepareClaudeProfile, runClaudeCommand, createClaudeMockModel } from './native-claude-fixture.mjs';
import { launchPty } from './tui-pty-driver.mjs';

const sdk = process.env.CROSSCHAT_NATIVE_CLAUDE_SDK;
assert(sdk, 'Set the downloaded official SDK module path.');
const directory = await mkdtemp(join(tmpdir(), 'crosschat-claude-rename-'));
const model = await createClaudeMockModel(async () => ({ text: 'RENAME_FIXTURE_ACK' }));
let pty;
const evidence = { directory, sdk, beforeName: 'CROSSCHAT_BEFORE_RENAME', afterName: 'CROSSCHAT_AFTER_RENAME' };
try {
  const env = await prepareClaudeProfile(directory, model.url);
  await writeFile(join(env.CLAUDE_CONFIG_DIR, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', bypassPermissionsModeAccepted: true }));
  const clean = { ...Object.fromEntries(Object.keys(process.env).map((key) => [key, undefined])), ...env, TERM: 'xterm-256color' };
  pty = await launchPty({ executable: resolveClaudeExe(), args: ['--settings', '{"crossSessionInbound":"accept"}', '-n', evidence.beforeName],
    env: clean, cwd: join(directory, 'workspace'), columns: 100, rows: 28, logPath: join(directory, 'native-pty.jsonl') });
  await delay(2500);
  if (pty.output.includes('trust')) { pty.write('\x1b[B\r'); await delay(1500); }
  if (pty.output.includes('Detected')) { pty.write('\x1b[A\r'); await delay(1000); }
  pty.write('fixture rename first input\r');
  await pty.waitForOutput('RENAME_FIXTURE_ACK', 20000);
  const entry = () => listClaudeSessions(join(env.CLAUDE_CONFIG_DIR, 'sessions')).sessions.find((item) => item.pid === pty.childPid);
  const before = entry(); assert(before?.sessionId);
  evidence.sessionId = before.sessionId; evidence.nativePid = before.pid; evidence.beforeRegistryName = before.name;
  // The profile is isolated; searching it avoids Windows short/long project-path aliases.
  await delay(1500);
  const code = `import {renameSession,getSessionInfo} from ${JSON.stringify(pathToFileURL(sdk).href)}; try { await renameSession(${JSON.stringify(before.sessionId)},${JSON.stringify(evidence.afterName)}); const info=await getSessionInfo(${JSON.stringify(before.sessionId)}); console.log(JSON.stringify({id:info?.sessionId,title:info?.customTitle})); } catch(error) { console.error(error.message); process.exitCode=1; }`;
  const result = await runClaudeCommand(process.execPath, ['--input-type=module', '-e', code], { cwd: join(directory, 'workspace'), env, timeout: 10000 });
  evidence.sdkExit = result.code; evidence.sdkResult = result.stdout; evidence.sdkError = result.stderr;
  assert.equal(result.code, 0, result.stderr);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && entry()?.name !== evidence.afterName) await delay(100);
  evidence.registryAfterExternalRename = entry()?.name;
  pty.write('fixture rename second input\r'); await delay(2000);
  evidence.registryAfterNextInput = entry()?.name;
  pty.write('/resume\r'); await delay(800);
  evidence.frontendObserved = pty.output.includes(evidence.afterName);
  pty.write('\x1b'); await delay(100);
  pty.write('\x03'); await delay(200); pty.write('\x03');
  evidence.exit = await pty.exited;
  evidence.liveNameSynchronized = evidence.registryAfterExternalRename === evidence.afterName;
  console.log(JSON.stringify(evidence));
} finally {
  await pty?.dispose(); await model.close();
  await writeFile(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2));
}
