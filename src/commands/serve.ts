/**
 * `crosschat serve` 命令面（票B B1+B2）：broker 服务端入口 + 注册表管理旗标
 * + --connect 节点客户端。broker 裸跑自身也是全权节点（deliverLocal 接
 * runSend，fileInbox 落盘本机收件）。
 */
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir, hostname, networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import process from 'node:process';
import { MultichatError } from '../errors.js';
import { appendWithRotate } from '../log-rotate.js';
import { machineId } from '../platform/machine-id.js';
import { isProcessAlive } from '../platform/process-inspector.js';
import { Broker, DEFAULT_PORT, defaultDeliverLocal, rosterFileForStar, rosterFileOf } from '../serve/broker.js';
import {
  ensureMultiStarIds,
  ensureStarId,
  ensureStarName,
  genKeys,
  genKeysForStar,
  listNodes,
  readMultiRegistry,
  readRegistry,
  registryFileOf,
  removeNode,
  removeNodeForStar,
  sanitizeName,
  selectStar,
  setName,
  setNameForStar,
  setPort,
  STAR_NAME_RE,
  tcpDir,
  writeMultiRegistry,
  writeRegistry,
  type StarReg,
} from '../serve/registry.js';
import { buildStatusPayload, deliverViaRunSend, formatBrokerEntry, NodeClient, readNodeConfig, syncNodeJsonEntry, type BrokerEntry, type NodeConfig } from '../serve/node.js';
import { VirtualSocket } from '../serve/virtual-socket.js';
import { FileInbox } from '../serve/file-channel.js';
import { requestMemberRemove } from '../serve/via-tcp.js';
import { runAdopt, spawnServeDetachReal, warnIfBrokerLacksSessionCaps } from './session-star.js';
import { listNodeStatusFiles } from './status.js';
import type { SendDeps } from './send.js';
import type { DeliverFrame, ErrorFrame, ResultFrame, SendFrame, StatusPayload } from '../serve/protocol.js';

export interface ServeArgs {
  portArg?: string;
  /** E0 星名（broker 专用；校验/持久化在 registry.setName；多星下须与 --star 连用）。 */
  nameArg?: string;
  /** 022：星域选择器（多星注册表下限定 --gen-key/--remove/--name 的目标星）。 */
  starArg?: string;
  /** 022：--add-star <名>——broker 托管第二颗星（一次性：迁移星册+注册表转多星形状）。 */
  addStarArg?: string;
  /** 数字字符串，缺省 '1'；上限校验在 registry.genKeys。 */
  genKeyArg?: string;
  list?: boolean;
  remove?: string;
  detach?: boolean;
  stopTarget?: 'broker' | 'node' | 'both';
  /** B2：--stop <选择器>——只停该选择器的节点守护（与 stopTarget 互斥）。 */
  stopSelector?: string;
  /** B2：节点模式（可选带 broker 别名校验 node.json）；'' = 未给值。 */
  connect?: string;
  /** 018 批二：--adopt <会话名>——收编本机活会话入 --connect 星（一次性命令）。 */
  adopt?: string;
  /** 018 批二：--extend-session <旧名>——adopt 并用补血统（也供文档示例）。 */
  extendSession?: string;
  /** 028：--rm 出现在 serve 面即拒（边界5——机器守护无临时语义，只认不透传防误用）。 */
  rm?: boolean;
  /** 028：--member-remove <名|id8>——删 --connect 星册内条目（幂等；星内任何机器可执）。 */
  memberRemove?: string;
}

export interface ServeDeps {
  /** 注册表/状态/日志的根目录；真跑 ~/.crosschat，测试注入临时目录。 */
  baseDir: string;
  stdout(line: string): void;
  /** 018 批二：stderr 行输出（adopt 报错/9b 告警）；缺省复用 stdout。 */
  stderr?(line: string): void;
  env: NodeJS.ProcessEnv;
  version: string;
  machineId: () => string | undefined;
  hostname: () => string;
  networkInterfaces: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
  now(): number;
  onSignal(sig: 'SIGINT' | 'SIGTERM', cb: () => void): void;
  /** B2：真 SendDeps 工厂（deliverLocal 接 runSend 用）；缺省回 NOT_READY（B1 行为，测试用）。 */
  makeSendDeps?(stdinText?: string): SendDeps;
  /** B2：--stop 的进程扫描/杀进程/端口反查注入（测试用）；缺省真扫真杀。 */
  listServeProcesses?: () => ProcInfo[];
  killPid?: (pid: number) => boolean;
  pidsOnPort?: (port: number) => Set<number>;
}

export function realServeDeps(): ServeDeps {
  return {
    baseDir: join(homedir(), '.crosschat'),
    stdout: (line) => process.stdout.write(`${line}\n`),
    env: process.env,
    version: (
      JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
    ).version,
    machineId: () => machineId(),
    hostname: () => hostname(),
    networkInterfaces: () => networkInterfaces(),
    now: () => Date.now(),
    onSignal: (sig, cb) => process.on(sig, cb),
  };
}

