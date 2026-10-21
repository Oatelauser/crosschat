/**
 * `crosschat serve` 命令面（票B B1+B2）：broker 服务端入口 + 注册表管理旗标
 * + --connect 节点客户端。broker 裸跑自身也是全权节点（deliverLocal 接
 * runSend，fileInbox 落盘本机收件）。
 */
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { randomBytes } from 'node:crypto';
import { homedir, hostname, networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import process from 'node:process';
import { MultichatError } from '../errors.js';
import { appendWithRotate } from '../log-rotate.js';
import { machineId } from '../platform/machine-id.js';
import { isProcessAlive } from '../platform/process-inspector.js';
import { Broker, DEFAULT_PORT, defaultDeliverLocal, type AdminReply } from '../serve/broker.js';
import {
  addStarTo,
  ensureStarIds,
  genAdminKeyFor,
  genKeysFor,
  loadBrokerFile,
  registryFileOf,
  removeAdminKeyFor,
  removeNodeFor,
  removeStarFrom,
  sanitizeName,
  selectStar,
  setNameFor,
  setShowNameFor,
  setStarShowNameFor,
  tcpDir,
  writeBrokerFile,
  type GenAdminKeyResult,
  type GenKeyResult,
  type NodeEntry,
  type StarRecord,
} from '../serve/registry.js';
import { buildStatusPayload, deliverViaRunSend, formatBrokerEntry, NodeClient, readNodeConfig, type BrokerEntry, type NodeConfig } from '../serve/node.js';
import { VirtualSocket } from '../serve/virtual-socket.js';
import { FileInbox } from '../serve/file-channel.js';
import { requestAdminOp, requestMemberRemove, SenderConn } from '../serve/via-tcp.js';
import { runAdopt, spawnServeDetachReal, warnIfBrokerLacksSessionCaps } from './session-star.js';
import { listNodeStatusFiles } from './status.js';
import type { SendDeps } from './send.js';
import type { DeliverFrame, ErrorFrame, ResultFrame, SendFrame, StatusPayload } from '../serve/protocol.js';

export interface ServeArgs {
  /** E0 星名（broker 专用；校验/持久化在 registry.setName；036 起一律须与 --star 连用——单星亦然）。 */
  nameArg?: string;
  /** 022/036：星域选择器（星域八子的目标星限定——单星也不再隐式命中）。 */
  starArg?: string;
  /** 022：--add-star <名>——broker 托管下一颗星（033 起热闭环：在跑 broker 即时托管免重启）。 */
  addStarArg?: string;
  /** 033：--remove-star <名|starId前缀>——删整星（册随星葬、钥匙作废；最后一颗可删，零星合法）。 */
  removeStarArg?: string;
  /** 033：--show-name <名>——broker 机显示名热改（node.json showName + 重挂内挂聚合器；空串=清除）。 */
  showNameArg?: string;
  /** 034：--gen-admin-key <label>——发星管理钥（仅 broker 主本机；一星一权，挑战应答，钥匙永不过线）。 */
  genAdminKeyArg?: string;
  /** 034：--remove-admin-key <label|前缀>——吊星管理钥（仅 broker 主本机）。 */
  removeAdminKeyArg?: string;
  /** 数字字符串，缺省 '1'；上限校验在 registry.genKeys。 */
  genKeyArg?: string;
  list?: boolean;
  /** 034：--list-nodes——读一颗星的节点表（无钥匙回显；--via tcp:<星> 走远端）。 */
  listNodes?: boolean;
  /** 034：--list-members——读一颗星的成员册（--via tcp:<星> 走远端）。 */
  listMembers?: boolean;
  /** 034：--via tcp:<星>——远程管理路由（读=星钥成员身份；写=条目 adminKey 星管理员身份）。 */
  viaArg?: string;
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

/**
 * 033 管理插座客户端（CLI 侧）：热=在跑 broker 回执；cold=本机无在跑 broker
 * （直调 registry 库函数，打印区分）；failed=插座连上但回执超时/坏形状——
 * **绝不回落直写**（broker 活着即唯一写者，报错教重试）。
 */
export type AdminOutcome = { kind: 'hot'; reply: AdminReply } | { kind: 'cold' } | { kind: 'failed'; error: string };

/** 管理插座回执等待上限（连上+回执同一预算；注册表写+聚合器播种为快路径）。 */
const ADMIN_RECEIPT_TIMEOUT_MS = 10_000;

export async function adminOp(deps: ServeDeps, req: Record<string, unknown>): Promise<AdminOutcome> {
  let pipe: string | undefined;
  try {
    const st = JSON.parse(readFileSync(join(tcpDir(deps.baseDir), 'status-broker.json'), 'utf8')) as
      | { state?: unknown; pid?: unknown; adminPipe?: unknown }
      | null;
    // 热路径判定：状态新鲜 running + pid 验活 + 插座地址在场（旧版 broker 无此
    // 字段=冷路径）。读到坏文件/无文件一律冷路径。
    if (
      st !== null && typeof st === 'object' && st.state === 'running' && typeof st.pid === 'number' &&
      isProcessAlive(st.pid) && typeof st.adminPipe === 'string' && st.adminPipe !== ''
    ) {
      pipe = st.adminPipe;
    }
  } catch {
    // 无状态文件=broker 未跑
  }
  if (pipe === undefined) return { kind: 'cold' };
  return new Promise<AdminOutcome>((resolve) => {
    const socket = createConnection({ path: pipe }, () => {
      socket.write(`${JSON.stringify(req)}\n`);
    });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({
        kind: 'failed',
        error: `管理插座 ${pipe} 已连上但 ${ADMIN_RECEIPT_TIMEOUT_MS / 1000}s 内无回执——broker 活着即台账唯一写者，绝不回落直写；核对 broker 状态后重试`,
      });
    }, ADMIN_RECEIPT_TIMEOUT_MS);
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const idx = buf.indexOf('\n');
      if (idx < 0) return;
      clearTimeout(timer);
      socket.destroy();
      try {
        resolve({ kind: 'hot', reply: JSON.parse(buf.slice(0, idx)) as AdminReply });
      } catch {
        resolve({ kind: 'failed', error: `管理插座回执不可解析：${buf.slice(0, 120)}` });
      }
    });
    socket.on('error', () => {
      // 状态新鲜+pid 活但管道拒连=broker 刚停的竞态（管道随进程生死）——冷路径
      clearTimeout(timer);
      socket.destroy();
      resolve({ kind: 'cold' });
    });
  });
}

