/**
 * 文件通道（票B B2）：接收侧 FileInbox——inbox 收 whole 文件、parts 暂存
 * 分块与断点锚。发送侧的分块循环在 via-tcp.ts，这里只有两端共用的常量、
 * 文件名安全化与接收状态机。路径约定：~/.crosschat/tcp/{inbox,parts}/。
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import type { FileBeginFrame, FileChunkFrame, FileResultFrame } from './protocol.js';

/** 单文件上限 64MiB（发送侧读文件时与 broker file-begin 预拒同用此值）。 */
export const FILE_MAX_BYTES = 64 * 1024 * 1024;
/** 分块大小 256KiB（base64 后约 350KB，留在一帧 2MiB 上限内）。 */
export const FILE_CHUNK_BYTES = 256 * 1024;
/** 懒删除：inbox/parts 落盘超 5 天视为残迹。 */
export const FILE_STALE_MS = 5 * 24 * 3_600_000;
/** 懒删除：inbox 总量超 512MiB 从最旧删起。 */
export const INBOX_MAX_BYTES = 512 * 1024 * 1024;

/** 原名剥离目录成分与 Windows 危险字符，空则兜底 'file'。 */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex -- 控制字符必须一并剥掉
  const cleaned = base.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? 'file' : cleaned;
}

/** 接收完成后的最终路径：inbox/<sha 前 8>-<安全化原名>。 */
export function inboxPathFor(inboxDir: string, sha256: string, name: string): string {
  return join(inboxDir, `${sha256.slice(0, 8)}-${safeFileName(name)}`);
}

interface Transfer {
  sha256: string;
  name: string;
  size: number;
}

export interface FileInboxDirs {
  inboxDir: string;
  partsDir: string;
}

/**
 * 一次 file-begin..file-end 的接收状态机（多 id 并发各写各的 parts 文件）。
 * 断点锚 parts/&lt;sha&gt;.part.json{nextSeq} 每块落盘后更新——传输中断后
 * 重新 begin 会拿到 resumeFrom=nextSeq，发方从该块续传。
 */
export class FileInbox {
  private readonly transfers = new Map<string, Transfer>();

