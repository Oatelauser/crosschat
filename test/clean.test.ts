/** `crosschat clean`（票B B3 + 014 分片回收）：懒删除规则 / 总量超额 / --force / 空目录 / 参数解析。 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runClean, type CleanDeps } from '../src/commands/clean.js';
import { parseCleanArgs } from '../src/cli.js';
import { MultichatError } from '../src/errors.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-clean-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const DAY = 24 * 3_600_000;

function fixture(opts: { staleMs?: number; maxInboxBytes?: number; shardStaleMs?: number } = {}): {
  deps: CleanDeps;
  lines: string[];
  tcpDir: string;
  conversationsDir: string;
} {
  const tcpDir = mkdtempSync(join(root, 'case-'));
  const conversationsDir = mkdtempSync(join(root, 'pairs-'));
  const lines: string[] = [];
  const now = 1_800_000_000_000;
  return {
    tcpDir,
    conversationsDir,
    lines,
    deps: {
      tcpDir,
      conversationsDir,
      now: () => now,
      stdout: (line) => lines.push(line),
      ...(opts.staleMs === undefined ? {} : { staleMs: opts.staleMs }),
      ...(opts.maxInboxBytes === undefined ? {} : { maxInboxBytes: opts.maxInboxBytes }),
      ...(opts.shardStaleMs === undefined ? {} : { shardStaleMs: opts.shardStaleMs }),
    },
  };
}

function put(tcpDir: string, sub: 'inbox' | 'parts', name: string, size: number, ageMs: number, now: number): string {
  const dir = join(tcpDir, sub);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, 'x'.repeat(size));
  const t = new Date(now - ageMs);
  utimesSync(file, t, t);
  return file;
}

/** conversations 分片（014 回收对象）；ageMs 相对 fixture 冻结钟，缺省=新鲜。 */
function putShard(conversationsDir: string, name: string, ageMs = 0): string {
  mkdirSync(conversationsDir, { recursive: true });
  const file = join(conversationsDir, name);
  writeFileSync(file, '{"pair":"p","ref":"r","updatedAt":1}');
  const t = new Date(1_800_000_000_000 - ageMs);
  utimesSync(file, t, t);
  return file;
}

describe('runClean (lazy rules)', () => {
  it('deletes inbox/parts older than 5 days, keeps fresh items, prints details', () => {
    const { deps, lines, tcpDir, conversationsDir } = fixture();
    const now = deps.now();
    const oldInbox = put(tcpDir, 'inbox', 'old-a.md', 10, 6 * DAY, now);
    put(tcpDir, 'inbox', 'fresh-b.md', 10, 1 * DAY, now);
    const oldPart = put(tcpDir, 'parts', 'abc.part', 10, 6 * DAY, now);
    expect(runClean({}, deps)).toBe(0);
    expect(lines.some((l) => l.includes(oldInbox) && l.includes('超 5 天'))).toBe(true);
    expect(lines.some((l) => l.includes(oldPart) && l.includes('超 5 天'))).toBe(true);
    expect(lines.at(-1)).toMatch(/清理完成：删除 2 项，释放 0\.0 MB；回收 conversations 分片 0 片/);
    expect(readdirSync(join(tcpDir, 'inbox'))).toEqual(['fresh-b.md']);
    expect(readdirSync(join(tcpDir, 'parts'))).toEqual([]);
    expect(readdirSync(conversationsDir)).toEqual([]);
  });

  it('evicts oldest inbox items when the total exceeds the cap', () => {
    const { deps, lines, tcpDir } = fixture({ maxInboxBytes: 1024 });
    const now = deps.now();
    put(tcpDir, 'inbox', 'oldest.md', 600, 1 * DAY, now);
    put(tcpDir, 'inbox', 'newest.md', 600, 0.5 * DAY, now);
    expect(runClean({}, deps)).toBe(0);
    expect(lines.some((l) => l.includes('oldest.md') && l.includes('超总量'))).toBe(true);
    expect(readdirSync(join(tcpDir, 'inbox'))).toEqual(['newest.md']);
  });

  it('reports nothing to do when everything is within the rules', () => {
    const { deps, lines, tcpDir, conversationsDir } = fixture();
    put(tcpDir, 'inbox', 'ok.md', 10, 1 * DAY, deps.now());
    putShard(conversationsDir, 'live.json');
    expect(runClean({}, deps)).toBe(0);
    expect(lines).toEqual([`无需清理：inbox 1 项 / parts 0 项 / conversations 分片 1 片均在保留规则内`]);
  });

  it('missing inbox/parts dirs are a clean no-op', () => {
    const { deps, lines } = fixture();
    expect(runClean({}, deps)).toBe(0);
    expect(lines[0]).toContain('无需清理');
  });
});

