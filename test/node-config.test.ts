import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MultichatError } from '../src/errors.js';
import {
  formatBrokerEntry,
  NOT_JOINED_MESSAGE,
  parseNodeConfig,
  readNodeConfig,
  syncNodeJsonEntry,
  type BrokerEntry,
} from '../src/serve/node-config.js';
import { selectConnectEntry } from '../src/serve/connect-selector.js';

const roots: string[] = [];
const first: BrokerEntry = { host: 'one', port: 7260, key: 'fixture-key-1', name: 'cloud', starId: 'abcd1111' };
const second: BrokerEntry = { host: 'two', port: 7261, key: 'fixture-key-2', name: 'abcd', starId: 'abcd2222' };

function configFile(raw?: string): { root: string; file: string } {
  const root = mkdtempSync(join(tmpdir(), 'crosschat-node-config-'));
  roots.push(root);
  const file = join(root, 'node.json');
  if (raw !== undefined) writeFileSync(file, raw);
  return { root, file };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('standalone node configuration', () => {
  it('parses injected raw configuration without reading or writing its source path', () => {
    const { root, file } = configFile();
    const raw = JSON.stringify({ brokers: [first], name: 'legacy-machine' });
    expect(parseNodeConfig(raw, file)).toEqual({ entries: [first], showName: 'legacy-machine' });
    expect(parseNodeConfig(raw)).toEqual({ entries: [first], showName: 'legacy-machine' });
    expect(readdirSync(root)).toEqual([]);
  });

  it('retains source-specific corruption errors when parsing injected raw data', () => {
    expect(() => parseNodeConfig('{broken', 'injected-node.json')).toThrowError(
      `node.json 损坏（injected-node.json）——向管理员重新索取覆盖；${NOT_JOINED_MESSAGE}`,
    );
    expect(() => parseNodeConfig('{"brokers":[null]}')).toThrowError(
      `node.json 损坏（node.json）——向管理员重新索取覆盖；${NOT_JOINED_MESSAGE}`,
    );
  });

  it('normalizes legacy aliases without writing, repairing or backing up the file', () => {
    const raw = JSON.stringify({ broker: { host: 'one', port: 7260, alias: 'cloud', starId: 'abcd1111' }, key: 'fixture-key-1', name: 'machine' });
    const { root, file } = configFile(raw);
    expect(readNodeConfig(file)).toEqual({ showName: 'machine', entries: [first] });
    expect(readFileSync(file, 'utf8')).toBe(raw);
    expect(readdirSync(root)).toEqual(['node.json']);
  });

  it('preserves current-field precedence and optional per-star credentials and display names', () => {
    const { file } = configFile(JSON.stringify({
      name: 'old-machine', showName: 'machine',
      brokers: [{ ...first, alias: 'old-star', adminKey: 'fixture-admin-key', showName: 'per-star' }, { ...second, adminKey: '', showName: '' }],
    }));
    expect(readNodeConfig(file)).toEqual({ showName: 'machine', entries: [
      { ...first, adminKey: 'fixture-admin-key', showName: 'per-star' }, second,
    ] });
  });

  it('keeps missing and corrupt error messages and leaves both inputs untouched', () => {
    const { root, file } = configFile();
    expect(() => readNodeConfig(file)).toThrowError(NOT_JOINED_MESSAGE);
    expect(existsSync(file)).toBe(false);
    for (const raw of ['{broken', 'null', '{"brokers":[null]}', '{"brokers":[{"host":"h","port":1.5,"key":"k"}]}']) {
      writeFileSync(file, raw);
      expect(() => readNodeConfig(file)).toThrowError(`node.json 损坏（${file}）——向管理员重新索取覆盖；${NOT_JOINED_MESSAGE}`);
      expect(readFileSync(file, 'utf8')).toBe(raw);
      expect(readdirSync(root)).toEqual(['node.json']);
    }
    try { readNodeConfig(file); } catch (error) {
      expect(error).toBeInstanceOf(MultichatError);
      expect(error).toMatchObject({ code: 'USAGE' });
    }
  });

  it('synchronizes only the matching credential, retaining an existing starId and other entries', () => {
    const { root, file } = configFile(JSON.stringify({ name: 'machine', brokers: [
      { host: first.host, port: first.port, key: first.key, alias: 'old-name', starId: first.starId }, second,
    ] }));
    syncNodeJsonEntry(file, first, { name: 'renamed', starId: 'replacement' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ showName: 'machine', brokers: [
      { ...first, name: 'renamed' }, second,
    ] });
    expect(readdirSync(root)).toEqual(['node.json']);
    const bytes = readFileSync(file, 'utf8');
    syncNodeJsonEntry(file, first, { name: 'renamed', starId: 'replacement' });
    syncNodeJsonEntry(file, { ...first, key: 'other-key' }, { name: 'unrelated' });
    expect(readFileSync(file, 'utf8')).toBe(bytes);
  });

  it('backfills legacy entries and treats read/write failure as best effort', () => {
    const { file } = configFile(JSON.stringify({ name: 'machine', broker: { host: first.host, port: first.port, alias: 'cloud' }, key: first.key }));
    syncNodeJsonEntry(file, first, { starId: first.starId });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ showName: 'machine', broker: { host: first.host, port: first.port, name: 'cloud', starId: first.starId }, key: first.key });
    expect(() => syncNodeJsonEntry(join(file, 'missing.json'), first, { name: 'cloud' })).not.toThrow();
  });
});

describe('standalone connection selection', () => {
  it('uses exact name before starId prefix, retains the selector and supports bare/default connections', () => {
    const config = { entries: [first, second] };
    expect(selectConnectEntry('abcd', config)).toEqual({ entry: second, selector: 'abcd' });
    expect(selectConnectEntry('abcd1', config)).toEqual({ entry: first, selector: 'abcd1' });
    expect(selectConnectEntry('', config)).toEqual({ entry: first, selector: '' });
    const unnamed = { host: 'one', port: 1, key: 'fixture-key' };
    expect(selectConnectEntry('old-selector', { entries: [unnamed] })).toEqual({ entry: unnamed, selector: 'old-selector' });
  });

  it('preserves ambiguity, mismatch and unknown-selector teaching text', () => {
    expect(() => selectConnectEntry('abc', { entries: [first, second] })).toThrowError(
      '--connect 选择器 abc 的 starId 前缀命中多个星（cloud(abcd11)、abcd(abcd22)）——加长前缀使其唯一',
    );
    expect(() => selectConnectEntry('other', { entries: [first] })).toThrowError(
      '--connect other 与 node.json 条目的星名 cloud 不符——省略星名直连，或向管理员核对 node.json',
    );
    expect(() => selectConnectEntry('other', { entries: [first, second] })).toThrowError(
      '--connect 选择器 other 不匹配任何条目——本机 node.json 现有：cloud(abcd11)、abcd(abcd22)；示例：--connect cloud',
    );
    expect(formatBrokerEntry({ host: 'h', port: 1, key: 'fixture-key' })).toBe('(无名)(starId 未登记)');
  });
});
