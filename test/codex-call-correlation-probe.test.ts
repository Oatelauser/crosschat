import { createServer } from 'node:http';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CORRELATION_LIMITS,
  buildPlan,
  commandHasTag,
  correlateCalls,
  isolatedEnv,
  killOwnedTree,
  main,
  normalizeAncestry,
  parseHookLog,
  parseModelRequest,
  parseShellSamples,
  prepareOwnedRoot,
  readBounded,
  redact,
  removeOwnedRoot,
  runCorrelation,
  runProcess,
  sameExecutor,
  sharedAncestor,
  startMockModel,
} from '../scripts/codex-call-correlation-probe.mjs';
import { projectHookEvent, readHookStdin } from './helpers/codex-call-correlation-hook.mjs';
import { ancestry, EXECUTOR, hookLine, LAUNCHER, shellRecord } from './helpers/codex-call-correlation-fixture.mjs';

const hookLog = (...lines) => lines.join('\n');
const shellLog = (...lines) => lines.join('\n');
const TAGS = ['call_w05_1', 'call_w05_2'];

const correlate = (hooks, shells, plannedTags = TAGS) => correlateCalls({
  hookRecords: parseHookLog(hookLog(...hooks)).records,
  shellRecords: parseShellSamples(shellLog(...shells)).records,
  plannedTags,
});

const bothCalls = () => ({
  hooks: [hookLine({ tag: TAGS[0], toolUseId: TAGS[0] }), hookLine({ tag: TAGS[1], toolUseId: TAGS[1] })],
  shells: [shellRecord({ tag: TAGS[0], toolCallId: TAGS[0] }), shellRecord({ tag: TAGS[1], toolCallId: TAGS[1] })],
});

const temporary = [];
const tempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'c14w05-test-'));
  temporary.push(dir);
  return dir;
};

afterEach(async () => {
  while (temporary.length > 0) await rm(temporary.pop(), { recursive: true, force: true });
});

describe('codex call correlation probe: records', () => {
  it('redacts identifiers and marks an absent one instead of hashing an empty string', () => {
    expect(redact('call_w05_1')).toEqual({ present: true, length: 10, sha256: expect.stringMatching(/^[0-9a-f]{12}$/) });
    expect(redact('')).toEqual({ present: false });
    expect(redact(null)).toEqual({ present: false });
  });

  it('keeps a well-formed PreToolUse record and rejects anything else', () => {
    const parsed = parseHookLog(hookLog(
      hookLine({ tag: 'call-1', toolUseId: 'call_w05_1' }),
      'not json',
      JSON.stringify({ event: { hook_event_name: 'PostToolUse', session_id: 's', tool_use_id: 'c', tool_name: 'Bash', tool_input: { command: 'x' } } }),
      JSON.stringify({ event: { hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Bash', tool_input: { command: 'x' } } }),
      JSON.stringify({ event: { hook_event_name: 'PreToolUse', session_id: 's', tool_use_id: 'c', tool_name: 'Bash', tool_input: {} } }),
      JSON.stringify({ error: 'deadline', event: null }),
    ));
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]).toMatchObject({ toolUseId: 'call_w05_1', toolName: 'Bash', turnId: 'turn-abc' });
    expect(parsed.rejected).toEqual(['unparseable', 'not-pre-tool-use', 'incomplete', 'missing-command', 'hook-error']);
  });

  it('refuses numeric ids instead of stringifying them into a match', () => {
    const parsed = parseHookLog(JSON.stringify({
      pid: 1,
      ppid: 2,
      ancestry: [],
      error: null,
      event: { hook_event_name: 'PreToolUse', session_id: 456, turn_id: 'turn', tool_use_id: 123, tool_name: 'Bash', tool_input: { command: 'node x "call-1"' } },
    }));
    expect(parsed.records).toEqual([]);
    expect(parsed.rejected).toEqual(['invalid-id']);

    const shells = parseShellSamples(JSON.stringify({ tag: 'call-1', toolCallId: 123 }));
    expect(shells.records).toEqual([]);
    expect(shells.rejected).toEqual(['invalid-id']);
  });

  it('stops reading hook records at the configured limit', () => {
    const lines = Array.from({ length: CORRELATION_LIMITS.maxHookRecords + 3 }, (_, index) => hookLine({ tag: `call-${index}`, toolUseId: `id-${index}` }));
    const parsed = parseHookLog(hookLog(...lines));
    expect(parsed.records).toHaveLength(CORRELATION_LIMITS.maxHookRecords);
    expect(parsed.rejected).toEqual(['record-limit']);
  });

  it('reports shell samples that cannot be bound to a tag instead of dropping them silently', () => {
    const parsed = parseShellSamples(shellLog(
      shellRecord({ tag: 'call-1', toolCallId: 'call_w05_1' }),
      JSON.stringify({ threadId: 'no-tag' }),
      '{"broken":',
    ));
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]).toMatchObject({ tag: 'call-1', toolCallId: 'call_w05_1', codexVersion: '0.163.0' });
    expect(parsed.rejected).toEqual(['missing-tag', 'unparseable']);
  });

  it('projects the hook event down to the fields the probe may keep', () => {
    const projected = projectHookEvent({
      hook_event_name: 'PreToolUse', session_id: 's', turn_id: 't', tool_use_id: 'c', tool_name: 'Bash',
      tool_input: { command: 'node x "tag"', other: 'dropped' },
      transcript_path: 'D:/secret/rollout.jsonl', cwd: 'D:/secret', model: 'm', permission_mode: 'bypassPermissions',
    });
    expect(projected).toEqual({
      hook_event_name: 'PreToolUse', session_id: 's', turn_id: 't', tool_use_id: 'c', tool_name: 'Bash',
      tool_input: { command: 'node x "tag"' },
    });
    expect(JSON.stringify(projected)).not.toContain('secret');
  });

  it('bounds hook stdin by bytes and by a deadline', async () => {
    const big = new PassThrough();
    const tooLarge = readHookStdin(big, { maxBytes: 8, deadlineMs: 1000 });
    big.write(Buffer.from('0123456789'));
    expect(await tooLarge).toMatchObject({ error: 'too-large' });

    const silent = new PassThrough();
    expect(await readHookStdin(silent, { maxBytes: 8, deadlineMs: 50 })).toMatchObject({ error: 'deadline' });
  });
});

