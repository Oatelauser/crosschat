/** Async, cancellable reads of the existing OS machine identity; never generates one. */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { untilAborted } from '../sessions/reading.js';

interface ExecuteOptions { signal: AbortSignal; timeoutMs: number }
export interface MembershipMachineOptions {
  platform?: NodeJS.Platform;
  signal?: AbortSignal;
  timeoutMs?: number;
  execute?(file: string, args: readonly string[], options: ExecuteOptions): Promise<string>;
  readText?(path: string, signal: AbortSignal): Promise<string>;
}

function execute(file: string, args: readonly string[], options: ExecuteOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', signal: options.signal, timeout: options.timeoutMs,
      shell: false, windowsHide: true, maxBuffer: 64 * 1024 }, (error, stdout) => {
      if (error !== null) reject(new Error('Machine identity source is unavailable.'));
      else resolve(stdout);
    });
  });
}

export async function readMembershipMachineId(options: MembershipMachineOptions = {}): Promise<string | undefined> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const timeoutMs = options.timeoutMs ?? 3_000;
  const timer = setTimeout(onAbort, timeoutMs);
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const signal = controller.signal;
  try {
    if (signal.aborted) return undefined;
    const platform = options.platform ?? process.platform;
    const run = options.execute ?? execute;
    if (platform === 'win32') {
      const output = await untilAborted(run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { signal, timeoutMs }), signal);
      return output.match(/MachineGuid\s+REG_SZ\s+(\S+)/)?.[1];
    }
    if (platform === 'darwin') {
      const output = await untilAborted(run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { signal, timeoutMs }), signal);
      return output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1];
    }
    const read = options.readText ?? ((path: string, readSignal: AbortSignal) => readFile(path, { encoding: 'utf8', signal: readSignal }));
    return (await untilAborted(read('/etc/machine-id', signal), signal)).trim() || undefined;
  } catch { return undefined; }
  finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    controller.abort();
  }
}
