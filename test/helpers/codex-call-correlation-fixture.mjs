// Synthetic records for the C14-W05 correlation tests. No process is spawned and
// no native Codex output is replayed: every value here is controlled input.
export const EXECUTOR = { pid: 34784, ppid: 8720, createdAt: 134377310148193460, name: 'codex.exe', exeDigest: '03966c62c075' };
export const LAUNCHER = { pid: 8720, ppid: 0, createdAt: 134377310147747150, name: 'node.exe', exeDigest: '1e9d7fdac6b0' };

// `chain` runs from the record's own process outward; the launcher is the last hop.
export function ancestry(pid, { executor = EXECUTOR, launcher = LAUNCHER, createdAt = 134377310185526380 } = {}) {
  return [
    { pid, ppid: executor.pid, createdAt, name: 'node.exe', exeDigest: '1e9d7fdac6b0' },
    { ...executor },
    ...(launcher ? [{ ...launcher }] : []),
  ];
}

export function hookLine({ tag, toolUseId, sessionId = 'thread-abc', turnId = 'turn-abc', toolName = 'Bash', pid = 13480, chain = ancestry(13480), command = `node shell-sample.mjs out.jsonl "${tag}"` }) {
  return JSON.stringify({
    pid,
    ppid: EXECUTOR.pid,
    ancestry: chain,
    error: null,
    event: {
      hook_event_name: 'PreToolUse',
      session_id: sessionId,
      turn_id: turnId,
      tool_use_id: toolUseId,
      tool_name: toolName,
      tool_input: { command },
    },
  });
}

export function shellRecord({ tag, toolCallId, threadId = 'thread-abc', sessionId = 'thread-abc', pid = 41040, chain = ancestry(41040), codexVersion = '0.163.0' }) {
  return JSON.stringify({ tag, pid, ppid: EXECUTOR.pid, cwd: 'D:/tmp/workspace', threadId, sessionId, toolCallId, codexVersion, ancestry: chain });
}
