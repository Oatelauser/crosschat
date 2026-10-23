import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseNodeConfig, readNodeConfig } from '../src/serve/node-config.js';
import { selectConnectEntry } from '../src/serve/connect-selector.js';
import { selectBrokerEntry } from '../src/serve/via-tcp.js';
import { createTcpApplication } from '../src/application/tcp/index.js';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
describe('empty current-shape TCP configuration', () => {
  it('reads the last-entry removal result without repairing or deleting the retained top-level fields', () => {
    const baseDir = mkdtempSync(join(process.platform === 'darwin' ? realpathSync('/tmp') : tmpdir(), 'cc-empty-')); directories.push(baseDir);
    mkdirSync(join(baseDir, 'tcp')); const file = join(baseDir, 'tcp', 'node.json');
    const raw = JSON.stringify({ brokers: [], showName: 'default-name', custom: { keep: true } }); writeFileSync(file, raw);
    expect(parseNodeConfig(raw)).toEqual({ entries: [], showName: 'default-name' });
    expect(readNodeConfig(file)).toEqual({ entries: [], showName: 'default-name' });
    expect(readFileSync(file, 'utf8')).toBe(raw);
  });

  it('gives a deliberate unconfigured error rather than selecting an undefined default entry', () => {
    expect(() => selectConnectEntry('', { entries: [] })).toThrow(/未配置|未入|没有.*配置|没有.*连接/);
    expect(() => selectConnectEntry('missing', { entries: [] })).toThrow(/未配置|未入|没有.*配置|没有.*连接/);
    expect(() => selectBrokerEntry([], undefined, undefined)).toThrow(/未配置|未入|没有.*配置|没有.*连接/);
  });

  it('treats an empty retained node file as unconfigured data without querying another connection', async () => {
    const baseDir = mkdtempSync(join(process.platform === 'darwin' ? realpathSync('/tmp') : tmpdir(), 'cc-empty-')); directories.push(baseDir);
    mkdirSync(join(baseDir, 'tcp')); writeFileSync(join(baseDir, 'tcp', 'node.json'), JSON.stringify({ brokers: [], showName: 'default-name' }));
    const result = await createTcpApplication({ baseDir }).readStars({ contextId: 'tcp:missing' });
    expect(result).toMatchObject({ completeness: 'unavailable', configured: false, items: [] });
    expect(result.errors.every((error) => error.kind !== 'malformed')).toBe(true);
  });
});
