import { MultichatError } from '../errors.js';
import { formatBrokerEntry } from './node-config.js';
import type { BrokerEntry, NodeConfig } from './node-config.js';

/**
 * B2：--connect 选择器解析（E0 起与 via-tcp 的 selectBrokerEntry 同判定序）：
 * 星名精确匹配 → starId 前缀唯一匹配（歧义教加长）；无命中时单条目走旧
 * "星名不符拒绝"校验路径（旧形状兼容），多条目列条目并给示例。'' = entries[0]。
 */
export function selectConnectEntry(selector: string, config: NodeConfig): { entry: BrokerEntry; selector: string } {
  const entries = config.entries;
  if (entries.length === 0) throw new MultichatError('USAGE', '本机尚未配置 TCP 连接——请先在连接列表添加已有星的配置。');
  if (selector === '') return { entry: entries[0]!, selector };
  const byName = entries.find((e) => e.name === selector);
  if (byName !== undefined) return { entry: byName, selector };
  const byPrefix = entries.filter((e) => e.starId !== undefined && e.starId.startsWith(selector));
  if (byPrefix.length === 1) return { entry: byPrefix[0]!, selector };
  if (byPrefix.length > 1) {
    throw new MultichatError(
      'USAGE',
      `--connect 选择器 ${selector} 的 starId 前缀命中多个星（${byPrefix.map(formatBrokerEntry).join('、')}）——加长前缀使其唯一`,
    );
  }
  if (entries.length === 1) {
    // 旧校验路径：单条目（旧形状）星名不符拒绝；无星名则容忍直连（B2 前行为）
    const name = entries[0]!.name;
    if (name !== undefined) {
      throw new MultichatError(
        'USAGE',
        `--connect ${selector} 与 node.json 条目的星名 ${name} 不符——省略星名直连，或向管理员核对 node.json`,
      );
    }
    return { entry: entries[0]!, selector };
  }
  const list = entries.map(formatBrokerEntry).join('、');
  throw new MultichatError(
    'USAGE',
    `--connect 选择器 ${selector} 不匹配任何条目——本机 node.json 现有：${list}；示例：--connect ${entries[0]!.name ?? entries[0]!.starId ?? ''}`,
  );
}

