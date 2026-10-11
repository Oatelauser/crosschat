/**
 * `crosschat clean`（票B B3）：清 tcp 文件通道残留。默认=懒删除同款规则
 * （inbox/parts 落盘 >5 天删；inbox 总量 >512MiB 从最旧删起）；--force 全清
 * inbox+parts（跳过确认，含未过期未读，用户自担）。两模式都打印清理明细。
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FILE_STALE_MS, INBOX_MAX_BYTES } from '../serve/file-channel.js';

export interface CleanArgs {
  force?: boolean;
}

export interface CleanDeps {
  /** tcp 根（inbox/parts 所在）＝~/.crosschat/tcp；测试注入临时目录。 */
  tcpDir: string;
  now(): number;
  stdout(line: string): void;
  /** 测试注入覆盖；缺省用 file-channel 的产品常量。 */
  staleMs?: number;
  maxInboxBytes?: number;
}

interface Entry {
  file: string;
  mtime: number;
  size: number;
}

function listEntries(dir: string): Entry[] {
  if (!existsSync(dir)) return [];
  const out: Entry[] = [];
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    try {
      const s = statSync(file);
      out.push({ file, mtime: s.mtimeMs, size: s.size });
    } catch {
      // 竞态消失/不可 stat：跳过
    }
  }
  return out;
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/** unix 下建议无传输时执行——写入中的文件可能被删（手册有注）。 */
export function runClean(args: CleanArgs, deps: CleanDeps): number {
  const staleMs = deps.staleMs ?? FILE_STALE_MS;
  const maxInboxBytes = deps.maxInboxBytes ?? INBOX_MAX_BYTES;
  const inbox = listEntries(join(deps.tcpDir, 'inbox'));
  const parts = listEntries(join(deps.tcpDir, 'parts'));
  const all = [...inbox, ...parts];

  if (args.force === true) {
    if (all.length === 0) {
      deps.stdout('无需清理：inbox 与 parts 均为空');
      return 0;
    }
    const totalBytes = all.reduce((sum, e) => sum + e.size, 0);
    deps.stdout(`强制清理：将删除全部收件与断点文件（${all.length} 项，共 ${mb(totalBytes)} MB）`);
    let freed = 0;
    for (const e of all) {
      try {
        rmSync(e.file, { force: true });
        freed += e.size;
        deps.stdout(`已删 ${e.file}（${mb(e.size)} MB）`);
      } catch {
        deps.stdout(`删除失败 ${e.file}`);
      }
    }
    deps.stdout(`清理完成：删除 ${all.length} 项，释放 ${mb(freed)} MB`);
    return 0;
  }

  const cutoff = deps.now() - staleMs;
  const victims: { e: Entry; why: string }[] = [];
  for (const e of [...inbox, ...parts]) {
    if (e.mtime < cutoff) victims.push({ e, why: '超 5 天' });
  }
  // 总量超限：在未过期的 inbox 里从最旧删起（与 FileInbox.lazyDelete 同款次序）
  const liveInbox = inbox
    .filter((e) => e.mtime >= cutoff)
    .sort((a, b) => a.mtime - b.mtime);
  let total = liveInbox.reduce((sum, e) => sum + e.size, 0);
  for (const e of liveInbox) {
    if (total <= maxInboxBytes) break;
    total -= e.size;
    victims.push({ e, why: '超总量从最旧删起' });
  }

  if (victims.length === 0) {
    deps.stdout(`无需清理：inbox ${inbox.length} 项 / parts ${parts.length} 项均在保留规则内`);
    return 0;
  }
  let freed = 0;
  for (const { e, why } of victims) {
    try {
      rmSync(e.file, { force: true });
      freed += e.size;
      deps.stdout(`已删 ${e.file}（${mb(e.size)} MB，${why}）`);
    } catch {
      deps.stdout(`删除失败 ${e.file}`);
    }
  }
  deps.stdout(`清理完成：删除 ${victims.length} 项，释放 ${mb(freed)} MB`);
  return 0;
}
