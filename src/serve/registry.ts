/**
 * broker.json 注册表（票B B1）：纯函数+文件 IO，可独立测试。路径约定
 * ~/.crosschat/tcp/broker.json（homedir 起、全平台统一）——014 起状态目录
 * 也统一到此根（stateRoot）。注册表每笔连接由服务端现读，不缓存，
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
  /** B0 多星地基：本 broker 的全局唯一星标识（12 hex，ensureStarId 生成）。 */
  starId?: string;
  /** E0 星名：broker 权威的星名（--name 显式给；缺省首次 serve 取清洗后的 hostname）。 */
  name?: string;
  nodes: NodeEntry[];
}

/** E0：星名字符集（禁冒号——`tcp:<选择器>:` 限定词语法保留字）。022 起导出（--add-star 校验共用）。 */
export const STAR_NAME_RE = /^[A-Za-z0-9._-]{1,32}$/;

/**
 * B2.1：节点自报名的净化（显示用）——剥控制符、截 32 字符；空则 undefined。
 * 寻址权威是 machine-id 前缀，名字脏了也不影响路由。
 */
export function sanitizeName(name: string | undefined): string | undefined {
  if (typeof name !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex -- 协议字段必须剥控制符
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32);
  return cleaned === '' ? undefined : cleaned;
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
      starId: typeof parsed.starId === 'string' ? parsed.starId : undefined,
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
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

/**
 * 022 多星注册表：stars[] 形状的单星条目。磁盘形状双轨——单星部署保持旧
 * broker.json 字节不动（零回归），--add-star 加第二星起转 stars[] 新形状；
 * 读层旧形状归一为 stars[0]（multi:false 标记写回时还原旧形状）。
 */
export interface StarReg {
  starId?: string;
  name?: string;
  nodes: NodeEntry[];
}

export interface MultiRegistry {
  port?: number;
  stars: StarReg[];
  /** 磁盘是否 stars[] 新形状（false=旧单星形状——写回保持旧形状）。 */
  multi: boolean;
}

/**
 * 022：读多星注册表（单次解析、形状归一）。stars[] = 新形状；nodes[] = 旧
 * 单星形状归一为 stars[0]（multi:false 写回还原旧形状）；两者皆非/损坏走
 * readRegistry 同款 .bak 备份按空旧形状（册是状态可重建，钥匙资产在 .bak）。
 */
export function readMultiRegistry(file: string): MultiRegistry {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return { stars: [{ nodes: [] }], multi: false };
  }
  try {
    const parsed = JSON.parse(raw) as
      | { port?: unknown; stars?: unknown; nodes?: unknown; starId?: unknown; name?: unknown }
      | null;
    if (parsed === null || typeof parsed !== 'object') throw new Error('bad shape');
    const port = typeof parsed.port === 'number' ? parsed.port : undefined;
    if (Array.isArray(parsed.stars)) {
      const stars = parsed.stars.map((s): StarReg => {
        if (s === null || typeof s !== 'object' || !Array.isArray((s as StarReg).nodes)) throw new Error('bad shape');
        const r = s as { starId?: unknown; name?: unknown; nodes: NodeEntry[] };
        return {
          ...(typeof r.starId === 'string' ? { starId: r.starId } : {}),
          ...(typeof r.name === 'string' ? { name: r.name } : {}),
          nodes: r.nodes,
        };
      });
      if (stars.length === 0) throw new Error('bad shape');
      return { ...(port === undefined ? {} : { port }), stars, multi: true };
    }
    if (Array.isArray(parsed.nodes)) {
      return {
        ...(port === undefined ? {} : { port }),
        stars: [{
          ...(typeof parsed.starId === 'string' ? { starId: parsed.starId } : {}),
          ...(typeof parsed.name === 'string' ? { name: parsed.name } : {}),
          nodes: parsed.nodes as NodeEntry[],
        }],
        multi: false,
      };
    }
    throw new Error('bad shape');
  } catch {
    try {
      copyFileSync(file, `${file}.bak`);
    } catch {
      // 备份尽力而为：重建仍继续
    }
    return { stars: [{ nodes: [] }], multi: false };
  }
}

/**
 * 022：写多星注册表（形状感知）。multi=false → 旧形状（stars[0] 展开，字段
 * 序与 readRegistry 相同——单星部署磁盘字节不变）；true → {port?,stars}。
 */
