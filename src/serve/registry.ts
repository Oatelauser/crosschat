/**
 * broker.json 注册表（032 单形状终局）：**一个文件装全部**——`{port?, stars:
 * [{starId, name?, nodes, roster}]}`，注册表与星册同文件，读写永远只有这一种
 * 形状（无兼容归一——旧形状按损坏处理 .bak 重建，032 用户拍板非兼容升级）。
 *
 * 写纪律（三铁律，代码强制）：所有写者走 `mutateBrokerFile`（同步读→只拼
 * 自己的段→tmp+rename）；段所有权 roster=broker 独占 / nodes=CLI+onConnect
 * 回写共管 / name+加星=CLI / port=**手编专属**（034 起 --port 无命令——改文件
 * 重启生效）；starId 永不变（星身份锚，改名零级联）。
 */
import { closeSync, copyFileSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { MultichatError } from '../errors.js';
import { normalizeMid } from '../platform/machine-id.js';
import { credentialRevision, starRevision } from './management-state.js';

export interface NodeEntry {
  label: string;
  /** 星钥（机器身份）。034 起可选——管理钥条目只有 adminKey（不是机器身份）。 */
  key?: string;
  machineId?: string;
  machineName?: string;
  addedAt: string;
  /**
   * 034 星管理钥（与星钥同 nodes 表同条目形状存放——发放即绑定一星）：管理钥
   * 条目只有 label+adminKey+addedAt（无 key/machineId——不是机器身份）。钥匙
   * 只存 broker 侧与持有者 node.json 条目，永不过线（挑战应答）。
   */
  adminKey?: string;
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
  /**
   * 在线态（**内存瞬态，033 起不落盘**——台账静态化）：活性归运行时（内存连接
   * 表 + status-broker.json）。读侧缺字段=默认离线（聚合器重连数秒自愈）；旧
   * 文件残留的 online 值读入即剥除，写侧永远不出文件。
   */
  online?: boolean;
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
  return raw
    .filter(
      (e): e is RosterEntry =>
        e !== null && typeof e === 'object' && typeof (e as RosterEntry).sessionId === 'string' && (e as RosterEntry).sessionId !== '',
    )
    .map(stripOnline);
}

/** 033：roster 条目剥 online（读侧旧值归一、写侧静态化共用——台账只存静态）。 */
function stripOnline(e: RosterEntry): RosterEntry {
  const copy = { ...e };
  delete copy.online;
  return copy;
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
  // 033 台账静态化：写侧 roster 剥 online（活性归运行时——缺字段=默认离线）。
  // 本函数是裸写器（测试/播种直接写部分形状）——stars/roster 缺席时原样写。
  const staticDoc = Array.isArray(doc.stars)
    ? { ...doc, stars: doc.stars.map((s) => (Array.isArray(s.roster) ? { ...s, roster: s.roster.map(stripOnline) } : s)) }
    : doc;
  writeFileSync(tmp, `${JSON.stringify(staticDoc, null, 2)}\n`, 'utf8');
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
 * 星域发钥（--star 限定——036 起单星也须指名，CLI 面不再隐式选中）。splice
 * 只动目标星的 nodes 段，roster 段原样保留。
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

/**
 * 034 --gen-admin-key <label> --star <星>：发星管理钥（一星一权；条目落该星
 * nodes 表，与星钥同条目形状）。label 与星名同字符集（禁冒号）；节点/管理钥
 * 共用 label 空间（--list 一表可见，重名拒绝）。
 */
export interface GenAdminKeyResult {
  label: string;
  adminKey: string;
}

export function genAdminKeyFor(file: string, starId: string, label: string): GenAdminKeyResult {
  if (!STAR_NAME_RE.test(label)) {
    throw new MultichatError('USAGE', `--gen-admin-key label 须为 1-32 个字母/数字/./_/-（禁冒号），收到：${label}`);
  }
  let adminKey = '';
  mutateBrokerFile(file, (doc) => {
    const star = doc.stars.find((s) => s.starId === starId);
    if (star === undefined) throw new MultichatError('USAGE', `--star ${starId} 不在注册表——crosschat serve --list 可查`);
    if (star.nodes.some((n) => n.label === label)) {
      throw new MultichatError('USAGE', `label ${label} 在该星已存在（节点与管理钥共用 label 空间）——换一个`);
    }
    adminKey = randomBytes(32).toString('hex');
    star.nodes.push({ label, adminKey, addedAt: new Date().toISOString() });
  });
  return { label, adminKey };
}

/**
 * 034 --remove-admin-key <label|前缀>（仅 broker 主本机）：吊星管理钥。label
 * 精确 → 前缀唯一（歧义教加长）；零命中返回 undefined（幂等报告由调用方打印）。
 * 被吊钥的下一次挑战应答即 BAD_AUTH（验证面每连接现读台账）。
 */
export function removeAdminKeyFor(file: string, starId: string, labelOrPrefix: string): string | undefined {
  let removed: string | undefined;
  mutateBrokerFile(file, (doc) => {
    const star = doc.stars.find((s) => s.starId === starId);
    if (star === undefined) return;
    const admins = star.nodes.filter((n) => n.adminKey !== undefined);
    const exact = admins.find((n) => n.label === labelOrPrefix);
    const hits = exact !== undefined ? [exact] : admins.filter((n) => n.label.startsWith(labelOrPrefix));
    if (hits.length === 1) {
      removed = hits[0]!.label;
      star.nodes = star.nodes.filter((n) => n !== hits[0]);
    } else if (hits.length > 1) {
      throw new MultichatError('USAGE', `--remove-admin-key ${labelOrPrefix} 前缀命中多个管理钥（${hits.map((n) => n.label).join('、')}）——加长前缀使其唯一`);
    }
  });
  return removed;
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
 * 033 node.json 最小读写面（星生命周期库函数自用——加/删星同步 broker 机自
 * 登记条目）。只做结构性搬运不做校验（完整解析在 node.ts readNodeConfig）；
 * 损坏/缺失文件按 undefined 处理，绝不因 node.json 坏而坏台账。
 */
interface NodeJsonRaw { brokers: Array<Record<string, unknown>>; showName?: string }

function nodeJsonOf(brokerFile: string): string {
  return join(dirname(brokerFile), 'node.json');
}

function readNodeJsonRaw(file: string): NodeJsonRaw | undefined {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as NodeJsonRaw | null;
    if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.brokers)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function writeNodeJsonRaw(file: string, doc: NodeJsonRaw): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}

/** 033 add-star 自登记播种（与 serve.ts ensureSelfEntries 同语义的最小面）。 */
export interface AddStarSelfOpts {
  /** 本机 machineId（缺失=不自登记，纯预配加星）。 */
  machineId?: string;
  /** 本机 hostname（node.json 首写缺省显示名/册内 machineName 兜底）。 */
  hostname?: string;
  /** node.json 自用条目的端口（broker 监听口；调用方必给）。 */
  port?: number;
}

/**
 * --add-star <名> 校验+落星：新星 {starId: 12hex, name, 空 nodes, 空册}。
 * splice 保未知段 → 在跑 broker 的册写不会抹掉它。033 起（台账静态化+热闭环）
 * 可带自登记播种：star.nodes 落 self 条目 + broker 机 node.json 追加自用条目
 * （127.0.0.1）——热加星后内挂聚合器即有钥匙可挂，免重启。返回新星 starId。
 */
export function addStarTo(file: string, name: string, self: AddStarSelfOpts = {}): string {
  if (!STAR_NAME_RE.test(name)) {
    throw new MultichatError('USAGE', `--add-star 星名须为 1-32 个字母/数字/./_/-（禁冒号——tcp 限定词语法保留字），收到：${name}`);
  }
  const lower = name.toLowerCase();
  const wantSelf = self.machineId !== undefined && self.machineId !== '';
  const selfKey = randomBytes(32).toString('hex');
  const nodeJson = nodeJsonOf(file);
  const nodeDoc = readNodeJsonRaw(nodeJson);
  const nodeExisted = nodeDoc !== undefined;
  const shown = sanitizeName(nodeDoc?.showName ?? (nodeExisted ? undefined : self.hostname)) ?? self.hostname;
  let starId = '';
  mutateBrokerFile(file, (doc) => {
    const clash = doc.stars.find((s) => s.name?.toLowerCase() === lower || s.starId === name);
    if (clash !== undefined) {
      throw new MultichatError('USAGE', `星名 ${name} 与既有星 ${clash.name ?? clash.starId} 冲突（唯一性大小写不敏感，且不得与 starId 相同）`);
    }
    starId = randomBytes(6).toString('hex');
    const first = doc.stars.length === 0;
    doc.stars.push({
      starId,
      name,
      nodes: wantSelf
        ? [{
            label: first ? 'self' : `self-${name}`,
            key: selfKey,
            machineId: self.machineId,
            ...(shown === undefined || shown === '' ? {} : { machineName: shown }),
            addedAt: new Date().toISOString(),
          }]
        : [],
      roster: [],
    });
  });
  if (wantSelf && self.port !== undefined) {
    // foreign 判定与 ensureSelfEntries 同款：既存 node.json 无任何自用钥匙=他星
    // 配置（不追加自用条目）；已有任一自用钥匙/首建 → 正常补条目。
    const doc0 = nodeDoc ?? { brokers: [] as Array<Record<string, unknown>> };
    const owned = new Set(
      loadBrokerFile(file).stars.flatMap((s) => s.nodes.filter((n) => n.machineId === self.machineId).map((n) => n.key)),
    );
    const foreign = nodeExisted && doc0.brokers.length > 0 && !doc0.brokers.some((e) => e.key === selfKey || (typeof e.key === 'string' && owned.has(e.key)));
    if (!foreign && !doc0.brokers.some((e) => e.starId === starId)) {
      doc0.brokers.push({ host: '127.0.0.1', port: self.port, name, starId, key: selfKey });
      const next: NodeJsonRaw = nodeExisted
        ? doc0
        : { brokers: doc0.brokers, ...(self.hostname === undefined || self.hostname === '' ? {} : { showName: self.hostname }) }; // 首建落默认显示名（ensureSelfEntries 同款）
      writeNodeJsonRaw(nodeJson, next);
    }
  }
  return starId;
}

/** 033 --remove-star 的删除回执（将死清单/已删回显共用）。 */
export interface RemovedStarInfo {
  name?: string;
  nodes: number;
  roster: number;
}

/**
 * 033 --remove-star：册随星葬——splice broker.json 星段 + broker 机 node.json
 * 自登记条目摘除（按 starId）。最后一颗星允许删（零星合法）。无墓碑无复活。
 * 返回删除摘要；星不在台账（并发已删）返回 undefined。
 */
export function removeStarFrom(file: string, starId: string): RemovedStarInfo | undefined {
  let removed: RemovedStarInfo | undefined;
  mutateBrokerFile(file, (doc) => {
    const index = doc.stars.findIndex((s) => s.starId === starId);
    if (index < 0) return;
    const star = doc.stars[index]!;
    const info: RemovedStarInfo = { nodes: star.nodes.length, roster: star.roster.length };
    if (star.name !== undefined) info.name = star.name;
    removed = info;
    doc.stars.splice(index, 1);
  });
  const nodeJson = nodeJsonOf(file);
  const nodeDoc = readNodeJsonRaw(nodeJson);
  if (nodeDoc !== undefined && nodeDoc.brokers.some((e) => e.starId === starId)) {
    writeNodeJsonRaw(nodeJson, { ...nodeDoc, brokers: nodeDoc.brokers.filter((e) => e.starId !== starId) });
  }
  return removed;
}

export interface CredentialRemovalExpected { credentialRevision: string; machineId: string | null }
export interface StarRemovalExpected { starRevision: string }
export interface ExactManagementRejected { kind: 'rejected'; reason: 'target-changed' | 'not-found' | 'invalid-target' }
export type ExactCredentialRemoval = { kind: 'removed'; credential: NodeEntry } | ExactManagementRejected;
export type ExactStarRemoval = { kind: 'removed'; removed: RemovedStarInfo; cleanupFailed?: true } | ExactManagementRejected;
const managementRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const validRevision = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const completeMachine = (value: string) => /^[a-fA-F0-9-]+$/.test(value) && normalizeMid(value).length === 32;
function invalidManagementSource(): never { throw new Error('管理台账配置不完整或损坏；未执行精确删除。'); }

function managementParents(file: string): void {
  let directory = dirname(resolve(file));
  for (;;) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) invalidManagementSource();
    const parent = dirname(directory);
    if (parent === directory) return;
    directory = parent;
  }
}
/** Expected writes own a fresh exclusive temporary file; the legacy fixed-tmp writer is unchanged. */
function writeManagementJson(file: string, doc: object): void {
  managementParents(file);
  const target = lstatSync(file, { bigint: true });
  if (!target.isFile() || target.isSymbolicLink()) invalidManagementSource();
  const temporary = `${file}.tui-${randomBytes(16).toString('hex')}.tmp`;
  let descriptor: number | undefined;
  let created = false;
  try {
    descriptor = openSync(temporary, 'wx', 0o600); created = true;
    writeFileSync(descriptor, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    closeSync(descriptor); descriptor = undefined;
    managementParents(file);
    const current = lstatSync(file, { bigint: true });
    if (!current.isFile() || current.isSymbolicLink() || current.dev !== target.dev || current.ino !== target.ino) invalidManagementSource();
    renameSync(temporary, file); created = false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (created) unlinkSync(temporary);
  }
}
function writeManagementBroker(file: string, doc: BrokerFile): void {
  writeManagementJson(file, { ...doc, stars: doc.stars.map((star) => ({ ...star, roster: star.roster.map(stripOnline) })) });
}

/** Strict bounded reads for expected writes. Refusals must never repair or rewrite a source. */
function readManagementJson(file: string): unknown {
  managementParents(file);
  const before = lstatSync(file, { bigint: true });
  const limit = 2 * 1024 * 1024;
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(limit)) invalidManagementSource();
  const fd = openSync(file, 'r');
  try {
    const stat = fstatSync(fd, { bigint: true });
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || stat.size > BigInt(limit)) invalidManagementSource();
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    for (;;) {
      const count = readSync(fd, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
      if (length > limit) invalidManagementSource();
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length))) as unknown;
  } catch { return invalidManagementSource(); }
  finally { closeSync(fd); }
}
function readManagementBroker(file: string): BrokerFile {
  const value = readManagementJson(file);
  if (!managementRecord(value) || !Array.isArray(value.stars)) invalidManagementSource();
  const ids = new Set<string>();
  const optionalText = (record: Record<string, unknown>, fields: readonly string[]) => fields.every((field) => record[field] === undefined || typeof record[field] === 'string');
  const stars = value.stars.map((item): StarRecord => {
    if (!managementRecord(item) || typeof item.starId !== 'string' || !item.starId || ids.has(item.starId) || !optionalText(item, ['name'])
      || !Array.isArray(item.nodes) || (item.roster !== undefined && !Array.isArray(item.roster))) invalidManagementSource();
    ids.add(item.starId);
    const labels = new Set<string>();
    const nodes = item.nodes.map((node): NodeEntry => {
      if (!managementRecord(node) || typeof node.label !== 'string' || !node.label || labels.has(node.label) || typeof node.addedAt !== 'string'
        || !Number.isFinite(Date.parse(node.addedAt)) || !optionalText(node, ['key', 'adminKey', 'machineId', 'machineName'])
        || (typeof node.key === 'string' && node.key !== '') === (typeof node.adminKey === 'string' && node.adminKey !== '')
        || (typeof node.machineId === 'string' && node.machineId !== '' && (!completeMachine(node.machineId) || typeof node.adminKey === 'string'))) invalidManagementSource();
      labels.add(node.label);
      return { ...node, label: node.label, addedAt: node.addedAt,
        ...(typeof node.key === 'string' ? { key: node.key } : {}), ...(typeof node.adminKey === 'string' ? { adminKey: node.adminKey } : {}),
        ...(typeof node.machineId === 'string' ? { machineId: node.machineId } : {}), ...(typeof node.machineName === 'string' ? { machineName: node.machineName } : {}) };
    });
    const members = new Set<string>();
    const roster = (item.roster ?? []).map((member): RosterEntry => {
      if (!managementRecord(member) || typeof member.sessionId !== 'string' || !member.sessionId || members.has(member.sessionId)
        || typeof member.machine !== 'string' || !completeMachine(member.machine) || !optionalText(member, ['name', 'tool', 'machineName', 'extendsName', 'extendsMachine'])
        || (member.temporary !== undefined && typeof member.temporary !== 'boolean')) invalidManagementSource();
      members.add(member.sessionId);
      return { ...member, sessionId: member.sessionId, machine: member.machine,
        ...(typeof member.name === 'string' ? { name: member.name } : {}), ...(typeof member.tool === 'string' ? { tool: member.tool } : {}),
        ...(typeof member.machineName === 'string' ? { machineName: member.machineName } : {}), ...(typeof member.extendsName === 'string' ? { extendsName: member.extendsName } : {}),
        ...(typeof member.extendsMachine === 'string' ? { extendsMachine: member.extendsMachine } : {}), ...(typeof member.temporary === 'boolean' ? { temporary: member.temporary } : {}) };
    });
    return { ...item, starId: item.starId, ...(typeof item.name === 'string' ? { name: item.name } : {}), nodes, roster };
  });
  return { ...value, ...(typeof value.port === 'number' ? { port: value.port } : {}), stars };
}

