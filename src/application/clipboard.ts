import { spawn as nodeSpawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import type { Writable } from 'node:stream';
import process from 'node:process';

interface ClipboardChild extends EventEmitter { stdin: Writable | null; kill(): boolean }
export interface ClipboardOptions {
  platform?: NodeJS.Platform;
  signal?: AbortSignal;
  timeoutMs?: number;
  spawn?: (command: string, args: readonly string[], options: SpawnOptions) => ClipboardChild;
}

/** Explicit user copy. Values are stdin data, never shell fragments or terminal OSC commands. */
export async function copyText(value: string, options: ClipboardOptions = {}): Promise<void> {
  options.signal?.throwIfAborted();
  const platform = options.platform ?? process.platform;
  const command = platform === 'win32' ? 'powershell.exe' : platform === 'darwin' ? 'pbcopy' : 'wl-copy';
  const args = platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', 'Set-Clipboard -Value ([Console]::In.ReadToEnd())']
    : [];
  await new Promise<void>((resolve, reject) => {
    const spawn: NonNullable<ClipboardOptions['spawn']> = options.spawn ?? nodeSpawn;
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true, shell: false });
    const input = child.stdin;
    if (input === null) { child.kill(); reject(new Error('剪贴板输入不可用。')); return; }
    let settled = false;
    const cleanup = (): void => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    };
    const finish = (ok: boolean, closed = false): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (ok) resolve();
      else {
        if (!closed) {
          try { child.kill(); } catch { /* The process may have already exited. */ }
          try { input.destroy(); } catch { /* The input may have already closed. */ }
        }
        reject(new Error('无法复制到系统剪贴板，请检查剪贴板服务后重试。'));
      }
    };
    const close = (code: unknown): void => {
      finish(code === 0, true);
      // Keep error guards through shutdown, then release every listener owned by this operation.
      child.off('error', failed);
      input.off('error', failed);
    };
    const failed = (): void => finish(false);
    const abort = (): void => finish(false);
    const timer = setTimeout(abort, options.timeoutMs ?? 5000);
    child.once('close', close);
    child.on('error', failed);
    input.on('error', failed);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    else { try { input.end(value); } catch { abort(); } }
  });
}
