/**
 * 032 注册表单形状：loadBrokerFile/writeBrokerFile/mutateBrokerFile 三纪律、
 * 星域 CLI 单实现（genKeysFor/setNameFor/removeNodeFor/addStarTo/selectStar）、
 * 非兼容语义（旧形状按损坏 .bak 重建）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  addStarTo,
  ensureStarIds,
  genKeysFor,
  loadBrokerFile,
  mutateBrokerFile,
  registryFileOf,
  removeNodeFor,
  sanitizeStarName,
  selectStar,
  setNameFor,
  setPortFor,
  writeBrokerFile,
} from '../src/serve/registry.js';
import { MultichatError } from '../src/errors.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-serve-reg-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const key = (c: string) => c.repeat(64);
const node = (label: string, k: string, machineId?: string) => ({ label, key: k, ...(machineId === undefined ? {} : { machineId }), addedAt: '2026-01-01T00:00:00.000Z' });
const fileOf = (): string => {
  const dir = mkdtempSync(join(root, 'case-'));
  mkdirSync(join(dir, 'tcp'), { recursive: true });
  return registryFileOf(dir);
};

describe('032 单形状读写', () => {
  it('写读往返：stars[] 内嵌 roster；文件缺失=空表', () => {
    const file = fileOf();
    expect(loadBrokerFile(file).stars).toEqual([]);
    writeBrokerFile(file, {
      port: 7260,
      stars: [{ starId: 'aaaabbbbcccc', name: 'alpha', nodes: [node('self', key('s'))], roster: [{ sessionId: 'sess-1', machine: 'm', online: true }] }],
    });
    const doc = loadBrokerFile(file);
    expect(doc.port).toBe(7260);
    expect(doc.stars[0]!.name).toBe('alpha');
    expect(doc.stars[0]!.nodes).toHaveLength(1);
    expect(doc.stars[0]!.roster).toHaveLength(1);
  });

  it('非兼容：旧单星形状（顶层 nodes）按损坏处理——.bak 兜底+空表重建', () => {
    const file = fileOf();
    writeFileSync(file, JSON.stringify({ port: 7260, starId: 'aaaabbbbcccc', name: 'old', nodes: [node('n1', key('a'))] }));
    const doc = loadBrokerFile(file);
    expect(doc.stars).toEqual([]); // 不归一——bootstrap 重建路
    expect(existsSync(`${file}.bak`)).toBe(true); // 钥匙资产留底
    expect((JSON.parse(readFileSync(`${file}.bak`, 'utf8')) as { nodes: unknown[] }).nodes).toHaveLength(1);
  });

  it('mutateBrokerFile 拼段纪律：星域写者保留其他星的段落（addStar 在跑安全的地基）', () => {
    const file = fileOf();
    writeBrokerFile(file, { stars: [
      { starId: 'aaaabbbbcccc', name: 'alpha', nodes: [node('n1', key('a'))], roster: [{ sessionId: 'sa', machine: 'ma', online: true }] },
      { starId: 'bbbbaaaacccc', name: 'beta', nodes: [], roster: [] },
    ] });
    // 模拟：beta 侧（新加的星）先写 roster，alpha 侧基于"旧快照"整写——被纪律拦
    mutateBrokerFile(file, (doc) => {
      const beta = doc.stars.find((s) => s.starId === 'bbbbaaaacccc')!;
      beta.roster = [{ sessionId: 'sb', machine: 'mb', online: false }];
    });
    mutateBrokerFile(file, (doc) => {
      const alpha = doc.stars.find((s) => s.starId === 'aaaabbbbcccc')!;
      alpha.nodes.push(node('n2', key('b')));
    });
    const doc = loadBrokerFile(file);
    expect(doc.stars.find((s) => s.name === 'beta')!.roster).toHaveLength(1); // 前一写者的段落原样
    expect(doc.stars.find((s) => s.name === 'alpha')!.nodes).toHaveLength(2);
  });
});

describe('星域 CLI 单实现', () => {
  it('genKeysFor：label 顺延、node.json 文本带星名/starId、只动目标星 nodes', () => {
    const file = fileOf();
    writeBrokerFile(file, { stars: [{ starId: 'aaaabbbbcccc', name: 'alpha', nodes: [], roster: [{ sessionId: 'x', machine: 'm', online: true }] }] });
    const results = genKeysFor(file, 'aaaabbbbcccc', 2, { host: '10.0.0.2', port: 9000, name: 'alpha' });
    expect(results.map((r) => r.label)).toEqual(['node-1', 'node-2']);
    const parsed = JSON.parse(results[0]!.nodeJsonContent) as { brokers: Array<{ name?: string; starId?: string; key: string }> };
    expect(parsed.brokers[0]!.name).toBe('alpha');
    expect(parsed.brokers[0]!.starId).toBe('aaaabbbbcccc');
    expect(parsed.brokers[0]!.key).toBe(results[0]!.key);
    expect(() => genKeysFor(file, 'aaaabbbbcccc', 11, { host: 'h', port: 1 })).toThrowError(MultichatError);
    const doc = loadBrokerFile(file);
    expect(doc.stars[0]!.nodes).toHaveLength(2);
    expect(doc.stars[0]!.roster).toHaveLength(1); // 册段未被发钥触碰
    expect(() => genKeysFor(file, 'dddd00001111', 1, { host: 'h', port: 1 })).toThrowError(/不在注册表/);
  });

  it('selectStar：星名精确 → starId 前缀唯一 → 零/多命中教学', () => {
    const stars = [
      { starId: 'aaaabbbbcccc', name: 'alpha', nodes: [], roster: [] },
      { starId: 'bbbbaaaacccc', name: 'beta', nodes: [], roster: [] },
    ];
    expect(selectStar(stars, 'alpha').name).toBe('alpha');
    expect(selectStar(stars, 'bbbb').starId).toBe('bbbbaaaacccc');
    expect(() => selectStar(stars, 'zzz')).toThrowError(/不匹配任何星/);
  });

  it('setNameFor：星名唯一性大小写不敏感、不得与 starId 相同；零级联（roster 原样）', () => {
    const file = fileOf();
    writeBrokerFile(file, { stars: [
      { starId: 'aaaabbbbcccc', name: 'alpha', nodes: [], roster: [{ sessionId: 'x', machine: 'm', online: true }] },
      { starId: 'bbbbaaaacccc', name: 'beta', nodes: [], roster: [] },
    ] });
    setNameFor(file, 'aaaabbbbcccc', 'gamma');
    expect(loadBrokerFile(file).stars[0]!.name).toBe('gamma');
    expect(loadBrokerFile(file).stars[0]!.roster).toHaveLength(1);
    expect(() => setNameFor(file, 'aaaabbbbcccc', 'BETA')).toThrowError(/冲突/); // 大小写不敏感
    expect(() => setNameFor(file, 'aaaabbbbcccc', 'bbbbaaaacccc')).toThrowError(/冲突/); // 与 starId 相同
    expect(() => setNameFor(file, 'aaaabbbbcccc', 'bad:name')).toThrowError(MultichatError);
  });

  it('addStarTo：大小写撞名/starId 撞名拒绝；新星空表落位', () => {
    const file = fileOf();
    writeBrokerFile(file, { stars: [{ starId: 'aaaabbbbcccc', name: 'alpha', nodes: [], roster: [] }] });
    const id = addStarTo(file, 'beta');
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    expect(loadBrokerFile(file).stars[1]).toMatchObject({ name: 'beta', nodes: [], roster: [] });
    expect(() => addStarTo(file, 'ALPHA')).toThrowError(/冲突/);
    expect(() => addStarTo(file, 'aaaabbbbcccc')).toThrowError(/冲突/);
  });

  it('removeNodeFor / setPortFor / ensureStarIds', () => {
    const file = fileOf();
    writeBrokerFile(file, { stars: [
      { starId: 'aaaabbbbcccc', nodes: [node('n1', key('a')), node('n2', key('b'))], roster: [] },
      { nodes: [], roster: [] }, // 手编无名星
    ] });
    expect(removeNodeFor(file, 'aaaabbbbcccc', 'n1')).toBe(true);
    expect(removeNodeFor(file, 'aaaabbbbcccc', 'n1')).toBe(false);
    setPortFor(file, 7777);
    const doc = loadBrokerFile(file);
    expect(doc.port).toBe(7777);
    expect(doc.stars[0]!.nodes).toHaveLength(1);
    expect(ensureStarIds(file)).toBe(true); // 手编无名星补 id
    expect(loadBrokerFile(file).stars[1]!.starId).toMatch(/^[0-9a-f]{12}$/);
  });

  it('sanitizeStarName：剥非法字符截 32', () => {
    expect(sanitizeStarName('My-Host_01.abc')).toBe('My-Host_01.abc');
    expect(sanitizeStarName('主host-01!')).toBe('host-01'); // 只留字符集内
    expect(sanitizeStarName('主机')).toBeUndefined();
  });
});