describe('codex call correlation probe: binding', () => {
  it('correlates two planned calls that each have one hook and one shell', () => {
    const { hooks, shells } = bothCalls();
    const result = correlate(hooks, shells);
    expect(result.status).toBe('complete');
    expect(result.problems).toEqual([]);
    expect(result.calls.map((call) => call.verdict)).toEqual(['correlated', 'correlated']);
    expect(result.calls[0]).toMatchObject({ toolCallIdEqual: true, threadIdEqual: true, sessionIdEqual: true, sameExecutorInstance: true });
    expect(result.orphanHooks).toEqual([]);
    expect(result.unusedShells).toEqual([]);
  });

  it('keeps a complete but unequal run as a valid result, not a tooling failure', () => {
    const { hooks, shells } = bothCalls();
    const result = correlate([hooks[0], hookLine({ tag: TAGS[1], toolUseId: 'call_other' })], shells);
    expect(result.status).toBe('complete');
    expect(result.calls.map((call) => call.verdict)).toEqual(['correlated', 'mismatch']);
  });

  it('treats a missing shell call id as unverifiable, never as a mismatch', () => {
    const result = correlate(
      [hookLine({ tag: 'call-1', toolUseId: 'call-1' })],
      [shellRecord({ tag: 'call-1', toolCallId: null })],
      ['call-1'],
    );
    expect(result.calls[0]).toMatchObject({ verdict: 'unverifiable', toolCallIdEqual: null, unverifiableReason: 'call-id-missing' });
    expect(result.status).toBe('incomplete');
  });

  it('keeps a missing id unverifiable even when another id is valid but different', () => {
    // A missing required field outranks an unequal one: this is no conclusion,
    // not a negative one.
    const result = correlate(
      [hookLine({ tag: 'call-1', toolUseId: 'call-1', sessionId: 'thread-abc' })],
      [shellRecord({ tag: 'call-1', toolCallId: null, threadId: 'thread-other' })],
      ['call-1'],
    );
    expect(result.calls[0]).toMatchObject({ verdict: 'unverifiable', toolCallIdEqual: null, threadIdEqual: false });
    expect(result.status).toBe('incomplete');
  });

  it('refuses a plan when one planned call never produced a shell sample', () => {
    const { hooks, shells } = bothCalls();
    const result = correlate(hooks, [shells[0]]);
    expect(result.status).toBe('incomplete');
    expect(result.calls.map((call) => call.verdict)).toEqual(['correlated', 'shell-missing']);
  });

  it('does not accept a call whose hook record never arrived', () => {
    const { hooks, shells } = bothCalls();
    const result = correlate([hooks[0]], shells);
    expect(result.status).toBe('incomplete');
    expect(result.calls.map((call) => call.verdict)).toEqual(['correlated', 'hook-missing']);
    expect(result.calls[1].hook).toBeNull();
  });

  it('refuses to pick between duplicate hook records for one call', () => {
    const { hooks, shells } = bothCalls();
    const result = correlate([hooks[0], hookLine({ tag: TAGS[0], toolUseId: TAGS[0], pid: 999 }), hooks[1]], shells);
    expect(result.status).toBe('incomplete');
    expect(result.calls[0]).toMatchObject({ verdict: 'ambiguous', hook: null, candidates: 2 });
    expect(result.problems).toContain(`duplicate-hook:${redact(TAGS[0]).sha256}:2`);
  });

  it('never lets one hook record prove two shell samples of the same tag', () => {
    const result = correlate(
      [hookLine({ tag: TAGS[0], toolUseId: TAGS[0] })],
      [shellRecord({ tag: TAGS[0], toolCallId: TAGS[0] }), shellRecord({ tag: TAGS[0], toolCallId: TAGS[0], pid: 41041 })],
      [TAGS[0]],
    );
    expect(result.status).toBe('incomplete');
    expect(result.calls.map((call) => call.verdict)).toEqual(['ambiguous-shell']);
    expect(result.calls.some((call) => call.verdict === 'correlated')).toBe(false);
    expect(result.problems).toContain(`duplicate-shell:${redact(TAGS[0]).sha256}:2`);
    expect(result.orphanHooks).toHaveLength(1);
  });

  it('matches tags exactly, so a longer tag never binds to a shorter one', () => {
    expect(commandHasTag('node x.mjs "call_w05_10"', 'call_w05_1')).toBe(false);
    expect(commandHasTag('node x.mjs "call_w05_1"', 'call_w05_1')).toBe(true);
    const result = correlate([hookLine({ tag: 'call_w05_10', toolUseId: 'call_w05_1' })], [shellRecord({ tag: 'call_w05_1', toolCallId: 'call_w05_1' })], ['call_w05_1']);
    expect(result.calls[0].verdict).toBe('hook-missing');
  });

  it('rejects a hook command that carries two planned tags', () => {
    const command = `node x.mjs "${TAGS[0]}" "${TAGS[1]}"`;
    const result = correlate(
      [hookLine({ tag: TAGS[0], toolUseId: TAGS[0], command })],
      [shellRecord({ tag: TAGS[0], toolCallId: TAGS[0] }), shellRecord({ tag: TAGS[1], toolCallId: TAGS[1] })],
    );
    expect(result.status).toBe('incomplete');
    expect(result.problems).toEqual([`overlapping-hook:${redact(command).sha256}`]);
  });

  it('rejects records outside the plan', () => {
    const { hooks, shells } = bothCalls();
    const result = correlate(
      [...hooks, hookLine({ tag: 'call_w05_9', toolUseId: 'call_w05_9' })],
      [...shells, shellRecord({ tag: 'call_w05_9', toolCallId: 'call_w05_9' })],
    );
    expect(result.status).toBe('incomplete');
    expect(result.problems).toContain(`unplanned-hook:${redact('node shell-sample.mjs out.jsonl "call_w05_9"').sha256}`);
    expect(result.problems).toContain(`unplanned-shell:${redact('call_w05_9').sha256}`);
  });

  it('requires an explicit plan', () => {
    expect(() => correlateCalls({ hookRecords: [], shellRecords: [] })).toThrow(/planned call tags/);
  });

  it('never writes a full native identifier into the evidence shape', () => {
    const { hooks, shells } = bothCalls();
    const serialized = JSON.stringify(correlate(hooks, shells));
    expect(serialized).not.toContain(TAGS[0]);
    expect(serialized).not.toContain('thread-abc');
    expect(serialized).not.toContain('turn-abc');
  });
});

