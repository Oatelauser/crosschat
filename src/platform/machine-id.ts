import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

/**
 * Stable per-install machine id (B10): the `mid` that disambiguates machines
 * sharing a hostname. win = registry MachineGuid, linux = /etc/machine-id,
 * mac = IOPlatformUUID. Undefined whenever the source is unreadable — callers
 * fall back to hostname comparison. Cached: it never changes within a boot.
 */
let cached: string | undefined | null = null;

export function machineId(): string | undefined {
  if (cached === null) cached = readMachineId();
  return cached;
}

/**
 * F0：machineId 跨形态归一（小写 + 去非 hex 字符——Windows 带杠 MachineGuid 与
 * Linux 纯 hex 互认）。只用于已知是 mid 的值的比对边界；存储与线上帧保持历史
 * 形态，绝不用于机器名/标签。
 */
export function normalizeMid(s: string): string {
  return s.toLowerCase().replace(/[^0-9a-f]/g, '');
}

function readMachineId(): string | undefined {
  try {
    if (process.platform === 'win32') {
      const out = execSync('reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return out.match(/MachineGuid\s+REG_SZ\s+(\S+)/)?.[1];
    }
    if (process.platform === 'darwin') {
      const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1];
    }
    return readFileSync('/etc/machine-id', 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}
