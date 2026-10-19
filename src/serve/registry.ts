/**
 * broker.json 注册表（032 单形状终局）：**一个文件装全部**——`{port?, stars:
 * [{starId, name?, nodes, roster}]}`，注册表与星册同文件，读写永远只有这一种
 * 形状（无兼容归一——旧形状按损坏处理 .bak 重建，032 用户拍板非兼容升级）。
 *
 * 写纪律（三铁律，代码强制）：所有写者走 `mutateBrokerFile`（同步读→只拼
 * 自己的段→tmp+rename）；段所有权 roster=broker 独占 / nodes=CLI+onConnect
 * 回写共管 / port+name+加星=CLI；starId 永不变（星身份锚，改名零级联）。
 */
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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

/** 028 星成员册条目（032 起随星内嵌 broker.json；字段语义不变）。 */
export interface RosterEntry {
  /** 成员键=会话 ID（claude sessionId / codex thread id），全星唯一。 */
  sessionId: string;
  name?: string;
  tool?: string;
  /** 归属机器（归一 mid）——复活判定的机器一致性锚（边界1：跨机拒绝）。 */
  machine: string;
  machineName?: string;
  online: boolean;
  /** 经 --extend-session 接任的旧名（接任转移的持久证据——接任者胜复活）。 */
  extendsName?: string;
  /** 接任旧名的归属机器（跨机接续 {machine,name} 的 machine 段）。 */
  extendsMachine?: string;
  /** 029 --rm 临时成员：死亡即删册零痕迹（聚合器验死报 member-remove；切片回带本位）。 */
  temporary?: boolean;
}

/** 032：一颗星的全部数据（钥匙+成员册同文件同段）。 */
export interface StarRecord {
  starId?: string;
  name?: string;
  nodes: NodeEntry[];
  roster: RosterEntry[];
}

/** 032：broker.json 单形状文档。 */
export interface BrokerFile {
  port?: number;
  stars: StarRecord[];
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

/** E0 星名（缺省清洗）：hostname 剥出星名字符集内的字符、截 32；全剥空 → undefined。 */
export function sanitizeStarName(raw: string): string | undefined {
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 32);
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

/** 册条目形状过滤（坏条目跳过不整文件判死——册是状态可重建）。 */
function parseRoster(raw: unknown): RosterEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is RosterEntry =>
      e !== null && typeof e === 'object' && typeof (e as RosterEntry).sessionId === 'string' && (e as RosterEntry).sessionId !== '',
  );
}

/**
 * 032：读 broker.json（单形状）。文件缺失/不存在 → 空表（bootstrap 重建路）；
 * 损坏或旧形状（无 stars[]）→ `.bak` 兜底后按空表（非兼容：旧形状不再归一，
 * 钥匙资产在 .bak，重配走 gen-key 既有流程）。
 */
export function loadBrokerFile(file: string): BrokerFile {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return { stars: [] };
  }
  try {
    const parsed = JSON.parse(raw) as { port?: unknown; stars?: unknown } | null;
    if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.stars)) throw new Error('bad shape');
    const stars = parsed.stars.map((s): StarRecord => {
      if (s === null || typeof s !== 'object' || !Array.isArray((s as StarRecord).nodes)) throw new Error('bad shape');
      const r = s as { starId?: unknown; name?: unknown; nodes: NodeEntry[]; roster?: unknown };
      return {
        ...(typeof r.starId === 'string' && r.starId !== '' ? { starId: r.starId } : {}),
        ...(typeof r.name === 'string' && r.name !== '' ? { name: r.name } : {}),
        nodes: r.nodes,
        roster: parseRoster(r.roster),
      };
    });
    return { ...(typeof parsed.port === 'number' ? { port: parsed.port } : {}), stars };
  } catch {
    try {
      copyFileSync(file, `${file}.bak`);
    } catch {
      // 备份尽力而为：重建仍继续
    }
    return { stars: [] };
  }
}

/** 032：写 broker.json（tmp+rename 原子写；唯一合法调用方是 mutateBrokerFile 与 bootstrap）。 */
export function writeBrokerFile(file: string, doc: BrokerFile): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}

/**
 * 032 单写入口（三铁律的强制点）：同步读 → fn 只拼自己的段 → 原子写。
 * fn 内禁止 await、禁止用内存快照整写未知段（在跑 gen-key 的新钥匙会被
 * splice 保住——所有写者天然保留别人的段）。
 */
export function mutateBrokerFile(file: string, fn: (doc: BrokerFile) => void): void {
  const doc = loadBrokerFile(file);
  fn(doc);
  writeBrokerFile(file, doc);
}

/**
 * 022 星选择器（--star <名|starId前缀>，与 --connect/--via 选择器同判定序）：
 * 星名精确 → starId 前缀唯一（歧义教加长）；零命中列全部星。
 */