describe('codex call correlation probe: executor instance', () => {
  it('reports the same executor when both chains reach the same Codex process', () => {
    expect(sameExecutor(ancestry(13480), ancestry(41040))).toMatchObject({ verdict: 'same', reason: null });
    expect(sharedAncestor(ancestry(13480), ancestry(41040))).toEqual({ pid: EXECUTOR.pid, name: EXECUTOR.name, createdAt: EXECUTOR.createdAt, exeDigest: EXECUTOR.exeDigest });
  });

  it('does not call a shared launcher the same executing instance', () => {
    // Two chains through *different* codex.exe processes that only meet at node.exe.
    const other = { ...EXECUTOR, pid: 50120, createdAt: EXECUTOR.createdAt + 4096 };
    const result = correlate(
      [hookLine({ tag: TAGS[0], toolUseId: TAGS[0] })],
      [shellRecord({ tag: TAGS[0], toolCallId: TAGS[0], chain: ancestry(41040, { executor: other }) })],
      [TAGS[0]],
    );
    expect(result.calls[0]).toMatchObject({ verdict: 'correlated', executorVerdict: 'different', sameExecutorInstance: false });
    expect(result.calls[0].sharedAncestor).toEqual({ pid: LAUNCHER.pid, name: LAUNCHER.name, createdAt: LAUNCHER.createdAt, exeDigest: LAUNCHER.exeDigest });
  });

  it('leaves the instance unverified when a nearer Codex process cannot be identified', () => {
    const shellChain = ancestry(41040).filter((row) => row.name !== EXECUTOR.name);
    const result = correlate(
      [hookLine({ tag: TAGS[0], toolUseId: TAGS[0] })],
      [shellRecord({ tag: TAGS[0], toolCallId: TAGS[0], chain: shellChain })],
      [TAGS[0]],
    );
    expect(result.calls[0]).toMatchObject({ verdict: 'correlated', executorVerdict: 'unverified', sameExecutorInstance: false });
  });

  it('does not coerce a malformed ancestry row into a valid identity', () => {
    const chain = [{ ...EXECUTOR, pid: '34784' }, { ...LAUNCHER }];
    expect(normalizeAncestry(chain)).toEqual({ rows: [], malformed: 1, broken: true });
    const result = correlate(
      [hookLine({ tag: TAGS[0], toolUseId: TAGS[0], chain })],
      [shellRecord({ tag: TAGS[0], toolCallId: TAGS[0] })],
      [TAGS[0]],
    );
    expect(result.calls[0]).toMatchObject({ executorVerdict: 'unverified', sameExecutorInstance: false });
    expect(result.calls[0].hook.malformedAncestryRows).toBe(1);
  });

  it('stops an ancestry chain at the first broken link', () => {
    const detached = { pid: 500, ppid: 999, createdAt: 1, name: 'node.exe', exeDigest: 'x' };
    const chain = [detached, { ...EXECUTOR }];
    expect(normalizeAncestry(chain)).toEqual({ rows: [detached], malformed: 0, broken: true });
    // The chain must start at the record's own process.
    expect(normalizeAncestry(chain, { expectPid: 501 })).toEqual({ rows: [], malformed: 0, broken: true });

    const result = correlate(
      [hookLine({ tag: TAGS[0], toolUseId: TAGS[0], chain })],
      [shellRecord({ tag: TAGS[0], toolCallId: TAGS[0] })],
      [TAGS[0]],
    );
    expect(result.calls[0]).toMatchObject({ executorVerdict: 'unverified', sameExecutorInstance: false });
    expect(result.calls[0].hook.ancestryBroken).toBe(true);
  });

  it('stops the chain when a parent was born after its own child', () => {
    const child = { pid: 500, ppid: 600, createdAt: 120, name: 'node.exe', exeDigest: 'x' };
    const laterParent = { pid: 600, ppid: 0, createdAt: 200, name: 'codex.exe', exeDigest: 'y' };
    expect(normalizeAncestry([child, laterParent])).toEqual({ rows: [child], malformed: 0, broken: true });

    // The independent repro: two children born 100/120 under a codex parent born 200.
    const first = { pid: 500, ppid: 600, createdAt: 100, name: 'node.exe', exeDigest: 'x' };
    const second = { pid: 501, ppid: 600, createdAt: 120, name: 'node.exe', exeDigest: 'x' };
    const codex = { pid: 600, ppid: 0, createdAt: 200, name: 'codex.exe', exeDigest: 'y' };
    const result = correlate(
      [hookLine({ tag: TAGS[0], toolUseId: TAGS[0], chain: [first, codex] })],
      [shellRecord({ tag: TAGS[0], toolCallId: TAGS[0], chain: [second, codex] })],
      [TAGS[0]],
    );
    expect(result.calls[0]).toMatchObject({ verdict: 'correlated', executorVerdict: 'unverified', sameExecutorInstance: false });
  });

  it('stops the chain at a repeated pid instead of looping', () => {
    const child = { pid: 500, ppid: 600, createdAt: 120, name: 'node.exe', exeDigest: 'x' };
    const parent = { pid: 600, ppid: 500, createdAt: 110, name: 'codex.exe', exeDigest: 'y' };
    const again = { pid: 500, ppid: 600, createdAt: 100, name: 'node.exe', exeDigest: 'x' };
    expect(normalizeAncestry([child, parent, again])).toEqual({ rows: [child, parent], malformed: 0, broken: true });
  });

  it('leaves the instance unverified when the executable path digest is missing', () => {
    expect(sameExecutor([{ ...EXECUTOR, exeDigest: '' }], [EXECUTOR])).toMatchObject({ verdict: 'unverified', reason: 'path-digest-missing' });
    expect(sameExecutor([EXECUTOR], [EXECUTOR])).toMatchObject({ verdict: 'same' });
  });
});