export function writeMultiRegistry(file: string, reg: MultiRegistry): void {
  if (!reg.multi) {
    const s = reg.stars[0]!;
    writeRegistry(file, {
      ...(reg.port === undefined ? {} : { port: reg.port }),
      ...(s.starId === undefined ? {} : { starId: s.starId }),
      ...(s.name === undefined ? {} : { name: s.name }),
      nodes: s.nodes,
    });
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  const out: { port?: number; stars: StarReg[] } = { ...(reg.port === undefined ? {} : { port: reg.port }), stars: reg.stars };
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
}

/**
 * 022：按星改单条节点表（连接握手 machineId/machineName 回写用；形状感知
 * 读改写）。starId=undefined 且 !multi = 旧单星形状路径。
 */
export function updateNodeEntry(file: string, starId: string | undefined, key: string, mutate: (e: NodeEntry) => void): void {
  const reg = readMultiRegistry(file);
  const star = reg.multi ? reg.stars.find((s) => s.starId === starId) : reg.stars[0];
  const entry = star?.nodes.find((n) => n.key === key);
  if (entry === undefined) return;
  mutate(entry);
  writeMultiRegistry(file, reg);
}

/**
 * 022 星选择器（--star <名|starId前缀>，与 --connect/--via 选择器同判定序）：
 * 星名精确 → starId 前缀唯一（歧义教加长）；零命中列全部星。
 */
export function selectStar(stars: StarReg[], selector: string): StarReg {
  const byName = stars.find((s) => s.name === selector);
  if (byName !== undefined) return byName;
  const byPrefix = stars.filter((s) => s.starId !== undefined && s.starId.startsWith(selector));
  if (byPrefix.length === 1) return byPrefix[0]!;
  const list = stars.map((s) => s.name ?? s.starId ?? '(未定名)').join('、');
  if (byPrefix.length > 1) {
    throw new MultichatError('USAGE', `--star 选择器 ${selector} 的 starId 前缀命中多个星（${list}）——加长前缀使其唯一`);
  }
  throw new MultichatError('USAGE', `--star 选择器 ${selector} 不匹配任何星——本机托管：${list}；crosschat serve --list 可查`);
}

/** 022：多星形状下补齐每星 starId（无则生成；有变化才写盘）。 */
export function ensureMultiStarIds(file: string): void {
  const reg = readMultiRegistry(file);
  if (!reg.multi) return;
  let changed = false;
  for (const star of reg.stars) {
    if (star.starId === undefined) {
      star.starId = randomBytes(6).toString('hex');
      changed = true;
    }
  }
  if (changed) writeMultiRegistry(file, reg);
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

/**
 * B0 多星地基：确保注册表带 starId（无则 randomBytes(6) 生成 12 hex 写回）。
 * 幂等：已有直接返回，gen-key/自登记前调一次即可。
 */
export function ensureStarId(file: string): string {
  const registry = readRegistry(file);
  if (registry.starId !== undefined) return registry.starId;
  registry.starId = randomBytes(6).toString('hex');
  writeRegistry(file, registry);
  return registry.starId;
}

/**
 * E0 星名（显式）：校验并持久化（与 --port 同语义——给一次记住）。
 * 坏值 USAGE 带规则说明（禁冒号是限定词语法保留字）。
 */
export function setName(file: string, name: string): void {
  if (!STAR_NAME_RE.test(name)) {
    throw new MultichatError('USAGE', `--name 星名须为 1-32 个字母/数字/./_/-（禁冒号——tcp 限定词语法保留字），收到：${name}`);
  }
  const registry = readRegistry(file);
  registry.name = name;
  writeRegistry(file, registry);
}

/** E0 星名（缺省清洗）：hostname 剥出星名字符集内的字符、截 32；全剥空 → undefined。 */
export function sanitizeStarName(raw: string): string | undefined {
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 32);
  return cleaned === '' ? undefined : cleaned;
}

/**
 * E0 星名（缺省轨道）：注册表已有星名直接用；否则取清洗后的 hostname 持久化
 * （首次 serve 落定，与 starId 同款幂等 ensure）。清洗后为空 → 不设名。
 */
export function ensureStarName(file: string, fallbackHostname: string): string | undefined {
  const registry = readRegistry(file);
  if (registry.name !== undefined) return registry.name;
  const name = sanitizeStarName(fallbackHostname);
  if (name === undefined) return undefined;
  registry.name = name;
  writeRegistry(file, registry);
  return name;
}

export interface GenKeyResult {
  label: string;
  key: string;
  /** 完整 node.json 文本（拷给节点机器 ~/.crosschat/tcp/node.json）。 */
  nodeJsonContent: string;
}

/**
 * 生成 n 份钥匙并登记进注册表。label 从现有最大 node-N 编号顺延；上限 10
 * （超限 USAGE）。nodeJsonContent 为 2 空格缩进完整 node.json（E0 词表：
 * 条目 name=星名 broker 权威、顶层 showName=贴配置机器的自报名）。
 */
export function genKeys(file: string, n: number, opts: { host: string; port: number; name?: string; starId?: string }): GenKeyResult[] {
  const registry = readRegistry(file);
  const results = genKeysInto(registry.nodes, n, opts);
  writeRegistry(file, registry);
  return results;
}

/**
 * 022：多星形状下的星域发钥（--star 限定；--gen-key 裸用在多星被 serve 面
 * 拦下才到这）。形状感知读改写，其余语义与 genKeys 相同。
 */
export function genKeysForStar(file: string, starId: string, n: number, opts: { host: string; port: number; name?: string }): GenKeyResult[] {
  const reg = readMultiRegistry(file);
  const star = reg.stars.find((s) => s.starId === starId);
  if (star === undefined) throw new MultichatError('USAGE', `--star ${starId} 不在注册表——crosschat serve --list 可查`);
  const results = genKeysInto(star.nodes, n, { ...opts, starId });
  writeMultiRegistry(file, reg);
  return results;
}

/** 发钥内核（无文件 IO）：label 顺延、node.json 文本、条目入表。 */
function genKeysInto(nodes: NodeEntry[], n: number, opts: { host: string; port: number; name?: string; starId?: string }): GenKeyResult[] {
  if (!Number.isInteger(n) || n < 1 || n > 10) {
    throw new MultichatError('USAGE', `--gen-key 数量须为 1-10 的整数，收到：${n}`);
  }
  const maxNum = nodes.reduce((max, node) => {
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
      nodeJsonContent: `${JSON.stringify(
        {
          brokers: [{ host: opts.host, port: opts.port, ...(opts.name === undefined ? {} : { name: opts.name }), ...(opts.starId === undefined ? {} : { starId: opts.starId }), key }],
          showName: '改成「贴这份配置的机器」的名字',
        },
        null,
        2,
      )}\n`,
    });
    nodes.push({ label, key, addedAt: new Date().toISOString() });
  }
  return results;
}

