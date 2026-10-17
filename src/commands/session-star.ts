/**
 * 018 批二：会话入星命令面——启动器旗标（crosschat claude/codex --connect <星>）
 * 的解析、聚合器保障（不在则自动 serve --connect --detach 拉起，013 护栏在位）、
 * attach 守连接（断线重连原样重声明，退出即 detach）、extends 四级校验接线、
 * serve --adopt 收编活进程、9b 降级告警。纯 IPC+WS+扫描，零模型调用。
 */
import { spawn } from 'node:child_process';
import { createConnection, type Socket } from 'node:net';
import { homedir, hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { MultichatError } from '../errors.js';
import { appendWithRotate } from '../log-rotate.js';
import { CAP_SESSION_MEMBERS, hasCap } from '../serve/protocol.js';
import type { SessionMemberDecl } from '../serve/protocol.js';
import { attachPipePath, readNodeConfig, type BrokerEntry } from '../serve/node.js';
import { tcpDir } from '../serve/registry.js';
import { fetchBrokerCaps, fetchRosterFor } from '../serve/via-tcp.js';
import { selectConnectEntry } from './serve.js';
import { resolveTargetByName } from '../resolve.js';
import { decodeRef } from '../ref.js';
import { readSendLogTail, defaultSendLogFile } from '../send-log.js';
import { listClaudeSessions as listClaudeSessionsReal } from '../claude/registry.js';
import { listCodexThreads as listCodexThreadsReal } from '../codex/discovery.js';

// ---- 旗标解析（claude/codex 包装器共用；codex 无 -n） ---------------------------

export interface StarLauncherFlags {
  /** 剥离星旗标后的原样透传参数。 */
  passthrough: string[];
  /** 会话名不经旗标面——claude -n 原生透传，名字由聚合器扫描回填。 */
  /** --connect 取值（可重复=多星；''=裸默认腿）。 */
  connects: string[];
  /** --extend-session 旧会话名。 */
  extendSession?: string;
  /** 028 --rm：临时修饰（退出即离册零痕迹，docker --rm 语义；须与 --connect 连用）。 */
  rm?: boolean;
}

/**
 * 剥离并解析入星旗标（只认死自家发明）：`--connect <星>`
 * （可重复，支持 `--connect=星`）、`--extend-session <旧名>`、`--rm`（028 临时
 * 修饰，与 --extend-session 互斥——临时会话无接任语义）。其余参数原样透传
 * （含两个旋钮——旋钮剥离仍由 splitLauncherKnobs 在 passthrough 上做）。
 */
export function splitStarLauncherArgs(args: readonly string[]): StarLauncherFlags {
  const passthrough: string[] = [];
  const connects: string[] = [];
  let extendSession: string | undefined;
  let rm = false;
  const valueOf = (token: string, inline: string | undefined, next: string | undefined, what: string): string => {
    const value = inline ?? next;
    if (value === undefined || value === '' || value.startsWith('--')) {
      throw new MultichatError('USAGE', `${what} 需要一个取值（${token} <值>）`);
    }
    return value;
  };
  for (let i = 0; i < args.length; i++) {
    const token = args[i]!;
    const eq = token.indexOf('=');
    const name = eq > 0 ? token.slice(0, eq) : token;
    const inline = eq > 0 ? token.slice(eq + 1) : undefined;
    if (name === '--connect') {
      // --connect 可选值：裸 --connect=默认腿（'--connect' 后跟旗标也按裸腿）
      const value = inline ?? (args[i + 1] !== undefined && !args[i + 1]!.startsWith('--') ? args[i + 1]! : '');
      if (inline === undefined && value !== '') i++;
      connects.push(value);
    } else if (name === '--extend-session') {
      if (extendSession !== undefined) throw new MultichatError('USAGE', '--extend-session 只能给一次');
      extendSession = valueOf(token, inline, args[i + 1], '--extend-session <旧会话名>');
      if (inline === undefined) i++;
    } else if (name === '--rm') {
      rm = true;
    } else {
      // 只认死自家旗标：-n/--name 等 claude/codex 原生参数一律原样放行（2026-10-15 用户裁定）
      passthrough.push(token);
    }
  }
  if (extendSession !== undefined && extendSession.includes(':')) {
    throw new MultichatError('USAGE', `--extend-session 旧会话名 ${extendSession} 禁含冒号（跨机旧名用 {机器}:{名} 形态暂不在旗标面，先同名接续）`);
  }
  // 028 边界2：--rm × --extend-session 互斥（临时会话无接任语义）
  if (rm && extendSession !== undefined) {
    throw new MultichatError('USAGE', '--rm 与 --extend-session 互斥——--rm 是临时会话（退出即离册零痕迹），无接任语义；要接续旧名去掉 --rm（永久注册）');
  }
  if (rm && connects.length === 0) {
    throw new MultichatError('USAGE', '--rm 修饰 --connect <星>（crosschat claude/codex --connect <星> --rm）——单独使用无意义');
  }
  return { passthrough, connects, ...(extendSession === undefined ? {} : { extendSession }), ...(rm ? { rm: true } : {}) };
}

// ---- 依赖 -----------------------------------------------------------------------

/** 入星/收编共用的可注入依赖（真值 realStarJoinDeps；测试注入临时目录与假扫描）。 */
export interface StarJoinDeps {
  /** tcp 根目录（node.json/管道所在；真值 ~/.crosschat）。 */
  tcpBaseDir: string;
  stdout(line: string): void;
  stderr(line: string): void;
  /** 021 静默纪律：spawn 后成功路径（attach 确认/断连重连提示）落日志不打控制台（真值 ~/.crosschat/tcp/launcher.log）。 */
  log(line: string): void;
  listClaudeSessions(): { sessions: Array<{ sessionId: string; name?: string; updatedAt?: number; startedAt?: number }> };
  listCodexThreads(): Promise<Array<{ id: string; name: string | null; createdAt?: number }>>;
  /** 自动拉聚合器（serve --connect <selector> --detach）；013 双开护栏在其内部在位。 */
  spawnServeDetach(selector: string): void;
  /** extends 证据源（本机 send-log 名字史）；缺省不查。 */
  sendLogFile?: string;
  /** 本机显示名（入星回执的三段寻址展示）。 */
  machineName: string;
  now?(): number;
  /** 聚合器就绪等待上限（缺省 30s；测试注短值）。 */
  aggregatorTimeoutMs?: number;
}

/** 真值依赖的自动拉聚合器腿（serve.ts 的 adopt 桥同用）。 */
export function spawnServeDetachReal(selector: string): void {
  const entry = process.argv[1] ?? fileURLToPath(new URL('../cli.js', import.meta.url));
  const child = spawn(process.execPath, [realpathSync(entry), 'serve', '--connect', ...(selector === '' ? [] : [selector]), '--detach'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

export function realStarJoinDeps(): StarJoinDeps {
  return {
    tcpBaseDir: join(homedir(), '.crosschat'),
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
    // 021：TUI 接管控制台后裸 stdout 写会落进输入区——成功路径全部进日志（node 日志旁挂，带轮转）
    log: (line) => {
      try {
        appendWithRotate(join(tcpDir(join(homedir(), '.crosschat')), 'launcher.log'), `${new Date().toISOString()} ${line}\n`);
      } catch {
        // 日志尽力而为：写失败不倒守连接
      }
    },
    listClaudeSessions: () => listClaudeSessionsReal(),
    listCodexThreads: async () => (await listCodexThreadsReal()).map((thread) => ({
      id: thread.id,
      name: thread.name,
      createdAt: thread.meta?.createdAt === undefined ? undefined : Date.parse(thread.meta.createdAt),
    })),
    spawnServeDetach: spawnServeDetachReal,
    sendLogFile: defaultSendLogFile(),
    machineName: realMachineName(),
    now: () => Date.now(),
  };
}

function realMachineName(): string {
  try {
    return readNodeConfig(join(tcpDir(join(homedir(), '.crosschat')), 'node.json')).showName ?? hostname();
  } catch {
    return hostname();
  }
}

// ---- attach 管道客户端 ------------------------------------------------------------

export interface AttachPipeClient {
  /** 单帧请求/回执（换行 JSON；回执合并 status 探针字段）。 */
  send(req: unknown): Promise<{ ok: boolean; error?: string } & Partial<AttachStatusReply>>;
  /** 管道断开（聚合器停/重启）——监督循环据此重连。 */
  waitClose(): Promise<void>;
  close(): void;
}

/** 连 attach 管道（失败重试 retries 次每次 retryMs——聚合器上线首起管道有窗口）。 */
export function connectAttachPipe(pipePath: string, retries = 0, retryMs = 300): Promise<AttachPipeClient> {
  return new Promise((resolve, reject) => {
    const tryConnect = (left: number): void => {
      const socket: Socket = createConnection({ path: pipePath });
      const giveUp = (err: Error): void => {
        socket.destroy();
        if (left <= 0) return reject(err);
        setTimeout(() => tryConnect(left - 1), retryMs);
      };
      socket.once('error', giveUp);
      socket.once('connect', () => {
        socket.removeListener('error', giveUp);
        let buf = '';
        let closedResolve: (() => void) | undefined;
        const closedPromise = new Promise<void>((r) => { closedResolve = r; });
        const waiters: Array<(r: { ok: boolean; error?: string }) => void> = [];
        socket.on('data', (chunk) => {
          buf += chunk.toString('utf8');
          for (;;) {
            const idx = buf.indexOf('\n');
            if (idx < 0) break;
            const line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            if (line.trim() === '') continue;
            const waiter = waiters.shift();
            if (waiter !== undefined) {
              try {
                waiter(JSON.parse(line) as { ok: boolean; error?: string });
              } catch {
                waiter({ ok: false, error: 'attach 管道回执不是合法 JSON' });
              }
            }
          }
        });
        socket.once('close', () => closedResolve?.());
        socket.on('error', () => socket.destroy());
        resolve({
          send: (req) =>
            new Promise((res) => {
              waiters.push((r) => res(r as { ok: boolean; error?: string } & Partial<AttachStatusReply>));
              socket.write(`${JSON.stringify(req)}\n`);
            }),
          waitClose: () => closedPromise,
          close: () => socket.destroy(),
        });
      });
    };
    tryConnect(retries);
  });
}

/** attach 管道 status 探针回执（成员表 + broker 能力）。 */
export interface AttachStatusReply {
  online: boolean;
  brokerCap: boolean;
  members: SessionMemberDecl[];
}

export async function queryAttachStatus(pipe: AttachPipeClient): Promise<AttachStatusReply | undefined> {
  const reply = await pipe.send({ op: 'status' });
  return reply.ok && Array.isArray(reply.members) && typeof reply.brokerCap === 'boolean'
    ? { online: reply.online === true, brokerCap: reply.brokerCap, members: reply.members }
    : undefined;
}

// ---- 聚合器保障 -------------------------------------------------------------------

/**
 * 确保（本机,星）聚合器在线并返回其管道连接：管道先试（聚合器在跑即直连）；
 * 不在则自动 `serve --connect <selector> --detach` 拉起（013 同星护栏在 serve
 * 侧在位——误拉会被拒，重试循环继续等真守护的管道），拉起后重试至超时。
 */
export async function ensureAggregator(deps: StarJoinDeps, entry: BrokerEntry, selector: string): Promise<AttachPipeClient> {
  const pipePath = attachPipePath(entry, tcpDir(deps.tcpBaseDir));
  const timeoutMs = deps.aggregatorTimeoutMs ?? 30_000;
  try {
    return await connectAttachPipe(pipePath);
  } catch {
    // 不在线：自动拉起（失败不追问——可能 013 护栏拒绝=已有守护在起，重试等管道）
    deps.spawnServeDetach(selector);
  }
  const deadline = (deps.now?.() ?? Date.now()) + timeoutMs;
  for (;;) {
    await sleep(500);
    try {
      return await connectAttachPipe(pipePath);
    } catch {
      if ((deps.now?.() ?? Date.now()) > deadline) {
        const cmd = selector === '' ? 'crosschat serve --connect --detach' : `crosschat serve --connect ${selector} --detach`;
        throw new MultichatError('NOT_READY', `星 ${entry.name ?? selector} 的聚合器未就绪（已尝试自动拉起）——手动排查：${cmd}，看日志 ~/.crosschat/tcp/node*.log`);
      }
    }
  }
}

// ---- extends 四级校验（批二接线） ---------------------------------------------------

/**
 * --extend-session 校验（用户裁定 7 的命令面接线，失败方向不锁死）：
 * 1. 旧名仍是星内某机的活成员（broker roster 聚合的聚合器内存——"broker 记得+
 *    守护记得"两级的活名并集）→ 拒绝（alive-wins 会让 extends 休眠，先退旧会话
 *    或去掉旗标）；broker 不可达则跳过本级（broker 侧 EXTENDS_CONFLICT 兜底）。
 * 2. 本机对话史有该名（send-log 落盘的 to 显示名；会话分片 ref 带星标识但不带
 *    会话名——名字史的实际落盘面是 send-log）→ 放行并返回 'log'（调用方出声）。
 * 3. 都无 → 'none'（无人查询的名字，静默放行）。
 */
export async function checkExtendSession(
  deps: Pick<StarJoinDeps, 'tcpBaseDir' | 'sendLogFile'>,
  oldName: string,
  entry: BrokerEntry,
): Promise<'none' | 'log'> {
  const roster = await fetchRosterFor(deps.tcpBaseDir, entry, 2_000);
  if (roster !== undefined) {
    for (const machine of roster) {
      for (const decl of machine.sessions ?? []) {
        if (decl.name === oldName || decl.sessionId === oldName) {
          const where = machine.name === undefined ? machine.mid8 : machine.name;
          throw new MultichatError(
            'EXTENDS_CONFLICT',
            `旧会话名 ${oldName} 仍是 ${where} 的活成员（alive-wins：extends 会休眠不生效）——先退出该会话再接续，或去掉 --extend-session 直接开新名`,
          );
        }
      }
    }
  }
  return hasLocalNameHistory(oldName, deps.sendLogFile) ? 'log' : 'none';
}

/** 本机 send-log 尾窗里是否有该名的跨星对话史（to 显示名段 + via:tcp/starId 痕迹）。 */
export function hasLocalNameHistory(name: string, sendLogFile: string | undefined): boolean {
  if (sendLogFile === undefined) return false;
  // shortcut: 只看尾窗——更早史已轮转时按"无证据"放行（broker 冲突映射仍兜底）
  for (const entry of readSendLogTail(sendLogFile)) {
    if ((entry.to.split('@')[0] ?? '') !== name) continue;
    if (entry.target.startsWith('via:tcp:')) return true;
    if (entry.replyRef !== undefined && entry.replyRef !== '') {
      try {
        if (decodeRef(entry.replyRef).starId !== undefined) return true;
      } catch {
        // 不可解码的 ref 不作证据
      }
    }
  }
  return false;
}

// ---- 9b 降级告警 -------------------------------------------------------------------

/** 9b：broker 无 session-members cap → 命令面一行告警（探测不到不出声）。 */
export async function warnIfBrokerLacksSessionCaps(entry: BrokerEntry, warn: (line: string) => void): Promise<void> {
  const caps = await fetchBrokerCaps(entry);
  if (caps !== undefined && !hasCap(caps, CAP_SESSION_MEMBERS)) {
    warn('broker 不支持会话成员（proto:3），已降级机器级——本机会话的入星声明不生效（机器级收发不受影响）');
  }
}

// ---- 启动器入星（守连接） ------------------------------------------------------------

interface StarTarget {
  entry: BrokerEntry;
  selector: string;
}

/**
 * 启动器的入星腿：spawn 后探测新会话 ID（快照差分——shortcut: 并发同侧另起
 * 会话时可能选中最新者，选错可用 serve --adopt 纠正），确保每星聚合器、四级
 * 校验（首度 attach 前一次）、attach 并守连接（管道断=聚合器重启→重连原样
 * 重声明，启动器即第三方记忆）；stop() 即 detach。021 输出纪律：横幅 spawn
 * 前同步打（报地址不预支成功），spawn 后成功路径全静默（确认/重连落日志），
 * 失败只出一行 stderr，绝不连坐子进程（会话本身不因入星失败而死）。
 */
export class StarJoiner {
  private stopped = false;
  private resolveStopped!: () => void;
  /** 023：stop 信号——与 superviseStar 的无界等待点（waitClose）race，stop 落重连窗口不挂起。 */
  private readonly stoppedSignal: Promise<void>;
  private readonly pipes = new Map<string, AttachPipeClient>();
  private readonly supervise: Promise<void>[] = [];
  private sessionId?: string;
  private readonly targets: StarTarget[] = [];
  private readonly knownClaude = new Set<string>();
  private readonly knownCodex = new Set<string>();

  constructor(
    private readonly opts: {
      deps: StarJoinDeps;
      side: 'claude' | 'codex';
      connects: string[];
      extendSession?: string;
      /** spawn 时已知的会话名（claude -n 原生透传）——有则横幅打三段地址行，无名（codex/未命名）只打星名行。 */
      spawnName?: string;
      /** 028 --rm：临时会话——退出即离册零痕迹（erase detach）；缺省永久注册（退出=下线，册位保留）。 */
      rm?: boolean;
    },
  ) {
    this.stoppedSignal = new Promise((resolve) => {
      this.resolveStopped = resolve;
    });
  }

  /** spawn 前调用：同步解析星目标并打横幅（TUI 接管控制台前落定），快照现存会话（差分基线）。 */
  async begin(): Promise<void> {
    this.resolveTargetsAndBanner();
    await this.warnCrossToolNameCollision();
    for (const session of this.opts.deps.listClaudeSessions().sessions) this.knownClaude.add(session.sessionId);
    try {
      for (const thread of await this.opts.deps.listCodexThreads()) this.knownCodex.add(thread.id);
    } catch {
      // codex daemon 未起：空基线（子进程会拉起 daemon，新线程即差分命中）
    }
    void this.run();
  }

  /**
   * 020 启动期同名预警（spawn 前打）：-n 名与星内既有成员异工具同名时打一行
   * "你的地址将是 工具/名"——把发送期碰撞提前到启动期可见。尽力而为：attach
   * 管道已在才查（聚合器不在静默跳过不延迟 spawn），status 探针 ~2s 超时上限
   * （021 纪律：此行属 spawn 前横幅面，走 stdout）。
   */
  private async warnCrossToolNameCollision(): Promise<void> {
    const { deps, side, spawnName } = this.opts;
    if (spawnName === undefined || this.targets.length === 0) return;
    for (const target of this.targets) {
      let pipe: AttachPipeClient | undefined;
      try {
        pipe = await connectAttachPipe(attachPipePath(target.entry, tcpDir(deps.tcpBaseDir)));
        const status = await Promise.race([queryAttachStatus(pipe), sleep(2_000).then(() => undefined)]);
        const other = status?.members.find((m) => m.name === spawnName && m.tool !== undefined && m.tool !== side);
        if (other !== undefined) {
          deps.stdout(`预警: 星内已有 ${other.tool}/${spawnName}，你的地址将是 ${side}/${spawnName}（同名异工具，发送方需带工具限定词）`);
        }
      } catch {
        // 聚合器不在/管道未起——预警尽力而为，跳过
      } finally {
        pipe?.close();
      }
    }
  }

  /** 021：目标解析+横幅 spawn 前同步做（原先在异步 run() 里——attach 确认晚于子进程启动，横幅会落进 TUI）。 */
  private resolveTargetsAndBanner(): void {
    const { deps, connects } = this.opts;
    if (connects.length === 0) return;
    let config;
    try {
      config = readNodeConfig(join(tcpDir(deps.tcpBaseDir), 'node.json'));
    } catch (err) {
      deps.stderr(err instanceof MultichatError ? err.message : '本机未入网（~/.crosschat/tcp/node.json 不可读）——会话照常启动，入星未生效');
      return;
    }
    for (const selector of connects) {
      try {
        this.targets.push({ ...selectConnectEntry(selector, config), selector });
      } catch (err) {
        deps.stderr(err instanceof Error ? err.message : String(err));
      }
    }
    const { spawnName } = this.opts;
    for (const target of this.targets) {
      const starName = target.entry.name ?? target.selector;
      deps.stdout(
        spawnName === undefined
          ? `入星 ${starName}（attach 自动，异常见日志）`
          : `入星 ${starName}——会话地址 tcp:${starName}:${deps.machineName}:${spawnName}（attach 自动，异常见日志）`,
      );
    }
  }

  /**
   * 子进程退出后调用：detach（尽力而为）并收线。028 双模式：默认永久——detach
   * 不带 erase（聚合器移出声明集=下线，broker 册位保留，同 id resume 自动复活）；
   * --rm 临时——detach 带 erase（聚合器本地表外再报 broker 删条，退出零痕迹）。
   */
  async stop(): Promise<void> {
    this.stopped = true;
    this.resolveStopped(); // 023：唤醒重连窗口里可能在新管道上永等的 waitClose
    if (this.sessionId !== undefined) {
      for (const pipe of this.pipes.values()) {
        try {
          await Promise.race([
            pipe.send({ op: 'detach', sessionId: this.sessionId, ...(this.opts.rm === true ? { erase: true } : {}) }),
            sleep(800),
          ]);
        } catch {
          // 聚合器已不可达——成员随活性核验下线（--rm 未上报的册内条目滞留下线态）
        }
        pipe.close();
      }
    }
    await Promise.allSettled(this.supervise);
  }

  private async run(): Promise<void> {
    const { deps } = this.opts;
    if (this.targets.length === 0) return;
    // 9b：broker 能力预检（每星一行；探测不到不出声——聚合器重连时另行告警）
    for (const target of this.targets) await warnIfBrokerLacksSessionCaps(target.entry, deps.stderr);
    const detected = await this.detectSession();
    if (detected === undefined) {
      if (!this.stopped) {
        deps.stderr('未探测到新会话的 ID（启动器超时/会话即退）——会话未入星；若会话仍活可 crosschat serve --connect <星> --adopt <会话名> 收编');
      }
      return;
    }
    const { sessionId } = detected;
    this.sessionId = sessionId;
    if (this.stopped) return;
    for (const target of this.targets) {
      this.supervise.push(this.superviseStar(target, sessionId, detected.name));
    }
    await Promise.allSettled(this.supervise);
  }

  /** 快照差分探测子会话（claude=注册表新条目，含其当前名——-n 原生已写入；codex=新线程 id）。 */
  private async detectSession(timeoutMs = 120_000): Promise<{ sessionId: string; name?: string } | undefined> {
    const { deps, side } = this.opts;
    const deadline = (deps.now?.() ?? Date.now()) + timeoutMs;
    for (;;) {
      if (this.stopped) return undefined;
      try {
        if (side === 'claude') {
          const fresh = deps
            .listClaudeSessions()
            .sessions.filter((session) => session.sessionId !== '' && !this.knownClaude.has(session.sessionId));
          if (fresh.length > 0) {
            fresh.sort((a, b) => (b.updatedAt ?? b.startedAt ?? 0) - (a.updatedAt ?? a.startedAt ?? 0));
            const top = fresh[0]!;
            return { sessionId: top.sessionId, ...(top.name === undefined || top.name === null ? {} : { name: top.name }) };
          }
        } else {
          const fresh = (await deps.listCodexThreads()).filter((thread) => !this.knownCodex.has(thread.id));
          if (fresh.length > 0) {
            fresh.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
            return { sessionId: fresh[0]!.id }; // codex 名字天然后置（/rename），attach 不带名，扫描回填
          }
        }
      } catch {
        // 扫描抖动/daemon 未起：下一轮再试
      }
      if ((deps.now?.() ?? Date.now()) > deadline) return undefined;
      await sleep(500);
    }
  }

  /** 单星监督循环：ensure→（首度）校验+告警→attach→管道断则重连重声明。 */
  private async superviseStar(target: StarTarget, sessionId: string, name?: string): Promise<void> {
    const { deps, extendSession, side } = this.opts;
    const attachName = name; // 快照差分时注册表已有名（-n 原生写入）——attach 即时带上；改名后续由聚合器扫描跟随
    let validated = false;
    while (!this.stopped) {
      let pipe: AttachPipeClient;
      try {
        pipe = await ensureAggregator(deps, target.entry, target.selector);
      } catch (err) {
        deps.stderr(err instanceof Error ? err.message : String(err));
        return; // 该星放弃（其余星不受影响；会话照常）
      }
      this.pipes.set(target.selector, pipe);
      try {
        if (!validated) {
          validated = true;
          if (extendSession !== undefined) {
            try {
              const evidence = await checkExtendSession(deps, extendSession, target.entry);
              if (evidence === 'log') {
                deps.log(`extends ${extendSession}：本机有该名对话史——接续登记后，投给旧名的消息将指路到新会话`);
              }
            } catch (err) {
              deps.stderr(err instanceof Error ? err.message : String(err));
              return; // 旧名仍是活成员：本星不 attach（去旗标重跑即解锁——失败方向不锁死）
            }
          }
        }
        const reply = await pipe.send({
          op: 'attach',
          sessionId,
          tool: side, // 020：启动器天然知道 side——同机跨工具同名消歧的声明源
          ...(attachName === undefined ? {} : { name: attachName }),
          ...(this.opts.extendSession === undefined ? {} : { extends: this.opts.extendSession }),
          ...(this.opts.rm === true ? { temporary: true } : {}), // 029：临时位随声明入册（死亡即删）
        });
        if (!reply.ok) {
          deps.stderr(`入星 ${target.entry.name ?? target.selector} 失败：${reply.error ?? '聚合器拒绝 attach'}`);
          return;
        }
        const starName = target.entry.name ?? target.selector;
        deps.log(`已入星 ${starName}：会话可经 tcp:${starName}:${deps.machineName}:${attachName ?? sessionId.slice(0, 8)} 直达`);
        // 聚合器重启/管道断——重连原样重声明；stop 时经信号即时唤醒（023：stop 落重连窗口不挂起）
        await Promise.race([pipe.waitClose(), this.stoppedSignal]);
        if (!this.stopped) deps.log(`星 ${starName} 聚合器连接断开，重连中……`);
      } finally {
        this.pipes.delete(target.selector);
        pipe.close();
      }
      await sleep(1_000);
    }
  }
}

// ---- serve --adopt 收编 -------------------------------------------------------------

export interface AdoptArgs {
  /** --connect 取值（''=默认腿）。 */
  connect: string;
  /** --adopt 会话名。 */
  adopt: string;
  /** --extend-session 旧名（可选，补血统）。 */
  extendSession?: string;
}

/**
 * `serve --adopt <会话名>`（场景 E 恢复）：按名找本机活会话（复用 send 的
 * resolve——UNKNOWN 带候选、双活 COLLISION），命中即按其会话 ID 向聚合器
 * attach（收编活进程，不新建）。已是成员=幂等提示；聚合器不在自动拉起。
 */
export async function runAdopt(args: AdoptArgs, deps: StarJoinDeps): Promise<number> {
  const config = readNodeConfig(join(tcpDir(deps.tcpBaseDir), 'node.json'));
  const { entry, selector } = selectConnectEntry(args.connect, config);
  const sessions = deps.listClaudeSessions().sessions;
  const threads = await deps.listCodexThreads();
  let hit: { sessionId: string; name?: string; side: 'claude' | 'codex' };
  try {
    const resolved = resolveTargetByName(args.adopt, sessions, threads);
    hit =
      resolved.side === 'claude'
        ? { sessionId: resolved.session.sessionId, ...(resolved.session.name === undefined ? {} : { name: resolved.session.name }), side: 'claude' }
        : { sessionId: resolved.thread.id, ...(resolved.thread.name === null || resolved.thread.name === '' ? {} : { name: resolved.thread.name }), side: 'codex' };
  } catch (err) {
    if (err instanceof MultichatError) {
      deps.stderr(`adopt: ${err.message}`);
      return 1;
    }
    throw err;
  }
  const pipe = await ensureAggregator(deps, entry, selector);
  try {
    const status = await queryAttachStatus(pipe);
    if (status === undefined) {
      deps.stderr('adopt: 聚合器应答异常（status 探针无成员表）——重试或检查 crosschat 版本');
      return 1;
    }
    if (!status.brokerCap) {
      deps.stderr('adopt: broker 不支持会话成员（proto:3），已降级机器级——收编无意义，请先升级 broker 机 crosschat');
      return 1;
    }
    const alreadyMember = status.members.some((decl) => decl.sessionId === hit.sessionId);
    if (alreadyMember && args.extendSession === undefined) {
      deps.stdout(`会话 ${hit.name ?? hit.sessionId.slice(0, 8)} 已是星 ${entry.name ?? selector} 成员（幂等，无需收编）`);
      return 0;
    }
    if (args.extendSession !== undefined) {
      try {
        const evidence = await checkExtendSession(deps, args.extendSession, entry);
        if (evidence === 'log') {
          deps.stdout(`extends ${args.extendSession}：本机有该名对话史——接续登记后，投给旧名的消息将指路到收编会话`);
        }
      } catch (err) {
        deps.stderr(err instanceof Error ? err.message : String(err));
        return 1;
      }
    }
    const reply = await pipe.send({
      op: 'attach',
      sessionId: hit.sessionId,
      tool: hit.side, // 020：adopt 收编天然知道 side（resolve 结果）
      ...(hit.name === undefined ? {} : { name: hit.name }),
      ...(args.extendSession === undefined ? {} : { extends: args.extendSession }),
    });
    if (!reply.ok) {
      deps.stderr(`adopt 失败：${reply.error ?? '聚合器拒绝 attach'}`);
      return 1;
    }
    const starName = entry.name ?? selector;
    if (alreadyMember) {
      // 已是成员 + --extend-session = 改名/换轨后的接任声明（补血统，不新建）
      deps.stdout(`会话 ${hit.name ?? hit.sessionId.slice(0, 8)} 已是星 ${starName} 成员——已补 extends ${args.extendSession} 血统`);
      if (hit.name !== undefined) deps.stdout(`三段寻址：tcp:${starName}:${deps.machineName}:${hit.name}`);
      return 0;
    }
    deps.stdout(`已收编 ${hit.name ?? hit.sessionId.slice(0, 8)}（${hit.side}，id ${hit.sessionId.slice(0, 8)}）入星 ${starName}`);
    if (hit.name !== undefined) deps.stdout(`三段寻址：tcp:${starName}:${deps.machineName}:${hit.name}`);
    return 0;
  } finally {
    pipe.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
