import { appendFileSync, renameSync, rmSync, statSync } from 'node:fs';

/**
 * 014 日志轮转：追加前查大小，超 5MB 先把旧 `.old` unlink（win 上 rename
 * 不能覆盖已存在文件）再把当前文件 rename 成 `.old`，然后照常追加。轮转
 * 失败忽略——追加不被阻塞，下次追加重试。
 */
export const ROTATE_MAX_BYTES = 5 * 1024 * 1024;

export function appendWithRotate(file: string, text: string): void {
  try {
    if (statSync(file).size > ROTATE_MAX_BYTES) {
      rmSync(`${file}.old`, { force: true });
      renameSync(file, `${file}.old`);
    }
  } catch {
    // 轮转是尽力而为：移动失败不拦追加（下次再试）
  }
  appendFileSync(file, text, 'utf8');
}
