import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
import { listNodeStatusFiles, nodeStatusSelector, TCP_STATUS_FRESH_MS } from './status.js';

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
  /** 安装源（npm 包内 skills/crosschat/SKILL.md 副本）内容；undefined = not locatable (skip compare). */
  repoSkillContent(): string | undefined;
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
    cliVersion: (
      JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
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
    repoSkillContent: () => {
      try {
        // dist/commands/ is two levels below the package root (same as install-skills).
        // 基准是包内 skills 副本而非仓库工作树（015："安装源"正名）。
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
  // 025 分组树：环境 / tcp·<星> / 其他 三段两级缩进（组名顶格、条目缩进两空格，
  // 不用框线保持 grep 友好）。检查项、判定、计数、退出码全部不变——纯展示层重排。
  const groups: { title: string; lines: string[] }[] = [];
  const group = (title: string): string[] => {
    const found = groups.find((g) => g.title === title);
    if (found !== undefined) return found.lines;
    const bucket: string[] = [];
    groups.push({ title, lines: bucket });
    return bucket;
  };
  const starTitle = (star: string): string => `tcp · ${star}`;
  let cur = group('环境');
  let pass = 0;
  let warn = 0;
  let bad = 0;
  const ok = (line: string) => {
    pass += 1;
    cur.push(line);
  };
  const attention = (line: string) => {
    warn += 1;
    cur.push(line);
  };
  const fail = (line: string) => {
    bad += 1;
    cur.push(line);
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
    attention('⚠️ claude CLI 未安装——纯 codex 互聊可忽略；需要 claude 会话时安装后重跑 doctor');
  }

  // 3+4. codex CLI and daemon versions (daemon needs the binary resolved first)
  let codexBin: string | undefined;
  try {
    codexBin = deps.codexBin();
  } catch {
    // reported below
  }
  if (codexBin === undefined) {
    // 未安装是合法机器状态（纯 claude 机）——提示不判错（用户 2026-10-12 拍板）
    attention('⚠️ codex CLI 未安装——纯 claude 互聊可忽略；需要 codex 会话时安装并运行: codex app-server daemon start');
  } else {
    const v = deps.run(codexBin, ['--version']);
    // 非 win32 下 resolveCodexExecutable() 不验存在性直接返回 'codex'：未安装时 spawn ENOENT、
    // stdout 为 undefined（v1.5.0 云端 doctor 崩溃根因），并入"未找到"而非当作版本解析失败。
    if (v.error !== undefined) {
      attention('⚠️ codex CLI 未安装——纯 claude 互聊可忽略；需要 codex 会话时安装并运行: codex app-server daemon start');
    } else {
      const ver = v.status === 0 ? parseSemver(v.stdout ?? '') : undefined;
      if (ver === undefined) attention(`⚠️ codex CLI 存在，但版本无法解析：${firstLine(v.stdout) || `(exit ${v.status ?? 'null'})`}`);
      else if (cmpVersion(ver, CODEX_MIN_VERSION) < 0) {
        attention(`⚠️ codex CLI ${ver.join('.')}（<${CODEX_MIN_VERSION.join('.')}：开窗投递需升级）`);
      } else ok(`✅ codex CLI ${ver.join('.')}`);

      const d = deps.run(codexBin, ['app-server', 'daemon', 'version']);
      const daemonVer = d.status === 0 ? parseSemver(d.stdout ?? '') : undefined;
      if (daemonVer === undefined) {
        // 015：装了但没跑不是本机故障（要用 codex 通道才需要）——⚠️ 教学提示，不 ❌（用户拍板）
        attention('⚠️ codex daemon 未运行；要用 codex 通道时先执行: codex app-server daemon start');
      } else if (cmpVersion(daemonVer, CODEX_MIN_VERSION) < 0) {
        attention(`⚠️ codex daemon ${daemonVer.join('.')}（<${CODEX_MIN_VERSION.join('.')}：开窗投递需升级后重启 daemon）`);
      } else ok(`✅ codex daemon ${daemonVer.join('.')}`);
    }
  }

  // 5. skill installation (compared against the install source when locatable)
  // 015：基准是 deps.repoSkillContent() —— npm 包内 skills 副本（见 defaultDoctorDeps），
  // 不是仓库工作树，故文案叫"安装源"而非"仓库"。
  const repo = deps.repoSkillContent();
  for (const root of ['.claude', '.codex'] as const) {
    const side = root === '.claude' ? 'claude' : 'codex';
    const path = join(deps.homeDir(), root, 'skills', 'crosschat', 'SKILL.md');
    if (!deps.exists(path)) {
      attention(`⚠️ ${side} 侧 skill 未安装（${path}）；运行 crosschat install-skills`);
      continue;
    }
    if (repo === undefined) {
      ok(`✅ ${side} 侧 skill 已安装（安装源 SKILL.md 未定位到，跳过版本比对）`);
      continue;
    }
    if (deps.readFile(path) === repo) ok(`✅ ${side} 侧 skill 与安装源一致`);
    else attention(`⚠️ ${side} 侧 skill 与安装源不一致；重跑 crosschat install-skills`);
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
  // broker TCP 可达（探活超时 2s）。B2 多星：node.json 逐条目检查/探活。
  // 025：逐条目行归 `tcp · <星名>` 组（星名=条目 name，缺省 host:port）；
  // 编号条目（"条目 1/2"）退役——星名即分组标题。tcpDir 级单查（注册表、
  // node.json 损坏）无星可归时挂裸 tcp 组。目录未接线或无任何配置文件 → 整段跳过。
  if (deps.tcpDir !== undefined) {
    const nodeRaw = deps.readFile(join(deps.tcpDir, 'node.json'));
    const brokerRaw = deps.readFile(join(deps.tcpDir, 'broker.json'));
    if (nodeRaw !== undefined || brokerRaw !== undefined) {
      const label = (e: BrokerEntry): string => e.name ?? `${e.host}:${e.port}`;
      let entries: BrokerEntry[] | undefined;
      if (nodeRaw !== undefined) {
        try {
          entries = readNodeConfig(join(deps.tcpDir, 'node.json')).entries;
        } catch {
          cur = group('tcp');
          fail(`❌ tcp 节点配置 node.json 损坏或缺钥字段（${join(deps.tcpDir, 'node.json')}）——向管理员重新索取 node.json 覆盖`);
        }
        if (entries !== undefined) {
          for (const e of entries) {
            cur = group(starTitle(label(e)));
            ok('✅ 节点条目可解析');
          }
          if (entries.length > 1) {
            // 多条目专属体检：旧条目缺 starId / 两条目疑似同一星
            for (const e of entries) {
              if (e.starId === undefined) {
                cur = group(starTitle(label(e)));
                attention(`⚠️ 条目 ${label(e)} 缺 starId（旧配置——连一次自动回填或重新索取 node.json）`);
              }
            }
            const firstOfStar = new Map<string, string>();
            for (const e of entries) {
              if (e.starId === undefined) continue;
              const prev = firstOfStar.get(e.starId);
              if (prev === undefined) firstOfStar.set(e.starId, label(e));
              else {
                cur = group(starTitle(label(e)));
                attention(`⚠️ 条目 ${prev} 与 ${label(e)} 的 starId 相同（${e.starId}）——疑似同一星配了两次`);
              }
            }
          }
        }
      }
      if (entries !== undefined) {
        const probe = deps.probeTcp ?? (() => true);
        for (const e of entries) {
          cur = group(starTitle(label(e)));
          if (probe(e.host, e.port)) ok(`✅ broker 可达（${e.host}:${e.port}）`);
          else fail(`❌ broker 不可达（${e.host}:${e.port}）——确认 broker 机 crosschat serve 在跑、网络/防火墙放行端口`);
        }
      }
      if (brokerRaw !== undefined) {
        // 注册表是 tcpDir 级单查：归首个星组，无条目可归时挂裸 tcp 组
        cur = groups.find((g) => g.title.startsWith('tcp ·'))?.lines ?? group('tcp');
        try {
          const reg = JSON.parse(brokerRaw) as { nodes?: { label?: string; key?: string }[] };
          if (!Array.isArray(reg.nodes) || reg.nodes.some((n) => typeof n.label !== 'string' || typeof n.key !== 'string')) {
            throw new Error('bad shape');
          }
          ok(`✅ broker 注册表可解析（${reg.nodes.length} 节点）`);
        } catch {
          fail('❌ broker 注册表 broker.json 损坏或字段缺失——crosschat serve --list 核对，必要时重发钥匙');
        }
      }
    }
  }

  // 6.6 F1 版本对账：常驻（broker/节点守护）status 文件自带的 version 与本机
  // CLI 版本比对——不一致 = 升级了 npm 包但常驻进程没重启（新 CLI + 旧常驻）。
  // 旧守护 status 文件无 version 字段 → 跳过不误报；⚠️ 级不 ❌（行为怪异不是故障）。
  // 015：lastUpdated 超 TCP_STATUS_FRESH_MS = 守护已停止（心跳每周期刷新）——
  // 跳过对账不误报"升级后未重启"，逐文件点名可删；重启口诀按守护类型给。
  // 025 归组：status-node-<星>.json 按文件名星段；无星段的按产生者——broker 用
  // 自身 name（E0），默认节点守护用 brokerAlias；都无线索 → 其他组。
  if (deps.tcpDir !== undefined && deps.cliVersion !== undefined) {
    const nowMs = deps.now?.() ?? Date.now();
    const reconcile = (file: string, label: string, restartCmd: string): void => {
      const raw = deps.readFile(join(deps.tcpDir!, file));
      if (raw === undefined) return;
      let parsed: { version?: unknown; lastUpdated?: unknown; name?: unknown; brokerAlias?: unknown };
      try {
        parsed = JSON.parse(raw) as { version?: unknown; lastUpdated?: unknown; name?: unknown; brokerAlias?: unknown };
      } catch {
        return; // 坏文件不在此项的职责内（tcp 配置项已覆盖可查的坏形状）
      }
      if (file === 'status-node.json') {
        cur = typeof parsed.brokerAlias === 'string' && parsed.brokerAlias !== ''
          ? group(starTitle(parsed.brokerAlias))
          : group('其他');
      } else if (file === 'status-broker.json') {
        cur = typeof parsed.name === 'string' && parsed.name !== ''
          ? group(starTitle(parsed.name))
          : group('其他');
      } else {
        cur = group(starTitle(nodeStatusSelector(file)));
      }
      if (!(nowMs - Date.parse(String(parsed.lastUpdated)) < TCP_STATUS_FRESH_MS)) {
        // 行动提示非故障：不计入通过/警告/错误计数
        cur.push(`ℹ️ 陈旧状态文件（守护已停止）跳过版本对账：${file}——确认无用后可删除`);
        return;
      }
      const version = parsed.version;
      if (typeof version === 'string' && version !== '' && version !== deps.cliVersion) {
        attention(
          `⚠️ 常驻进程（${label}）为 v${version}，本机 v${deps.cliVersion}——升级后未重启：${restartCmd}`,
        );
      }
    };
    reconcile('status-broker.json', 'broker', 'serve --stop && serve --detach');
    const list = deps.readDir ?? ((dir: string) => {
      try {
        return readdirSync(dir);
      } catch {
        return [];
      }
    });
    for (const file of listNodeStatusFiles(deps.tcpDir, list)) {
      const selector = nodeStatusSelector(file);
      // 节点守护重启不带 --stop（broker 口诀）——--connect <星名> 选对腿；默认守护=裸 --connect
      reconcile(
        file,
        selector === '' ? '节点守护' : `节点守护 ${selector}`,
        selector === '' ? 'crosschat serve --connect --detach' : `crosschat serve --connect ${selector} --detach`,
      );
    }
  }

  // 7. outbox state + watchdog + mailbox (informational)
  cur = group('其他');
  const parked = deps.listOutbox();
  if (parked.length === 0) {
    ok('✅ 发件箱空（无暂存消息）');
  } else {
    const watchdog = deps.watchdogRunning?.() ?? watchdogStatus(defaultOutboxDir());
    const nowMs = deps.now?.() ?? Date.now();
    for (const { threadId, count, oldestParkedAt } of parked) {
      pass += 1;
      const age = oldestParkedAt === undefined ? '' : `，最旧 ${Math.max(1, Math.round((nowMs - oldestParkedAt) / 60_000))} 分钟`;
      cur.push(
        `⏳ 线程 ${threadId.slice(0, 8)} 暂存 ${count} 条${age}（看门狗${watchdog.running ? '运行中' : '未运行'}；` +
          `滞留内容: ${mailboxFileFor(defaultOutboxDir(), threadId)}）`,
      );
    }
  }

  // 025 组装：组名行顶格、条目行缩进两空格；空组不出行（如对账无差异的 tcp 组）；
  // 其他组固定殿后（其条目可能在 tcp 组之前产生，如无星段的陈旧状态文件）
  const lines: string[] = [];
  for (const g of groups.filter((g) => g.title !== '其他').concat(groups.filter((g) => g.title === '其他'))) {
    if (g.lines.length === 0) continue;
    lines.push(g.title, ...g.lines.map((l) => `  ${l}`));
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
