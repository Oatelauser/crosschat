import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { listClaudeSessions, type ClaudeRegistryScan } from '../claude/registry.js';
import { resolveClaudeExe } from '../claude/resolve-exe.js';
import { resolveCodexExecutable } from '../codex/transport.js';
import { defaultOutboxDir, mailboxFileFor, outboxSummary } from '../outbox.js';
import { watchdogStatus } from '../watchdog.js';

/**
 * `crosschat doctor` (B11): one-shot environment health check. Every probe is
 * an injected dependency so the ✅/⚠️/❌ branches are fully mockable; any ❌
 * makes the CLI exit 1. Human-facing only — the agent skill stays unchanged.
 */

export interface DoctorDeps {
  nodeVersion: string;
  env: Record<string, string | undefined>;
  /** Throws CLAUDE_EXE_NOT_FOUND when the claude CLI cannot be resolved. */
  resolveClaude(): string;
  listClaudeSessions(): ClaudeRegistryScan;
  /** Throws when the codex executable cannot be resolved. */
  codexBin(): string;
  run(bin: string, args: readonly string[]): { status: number | null; stdout: string };
  exists(path: string): boolean;
  /** Undefined = missing/unreadable. */
  readFile(path: string): string | undefined;
  homeDir(): string;
  listOutbox(): { threadId: string; count: number; oldestParkedAt?: number }[];
  /** Outbox watchdog probe (B12); defaults to the real lockfile check. */
  watchdogRunning?(): { running: boolean; pid?: number };
  /** Clock for parked-age display; defaults to Date.now. */
  now?(): number;
  /** Repo's skills/crosschat/SKILL.md content; undefined = not locatable (skip compare). */
  repoSkillContent(): string | undefined;
}

export interface DoctorReport {
  output: string;
  /** True when any check reported ❌: the CLI exits 1. */
  failed: boolean;
}

/** 开窗投递 (B8) requires app-server 0.160. */
const CODEX_MIN_VERSION: readonly [number, number, number] = [0, 160, 0];

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
    listOutbox: () => outboxSummary(defaultOutboxDir()),
    repoSkillContent: () => {
      try {
        // dist/commands/ is two levels below the package root (same as install-skills).
        return readFileSync(
          fileURLToPath(new URL('../../skills/crosschat/SKILL.md', import.meta.url)),
          'utf8',
        );
      } catch {
        return undefined;
      }
    },
  };
}

