import type { DiagnosticCheck, DiagnosticGroup, DiagnosticResult } from './model.js';

export interface DoctorReport {
  output: string;
  /** True iff an existing check failed: the legacy CLI exits 1. */
  failed: boolean;
}

function groupTitle(context: DiagnosticGroup): string {
  if (context.kind === 'environment') return '环境';
  if (context.kind === 'other') return '其他';
  return context.star === undefined ? 'tcp' : `tcp · ${context.star}`;
}

function checkLine(check: DiagnosticCheck): string {
  switch (check.code) {
    case 'node-supported': return `✅ Node v${check.data.version} (≥22)`;
    case 'node-unsupported': return `❌ Node v${check.data.version || '?'}（需 ≥22）`;
    case 'claude-ready': return `✅ claude CLI ${check.data.executable}；可路由会话 ${check.data.count} 个`;
    case 'claude-empty': return `⚠️ claude CLI 可解析（${check.data.executable}），但当前无可路由会话（crosschat claude 启动的会话才可接收）`;
    case 'claude-missing': return '⚠️ claude CLI 未安装——纯 codex 互聊可忽略；需要 claude 会话时安装后重跑 doctor';
    case 'claude-registry-malformed': return `⚠️ claude 注册表 ${check.data.count} 个损坏条目（已忽略）`;
    case 'codex-missing': return '⚠️ codex CLI 未安装——纯 claude 互聊可忽略；需要 codex 会话时安装并运行: codex app-server daemon start';
    case 'codex-unparsed': return `⚠️ codex CLI 存在，但版本无法解析：${check.data.firstLine || `(exit ${check.data.status ?? 'null'})`}`;
    case 'codex-cli-old': return `⚠️ codex CLI ${check.data.version}（<0.160.0：开窗投递需升级）`;
    case 'codex-cli-ready': return `✅ codex CLI ${check.data.version}`;
    case 'codex-daemon-missing': return '⚠️ codex daemon 未运行；要用 codex 通道时先执行: codex app-server daemon start';
    case 'codex-daemon-old': return `⚠️ codex daemon ${check.data.version}（<0.160.0：开窗投递需升级后重启 daemon）`;
    case 'codex-daemon-ready': return `✅ codex daemon ${check.data.version}`;
    case 'skill-missing': return `⚠️ ${check.data.side} 侧 skill 未安装（${check.data.path}）；运行 crosschat install-skills`;
    case 'skill-installed': return `✅ ${check.data.side} 侧 skill 已安装（安装源 skill 目录未定位到，跳过版本比对）`;
    case 'skill-match': return `✅ ${check.data.side} 侧 skill 与安装源一致`;
    case 'skill-mismatch': return `⚠️ ${check.data.side} 侧 skill 与安装源不一致（${check.data.paths.slice(0, 3).join('、')}）；重跑 crosschat install-skills`;
    case 'identity-conflict': return '⚠️ 双身份残留：CLAUDE_CODE_* 与 CODEX_* 并存（CALLER_IDENTITY_CONFLICT 风险）；'
      + '临时自纠: env -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN -u CLAUDE_CODE_SESSION_ID <命令>';
    case 'identity-clear': return '✅ 无双身份残留';
    case 'node-config-invalid': return `❌ tcp 节点配置 node.json 损坏或缺钥字段（${check.data.path}）——向管理员重新索取 node.json 覆盖`;
    case 'node-config-ready': return '✅ 节点条目可解析';
    case 'node-star-id-missing': return `⚠️ 条目 ${check.data.label} 缺 starId（旧配置——连一次自动回填或重新索取 node.json）`;
    case 'node-star-id-duplicate': return `⚠️ 条目 ${check.data.first} 与 ${check.data.label} 的 starId 相同（${check.data.starId}）——疑似同一星配了两次`;
    case 'broker-reachable': return `✅ broker 可达（${check.data.host}:${check.data.port}）`;
    case 'broker-unreachable': return `❌ broker 不可达（${check.data.host}:${check.data.port}）——确认 broker 机 crosschat serve 在跑、网络/防火墙放行端口`;
    case 'broker-empty': return '⚠️ broker.json 零星（合法待配状态——serve 永不自动造星）——首星：crosschat serve --add-star <星名>';
    case 'broker-ready': return `✅ broker 注册表可解析（${check.data.stars} 星 ${check.data.nodes} 节点）`;
    case 'broker-port-custom': return `⚠️ broker 监听口 ${check.data.port} 非默认 ${check.data.defaultPort}——端口是 broker.json 手编字段（--port 命令已移除）：改 ${check.data.path} 顶层 "port" 后重启 crosschat serve 生效；首启非默认口=先手写 broker.json（{"port": <N>, "stars": []}）再 serve`;
    case 'broker-invalid': return '❌ broker 注册表 broker.json 损坏或字段缺失——crosschat serve --list 核对，必要时重发钥匙';
    case 'status-stale': return `ℹ️ 陈旧状态文件（守护已停止）跳过版本对账：${check.data.file}——确认无用后可删除`;
    case 'status-process-unavailable': return `ℹ️ 新鲜状态文件但${check.data.pid === undefined ? '无 pid 可验活' : `pid ${check.data.pid} 不存活`}（守护已停止）跳过版本对账：${check.data.file}`;
    case 'resident-version-mismatch': return `⚠️ 常驻进程（${check.data.label}）为 v${check.data.version}，本机 v${check.data.cliVersion}——升级后未重启：${check.data.restartCommand}`;
    case 'outbox-empty': return '✅ 发件箱空（无暂存消息）';
    case 'outbox-parked': return `⏳ 线程 ${check.data.threadId.slice(0, 8)} 暂存 ${check.data.count} 条${check.data.ageMinutes === undefined ? '' : `，最旧 ${check.data.ageMinutes} 分钟`}（看门狗${check.data.watchdogRunning ? '运行中' : '未运行'}；滞留内容: ${check.data.mailboxFile}）`;
  }
}

/** Byte-compatible grouped CLI text; no probe or filesystem access. */
export function renderDoctorDiagnostics(result: DiagnosticResult): DoctorReport {
  const ordered = result.groups.filter((group) => group.context.kind !== 'other')
    .concat(result.groups.filter((group) => group.context.kind === 'other'));
  const lines: string[] = [];
  for (const group of ordered) {
    if (group.checks.length === 0) continue;
    lines.push(groupTitle(group.context), ...group.checks.map((check) => `  ${checkLine(check)}`));
  }
  const { pass, warn, error, failed } = result.summary;
  lines.push(`结论: ${pass} 项通过，${warn} 项警告，${error} 项错误`);
  return { output: lines.join('\n'), failed };
}
