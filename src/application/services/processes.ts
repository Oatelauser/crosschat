import { execSync } from 'node:child_process';
import process from 'node:process';

export interface ProcInfo {
  pid: number;
  cmdline: string;
}

interface RawProc {
  pid: number;
  /** 可执行名（win=ExecutablePath 基名；unix=comm）——宿主/shell 过滤的关键。 */
  exe: string;
  cmdline: string;
}

/**
 * B3.1 bug3：命中命令行特征后还须 (a) 可执行名确为 node/crosschat（排除
 * wsl.exe/conhost/powershell/bash 等宿主与 shell——它们命令行里嵌着整条
 * 子命令文本，按串匹配就会误杀宿主、连带杀掉 WSL 会话），且 (b) 命令行含
 * 完整脚本路径特征 dist/cli.js 与 serve 旗标。纯函数可注入测试。
 */
export function matchServeProcesses(procs: RawProc[], selfPid: number): ProcInfo[] {
  return procs.filter((p) => {
    if (p.pid === selfPid || p.pid === 0) return false;
    if (!/\bserve\b/.test(p.cmdline)) return false;
    const base = p.exe.split(/[\\/]/).pop()?.toLowerCase() ?? '';
    if (base !== 'node' && base !== 'node.exe' && base !== 'crosschat' && base !== 'crosschat.exe') return false;
    return /dist[\\/]cli\.js/.test(p.cmdline);
  });
}

/** 扫描本机进程清单（win=CIM；unix=ps），过 matchServeProcesses 身份校验。 */
export function listServeProcesses(): ProcInfo[] {
  let out: string;
  const procs: RawProc[] = [];
  if (process.platform === 'win32') {
    out = execSync(
      'powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object CommandLine | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress"',
      { encoding: 'utf8' },
    );
    const parsed = JSON.parse(out || '[]') as { ProcessId: number; ExecutablePath?: string | null; CommandLine: string } | { ProcessId: number; ExecutablePath?: string | null; CommandLine: string }[];
    for (const p of Array.isArray(parsed) ? parsed : [parsed]) {
      procs.push({ pid: p.ProcessId, exe: p.ExecutablePath ?? '', cmdline: p.CommandLine });
    }
  } else {
    out = execSync('ps -eo pid=,comm=,args=', { encoding: 'utf8' });
    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      const [pidTok, comm, ...rest] = trimmed.split(/\s+/);
      const pid = Number.parseInt(pidTok ?? '', 10);
      if (Number.isInteger(pid)) procs.push({ pid, exe: comm ?? '', cmdline: rest.join(' ') });
    }
  }
  return matchServeProcesses(procs, process.pid);
}

/** 注册表端口反查 pid（broker 双重确认用）。 */
export function pidsOnPort(port: number): Set<number> {
  const pids = new Set<number>();
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
      for (const line of out.split('\n')) {
        if (!line.includes('LISTENING')) continue;
        const cols = line.trim().split(/\s+/);
        if ((cols[1] ?? '').endsWith(`:${port}`)) {
          const pid = Number.parseInt(cols[cols.length - 1] ?? '', 10);
          if (Number.isInteger(pid)) pids.add(pid);
        }
      }
    } else {
      const out = execSync(`ss -tlnp 2>/dev/null || lsof -t -i :${port} -sTCP:LISTEN 2>/dev/null`, {
        encoding: 'utf8',
        shell: '/bin/sh',
      });
      for (const m of out.matchAll(/pid=(\d+)/g)) pids.add(Number.parseInt(m[1] ?? '', 10));
      if (pids.size === 0) {
        for (const line of out.split('\n')) {
          const pid = Number.parseInt(line.trim(), 10);
          if (Number.isInteger(pid)) pids.add(pid);
        }
      }
    }
  } catch {
    // 工具缺失：返回空集，调用方按"未确认"处理
  }
  return pids;
}

/** 命令行里 --connect 的取值（空串=裸 --connect 默认守护；undefined=非节点进程）。 */
export function connectValueOf(cmdline: string): string | undefined {
  const m = cmdline.match(/--connect(?:=|\s+)([^\s]*)/);
  return m === null ? undefined : m[1] ?? '';
}


/**
 * 030 停机确认死亡：SIGTERM → 限时探活 → 仍活升级 SIGKILL → 仍活才算失败。
 * （旧实现只确认"信号已发"——linux 侧 SIGTERM 被兜住即假报"已终止"，drill-028 F8；
 * win 的 SIGTERM 即硬杀，探活立即通过零额外等待。）
 */
export function killPid(pid: number, waitMs = 2_000): boolean {
  const alive = (): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'EPERM'; // 存在但无权——保守按活
    }
  };
  try {
    process.kill(pid, 'SIGTERM');
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ESRCH'; // 已死=目标态达成；无权等其他错=失败
  }
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline && alive()) syncSleep(50);
  if (!alive()) return true;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    return true; // 探活刚变死——成功
  }
  const deadline2 = Date.now() + waitMs;
  while (Date.now() < deadline2 && alive()) syncSleep(50);
  return !alive();
}

/** 同步等待（killPid 探活轮询用；Atomics.wait 免占线程的 std 同步睡法）。 */
function syncSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