/** The broker receives the removed secret-bearing entry only for immediate revocation. */
export function removeCredentialExactFor(file: string, starId: string, label: string, kind: 'node' | 'admin', expected: CredentialRemovalExpected): ExactCredentialRemoval {
  if (!expected || !validRevision(expected.credentialRevision) || (expected.machineId !== null && (typeof expected.machineId !== 'string' || !completeMachine(expected.machineId)))) return { kind: 'rejected', reason: 'invalid-target' };
  const doc = readManagementBroker(file);
  const star = doc.stars.find((item) => item.starId === starId);
  const index = star?.nodes.findIndex((item) => item.label === label) ?? -1;
  if (!star || index < 0) return { kind: 'rejected', reason: 'not-found' };
  const credential = star.nodes[index];
  const actualKind = credential.adminKey ? 'admin' : 'node';
  const binding = credential.machineId ? normalizeMid(credential.machineId) : null;
  if (actualKind !== kind || credentialRevision(credential) !== expected.credentialRevision || binding !== expected.machineId) return { kind: 'rejected', reason: 'target-changed' };
  star.nodes.splice(index, 1);
  writeManagementBroker(file, doc);
  return { kind: 'removed', credential };
}

/** Full static impact check and deletion share one synchronous fresh-source transaction. */
export function removeStarExactFrom(file: string, starId: string, expected: StarRemovalExpected): ExactStarRemoval {
  if (!expected || !validRevision(expected.starRevision)) return { kind: 'rejected', reason: 'invalid-target' };
  const doc = readManagementBroker(file);
  const index = doc.stars.findIndex((item) => item.starId === starId);
  if (index < 0) return { kind: 'rejected', reason: 'not-found' };
  const star = doc.stars[index];
  if (starRevision(star) !== expected.starRevision) return { kind: 'rejected', reason: 'target-changed' };
  let nodeDoc: NodeJsonRaw | undefined;
  const nodeFile = nodeJsonOf(file);
  try {
    const value = readManagementJson(nodeFile);
    if (!managementRecord(value) || !Array.isArray(value.brokers) || !value.brokers.every(managementRecord)) invalidManagementSource();
    nodeDoc = { ...value, brokers: value.brokers };
  } catch (error) {
    if (!managementRecord(error) || error.code !== 'ENOENT') throw error;
  }
  const removed: RemovedStarInfo = { ...(star.name === undefined ? {} : { name: star.name }), nodes: star.nodes.length, roster: star.roster.length };
  doc.stars.splice(index, 1);
  writeManagementBroker(file, doc);
  if (nodeDoc?.brokers.some((entry) => entry.starId === starId)) {
    try { writeManagementJson(nodeFile, { ...nodeDoc, brokers: nodeDoc.brokers.filter((entry) => entry.starId !== starId) }); }
    catch { return { kind: 'removed', removed, cleanupFailed: true }; }
  }
  return { kind: 'removed', removed };
}