describe('codex call correlation probe: bounded reads and processes', () => {
  it('separates a missing file, an exact-size file and an oversized one', async () => {
    const dir = await tempDir();
    const missing = await readBounded(join(dir, 'absent.jsonl'), 16);
    expect(missing).toMatchObject({ ok: false, text: '', truncated: false });
    expect(missing.error).toBe('ENOENT');

    await writeFile(join(dir, 'exact.jsonl'), '0123456789abcdef');
    expect(await readBounded(join(dir, 'exact.jsonl'), 16)).toMatchObject({ ok: true, truncated: false });

    await writeFile(join(dir, 'big.jsonl'), '0123456789abcdefg');
    const big = await readBounded(join(dir, 'big.jsonl'), 16);
    expect(big).toMatchObject({ ok: true, truncated: true, text: '0123456789abcdef' });
  });

  it('returns the exit code of a child that finished', async () => {
    const ok = await runProcess({ command: process.execPath, args: ['-e', 'process.exit(0)'] });
    expect(ok).toMatchObject({ exitCode: 0, timedOut: false, cancelled: false, spawnError: null, closed: true });
    const bad = await runProcess({ command: process.execPath, args: ['-e', 'process.exit(4)'] });
    expect(bad).toMatchObject({ exitCode: 4, timedOut: false });
  });

  it('reports a spawn error instead of throwing', async () => {
    const result = await runProcess({ command: 'c14-w05-no-such-binary', args: [] });
    expect(result.spawnError).toBeTruthy();
    expect(result.closed).toBe(false);
  });

  it('caps child output by bytes and flags the cut', async () => {
    const result = await runProcess({ command: process.execPath, args: ['-e', "process.stdout.write('x'.repeat(5000))"], maxOutputBytes: 100 });
    expect(result.output).toHaveLength(100);
    expect(result.outputTruncated).toBe(true);
  });

  it('kills a timed-out child together with its descendant and waits for close', async () => {
    const script = [
      "const { spawn } = require('node:child_process');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      'process.stdout.write(String(child.pid));',
      'setInterval(() => {}, 1000);',
    ].join('');
    const result = await runProcess({ command: process.execPath, args: ['-e', script], timeoutMs: 1500, killTimeoutMs: 5000 });
    expect(result.timedOut).toBe(true);
    expect(result.killedTree).toBe(true);
    expect(result.closed).toBe(true);
    expect(result.leaked).toBe(false);
    expect(result.launcherGone).toBe(true);
    // A killed tree is not proof that every descendant is gone.
    expect(result.descendantsVerified).toBe(false);

    const grandchild = Number(result.output);
    expect(grandchild).toBeGreaterThan(0);
    let alive = true;
    for (let attempt = 0; attempt < 40 && alive; attempt += 1) {
      await new Promise((done) => setTimeout(done, 50));
      try { process.kill(grandchild, 0); } catch { alive = false; }
    }
    expect(alive).toBe(false);
  }, 20_000);

  it('stops a cancelled child through the abort signal', async () => {
    const controller = new AbortController();
    const pending = runProcess({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 30_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 200);
    const result = await pending;
    expect(result).toMatchObject({ cancelled: true, timedOut: false, killedTree: true, closed: true, leaked: false });
  }, 20_000);

  it('never kills a process it was not given', async () => {
    expect(await killOwnedTree(0)).toBe(false);
    expect(await killOwnedTree(-1)).toBe(false);
    expect(await killOwnedTree(Number.NaN)).toBe(false);
  });
});

describe('codex call correlation probe: loopback service', () => {
  it('fails to start when the port is already taken', async () => {
    const blocker = createServer();
    await new Promise((done) => blocker.listen(0, '127.0.0.1', done));
    const { port } = blocker.address();
    try {
      await expect(startMockModel([], { port })).rejects.toThrow(/loopback-listen-failed/);
    } finally {
      await new Promise((done) => blocker.close(done));
    }
  });

  it('serves the planned calls, reports an overrun and closes', async () => {
    const live = await startMockModel([{ callId: 'call_w05_1', arguments: { cmd: 'x' } }], { maxRequests: 1 });
    const post = () => fetch(live.baseUrl, { method: 'POST', body: JSON.stringify({ tools: [{ name: 'exec_command' }], input: [] }) });
    const first = await post();
    expect(first.status).toBe(200);
    expect(await first.text()).toContain('exec_command');
    const second = await post();
    expect(second.status).toBe(429);
    expect(live.state.overLimit).toBe(true);
    expect(live.state.toolCalls).toEqual(['exec_command']);
    expect(await live.close()).toBe(true);
  });

  it('rejects an oversized request body and still closes', async () => {
    const live = await startMockModel([], { maxBodyBytes: 8 });
    const response = await fetch(live.baseUrl, { method: 'POST', body: 'x'.repeat(64) });
    expect(response.status).toBe(413);
    expect(live.state.bodyOverflow).toBe(1);
    expect(await live.close()).toBe(true);
  });

  it('rejects a malformed request without throwing out of the server', async () => {
    const live = await startMockModel([]);
    const badInput = await fetch(live.baseUrl, { method: 'POST', body: JSON.stringify({ input: {} }) });
    expect(badInput.status).toBe(400);
    expect(live.state.failures).toContain('invalid-input');
    const badTools = await fetch(live.baseUrl, { method: 'POST', body: JSON.stringify({ tools: 'x' }) });
    expect(badTools.status).toBe(400);
    expect(live.state.failures).toContain('invalid-tools');
    const notJson = await fetch(live.baseUrl, { method: 'POST', body: 'not json' });
    expect(notJson.status).toBe(400);
    expect(live.state.failures).toContain('unparseable-request');
    expect(await live.close()).toBe(true);
  });

  it('fails a request that never finishes on its own deadline', async () => {
    const live = await startMockModel([], { requestTimeoutMs: 200 });
    const { port } = new URL(live.baseUrl);
    const socket = connect(Number(port), '127.0.0.1');
    await new Promise((done) => socket.once('connect', done));
    // Headers complete, body never does: the server must not wait forever.
    socket.write('POST /v1/responses HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 100\r\n\r\n{"input":');
    await vi.waitFor(() => expect(live.state.failures).toContain('request-timeout'), { timeout: 5000 });
    expect(live.state.requests).toBe(0);
    socket.destroy();
    expect(await live.close()).toBe(true);
  }, 20_000);

  it('leaves no timer behind, so the process exits as soon as the server closes', async () => {
    // A pending request deadline or close deadline keeps the event loop alive; the
    // child would then outlive its 3s budget instead of exiting at once.
    const code = [
      `import { startMockModel } from ${JSON.stringify(new URL('../scripts/codex-call-correlation-probe.mjs', import.meta.url).href)};`,
      'const live = await startMockModel([], { closeTimeoutMs: 5000, requestTimeoutMs: 5000 });',
      "await fetch(live.baseUrl, { method: 'POST', body: JSON.stringify({ input: [] }) });",
      'process.stdout.write(String(await live.close()));',
    ].join('\n');
    const result = await runProcess({
      command: process.execPath,
      args: ['--input-type=module', '-e', code],
      timeoutMs: 3000,
      killTimeoutMs: 2000,
    });
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.output.trim()).toBe('true');
  }, 20_000);

  it('validates only the fields the probe consumes', () => {
    expect(parseModelRequest('{"input":{}}')).toEqual({ ok: false, reason: 'invalid-input' });
    expect(parseModelRequest('{"input":[1]}')).toEqual({ ok: false, reason: 'invalid-input' });
    expect(parseModelRequest('{"tools":{}}')).toEqual({ ok: false, reason: 'invalid-tools' });
    expect(parseModelRequest('[]')).toEqual({ ok: false, reason: 'invalid-request' });
    expect(parseModelRequest('not json')).toEqual({ ok: false, reason: 'unparseable-request' });
    expect(parseModelRequest('{"input":[],"tools":[{"name":"exec_command"}],"model":"fixture"}')).toMatchObject({ ok: true, input: [] });
  });
});