/** 033：热路径失败统一出口——报错教重试，绝不回落直写。 */
function adminFailed(deps: ServeDeps, error: string): number {
  (deps.stderr ?? deps.stdout)(`管理命令未生效：${error}`);
  return 1;
}

export async function runServe(args: ServeArgs, deps: ServeDeps): Promise<number> {
  const registryFile = registryFileOf(deps.baseDir);
  // 033：懒 bootstrap 已删（serve 永不造星——空表=合法待配，首星走 --add-star
  // 显式命名）；管理命令热路径经管理插座（broker 回执才算"已生效"），冷路径
  // 直调 registry 库函数（broker 未跑——函数与热路径同一套，首星/预配机不断腿）。
  // 034：--port 旗标全删（端口=broker.json 手编字段重启生效——set-port 插座 op 同删）。
  const oneShotCount = [args.addStarArg, args.removeStarArg, args.showNameArg].filter((v) => v !== undefined).length;
  if (oneShotCount > 1) {
    throw new MultichatError('USAGE', '--add-star / --remove-star / --show-name 均为一次性命令，一次只给一个');
  }
  // 036 决策3：一次性命令与其他管理旗标同给即拒并列冲突旗标——不再静默吞
  //（用户实证踩过：--name cloud --add-star cloudstar 中 --name 被无声忽略）。
  // --star 不算冲突（它是 --show-name 按星形态的限定词）；--connect/--detach
  // 由各一次性命令自身的既有拒绝兜（更早、教学更准）。
  if (oneShotCount === 1) {
    const oneShot = args.addStarArg !== undefined ? '--add-star' : args.removeStarArg !== undefined ? '--remove-star' : '--show-name';
    const conflicts = ([
      ['--name', args.nameArg],
      ['--gen-key', args.genKeyArg],
      ['--remove', args.remove],
      ['--gen-admin-key', args.genAdminKeyArg],
      ['--remove-admin-key', args.removeAdminKeyArg],
      ['--list', args.list],
      ['--list-nodes', args.listNodes],
      ['--list-members', args.listMembers],
      ['--via', args.viaArg],
      ['--stop', args.stopTarget],
      ['--stop', args.stopSelector],
    ] as Array<[string, unknown]>).filter(([, v]) => v !== undefined && v !== false).map(([f]) => f);
    if (conflicts.length > 0) {
      throw new MultichatError('USAGE', `${oneShot} 是一次性命令，不与 ${conflicts.join('、')} 同给（同给会被无声忽略）——分开执行`);
    }
  }
  // 022 --add-star / 033 --remove-star / --show-name（一次性命令；先于其余管理旗标处理）
  if (args.addStarArg !== undefined) {
    if (args.connect !== undefined) {
      throw new MultichatError('USAGE', '--add-star 是 broker 侧命令，不与 --connect 连用');
    }
    if (args.detach) throw new MultichatError('USAGE', '--add-star 是一次性命令，不支持 --detach');
    return runAddStar(args.addStarArg, deps, registryFile);
  }
  if (args.removeStarArg !== undefined) {
    if (args.connect !== undefined) {
      throw new MultichatError('USAGE', '--remove-star 是 broker 侧命令，不与 --connect 连用');
    }
    if (args.detach) throw new MultichatError('USAGE', '--remove-star 是一次性命令，不支持 --detach');
    return runRemoveStar(args.removeStarArg, deps, registryFile);
  }
  if (args.showNameArg !== undefined) {
    if (args.connect !== undefined) {
      throw new MultichatError('USAGE', '--show-name 是 broker 机命令，不与 --connect 连用');
    }
    if (args.detach) throw new MultichatError('USAGE', '--show-name 是一次性命令，不支持 --detach');
    // 036 两形态：--star <星>=条目级覆盖；裸=全局默认（现行为保留）
    return runShowName(args.showNameArg, deps, resolveStarScope(args, registryFile).star);
  }
  // 034 远程管理路由：--via tcp:<星> 时 --gen-key/--remove/--list-nodes/--list-members
  // 发往远端 broker（读=星钥成员身份；写=条目 adminKey 星管理员挑战应答）。
  if (args.viaArg !== undefined) return runRemoteAdmin(args, deps);
  // 022/036 星域解析：星域七子一律 --star 指名（单星隐式命中随葬——统一当多星
  // 处理；--list 只读分组展示除外）
  const starScope = resolveStarScope(args, registryFile);
  if (args.nameArg !== undefined) {
    // E0 星名：与 --port 同语义（显式给即持久化）；节点模式无星名概念
    if (args.connect !== undefined) {
      throw new MultichatError('USAGE', '--name 是 broker 星名设置，节点模式不支持——去 broker 机上跑 crosschat serve --name <星名>');
    }
    requireStarScope(starScope, registryFile, '--name <新星名>');
    // 033：改名经插座（在跑 broker 唯一写者+内存星域即时刷新）；冷路径直调库函数
    const nameStar = loadBrokerFile(registryFile).stars.find((s) => s.starId === starScope.star!.starId) ?? starScope.star!;
    const outcome = await adminOp(deps, { op: 'set-name', starId: nameStar.starId!, name: args.nameArg });
    if (outcome.kind === 'hot') {
      if (!outcome.reply.ok) throw new MultichatError('USAGE', `改星名失败：${outcome.reply.error ?? '未知错误'}`);
    } else if (outcome.kind === 'failed') return adminFailed(deps, outcome.error);
    else setNameFor(registryFile, nameStar.starId!, args.nameArg);
  }
  // 034 星管理钥发/吊（仅 broker 主本机：热经插座，冷直调库函数——发放即绑定一星）
  if (args.genAdminKeyArg !== undefined) {
    if (args.connect !== undefined) throw new MultichatError('USAGE', '--gen-admin-key 是 broker 侧命令，不与 --connect 连用');
    if (args.detach) throw new MultichatError('USAGE', '--gen-admin-key 是一次性命令，不支持 --detach');
    return runGenAdminKey(args.genAdminKeyArg, deps, registryFile, starScope);
  }
  if (args.removeAdminKeyArg !== undefined) {
    if (args.connect !== undefined) throw new MultichatError('USAGE', '--remove-admin-key 是 broker 侧命令，不与 --connect 连用');
    if (args.detach) throw new MultichatError('USAGE', '--remove-admin-key 是一次性命令，不支持 --detach');
    return runRemoveAdminKey(args.removeAdminKeyArg, deps, registryFile, starScope);
  }
  if (args.genKeyArg !== undefined) return runGenKey(args.genKeyArg, deps, registryFile, starScope);
  if (args.list) return runList(deps, registryFile);
  // 034 本机读 op（冷读 broker.json，broker 机视角；远端走 --via tcp:<星> 已提前分流）
  if (args.listNodes) return runListNodes(deps, registryFile, starScope);
  if (args.listMembers) return runListMembers(deps, registryFile, starScope);
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
    const effectivePort = loadBrokerFile(registryFile).port ?? DEFAULT_PORT;
    for (const line of ensureSelfEntries(deps, registryFile, effectivePort)) deps.stdout(line);
    return runDetach(deps, [], 'broker.log', effectivePort);
  }
  return runForegroundBroker(deps);
}

