import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

/**
 * 014：状态目录全平台统一 `~/.crosschat`（与 tcp 组件同根，不再看
 * LOCALAPPDATA）。旧散装解析（win `%LOCALAPPDATA%\crosschat`、unix
 * `~/crosschat` 无点）零迁移零双读——用户拍板老数据废弃，改门牌即换。
 */
export function stateRoot(home: string = homedir()): string {
  return join(home, '.crosschat');
}

/**
 * 014 前的旧院路径：仅 uninstall best-effort 清扫用，任何读写路径都不得
 * 再引用。homedir 无点目录恒在列；LOCALAPPDATA 在场（win）再加一份，Set 去重。
 */
export function legacyStateRoots(
  home: string = homedir(),
  env: Record<string, string | undefined> = process.env,
): string[] {
  const roots = new Set([join(home, 'crosschat')]);
  const local = env.LOCALAPPDATA;
  if (local !== undefined && local !== '') roots.add(join(local, 'crosschat'));
  return [...roots];
}