describe('codex call correlation probe: run root and main chain', () => {
  const FAKE_CLI = [
    "import { appendFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    'const root = process.argv[2];',
    'const count = Number(process.argv[3]);',
    'for (let n = 1; n <= count; n += 1) {',
    "  const tag = 'call_w05_' + n;",
    "  appendFileSync(join(root, 'shell-' + n + '.jsonl'), JSON.stringify({ tag, threadId: 'thread-abc', sessionId: 'thread-abc', toolCallId: tag, codexVersion: '0.163.0', pid: 1000 + n, ppid: 900, ancestry: [] }) + '\\n');",
    "  appendFileSync(join(root, 'hook.jsonl'), JSON.stringify({ pid: 2000 + n, ppid: 900, ancestry: [], error: null, event: { hook_event_name: 'PreToolUse', session_id: 'thread-abc', turn_id: 'turn-abc', tool_use_id: tag, tool_name: 'Bash', tool_input: { command: 'node x.mjs \"' + tag + '\"' } } }) + '\\n');",
    '}',
    'process.exit(0);',
  ].join('\n');

  const fakeRun = async (count, { evidencePath, limits } = {}) => {
    const dir = await tempDir();
    const script = join(dir, 'fake-cli.mjs');
    await writeFile(script, FAKE_CLI);
    const root = join(dir, 'run-root');
    const evidence = await runCorrelation({
      root,
      evidencePath,
      limits,
      cli: { command: process.execPath, args: [script, root, String(count)], appendPromptArgs: false },
    });
    return { dir, root, evidence };
  };

  it('refuses a root that already holds foreign files, without touching them', async () => {
    const dir = await tempDir();
    const root = join(dir, 'occupied');
    await mkdir(root);
    await writeFile(join(root, 'keep.txt'), 'original');
    await expect(prepareOwnedRoot(root)).rejects.toThrow(/root-not-exclusive/);
    expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('original');
  });

  it('refuses a previous run directory from the real main without deleting a byte', async () => {
    const dir = await tempDir();
    const root = join(dir, 'previous-run');
    await mkdir(root);
    // Same owner string as this tooling, but a different run: not this run's root.
    const marker = `${JSON.stringify({ owner: 'c14-w05-correlation-probe', runId: 'previous-run', createdAt: '2026-10-29T00:00:00.000Z', pid: 1 })}\n`;
    await writeFile(join(root, 'ownership.json'), marker);
    await writeFile(join(root, 'keep.txt'), 'keep');

    expect(await main(['--root', root])).toBe(3);
    expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('keep');
    expect(await readFile(join(root, 'ownership.json'), 'utf8')).toBe(marker);
  });

  it('lets only the winning claimant delete the root', async () => {
    const dir = await tempDir();
    const root = join(dir, 'contended');
    await mkdir(root);
    const results = await Promise.allSettled([prepareOwnedRoot(root), prepareOwnedRoot(root)]);
    const won = results.filter((result) => result.status === 'fulfilled');
    expect(won).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const claim = won[0].value;

    // A loser can copy the marker bytes but still owns no run id.
    await expect(removeOwnedRoot(root, { ...claim, runId: 'not-the-winner' })).rejects.toThrow(/root-not-owned/);
    expect(await readFile(join(root, 'ownership.json'), 'utf8')).toBe(claim.markerBytes);
    await removeOwnedRoot(root, claim);
    await expect(access(root)).rejects.toThrow();
  });

  it('refuses a claim that names a different root', async () => {
    const dir = await tempDir();
    const claim = await prepareOwnedRoot(join(dir, 'owned'));
    const other = join(dir, 'other-owned');
    await mkdir(other);
    // The same marker bytes, copied into another directory this run also owns.
    await writeFile(join(other, 'ownership.json'), claim.markerBytes);
    await expect(removeOwnedRoot(other, claim)).rejects.toThrow(/root-not-owned:root-mismatch/);
    expect(await readFile(join(other, 'ownership.json'), 'utf8')).toBe(claim.markerBytes);
    // A claim re-pointed at the copy still fails: the marker names the directory it
    // was written for, so copied bytes do not authorize another root.
    await expect(removeOwnedRoot(other, { ...claim, root: other })).rejects.toThrow(/root-not-owned:marker-changed/);
    expect(await readFile(join(other, 'ownership.json'), 'utf8')).toBe(claim.markerBytes);
  });

  it('refuses to delete a root whose marker changed in any field after the claim', async () => {
    const dir = await tempDir();
    const claim = await prepareOwnedRoot(join(dir, 'owned'));
    const changed = `${JSON.stringify({ ...claim.ownership, pid: claim.ownership.pid + 1 })}\n`;
    await writeFile(join(claim.root, 'ownership.json'), changed);
    await expect(removeOwnedRoot(claim.root, claim)).rejects.toThrow(/root-not-owned:marker-changed/);
    expect(await readFile(join(claim.root, 'ownership.json'), 'utf8')).toBe(changed);

    const otherRun = `${JSON.stringify({ ...claim.ownership, runId: 'other-run' })}\n`;
    await writeFile(join(claim.root, 'ownership.json'), otherRun);
    await expect(removeOwnedRoot(claim.root, claim)).rejects.toThrow(/root-not-owned:marker-changed/);
    expect(await readFile(join(claim.root, 'ownership.json'), 'utf8')).toBe(otherRun);
  });

  it('reports an incomplete experiment when only the first of two planned calls was captured', async () => {
    const { evidence } = await fakeRun(1);
    expect(evidence.run.status).toBe('incomplete');
    expect(evidence.run.outcome).toBe('no-conclusion');
    expect(evidence.run.reasons).toContain('read-failed:shell-2:ENOENT');
    expect(evidence.calls.map((call) => call.verdict)).toEqual(['correlated', 'shell-missing']);
    expect(evidence.run.cleanup.status).toBe('retained');
  });

  it('keeps the root on a clean exit because no descendant evidence exists', async () => {
    const { root, evidence } = await fakeRun(2);
    // The correlation itself is still recorded as fact …
    expect(evidence.calls.map((call) => call.verdict)).toEqual(['correlated', 'correlated']);
    expect(evidence.run.shellSamples).toBe(2);
    expect(evidence.run.hookRecords).toBe(2);
    // … but a closed launcher proves nothing about its descendants, so the run is
    // not complete and the directory stays where it is.
    expect(evidence.run.exitCode).toBe(0);
    expect(evidence.run.descendantsVerified).toBe(false);
    expect(evidence.run.status).toBe('incomplete');
    expect(evidence.run.outcome).toBe('no-conclusion');
    expect(evidence.run.reasons).toContain('cleanup-retained:processes-unverified');
    expect(evidence.run.cleanup).toMatchObject({ status: 'retained', reason: 'processes-unverified', path: root });
    expect(await readFile(join(root, 'ownership.json'), 'utf8')).toContain('c14-w05-correlation-probe');
  });

  it('keeps the root when the cli exits non-zero', async () => {
    const dir = await tempDir();
    const script = join(dir, 'fail.mjs');
    await writeFile(script, 'process.exit(4);');
    const root = join(dir, 'run-root');
    const evidence = await runCorrelation({
      root,
      cli: { command: process.execPath, args: [script], appendPromptArgs: false },
    });
    expect(evidence.run.status).toBe('tooling-failure');
    expect(evidence.run.reasons).toContain('cli-exit:4');
    expect(evidence.run.cleanup.status).toBe('retained');
    expect(await readFile(join(root, 'ownership.json'), 'utf8')).toContain('c14-w05-correlation-probe');
  });

  it('keeps the root when the run is cancelled', async () => {
    const dir = await tempDir();
    const script = join(dir, 'hang.mjs');
    await writeFile(script, 'setInterval(() => {}, 1000);');
    const root = join(dir, 'run-root');
    const controller = new AbortController();
    const pending = runCorrelation({
      root,
      cli: { command: process.execPath, args: [script], appendPromptArgs: false },
      deps: { signal: controller.signal },
    });
    setTimeout(() => controller.abort(), 300);
    const evidence = await pending;
    expect(evidence.run.cancelled).toBe(true);
    expect(evidence.run.reasons).toContain('cli-cancelled');
    expect(evidence.run.cleanup.status).toBe('retained');
    expect(await readFile(join(root, 'ownership.json'), 'utf8')).toContain('c14-w05-correlation-probe');
  }, 20_000);

  it('refuses an existing evidence file before starting any cli', async () => {
    const dir = await tempDir();
    const evidencePath = join(dir, 'evidence.json');
    await writeFile(evidencePath, '{"previous":true}\n');
    const script = join(dir, 'fake-cli.mjs');
    await writeFile(script, FAKE_CLI);
    const root = join(dir, 'run-root');
    await expect(runCorrelation({
      root,
      evidencePath,
      cli: { command: process.execPath, args: [script, root, '2'], appendPromptArgs: false },
    })).rejects.toThrow(/evidence-exists/);
    expect(await readFile(evidencePath, 'utf8')).toBe('{"previous":true}\n');
    // Nothing ran and nothing was claimed: the root was never created.
    await expect(access(root)).rejects.toThrow();
  });

  it('keeps the run root when the launched process never closed', async () => {
    const dir = await tempDir();
    const script = join(dir, 'hang.mjs');
    await writeFile(script, 'setInterval(() => {}, 1000);');
    const root = join(dir, 'run-root');
    const evidence = await runCorrelation({
      root,
      cli: { command: process.execPath, args: [script], appendPromptArgs: false },
      limits: { ...CORRELATION_LIMITS, runTimeoutMs: 1200, killTimeoutMs: 5000 },
    });
    expect(evidence.run.status).toBe('tooling-failure');
    expect(evidence.run.reasons).toContain('cli-timeout');
    expect(evidence.run.cleanup.status).toBe('retained');
    expect(evidence.run.cleanup.reason).toBe('processes-unverified');
    expect(await readFile(join(root, 'ownership.json'), 'utf8')).toContain('c14-w05-correlation-probe');
  }, 20_000);

  it('prints usage and exits 1 without a root', async () => {
    expect(await main([])).toBe(1);
  });
});