/**
 * 022/036 星域解析：星域命令一律 `--star` 指名——单星隐式命中随葬（统一当
 * 多星处理）。缺 --star 时 star=undefined，由 requireStarScope 统一教学（空表
 * 教 --add-star；有星教列星+示例）。
 */
function resolveStarScope(args: ServeArgs, registryFile: string): { star?: StarRecord } {
  if (args.starArg === undefined) return {};
  return { star: selectStar(loadBrokerFile(registryFile).stars, args.starArg) };
}

/**
 * 星域未定的统一教学：空表教 --add-star（033 起首星显式命名）；缺 --star 教
 * 列星+示例——036 起单星也须指名（"本 broker 托管多颗星"的措辞随葬）。
 */
function requireStarScope(scope: { star?: StarRecord }, registryFile: string, flag: string): void {
  if (scope.star !== undefined) return;
  const doc = loadBrokerFile(registryFile);
  if (doc.stars.length === 0) {
    throw new MultichatError('USAGE', `broker.json 零星（合法待配状态——serve 永不自动造星）——先 crosschat serve --add-star <星名> 显式创建首星，再用 --star <星> ${flag}`);
  }
  const list = doc.stars.map((s) => s.name ?? s.starId ?? '(未定名)').join('、');
  throw new MultichatError(
    'USAGE',
    `${flag} 须 --star <星名|starId前缀> 指名目标星（单星也不例外——036 起统一当多星处理）——现有：${list}；示例：crosschat serve --star ${doc.stars[0]!.name ?? doc.stars[0]!.starId} ${flag}`,
  );
}

async function runGenKey(genKeyArg: string, deps: ServeDeps, registryFile: string, starScope: { star?: StarRecord }): Promise<number> {
  const n = Number.parseInt(genKeyArg, 10);
  if (!Number.isInteger(n) || n < 1) {
    throw new MultichatError('USAGE', `--gen-key 数量须为 1-10 的整数，收到：${genKeyArg}`);
  }
  const host = firstNonInternalIPv4(deps.networkInterfaces());
  const portNum = loadBrokerFile(registryFile).port ?? DEFAULT_PORT;
  requireStarScope(starScope, registryFile, '--gen-key');
  // 现读目标星（--name 同命令先行改名时 scope 里的对象已陈旧）
  const star = loadBrokerFile(registryFile).stars.find((s) => s.starId === starScope.star!.starId) ?? starScope.star!;
  let results: GenKeyResult[];
  // 033 热路径：经插座由在跑 broker 落钥（唯一写者；node.json 文本里的端口取
  // CLI 侧判定值，与冷路径同源）。冷路径直调同一库函数。
  const outcome = await adminOp(deps, { op: 'gen-key', starId: star.starId!, n, host, port: portNum });
  if (outcome.kind === 'hot') {
    if (!outcome.reply.ok) {
      (deps.stderr ?? deps.stdout)(`发钥失败：${outcome.reply.error ?? '未知错误'}`);
      return 1;
    }
    if (!Array.isArray(outcome.reply.results)) return adminFailed(deps, '管理插座回执缺 results（形状异常）');
    results = outcome.reply.results as GenKeyResult[];
  } else if (outcome.kind === 'failed') return adminFailed(deps, outcome.error);
  else {
    results = genKeysFor(registryFile, star.starId!, n, { host, port: portNum, ...(star.name === undefined ? {} : { name: star.name }) });
  }
  deps.stdout(`自动探测 broker 地址：${host}:${portNum}（多网卡/NAT 常探错——按下述规则人工核对改写 node.json 的 host 与 port）：`);
  deps.stdout('  · broker 机自身 → 无需分发（首次 serve 已自动写好 127.0.0.1 的自用 node.json）');
  deps.stdout('  · broker 是云主机/NAT 内网机 → host 填对外公网 IP（探测常拿内网 IP，必核对）');
  deps.stdout('  · 普通局域网 → broker 机的局域网 IP；broker 用非默认端口时 port 一并改');
  deps.stdout(`分发前把每份 node.json 的 showName 改成「贴这份配置的机器」的自报名字（建议=其 hostname；纯显示用——寻址/回信走 machine-id 前缀）；条目 name=${star.name ?? '（未定名）'} 是星名（broker 权威，连接自动同步，不用改）`);
  deps.stdout(`入星 ${star.name ?? star.starId}：生成 ${results.length} 把钥匙`);
  for (const result of results) {
    deps.stdout('--------------------------------');
    deps.stdout(result.nodeJsonContent.trimEnd());
  }
  deps.stdout('放置路径（目标机器）：~/.crosschat/tcp/node.json（win 写法 C:\\Users\\<用户>\\.crosschat\\tcp\\node.json；入多星把各星条目合并进同一份 brokers 数组）');
  deps.stdout('本命令须在 broker 机上执行（钥匙登记进本机 broker.json）；broker 机自己的 node.json 已由首次 serve 自动写好，勿用上面的钥匙覆盖');
  deps.stdout('钥匙已进入终端回滚缓冲，分发完建议清屏');
  return 0;
}

/**
 * 022/033 --add-star <名>：托管下一颗星。splice 保未知段；033 起自带自登记
 * 播种（star.nodes self 条目 + broker 机 node.json 自用条目），在跑 broker 经
 * 管理插座对账后**即时托管免重启**（内挂聚合器随对账播种）；冷路径（broker
 * 未跑）落盘后 serve 启动即托管。零星机首星同走本命令（显式命名）。
 */
