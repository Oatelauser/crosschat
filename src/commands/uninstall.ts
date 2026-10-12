/**
 * `crosschat uninstall`（票B B3）：删除本机 crosschat 数据面——~/.crosschat
 * （注册表/node.json/status/log/inbox/parts）+ 状态目录（outbox/rate/send-log/
 * conversations/mailbox）+ 双侧 skill。serve 在跑时拒删（教 --stop）；
 * 无 --yes 先打将删清单请求 stdin y/n；结尾提示 npm uninstall 收尾。
 */
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { TCP_STATUS_FRESH_MS } from './status.js';

export interface UninstallArgs {
  yes?: boolean;
}

export interface UninstallDeps {
  /** ~/.crosschat（tcp 注册表/状态/收件全在内）。 */
  crosschatHome: string;
  /** 状态目录：win %LOCALAPPDATA%\crosschat、unix ~/crosschat。 */
  stateRoot: string;
  /** 双侧 skill 目录：[claude, codex]。 */
  skillDirs: string[];
  now(): number;
  stdout(line: string): void;
  /** 真实实现=交互问 y/n；测试注入。 */
  confirm(): Promise<boolean>;
}

function readStatusState(file: string): { state: string; lastUpdated: string } | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as { state: string; lastUpdated: string };
  } catch {
    return undefined;
  }
}

/** serve 在跑检测：status-broker 或任一 status-node*.json（B2 多守护）新鲜即算（与 status 展示同款口径）。 */
function serveRunning(deps: UninstallDeps): boolean {
  const tcp = join(deps.crosschatHome, 'tcp');
  const broker = readStatusState(join(tcp, 'status-broker.json'));
  if (broker !== undefined && broker.state === 'running' && deps.now() - Date.parse(broker.lastUpdated) < TCP_STATUS_FRESH_MS) {
    return true;
  }
  let nodeFiles: string[] = [];
  try {
    nodeFiles = readdirSync(tcp).filter((f) => /^status-node.*\.json$/.test(f));
  } catch {
    return false;
  }
  return nodeFiles.some((f) => {
    const node = readStatusState(join(tcp, f));
    return node !== undefined && deps.now() - Date.parse(node.lastUpdated) < TCP_STATUS_FRESH_MS;
  });
}

export async function runUninstall(args: UninstallArgs, deps: UninstallDeps): Promise<number> {
  if (serveRunning(deps)) {
    deps.stdout('拒绝删除：crosschat serve 正在运行（broker 或节点客户端）——先跑 crosschat serve --stop 再卸载');
    return 1;
  }
  const items = [
    { label: 'crosschat 配置与转发器（broker.json/node.json/status/log/inbox/parts）', path: deps.crosschatHome },
    { label: '状态目录（outbox/rate/send-log/conversations/mailbox）', path: deps.stateRoot },
    { label: 'claude 侧 skill', path: deps.skillDirs[0] ?? '' },
    { label: 'codex 侧 skill', path: deps.skillDirs[1] ?? '' },
  ];
  deps.stdout('将删除：');
  for (const [i, item] of items.entries()) deps.stdout(`  ${i + 1}. ${item.path}（${item.label}）`);
  if (args.yes !== true) {
    const ok = await deps.confirm();
    if (!ok) {
      deps.stdout('已取消，未删除任何内容');
      return 1;
    }
  }
  for (const item of items) {
    if (item.path !== '' && existsSync(item.path)) {
      try {
        rmSync(item.path, { recursive: true, force: true });
        deps.stdout(`已删除：${item.path}`);
      } catch {
        deps.stdout(`删除失败（稍后手动删）：${item.path}`);
      }
    } else {
      deps.stdout(`跳过（不存在）：${item.path}`);
    }
  }
  deps.stdout('收尾：npm uninstall -g @oatelauser/crosschat');
  return 0;
}