export async function runServe(args: ServeArgs, deps: ServeDeps): Promise<number> {
  const registryFile = registryFileOf(deps.baseDir);
  let port: number | undefined;
  if (args.portArg !== undefined) {
    const n = Number.parseInt(args.portArg, 10);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      throw new MultichatError('USAGE', `--port 须为 1-65535 的整数，收到：${args.portArg}`);
    }
    port = n;
    setPort(registryFile, n); // 显式 --port 即持久化指令（首次记住，再给即更新）
  }
  // 022 --add-star（一次性命令；先于其余管理旗标处理）
  if (args.addStarArg !== undefined) {
    if (args.connect !== undefined) {
      throw new MultichatError('USAGE', '--add-star 是 broker 侧命令，不与 --connect 连用');
    }
    if (args.detach) throw new MultichatError('USAGE', '--add-star 是一次性命令，不支持 --detach');
    return runAddStar(args.addStarArg, deps, registryFile);
  }
  // 022 星域解析：多星注册表下变更类旗标需 --star 限定（--list 只读分组展示除外）
  const starScope = resolveStarScope(args, registryFile);
  if (args.nameArg !== undefined) {
    // E0 星名：与 --port 同语义（显式给即持久化）；节点模式无星名概念
    if (args.connect !== undefined) {
      throw new MultichatError('USAGE', '--name 是 broker 星名设置，节点模式不支持——去 broker 机上跑 crosschat serve --name <星名>');
    }
    if (starScope.multi) {
      requireStarScope(starScope, registryFile, '--name <新星名>');
      setNameForStar(registryFile, starScope.star!.starId!, args.nameArg);
    } else {
      setName(registryFile, args.nameArg);
    }
  }
  if (args.genKeyArg !== undefined) return runGenKey(args.genKeyArg, deps, registryFile, port, starScope);
  if (args.list) return runList(deps, registryFile, starScope);
  if (args.remove !== undefined) return runRemove(args.remove, deps, registryFile, starScope);
  if (args.stopSelector !== undefined) return runStopSelector(args.stopSelector, deps);
  if (args.stopTarget !== undefined) return runStop(args.stopTarget, deps, registryFile);
  // 028 边界5：serve --connect --rm 拒绝——--rm 是会话级临时旗标，机器守护生命周期独立
  if (args.rm) {
    throw new MultichatError(
      'USAGE',
      'serve --connect 是机器级守护（聚合器生命周期独立，--rm 不触碰它）——临时会话旗标用于启动器：crosschat claude/codex --connect <星> --rm；退机器走 crosschat serve --stop',
    );
  }
  // 018 批二：--adopt 收编（一次性命令，与 --connect 连用）
  if (args.adopt !== undefined) {
    if (args.connect === undefined) {
      throw new MultichatError('USAGE', '--adopt 与 --connect <星> 连用——示例：crosschat serve --connect <星名> --adopt <会话名>');
    }
    if (args.detach) throw new MultichatError('USAGE', '--adopt 是一次性收编命令，不支持 --detach');
    return runAdoptServe(args, deps);
  }
  // 028：--member-remove 删册（一次性命令，与 --connect 连用；幂等）
  if (args.memberRemove !== undefined) {
    if (args.connect === undefined) {
      throw new MultichatError('USAGE', '--member-remove 与 --connect <星> 连用——示例：crosschat serve --connect <星名> --member-remove <会话名|id8>');
    }
    if (args.detach) throw new MultichatError('USAGE', '--member-remove 是一次性删册命令，不支持 --detach');
    return runMemberRemoveServe(args, deps);
  }
  const detachedChild = deps.env.CROSSCHAT_SERVE_DETACHED === '1';
  if (args.connect !== undefined) {
    // 013 双开防护：起守护前拒同星（前台在本进程、--detach 在父进程各扫一次；
    // detached 子进程不扫——父进程 spawn 前已扫，且父进程退场前会被误当活守护）
    if (!detachedChild) guardSameStarDaemon(args.connect, deps);
    if (args.detach && !detachedChild) {
      // 9b：detach 父进程退场前代子进程出声（子进程的 stdout 已落日志文件）——
      // broker 无 proto:3 cap 时控制台一行降级告警，不只日志
      try {
        const { entry } = selectConnectEntry(args.connect, readNodeConfig(join(tcpDir(deps.baseDir), 'node.json')));
        await warnIfBrokerLacksSessionCaps(entry, (line) => deps.stdout(line));
      } catch {
        // 选不出条目/探不到 broker：交子进程自己的教学报错与告警
      }
      // E0：日志文件名取解析后的星名（用户用 starId 前缀起停也落到星名日志）；
      // 解析失败（无 node.json 等）退回原选择器——子进程会给出教学报错
      let logName: string;
      if (args.connect === '') {
        logName = 'node.log';
      } else {
        let label = args.connect;
        try {
          label = selectConnectEntry(args.connect, readNodeConfig(join(tcpDir(deps.baseDir), 'node.json'))).entry.name ?? args.connect;
        } catch {
          // 交子进程报教学错误
        }
        logName = `node-${label}.log`;
      }
      return runDetach(deps, ['--connect', ...(args.connect === '' ? [] : [args.connect])], logName);
    }
    return runForegroundNode(args.connect, deps);
  }
  if (args.detach && !detachedChild) {
    // 父进程先自登记并出声（子进程里再跑是幂等空转）——后台模式控制台不留黑盒。
    // 022：多星形状走逐星自登记（旧 ensureSelfEntry 的旧形状读写会毁 stars[]）
    const effectivePort = port ?? readMultiRegistry(registryFile).port ?? DEFAULT_PORT;
    if (readMultiRegistry(registryFile).multi) {
      ensureSelfEntriesMulti(deps, registryFile, effectivePort);
    } else {
      announceSelfEntry(deps, ensureSelfEntry(deps, registryFile, effectivePort));
    }
    return runDetach(deps, [], 'broker.log', effectivePort);
  }
  return runForegroundBroker(deps, port);
}

/** 022：星域解析（--star 仅多星形状有意义；单星旧形状忽略）。 */
function resolveStarScope(args: ServeArgs, registryFile: string): { multi: boolean; star?: StarReg } {
  const reg = readMultiRegistry(registryFile);
  if (!reg.multi) return { multi: false };
  if (args.starArg === undefined) return { multi: true };
  return { multi: true, star: selectStar(reg.stars, args.starArg) };
}

/** 多星缺 --star 的统一教学（列星+示例，与选择器报错同风格）。 */
function requireStarScope(scope: { multi: boolean; star?: StarReg }, registryFile: string, flag: string): void {
  if (!scope.multi || scope.star !== undefined) return;
  const stars = readMultiRegistry(registryFile).stars;
  const list = stars.map((s) => s.name ?? s.starId ?? '(未定名)').join('、');
  throw new MultichatError(
    'USAGE',
    `本 broker 托管多颗星，${flag} 须 --star <星名|starId前缀> 限定目标星——现有：${list}；示例：crosschat serve --star ${stars[0]!.name ?? stars[0]!.starId} ${flag}`,
  );
}

function runGenKey(genKeyArg: string, deps: ServeDeps, registryFile: string, port: number | undefined, starScope: { multi: boolean; star?: StarReg }): number {
  const n = Number.parseInt(genKeyArg, 10);
  if (!Number.isInteger(n) || n < 1) {
    throw new MultichatError('USAGE', `--gen-key 数量须为 1-10 的整数，收到：${genKeyArg}`);
  }
  const host = firstNonInternalIPv4(deps.networkInterfaces());
  const portNum = port ?? readMultiRegistry(registryFile).port ?? DEFAULT_PORT;
  if (starScope.multi) {
    // 022 多星：--star 限定发钥（bare 用法在教学入口拦）
    if (starScope.star === undefined) {
      const stars = readMultiRegistry(registryFile).stars;
      const list = stars.map((s) => s.name ?? s.starId ?? '(未定名)').join('、');
      throw new MultichatError(
        'USAGE',
        `本 broker 托管多颗星，--gen-key 须 --star 限定目标星——现有：${list}；示例：crosschat serve --star ${stars[0]!.name ?? stars[0]!.starId} --gen-key 1`,
      );
    }
    const star = starScope.star;
    const results = genKeysForStar(registryFile, star.starId!, n, { host, port: portNum, ...(star.name === undefined ? {} : { name: star.name }) });
    deps.stdout(`自动探测 broker 地址：${host}:${portNum}（多网卡/NAT 常探错——人工核对改写 node.json 的 host 与 port）`);
    deps.stdout(`以下钥匙入星 ${star.name ?? star.starId}（条目 name 即星名，连接自动同步，不用改）`);
    for (const result of results) {
      deps.stdout('--------------------------------');
      deps.stdout(result.nodeJsonContent.trimEnd());
    }
    deps.stdout('放置路径（目标机器）：~/.crosschat/tcp/node.json（入多星则把各星条目合并进同一份 brokers 数组）');
    deps.stdout('钥匙已进入终端回滚缓冲，分发完建议清屏');
    return 0;
  }
  const starName = ensureStarName(registryFile, deps.hostname());
  const results = genKeys(registryFile, n, { host, port: portNum, ...(starName === undefined ? {} : { name: starName }), starId: ensureStarId(registryFile) });
  deps.stdout(`自动探测 broker 地址：${host}:${portNum}（多网卡/NAT 常探错——按下述规则人工核对改写 node.json 的 host 与 port）：`);
  deps.stdout('  · broker 机自身 → 无需分发（首次 serve 已自动写好 127.0.0.1 的自用 node.json）');
  deps.stdout('  · broker 是云主机/NAT 内网机 → host 填对外公网 IP（探测常拿内网 IP，必核对）');
  deps.stdout('  · 普通局域网 → broker 机的局域网 IP；broker 用非默认端口时 port 一并改');
  deps.stdout(`分发前把每份 node.json 的 showName 改成「贴这份配置的机器」的自报名字（建议=其 hostname；纯显示用——roster 怎么称呼它，寻址/回信不依赖，走 machine-id 前缀；改名=改 showName 后重启常驻——节点机重启节点客户端、broker 机重启 serve）；条目 name=${starName === undefined ? '（本机未定星名，可留空）' : starName} 是星名（broker 权威，连接自动同步，不用改）`);
  for (const result of results) {
    deps.stdout('--------------------------------');
    deps.stdout(result.nodeJsonContent.trimEnd());
  }
  deps.stdout('放置路径（目标机器）：~/.crosschat/tcp/node.json（win 写法 C:\\Users\\<用户>\\.crosschat\\tcp\\node.json）');
  deps.stdout('多星：一台机入多个 broker 时，把各星钥匙的条目合并进同一份 brokers 数组即可；本配置为数组形状，目标机 crosschat 需 ≥1.5.2');
  deps.stdout('本命令须在 broker 机上执行（钥匙登记进本机 broker.json）；broker 机自己的 node.json 已由首次 serve 自动写好，勿用上面的钥匙覆盖');
  deps.stdout('钥匙已进入终端回滚缓冲，分发完建议清屏');
  return 0;
}

