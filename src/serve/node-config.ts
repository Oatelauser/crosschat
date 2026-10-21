/** node.json 兼容读取、归一化与 broker 权威字段同步；不依赖连接客户端。 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MultichatError } from '../errors.js';

/** B0 多星地基：一个 broker 条目（旧形状读进 broker 对象、新形状 brokers[] 元素）。 */
export interface BrokerEntry {
  host: string;
  port: number;
  /** E0 星名（broker 权威，info 帧自动同步；读层把旧 alias 值映射进来）。 */
  name?: string;
  starId?: string;
  key: string;
  /**
   * 034 星管理钥（与星钥同条目——管理身份随星绑定）：远程管理写 op（发钥/删
   * 节点）走挑战应答证明，钥匙永不过线。读 op 星钥即够，无此字段也可用。
   */
  adminKey?: string;
  /**
   * 036 条目级显示名覆盖（broker 机 --star --show-name 写入；node 机手编同
   * 生效）：connect 自报名取 条目级 ?? 顶层全局（修订 017 单一事实源）。
   */
  showName?: string;
}

/** 归一化后的 node.json：旧/新双形状都收进 entries（多条目路由选择是 B1）。 */
export interface NodeConfig {
  entries: BrokerEntry[];
  /** E0 词表换轨：本机显示名（旧文件的顶层 name 读入映射；显示用，寻址权威是 machine-id 前缀）。 */
  showName?: string;
}

/** E0 选择器报错里的条目行：星名与 starId 前 6 位并排（cloud(6b76e1)），拷了就能用。 */
export function formatBrokerEntry(e: BrokerEntry): string {
  const id = e.starId === undefined ? 'starId 未登记' : e.starId.slice(0, 6);
  return `${e.name ?? '(无名)'}(${id})`;
}

/** 会员凭证缺失/损坏的教学报错（send --via tcp: 与 --connect 同用）。 */
export const NOT_JOINED_MESSAGE =
  '本机未入网——向管理员索取 node.json 放到 ~/.crosschat/tcp/（broker 机上 crosschat serve --gen-key 生成）';

/** 单条目净化校验：缺 key/host 或 port 非整数即坏形状。 */
function parseBrokerEntry(raw: unknown): BrokerEntry {
  if (raw === null || typeof raw !== 'object') throw new Error('bad shape');
  const e = raw as { host?: unknown; port?: unknown; name?: unknown; alias?: unknown; starId?: unknown; key?: unknown; adminKey?: unknown; showName?: unknown };
  if (
    typeof e.key !== 'string' || e.key === '' ||
    typeof e.host !== 'string' || typeof e.port !== 'number' || !Number.isInteger(e.port)
  ) {
    throw new Error('bad shape');
  }
  // E0 读层兼容：旧 alias 值映射为星名（新 name 优先）
  const name = typeof e.name === 'string' ? e.name : typeof e.alias === 'string' ? e.alias : undefined;
  return {
    host: e.host,
    port: e.port,
    ...(name === undefined ? {} : { name }),
    ...(typeof e.starId === 'string' ? { starId: e.starId } : {}),
    key: e.key,
    // 034：星管理钥（可选字段——与星钥同条目）
    ...(typeof e.adminKey === 'string' && e.adminKey !== '' ? { adminKey: e.adminKey } : {}),
    // 036：条目级显示名覆盖（可选字段；空串视同缺席——CLI 清除即删键）
    ...(typeof e.showName === 'string' && e.showName !== '' ? { showName: e.showName } : {}),
  };
}

