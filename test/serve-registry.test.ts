import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ensureStarId,
  genKeys,
  listNodes,
  readRegistry,
  registryFileOf,
  removeNode,
  setPort,
  writeRegistry,
} from '../src/serve/registry.js';
import { MultichatError } from '../src/errors.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-serve-reg-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const freshFile = (): string => registryFileOf(mkdtempSync(join(root, 'case-')));

describe('genKeys', () => {
  it('numbers labels sequentially across calls and persists entries', () => {
    const file = freshFile();
    const first = genKeys(file, 2, { host: '192.168.1.5', port: 7260 });
    expect(first.map((r) => r.label)).toEqual(['node-1', 'node-2']);
    const second = genKeys(file, 1, { host: '192.168.1.5', port: 7260 });
    expect(second.map((r) => r.label)).toEqual(['node-3']);
    const labels = listNodes(file).map((n) => n.label);
    expect(labels).toEqual(['node-1', 'node-2', 'node-3']);
  });

  it('emits full node.json content with 2-space indent', () => {
    const file = freshFile();
    const [{ key, nodeJsonContent }] = genKeys(file, 1, { host: '10.0.0.2', port: 9000 });
    expect(nodeJsonContent).toBe(
      `{\n  "brokers": [\n    {\n      "host": "10.0.0.2",\n      "port": 9000,\n      "key": "${key}"\n    }\n  ],\n  "name": "改成「贴这份配置的机器」的名字"\n}\n`,
    );
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses over 10 with USAGE', () => {
    const file = freshFile();
    expect(() => genKeys(file, 11, { host: 'h', port: 1 })).toThrowError(MultichatError);
    try {
      genKeys(file, 0, { host: 'h', port: 1 });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as MultichatError).code).toBe('USAGE');
    }
  });

  it('emits array-shape node.json (brokers[0] carries starId and key)', () => {
    const file = freshFile();
    const [{ key, nodeJsonContent }] = genKeys(file, 1, { host: '10.0.0.2', port: 9000, alias: 'hub', starId: 'a1b2c3d4e5f6' });
    const parsed = JSON.parse(nodeJsonContent) as { brokers: { host: string; port: number; alias: string; starId: string; key: string }[]; name: string };
    expect(parsed.brokers).toHaveLength(1);
    expect(parsed.brokers[0]).toEqual({ host: '10.0.0.2', port: 9000, alias: 'hub', starId: 'a1b2c3d4e5f6', key });
    expect(parsed.name).toBe('改成「贴这份配置的机器」的名字');
  });
});

describe('ensureStarId', () => {
  it('B0: generates a 12-hex starId, persists it, and is idempotent on re-read', () => {
    const file = freshFile();
    const first = ensureStarId(file);
    expect(first).toMatch(/^[0-9a-f]{12}$/);
    expect(readRegistry(file).starId).toBe(first);
    // 幂等：复读直接返回既有值，不重新生成
    expect(ensureStarId(file)).toBe(first);
    expect(readRegistry(file).starId).toBe(first);
    // 既有节点在 starId 落盘时保留
    genKeys(file, 1, { host: 'h', port: 1, alias: 'a', starId: ensureStarId(file) });
    expect(ensureStarId(file)).toBe(first);
    expect(listNodes(file)).toHaveLength(1);
  });
});

describe('registry file', () => {
  it('treats missing file as empty and keeps port across writes', () => {
    const file = freshFile();
    expect(readRegistry(file)).toEqual({ nodes: [] });
    setPort(file, 7260);
    genKeys(file, 1, { host: 'h', port: 7260 });
    expect(readRegistry(file).port).toBe(7260);
    expect(readRegistry(file).nodes).toHaveLength(1);
  });

  it('backs up a corrupt file to .bak and rebuilds as empty', () => {
    const file = freshFile();
    writeRegistry(file, { nodes: [] });
    const corrupt = '{ this is not json';
    // 直接写坏内容模拟损坏（绕过 writeRegistry 的 JSON 保证）
    writeFileSync(file, corrupt, 'utf8');
    expect(readRegistry(file)).toEqual({ nodes: [] });
    expect(readFileSync(`${file}.bak`, 'utf8')).toBe(corrupt);
  });

  it('removes nodes by label and reports misses', () => {
    const file = freshFile();
    genKeys(file, 2, { host: 'h', port: 1 });
    expect(removeNode(file, 'node-1')).toBe(true);
    expect(listNodes(file).map((n) => n.label)).toEqual(['node-2']);
    expect(removeNode(file, 'node-1')).toBe(false);
    expect(removeNode(file, 'nope')).toBe(false);
    expect(existsSync(file)).toBe(true);
  });
});