/** 022：多星形状下按星删节点（--star <选择器> --remove <label>）。 */
export function removeNodeForStar(file: string, starId: string, label: string): boolean {
  const reg = readMultiRegistry(file);
  const star = reg.stars.find((s) => s.starId === starId);
  if (star === undefined) return false;
  const remaining = star.nodes.filter((node) => node.label !== label);
  if (remaining.length === star.nodes.length) return false;
  star.nodes = remaining;
  writeMultiRegistry(file, reg);
  return true;
}

/** 022：多星形状下按星改名（--star <选择器> --name <新名>；校验同 setName）。 */
export function setNameForStar(file: string, starId: string, name: string): void {
  if (!STAR_NAME_RE.test(name)) {
    throw new MultichatError('USAGE', `--name 星名须为 1-32 个字母/数字/./_/-（禁冒号——tcp 限定词语法保留字），收到：${name}`);
  }
  const reg = readMultiRegistry(file);
  const star = reg.stars.find((s) => s.starId === starId);
  if (star === undefined) throw new MultichatError('USAGE', `--star ${starId} 不在注册表——crosschat serve --list 可查`);
  const clash = reg.stars.find((s) => s !== star && s.name === name);
  if (clash !== undefined) {
    throw new MultichatError('USAGE', `星名 ${name} 已用于本 broker 的另一颗星（星名须唯一——寻址与 roster 文件名都按名区分）`);
  }
  star.name = name;
  writeMultiRegistry(file, reg);
}