export function readNodeConfig(configFile: string): NodeConfig {
  let raw: string;
  try {
    raw = readFileSync(configFile, 'utf8');
  } catch {
    throw new MultichatError('USAGE', NOT_JOINED_MESSAGE);
  }
  try {
    const parsed = JSON.parse(raw) as {
      broker?: { host?: unknown; port?: unknown; alias?: unknown; starId?: unknown };
      brokers?: unknown;
      key?: unknown;
      name?: unknown;
      showName?: unknown;
    } | null;
    if (parsed === null || typeof parsed !== 'object') throw new Error('bad shape');
    // E0 读层兼容：旧顶层 name 映射为 showName（新 showName 优先）
    const showName =
      typeof parsed.showName === 'string' ? parsed.showName : typeof parsed.name === 'string' ? parsed.name : undefined;
    // 新形状 {brokers: [...], showName}：条目数组原样收进 entries（空数组=坏形状；
    // 顶层多余 starId 忽略——星标识只认条目/starId 槽）
    if (Array.isArray(parsed.brokers)) {
      const entries = parsed.brokers.map(parseBrokerEntry);
      if (entries.length === 0) throw new Error('bad shape');
      return { ...(showName === undefined ? {} : { showName }), entries };
    }
    // 旧形状 {broker: {...}, key, name} → 单元素（行为与 B0 前逐字节等价）
    if (typeof parsed.key !== 'string' || parsed.key === '') throw new Error('bad shape');
    const broker = parsed.broker;
    if (broker === null || typeof broker !== 'object' || typeof broker.host !== 'string' || !Number.isInteger(broker.port)) {
      throw new Error('bad shape');
    }
    return {
      ...(showName === undefined ? {} : { showName }),
      entries: [parseBrokerEntry({ ...broker, key: parsed.key })],
    };
  } catch {
    throw new MultichatError('USAGE', `node.json 损坏（${configFile}）——向管理员重新索取覆盖；${NOT_JOINED_MESSAGE}`);
  }
}

/**
 * E0：info 同步写回——按 key+host+port 定位 node.json 对应条目，starId 仅缺失
 * 补、name 不一致覆盖（broker 权威），一致不写；重写时顺带清旧键（条目 alias
 * 值并轨进 name、顶层 name 改 showName）。tmp+rename 原子写；失败不倒连接。
 */
export function syncNodeJsonEntry(
  configFile: string,
  match: { host: string; port: number; key: string },
  patch: { starId?: string; name?: string },
): void {
  try {
    const parsed = JSON.parse(readFileSync(configFile, 'utf8')) as {
      broker?: Record<string, unknown> | null;
      brokers?: Array<Record<string, unknown> | null>;
      key?: unknown;
      name?: unknown;
      showName?: unknown;
    } | null;
    if (parsed === null || typeof parsed !== 'object') return;
    const sameTarget = (e: unknown): e is Record<string, unknown> => {
      if (e === null || typeof e !== 'object') return false;
      const rec = e as Record<string, unknown>;
      return rec.host === match.host && rec.port === match.port && rec.key === match.key;
    };
    let hit: Record<string, unknown> | undefined;
    if (Array.isArray(parsed.brokers)) {
      hit = parsed.brokers.find(sameTarget);
    } else if (parsed.broker !== null && typeof parsed.broker === 'object') {
      hit = sameTarget({ ...parsed.broker, key: parsed.key }) ? parsed.broker : undefined;
    }
    if (hit === undefined) return;
    let changed = false;
    if (patch.starId !== undefined && hit.starId === undefined) {
      hit.starId = patch.starId;
      changed = true;
    }
    if (patch.name !== undefined && hit.name !== patch.name) {
      hit.name = patch.name;
      changed = true;
    }
    if (!changed) return;
    // 词表换轨：重写时旧 alias 值并轨进 name（未覆盖时）并删旧键
    if (hit.name === undefined && typeof hit.alias === 'string') hit.name = hit.alias;
    delete hit.alias;
    if (parsed.showName === undefined && typeof parsed.name === 'string') {
      parsed.showName = parsed.name;
      delete parsed.name;
    }
    const tmp = `${configFile}.tmp`;
    mkdirSync(dirname(configFile), { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    renameSync(tmp, configFile);
  } catch {
    // 同步写失败不倒连接（下次握手再试）
  }
}