async function runAddStar(name: string, deps: ServeDeps, registryFile: string): Promise<number> {
  const outcome = await adminOp(deps, { op: 'add-star', name });
  if (outcome.kind === 'hot') {
    if (!outcome.reply.ok) {
      (deps.stderr ?? deps.stdout)(`加星失败：${outcome.reply.error ?? '未知错误'}`);
      return 1;
    }
    const count = typeof outcome.reply.stars === 'number' ? outcome.reply.stars : loadBrokerFile(registryFile).stars.length;
    deps.stdout(`已加星 ${name}——本 broker 现托管 ${count} 颗星（经在跑 broker 已生效，免重启；自登记+内挂聚合器随对账落位）`);
  } else if (outcome.kind === 'failed') {
    return adminFailed(deps, outcome.error);
  } else {
    const count = loadBrokerFile(registryFile).stars.length;
    addStarTo(registryFile, name, {
      machineId: deps.machineId(),
      hostname: deps.hostname(),
      port: loadBrokerFile(registryFile).port ?? DEFAULT_PORT,
    });
    deps.stdout(`已加星 ${name}——本 broker 现托管 ${count + 1} 颗星（broker 未在跑——已落盘，serve 启动即托管）`);
  }
  deps.stdout('发钥：crosschat serve --star <星名> --gen-key <n>（星域命令一律须 --star——单星亦然）；查星：crosschat serve --list');
  deps.stdout('注意：多星共用一个 broker 进程——故障域合并（一进程崩=全部星瘫、升级窗口合并），此为已接受的运维代价');
  return 0;
}

/**
 * 033 --remove-star <名|starId前缀>：删整星。执行前打印将死清单（星/机器/成
 * 员数），无 y/n 交互；最后一颗星允许删（零星合法）；册随星葬、钥匙作废、无
 * 墓碑无复活；清理面=broker.json 星段 + broker 机 node.json 自登记条目 +
 * status 刷新；被删星在线连接即断并收"星已删除"教学（node 侧死条目靠教学自清）。
 */
async function runRemoveStar(selector: string, deps: ServeDeps, registryFile: string): Promise<number> {
  const doc = loadBrokerFile(registryFile);
  if (doc.stars.length === 0) {
    deps.stdout('台账零星（无星可删）——加星：crosschat serve --add-star <星名>');
    return 0;
  }
  const star = selectStar(doc.stars, selector); // 名/starId 前缀（零命中/歧义自带教学）
  if (star.starId === undefined) {
    deps.stdout(`星 ${star.name} 缺 starId（手编异常形状）——先跑一次 crosschat serve 自动补 id 再删`);
    return 1;
  }
  deps.stdout(
    `将删除星 ${star.name ?? star.starId}：登记机器 ${star.nodes.length} 台、册内成员 ${star.roster.length} 名——册随星葬、钥匙作废、无墓碑无复活（被删星连接即断）`,
  );
  const outcome = await adminOp(deps, { op: 'remove-star', starId: star.starId! });
  if (outcome.kind === 'hot') {
    if (!outcome.reply.ok) {
      (deps.stderr ?? deps.stdout)(`删星失败：${outcome.reply.error ?? '未知错误'}`);
      return 1;
    }
    deps.stdout(`星 ${star.name ?? star.starId} 已删除（经在跑 broker：连接已断、聚合器已收、status 已刷新）`);
    return 0;
  }
  if (outcome.kind === 'failed') return adminFailed(deps, outcome.error);
  const removed = removeStarFrom(registryFile, star.starId!);
  if (removed === undefined) {
    deps.stdout(`星 ${star.name ?? star.starId} 已不在台账（可能被并发删除）——crosschat serve --list 可查`);
    return 1;
  }
  deps.stdout(`星 ${removed.name ?? star.starId} 已删除（broker 未在跑——台账已落盘；broker 机 node.json 自登记条目已摘）`);
  return 0;
}

/**
 * 033/036 --show-name <名>（仅 broker 机）两形态：裸=全局默认名（node.json
 * 顶层 showName，空串=清除）；--star <星>=条目级覆盖（空串=清覆盖回落全局）。
 * 热路径经插座（重挂聚合器——按星形态只重挂该星、全局形态重挂全部，秒级）；
 * 冷路径直写 node.json（serve 启动生效）。node 机维持手编口径（条目字段同生
 * 效——connect 自报取条目级 ?? 顶层）。
 */
async function runShowName(name: string, deps: ServeDeps, star?: StarRecord): Promise<number> {
  const clean = sanitizeName(name);
  const starId = star?.starId;
  if (star !== undefined && starId === undefined) {
    deps.stdout(`星 ${star.name ?? '?'} 缺 starId（手编异常形状）——先跑一次 crosschat serve 自动补 id 再按星命名`);
    return 1;
  }
  const scope = starId === undefined ? '' : `星 ${star!.name ?? starId} `;
  const outcome = await adminOp(deps, starId === undefined ? { op: 'set-showname', name } : { op: 'set-showname', name, starId });
  if (outcome.kind === 'hot') {
    if (!outcome.reply.ok) {
      (deps.stderr ?? deps.stdout)(`改显示名失败：${outcome.reply.error ?? '未知错误'}`);
      return 1;
    }
    deps.stdout(
      clean === undefined
        ? `${scope}显示名已清除（经在跑 broker——聚合器已重挂，秒级生效）`
        : `${scope}显示名已改为 ${clean}（经在跑 broker——聚合器已重挂，秒级生效）`,
    );
    return 0;
  }
  if (outcome.kind === 'failed') return adminFailed(deps, outcome.error);
  const nodeJson = join(tcpDir(deps.baseDir), 'node.json');
  if (!existsSync(nodeJson)) {
    deps.stdout(`本机尚无 node.json（未入任何星）——先 crosschat serve --add-star <星名> 或入星后再设显示名`);
    return 1;
  }
  if (starId === undefined) setShowNameFor(nodeJson, name);
  else {
    try {
      setStarShowNameFor(nodeJson, starId, name);
    } catch (err) {
      (deps.stderr ?? deps.stdout)(err instanceof Error ? err.message : String(err));
      return 1;
    }
  }
  deps.stdout(
    clean === undefined
      ? `${scope}显示名已清除（node.json——broker 未在跑，serve 启动即生效；节点机改后须重启守护）`
      : `${scope}显示名已改为 ${clean}（node.json——broker 未在跑，serve 启动即生效；节点机改后须重启守护）`,
  );
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
  const doc = loadBrokerFile(registryFile);
  // 034：管理钥条目同表可见（name 列标（星管理钥））——清单永不回显钥匙本体
  const printNodes = (nodes: NodeEntry[]): void => {
    deps.stdout(`${'label'.padEnd(10)}${'name'.padEnd(18)}${'mid8'.padEnd(10)}added-at`);
    for (const node of nodes) {
      const nameCell = node.adminKey !== undefined ? '（星管理钥）' : node.machineName ?? '-';
      deps.stdout(
        `${node.label.padEnd(10)}${nameCell.padEnd(18)}${(node.machineId?.slice(0, 8) ?? '-').padEnd(10)}${node.addedAt}`,
      );
    }
    if (nodes.length === 0) deps.stdout('（注册表为空）');
  };
  if (doc.stars.length === 0) {
    deps.stdout('（台账零星——合法待配状态；首星：crosschat serve --add-star <星名>，serve 永不自动造星）');
    return 0;
  }
  // 022：多星分组展示（只读命令不强制 --star）；单星平铺
  for (const star of doc.stars) {
    if (doc.stars.length > 1) deps.stdout(`=== 星 ${star.name ?? star.starId ?? '(未定名)'} ===`);
    printNodes(star.nodes);
  }
  return 0;
}

