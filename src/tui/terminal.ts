import type { Readable, Writable } from 'node:stream';
import process from 'node:process';

export interface TerminalInput extends Readable {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?(enabled: boolean): unknown;
}
export interface TerminalOutput extends Writable { isTTY?: boolean; columns?: number; rows?: number }
export interface TerminalSignals {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
}
export interface TerminalOwner { signal: AbortSignal; exit(): void; fail(error?: unknown): void }
export interface MountedTui { done: Promise<void>; dispose(): void | Promise<void>; interrupt?(): void }
export interface TerminalOptions {
  stdin: TerminalInput;
  stdout: TerminalOutput;
  stderr: Writable;
  signals?: TerminalSignals;
  mount(owner: TerminalOwner): MountedTui | Promise<MountedTui>;
}

/** The session owns its listeners and only restores the terminal state it borrowed. */
export async function runTerminalSession(options: TerminalOptions): Promise<number> {
  const { stdin, stdout, stderr } = options;
  if (!stdin.isTTY || !stdout.isTTY || stdin.setRawMode === undefined) {
    stderr.write('crosschat tui 需要可输入和输出的交互终端。\n');
    return 1;
  }
  const signals = options.signals ?? process;
  const wasRaw = stdin.isRaw === true;
  const wasPaused = stdin.isPaused() || stdin.readableFlowing !== true;
  const controller = new AbortController();
  let mounted: MountedTui | undefined;
  let code: number | undefined;
  let resolveExit!: () => void;
  let restored = false;
  const exit = new Promise<void>((resolve) => { resolveExit = resolve; });
  const finish = (result: number): void => {
    if (code !== undefined) return;
    code = result;
    controller.abort();
    resolveExit();
  };
  const fail = (): void => finish(1);
  const restore = (): void => {
    if (restored) return;
    restored = true;
    try { stdin.setRawMode?.(wasRaw); } catch { /* Input may already be closed. */ }
    try { if (wasPaused) stdin.pause(); else stdin.resume(); } catch { /* Input may already be closed. */ }
    // Ink normally restores its alternate screen; this guard also covers failed mounts.
    try { stdout.write('\u001b[?2004l\u001b[?25h\u001b[?1049l'); } catch { /* Output may already be closed. */ }
  };
  const interrupt = (): void => {
    try { if (mounted?.interrupt !== undefined) mounted.interrupt(); else finish(0); }
    catch { fail(); }
  };
  const stop = (): void => finish(0);
  const bindings: readonly [string, (...args: unknown[]) => void][] = [
    ['SIGINT', interrupt], ['SIGTERM', stop], ['uncaughtException', fail],
    ['unhandledRejection', fail], ['exit', restore],
  ];
  for (const [event, listener] of bindings) signals.on(event, listener);
  stdin.on('end', stop);
  stdin.on('close', stop);
  stdin.on('error', fail);
  stdout.on('error', fail);
  try {
    mounted = await options.mount({ signal: controller.signal, exit: stop, fail });
    // Attach both handlers even if exit happened while mounting, avoiding a late rejection.
    void mounted.done.then(stop, fail);
    await exit;
  } catch { fail(); }
  finally {
    controller.abort();
    try { await mounted?.dispose(); } catch { code = 1; }
    restore();
    for (const [event, listener] of bindings) signals.off(event, listener);
    stdin.off('end', stop);
    stdin.off('close', stop);
    stdin.off('error', fail);
    stdout.off('error', fail);
  }
  if (code === 1) {
    try { stderr.write('crosschat tui 异常退出，已尝试恢复终端。\n'); } catch { /* Closed error stream. */ }
  }
  return code ?? 0;
}
