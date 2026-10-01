import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { deliverToClaudeSession } from '../../src/claude/deliver.js';
import { keyFileName } from '../../src/claude/key-file.js';
import { defaultClaudeSessionsDir, listClaudeSessions } from '../../src/claude/registry.js';

/** Keep-alive recipe from research/claude-windows-pipe.md §5.1. */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface RawRegistryEntry {
  pid: number;
  sessionId: string;
  cwd?: string;
  messagingSocketPath: string;
}

function readRegistry(dir: string): RawRegistryEntry[] {
  const entries: RawRegistryEntry[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(dir);
  } catch {
    return entries;
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const value = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>;
      if (typeof value.pid === 'number' && typeof value.messagingSocketPath === 'string') {
        entries.push({
          pid: value.pid,
          sessionId: typeof value.sessionId === 'string' ? value.sessionId : '',
          cwd: typeof value.cwd === 'string' ? value.cwd : undefined,
          messagingSocketPath: value.messagingSocketPath,
        });
      }
    } catch {
      // malformed entries are irrelevant here
    }
  }
  return entries;
}

/** Binary path per research/claude-windows-pipe.md §header (npm global layout). */
function resolveClaudeExe(): string {
  const candidates: string[] = [];
  if (process.env.APPDATA) {
    candidates.push(
      join(
        process.env.APPDATA,
        'npm',
        'node_modules',
        '@anthropic-ai',
        'claude-code',
        'node_modules',
        '@anthropic-ai',
        'claude-code-win32-x64',
        'claude.exe',
      ),
    );
  }
  const where = spawnSync('where.exe', ['claude'], { encoding: 'utf8' });
  if (where.status === 0) {
    for (const line of where.stdout.split(/\r?\n/)) {
      if (line.trim().toLowerCase().endsWith('.exe')) candidates.push(line.trim());
    }
  }
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`claude.exe not found; tried: ${candidates.join(', ')}`);
  return found;
}

async function waitFor<T>(
  action: () => T | undefined,
  timeoutMs: number,
  what: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = action();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(1000);
  }
}

describe.skipIf(!process.env.MULTICHAT_LIVE)('claude live registry', () => {
  it(
    'lists real ~/.claude/sessions without throwing',
    { timeout: 300_000 },
    () => {
      const scan = listClaudeSessions();
      console.log(
        `[live] routable sessions: ${scan.sessions.length}, malformed entries skipped: ${scan.malformed}`,
      );
      scan.sessions.forEach((session) =>
        console.log(
          `[live]   pid=${session.pid} kind=${session.kind} name=${session.name ?? '-'} status=${session.status}`,
        ),
      );
      expect(Array.isArray(scan.sessions)).toBe(true);
    },
  );
});

describe.skipIf(!process.env.MULTICHAT_LIVE)('claude live end-to-end injection', () => {
  it(
    'delivers a marked message to a disposable spawned session and verifies the transcript',
    { timeout: 300_000 },
    async () => {
      const sessionsDir = defaultClaudeSessionsDir();
      const knownPids = new Set(readRegistry(sessionsDir).map((entry) => entry.pid));

      const workDir = mkdtempSync(join(tmpdir(), 'multichat-b1-live-'));
      const marker = `B1PIPE_${randomBytes(6).toString('hex')}`;
      const child = spawn(
        resolveClaudeExe(),
        [
          '-p',
          '--input-format', 'stream-json',
          '--output-format', 'stream-json',
          '--verbose',
          '--settings', '{"crossSessionInbound":"accept"}',
          '--debug-file', join(workDir, 'dbg.log'),
        ],
        { cwd: workDir, stdio: ['pipe', 'ignore', 'ignore'] },
      );
      expect(child.pid).toBeTruthy();
      // One turn, then keep stdin open so the session stays alive and idle.
      child.stdin.write(
        `${JSON.stringify({
          type: 'user',
          message: { role: 'user', content: '请用 Bash 工具运行 sleep 12，结束后只回复 SLEEP_DONE' },
        })}\n`,
      );

      let cleanedUp = false;
      try {
        // Target = the registry entry that appeared after our spawn and lives in our workDir.
        const target = await waitFor<RawRegistryEntry>(() => {
          const candidate = readRegistry(sessionsDir).find(
            (entry) =>
              !knownPids.has(entry.pid) &&
              entry.messagingSocketPath !== '' &&
              entry.cwd !== undefined &&
              entry.cwd.toLowerCase() === workDir.toLowerCase(),
          );
          return candidate;
        }, 60_000, 'new registry entry for the spawned session');
        console.log(`[live] target session pid=${target.pid} sessionId=${target.sessionId}`);
        expect(target.pid).toBe(child.pid);

        // Key file must exist before delivery (written alongside the registry entry).
        const keyPath = join(sessionsDir, keyFileName(target.pid, target.messagingSocketPath));
        await waitFor(() => (existsSync(keyPath) ? keyPath : undefined), 30_000, 'key file');

        const result = await deliverToClaudeSession(target, `${marker} 请只回复 OK`);
        expect(result.status).toBe('delivered');

        const projectsDir = join(homedir(), '.claude', 'projects');
        const transcript = await waitFor(() => {
          let projectDirs: string[] = [];
          try {
            projectDirs = readdirSync(projectsDir);
          } catch {
            return undefined;
          }
          for (const projectDir of projectDirs) {
            const jsonl = join(projectsDir, projectDir, `${target.sessionId}.jsonl`);
            if (existsSync(jsonl) && readFileSync(jsonl, 'utf8').includes(marker)) return jsonl;
          }
          return undefined;
        }, 180_000, `marker ${marker} in transcript`);
        console.log(`[live] marker ${marker} verified in ${transcript}`);

        // Cleanup: kill our own process tree, remove the temp dir. A hard kill
        // (TerminateProcess) leaves the raw registry .json behind; the product
        // routes by pid liveness, so assert the pid left the routable set and
        // GC our own stale registry files (pid verified dead above).
        spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F']);
        await waitFor(() => (child.exitCode !== null ? child.exitCode : undefined), 30_000, 'child exit');
        rmSync(workDir, { recursive: true, force: true });
        const notRoutable = await waitFor(() => {
          const scan = listClaudeSessions();
          return scan.sessions.some((session) => session.pid === target.pid) ? undefined : true;
        }, 30_000, `pid ${target.pid} to leave the routable set`);
        expect(notRoutable).toBe(true);
        for (const file of readdirSync(sessionsDir)) {
          if (file.startsWith(`${target.pid}.`)) rmSync(join(sessionsDir, file), { force: true });
        }
        cleanedUp = true;
        console.log(`[live] cleanup done: pid ${child.pid} killed, temp dir removed, stale registry files GC'd`);
      } finally {
        if (!cleanedUp) {
          child.stdin?.end();
          child.kill();
          rmSync(workDir, { recursive: true, force: true });
        }
      }
    },
  );
});
