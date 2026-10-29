// Synthetic records for the C14-W05 correlation tests. No process is spawned and
// no native Codex output is replayed: every value here is controlled input.
export const EXECUTOR = { pid: 34784, ppid: 8720, createdAt: 134377310148193460, name: 'codex.exe', exeDigest: '03966c62c075' };
export const LAUNCHER = { pid: 8720, ppid: 0, createdAt: 134377310147747150, name: 'node.exe', exeDigest: '1e9d7fdac6b0' };

export function ancestry(pid, { ppid = EXECUTOR.pid, createdAt = 134377310185526380, name = 'node.exe', exeDigest = '1e9d7fdac6b0' } = {}) {
  return [
    { pid, ppid, createdAt, name, exeDigest },
    { ...EXECUTOR },
    { ...LAUNCHER },
  ];
}

export function hookLine({ tag, toolUseId, sessionId = 'thread-abc', turnId = 'turn-abc', toolName = 'Bash', pid = 13480, chain = ancestry(13480) }) {
  return JSON.stringify({
    pid,
    ppid: EXECUTOR.pid,
    ancestry: chain,
    event: {
      session_id: sessionId,
      turn_id: turnId,
      transcript_path: 'D:/tmp/rollout.jsonl',
      cwd: 'D:/tmp/workspace',
      hook_event_name: 'PreToolUse',
      model: 'fixture',
      permission_mode: 'bypassPermissions',
      tool_name: toolName,
      tool_input: { command: `node shell-sample.mjs out.jsonl "${tag}"` },
      tool_use_id: toolUseId,
    },
  });
}

export function shellRecord({ tag, toolCallId, threadId = 'thread-abc', sessionId = 'thread-abc', pid = 41040, chain = ancestry(41040), codexVersion = '0.163.0' }) {
  return JSON.stringify({ tag, pid, ppid: EXECUTOR.pid, cwd: 'D:/tmp/workspace', threadId, sessionId, toolCallId, codexVersion, ancestry: chain });
}