/**
 * 033 --show-name（broker 机热改）：node.json 顶层 showName 净化落盘（空=
 * 清除，017 语义）。文件不存在则不动（本机尚无任何星配置——冷路径教学由
 * 调用方负责）。返回净化后的名字（清除=undefined）。
 */
export function setShowNameFor(nodeJsonFile: string, name: string): string | undefined {
  const clean = sanitizeName(name);
  const doc = readNodeJsonRaw(nodeJsonFile);
  if (doc === undefined) return undefined;
  if (clean === undefined) delete doc.showName;
  else doc.showName = clean;
  writeNodeJsonRaw(nodeJsonFile, doc);
  return clean;
}

/**
 * 036 --star <星> --show-name <名>（按星机器名）：node.json 条目级 showName
 * 覆盖——缺省回落顶层全局值（修订 017"单一事实源"为"全局默认+按星覆盖"）。
 * 空=清除条目覆盖（回落全局）。按条目 starId 定位；文件缺失/无该星条目=异常
 * 形态（USAGE 教学上抛）。返回净化后的名字（清除=undefined）。
 */
export function setStarShowNameFor(nodeJsonFile: string, starId: string, name: string): string | undefined {
  const clean = sanitizeName(name);
  const doc = readNodeJsonRaw(nodeJsonFile);
  if (doc === undefined) {
    throw new MultichatError('USAGE', '本机尚无 node.json（未入任何星）——条目级显示名无从谈起，先入星再按星命名');
  }
  const hit = doc.brokers.find((e) => e.starId === starId);
  if (hit === undefined) {
    throw new MultichatError('USAGE', `node.json 无 starId=${starId} 的条目（本机不在该星）——crosschat serve --list 可查托管星`);
  }
  if (clean === undefined) delete hit.showName;
  else hit.showName = clean;
  writeNodeJsonRaw(nodeJsonFile, doc);
  return clean;
}

/**
 * 032 bootstrap 已随 033 退役（用户拍板"serve 永不造星"）：空表=合法待配状态，
 * 首星走 `crosschat serve --add-star <星名>` 显式命名（hostname 丑名随葬）。
 * 预配机不断腿——CLI 冷路径直调本文件库函数即可起表。
 */

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