export function selectStar(stars: StarRecord[], selector: string): StarRecord {
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

export interface GenKeyResult {
  label: string;
  key: string;
  /** 完整 node.json 文本（拷给节点机器 ~/.crosschat/tcp/node.json）。 */
  nodeJsonContent: string;
}

/**
 * 发钥内核（无文件 IO）：label 顺延、node.json 文本、条目入表。genKeysFor 调用。
 */
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

/**
 * 星域发钥（--star 限定；单星由 serve 面隐式选中后调用）。splice 只动目标星
 * 的 nodes 段，roster 段原样保留。
 */
export function genKeysFor(file: string, starId: string, n: number, opts: { host: string; port: number; name?: string }): GenKeyResult[] {
  let results: GenKeyResult[] = [];
  mutateBrokerFile(file, (doc) => {
    const star = doc.stars.find((s) => s.starId === starId);
    if (star === undefined) throw new MultichatError('USAGE', `--star ${starId} 不在注册表——crosschat serve --list 可查`);
    results = genKeysInto(star.nodes, n, { ...opts, starId });
  });
  return results;
}

/** 星域删节点（--star <选择器> --remove <label>）。 */
export function removeNodeFor(file: string, starId: string, label: string): boolean {
  let removed = false;
  mutateBrokerFile(file, (doc) => {
    const star = doc.stars.find((s) => s.starId === starId);
    if (star === undefined) return;
    const remaining = star.nodes.filter((node) => node.label !== label);
    if (remaining.length !== star.nodes.length) {
      star.nodes = remaining;
      removed = true;
    }
  });
  return removed;
}

/** 改端口（唯一写者 --port；只动顶层 port 段）。 */
export function setPortFor(file: string, port: number): void {
  mutateBrokerFile(file, (doc) => {
    doc.port = port;
  });
}

/**
 * 星域改名（--star <选择器> --name <新名>）：星名全库唯一且大小写不敏感、
 * 不与任何 starId 相同（寻址与显示都按名区分）；只动 name 字段零级联。
 */
export function setNameFor(file: string, starId: string, name: string): void {
  if (!STAR_NAME_RE.test(name)) {
    throw new MultichatError('USAGE', `--name 星名须为 1-32 个字母/数字/./_/-（禁冒号——tcp 限定词语法保留字），收到：${name}`);
  }
  const lower = name.toLowerCase();
  mutateBrokerFile(file, (doc) => {
    const star = doc.stars.find((s) => s.starId === starId);
    if (star === undefined) throw new MultichatError('USAGE', `--star ${starId} 不在注册表——crosschat serve --list 可查`);
    const clash = doc.stars.find((s) => s !== star && (s.name?.toLowerCase() === lower || s.starId === name));
    if (clash !== undefined) {
      throw new MultichatError('USAGE', `星名 ${name} 与既有星 ${clash.name ?? clash.starId} 冲突（唯一性大小写不敏感，且不得与 starId 相同）`);
    }
    star.name = name;
  });
}

/**
 * --add-star <名> 校验+落星：新星 {starId: 12hex, name, 空 nodes, 空册}。
 * splice 保未知段 → 在跑 broker 的册写不会抹掉它；重启 serve 托管。
 * 返回新星 starId。
 */
export function addStarTo(file: string, name: string): string {
  if (!STAR_NAME_RE.test(name)) {
    throw new MultichatError('USAGE', `--add-star 星名须为 1-32 个字母/数字/./_/-（禁冒号——tcp 限定词语法保留字），收到：${name}`);
  }
  const lower = name.toLowerCase();
  let starId = '';
  mutateBrokerFile(file, (doc) => {
    const clash = doc.stars.find((s) => s.name?.toLowerCase() === lower || s.starId === name);
    if (clash !== undefined) {
      throw new MultichatError('USAGE', `星名 ${name} 与既有星 ${clash.name ?? clash.starId} 冲突（唯一性大小写不敏感，且不得与 starId 相同）`);
    }
    starId = randomBytes(6).toString('hex');
    doc.stars.push({ starId, name, nodes: [], roster: [] });
  });
  return starId;
}

/**
 * 032 bootstrap（H1 唯一安装路径）：空表时造 stars[0]（starId 生成+hostname
 * 缺省星名+空表）。serve 裸跑与变更类管理命令（--port/--name/--gen-key/
 * --add-star）懒调用——裸机 gen-key 直接可用；`--connect`（节点机）永不触发。
 * 返回是否新建（serve 用它出"已初始化星"声）。
 */
export function bootstrapStar1(file: string, fallbackHostname: string): boolean {
  let created = false;
  mutateBrokerFile(file, (doc) => {
    if (doc.stars.length === 0) {
      const name = sanitizeStarName(fallbackHostname);
      doc.stars.push({ starId: randomBytes(6).toString('hex'), ...(name === undefined ? {} : { name }), nodes: [], roster: [] });
      created = true;
    }
  });
  return created;
}

/** 补齐缺 starId 的星（手编文件兜底；有变化才写）。返回是否写过。 */
export function ensureStarIds(file: string): boolean {
  let changed = false;
  mutateBrokerFile(file, (doc) => {
    for (const star of doc.stars) {
      if (star.starId === undefined) {
        star.starId = randomBytes(6).toString('hex');
        changed = true;
      }
    }
  });
  return changed;
}
