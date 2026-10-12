/**
 * `crosschat serve` 命令面（票B B1+B2）：broker 服务端入口 + 注册表管理旗标
 * + --connect 节点客户端。broker 裸跑自身也是全权节点（deliverLocal 接
 * runSend，fileInbox 落盘本机收件）。
 */
import { execSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir, hostname, networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import process from 'node:process';
import { MultichatError } from '../errors.js';
import { machineId } from '../platform/machine-id.js';
import { Broker, DEFAULT_PORT, defaultDeliverLocal } from '../serve/broker.js';
import { ensureStarId, genKeys, listNodes, readRegistry, registryFileOf, removeNode, setPort, tcpDir, writeRegistry } from '../serve/registry.js';
import { deliverViaRunSend, NodeClient, readNodeConfig, type BrokerEntry, type NodeConfig } from '../serve/node.js';
import { FileInbox } from '../serve/file-channel.js';
import type { SendDeps } from './send.js';
import type { DeliverFrame, ErrorFrame, ResultFrame, SendFrame } from '../serve/protocol.js';

export interface ServeArgs {
  portArg?: string;
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
  if (args.genKeyArg !== undefined) return runGenKey(args.genKeyArg, deps, registryFile, port);
  if (args.list) return runList(deps, registryFile);
  if (args.remove !== undefined) return runRemove(args.remove, deps, registryFile);
  if (args.stopSelector !== undefined) return runStopSelector(args.stopSelector, deps);
  if (args.stopTarget !== undefined) return runStop(args.stopTarget, deps, registryFile);
  const detachedChild = deps.env.CROSSCHAT_SERVE_DETACHED === '1';
  if (args.connect !== undefined) {
    if (args.detach && !detachedChild) {
      const logName = args.connect === '' ? 'node.log' : `node-${args.connect}.log`;
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
  const results = genKeys(registryFile, n, { host, port: portNum, alias: deps.hostname(), starId: ensureStarId(registryFile) });
  deps.stdout(`自动探测 broker 地址：${host}:${portNum}（多网卡/NAT 常探错——按下述规则人工核对改写 node.json 的 host 与 port）：`);
  deps.stdout('  · broker 机自身 → 无需分发（首次 serve 已自动写好 127.0.0.1 的自用 node.json）');
  deps.stdout('  · broker 是云主机/NAT 内网机 → host 填对外公网 IP（探测常拿内网 IP，必核对）');
  deps.stdout('  · 普通局域网 → broker 机的局域网 IP；broker 用非默认端口时 port 一并改');
  deps.stdout('分发前把每份 node.json 的 name 改成「贴这份配置的机器」的自报名字（建议=其 hostname；纯显示用——roster 怎么称呼它，寻址/回信不依赖，走 machine-id 前缀）');
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
    // 新写一律数组形状（单星=一项，多星=多项——只产出一种形状）
    const starId = ensureStarId(registryFile);
    writeFileSync(
      nodeJson,
      `${JSON.stringify({ brokers: [{ host: '127.0.0.1', port, alias: deps.hostname(), starId, key: self.key }], name: deps.hostname() }, null, 2)}\n`,
      'utf8',
    );
    return { status: 'written' };
  }
  // 已存在：宽松解析判状态（双形状；坏文件交给上层教学报错）
  let entries: BrokerEntry[];
  try {
    entries = readNodeConfig(nodeJson).entries;
  } catch {
    return { status: 'stale' };
  }
  // 找本 broker 的钥匙条目（多星机上自用条目可与外星条目共存于同一数组）
  const mine = entries.find((e) => e.key === self.key);
  if (mine === undefined) {
    const first = entries[0];
    return { status: 'foreign', host: first?.host, port: first?.port };
  }
  if (mine.host !== '127.0.0.1' || mine.port !== port) return { status: 'stale' };
  // B1：钥匙/host/port 匹配但条目缺 starId（B0 之前写下的自用 node.json）→
  // 原子补写注册表 starId，其余字段不碰
  if (mine.starId === undefined) backfillSelfStarId(nodeJson, self.key, ensureStarId(registryFile));
  return { status: 'ok' };
}

/** B1：自用条目补 starId（双形状：数组元素/旧 broker 对象；tmp+rename 原子写）；失败不倒 serve。 */
function backfillSelfStarId(nodeJson: string, selfKey: string, starId: string): void {
  try {
    const raw = JSON.parse(readFileSync(nodeJson, 'utf8')) as {
      brokers?: (Record<string, unknown> | null)[];
      broker?: Record<string, unknown> | null;
      key?: unknown;
    } | null;
    if (raw === null || typeof raw !== 'object') return;
    if (Array.isArray(raw.brokers)) {
      const mine = raw.brokers.find((e): e is Record<string, unknown> => e !== null && typeof e === 'object' && e.key === selfKey && e.starId === undefined);
      if (mine === undefined) return;
      mine.starId = starId;
    } else if (raw.broker !== null && typeof raw.broker === 'object' && raw.broker.starId === undefined && raw.key === selfKey) {
      raw.broker.starId = starId;
    } else {
      return;
    }
    const tmp = `${nodeJson}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
    renameSync(tmp, nodeJson);
  } catch {
    // 补写失败不倒 serve（下次启动再试）
  }
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
          appendFileSync(logFile, `${line}\n`);
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
    : async (frame: SendFrame): Promise<ResultFrame | ErrorFrame> => {
        const deliver: DeliverFrame = {
          op: 'deliver',
          id: frame.id,
          fromMachine: 'local',
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
 * B2：--connect 选择器解析（限定器风格对齐 via-tcp 的 selectBrokerEntry）：
 * 别名精确匹配 → starId 前缀唯一匹配（歧义教加长）；无命中时单条目走旧
 * "别名不符拒绝"校验路径（旧形状兼容），多条目列条目并给示例。'' = entries[0]。
 */
export function selectConnectEntry(selector: string, config: NodeConfig): { entry: BrokerEntry; selector: string } {
  const entries = config.entries;
  if (selector === '') return { entry: entries[0]!, selector };
  const byAlias = entries.find((e) => e.alias === selector);
  if (byAlias !== undefined) return { entry: byAlias, selector };
  const byPrefix = entries.filter((e) => e.starId !== undefined && e.starId.startsWith(selector));
  if (byPrefix.length === 1) return { entry: byPrefix[0]!, selector };
  if (byPrefix.length > 1) {
    throw new MultichatError(
      'USAGE',
      `--connect 选择器 ${selector} 的 starId 前缀命中多个星（${byPrefix.map((e) => e.alias ?? e.starId).join('、')}）——加长前缀使其唯一`,
    );
  }
  if (entries.length === 1) {
    // 旧校验路径：单条目（旧形状）别名不符拒绝；无别名则容忍直连（B2 前行为）
    const alias = entries[0]!.alias;
    if (alias !== undefined) {
      throw new MultichatError(
        'USAGE',
        `--connect ${selector} 与 node.json 的 broker 别名 ${alias} 不符——省略别名直连，或向管理员核对 node.json`,
      );
    }
    return { entry: entries[0]!, selector };
  }
  const list = entries.map((e) => `${e.alias ?? '(无别名)'}(starId ${e.starId ?? '未登记'})`).join('、');
  throw new MultichatError(
    'USAGE',
    `--connect 选择器 ${selector} 不匹配任何条目——本机 node.json 现有：${list}；示例：--connect ${entries[0]!.alias ?? entries[0]!.starId}`,
  );
}

/** B2：--connect 节点客户端前台跑（Ctrl+C 退出）。守护只连选中条目（config.entries 收窄为单元素）。 */
async function runForegroundNode(aliasArg: string, deps: ServeDeps): Promise<number> {
  const config = readNodeConfig(join(tcpDir(deps.baseDir), 'node.json'));
  const { entry, selector } = selectConnectEntry(aliasArg, config);
  const suffix = selector === '' ? '' : `-${selector}`;
  const detached = deps.env.CROSSCHAT_SERVE_DETACHED === '1';
  const logFile = join(tcpDir(deps.baseDir), `node${suffix}.log`);
  const logLine = detached
    ? (line: string) => {
        try {
          appendFileSync(logFile, `${line}\n`);
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
  logLine(`节点客户端启动：目标 broker ${entry.alias ?? `${entry.host}:${entry.port}`}（Ctrl+C 退出）`);
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
