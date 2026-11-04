// Minimal PreToolUse hook + shell sampler for the C14-W05 correlation probe.
// The hook records only the fields the probe is allowed to keep, never the whole
// event, and never blocks the tool call: failures are logged and the hook exits 0.
/* global process, setTimeout, clearTimeout */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readAncestry, CORRELATION_LIMITS } from '../../scripts/codex-call-correlation-probe.mjs';

// Everything the probe needs from the hook event, and nothing else. Paths, model
// and permission mode stay out of the record.
export function projectHookEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const command = event.tool_input?.command;
  return {
    hook_event_name: event.hook_event_name ?? null,
    session_id: event.session_id ?? null,
    turn_id: event.turn_id ?? null,
    tool_use_id: event.tool_use_id ?? null,
    tool_name: event.tool_name ?? null,
    tool_input: typeof command === 'string' ? { command } : null,
  };
}

// Bounded and deadlined: a hook that never sees EOF still finishes in time, and
// an oversized payload is cut off rather than buffered without limit.
export function readHookStdin(stream = process.stdin, {
  maxBytes = CORRELATION_LIMITS.hookStdinBytes,
  deadlineMs = CORRELATION_LIMITS.hookStdinMs,
} = {}) {
  return new Promise((resolve) => {
    let bytes = 0;
    let text = '';
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.pause?.();
      stream.removeAllListeners?.('data');
      resolve({ text, error });
    };
    const timer = setTimeout(() => finish('deadline'), deadlineMs);
    stream.on('data', (chunk) => {
      if (bytes + chunk.length > maxBytes) { finish('too-large'); return; }
      bytes += chunk.length;
      text += chunk.toString();
    });
    stream.once('end', () => finish(null));
    stream.once('error', () => finish('stdin-error'));
  });
}

export async function collectHookRecord(logPath, { stream = process.stdin } = {}) {
  const input = await readHookStdin(stream);
  let error = input.error;
  let event = null;
  if (!error) {
    try { event = JSON.parse(input.text); } catch { error = 'unparseable'; }
  }
  const ancestry = await readAncestry(process.pid);
  appendFileSync(logPath, `${JSON.stringify({
    pid: process.pid,
    ppid: process.ppid,
    ancestry,
    error,
    event: projectHookEvent(event),
  })}\n`);
}

export async function collectShellSample(outPath, tag) {
  const ancestry = await readAncestry(process.pid);
  appendFileSync(outPath, `${JSON.stringify({
    tag,
    pid: process.pid,
    ppid: process.ppid,
    cwd: process.cwd(),
    threadId: process.env.CODEX_THREAD_ID ?? null,
    sessionId: process.env.CODEX_SESSION_ID ?? null,
    toolCallId: process.env.CODEX_TOOL_CALL_ID ?? null,
    codexVersion: process.env.CODEX_VERSION ?? null,
    ancestry,
  })}\n`);
  process.stdout.write('C14_W05_SHELL_SAMPLE_OK\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await collectHookRecord(process.argv[2]);
  } catch (error) {
    process.stderr.write(`c14-w05 hook failed: ${error?.code ?? 'error'}\n`);
  }
  process.exitCode = 0;
}
