import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FILE_STALE_MS, INBOX_MAX_BYTES } from '../../serve/file-channel.js';

/** Keep the CLI's existing thirty-day conversation-shard retention rule. */
export const SHARD_STALE_MS = 30 * 24 * 3_600_000;

export interface CleanupArgs {
  force?: boolean;
}

export interface CleanupDeps {
  tcpDir: string;
  conversationsDir: string;
  now(): number;
  staleMs?: number;
  maxInboxBytes?: number;
  shardStaleMs?: number;
}

export type CleanupReason = 'expired' | 'inbox-capacity' | 'shard-expired' | 'force';
export type CleanupArea = 'inbox' | 'parts' | 'shard';

interface Entry {
  file: string;
  mtime: number;
  size: number;
  area: CleanupArea;
}

export interface CleanupTarget extends Entry {
  reason: CleanupReason;
}

export interface CleanupPlan {
  mode: 'force' | 'retention';
  counts: { inbox: number; parts: number; shards: number };
  /** Force-mode announcement counts inbox and parts bytes, excluding shards. */
  inboxAndPartsBytes: number;
  targets: readonly CleanupTarget[];
}

export interface CleanupItemResult {
  file: string;
  target: CleanupTarget;
  deleted: boolean;
  error?: { message: string };
}

export interface CleanupResult {
  items: readonly CleanupItemResult[];
  /** Candidate count, preserving the legacy CLI summary even on remove failure. */
  plannedCount: number;
  /** Force mode excludes shard bytes, as the existing CLI does. */
  freedBytes: number;
}

export interface CleanupExecutionDeps {
  remove?(file: string): void;
  /** CLI presentation callback; invoked after each removal attempt. */
  onItem?(item: CleanupItemResult): void;
}

function listEntries(dir: string, area: CleanupArea): Entry[] {
  if (!existsSync(dir)) return [];
  const out: Entry[] = [];
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    try {
      const stat = statSync(file);
      out.push({ file, mtime: stat.mtimeMs, size: stat.size, area });
    } catch {
      // Preserve the existing race/unreadable-stat skip behavior.
    }
  }
  return out;
}

/** Read-only preview. It neither deletes files nor creates missing directories. */
export function planCleanup(args: CleanupArgs, deps: CleanupDeps): CleanupPlan {
  const inbox = listEntries(join(deps.tcpDir, 'inbox'), 'inbox');
  const parts = listEntries(join(deps.tcpDir, 'parts'), 'parts');
  const shards = listEntries(deps.conversationsDir, 'shard').filter((entry) => entry.file.endsWith('.json'));
  const all = [...inbox, ...parts];
  const plan: CleanupPlan = {
    mode: args.force === true ? 'force' : 'retention',
    counts: { inbox: inbox.length, parts: parts.length, shards: shards.length },
    inboxAndPartsBytes: all.reduce((sum, entry) => sum + entry.size, 0),
    targets: [],
  };
  if (args.force === true) {
    return { ...plan, targets: [...all, ...shards].map((entry) => ({ ...entry, reason: 'force' })) };
  }

  const cutoff = deps.now() - (deps.staleMs ?? FILE_STALE_MS);
  const shardCutoff = deps.now() - (deps.shardStaleMs ?? SHARD_STALE_MS);
  const targets: CleanupTarget[] = [];
  for (const entry of all) {
    if (entry.mtime < cutoff) targets.push({ ...entry, reason: 'expired' });
  }
  const liveInbox = inbox.filter((entry) => entry.mtime >= cutoff).sort((a, b) => a.mtime - b.mtime);
  let total = liveInbox.reduce((sum, entry) => sum + entry.size, 0);
  for (const entry of liveInbox) {
    if (total <= (deps.maxInboxBytes ?? INBOX_MAX_BYTES)) break;
    total -= entry.size;
    targets.push({ ...entry, reason: 'inbox-capacity' });
  }
  for (const entry of shards) {
    if (entry.mtime < shardCutoff) targets.push({ ...entry, reason: 'shard-expired' });
  }
  return { ...plan, targets };
}

/** Execute exactly this preview's targets; do not rescan or silently expand it. */
export function executeCleanup(plan: CleanupPlan, deps: CleanupExecutionDeps = {}): CleanupResult {
  const remove = deps.remove ?? ((file: string) => rmSync(file, { force: true }));
  const items: CleanupItemResult[] = [];
  let freedBytes = 0;
  for (const target of plan.targets) {
    let item: CleanupItemResult;
    try {
      remove(target.file);
      if (plan.mode !== 'force' || target.area !== 'shard') freedBytes += target.size;
      item = { file: target.file, target, deleted: true };
    } catch (error) {
      item = {
        file: target.file, target, deleted: false,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
    items.push(item);
    deps.onItem?.(item);
  }
  return { items, plannedCount: plan.targets.length, freedBytes };
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

const REASON_TEXT: Record<CleanupReason, string> = {
  expired: '超 5 天',
  'inbox-capacity': '超总量从最旧删起',
  'shard-expired': '分片 30 天未更新',
  force: '',
};

/** Render before execution so the force announcement keeps its original order. */
export function cleanupOpeningLine(plan: CleanupPlan): string | undefined {
  const { inbox, parts, shards } = plan.counts;
  if (plan.targets.length === 0) {
    return plan.mode === 'force'
      ? '无需清理：inbox 与 parts 均为空，也无 conversations 分片'
      : `无需清理：inbox ${inbox} 项 / parts ${parts} 项 / conversations 分片 ${shards} 片均在保留规则内`;
  }
  if (plan.mode === 'force') {
    return `强制清理：将删除全部收件与断点文件（${inbox + parts} 项，共 ${mb(plan.inboxAndPartsBytes)} MB）`
      + `及全部 conversations 分片（${shards} 片）`;
  }
  return undefined;
}

export function cleanupItemLine(plan: CleanupPlan, item: CleanupItemResult): string {
  if (!item.deleted) return `删除失败 ${item.file}`;
  const target = item.target;
  if (plan.mode === 'force') {
    return target.area === 'shard'
      ? `已删 ${target.file}（conversations 分片）`
      : `已删 ${target.file}（${mb(target.size)} MB）`;
  }
  return `已删 ${target.file}（${mb(target.size)} MB，${REASON_TEXT[target.reason]}）`;
}

export function cleanupClosingLine(plan: CleanupPlan, result: CleanupResult): string | undefined {
  if (plan.targets.length === 0) return undefined;
  const count = plan.mode === 'force' ? plan.counts.inbox + plan.counts.parts : result.plannedCount;
  const shards = plan.targets.filter((target) => target.area === 'shard').length;
  return `清理完成：删除 ${count} 项，释放 ${mb(result.freedBytes)} MB；回收 conversations 分片 ${shards} 片`;
}

export function renderCleanup(plan: CleanupPlan, result: CleanupResult): string[] {
  const opening = cleanupOpeningLine(plan);
  const closing = cleanupClosingLine(plan, result);
  return [
    ...(opening === undefined ? [] : [opening]),
    ...result.items.map((item) => cleanupItemLine(plan, item)),
    ...(closing === undefined ? [] : [closing]),
  ];
}