  constructor(
    private readonly dirs: FileInboxDirs,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** file-begin 应答：去重秒回 / 断点续传锚 / 全新开始（顺带懒删除）。 */
  begin(frame: FileBeginFrame): FileResultFrame {
    this.lazyDelete();
    const { sha256, name, size } = frame;
    const finalPath = inboxPathFor(this.dirs.inboxDir, sha256, name);
    if (existsSync(finalPath)) {
      return { op: 'file-result', id: frame.id, ok: true, path: finalPath, dedup: true };
    }
    this.transfers.set(frame.id, { sha256, name, size });
    const anchor = this.readAnchor(sha256);
    if (anchor !== undefined && anchor.nextSeq > 0) {
      return { op: 'file-result', id: frame.id, ok: true, resumeFrom: anchor.nextSeq };
    }
    // 无锚或锚损坏：清掉可能存在的残片，从零开始（残片混写必致 sha 失败）
    this.cleanup(sha256);
    this.writeAnchor(sha256, 0);
    return { op: 'file-result', id: frame.id, ok: true, resumeFrom: 0 };
  }

  /** 顺序落盘一块；seq 必须等于锚的 nextSeq（发方遵守 resumeFrom 时恒真）。 */
  chunk(frame: FileChunkFrame): boolean {
    const t = this.transfers.get(frame.id);
    if (t === undefined) return false;
    const anchor = this.readAnchor(t.sha256);
    if (anchor === undefined || anchor.nextSeq !== frame.seq) return false;
    let bytes: Buffer;
    try {
      bytes = Buffer.from(frame.bytes, 'base64');
    } catch {
      return false;
    }
    mkdirSync(this.dirs.partsDir, { recursive: true });
    appendFileSync(this.partFile(t.sha256), bytes);
    this.writeAnchor(t.sha256, frame.seq + 1);
    return true;
  }

  /** file-end：sha256 校验 → 改名转正 → 清残片；失败删残片要求整档重传。 */
  end(id: string): FileResultFrame {
    const t = this.transfers.get(id);
    if (t === undefined) {
      return { op: 'file-result', id, ok: false, error: '未知传输 id（可能已被清理）' };
    }
    this.transfers.delete(id);
    const part = this.partFile(t.sha256);
    let ok = false;
    try {
      ok = existsSync(part) && sha256File(part) === t.sha256;
    } catch {
      ok = false;
    }
    if (!ok) {
      this.cleanup(t.sha256);
      return {
        op: 'file-result',
        id,
        ok: false,
        error: 'sha256 校验失败——残片已清理，请整档重传（重跑同一命令即可）',
      };
    }
    const finalPath = inboxPathFor(this.dirs.inboxDir, t.sha256, t.name);
    mkdirSync(this.dirs.inboxDir, { recursive: true });
    // 同名不同 sha 不可能（sha 在文件名里）；同 sha 同名已提前 dedup
    renameSync(part, finalPath);
    this.cleanup(t.sha256);
    return { op: 'file-result', id, ok: true, path: finalPath };
  }

  private partFile(sha: string): string {
    return join(this.dirs.partsDir, `${sha}.part`);
  }

  private anchorFile(sha: string): string {
    return join(this.dirs.partsDir, `${sha}.part.json`);
  }

  /** 无锚/锚损坏统一 undefined（损坏时 begin 会连残片一起清掉重来）。 */
  private readAnchor(sha: string): { nextSeq: number } | undefined {
    try {
      const parsed = JSON.parse(readFileSync(this.anchorFile(sha), 'utf8')) as { nextSeq?: unknown };
      return typeof parsed?.nextSeq === 'number' ? { nextSeq: parsed.nextSeq } : undefined;
    } catch {
      return undefined;
    }
  }

  private writeAnchor(sha: string, nextSeq: number): void {
    mkdirSync(this.dirs.partsDir, { recursive: true });
    writeFileSync(this.anchorFile(sha), `${JSON.stringify({ nextSeq })}\n`, 'utf8');
  }

  private cleanup(sha: string): void {
    rmSync(this.partFile(sha), { force: true });
    rmSync(this.anchorFile(sha), { force: true });
  }

  /**
   * 懒删除（每次 file-begin 顺带执行）：inbox 落盘 >5 天删；inbox 总量
   * >512MiB 从最旧删起；parts 残片同 5 天规则。best-effort——单文件删除
   * 失败不阻断传输。
   */
  private lazyDelete(): void {
    const cutoff = this.now() - FILE_STALE_MS;
    const statOf = (file: string): { mtime: number; size: number } | undefined => {
      try {
        const s = statSync(file);
        return { mtime: s.mtimeMs, size: s.size };
      } catch {
        return undefined;
      }
    };
    try {
      const entries = readdirSync(this.dirs.inboxDir).map((f) => ({
        file: join(this.dirs.inboxDir, f),
        ...statOf(join(this.dirs.inboxDir, f)),
      }));
      for (const e of entries) {
        if (e.mtime !== undefined && e.mtime < cutoff) {
          try { rmSync(e.file, { force: true }); } catch { /* best-effort */ }
        }
      }
      const live = entries
        .filter((e) => e.mtime !== undefined && e.mtime >= cutoff && existsSync(e.file))
        .sort((a, b) => a.mtime! - b.mtime!);
      let total = live.reduce((sum, e) => sum + (e.size ?? 0), 0);
      for (const e of live) {
        if (total <= INBOX_MAX_BYTES) break;
        try {
          rmSync(e.file, { force: true });
          total -= e.size ?? 0;
        } catch { /* best-effort */ }
      }
    } catch {
      // inbox 目录不存在等——首份文件会建目录
    }
    try {
      for (const f of readdirSync(this.dirs.partsDir)) {
        const file = join(this.dirs.partsDir, f);
        const s = statOf(file);
        if (s !== undefined && s.mtime < cutoff) {
          try { rmSync(file, { force: true }); } catch { /* best-effort */ }
        }
      }
    } catch {
      // parts 目录不存在——忽略
    }
  }
}

function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** 发送侧文件读取 + 摘要（64MiB 预检在调用方）。 */
export function readFileForSend(path: string): { bytes: Buffer; sha256: string; name: string; size: number } {
  const bytes = readFileSync(path);
  return {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    name: (path.split(/[\\/]/).pop() ?? 'file'),
    size: bytes.length,
  };
}