/**
 * 022 --add-star <名>：本 broker 托管第二颗星——starId 生成、星册迁移
 * （roster.json → roster.<星名>.json）、注册表转 stars[] 形状。broker 在跑
 * 则拒（册迁移与在跑 broker 的册写盘会竞态漂移）。自登记/自挂随下次 serve
 * 启动落定。
 */
function runAddStar(name: string, deps: ServeDeps, registryFile: string): number {
  if (!STAR_NAME_RE.test(name)) {
    throw new MultichatError('USAGE', `--add-star 星名须为 1-32 个字母/数字/./_/-（禁冒号——tcp 限定词语法保留字），收到：${name}`);
  }
  let procs: ProcInfo[] = [];
  try {
    procs = (deps.listServeProcesses ?? listServeProcesses)();
  } catch {
    // 扫描失败=探测不到在跑 broker，继续（风险：册迁移竞态——见下方提示）
  }
  const runningBroker = procs.find((p) => !p.cmdline.includes('--connect'));
  if (runningBroker !== undefined) {
    throw new MultichatError(
      'USAGE',
      `检测到本机 broker 在跑（pid ${runningBroker.pid}）——--add-star 要迁移星册文件，先 crosschat serve --stop 再加星（重启后生效）`,
    );
  }
  const reg = readMultiRegistry(registryFile);
  // 单星转轨前补 starId（旧 pre-B0 注册表可能无）
  if (!reg.multi && reg.stars[0]!.starId === undefined) reg.stars[0]!.starId = ensureStarId(registryFile);
  const first = reg.stars[0]!;
  // 唯一性：星名互斥、且不与任何 starId 撞（星册文件名按 名|starId 区分）
  if (reg.stars.some((s) => s.name === name) || reg.stars.some((s) => s.starId === name)) {
    throw new MultichatError('USAGE', `星名 ${name} 已用于本 broker 的另一颗星（或与某 starId 相同）——星名须唯一`);
  }
  // 星册迁移：旧单星册 roster.json → roster.<星1 label>.json（存在才迁；此后按星分册）
  if (!reg.multi) {
    const legacy = rosterFileOf(registryFile);
    const target = rosterFileForStar(registryFile, first, true);
    if (existsSync(legacy)) {
      renameSync(legacy, target);
      deps.stdout(`星册迁移：roster.json → ${target.split(/[\\/]/).pop()}（星 ${first.name ?? first.starId} 独立成册）`);
    }
  }
  reg.stars.push({ starId: randomBytes(6).toString('hex'), name, nodes: [] });
  reg.multi = true;
  writeMultiRegistry(registryFile, reg);
  deps.stdout(`已加星 ${name}——本 broker 现托管 ${reg.stars.length} 颗星（一进程一端口；重启 crosschat serve 生效）`);
  deps.stdout('发钥：crosschat serve --star <星名> --gen-key <n>；查星：crosschat serve --list');
  deps.stdout('注意：多星共用一个 broker 进程——故障域合并（一进程崩=全部星瘫、升级窗口合并），此为已接受的运维代价');
  return 0;
}

function firstNonInternalIPv4(ifaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string {
  for (const list of Object.values(ifaces)) {
    for (const ni of list ?? []) {
      if (!ni.internal && ni.family === 'IPv4') return ni.address;
    }
  }
  return '127.0.0.1';
}

function runList(deps: ServeDeps, registryFile: string, starScope: { multi: boolean; star?: StarReg }): number {
  const reg = readMultiRegistry(registryFile);
  const printNodes = (nodes: ReturnType<typeof listNodes>): void => {
    deps.stdout(`${'label'.padEnd(10)}${'name'.padEnd(18)}${'mid8'.padEnd(10)}added-at`);
    for (const node of nodes) {
      deps.stdout(
        `${node.label.padEnd(10)}${(node.machineName ?? '-').padEnd(18)}${(node.machineId?.slice(0, 8) ?? '-').padEnd(10)}${node.addedAt}`,
      );
    }
    if (nodes.length === 0) deps.stdout('（注册表为空）');
  };
  if (starScope.multi) {
    // 022：多星分组展示（只读命令不强制 --star）
    for (const star of reg.stars) {
      deps.stdout(`=== 星 ${star.name ?? star.starId ?? '(未定名)'} ===`);
      printNodes(star.nodes);
    }
    return 0;
  }
  printNodes(listNodes(registryFile));
  return 0;
}

function runRemove(label: string, deps: ServeDeps, registryFile: string, starScope: { multi: boolean; star?: StarReg }): number {
  if (starScope.multi) {
    if (starScope.star === undefined) {
      const stars = readMultiRegistry(registryFile).stars;
      const list = stars.map((s) => s.name ?? s.starId ?? '(未定名)').join('、');
      throw new MultichatError(
        'USAGE',
        `本 broker 托管多颗星，--remove 须 --star 限定目标星——现有：${list}；示例：crosschat serve --star ${stars[0]!.name ?? stars[0]!.starId} --remove node-1`,
      );
    }
    const removed = removeNodeForStar(registryFile, starScope.star.starId!, label);
    deps.stdout(removed ? `已从星 ${starScope.star.name ?? starScope.star.starId} 移除 ${label}` : `星 ${starScope.star.name ?? starScope.star.starId} 未找到 ${label}`);
    return removed ? 0 : 1;
  }
  const removed = removeNode(registryFile, label);
  deps.stdout(removed ? `已移除 ${label}` : `未找到 ${label}`);
  return removed ? 0 : 1;
}

/** 后台化：spawn 自身 detached + env 标记防循环；日志写 tcp/<name>（B2 节点命名条目=node-<选择器>.log）。broker 传端口（节点客户端外连无监听口）。 */
function runDetach(deps: ServeDeps, extraArgs: string[], logName: string, portNum?: number): number {
  const logFile = join(tcpDir(deps.baseDir), logName);
  mkdirSync(tcpDir(deps.baseDir), { recursive: true });
  const fd = openSync(logFile, 'a');
  const entry = process.argv[1] ?? fileURLToPath(new URL('../cli.js', import.meta.url));
  const child = spawn(process.execPath, [realpathSync(entry), 'serve', ...extraArgs], {
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...deps.env, CROSSCHAT_SERVE_DETACHED: '1' },
  });
  child.unref();
  deps.stdout(`${logName.startsWith('node') ? '节点客户端' : 'broker'} 后台运行中 pid=${child.pid}${portNum !== undefined ? ` 端口 ${portNum}` : ''}（日志：${logFile}）`);
  return 0;
}

