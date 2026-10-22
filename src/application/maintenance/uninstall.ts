import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { TCP_STATUS_FRESH_MS } from '../status/status-files.js';

export interface UninstallEnvironment {
  crosschatHome: string;
  stateRoot: string;
  legacyStateRoots: string[];
  skillDirs: string[];
  now(): number;
}
export interface UninstallTarget { label: string; path: string }
export interface UninstallItem { target: UninstallTarget; outcome: 'deleted' | 'skipped' | 'failed' }
function readStatusState(file: string): { state: string; lastUpdated: string } | undefined {
  try { return JSON.parse(readFileSync(file, 'utf8')) as { state: string; lastUpdated: string }; }
  catch { return undefined; }
}
/** Same snapshot freshness rules as the existing uninstall command. */
export function uninstallServeRunning(deps: UninstallEnvironment): boolean {
  const tcp = join(deps.crosschatHome, 'tcp');
  const broker = readStatusState(join(tcp, 'status-broker.json'));
  if (broker !== undefined && broker.state === 'running' && deps.now() - Date.parse(broker.lastUpdated) < TCP_STATUS_FRESH_MS) return true;
  let files: string[];
  try { files = readdirSync(tcp).filter((file) => /^status-node.*\.json$/.test(file)); }
  catch { return false; }
  return files.some((file) => {
    const node = readStatusState(join(tcp, file));
    return node !== undefined && deps.now() - Date.parse(node.lastUpdated) < TCP_STATUS_FRESH_MS;
  });
}
/** Preserve the command's ordered scope and exact-string deduplication. */
export function uninstallTargets(deps: UninstallEnvironment): UninstallTarget[] {
  const items = [
    { label: 'crosschat 配置、转发器与状态（tcp 注册表/status/log/inbox/parts + outbox/send-log/conversations/mailbox）', path: deps.crosschatHome },
    { label: '状态目录（outbox/send-log/conversations/mailbox）', path: deps.stateRoot },
    ...deps.legacyStateRoots.map((path) => ({ label: '旧版状态目录（014 前路径）', path })),
    { label: 'claude 侧 skill', path: deps.skillDirs[0] ?? '' },
    { label: 'codex 侧 skill', path: deps.skillDirs[1] ?? '' },
  ];
  const seen = new Set<string>();
  return items.filter((item) => {
    if (item.path === '' || seen.has(item.path)) return false;
    seen.add(item.path); return true;
  });
}
/** Execute the exact declared directories and return actual per-target outcomes. */
export function removeUninstallTargets(targets: readonly UninstallTarget[], options: {
  remove?(file: string, recursive: boolean): void;
  onItem?(item: UninstallItem): void;
} = {}): UninstallItem[] {
  const remove = options.remove ?? ((file: string, recursive: boolean) => rmSync(file, { recursive, force: true }));
  return targets.map((target): UninstallItem => {
    let outcome: UninstallItem['outcome'];
    if (target.path !== '' && existsSync(target.path)) {
      try { remove(target.path, true); outcome = 'deleted'; }
      catch { outcome = 'failed'; }
    } else outcome = 'skipped';
    const item = { target, outcome };
    options.onItem?.(item); return item;
  });
}