async function runRemove(label: string, deps: ServeDeps, registryFile: string, starScope: { star?: StarRecord }): Promise<number> {
  requireStarScope(starScope, registryFile, '--remove <label>');
  const star = starScope.star!;
  // 033：--remove（节点删除）同走插座防直写暗道；冷路径直调库函数
  const outcome = await adminOp(deps, { op: 'remove-node', starId: star.starId!, label });
  if (outcome.kind === 'hot') {
    if (!outcome.reply.ok) {
      (deps.stderr ?? deps.stdout)(`移除失败：${outcome.reply.error ?? '未知错误'}`);
      return 1;
    }
    const removed = outcome.reply.removed === true;
    deps.stdout(removed ? `已从星 ${star.name ?? star.starId} 移除 ${label}（经在跑 broker 已生效）` : `星 ${star.name ?? star.starId} 未找到 ${label}`);
    return removed ? 0 : 1;
  }
  if (outcome.kind === 'failed') return adminFailed(deps, outcome.error);
  const removed = removeNodeFor(registryFile, star.starId!, label);
  deps.stdout(removed ? `已从星 ${star.name ?? star.starId} 移除 ${label}` : `星 ${star.name ?? star.starId} 未找到 ${label}`);
  return removed ? 0 : 1;
}

/**
 * 034 --gen-admin-key <label> --star <星>（仅 broker 主本机）：发星管理钥——
 * 一星一权、发放即绑定该星；热经插座（审计行随发），冷直调库函数。回显一次
 * adminKey 并教"并进目标机 node.json 该星条目"（与星钥同条目）。
 */
async function runGenAdminKey(label: string, deps: ServeDeps, registryFile: string, starScope: { star?: StarRecord }): Promise<number> {
  requireStarScope(starScope, registryFile, '--gen-admin-key <label>');
  const star = loadBrokerFile(registryFile).stars.find((s) => s.starId === starScope.star!.starId) ?? starScope.star!;
  let result: GenAdminKeyResult;
  const outcome = await adminOp(deps, { op: 'gen-admin-key', starId: star.starId!, label });
  if (outcome.kind === 'hot') {
    if (!outcome.reply.ok) {
      (deps.stderr ?? deps.stdout)(`发星管理钥失败：${outcome.reply.error ?? '未知错误'}`);
      return 1;
    }
    const r = outcome.reply.result as GenAdminKeyResult | undefined;
    if (r === undefined || typeof r.adminKey !== 'string') return adminFailed(deps, '管理插座回执缺 result（形状异常）');
    result = r;
    deps.stdout(`已发星管理钥 ${label}（星 ${star.name ?? star.starId}——经在跑 broker 已生效）`);
  } else if (outcome.kind === 'failed') {
    return adminFailed(deps, outcome.error);
  } else {
    result = genAdminKeyFor(registryFile, star.starId!, label);
    deps.stdout(`已发星管理钥 ${label}（星 ${star.name ?? star.starId}——broker 未在跑，已落盘）`);
  }
  deps.stdout('贴钥：把下面一行并进目标机器 node.json 该星条目（与星钥同条目；钥匙永不过线——连接走挑战应答）：');
  deps.stdout(`  "adminKey": "${result.adminKey}"`);
  deps.stdout(`远程管理（目标机器）：crosschat serve --via tcp:${star.name ?? star.starId} --gen-key <n> | --remove <label> | --list-nodes | --list-members`);
  deps.stdout('本命令须在 broker 机上执行（管理钥登记进本机 broker.json）；钥匙已进入终端回滚缓冲，分发完建议清屏');
  return 0;
}

/** 034 --remove-admin-key <label|前缀>（仅 broker 主本机）：吊钥；被吊钥的下一次挑战应答即 BAD_AUTH。 */
async function runRemoveAdminKey(selector: string, deps: ServeDeps, registryFile: string, starScope: { star?: StarRecord }): Promise<number> {
  requireStarScope(starScope, registryFile, '--remove-admin-key <label|前缀>');
  const star = starScope.star!;
  const outcome = await adminOp(deps, { op: 'remove-admin-key', starId: star.starId!, label: selector });
  if (outcome.kind === 'hot') {
    if (!outcome.reply.ok) {
      (deps.stderr ?? deps.stdout)(`吊星管理钥失败：${outcome.reply.error ?? '未知错误'}`);
      return 1;
    }
    deps.stdout(`已吊星管理钥 ${String(outcome.reply.removed)}（星 ${star.name ?? star.starId}——经在跑 broker 已生效，持有者下次连接即 BAD_AUTH）`);
    return 0;
  }
  if (outcome.kind === 'failed') return adminFailed(deps, outcome.error);
  const removed = removeAdminKeyFor(registryFile, star.starId!, selector);
  deps.stdout(removed ? `已吊星管理钥 ${removed}（星 ${star.name ?? star.starId}）` : `星 ${star.name ?? star.starId} 无匹配管理钥 ${selector}`);
  return removed ? 0 : 1;
}

