import type { DiagnosticCheck, DiagnosticCode, DiagnosticGroup, DiagnosticResult } from './model.js';

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

const labels: Record<DiagnosticCode, string> = {
  'node-supported': 'Node 版本', 'node-unsupported': 'Node 版本', 'claude-ready': 'Claude 可路由会话', 'claude-empty': 'Claude 可路由会话',
  'claude-missing': 'Claude CLI', 'claude-registry-malformed': 'Claude 注册表', 'codex-missing': 'Codex CLI', 'codex-unparsed': 'Codex CLI 版本',
  'codex-cli-old': 'Codex CLI 版本', 'codex-cli-ready': 'Codex CLI 版本', 'codex-daemon-missing': 'Codex daemon', 'codex-daemon-old': 'Codex daemon 版本', 'codex-daemon-ready': 'Codex daemon 版本',
  'skill-missing': '工具技能', 'skill-installed': '工具技能', 'skill-match': '工具技能', 'skill-mismatch': '工具技能', 'identity-conflict': '调用身份', 'identity-clear': '调用身份',
  'node-config-invalid': '节点配置', 'node-config-ready': '节点配置', 'node-star-id-missing': '星身份', 'node-star-id-duplicate': '星身份',
  'broker-reachable': 'broker 连通性', 'broker-unreachable': 'broker 连通性', 'broker-empty': 'broker 星配置', 'broker-ready': 'broker 注册表', 'broker-port-custom': 'broker 监听口', 'broker-invalid': 'broker 注册表',
  'status-stale': '状态文件时效', 'status-process-unavailable': '状态进程证据', 'resident-version-mismatch': '常驻版本', 'outbox-empty': '发件箱', 'outbox-parked': '发件箱暂存',
};

/** Pure per-check explanation; legacy whole-report formatting remains unchanged. */
export function formatDiagnosticCheck(check: DiagnosticCheck): { label: string; description: string; guidance: string } {
  let guidance = '此检查无需处理；需要时在当前机器重新运行体检。';
  switch (check.code) {
    case 'node-unsupported': guidance = '在当前机器安装 Node.js 22 或更高版本，再重新运行 crosschat doctor。'; break;
    case 'claude-empty': guidance = '在当前机器用 crosschat claude 启动需要接收消息的原生会话，再刷新。'; break;
    case 'claude-missing': guidance = '需要 Claude 通道时在当前机器安装 Claude Code；仅使用 Codex 时可忽略。'; break;
    case 'claude-registry-malformed': guidance = '检查当前机器的 Claude 会话注册表写入方；不自动删除损坏条目。'; break;
    case 'codex-missing': case 'codex-daemon-missing': guidance = '需要 Codex 通道时先确认已安装 Codex CLI，再由用户在当前机器执行：codex app-server daemon start'; break;
    case 'codex-unparsed': case 'codex-cli-old': case 'codex-daemon-old': guidance = '在当前机器核对 Codex CLI 与 daemon 版本；按原生工具的升级和重启指引处理后重新体检。'; break;
    case 'skill-missing': case 'skill-mismatch': guidance = '由用户在当前机器执行：crosschat install-skills'; break;
    case 'identity-conflict': guidance = '在当前机器核对 Claude/Codex 调用身份环境；清理不属于当前调用方的身份变量后重新运行命令。'; break;
    case 'node-config-invalid': guidance = '检查当前机器的 node.json；向该星管理员索取正确配置，确认后显式覆盖。'; break;
    case 'node-star-id-missing': case 'node-star-id-duplicate': guidance = '核对当前机器配置中的完整星 ID 与目标；消除缺失或重复绑定后重新体检。'; break;
    case 'broker-unreachable': guidance = '在 broker 所在机器确认 crosschat serve 已运行，并核对配置端口、网络与防火墙。'; break;
    case 'broker-empty': guidance = '本机 broker 零星是合法待配状态；需要新增星时由用户执行：crosschat serve --add-star <星名>'; break;
    case 'broker-port-custom': guidance = '核对 broker.json 顶层 port；如需修改，由用户确认后编辑并显式重启 broker。'; break;
    case 'broker-invalid': guidance = '在当前机器检查 broker.json 的格式；先核对来源，不自动修复或重发钥匙。'; break;
    case 'status-stale': case 'status-process-unavailable': guidance = '核对当前机器的服务与进程；状态文件不能单独证明服务仍在运行。'; break;
    case 'resident-version-mismatch': {
      const command = check.data.restartCommand;
      guidance = /^(?:crosschat )?serve --stop && (?:crosschat )?serve --detach$/.test(command)
        ? '确认本机 broker 影响后，由用户执行：crosschat serve --stop && crosschat serve --detach'
        : /^crosschat serve --connect(?: [A-Za-z0-9._-]+)? --detach$/.test(command)
          ? `确认本机目标守护后，由用户执行：${command}`
          : '在当前机器核对所列常驻版本，确认目标与影响后显式重启对应服务。';
      break;
    }
    case 'outbox-parked': guidance = `在当前机器查看暂存镜像：${check.data.mailboxFile}；查看不会重新发送消息，结果不明时不要盲目重发。`; break;
  }
  return { label: labels[check.code], description: checkLine(check), guidance };
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
