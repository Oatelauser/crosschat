import { describe, expect, it } from 'vitest';
import {
  CORRELATION_LIMITS,
  buildPlan,
  correlateCalls,
  isolatedEnv,
  parseHookLog,
  parseShellSamples,
  redact,
  sharedExecutor,
} from '../scripts/codex-call-correlation-probe.mjs';
import { ancestry, EXECUTOR, hookLine, shellRecord } from './helpers/codex-call-correlation-fixture.mjs';

const hookLog = (...lines) => lines.join('\n');
const shellLog = (...lines) => lines.join('\n');

const correlate = (hooks, shells) => correlateCalls({
  hookRecords: parseHookLog(hookLog(...hooks)).records,
  shellRecords: parseShellSamples(shellLog(...shells)),
});

describe('codex call correlation probe', () => {
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
    ));
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]).toMatchObject({ toolUseId: 'call_w05_1', toolName: 'Bash', turnId: 'turn-abc' });
    expect(parsed.rejected).toEqual(['unparseable', 'not-pre-tool-use', 'incomplete', 'missing-command']);
  });

  it('stops reading hook records at the configured limit', () => {
    const lines = Array.from({ length: CORRELATION_LIMITS.maxHookRecords + 3 }, (_, index) => hookLine({ tag: `call-${index}`, toolUseId: `id-${index}` }));
    const parsed = parseHookLog(hookLog(...lines));
    expect(parsed.records).toHaveLength(CORRELATION_LIMITS.maxHookRecords);
    expect(parsed.rejected).toEqual(['record-limit']);
  });

  it('drops shell samples that cannot be bound to a tag', () => {
    const parsed = parseShellSamples(shellLog(
      shellRecord({ tag: 'call-1', toolCallId: 'call_w05_1' }),
      JSON.stringify({ threadId: 'no-tag' }),
      '{"broken":',
    ));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ tag: 'call-1', toolCallId: 'call_w05_1', codexVersion: '0.163.0' });
  });

  it('correlates a hook record with the shell of the same call', () => {
    const result = correlate(
      [hookLine({ tag: 'call-1', toolUseId: 'call_w05_1' })],
      [shellRecord({ tag: 'call-1', toolCallId: 'call_w05_1' })],
    );
    expect(result.calls[0]).toMatchObject({ verdict: 'correlated', toolCallIdEqual: true, threadIdEqual: true, sessionIdEqual: true, sameExecutorInstance: true });
    expect(result.orphanHooks).toEqual([]);
  });

  it('does not accept a hook whose tool_use_id differs from the shell call id', () => {
    const result = correlate(
      [hookLine({ tag: 'call-1', toolUseId: 'call_other' })],
      [shellRecord({ tag: 'call-1', toolCallId: 'call_w05_1' })],
    );
    expect(result.calls[0]).toMatchObject({ verdict: 'mismatch', toolCallIdEqual: false });
  });

  it('does not accept a call whose hook record never arrived', () => {
    const result = correlate(
      [hookLine({ tag: 'call-1', toolUseId: 'call_w05_1' })],
      [shellRecord({ tag: 'call-1', toolCallId: 'call_w05_1' }), shellRecord({ tag: 'call-2', toolCallId: 'call_w05_2' })],
    );
    expect(result.calls.map((call) => call.verdict)).toEqual(['correlated', 'hook-missing']);
    expect(result.calls[1].hook).toBeNull();
  });

  it('refuses to pick between duplicate hook records for one call', () => {
    const result = correlate(
      [hookLine({ tag: 'call-1', toolUseId: 'call_w05_1' }), hookLine({ tag: 'call-1', toolUseId: 'call_w05_1', pid: 999 })],
      [shellRecord({ tag: 'call-1', toolCallId: 'call_w05_1' })],
    );
    expect(result.calls[0]).toMatchObject({ verdict: 'ambiguous', hook: null, candidates: 2 });
  });

  it('reports a hook that has no matching shell sample', () => {
    const result = correlate([hookLine({ tag: 'call-9', toolUseId: 'call_w05_9' })], []);
    expect(result.calls).toEqual([]);
    expect(result.orphanHooks).toEqual([{ commandDigest: expect.stringMatching(/^[0-9a-f]{12}$/), toolUseId: expect.objectContaining({ present: true }), verdict: 'shell-missing' }]);
  });

  it('never writes a full native identifier into the evidence shape', () => {
    const result = correlate(
      [hookLine({ tag: 'call-1', toolUseId: 'call_w05_1' })],
      [shellRecord({ tag: 'call-1', toolCallId: 'call_w05_1' })],
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('call_w05_1');
    expect(serialized).not.toContain('thread-abc');
    expect(serialized).not.toContain('turn-abc');
  });

  it('anchors two records only on a shared pid and creation time', () => {
    expect(sharedExecutor(ancestry(13480), ancestry(41040))).toEqual({ pid: EXECUTOR.pid, name: EXECUTOR.name, createdAt: EXECUTOR.createdAt, exeDigest: EXECUTOR.exeDigest });
    // Same pid, later creation time: a reused pid is a different process.
    // (FILETIME is read as a double, so the offset has to exceed its precision.)
    expect(sharedExecutor([{ ...EXECUTOR }], [{ ...EXECUTOR, createdAt: EXECUTOR.createdAt + 1024 }])).toBeNull();
    expect(sharedExecutor([{ ...EXECUTOR, createdAt: 0 }], [{ ...EXECUTOR, createdAt: 0 }])).toBeNull();
    expect(sharedExecutor(ancestry(13480), [{ pid: 999, createdAt: 1, name: 'other.exe', exeDigest: '' }])).toBeNull();
  });

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