/** 034 --list-nodes（本机冷读；远端形态走 --via）：回显永不带钥匙。 */
function runListNodes(deps: ServeDeps, registryFile: string, starScope: { star?: StarRecord }): number {
  requireStarScope(starScope, registryFile, '--list-nodes');
  const star = starScope.star!;
  const nodes = loadBrokerFile(registryFile).stars.find((s) => s.starId === star.starId)?.nodes ?? star.nodes;
  deps.stdout(`星 ${star.name ?? star.starId} 节点表（${nodes.length} 条；不含钥匙）：`);
  deps.stdout(`${'label'.padEnd(10)}${'name'.padEnd(18)}${'mid8'.padEnd(10)}added-at`);
  for (const node of nodes) {
    const nameCell = node.adminKey !== undefined ? '（星管理钥）' : node.machineName ?? '-';
    deps.stdout(`${node.label.padEnd(10)}${nameCell.padEnd(18)}${(node.machineId?.slice(0, 8) ?? '-').padEnd(10)}${node.addedAt}`);
  }
  return 0;
}

/** 034 --list-members（本机冷读；远端形态走 --via）。 */
function runListMembers(deps: ServeDeps, registryFile: string, starScope: { star?: StarRecord }): number {
  requireStarScope(starScope, registryFile, '--list-members');
  const star = starScope.star!;
  const roster = loadBrokerFile(registryFile).stars.find((s) => s.starId === star.starId)?.roster ?? star.roster;
  deps.stdout(`星 ${star.name ?? star.starId} 成员册（${roster.length} 条）：`);
  for (const e of roster) {
    deps.stdout(
      `  ${e.sessionId.slice(0, 8)} ${e.tool === undefined ? '' : `${e.tool}/`}${e.name ?? '?'} @ ${e.machineName ?? e.machine.slice(0, 8)}${e.online === true ? '（在线）' : ''}`,
    );
  }
  return 0;
}

/**
 * 034 远程管理路由：--via tcp:<星>（条目选择与 --connect 同判定序）。读 op
 * （list-nodes/list-members）星钥即够（成员身份）；写 op（gen-key/remove-node）
 * 需条目 adminKey（星管理员，挑战应答——钥匙永不过线，无降级路径）。
 */
