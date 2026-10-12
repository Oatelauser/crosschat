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
import { readNodeConfig, type BrokerEntry } from '../serve/node.js';

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
  /** Repo's skills/crosschat/SKILL.md content; undefined = not locatable (skip compare). */
  repoSkillContent(): string | undefined;
  /**
   * 票B B2：tcp 配置目录（node.json/broker.json 所在）。Omitted → tcp checks
   * are skipped entirely (byte-identical to before); defaultDoctorDeps wires
   * the real ~/.crosschat/tcp.
   */
  tcpDir?: string;
  /** 纯 socket connect 探活（2s 预算）；缺省 spawnSync 子进程探。 */
  probeTcp?(host: string, port: number): boolean;
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
    // 非 win32 下 resolveCodexExecutable() 不验存在性直接返回 'codex'：未安装时 spawn ENOENT、
    // stdout 为 undefined（v1.5.0 云端 doctor 崩溃根因），并入"未找到"而非当作版本解析失败。
    if (v.error !== undefined) {
      fail('❌ codex CLI 未找到；安装 codex 后重试');
      fail('❌ codex daemon 无法检查（codex CLI 缺失）；安装后运行: codex app-server daemon start');
    } else {
      const ver = v.status === 0 ? parseSemver(v.stdout ?? '') : undefined;
      if (ver === undefined) attention(`⚠️ codex CLI 存在，但版本无法解析：${firstLine(v.stdout) || `(exit ${v.status ?? 'null'})`}`);
      else if (cmpVersion(ver, CODEX_MIN_VERSION) < 0) {
        attention(`⚠️ codex CLI ${ver.join('.')}（<${CODEX_MIN_VERSION.join('.')}：开窗投递需升级）`);
      } else ok(`✅ codex CLI ${ver.join('.')}`);

      const d = deps.run(codexBin, ['app-server', 'daemon', 'version']);
      const daemonVer = d.status === 0 ? parseSemver(d.stdout ?? '') : undefined;
      if (daemonVer === undefined) {
        fail('❌ codex daemon 未运行；先执行: codex app-server daemon start');
      } else if (cmpVersion(daemonVer, CODEX_MIN_VERSION) < 0) {
        attention(`⚠️ codex daemon ${daemonVer.join('.')}（<${CODEX_MIN_VERSION.join('.')}：开窗投递需升级后重启 daemon）`);
      } else ok(`✅ codex daemon ${daemonVer.join('.')}`);
    }
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

  // 6.5 票B B2：tcp 转发器配置——node.json/broker.json 可解析、钥字段齐、
  // broker TCP 可达（探活超时 2s）。B2 多星：node.json 逐条目检查/探活；
  // 单条目输出与 B2 之前逐字节同形。目录未接线或无任何配置文件 → 整段跳过。
  if (deps.tcpDir !== undefined) {
    const nodeRaw = deps.readFile(join(deps.tcpDir, 'node.json'));
    const brokerRaw = deps.readFile(join(deps.tcpDir, 'broker.json'));
    if (nodeRaw !== undefined || brokerRaw !== undefined) {
      let entries: BrokerEntry[] | undefined;
      if (nodeRaw !== undefined) {
        try {
          entries = readNodeConfig(join(deps.tcpDir, 'node.json')).entries;
        } catch {
          fail(`❌ tcp 节点配置 node.json 损坏或缺钥字段（${join(deps.tcpDir, 'node.json')}）——向管理员重新索取 node.json 覆盖`);
        }
        if (entries !== undefined) {
          const label = (e: BrokerEntry): string => e.alias ?? `${e.host}:${e.port}`;
          const multi = entries.length > 1;
          entries.forEach((e, i) => {
            ok(multi
              ? `✅ tcp 节点条目 ${i + 1}/${entries!.length} 可解析（broker ${label(e)}）`
              : `✅ tcp 节点配置可解析（broker ${label(e)}）`);
          });
          if (multi) {
            // 多条目专属体检：旧条目缺 starId / 两条目疑似同一星
            for (const e of entries) {
              if (e.starId === undefined) {
                attention(`⚠️ 条目 ${label(e)} 缺 starId（旧配置——连一次自动回填或重新索取 node.json）`);
              }
            }
            const firstOfStar = new Map<string, string>();
            for (const e of entries) {
              if (e.starId === undefined) continue;
              const prev = firstOfStar.get(e.starId);
              if (prev === undefined) firstOfStar.set(e.starId, label(e));
              else attention(`⚠️ 条目 ${prev} 与 ${label(e)} 的 starId 相同（${e.starId}）——疑似同一星配了两次`);
            }
          }
        }
      }
      if (brokerRaw !== undefined) {
        try {
          const reg = JSON.parse(brokerRaw) as { nodes?: { label?: string; key?: string }[] };
          if (!Array.isArray(reg.nodes) || reg.nodes.some((n) => typeof n.label !== 'string' || typeof n.key !== 'string')) {
            throw new Error('bad shape');
          }
          ok(`✅ tcp broker 注册表可解析（${reg.nodes.length} 节点）`);
        } catch {
          fail('❌ tcp broker 注册表 broker.json 损坏或字段缺失——crosschat serve --list 核对，必要时重发钥匙');
        }
      }
      if (entries !== undefined) {
        const probe = deps.probeTcp ?? (() => true);
        const multi = entries.length > 1;
        entries.forEach((e, i) => {
          if (probe(e.host, e.port)) {
            ok(multi ? `✅ 条目 ${i + 1} broker TCP 可达（${e.alias ?? ''} ${e.host}:${e.port}）` : `✅ broker TCP 可达（${e.host}:${e.port}）`);
          } else {
            fail(multi
              ? `❌ 条目 ${i + 1} broker TCP 不可达（${e.host}:${e.port}）——确认 broker 机 crosschat serve 在跑、网络/防火墙放行端口`
              : `❌ broker TCP 不可达（${e.host}:${e.port}）——确认 broker 机 crosschat serve 在跑、网络/防火墙放行端口`);
          }
        });
      }
    }
  }

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

function firstLine(text: string | undefined): string {
  return (text ?? '').split(/\r?\n/, 1)[0] ?? '';
}