describe('codex call correlation probe: plan and environment', () => {
  it('builds exec_command calls that carry the tag the hook will see', () => {
    const plan = buildPlan({ workspace: 'D:/tmp/workspace', outDir: 'D:/tmp/root', calls: ['call_w05_1'] });
    expect(plan[0].callId).toBe('call_w05_1');
    expect(plan[0].arguments.workdir).toBe('D:/tmp/workspace');
    expect(plan[0].arguments.cmd).toContain('"call_w05_1"');
    expect(plan[0].arguments.cmd).toContain('shell-sample.mjs');
  });

  it('passes only OS essentials and points every profile path at the isolated root', () => {
    const env = isolatedEnv('D:/tmp/root/profile', 'D:/tmp/root/profile/.codex', 'D:/tmp/root/tmp');
    expect(env.CODEX_HOME).toBe('D:/tmp/root/profile/.codex');
    expect(env.HOME).toBe('D:/tmp/root/profile');
    expect(env.TEMP).toBe('D:/tmp/root/tmp');
    expect(env.PATH).toBeDefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.CODEX_THREAD_ID).toBeUndefined();
    expect(Object.keys(env).every((key) => /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|ProgramFiles.*|SYSTEMDRIVE|OS|HOME|USERPROFILE|CODEX_HOME|APPDATA|LOCALAPPDATA|TEMP|TMP|NO_COLOR|NO_PROXY)$/i.test(key))).toBe(true);
  });
});