describe('runClean conversations shard recycle (014)', () => {
  it('recycles shards untouched for 30 days, keeps active ones', () => {
    const { deps, lines, conversationsDir } = fixture();
    const stale = putShard(conversationsDir, 'stale.json', 31 * DAY);
    putShard(conversationsDir, 'active.json', 5 * DAY);
    expect(runClean({}, deps)).toBe(0);
    expect(lines.some((l) => l.includes(stale) && l.includes('分片 30 天未更新'))).toBe(true);
    expect(lines.at(-1)).toMatch(/清理完成：删除 1 项，释放 0\.0 MB；回收 conversations 分片 1 片/);
    expect(readdirSync(conversationsDir)).toEqual(['active.json']);
  });

  it('boundary: exactly 30 days old is still kept (only strictly older recycles)', () => {
    const { deps, lines, conversationsDir } = fixture();
    putShard(conversationsDir, 'edge.json', 30 * DAY);
    expect(runClean({}, deps)).toBe(0);
    expect(lines[0]).toContain('均在保留规则内');
    expect(readdirSync(conversationsDir)).toEqual(['edge.json']);
  });

  it('ignores non-shard files in the conversations dir (tmp leftovers)', () => {
    const { deps, conversationsDir } = fixture();
    const tmp = putShard(conversationsDir, 'shard.json.123.456.tmp', 90 * DAY);
    expect(runClean({}, deps)).toBe(0);
    expect(readdirSync(conversationsDir)).toEqual(['shard.json.123.456.tmp']);
    expect(tmp).toContain('.tmp');
  });
});

describe('runClean --force', () => {
  it('announces the blast radius first, then deletes everything including unread fresh items', () => {
    const { deps, lines, tcpDir, conversationsDir } = fixture();
    const now = deps.now();
    put(tcpDir, 'inbox', 'fresh.md', 2048, 0, now);
    put(tcpDir, 'parts', 'half.part', 512, 0, now);
    const shard = putShard(conversationsDir, 'young.json');
    expect(runClean({ force: true }, deps)).toBe(0);
    expect(lines[0]).toBe('强制清理：将删除全部收件与断点文件（2 项，共 0.0 MB）及全部 conversations 分片（1 片）');
    expect(lines.filter((l) => l.startsWith('已删 ') && l.includes('MB）'))).toHaveLength(2);
    expect(lines.some((l) => l.includes(shard) && l.includes('conversations 分片'))).toBe(true);
    expect(lines.at(-1)).toBe('清理完成：删除 2 项，释放 0.0 MB；回收 conversations 分片 1 片');
    expect(readdirSync(join(tcpDir, 'inbox'))).toEqual([]);
    expect(readdirSync(join(tcpDir, 'parts'))).toEqual([]);
    expect(readdirSync(conversationsDir)).toEqual([]);
  });

  it('empty dirs: no-op line, no blast-radius banner', () => {
    const { deps, lines } = fixture();
    expect(runClean({ force: true }, deps)).toBe(0);
    expect(lines).toEqual(['无需清理：inbox 与 parts 均为空，也无 conversations 分片']);
  });
});

describe('parseCleanArgs', () => {
  it('accepts bare and --force, rejects anything else', () => {
    expect(parseCleanArgs([])).toEqual({});
    expect(parseCleanArgs(['--force'])).toEqual({ force: true });
    expect(() => parseCleanArgs(['--yes'])).toThrowError(MultichatError);
  });
});
