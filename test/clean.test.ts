/** `crosschat clean`（票B B3）：懒删除规则 / 总量超额 / --force / 空目录 / 参数解析。 */
import { mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runClean, type CleanDeps } from '../src/commands/clean.js';
import { parseCleanArgs } from '../src/cli.js';
import { MultichatError } from '../src/errors.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-clean-'));
const DAY = 24 * 3_600_000;

function fixture(opts: { staleMs?: number; maxInboxBytes?: number } = {}): { deps: CleanDeps; lines: string[]; tcpDir: string } {
  const tcpDir = mkdtempSync(join(root, 'case-'));
  const lines: string[] = [];
  const now = 1_800_000_000_000;
  return {
    tcpDir,
    lines,
    deps: {
      tcpDir,
      now: () => now,
      stdout: (line) => lines.push(line),
      ...(opts.staleMs === undefined ? {} : { staleMs: opts.staleMs }),
      ...(opts.maxInboxBytes === undefined ? {} : { maxInboxBytes: opts.maxInboxBytes }),
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

describe('runClean (lazy rules)', () => {
  it('deletes inbox/parts older than 5 days, keeps fresh items, prints details', () => {
    const { deps, lines, tcpDir } = fixture();
    const now = deps.now();
    const oldInbox = put(tcpDir, 'inbox', 'old-a.md', 10, 6 * DAY, now);
    put(tcpDir, 'inbox', 'fresh-b.md', 10, 1 * DAY, now);
    const oldPart = put(tcpDir, 'parts', 'abc.part', 10, 6 * DAY, now);
    expect(runClean({}, deps)).toBe(0);
    expect(lines.some((l) => l.includes(oldInbox) && l.includes('超 5 天'))).toBe(true);
    expect(lines.some((l) => l.includes(oldPart) && l.includes('超 5 天'))).toBe(true);
    expect(lines.at(-1)).toMatch(/清理完成：删除 2 项，释放 0\.0 MB/);
    expect(readdirSync(join(tcpDir, 'inbox'))).toEqual(['fresh-b.md']);
    expect(readdirSync(join(tcpDir, 'parts'))).toEqual([]);
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
    const { deps, lines, tcpDir } = fixture();
    put(tcpDir, 'inbox', 'ok.md', 10, 1 * DAY, deps.now());
    expect(runClean({}, deps)).toBe(0);
    expect(lines).toEqual([`无需清理：inbox 1 项 / parts 0 项均在保留规则内`]);
  });

  it('missing inbox/parts dirs are a clean no-op', () => {
    const { deps, lines } = fixture();
    expect(runClean({}, deps)).toBe(0);
    expect(lines[0]).toContain('无需清理');
  });
});

describe('runClean --force', () => {
  it('announces the blast radius first, then deletes everything including unread fresh items', () => {
    const { deps, lines, tcpDir } = fixture();
    const now = deps.now();
    put(tcpDir, 'inbox', 'fresh.md', 2048, 0, now);
    put(tcpDir, 'parts', 'half.part', 512, 0, now);
    expect(runClean({ force: true }, deps)).toBe(0);
    expect(lines[0]).toBe('强制清理：将删除全部收件与断点文件（2 项，共 0.0 MB）');
    expect(lines.filter((l) => l.startsWith('已删 '))).toHaveLength(2);
    expect(lines.at(-1)).toMatch(/清理完成：删除 2 项，释放 0\.0 MB/);
    expect(readdirSync(join(tcpDir, 'inbox'))).toEqual([]);
    expect(readdirSync(join(tcpDir, 'parts'))).toEqual([]);
  });

  it('empty dirs: no-op line, no blast-radius banner', () => {
    const { deps, lines } = fixture();
    expect(runClean({ force: true }, deps)).toBe(0);
    expect(lines).toEqual(['无需清理：inbox 与 parts 均为空']);
  });
});

describe('parseCleanArgs', () => {
  it('accepts bare and --force, rejects anything else', () => {
    expect(parseCleanArgs([])).toEqual({});
    expect(parseCleanArgs(['--force'])).toEqual({ force: true });
    expect(() => parseCleanArgs(['--yes'])).toThrowError(MultichatError);
  });
});