async function runRemoteAdmin(args: ServeArgs, deps: ServeDeps): Promise<number> {
  if (args.connect !== undefined || args.detach) {
    throw new MultichatError('USAGE', '--via tcp:<星> 是一次性远程管理命令，不与 --connect/--detach 连用');
  }
  const via = args.viaArg!;
  if (!via.startsWith('tcp:') || via.slice(4) === '') {
    throw new MultichatError('USAGE', '--via 须为 tcp:<星名|starId前缀> 形态——示例：crosschat serve --via tcp:d32b --list-nodes');
  }
  const action =
    args.genKeyArg !== undefined ? 'gen-key'
      : args.remove !== undefined ? 'remove-node'
        : args.listNodes ? 'list-nodes'
          : args.listMembers ? 'list-members'
            : undefined;
  if (action === undefined) {
    throw new MultichatError('USAGE', '--via tcp:<星> 须与 --gen-key/--remove/--list-nodes/--list-members 连用（远程管理域）');
  }
  const config = readNodeConfig(join(tcpDir(deps.baseDir), 'node.json'));
  const { entry } = selectConnectEntry(via.slice(4), config);
  const url = `ws://${entry.host}:${entry.port}`;
  const timeoutMs = 10_000;
  try {
    if (action === 'list-nodes' || action === 'list-members') {
      // 读 op：星钥=成员身份（读本星）——无需管理钥
      const conn = await SenderConn.open(url, entry.key, undefined, timeoutMs);
      try {
        const r = await requestAdminOp(conn, action, {}, timeoutMs);
        if (action === 'list-nodes') {
          deps.stdout(`星 ${entry.name ?? entry.starId ?? '?'} 节点表（${r.nodes?.length ?? 0} 条；不含钥匙）：`);
          for (const n of r.nodes ?? []) {
            deps.stdout(`  ${n.label.padEnd(10)}${(n.admin === true ? '（星管理钥）' : n.name ?? '-').padEnd(18)}${(n.mid8 ?? '-').padEnd(10)}${n.addedAt}`);
          }
        } else {
          deps.stdout(`星 ${entry.name ?? entry.starId ?? '?'} 成员册（${r.members?.length ?? 0} 条）：`);
          for (const m of r.members ?? []) {
            deps.stdout(`  ${m.sessionId.slice(0, 8)} ${m.tool === undefined ? '' : `${m.tool}/`}${m.name ?? '?'} @ ${m.machineName ?? m.machine.slice(0, 8)}${m.online === true ? '（在线）' : ''}`);
          }
        }
        return 0;
      } finally {
        conn.close();
      }
    }
    // 写 op：星管理员（挑战应答）——条目无 adminKey 即教学找 broker 主
    if (entry.adminKey === undefined) {
      throw new MultichatError(
        'USAGE',
        `本机 node.json 的星 ${entry.name ?? via.slice(4)} 条目无 adminKey（星管理钥）——找 broker 主发放（broker 机 crosschat serve --star <星> --gen-admin-key <label>），把回显的 adminKey 并进该星条目`,
      );
    }
    const conn = await SenderConn.openAdmin(url, entry.adminKey, timeoutMs);
    try {
      if (action === 'gen-key') {
        const n = Number.parseInt(args.genKeyArg!, 10);
        if (!Number.isInteger(n) || n < 1) throw new MultichatError('USAGE', `--gen-key 数量须为 1-10 的整数，收到：${args.genKeyArg}`);
        const r = await requestAdminOp(conn, 'gen-key', { n, host: entry.host }, timeoutMs);
        deps.stdout(`远端发钥（星 ${entry.name ?? '?'}，broker ${url}）：生成 ${r.results?.length ?? 0} 把钥匙`);
        for (const result of r.results ?? []) {
          deps.stdout('--------------------------------');
          deps.stdout(result.nodeJsonContent.trimEnd());
        }
        deps.stdout('放置路径（目标机器）：~/.crosschat/tcp/node.json（入多星把各星条目合并进同一份 brokers 数组）');
        deps.stdout('钥匙已进入终端回滚缓冲，分发完建议清屏');
        return 0;
      }
      const label = args.remove!;
      const r = await requestAdminOp(conn, 'remove-node', { label }, timeoutMs);
      deps.stdout(r.removed === true ? `已从星 ${entry.name ?? '?'} 远端移除 ${label}` : `星 ${entry.name ?? '?'} 未找到 ${label}`);
      return r.removed === true ? 0 : 1;
    } finally {
      conn.close();
    }
  } catch (err) {
    if (err instanceof MultichatError) throw err;
    throw new MultichatError(
      'TCP_TRANSPORT_FAILED',
      `远程管理未达（${err instanceof Error ? err.message : String(err)}）——broker 在跑吗（crosschat serve）？两端 crosschat 都须为 034 挑战应答协议版本`,
    );
  }
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
 * B2.1/022/032：broker 首启自登记（逐星）——每星 self 节点条目（machineId=
 * 本机）落 broker.json + 本机 node.json 对应条目（host=127.0.0.1）。broker
 * 机与其他节点完全同构（mid8/名字可寻址、send --via tcp: 有凭证，零管理员
 * 动作）。036：machineName 逐星刷新——条目级 showName 覆盖、缺省回落顶层全
 * 局值（显式缺失/空=清除；修订 017"单一事实源"）。返回出声行（首写 node.json
 * / foreign 指向提示）。
 */
export function ensureSelfEntries(deps: ServeDeps, registryFile: string, port: number): string[] {
  const mid = deps.machineId();
  if (mid === undefined || mid === '') return [];
  const nodeJson = join(tcpDir(deps.baseDir), 'node.json');
  let entries: BrokerEntry[] = [];
  let showName: string | undefined;
  let existed = true;
  try {
    const config = readNodeConfig(nodeJson);
    entries = config.entries;
    showName = config.showName;
  } catch {
    existed = false;
  }
  const notes: string[] = [];
  const doc = loadBrokerFile(registryFile);
  let regChanged = false;
  let jsonChanged = !existed;
  for (const star of doc.stars) {
    let self = star.nodes.find((n) => n.machineId === mid);
    // 036：机器名按星取——条目级 showName 覆盖，缺省回落顶层全局值（修订 017
    // 单一事实源）。首跑（node.json 尚不存在）视 hostname 为默认——"缺失即
    // 清除"只对已存在的配置生效，否则会把注册表 machineName 误清（首写还没得读）
    const entryShow = self?.key !== undefined ? entries.find((e) => e.key === self!.key)?.showName : undefined;
    const wantName = sanitizeName(entryShow ?? showName ?? (existed ? undefined : deps.hostname()));
    if (self === undefined) {
      self = {
        label: doc.stars.length === 1 ? 'self' : `self-${star.name ?? star.starId ?? 'star'}`,
        key: randomBytes(32).toString('hex'),
        machineId: mid,
        machineName: wantName ?? deps.hostname(),
        addedAt: new Date(deps.now()).toISOString(),
      };
      star.nodes.push(self);
      regChanged = true;
    } else if (self.machineName !== wantName) {
      self.machineName = wantName; // 017：showName 缺省即清除（undefined 落 JSON 省略）
      regChanged = true;
    }
  }
  // foreign/stale 判定（B-fix 语义按"本 broker 钥匙条目"定位）：既存 node.json 无任何
  // 自用钥匙=他星配置（不追加自用条目——本机发送沿用它，只出声）；自用钥匙在但
  // 指向不符=陈旧。多星机已有任一自用钥匙 → 缺的星正常补条目。
  const selfKeys = new Set(doc.stars.flatMap((s) => s.nodes.filter((n) => n.machineId === mid).map((n) => n.key)));
  const foreign = existed && entries.length > 0 && !entries.some((e) => selfKeys.has(e.key));
  let stale = false;
  if (!foreign) {
    for (const star of doc.stars) {
      const self = star.nodes.find((n) => n.machineId === mid)!;
      const mine = entries.find((e) => e.key === self.key);
      if (mine === undefined) {
        // B0/E0 词表：条目 name=星名（broker 权威）、starId 同构、顶层 showName=本机显示名
        // （self 按 machineId 命中——管理钥条目无 machineId，self.key 必在）
        entries.push({
          host: '127.0.0.1',
          port,
          ...(star.name === undefined ? {} : { name: star.name }),
          ...(star.starId === undefined ? {} : { starId: star.starId }),
          key: self.key!,
        });
        jsonChanged = true;
      } else if (mine.host === '127.0.0.1' && mine.port === port) {
        // B1 补 starId / E0 星名同步：broker 自用条目不走节点客户端的 info 同步，在此对齐
        if ((star.name !== undefined && mine.name !== star.name) || (star.starId !== undefined && mine.starId === undefined)) {
          if (star.name !== undefined) mine.name = star.name;
          if (star.starId !== undefined && mine.starId === undefined) mine.starId = star.starId;
          jsonChanged = true;
        }
      } else if (selfKeys.has(mine.key)) {
        stale = true; // 自用钥匙指向别处（陈旧/端口漂移）——只出声不覆写
      }
    }
  }
  if (regChanged) writeBrokerFile(registryFile, doc); // serve 启动期独占写（broker 未起）
  if (jsonChanged) {
    mkdirSync(tcpDir(deps.baseDir), { recursive: true });
    const top: { brokers: BrokerEntry[]; showName?: string } = { brokers: entries };
    if (showName !== undefined) top.showName = showName;
    else if (!existed) top.showName = deps.hostname(); // 首写落个默认显示名
    writeFileSync(nodeJson, `${JSON.stringify(top, null, 2)}\n`, 'utf8');
    if (!existed) notes.push(`已自动生成本机 node.json（${nodeJson}，host=127.0.0.1——本机 send --via tcp: 凭证）`);
  } else if (foreign) {
    const first = entries[0]!;
    notes.push(`检测到 node.json 不含本 broker 的自用钥匙（指向 ${first.host}:${first.port}）——本机 tcp 发送将走它；若本机要自连，移走该文件后重启 serve`);
  } else if (stale) {
    notes.push(`检测到 node.json 的自用条目指向与当前 broker 不符（陈旧或端口漂移）——本机自连发送会失败；删除该文件重启 serve 可重建（${nodeJson}）`);
  }
  return notes;
}

async function runForegroundBroker(deps: ServeDeps): Promise<number> {
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
  // 033：懒 bootstrap 已删（serve 永不造星——零星启动=合法待配）；手编缺 id 兜底保留
  ensureStarIds(registryFile);
  const bootDoc = loadBrokerFile(registryFile);
  const sole = bootDoc.stars.length === 1 ? bootDoc.stars[0] : undefined;
  // B1：broker 自投递签发的 ref 盖注册表星标识（与 gen-key 分发的钥匙同源；
  // 多星下按发送方连接的属星盖——deliverLocal 第三参；sole 缺省兜底=单星）
  const registryStarId = sole?.starId;
  // 024 方案3：broker 自投递的信封正向坐标星段（E0 缺省轨道）。
  const registryStarName = sole?.name;
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
  // B2.1/022：起服务前逐星自登记（本机=每星全权成员，mid8/名字可寻址 + 本机
  // node.json）。后台子进程不重复出声——父进程 spawn 前已向控制台播报过。
  // 034：监听口=broker.json 手编 port（--port 旗标已删），缺省 DEFAULT_PORT。
  const effectivePort = bootDoc.port ?? DEFAULT_PORT;
  const selfNotes = ensureSelfEntries(deps, registryFile, effectivePort);
  if (!detached) {
    for (const line of selfNotes) deps.stdout(line);
    if (bootDoc.stars.length === 0) {
      deps.stdout('零星待配（合法状态——serve 永不自动造星）——首星：crosschat serve --add-star <星名>（显式命名，免 hostname 丑名）');
    }
    if (bootDoc.stars.length > 1) deps.stdout(`本 broker 托管 ${bootDoc.stars.length} 颗星（一进程一端口；故障域合并为已接受代价）`);
  }
  // 033：内挂聚合器宿主（拆自 032 bootstrapLocalAggregators）——热加星经管理
  // 插座对账后由 broker 回调 spawn 播种、删星 stop 收尾。宿主需 broker（虚拟
  // 会话对 admitLocal），broker 亦需宿主回调——经可变 ref 接线（构造后即定，
  // 插座受理必在 start 之后，无窗口）。
  const aggregatorRef: { spawn?: (starId: string) => void; stop?: (starId: string) => Promise<void> } = {};
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
    resultTimeoutMs: readResultTimeoutMs(deps.env),
    spawnLocalAggregator: (starId) => aggregatorRef.spawn?.(starId),
    stopLocalAggregator: (starId) => aggregatorRef.stop?.(starId) ?? Promise.resolve(),
  });
  const aggregatorHost = makeAggregatorHost(deps, broker, logLine);
  aggregatorRef.spawn = aggregatorHost.spawn;
  aggregatorRef.stop = aggregatorHost.stop;
  const actual = await broker.start();
  deps.stdout(`broker listening on 0.0.0.0:${actual}（Ctrl+C 退出）`);
  // 022 自挂（方向 3）：每颗托管星起本进程聚合器——attach 管道/成员表/对账循环
  // 全在 broker 进程内（虚拟会话对走真实 onConnect/路由代码路径），省回环 WS 与
  // 第二个常驻进程；本机已有同星外部守护（serve --connect）则让位跳过——升级
  // 窗口平滑接管且永不成 F4 双连形态。
  for (const star of loadBrokerFile(registryFile).stars) {
    if (star.starId !== undefined) aggregatorHost.spawn(star.starId);
  }
  await new Promise<void>((resolve) => {
    const stop = () => {
      void aggregatorHost
        .stopAll()
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
 * 033：内挂聚合器宿主——每托管星一个 NodeClient + 虚拟会话对。拆自 032 的
 * bootstrapLocalAggregators 以支持热加/删星：spawn(starId) 播种（含外部守护
 * 让位判定：本机进程扫描见同星 serve --connect 在跑即让位，守护 cmdline 选择
 * 器对同一份 node.json 归一比对，与 guardSameStarDaemon 同一解析序）、
 * stop(starId) 收尾。spawn 幂等（已挂/未登记/让位形态静默跳过）。
 */
function makeAggregatorHost(
  deps: ServeDeps,
  broker: Broker,
  logLine: (line: string) => void,
): { spawn(starId: string): void; stop(starId: string): Promise<void>; stopAll(): Promise<void> } {
  const registryFile = registryFileOf(deps.baseDir);
  const nodeJson = join(tcpDir(deps.baseDir), 'node.json');
  const clients = new Map<string, NodeClient>();
  const spawn = (starId: string): void => {
    if (deps.makeSendDeps === undefined) return; // 测试环境未接线——不挂（032 同款）
    if (clients.has(starId)) return;
    const star = loadBrokerFile(registryFile).stars.find((s) => s.starId === starId);
    if (star === undefined) return;
    let config: NodeConfig;
    try {
      config = readNodeConfig(nodeJson);
    } catch {
      return; // 自登记未落定（异常形态）——不挂，星册操作照常
    }
    const entry = config.entries.find((e) => e.starId === starId && e.host === '127.0.0.1');
    if (entry === undefined) return; // 该星自登记条目缺失（未自登记等）
    let procs: ProcInfo[] = [];
    try {
      procs = (deps.listServeProcesses ?? listServeProcesses)();
    } catch {
      // 扫描失败=探测不到外部守护——照常自挂（顶换语义兜底）
    }
    const external = procs.find((p) => {
      if (!p.cmdline.includes('--connect')) return false;
      try {
        return selectConnectEntry(connectValueOf(p.cmdline) ?? '', config).entry.starId === starId;
      } catch {
        return false;
      }
    });
    if (external !== undefined) {
      logLine(`自挂跳过星 ${star.name ?? star.starId}：本机已有外部 serve --connect 守护（pid ${external.pid}）——让位防同 mid 双连；建议 crosschat serve --stop 后由 broker 统一内挂`);
      return;
    }
    const label = entry.name ?? starId;
    const client = new NodeClient({
      config: { entries: [entry], ...(config.showName === undefined ? {} : { showName: config.showName }) },
      configFile: nodeJson,
      machineId: deps.machineId,
      // 032：内挂聚合器不写 status-node（非独立进程，broker 行同 pid 全覆盖）
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
    clients.set(starId, client);
    logLine(`本进程聚合器上线：星 ${label}（attach 管道/成员表/对账循环随 broker 常驻）`);
    void client.run();
  };
  const stop = async (starId: string): Promise<void> => {
    const client = clients.get(starId);
    clients.delete(starId);
    if (client !== undefined) await client.stop().catch(() => {});
  };
  return {
    spawn,
    stop,
    stopAll: async () => {
      await Promise.all([...clients.keys()].map((id) => stop(id)));
    },
  };
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
    const port = loadBrokerFile(registryFile).port ?? DEFAULT_PORT;
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
