/**
 * `crosschat serve` 命令面（票B B1+B2）：broker 服务端入口 + 注册表管理旗标
 * + --connect 节点客户端。broker 裸跑自身也是全权节点（deliverLocal 接
 * runSend，fileInbox 落盘本机收件）。
 */
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir, hostname, networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import process from 'node:process';
import { MultichatError } from '../errors.js';
import { appendWithRotate } from '../log-rotate.js';
import { machineId } from '../platform/machine-id.js';
import { Broker, DEFAULT_PORT, defaultDeliverLocal } from '../serve/broker.js';
import { ensureStarId, ensureStarName, genKeys, listNodes, readRegistry, registryFileOf, removeNode, sanitizeName, setName, setPort, tcpDir, writeRegistry } from '../serve/registry.js';
import { buildStatusPayload, deliverViaRunSend, formatBrokerEntry, NodeClient, readNodeConfig, syncNodeJsonEntry, type BrokerEntry, type NodeConfig } from '../serve/node.js';
import { FileInbox } from '../serve/file-channel.js';
import type { SendDeps } from './send.js';
import type { DeliverFrame, ErrorFrame, ResultFrame, SendFrame, StatusPayload } from '../serve/protocol.js';

export interface ServeArgs {
  portArg?: string;
  /** E0 星名（broker 专用；校验/持久化在 registry.setName）。 */
  nameArg?: string;
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
}

export interface ServeDeps {
  /** 注册表/状态/日志的根目录；真跑 ~/.crosschat，测试注入临时目录。 */
  baseDir: string;
  stdout(line: string): void;
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
  if (args.nameArg !== undefined) {
    // E0 星名：与 --port 同语义（显式给即持久化）；节点模式无星名概念
    if (args.connect !== undefined) {
      throw new MultichatError('USAGE', '--name 是 broker 星名设置，节点模式不支持——去 broker 机上跑 crosschat serve --name <星名>');
    }
    setName(registryFile, args.nameArg);
  }
  if (args.genKeyArg !== undefined) return runGenKey(args.genKeyArg, deps, registryFile, port);
  if (args.list) return runList(deps, registryFile);
  if (args.remove !== undefined) return runRemove(args.remove, deps, registryFile);
  if (args.stopSelector !== undefined) return runStopSelector(args.stopSelector, deps);
  if (args.stopTarget !== undefined) return runStop(args.stopTarget, deps, registryFile);
  const detachedChild = deps.env.CROSSCHAT_SERVE_DETACHED === '1';
  if (args.connect !== undefined) {
    // 013 双开防护：起守护前拒同星（前台在本进程、--detach 在父进程各扫一次；
    // detached 子进程不扫——父进程 spawn 前已扫，且父进程退场前会被误当活守护）
    if (!detachedChild) guardSameStarDaemon(args.connect, deps);
    if (args.detach && !detachedChild) {
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
    // 父进程先自登记并出声（子进程里再跑是幂等空转）——后台模式控制台不留黑盒
    const effectivePort = port ?? readRegistry(registryFile).port ?? DEFAULT_PORT;
    announceSelfEntry(deps, ensureSelfEntry(deps, registryFile, effectivePort));
    return runDetach(deps, [], 'broker.log', effectivePort);
  }
  return runForegroundBroker(deps, port);
}

function runGenKey(genKeyArg: string, deps: ServeDeps, registryFile: string, port: number | undefined): number {
  const n = Number.parseInt(genKeyArg, 10);
  if (!Number.isInteger(n) || n < 1) {
    throw new MultichatError('USAGE', `--gen-key 数量须为 1-10 的整数，收到：${genKeyArg}`);
  }
  const host = firstNonInternalIPv4(deps.networkInterfaces());
  const portNum = port ?? readRegistry(registryFile).port ?? DEFAULT_PORT;
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

function firstNonInternalIPv4(ifaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string {
  for (const list of Object.values(ifaces)) {
    for (const ni of list ?? []) {
      if (!ni.internal && ni.family === 'IPv4') return ni.address;
    }
  }
  return '127.0.0.1';
}

function runList(deps: ServeDeps, registryFile: string): number {
  const nodes = listNodes(registryFile);
  deps.stdout(`${'label'.padEnd(10)}${'name'.padEnd(18)}${'mid8'.padEnd(10)}added-at`);
  for (const node of nodes) {
    deps.stdout(
      `${node.label.padEnd(10)}${(node.machineName ?? '-').padEnd(18)}${(node.machineId?.slice(0, 8) ?? '-').padEnd(10)}${node.addedAt}`,
    );
  }
  if (nodes.length === 0) deps.stdout('（注册表为空）');
  return 0;
}

function runRemove(label: string, deps: ServeDeps, registryFile: string): number {
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
  // B1 多星：broker 自投递签发的 ref 盖注册表星标识（与 gen-key 分发的钥匙同源）
  const registryFile = registryFileOf(deps.baseDir);
  const registryStarId = ensureStarId(registryFile);
  // B2：broker 机自己也是全权节点——deliverLocal 接 runSend、file 落本机收件。
  const deliverLocal = deps.makeSendDeps === undefined
    ? defaultDeliverLocal
    : async (frame: SendFrame, fromMachine?: string): Promise<ResultFrame | ErrorFrame> => {
        // F1：fromMachine=broker 传入的发送方 roster 真名（远端来件在 broker 机
        // 投递也带真名）；无名瞬态发送方缺省——信封整个省略 from-machine。
        const deliver: DeliverFrame = {
          op: 'deliver',
          id: frame.id,
          ...(fromMachine === undefined ? {} : { fromMachine }),
          payload: frame.body,
          to: frame.to,
          conversation: frame.conversation,
          origin: frame.origin,
        };
        const r = await deliverViaRunSend(deliver, { ...deps.makeSendDeps!(), refStarId: registryStarId });
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
  const self = ensureSelfEntry(deps, registryFile, port ?? readRegistry(registryFile).port ?? DEFAULT_PORT);
  if (!detached) announceSelfEntry(deps, self);
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
  await new Promise<void>((resolve) => {
    const stop = () => {
      void broker.stop().then(() => resolve());
    };
    deps.onSignal('SIGINT', stop);
    deps.onSignal('SIGTERM', stop);
  });
  return 0;
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
  });
  logLine(`节点客户端启动：目标 broker ${entry.name ?? `${entry.host}:${entry.port}`}（Ctrl+C 退出）`);
  await client.run();
  return 0;
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

function runStop(target: 'broker' | 'node' | 'both', deps: ServeDeps, registryFile: string): number {
  const procs = (deps.listServeProcesses ?? listServeProcesses)();
  const kill = deps.killPid ?? killPid;
  const brokers = procs.filter((p) => !p.cmdline.includes('--connect'));
  const nodes = procs.filter((p) => p.cmdline.includes('--connect'));
  let rc = 0;
  // B2：both 时先停全部节点守护再停 broker——节点腿断流在前，broker 关闭在后
  if (target === 'node' || target === 'both') {
    if (nodes.length === 0) deps.stdout('stop node: 未发现运行中的节点');
    for (const n of nodes) {
      if (kill(n.pid)) deps.stdout(`stop node: pid ${n.pid} 已终止`);
      else {
        deps.stdout(`stop node: pid ${n.pid} 终止失败`);
        rc = 1;
      }
    }
  }
  if (target === 'broker' || target === 'both') {
    if (brokers.length === 0) deps.stdout('stop broker: 未发现运行中的 broker');
    const port = readRegistry(registryFile).port ?? DEFAULT_PORT;
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

function killPid(pid: number): boolean {
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}
