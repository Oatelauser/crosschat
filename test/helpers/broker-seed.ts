/**
 * 032 测试播种器：新单形状 broker.json 的 fixture 写入（替代旧 writeRegistry
 * 单星形状）。一次性整写（非 splice）——测试要的就是确定起点。缺省 starId
 * 一律生成（星域对账按 id 匹配，无 id 的星每次对账都会重建状态）。
 */
import { randomBytes } from 'node:crypto';
import { writeBrokerFile, type NodeEntry, type StarRecord } from '../../src/serve/registry.js';

export function seedBroker(
  file: string,
  doc: { port?: number; stars: Array<{ starId?: string; name?: string; nodes: NodeEntry[]; roster?: StarRecord['roster'] }> },
): void {
  writeBrokerFile(file, {
    ...(doc.port === undefined ? {} : { port: doc.port }),
    stars: doc.stars.map((s) => ({
      starId: s.starId ?? randomBytes(6).toString('hex'),
      ...(s.name === undefined ? {} : { name: s.name }),
      nodes: s.nodes,
      roster: s.roster ?? [],
    })),
  });
}
