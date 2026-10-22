import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, fstatSync, lstatSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { listClaudeSessions, parseEntry } from '../../claude/registry.js';
import { resolveClaudeExe } from '../../claude/resolve-exe.js';
import { resolveCodexExecutable } from '../../codex/transport.js';
import { defaultOutboxDir, outboxSummary } from '../../outbox.js';
import { watchdogStatus } from '../../watchdog.js';
import { isProcessAlive } from '../../platform/process-inspector.js';

import type { ClaudeRegistryScan } from '../../claude/registry.js';

export class DoctorSourceReadError extends Error {
  constructor() { super('Diagnostic source is unreadable, malformed or exceeds its read limit.'); this.name = 'DoctorSourceReadError'; }
}
const isMissing = (error: unknown): boolean => error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Scoped diagnostics run in the owned process; synchronous legacy probes stay off the UI loop. */
function scopedRead(path: string): string | undefined {
  let descriptor: number | undefined;
  try {
    const entry = lstatSync(path);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new DoctorSourceReadError();
    descriptor = openSync(path, 'r');
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new DoctorSourceReadError();
    const buffer = Buffer.alloc(Math.min(stat.size + 1, 2 * 1024 * 1024 + 1));
    const bytes = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (bytes > 2 * 1024 * 1024) throw new DoctorSourceReadError();
    return buffer.subarray(0, bytes).toString('utf8');
  } catch (error) { if (isMissing(error)) return undefined; throw new DoctorSourceReadError(); }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

function scopedDirectory(path: string): string[] {
  try {
    const entry = lstatSync(path);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new DoctorSourceReadError();
    const names = readdirSync(path);
    if (names.length > 10_000) throw new DoctorSourceReadError();
    return names;
  } catch (error) { if (isMissing(error)) return []; throw new DoctorSourceReadError(); }
}

function scopedClaude(directory: string): ClaudeRegistryScan {
  const scan: ClaudeRegistryScan = { sessions: [], malformed: 0 };
  for (const file of scopedDirectory(directory)) {
    if (!file.endsWith('.json')) continue;
    const text = scopedRead(join(directory, file));
    let entry: ReturnType<typeof parseEntry>;
    try { entry = text === undefined ? undefined : parseEntry(text); } catch { entry = undefined; }
    if (!entry) { scan.malformed++; continue; }
    if (['interactive', 'bg'].includes(entry.kind) && isProcessAlive(entry.pid)) scan.sessions.push(entry);
  }
  return scan;
}

function scopedOutbox(directory: string): { threadId: string; count: number; oldestParkedAt?: number }[] {
  const summary: { threadId: string; count: number; oldestParkedAt?: number }[] = [];
  for (const file of scopedDirectory(directory)) {
    if (!file.endsWith('.json')) continue;
    const threadId = file.slice(0, -5);
    if (!threadId || threadId === '.' || threadId === '..' || /[/\\:\0]/.test(threadId)) throw new DoctorSourceReadError();
    const text = scopedRead(join(directory, file));
    let input: unknown;
    try { input = JSON.parse(text ?? ''); } catch { throw new DoctorSourceReadError(); }
    if (!record(input) || !Array.isArray(input.items)) throw new DoctorSourceReadError();
    let oldest = Infinity;
    for (const item of input.items) {
      if (!record(item) || typeof item.parkedAt !== 'number' || !Number.isFinite(item.parkedAt) || item.parkedAt < 0) throw new DoctorSourceReadError();
      oldest = Math.min(oldest, item.parkedAt);
    }
    if (input.items.length) summary.push({ threadId, count: input.items.length, oldestParkedAt: oldest });
  }
  return summary;
}

function scopedWatchdog(directory: string): { running: boolean; pid?: number } {
  const text = scopedRead(join(directory, 'watchdog.lock'));
  if (text === undefined) return { running: false };
  const fields = text.trim().split(/\s+/);
  const pid = Number(fields[0]); const at = Number(fields[1]);
  if (fields.length !== 2 || !Number.isSafeInteger(pid) || pid <= 0 || !Number.isFinite(at) || at < 0) throw new DoctorSourceReadError();
  return Date.now() - at < 90_000 || isProcessAlive(pid) ? { running: true, pid } : { running: false };
}

export interface DoctorDeps {
  nodeVersion: string;
  env: Record<string, string | undefined>;
  /** Throws CLAUDE_EXE_NOT_FOUND when the claude CLI cannot be resolved. */
  resolveClaude(): string;
  listClaudeSessions(): ClaudeRegistryScan;
  /** Throws when the codex executable cannot be resolved. */
  codexBin(): string;
  /** stdout is undefined when spawn itself fails (ENOENT/EACCES) — spawnSync's real shape. */
  run(bin: string, args: readonly string[]): { status: number | null; stdout: string | undefined; error?: unknown };
  exists(path: string): boolean;
  /** Undefined = missing/unreadable. */
  readFile(path: string): string | undefined;
  homeDir(): string;
  listOutbox(): { threadId: string; count: number; oldestParkedAt?: number }[];
  outboxDir?: string;
  /** Outbox watchdog probe (B12); defaults to the real lockfile check. */
  watchdogRunning?(): { running: boolean; pid?: number };
  /** Clock for parked-age display; defaults to Date.now. */
  now?(): number;
  /** 安装源（npm 包内 skills/crosschat/ 整树，含 references/；028 分层起递归比对）；undefined = not locatable (skip compare). */
  repoSkillFiles(): Array<{ path: string; content: string }> | undefined;
  /**
   * 票B B2：tcp 配置目录（node.json/broker.json 所在）。Omitted → tcp checks
   * are skipped entirely (byte-identical to before); defaultDoctorDeps wires
   * the real ~/.crosschat/tcp.
   */
  tcpDir?: string;
  /** 纯 socket connect 探活（2s 预算）；缺省 spawnSync 子进程探。 */
  probeTcp?(host: string, port: number): boolean;
  /** F1：本机 crosschat CLI 版本（package.json）；缺省跳过版本对账。 */
  cliVersion?: string;
  /** F1：tcp 目录列文件（status-node*.json 对账用）；缺省 readdirSync。 */
  readDir?(dir: string): string[];
  /** 026：pid 验活（新鲜状态文件防幽灵误报）；缺省真 isProcessAlive。 */
  isProcessAlive?(pid: number): boolean;
}

export function defaultDoctorDeps(options: { home?: string; env?: NodeJS.ProcessEnv } = {}): DoctorDeps {
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const outboxDir = options.home === undefined ? defaultOutboxDir() : join(home, '.crosschat', 'outbox');
  const scoped = options.home !== undefined;
  return {
    nodeVersion: process.versions.node,
    env,
    resolveClaude: () => scoped && env.CROSSCHAT_CLAUDE_BIN ? env.CROSSCHAT_CLAUDE_BIN : resolveClaudeExe(),
    listClaudeSessions: () => scoped ? scopedClaude(join(home, '.claude', 'sessions')) : listClaudeSessions(join(home, '.claude', 'sessions')),
    codexBin: () => scoped && env.CROSSCHAT_CODEX_BIN ? env.CROSSCHAT_CODEX_BIN : resolveCodexExecutable(),
    run: (bin, args) => spawnSync(bin, [...args], { encoding: 'utf8', env }),
    exists: existsSync,
    readFile: (path) => {
      if (scoped) return scopedRead(path);
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return undefined;
      }
    },
    homeDir: () => home,
    cliVersion: (
      JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string }
    ).version,
    readDir: (dir) => {
      if (scoped) return scopedDirectory(dir);
      try {
        return readdirSync(dir);
      } catch {
        return [];
      }
    },
    listOutbox: () => scoped ? scopedOutbox(outboxDir) : outboxSummary(outboxDir),
    outboxDir,
    watchdogRunning: () => scoped ? scopedWatchdog(outboxDir) : watchdogStatus(outboxDir),
    tcpDir: join(home, '.crosschat', 'tcp'),
    probeTcp: (host, port) => {
      // 纯 socket connect 探活：子进程跑一段 net.connect，2s 预算内连上即达。
      const script =
        "const n=require('node:net');const s=n.connect({host:process.argv[1],port:Number(process.argv[2])},()=>{s.destroy();process.exit(0)});"
        + "s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),1500);";
      try {
        return spawnSync(process.execPath, ['-e', script, host, String(port)], { timeout: 2_000 }).status === 0;
      } catch {
        return false;
      }
    },
    repoSkillFiles: () => {
      try {
        // dist/commands/ is two levels below the package root (same as install-skills).
        // 基准是包内 skills 整树副本而非仓库工作树（015"安装源"正名；028 分层后含 references/）。
        const base = fileURLToPath(new URL('../../../skills/crosschat', import.meta.url));
        const files: Array<{ path: string; content: string }> = [];
        const walk = (dir: string, prefix: string): void => {
          for (const name of readdirSync(dir).sort()) {
            const full = join(dir, name);
            if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
            else files.push({ path: `${prefix}${name}`, content: scoped ? scopedRead(full) ?? '' : readFileSync(full, 'utf8') });
          }
        };
        walk(base, '');
        return files;
      } catch (error) {
        if (error instanceof DoctorSourceReadError) throw error;
        return undefined;
      }
    },
  };
}

