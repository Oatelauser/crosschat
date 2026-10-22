/** Shared same-star daemon guard. CLI failure-open semantics and messages remain unchanged. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MultichatError } from '../../errors.js';
import { isProcessAlive } from '../../platform/process-inspector.js';
import { selectConnectEntry } from '../../serve/connect-selector.js';
import { formatBrokerEntry, readNodeConfig } from '../../serve/node-config.js';
import type { BrokerEntry, NodeConfig } from '../../serve/node-config.js';
import { tcpDir } from '../../serve/registry.js';
import { connectValueOf, listServeProcesses } from './processes.js';
import type { ProcInfo } from './processes.js';
export interface SameStarGuardDeps { baseDir: string; listServeProcesses?: () => ProcInfo[] }
export function guardSameStarDaemon(connectArg: string, deps: SameStarGuardDeps): void {
  let config: NodeConfig;
  let mine: BrokerEntry;
  try {
    config = readNodeConfig(join(tcpDir(deps.baseDir), 'node.json'));
    mine = selectConnectEntry(connectArg, config).entry;
  } catch {
    return; // 解析不了交给 runForegroundNode 的既有教学报错
  }
  let procs: ProcInfo[];
  try {
    procs = (deps.listServeProcesses ?? listServeProcesses)();
  } catch {
    return; // 扫描失败=探测不到
  }
  for (const p of procs) {
    if (!p.cmdline.includes('--connect')) continue;
    const theirRaw = connectValueOf(p.cmdline); // includes 前置过滤后 undefined=尾置裸 --connect
    let theirs: BrokerEntry;
    try {
      theirs = selectConnectEntry(theirRaw ?? '', config).entry;
    } catch {
      continue; // 对方 cmdline 解析不出星（异常形状/配置已变）：保守放行不拦
    }
    if (theirs !== mine) continue;
    const star = formatBrokerEntry(mine);
    throw new MultichatError(
      'USAGE',
      theirRaw === undefined || theirRaw === ''
        ? `本机已有 ${star} 的节点守护在跑（pid ${p.pid}，--connect 裸默认腿）——先执行: crosschat serve --stop node（裸 --connect 无选择器拼写，将停全部节点守护）`
        : `本机已有 ${star} 的节点守护在跑（pid ${p.pid}，--connect ${theirRaw}）——先执行: crosschat serve --stop ${theirRaw}`,
    );
  }
  // 022：本机 broker 已内挂该星聚合器也算占用（F4 消除——手动 --connect 与进程
  // 内挂同 mid 双连会把名字/mid 寻址全撞死）。status-broker.json 的 stars 清单 +
  // pid 验活；读不到/解析失败=探测不到，放行。
  try {
    const st = JSON.parse(readFileSync(join(tcpDir(deps.baseDir), 'status-broker.json'), 'utf8')) as
      | { state?: unknown; pid?: unknown; stars?: Array<{ name?: unknown; starId?: unknown }> | null }
      | null;
    const hosted =
      st !== null && typeof st === 'object' && st.state === 'running' &&
      typeof st.pid === 'number' && isProcessAlive(st.pid) && Array.isArray(st.stars) &&
      st.stars.some(
        (s) =>
          (typeof s?.starId === 'string' && s.starId !== '' && s.starId === mine.starId) ||
          (mine.starId === undefined && typeof s?.name === 'string' && s.name !== '' && s.name === mine.name),
      );
    if (hosted) {
      throw new MultichatError(
        'USAGE',
        `本机 broker（pid ${st.pid}）已内挂 ${formatBrokerEntry(mine)} 的聚合器（022 起随 serve 自动自挂，无需另起守护）——如确要独立守护：先 crosschat serve --stop 再用 --connect（重启 broker 前 serve --stop 也会让位）`,
      );
    }
  } catch (err) {
    if (err instanceof MultichatError) throw err;
    // 状态文件不可读=探测不到，放行（现状行为）
  }
}

