/**
 * broker.json 注册表（票B B1）：纯函数+文件 IO，可独立测试。路径约定
 * ~/.crosschat/tcp/broker.json（homedir 起、全平台统一）——新组件新约定，
 * 不沿用仓内 LOCALAPPDATA 模式。注册表每笔连接由服务端现读，不缓存，
 * gen/remove 即时生效。
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { MultichatError } from '../errors.js';

export interface NodeEntry {
  label: string;
  key: string;
  machineId?: string;
  machineName?: string;
  addedAt: string;
}

export interface BrokerRegistry {
  port?: number;
  nodes: NodeEntry[];
}

/** 新组件新约定：注册表/状态/日志统一住 ~/.crosschat/tcp/ 下。 */
export function tcpDir(baseDir: string): string {
  return join(baseDir, 'tcp');
}

export function defaultBaseDir(): string {
  return join(homedir(), '.crosschat');
}

export function registryFileOf(baseDir: string): string {
  return join(tcpDir(baseDir), 'broker.json');
}

/**
 * 读注册表；不存在按空表。损坏先备份 .bak 再按空表重建——钥匙是用户资产，
 * 不静默吞。
 */
export function readRegistry(file: string): BrokerRegistry {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return { nodes: [] };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<BrokerRegistry> | null;
    if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.nodes)) {
      throw new Error('bad shape');
    }
    return {
      port: typeof parsed.port === 'number' ? parsed.port : undefined,
      nodes: parsed.nodes,
    };
  } catch {
    try {
      copyFileSync(file, `${file}.bak`);
    } catch {
      // 备份尽力而为：重建仍继续
    }
    return { nodes: [] };
  }
}

export function writeRegistry(file: string, registry: BrokerRegistry): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}

export function listNodes(file: string): NodeEntry[] {
  return readRegistry(file).nodes;
}

/** 移除一个节点；返回是否真的移除了（false = 没这个 label）。 */
export function removeNode(file: string, label: string): boolean {
  const registry = readRegistry(file);
  const remaining = registry.nodes.filter((node) => node.label !== label);
  if (remaining.length === registry.nodes.length) return false;
  registry.nodes = remaining;
  writeRegistry(file, registry);
  return true;
}

/** 首次 --port 持久记住（显式给 --port 就是持久化指令）。 */
export function setPort(file: string, port: number): void {
  const registry = readRegistry(file);
  registry.port = port;
  writeRegistry(file, registry);
}

export interface GenKeyResult {
  label: string;
  key: string;
  /** 完整 node.json 文本（拷给节点机器 ~/.crosschat/tcp/node.json）。 */
  nodeJsonContent: string;
}

/**
 * 生成 n 份钥匙并登记进注册表。label 从现有最大 node-N 编号顺延；上限 10
 * （超限 USAGE）。nodeJsonContent 为 2 空格缩进完整 node.json。
 */
export function genKeys(file: string, n: number, opts: { host: string; port: number }): GenKeyResult[] {
  if (!Number.isInteger(n) || n < 1 || n > 10) {
    throw new MultichatError('USAGE', `--gen-key 数量须为 1-10 的整数，收到：${n}`);
  }
  const registry = readRegistry(file);
  const maxNum = registry.nodes.reduce((max, node) => {
    const num = /^node-(\d+)$/.exec(node.label)?.[1];
    return num === undefined ? max : Math.max(max, Number.parseInt(num, 10));
  }, 0);
  const results: GenKeyResult[] = [];
  for (let i = 0; i < n; i++) {
    const label = `node-${maxNum + i + 1}`;
    const key = randomBytes(32).toString('hex');
    results.push({
      label,
      key,
      nodeJsonContent: `${JSON.stringify({ broker: { host: opts.host, port: opts.port }, key }, null, 2)}\n`,
    });
    registry.nodes.push({ label, key, addedAt: new Date().toISOString() });
  }
  writeRegistry(file, registry);
  return results;
}
