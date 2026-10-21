import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { listClaudeSessions } from '../../claude/registry.js';
import { resolveClaudeExe } from '../../claude/resolve-exe.js';
import { resolveCodexExecutable } from '../../codex/transport.js';
import { defaultOutboxDir, outboxSummary } from '../../outbox.js';

import type { ClaudeRegistryScan } from '../../claude/registry.js';

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

export function defaultDoctorDeps(): DoctorDeps {
  return {
    nodeVersion: process.versions.node,
    env: process.env,
    resolveClaude: () => resolveClaudeExe(),
    listClaudeSessions: () => listClaudeSessions(),
    codexBin: () => resolveCodexExecutable(),
    run: (bin, args) => spawnSync(bin, [...args], { encoding: 'utf8' }),
    exists: existsSync,
    readFile: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return undefined;
      }
    },
    homeDir: () => homedir(),
    cliVersion: (
      JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string }
    ).version,
    readDir: (dir) => {
      try {
        return readdirSync(dir);
      } catch {
        return [];
      }
    },
    listOutbox: () => outboxSummary(defaultOutboxDir()),
    tcpDir: join(homedir(), '.crosschat', 'tcp'),
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
            else files.push({ path: `${prefix}${name}`, content: readFileSync(full, 'utf8') });
          }
        };
        walk(base, '');
        return files;
      } catch {
        return undefined;
      }
    },
  };
}

