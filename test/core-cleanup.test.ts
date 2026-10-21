import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, truncateSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'crosschat-core-cleanup-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const DAY = 24 * 3_600_000;
const NOW = 1_800_000_000_000;

function fixture() {
  const dir = mkdtempSync(join(root, 'case-'));
  const tcpDir = join(dir, 'tcp');
  const conversationsDir = join(dir, 'conversations');
  const deps = { tcpDir, conversationsDir, now: () => NOW };
  const put = (area: 'inbox' | 'parts' | 'conversations', name: string, size: number, age: number) => {
    const parent = area === 'conversations' ? conversationsDir : join(tcpDir, area);
    mkdirSync(parent, { recursive: true });
    const file = join(parent, name);
    writeFileSync(file, '');
    truncateSync(file, size);
    const time = new Date(NOW - age);
    utimesSync(file, time, time);
    return file;
  };
  return { deps, put };
}

describe('cleanup application plan and execution', () => {
  it('previews the same strict age/cap rules without deleting or writing files', async () => {
    const { planCleanup } = await import('../src/application/cleanup/index.js');
    const { deps, put } = fixture();
    const stale = put('inbox', 'old.md', 2, 6 * DAY);
    const edge = put('parts', 'edge.part', 20, 5 * DAY);
    const oldest = put('inbox', 'oldest-live.md', 7, 2 * DAY);
    const newest = put('inbox', 'newest-live.md', 6, DAY);
    const shard = put('conversations', 'old.json', 5, 31 * DAY);
    const shardEdge = put('conversations', 'edge.json', 5, 30 * DAY);
    const temporary = put('conversations', 'old.json.tmp', 5, 90 * DAY);
    const files = [stale, edge, oldest, newest, shard, shardEdge, temporary];
    const before = files.map((file) => readFileSync(file));

    const plan = planCleanup({}, { ...deps, maxInboxBytes: 10 });

    expect(plan.mode).toBe('retention');
    expect(plan.targets.map(({ file, reason }) => ({ file, reason }))).toEqual([
      { file: stale, reason: 'expired' },
      { file: oldest, reason: 'inbox-capacity' },
      { file: shard, reason: 'shard-expired' },
    ]);
    expect(plan.counts).toEqual({ inbox: 3, parts: 1, shards: 2 });
    expect(files.map((file) => existsSync(file))).toEqual(files.map(() => true));
    expect(files.map((file) => readFileSync(file))).toEqual(before);
  });

  it('uses the existing 512 MiB inbox limit and keeps exactly-at-limit files', async () => {
    const { planCleanup } = await import('../src/application/cleanup/index.js');
    const { deps, put } = fixture();
    const limit = 512 * 1024 * 1024;
    const large = put('inbox', 'large.md', limit, 2 * DAY);
    expect(planCleanup({}, deps).targets).toEqual([]);
    put('inbox', 'new.md', 1, DAY);
    expect(planCleanup({}, deps).targets.map(({ file }) => file)).toEqual([large]);
  });

  it('executes the accepted target list and reports failures without changing the legacy candidate counts', async () => {
    const { planCleanup, executeCleanup } = await import('../src/application/cleanup/index.js');
    const { deps, put } = fixture();
    const good = put('inbox', 'good.md', 7, 6 * DAY);
    const denied = put('parts', 'denied.part', 11, 6 * DAY);
    const plan = planCleanup({}, deps);
    const attempted: string[] = [];
    const result = executeCleanup(plan, {
      remove: (file) => {
        attempted.push(file);
        if (file === denied) throw new Error('permission denied');
        rmSync(file, { force: true });
      },
    });
    expect(attempted).toEqual([good, denied]);
    expect(result.items.map(({ file, deleted }) => ({ file, deleted }))).toEqual([
      { file: good, deleted: true },
      { file: denied, deleted: false },
    ]);
    expect(result.freedBytes).toBe(7);
    expect(result.plannedCount).toBe(2);
    expect(existsSync(good)).toBe(false);
    expect(existsSync(denied)).toBe(true);
  });

  it('force previews and executes fresh files and JSON shards while retaining temporary shard files', async () => {
    const { planCleanup, executeCleanup, renderCleanup } = await import('../src/application/cleanup/index.js');
    const { deps, put } = fixture();
    const inbox = put('inbox', 'fresh.md', 10, 0);
    const shard = put('conversations', 'fresh.json', 100, 0);
    const temporary = put('conversations', 'fresh.json.tmp', 100, 0);
    const plan = planCleanup({ force: true }, deps);
    expect(plan.targets.map(({ file, reason }) => ({ file, reason }))).toEqual([
      { file: inbox, reason: 'force' },
      { file: shard, reason: 'force' },
    ]);
    expect(existsSync(inbox)).toBe(true);
    expect(existsSync(shard)).toBe(true);

    const result = executeCleanup(plan);
    expect(result.freedBytes).toBe(10);
    expect(renderCleanup(plan, result)).toEqual([
      '强制清理：将删除全部收件与断点文件（1 项，共 0.0 MB）及全部 conversations 分片（1 片）',
      `已删 ${inbox}（0.0 MB）`,
      `已删 ${shard}（conversations 分片）`,
      '清理完成：删除 1 项，释放 0.0 MB；回收 conversations 分片 1 片',
    ]);
    expect(existsSync(temporary)).toBe(true);
    expect(readdirSync(deps.conversationsDir)).toEqual(['fresh.json.tmp']);
  });

  it('does not discover new files during execution and treats missing directories as a no-op preview', async () => {
    const { planCleanup, executeCleanup } = await import('../src/application/cleanup/index.js');
    const { deps, put } = fixture();
    const empty = planCleanup({}, deps);
    expect(empty.targets).toEqual([]);
    expect(existsSync(deps.tcpDir)).toBe(false);
    const late = put('inbox', 'late.md', 7, 9 * DAY);
    expect(executeCleanup(empty).items).toEqual([]);
    expect(existsSync(late)).toBe(true);
  });
});
