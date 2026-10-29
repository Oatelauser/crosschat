// Minimal PreToolUse hook and shell sampler for the C14-W05 research probe.
// Both write one bounded JSON line; nothing here is imported by product code.
/* global process */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readAncestry, CORRELATION_LIMITS } from '../../scripts/codex-call-correlation-probe.mjs';

const MAX_STDIN_BYTES = 1024 * 1024;

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { if (raw.length < MAX_STDIN_BYTES) raw += chunk; });
    process.stdin.on('end', () => resolve(raw));
    process.stdin.on('error', () => resolve(raw));
  });
}

// The hook only records the native fields this ticket allows plus where it ran.
export async function collectHookRecord(logPath) {
  const raw = await readStdin();
  let event = null;
  try { event = JSON.parse(raw); } catch { event = null; }
  const ancestry = await readAncestry(process.pid);
  appendFileSync(logPath, `${JSON.stringify({ pid: process.pid, ppid: process.ppid, ancestry, event })}\n`);
}

// The ordinary shell records the same native ids from its environment.
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
  // A failing hook must not break the tool call: log nothing and exit 0.
  try {
    await collectHookRecord(process.argv[2]);
  } catch (error) {
    process.stderr.write(`c14-w05 hook failed: ${error?.code ?? 'error'}\n`);
  }
  process.exitCode = 0;
}

export { CORRELATION_LIMITS };