export function runDoctor(deps: DoctorDeps = defaultDoctorDeps()): DoctorReport {
  const lines: string[] = [];
  let pass = 0;
  let warn = 0;
  let bad = 0;
  const ok = (line: string) => {
    pass += 1;
    lines.push(line);
  };
  const attention = (line: string) => {
    warn += 1;
    lines.push(line);
  };
  const fail = (line: string) => {
    bad += 1;
    lines.push(line);
  };

  // 1. Node >= 22
  const major = Number.parseInt(deps.nodeVersion.split('.')[0] ?? '', 10);
  if (Number.isInteger(major) && major >= 22) ok(`✅ Node v${deps.nodeVersion} (≥22)`);
  else fail(`❌ Node v${deps.nodeVersion || '?'}（需 ≥22）`);

  // 2. claude CLI + registry + routable sessions
  try {
    const exe = deps.resolveClaude();
    const scan = deps.listClaudeSessions();
    if (scan.sessions.length === 0) {
      attention(`⚠️ claude CLI 可解析（${exe}），但当前无可路由会话（crosschat claude 启动的会话才可接收）`);
    } else {
      ok(`✅ claude CLI ${exe}；可路由会话 ${scan.sessions.length} 个`);
    }
    if (scan.malformed > 0) attention(`⚠️ claude 注册表 ${scan.malformed} 个损坏条目（已忽略）`);
  } catch {
    fail('❌ claude CLI 不可解析（CLAUDE_EXE_NOT_FOUND）；确认 claude 已安装');
  }

  // 3+4. codex CLI and daemon versions (daemon needs the binary resolved first)
  let codexBin: string | undefined;
  try {
    codexBin = deps.codexBin();
  } catch {
    // reported below
  }
  if (codexBin === undefined) {
    fail('❌ codex CLI 未找到；安装 codex 后重试');
    fail('❌ codex daemon 无法检查（codex CLI 缺失）；安装后运行: codex app-server daemon start');
  } else {
    const v = deps.run(codexBin, ['--version']);
    const ver = v.status === 0 ? parseSemver(v.stdout) : undefined;
    if (ver === undefined) attention(`⚠️ codex CLI 存在，但版本无法解析：${firstLine(v.stdout) || `(exit ${v.status ?? 'null'})`}`);
    else if (cmpVersion(ver, CODEX_MIN_VERSION) < 0) {
      attention(`⚠️ codex CLI ${ver.join('.')}（<${CODEX_MIN_VERSION.join('.')}：开窗投递需升级）`);
    } else ok(`✅ codex CLI ${ver.join('.')}`);

    const d = deps.run(codexBin, ['app-server', 'daemon', 'version']);
    const daemonVer = d.status === 0 ? parseSemver(d.stdout) : undefined;
    if (daemonVer === undefined) {
      fail('❌ codex daemon 未运行；先执行: codex app-server daemon start');
    } else if (cmpVersion(daemonVer, CODEX_MIN_VERSION) < 0) {
      attention(`⚠️ codex daemon ${daemonVer.join('.')}（<${CODEX_MIN_VERSION.join('.')}：开窗投递需升级后重启 daemon）`);
    } else ok(`✅ codex daemon ${daemonVer.join('.')}`);
  }

  // 5. skill installation (and repo comparison when locatable)
  const repo = deps.repoSkillContent();
  for (const root of ['.claude', '.codex'] as const) {
    const side = root === '.claude' ? 'claude' : 'codex';
    const path = join(deps.homeDir(), root, 'skills', 'crosschat', 'SKILL.md');
    if (!deps.exists(path)) {
      attention(`⚠️ ${side} 侧 skill 未安装（${path}）；运行 crosschat install-skills`);
      continue;
    }
    if (repo === undefined) {
      ok(`✅ ${side} 侧 skill 已安装（仓库 SKILL.md 未定位到，跳过版本比对）`);
      continue;
    }
    if (deps.readFile(path) === repo) ok(`✅ ${side} 侧 skill 与仓库版本一致`);
    else attention(`⚠️ ${side} 侧 skill 与仓库版本不一致；重跑 crosschat install-skills`);
  }

  // 6. dual caller-identity residue in this shell
  const claudeSide = (deps.env.CLAUDE_CODE_MESSAGING_SOCKET ?? '') !== '';
  const codexSide =
    (deps.env.CODEX_THREAD_ID ?? '') !== '' || (deps.env.CODEX_SESSION_ID ?? '') !== '';
  if (claudeSide && codexSide) {
    attention(
      '⚠️ 双身份残留：CLAUDE_CODE_* 与 CODEX_* 并存（CALLER_IDENTITY_CONFLICT 风险）；' +
        '临时自纠: env -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN -u CLAUDE_CODE_SESSION_ID <命令>',
    );
  } else ok('✅ 无双身份残留');

  // 7. outbox state + watchdog + mailbox (informational)
  const parked = deps.listOutbox();
  if (parked.length === 0) {
    ok('✅ 发件箱空（无暂存消息）');
  } else {
    const watchdog = deps.watchdogRunning?.() ?? watchdogStatus(defaultOutboxDir());
    const nowMs = deps.now?.() ?? Date.now();
    for (const { threadId, count, oldestParkedAt } of parked) {
      pass += 1;
      const age = oldestParkedAt === undefined ? '' : `，最旧 ${Math.max(1, Math.round((nowMs - oldestParkedAt) / 60_000))} 分钟`;
      lines.push(
        `⏳ 线程 ${threadId.slice(0, 8)} 暂存 ${count} 条${age}（看门狗${watchdog.running ? '运行中' : '未运行'}；` +
          `滞留内容: ${mailboxFileFor(defaultOutboxDir(), threadId)}）`,
      );
    }
  }

  lines.push(`结论: ${pass} 项通过，${warn} 项警告，${bad} 项错误`);
  return { output: lines.join('\n'), failed: bad > 0 };
}

function parseSemver(text: string): [number, number, number] | undefined {
  const m = text.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

function cmpVersion(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

function firstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0] ?? '';
}
