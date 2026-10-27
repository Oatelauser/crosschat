import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClaudeSessionBinding } from '../../dist/claude/session-events.js';
import { prepareClaudeProfile, runClaudeCommand, createClaudeMockModel } from './native-claude-fixture.mjs';
import { launchPty } from './tui-pty-driver.mjs';
import { listClaudeSessions } from '../../dist/claude/registry.js';
import { setTimeout as delay } from 'node:timers/promises';

// Explicit native acceptance helper, outside Vitest; all model traffic stays on loopback.
const directory = await mkdtemp(join(tmpdir(), 'crosschat-native-selection-'));
const binary = process.env.CROSSCHAT_NATIVE_CLAUDE;
assert(binary, 'Set the exact installed native Claude binary path.');
const model = await createClaudeMockModel(async () => ({ text: 'SELECTION_FIXTURE_ACK' }));
const events = [];
const env = await prepareClaudeProfile(directory, model.url);
const sessionId = randomUUID();
async function invoke(args) {
  const binding = await createClaudeSessionBinding({ args, onSelection: (event) => events.push(event) });
  try {
    const result = await runClaudeCommand(binary, binding.args, { cwd: join(directory, 'workspace'), env, timeout: 45000 });
    await writeFile(join(directory, `native-${events.length}.json`), JSON.stringify({ ...result, events }, null, 2));
    assert.equal(result.code, 0, result.stderr);
    assert(result.stdout.includes('SELECTION_FIXTURE_ACK'), result.stdout);
  } finally { await binding.close(); }
}
try {
  await invoke(['-p', '--session-id', sessionId, '--output-format', 'json', 'fixture first input']);
  assert(events.some((event) => event.kind === 'selected' && event.sessionId === sessionId), JSON.stringify(events));
  const before = events.length;
  await invoke(['-p', '--resume', sessionId, '--output-format', 'json', 'fixture resumed input']);
  assert(events.slice(before).some((event) => event.kind === 'selected' && event.sessionId === sessionId));
  assert.equal(model.errors.length, 0);
  if (process.argv.includes('--interactive')) {
    // Profile is isolated. These flags only skip first-run preference screens in this fixture.
    await writeFile(join(env.CLAUDE_CONFIG_DIR, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', bypassPermissionsModeAccepted: true }));
    let nativePid;
    const binding = await createClaudeSessionBinding({ args: [], onSelection: (event) => events.push(event),
      currentSessionId: () => listClaudeSessions(join(env.CLAUDE_CONFIG_DIR, 'sessions')).sessions.find((item) => item.pid === nativePid)?.sessionId,
      onUnavailable: (error) => { throw error; } });
    const clean = { ...Object.fromEntries(Object.keys(process.env).map((key) => [key, undefined])), ...env, TERM: 'xterm-256color' };
    const pty = await launchPty({ executable: binary, args: binding.args, env: clean, cwd: join(directory, 'workspace'), columns: 100, rows: 28, logPath: join(directory, 'interactive.jsonl') });
    nativePid = pty.childPid;
    const waitEvent = async (predicate, from = 0) => {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) { const value = events.slice(from).find(predicate); if (value) return value; await delay(30); }
      throw new Error(`Native selection not observed: ${JSON.stringify(events)}; ${pty.output.slice(-2000)}`);
    };
    try {
      await delay(2500);
      if (pty.output.includes('trust')) { pty.write('\x1b[B\r'); await delay(1500); }
      if (pty.output.includes('Detected')) { pty.write('\x1b[A\r'); await delay(1000); }
      const initial = await waitEvent((event) => event.kind === 'empty' && event.sessionId !== sessionId);
      assert(!events.slice(4).some((event) => event.kind === 'selected'), 'blank interactive window waits');
      const firstMark = events.length;
      pty.write('fixture interactive session A\r');
      await waitEvent((event) => event.kind === 'selected' && event.sessionId === initial.sessionId, firstMark);
      await pty.waitForOutput('SELECTION_FIXTURE_ACK', 20000);
      const cancelMark = events.length;
      pty.write('/resume\r'); await delay(700); pty.write('\x1b'); await delay(400);
      assert.equal(events.length, cancelMark, 'cancelling resume keeps selection');
      pty.write('/clear\r');
      const blank = await waitEvent((event) => event.kind === 'empty' && event.sessionId !== initial.sessionId, cancelMark);
      const inputMark = events.length;
      pty.write('fixture interactive first input\r');
      await waitEvent((event) => event.kind === 'selected' && event.sessionId === blank.sessionId, inputMark);
      await pty.waitForOutput('SELECTION_FIXTURE_ACK', 20000);
      const backMark = events.length;
      pty.write('/resume\r'); await delay(700); pty.write('\r');
      await waitEvent((event) => event.kind === 'selected' && event.sessionId === initial.sessionId, backMark);
      pty.resize(48, 16); await delay(100); pty.resize(100, 28);
      pty.write('\x03'); await delay(200); pty.write('\x03');
      assert.equal((await pty.exited).code, 0);
    } finally { await pty.dispose(); await binding.close(); }
  }
  console.log(JSON.stringify({ directory, sessionId, events, requests: model.requests.length, passed: true }));
} finally { await model.close(); }
