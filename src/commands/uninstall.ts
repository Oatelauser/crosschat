/**
 * `crosschat uninstall`（票B B3，014 双院清扫）：删除本机 crosschat 数据面
 * ——~/.crosschat（注册表/node.json/status/log/inbox/parts + 014 起的状态
 * outbox/send-log/conversations/mailbox）+ 旧院 best-effort（win
 * %LOCALAPPDATA%\crosschat、unix ~/crosschat 无点）+ 双侧 skill。serve 在跑
 * 时拒删（教 --stop）；无 --yes 先打将删清单请求 stdin y/n；结尾提示 npm
 * uninstall 收尾。
 */
import { removeUninstallTargets, uninstallServeRunning, uninstallTargets } from '../application/maintenance/uninstall.js';

export interface UninstallArgs {
  yes?: boolean;
}

export interface UninstallDeps {
  /** ~/.crosschat（tcp 注册表/状态/收件 + 014 起的状态目录全在内）。 */
  crosschatHome: string;
  /** 状态目录：014 起＝~/.crosschat（与 crosschatHome 同根，清单自动去重）。 */
  stateRoot: string;
  /** 014 前的旧院路径（win %LOCALAPPDATA%\crosschat、unix ~/crosschat）：best-effort 连删。 */
  legacyStateRoots: string[];
  /** 双侧 skill 目录：[claude, codex]。 */
  skillDirs: string[];
  now(): number;
  stdout(line: string): void;
  /** 真实实现=交互问 y/n；测试注入。 */
  confirm(): Promise<boolean>;
}

export async function runUninstall(args: UninstallArgs, deps: UninstallDeps): Promise<number> {
  if (uninstallServeRunning(deps)) {
    deps.stdout('拒绝删除：crosschat serve 正在运行（broker 或节点客户端）——先跑 crosschat serve --stop 再卸载');
    return 1;
  }
  const deduped = uninstallTargets(deps);
  deps.stdout('将删除：');
  for (const [i, item] of deduped.entries()) deps.stdout(`  ${i + 1}. ${item.path}（${item.label}）`);
  if (args.yes !== true) {
    const ok = await deps.confirm();
    if (!ok) {
      deps.stdout('已取消，未删除任何内容');
      return 1;
    }
  }
  removeUninstallTargets(deduped, { onItem(item) {
    deps.stdout(item.outcome === 'deleted' ? `已删除：${item.target.path}`
      : item.outcome === 'failed' ? `删除失败（稍后手动删）：${item.target.path}` : `跳过（不存在）：${item.target.path}`);
  } });
  deps.stdout('收尾：npm uninstall -g @oatelauser/crosschat');
  return 0;
}
