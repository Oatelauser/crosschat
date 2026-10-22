import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatAdminAudit } from '../src/serve/admin-audit.js';
import { queryManagedLog } from '../src/application/observations/logs.js';
import { createLogsResource } from '../src/tui/resources/logs.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
describe('stable star audit identity', () => {
  it('filters by full identity across renamed/reused names and explicitly reports unscoped older rows', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'crosschat-star-audit-')); roots.push(baseDir);
    await mkdir(join(baseDir, 'tcp'));
    const lines = [formatAdminAudit('set-name', '星 old-name', '本机插座', ['full-star-a']),
      formatAdminAudit('set-name', '星 new-name', '本机插座', ['full-star-a']),
      formatAdminAudit('add-star', '星 old-name', '本机插座', ['full-star-b']),
      formatAdminAudit('set-showname', '显示名 changed', '本机插座', ['full-star-a', 'full-star-b']),
      'audit admin-op remove-node 星 old-name 来源=旧格式', 'ordinary broker event'];
    await writeFile(join(baseDir, 'tcp', 'broker.log'), lines.join('\n') + '\n');
    const all = await queryManagedLog({ baseDir, sourceId: 'broker' }); expect(all.items).toHaveLength(6);
    const scoped = await queryManagedLog({ baseDir, sourceId: 'broker', audit: 'admin-op', starId: 'full-star-a' });
    expect(scoped.items.map((item) => item.text)).toEqual([lines[0], lines[1], lines[3]]);
    expect(scoped.completeness).toBe('partial');
    expect(scoped.errors.some((issue) => issue.message.includes('归属'))).toBe(true);
    expect((await queryManagedLog({ baseDir, sourceId: 'send-log', audit: 'admin-op', starId: 'full-star-a' })).completeness).toBe('unavailable');
  });

  it('passes the exact audit scope through reads and identifies it in the full reading information', async () => {
    const read = vi.fn(async () => ({ items: [], source: { id: 'broker', label: 'broker日志', path: '/isolated/broker.log' }, sources: [], completeness: 'complete' as const, observedAt: 42, errors: [], bytesRead: 0, truncated: false, omittedLeadingLine: false, rotated: false }));
    const adapter = createLogsResource({ read }).adapter;
    const signal = new AbortController().signal;
    const page = await adapter.read({ context: { id: 'local', kind: 'local', label: '本机' }, route: { resourceId: 'logs', contextId: 'local', query: { source: 'broker', audit: 'admin-op', starId: 'full-star-a' } }, signal });
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ audit: 'admin-op', starId: 'full-star-a', sourceId: 'broker' }));
    expect(JSON.stringify(page.detailViews)).toContain('full-star-a'); expect(page.notice).toContain('管理审计');
  });
});
