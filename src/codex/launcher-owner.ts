import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import process from 'node:process';
import { sanitizeProxyEnv } from './transport.js';

interface Options {
  executable: string;
  env: NodeJS.ProcessEnv;
  run?(executable: string, args: readonly string[]): Promise<string>;
  installed?(path: string): Promise<boolean>;
}

/** Explicit CLI startup only. Never downloads, upgrades or repairs native configuration. */
export async function startInstalledCodexOwner(options: Options): Promise<void> {
  const home = options.env.CODEX_HOME ?? join(homedir(), '.codex');
  const installed = join(home, 'packages', 'app-server-daemon', 'current', 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex');
  const exists = options.installed ?? (async (path) => { try { return (await stat(path)).isFile(); } catch { return false; } });
  const instruction = 'Codex 原生服务尚不可用；请先在终端运行 codex app-server daemon start，再重新启动入星窗口，或使用 TUI 明确选择会话。';
  if (!await exists(installed)) throw new Error(instruction);
  const run = options.run ?? ((executable, args) => new Promise<string>((resolve, reject) => {
    execFile(executable, [...args], { env: sanitizeProxyEnv(options.env), windowsHide: true, timeout: 10000, maxBuffer: 64 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout));
  }));
  const [cli, daemon] = await Promise.all([run(options.executable, ['--version']), run(installed, ['--version'])]);
  // The native start command must not resolve a different package as an implicit update.
  if (!/^codex-cli \d+\.\d+\.\d+/.test(cli.trim()) || cli.trim() !== daemon.trim()) throw new Error(instruction);
  await run(options.executable, ['app-server', 'daemon', 'start']);
}