/**
 * B2.1：broker 首启自登记——本机条目直接落注册表（machineId=本机、name=hostname），
 * 并自动写本机 node.json（host=127.0.0.1）。broker 机与其他节点完全同构：
 * 其他机器可立即用 mid8/名字寻址本机，本机 send --via tcp: 也有凭证，零管理员动作。
 * 017：此后每次启动读回 node.json 顶层 showName 刷新 machineName（单一事实源），
 * broker 机改名与纯 node 机同一规则（后者经连接帧上报，物理等价）。
 *
 * 三态结局（'ok' = 已存在且与当前 broker 一致，静默不打扰）；undefined = 无 machineId。
 */
export type SelfEntryStatus = 'written' | 'ok' | 'foreign' | 'stale';
export interface SelfEntryResult {
  status: SelfEntryStatus;
  /** 'foreign' 时的既有指向（人读显示，绝不回显钥匙）。 */
  host?: string;
  port?: number;
}

export function ensureSelfEntry(deps: ServeDeps, registryFile: string, port: number): SelfEntryResult | undefined {
  const mid = deps.machineId();
  if (mid === undefined || mid === '') return undefined;
  // E0：星名缺省轨道在此落定（首次 serve 取清洗后的 hostname 持久化）
  const starName = ensureStarName(registryFile, deps.hostname());
  const registry = readRegistry(registryFile);
  let self = registry.nodes.find((node) => node.machineId === mid);
  if (self === undefined) {
    self = { label: 'self', key: randomBytes(32).toString('hex'), machineId: mid, machineName: deps.hostname(), addedAt: new Date(deps.now()).toISOString() };
    registry.nodes.push(self);
    writeRegistry(registryFile, registry);
  }
  const nodeJson = join(tcpDir(deps.baseDir), 'node.json');
  if (!existsSync(nodeJson)) {
    mkdirSync(tcpDir(deps.baseDir), { recursive: true });
    // B0：自用 node.json 同带 starId（与 gen-key 分发的钥匙同构）；
    // 新写一律数组形状（单星=一项，多星=多项——只产出一种形状）。
    // E0 词表：条目 name=星名（broker 权威）、顶层 showName=本机显示名
    const starId = ensureStarId(registryFile);
    writeFileSync(
      nodeJson,
      `${JSON.stringify(
        {
          brokers: [{ host: '127.0.0.1', port, ...(starName === undefined ? {} : { name: starName }), starId, key: self.key }],
          showName: deps.hostname(),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    return { status: 'written' };
  }
  // 已存在：宽松解析判状态（双形状；坏文件交给上层教学报错）
  let entries: BrokerEntry[];
  let showName: string | undefined;
  try {
    const config = readNodeConfig(nodeJson);
    entries = config.entries;
    showName = config.showName;
  } catch {
    // 017：node.json 整体读不了/损坏——machineName 维持注册表现值（不因解析失败误删）
    return { status: 'stale' };
  }
  // 017 机器自报名单一事实源：启动读回本机 node.json 顶层 showName 刷新注册表
  // machineName（顶层字段，读取不依赖自用条目归属——foreign 形态照读）。语义对称：
  // showName 显式缺失/空 → 清除（roster 回退纯 mid8）；无变化不写（与下方星名
  // 同步"一致不写"同款）。改名重启 serve 生效——与升级口诀同节奏。
  const wantName = sanitizeName(showName);
  if (self.machineName !== wantName) {
    self.machineName = wantName;
    writeRegistry(registryFile, registry);
  }
  // 找本 broker 的钥匙条目（多星机上自用条目可与外星条目共存于同一数组）
  const mine = entries.find((e) => e.key === self.key);
  if (mine === undefined) {
    const first = entries[0];
    return { status: 'foreign', host: first?.host, port: first?.port };
  }
  if (mine.host !== '127.0.0.1' || mine.port !== port) return { status: 'stale' };
  // B1 补 starId / E0 星名同步：broker 自用条目不走节点客户端的 info 同步，
  // 在此对齐（星名不一致覆盖 + 清旧 alias 键；一致不写）。失败不倒 serve。
  const patch: { starId?: string; name?: string } = {};
  if (mine.starId === undefined) patch.starId = ensureStarId(registryFile);
  if (starName !== undefined && mine.name !== starName) patch.name = starName;
  if (patch.starId !== undefined || patch.name !== undefined) {
    syncNodeJsonEntry(nodeJson, { host: '127.0.0.1', port, key: self.key }, patch);
  }
  return { status: 'ok' };
}

/** 自登记结局出声（written/foreign/stale 三种；ok 静默——状态没变不刷屏）。 */
function announceSelfEntry(deps: ServeDeps, result: SelfEntryResult | undefined): void {
  if (result === undefined) return;
  const path = join(tcpDir(deps.baseDir), 'node.json');
  if (result.status === 'written') {
    deps.stdout(`已自动生成本机 node.json（${path}，host=127.0.0.1——本机 send --via tcp: 凭证）`);
  } else if (result.status === 'foreign') {
    deps.stdout(`检测到已有 node.json（指向 ${result.host}:${result.port}）——本机 tcp 发送将走它；若本机现在是 broker 要自连，移走该文件后重启 serve`);
  } else if (result.status === 'stale') {
    deps.stdout(`检测到已有 node.json 但钥匙/端口与当前 broker 不符（陈旧或损坏）——本地发送会失败；删除该文件重启 serve 可重建（${path}）`);
  }
}

async function runForegroundBroker(deps: ServeDeps, port: number | undefined): Promise<number> {
  const detached = deps.env.CROSSCHAT_SERVE_DETACHED === '1';
  const logFile = join(tcpDir(deps.baseDir), 'broker.log');
  const logLine = detached
    ? (line: string) => {
        try {
          appendWithRotate(logFile, `${line}\n`);
        } catch {
          // 日志写失败不倒服务
        }
      }
    : (line: string) => deps.stdout(line);
  const registryFile = registryFileOf(deps.baseDir);
  // 022 星域落定：旧单星形状走原 ensureStarId/ensureStarName（字节不变）；多星
  // 形状只补各星 starId（星名在 --add-star 时已定，hostname 缺省轨道不适用）。
  const multiReg = readMultiRegistry(registryFile);
  if (!multiReg.multi) {
    ensureStarId(registryFile);
    ensureStarName(registryFile, deps.hostname());
  } else {
    ensureMultiStarIds(registryFile);
  }
  // B1：broker 自投递签发的 ref 盖注册表星标识（与 gen-key 分发的钥匙同源；
  // 多星下按发送方连接的属星盖——deliverLocal 第三参）
  const registryStarId = multiReg.multi ? undefined : ensureStarId(registryFile);
  // 024 方案3：broker 自投递的信封正向坐标星段（E0 缺省轨道——未定名时与
  // 自登记同一事实源持久化清洗后的 hostname）。
  const registryStarName = multiReg.multi ? undefined : ensureStarName(registryFile, deps.hostname());
  // B2：broker 机自己也是全权节点——deliverLocal 接 runSend、file 落本机收件。
  const deliverLocal = deps.makeSendDeps === undefined
    ? defaultDeliverLocal
    : async (frame: SendFrame, fromMachine?: string, star?: { starId?: string; name?: string }): Promise<ResultFrame | ErrorFrame> => {
        // F1：fromMachine=broker 传入的发送方 roster 真名（远端来件在 broker 机
        // 投递也带真名）；无名瞬态发送方缺省——信封整个省略 from-machine。
        // 022：星段优先取发送方连接的属星（多星），缺省退回单星注册表值。
        const refStarId = star !== undefined && star.starId !== undefined ? star.starId : registryStarId;
        const starName = star !== undefined && star.name !== undefined ? star.name : registryStarName;
        const deliver: DeliverFrame = {
          op: 'deliver',
          id: frame.id,
          ...(fromMachine === undefined ? {} : { fromMachine }),
          payload: frame.body,
          to: frame.to,
          conversation: frame.conversation,
          origin: frame.origin,
        };
        const r = await deliverViaRunSend(deliver, {
          ...deps.makeSendDeps!(),
          ...(refStarId === undefined ? {} : { refStarId }),
          ...(starName === undefined ? {} : { fromStarName: starName }),
        });
        // deliverViaRunSend 的失败即 ResultFrame{status:'error'}——规整为
        // ErrorFrame，broker 本地分支的失败语义（op:'error'）保持 B1 不变。
        return r.status === 'error'
          ? { op: 'error', code: r.code ?? 'REMOTE_FAILED', message: r.message ?? '本机投递失败' }
          : r;
      };
  // E1：status-query 目标是本机时的扫描应答（与节点守护同一 buildStatusPayload）。
  const scanStatus = deps.makeSendDeps === undefined
    ? undefined
    : async (): Promise<StatusPayload> => buildStatusPayload(deps.makeSendDeps!());
  // B2.1：起服务前自登记（本机=全权成员，mid8/名字可寻址 + 本机 node.json）。
  // 后台子进程不重复出声——父进程 spawn 前已向控制台播报过。
  // 022：多星形状逐星自登记（每星 self 条目+node.json 条目）。
  const effectivePort = port ?? readMultiRegistry(registryFile).port ?? DEFAULT_PORT;
  if (multiReg.multi) {
    ensureSelfEntriesMulti(deps, registryFile, effectivePort);
    if (!detached) deps.stdout(`本 broker 托管 ${multiReg.stars.length} 颗星（一进程一端口；故障域合并为已接受代价）`);
  } else {
    const self = ensureSelfEntry(deps, registryFile, effectivePort);
    if (!detached) announceSelfEntry(deps, self);
  }
  const broker = new Broker({
    registryFile: registryFileOf(deps.baseDir),
    statusFile: join(tcpDir(deps.baseDir), 'status-broker.json'),
    version: deps.version,
    machineId: deps.machineId,
    hostname: deps.hostname,
    now: deps.now,
    log: logLine,
    deliverLocal,
    scanStatus,
    fileInbox: new FileInbox({
      inboxDir: join(tcpDir(deps.baseDir), 'inbox'),
      partsDir: join(tcpDir(deps.baseDir), 'parts'),
    }),
    port,
    resultTimeoutMs: readResultTimeoutMs(deps.env),
  });
  const actual = await broker.start();
  deps.stdout(`broker listening on 0.0.0.0:${actual}（Ctrl+C 退出）`);
  // 022 自挂（方向 3）：每颗托管星起本进程聚合器——attach 管道/成员表/对账循环
  // 全在 broker 进程内（虚拟会话对走真实 onConnect/路由代码路径），省回环 WS 与
  // 第二个常驻进程；本机已有同星外部守护（serve --connect）则让位跳过——升级
  // 窗口平滑接管且永不成 F4 双连形态。
  const localAggregators = deps.makeSendDeps === undefined ? [] : bootstrapLocalAggregators(deps, broker, logLine);
  await new Promise<void>((resolve) => {
    const stop = () => {
      void Promise.all(localAggregators.map((c) => c.stop()))
        .catch(() => {})
        .then(() => broker.stop())
        .then(() => resolve());
    };
    deps.onSignal('SIGINT', stop);
    deps.onSignal('SIGTERM', stop);
  });
  return 0;
}

/**
 * 022：多星形状的逐星自登记——每星 self 节点条目（本机 mid）+ 本机 node.json
 * 对应条目（127.0.0.1:port，随星名/starId）；machineName 沿 017 从 node.json
 * 顶层 showName 刷新（单一事实源，逐星同名）。
 */
function ensureSelfEntriesMulti(deps: ServeDeps, registryFile: string, port: number): void {
  const mid = deps.machineId();
  if (mid === undefined || mid === '') return;
  const reg = readMultiRegistry(registryFile);
  const nodeJson = join(tcpDir(deps.baseDir), 'node.json');
  let entries: BrokerEntry[] = [];
  let showName: string | undefined;
  let nodeJsonExisted = true;
  try {
    const config = readNodeConfig(nodeJson);
    entries = config.entries;
    showName = config.showName;
  } catch {
    nodeJsonExisted = false;
  }
  const wantName = sanitizeName(showName);
  let regChanged = false;
  let jsonChanged = !nodeJsonExisted;
  for (const star of reg.stars) {
    let self = star.nodes.find((n) => n.machineId === mid);
    if (self === undefined) {
      self = {
        label: `self-${star.name ?? star.starId ?? 'star'}`,
        key: randomBytes(32).toString('hex'),
        machineId: mid,
        machineName: wantName ?? deps.hostname(),
        addedAt: new Date(deps.now()).toISOString(),
      };
      star.nodes.push(self);
      regChanged = true;
    } else if (self.machineName !== wantName) {
      self.machineName = wantName; // 017：showName 缺省即清除（undefined 落 JSON 时省略）
      regChanged = true;
    }
    if (!entries.some((e) => e.key === self!.key)) {
      entries.push({
        host: '127.0.0.1',
        port,
        ...(star.name === undefined ? {} : { name: star.name }),
        ...(star.starId === undefined ? {} : { starId: star.starId }),
        key: self.key,
      });
      jsonChanged = true;
    }
  }
  if (regChanged) writeMultiRegistry(registryFile, reg);
  if (jsonChanged) {
    mkdirSync(tcpDir(deps.baseDir), { recursive: true });
    writeFileSync(
      nodeJson,
      `${JSON.stringify({ brokers: entries, ...(showName === undefined ? {} : { showName }) }, null, 2)}\n`,
      'utf8',
    );
  }
}

/**
 * 022：起本进程聚合器（每托管星一个 NodeClient + 虚拟会话对）。外部守护让位
 * 判定：本机进程扫描见同星 serve --connect 在跑即跳过该星（守护 cmdline 的
 * 选择器对同一份 node.json 归一比对，与 guardSameStarDaemon 同一解析序）。
 */
function bootstrapLocalAggregators(deps: ServeDeps, broker: Broker, logLine: (line: string) => void): NodeClient[] {
  const registryFile = registryFileOf(deps.baseDir);
  const reg = readMultiRegistry(registryFile);
  const nodeJson = join(tcpDir(deps.baseDir), 'node.json');
  let config: NodeConfig | undefined;
  try {
    config = readNodeConfig(nodeJson);
  } catch {
    return []; // 自登记未落定（异常形态）——不挂，星册操作照常
  }
  let procs: ProcInfo[] = [];
  try {
    procs = (deps.listServeProcesses ?? listServeProcesses)();
  } catch {
    // 扫描失败=探测不到外部守护——照常自挂（顶换语义兜底）
  }
  const clients: NodeClient[] = [];
  for (const star of reg.stars) {
    if (star.starId === undefined) continue;
    const entry = config!.entries.find((e) => e.starId === star.starId && e.host === '127.0.0.1');
    if (entry === undefined) continue; // 该星自登记条目缺失（未重启过 serve 等）
    const external = procs.find((p) => {
      if (!p.cmdline.includes('--connect')) return false;
      try {
        return selectConnectEntry(connectValueOf(p.cmdline) ?? '', config!).entry.starId === star.starId;
      } catch {
        return false;
      }
    });
    if (external !== undefined) {
      logLine(`自挂跳过星 ${star.name ?? star.starId}：本机已有外部 serve --connect 守护（pid ${external.pid}）——让位防同 mid 双连；建议 crosschat serve --stop 后由 broker 统一内挂`);
      continue;
    }
    const label = entry.name ?? star.starId;
    const starId = star.starId;
    const client = new NodeClient({
      config: { entries: [entry] },
      configFile: nodeJson,
      machineId: deps.machineId,
      statusFile: join(tcpDir(deps.baseDir), `status-node-${label}.json`),
      version: deps.version,
      fileInbox: new FileInbox({
        inboxDir: join(tcpDir(deps.baseDir), 'inbox'),
        partsDir: join(tcpDir(deps.baseDir), 'parts'),
      }),
      makeSendDeps: () => {
        if (deps.makeSendDeps === undefined) throw new MultichatError('INTERNAL', 'makeSendDeps 未接线');
        return deps.makeSendDeps();
      },
      now: deps.now,
      log: logLine,
      makeSocket: () => {
        const [clientSock, brokerSock] = VirtualSocket.pair();
        broker.admitLocal(brokerSock, starId);
        return clientSock;
      },
    });
    logLine(`本进程聚合器上线：星 ${label}（attach 管道/成员表/对账循环随 broker 常驻）`);
    clients.push(client);
    void client.run();
  }
  return clients;
}

/**
 * B2：--connect 选择器解析（E0 起与 via-tcp 的 selectBrokerEntry 同判定序）：
 * 星名精确匹配 → starId 前缀唯一匹配（歧义教加长）；无命中时单条目走旧
 * "星名不符拒绝"校验路径（旧形状兼容），多条目列条目并给示例。'' = entries[0]。
 */
export function selectConnectEntry(selector: string, config: NodeConfig): { entry: BrokerEntry; selector: string } {
  const entries = config.entries;
  if (selector === '') return { entry: entries[0]!, selector };
  const byName = entries.find((e) => e.name === selector);
  if (byName !== undefined) return { entry: byName, selector };
  const byPrefix = entries.filter((e) => e.starId !== undefined && e.starId.startsWith(selector));
  if (byPrefix.length === 1) return { entry: byPrefix[0]!, selector };
  if (byPrefix.length > 1) {
    throw new MultichatError(
      'USAGE',
      `--connect 选择器 ${selector} 的 starId 前缀命中多个星（${byPrefix.map(formatBrokerEntry).join('、')}）——加长前缀使其唯一`,
    );
  }
  if (entries.length === 1) {
    // 旧校验路径：单条目（旧形状）星名不符拒绝；无星名则容忍直连（B2 前行为）
    const name = entries[0]!.name;
    if (name !== undefined) {
      throw new MultichatError(
        'USAGE',
        `--connect ${selector} 与 node.json 条目的星名 ${name} 不符——省略星名直连，或向管理员核对 node.json`,
      );
    }
    return { entry: entries[0]!, selector };
  }
  const list = entries.map(formatBrokerEntry).join('、');
  throw new MultichatError(
    'USAGE',
    `--connect 选择器 ${selector} 不匹配任何条目——本机 node.json 现有：${list}；示例：--connect ${entries[0]!.name ?? entries[0]!.starId ?? ''}`,
  );
}

/** B2：--connect 节点客户端前台跑（Ctrl+C 退出）。守护只连选中条目（config.entries 收窄为单元素）。 */
async function runForegroundNode(aliasArg: string, deps: ServeDeps): Promise<number> {
  const config = readNodeConfig(join(tcpDir(deps.baseDir), 'node.json'));
  const { entry, selector } = selectConnectEntry(aliasArg, config);
  // E0：日志/状态文件后缀取解析后的星名——用户用 starId 前缀起停，标签/文件名也显示星名
  const label = selector === '' ? '' : entry.name ?? selector;
  const suffix = label === '' ? '' : `-${label}`;
  const detached = deps.env.CROSSCHAT_SERVE_DETACHED === '1';
  const logFile = join(tcpDir(deps.baseDir), `node${suffix}.log`);
  const logLine = detached
    ? (line: string) => {
        try {
          appendWithRotate(logFile, `${line}\n`);
        } catch {
          // 日志写失败不倒客户端
        }
      }
    : (line: string) => deps.stdout(line);
  const client = new NodeClient({
    config: { ...config, entries: [entry] },
    configFile: join(tcpDir(deps.baseDir), 'node.json'),
    machineId: deps.machineId,
    statusFile: join(tcpDir(deps.baseDir), `status-node${suffix}.json`),
    version: deps.version, // F1：doctor 版本对账
    fileInbox: new FileInbox({
      inboxDir: join(tcpDir(deps.baseDir), 'inbox'),
      partsDir: join(tcpDir(deps.baseDir), 'parts'),
    }),
    makeSendDeps: () => {
      if (deps.makeSendDeps === undefined) {
        throw new MultichatError('INTERNAL', 'makeSendDeps 未接线（测试环境不支持节点投递）');
      }
      return deps.makeSendDeps();
    },
    now: deps.now,
    log: logLine,
    onSignal: deps.onSignal,
    // 9b：降级告警直达命令面（前台=控制台一行；detach 子进程 stdout 即日志，
    // 控制台声量由 detach 父进程的预检补）
    warn: (line) => logLine(line),
  });
  logLine(`节点客户端启动：目标 broker ${entry.name ?? `${entry.host}:${entry.port}`}（Ctrl+C 退出）`);
  await client.run();
  return 0;
}

/**
 * 018 批二：--adopt 的 ServeDeps→StarJoinDeps 桥——本机会话扫描经 makeSendDeps
 * （与投递同源），自动拉聚合器/证据源与启动器共用同一实现。
 */
async function runAdoptServe(args: ServeArgs, deps: ServeDeps): Promise<number> {
  if (deps.makeSendDeps === undefined) {
    throw new MultichatError('INTERNAL', 'makeSendDeps 未接线（测试环境不支持 adopt）');
  }
  const send = deps.makeSendDeps();
  let machineName = deps.hostname();
  try {
    machineName = readNodeConfig(join(tcpDir(deps.baseDir), 'node.json')).showName ?? machineName;
  } catch {
    // 读不出配置：hostname 兜底（仅显示用）
  }
  return runAdopt(
    {
      connect: args.connect ?? '',
      adopt: args.adopt!,
      ...(args.extendSession === undefined ? {} : { extendSession: args.extendSession }),
    },
    {
      tcpBaseDir: deps.baseDir,
      stdout: (line) => deps.stdout(line),
      stderr: (line) => (deps.stderr ?? deps.stdout)(line),
      log: () => {}, // adopt 是前台命令，输出留控制台——无静默路径
      listClaudeSessions: () => send.listClaudeSessions(),
      listCodexThreads: async () => (await send.listCodexThreads()).map((thread) => ({ id: thread.id, name: thread.name })),
      spawnServeDetach: spawnServeDetachReal,
      machineName,
      now: deps.now,
    },
  );
}

/**
 * 028 `serve --connect <星> --member-remove <名|id8>`：纯册状态操作——不经本机
 * 扫描（adopt 需本地验活故本机限定；remove 星内任何机器可执，同星共钥=互信域）。
 * 自退/管理删一体；幂等（本不在册=成功注明）。多条命中由 broker 拒绝并教 id8。
 */
async function runMemberRemoveServe(args: ServeArgs, deps: ServeDeps): Promise<number> {
  const config = readNodeConfig(join(tcpDir(deps.baseDir), 'node.json'));
  const { entry } = selectConnectEntry(args.connect ?? '', config);
  try {
    const result = await requestMemberRemove(entry, args.memberRemove!);
    if (!result.ok) {
      (deps.stderr ?? deps.stdout)(`member-remove 失败：${result.error ?? '未知错误'}`);
      return 1;
    }
    deps.stdout(
      result.removed.length === 0
        ? `成员 ${args.memberRemove} 本不在册（幂等成功，零改动）`
        : `已从星 ${entry.name ?? args.connect} 册内移除：${result.removed.join('、')}`,
    );
    return 0;
  } catch (err) {
    (deps.stderr ?? deps.stdout)(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

function readResultTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = env.CROSSCHAT_TCP_TIMEOUT_MS;
  if (raw === undefined || raw === '') return 120_000;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 1_000 ? n : 120_000;
}

export interface ProcInfo {
  pid: number;
  cmdline: string;
}

interface RawProc {
  pid: number;
  /** 可执行名（win=ExecutablePath 基名；unix=comm）——宿主/shell 过滤的关键。 */
  exe: string;
  cmdline: string;
}

/**
 * B3.1 bug3：命中命令行特征后还须 (a) 可执行名确为 node/crosschat（排除
 * wsl.exe/conhost/powershell/bash 等宿主与 shell——它们命令行里嵌着整条
 * 子命令文本，按串匹配就会误杀宿主、连带杀掉 WSL 会话），且 (b) 命令行含
 * 完整脚本路径特征 dist/cli.js 与 serve 旗标。纯函数可注入测试。
 */
export function matchServeProcesses(procs: RawProc[], selfPid: number): ProcInfo[] {
  return procs.filter((p) => {
    if (p.pid === selfPid || p.pid === 0) return false;
    if (!/\bserve\b/.test(p.cmdline)) return false;
    const base = p.exe.split(/[\\/]/).pop()?.toLowerCase() ?? '';
    if (base !== 'node' && base !== 'node.exe' && base !== 'crosschat' && base !== 'crosschat.exe') return false;
    return /dist[\\/]cli\.js/.test(p.cmdline);
  });
}

/** 扫描本机进程清单（win=CIM；unix=ps），过 matchServeProcesses 身份校验。 */
function listServeProcesses(): ProcInfo[] {
  let out: string;
  const procs: RawProc[] = [];
  if (process.platform === 'win32') {
    out = execSync(
      'powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object CommandLine | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress"',
      { encoding: 'utf8' },
    );
    const parsed = JSON.parse(out || '[]') as { ProcessId: number; ExecutablePath?: string | null; CommandLine: string } | { ProcessId: number; ExecutablePath?: string | null; CommandLine: string }[];
    for (const p of Array.isArray(parsed) ? parsed : [parsed]) {
      procs.push({ pid: p.ProcessId, exe: p.ExecutablePath ?? '', cmdline: p.CommandLine });
    }
  } else {
    out = execSync('ps -eo pid=,comm=,args=', { encoding: 'utf8' });
    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      const [pidTok, comm, ...rest] = trimmed.split(/\s+/);
      const pid = Number.parseInt(pidTok ?? '', 10);
      if (Number.isInteger(pid)) procs.push({ pid, exe: comm ?? '', cmdline: rest.join(' ') });
    }
  }
  return matchServeProcesses(procs, process.pid);
}

/** 注册表端口反查 pid（broker 双重确认用）。 */
function pidsOnPort(port: number): Set<number> {
  const pids = new Set<number>();
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
      for (const line of out.split('\n')) {
        if (!line.includes('LISTENING')) continue;
        const cols = line.trim().split(/\s+/);
        if ((cols[1] ?? '').endsWith(`:${port}`)) {
          const pid = Number.parseInt(cols[cols.length - 1] ?? '', 10);
          if (Number.isInteger(pid)) pids.add(pid);
        }
      }
    } else {
      const out = execSync(`ss -tlnp 2>/dev/null || lsof -t -i :${port} -sTCP:LISTEN 2>/dev/null`, {
        encoding: 'utf8',
        shell: '/bin/sh',
      });
      for (const m of out.matchAll(/pid=(\d+)/g)) pids.add(Number.parseInt(m[1] ?? '', 10));
      if (pids.size === 0) {
        for (const line of out.split('\n')) {
          const pid = Number.parseInt(line.trim(), 10);
          if (Number.isInteger(pid)) pids.add(pid);
        }
      }
    }
  } catch {
    // 工具缺失：返回空集，调用方按"未确认"处理
  }
  return pids;
}

/** 命令行里 --connect 的取值（空串=裸 --connect 默认守护；undefined=非节点进程）。 */
export function connectValueOf(cmdline: string): string | undefined {
  const m = cmdline.match(/--connect(?:=|\s+)([^\s]*)/);
  return m === null ? undefined : m[1] ?? '';
}

/**
 * 013：双开防护——`serve --connect` 起守护前扫本机进程清单（与 --stop 同一
 * listServeProcesses：同一套身份闸门与自身 pid 排除，看见同一个世界），已有
 * 同星节点守护活着即拒绝。同星判定与 selectConnectEntry 同解析序：双方的
 * `--connect` 取值各自对同一份 node.json 归一到条目再比（引用相等=同星），
 * 名字 / starId 前缀 / 裸默认腿换拼写绕不过。教学报错用活守护 cmdline 里的
 * 原拼写——stop 是字面匹配选择器，必须教能停掉它的那个拼写。失败方向一律
 * 放行（node.json 不可读、我的选择器解析不了、扫描抛错、对方 cmdline 解析
 * 不出星）：探测不到=现状行为，不把用户锁死。
 */
export function guardSameStarDaemon(connectArg: string, deps: ServeDeps): void {
  let config: NodeConfig;
  let mine: BrokerEntry;
  try {
    config = readNodeConfig(join(tcpDir(deps.baseDir), 'node.json'));
    mine = selectConnectEntry(connectArg, config).entry;
  } catch {
    return; // 解析不了交给 runForegroundNode 的既有教学报错
  }
  let procs: ProcInfo[];
  try {
    procs = (deps.listServeProcesses ?? listServeProcesses)();
  } catch {
    return; // 扫描失败=探测不到
  }
  for (const p of procs) {
    if (!p.cmdline.includes('--connect')) continue;
    const theirRaw = connectValueOf(p.cmdline); // includes 前置过滤后 undefined=尾置裸 --connect
    let theirs: BrokerEntry;
    try {
      theirs = selectConnectEntry(theirRaw ?? '', config).entry;
    } catch {
      continue; // 对方 cmdline 解析不出星（异常形状/配置已变）：保守放行不拦
    }
    if (theirs !== mine) continue;
    const star = formatBrokerEntry(mine);
    throw new MultichatError(
      'USAGE',
      theirRaw === undefined || theirRaw === ''
        ? `本机已有 ${star} 的节点守护在跑（pid ${p.pid}，--connect 裸默认腿）——先执行: crosschat serve --stop node（裸 --connect 无选择器拼写，将停全部节点守护）`
        : `本机已有 ${star} 的节点守护在跑（pid ${p.pid}，--connect ${theirRaw}）——先执行: crosschat serve --stop ${theirRaw}`,
    );
  }
  // 022：本机 broker 已内挂该星聚合器也算占用（F4 消除——手动 --connect 与进程
  // 内挂同 mid 双连会把名字/mid 寻址全撞死）。status-broker.json 的 stars 清单 +
  // pid 验活；读不到/解析失败=探测不到，放行。
  try {
    const st = JSON.parse(readFileSync(join(tcpDir(deps.baseDir), 'status-broker.json'), 'utf8')) as
      | { state?: unknown; pid?: unknown; stars?: Array<{ name?: unknown; starId?: unknown }> | null }
      | null;
    const hosted =
      st !== null && typeof st === 'object' && st.state === 'running' &&
      typeof st.pid === 'number' && isProcessAlive(st.pid) && Array.isArray(st.stars) &&
      st.stars.some(
        (s) =>
          (typeof s?.starId === 'string' && s.starId !== '' && s.starId === mine.starId) ||
          (mine.starId === undefined && typeof s?.name === 'string' && s.name !== '' && s.name === mine.name),
      );
    if (hosted) {
      throw new MultichatError(
        'USAGE',
        `本机 broker（pid ${st.pid}）已内挂 ${formatBrokerEntry(mine)} 的聚合器（022 起随 serve 自动自挂，无需另起守护）——如确要独立守护：先 crosschat serve --stop 再用 --connect（重启 broker 前 serve --stop 也会让位）`,
      );
    }
  } catch (err) {
    if (err instanceof MultichatError) throw err;
    // 状态文件不可读=探测不到，放行（现状行为）
  }
}

/**
 * B2：--stop <选择器>——只停该选择器的节点守护（精确匹配 --connect 的取值，
 * 身份校验沿用 matchServeProcesses 的 exe/脚本特征闸门）。
 */
function runStopSelector(selector: string, deps: ServeDeps): number {
  const procs = (deps.listServeProcesses ?? listServeProcesses)();
  const kill = deps.killPid ?? killPid;
  const targets = procs.filter((p) => p.cmdline.includes('--connect') && connectValueOf(p.cmdline) === selector);
  if (targets.length === 0) {
    deps.stdout(`stop node: 未找到 ${selector}`);
    return 1;
  }
  let rc = 0;
  for (const n of targets) {
    if (kill(n.pid)) deps.stdout(`stop node: pid ${n.pid} 已终止（--connect ${selector}）`);
    else {
      deps.stdout(`stop node: pid ${n.pid} 终止失败`);
      rc = 1;
    }
  }
  return rc;
}

/**
 * 026 空停善后：零进程命中但状态文件仍 online/running = 守护已异常死亡（心跳窗内的
 * 幽灵文件）——复位 state:"stopped"（其余字段原样保留），免得 doctor/status 误信。
 * 返回复位的文件名；写失败不阻塞停机。
 */
function resetGhostStatusFiles(dir: string, files: string[], ghostState: string): string[] {
  const reset: string[] = [];
  for (const file of files) {
    try {
      const path = join(dir, file);
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      if (parsed.state !== ghostState) continue;
      writeFileSync(path, `${JSON.stringify({ ...parsed, state: 'stopped' }, null, 2)}\n`, 'utf8');
      reset.push(file);
    } catch {
      // 善后失败不阻塞停机
    }
  }
  return reset;
}

function runStop(target: 'broker' | 'node' | 'both', deps: ServeDeps, registryFile: string): number {
  const procs = (deps.listServeProcesses ?? listServeProcesses)();
  const kill = deps.killPid ?? killPid;
  const brokers = procs.filter((p) => !p.cmdline.includes('--connect'));
  const nodes = procs.filter((p) => p.cmdline.includes('--connect'));
  const statusDir = tcpDir(deps.baseDir);
  let rc = 0;
  // B2：both 时先停全部节点守护再停 broker——节点腿断流在前，broker 关闭在后
  if (target === 'node' || target === 'both') {
    if (nodes.length === 0) {
      deps.stdout('stop node: 未发现运行中的节点');
      const reset = resetGhostStatusFiles(statusDir, listNodeStatusFiles(statusDir), 'online');
      if (reset.length > 0) deps.stdout(`stop node: 幽灵状态文件复位 stopped：${reset.join('、')}`);
    }
    for (const n of nodes) {
      if (kill(n.pid)) deps.stdout(`stop node: pid ${n.pid} 已终止`);
      else {
        deps.stdout(`stop node: pid ${n.pid} 终止失败`);
        rc = 1;
      }
    }
  }
  if (target === 'broker' || target === 'both') {
    if (brokers.length === 0) {
      deps.stdout('stop broker: 未发现运行中的 broker');
      const reset = resetGhostStatusFiles(statusDir, ['status-broker.json'], 'running');
      if (reset.length > 0) deps.stdout(`stop broker: 幽灵状态文件复位 stopped：${reset.join('、')}`);
    }
    const port = readMultiRegistry(registryFile).port ?? DEFAULT_PORT;
    const confirmed = (deps.pidsOnPort ?? pidsOnPort)(port);
    for (const b of brokers) {
      if (!confirmed.has(b.pid)) {
        deps.stdout(`stop broker: pid ${b.pid} 命令行匹配但未持有端口 ${port}，未确认跳过`);
        continue;
      }
      if (kill(b.pid)) deps.stdout(`stop broker: pid ${b.pid} 已终止（端口 ${port} 双重确认）`);
      else {
        deps.stdout(`stop broker: pid ${b.pid} 终止失败`);
        rc = 1;
      }
    }
  }
  return rc;
}

/**
 * 030 停机确认死亡：SIGTERM → 限时探活 → 仍活升级 SIGKILL → 仍活才算失败。
 * （旧实现只确认"信号已发"——linux 侧 SIGTERM 被兜住即假报"已终止"，drill-028 F8；
 * win 的 SIGTERM 即硬杀，探活立即通过零额外等待。）
 */
export function killPid(pid: number, waitMs = 2_000): boolean {
  const alive = (): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'EPERM'; // 存在但无权——保守按活
    }
  };
  try {
    process.kill(pid, 'SIGTERM');
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ESRCH'; // 已死=目标态达成；无权等其他错=失败
  }
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline && alive()) syncSleep(50);
  if (!alive()) return true;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    return true; // 探活刚变死——成功
  }
  const deadline2 = Date.now() + waitMs;
  while (Date.now() < deadline2 && alive()) syncSleep(50);
  return !alive();
}

/** 同步等待（killPid 探活轮询用；Atomics.wait 免占线程的 std 同步睡法）。 */
function syncSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
