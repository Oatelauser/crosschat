/**
 * `crosschat serve` 命令面（票B B1+B2）：broker 服务端入口 + 注册表管理旗标
 * + --connect 节点客户端。broker 裸跑自身也是全权节点（deliverLocal 接
 * runSend，fileInbox 落盘本机收件）。
 */
import { execSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir, hostname, networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import process from 'node:process';
import { MultichatError } from '../errors.js';
import { machineId } from '../platform/machine-id.js';
import { Broker, DEFAULT_PORT, defaultDeliverLocal } from '../serve/broker.js';
import { genKeys, listNodes, readRegistry, registryFileOf, removeNode, setPort, tcpDir, writeRegistry } from '../serve/registry.js';
import { deliverViaRunSend, NodeClient, readNodeConfig, type NodeConfig } from '../serve/node.js';
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
  if (args.stopTarget !== undefined) return runStop(args.stopTarget, deps, registryFile);
  const detachedChild = deps.env.CROSSCHAT_SERVE_DETACHED === '1';
  if (args.connect !== undefined) {
    if (args.detach && !detachedChild) return runDetach(deps, ['--connect', ...(args.connect === '' ? [] : [args.connect])], 'node.log');
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
  const results = genKeys(registryFile, n, { host, port: portNum, alias: deps.hostname() });
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

/** 后台化：spawn 自身 detached + env 标记防循环；日志写 tcp/<name>。broker 传端口（节点客户端外连无监听口）。 */
function runDetach(deps: ServeDeps, extraArgs: string[], logName: 'broker.log' | 'node.log', portNum?: number): number {
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
  deps.stdout(`${logName === 'node.log' ? '节点客户端' : 'broker'} 后台运行中 pid=${child.pid}${portNum !== undefined ? ` 端口 ${portNum}` : ''}（日志：${logFile}）`);
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
    writeFileSync(
      nodeJson,
      `${JSON.stringify({ broker: { host: '127.0.0.1', port, alias: deps.hostname() }, key: self.key, name: deps.hostname() }, null, 2)}\n`,
      'utf8',
    );
    return { status: 'written' };
  }
  // 已存在：宽松解析判状态（不抛——这里只是体检，坏文件交给上层教学报错）
  let parsed: { broker?: { host?: string; port?: number }; key?: string } | undefined;
  try {
    parsed = JSON.parse(readFileSync(nodeJson, 'utf8')) as typeof parsed;
  } catch {
    parsed = undefined;
  }
  const broker = parsed?.broker;
  if (typeof broker?.host !== 'string' || typeof parsed?.key !== 'string') return { status: 'stale' };
  if (broker.host !== '127.0.0.1') return { status: 'foreign', host: broker.host, port: broker.port };
  if (parsed.key !== self.key || broker.port !== port) return { status: 'stale' };
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
          appendFileSync(logFile, `${line}\n`);
        } catch {
          // 日志写失败不倒服务
        }
      }
    : (line: string) => deps.stdout(line);
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
        const r = await deliverViaRunSend(deliver, deps.makeSendDeps!());
        // deliverViaRunSend 的失败即 ResultFrame{status:'error'}——规整为
        // ErrorFrame，broker 本地分支的失败语义（op:'error'）保持 B1 不变。
        return r.status === 'error'
          ? { op: 'error', code: r.code ?? 'REMOTE_FAILED', message: r.message ?? '本机投递失败' }
          : r;
      };
  // B2.1：起服务前自登记（本机=全权成员，mid8/名字可寻址 + 本机 node.json）。
  // 后台子进程不重复出声——父进程 spawn 前已向控制台播报过。
  const self = ensureSelfEntry(deps, registryFileOf(deps.baseDir), port ?? readRegistry(registryFileOf(deps.baseDir)).port ?? DEFAULT_PORT);
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

/** B2：--connect 节点客户端前台跑（Ctrl+C 退出）。 */
async function runForegroundNode(aliasArg: string, deps: ServeDeps): Promise<number> {
  const config = loadNodeConfigChecked(aliasArg, deps);
  const detached = deps.env.CROSSCHAT_SERVE_DETACHED === '1';
  const logFile = join(tcpDir(deps.baseDir), 'node.log');
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
    config,
    machineId: deps.machineId,
    statusFile: join(tcpDir(deps.baseDir), 'status-node.json'),
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
  logLine(`节点客户端启动：目标 broker ${config.broker.alias ?? `${config.broker.host}:${config.broker.port}`}（Ctrl+C 退出）`);
  await client.run();
  return 0;
}

/** 读 node.json（教学报错）；--connect 显式给的别名与凭证不符时拒绝。 */
function loadNodeConfigChecked(aliasArg: string, deps: ServeDeps): NodeConfig {
  const config = readNodeConfig(join(tcpDir(deps.baseDir), 'node.json'));
  if (aliasArg !== '' && config.broker.alias !== undefined && aliasArg !== config.broker.alias) {
    throw new MultichatError(
      'USAGE',
      `--connect ${aliasArg} 与 node.json 的 broker 别名 ${config.broker.alias} 不符——省略别名直连，或向管理员核对 node.json`,
    );
  }
  return config;
}

function readResultTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = env.CROSSCHAT_TCP_TIMEOUT_MS;
  if (raw === undefined || raw === '') return 120_000;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 1_000 ? n : 120_000;
}

interface ProcInfo {
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

function runStop(target: 'broker' | 'node' | 'both', deps: ServeDeps, registryFile: string): number {
  const procs = listServeProcesses();
  const brokers = procs.filter((p) => !p.cmdline.includes('--connect'));
  const nodes = procs.filter((p) => p.cmdline.includes('--connect'));
  let rc = 0;
  if (target === 'broker' || target === 'both') {
    if (brokers.length === 0) deps.stdout('stop broker: 未发现运行中的 broker');
    const port = readRegistry(registryFile).port ?? DEFAULT_PORT;
    const confirmed = pidsOnPort(port);
    for (const b of brokers) {
      if (!confirmed.has(b.pid)) {
        deps.stdout(`stop broker: pid ${b.pid} 命令行匹配但未持有端口 ${port}，未确认跳过`);
        continue;
      }
      if (killPid(b.pid)) deps.stdout(`stop broker: pid ${b.pid} 已终止（端口 ${port} 双重确认）`);
      else {
        deps.stdout(`stop broker: pid ${b.pid} 终止失败`);
        rc = 1;
      }
    }
  }
  if (target === 'node' || target === 'both') {
    if (nodes.length === 0) deps.stdout('stop node: 未发现运行中的节点');
    for (const n of nodes) {
      if (killPid(n.pid)) deps.stdout(`stop node: pid ${n.pid} 已终止`);
      else {
        deps.stdout(`stop node: pid ${n.pid} 终止失败`);
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
