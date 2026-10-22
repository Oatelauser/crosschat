import { describe, expect, it, vi } from 'vitest';
import type { DoctorObservation, LocalOverview, StatusOverview } from '../src/application/observations/overview.js';

const context = { id: 'local', kind: 'local', label: '本机' };
const observedAt = 1_800_000_000_000;
const doctor: DoctorObservation = { completeness: 'complete', observedAt, errors: [], summary: { pass: 0, warn: 1, error: 0, failed: false }, checks: [
  { id: 'check:full-stable-id', group: '环境', code: 'codex-daemon-missing', level: 'warn', label: 'Codex daemon', description: '尚未运行', guidance: '在本机执行：codex app-server daemon start', facts: [{ label: '来源', value: '本机' }] },
] };
const status: StatusOverview = { completeness: 'partial', observedAt, errors: [{ source: '/fixture/config', kind: 'malformed', message: '配置格式无效', nextStep: '检查来源后刷新' }],
  providers: [{ providerId: 'future-provider', count: 101, anonymous: 80, completeness: 'complete' }],
  connections: [{ id: 'ssh:fixture', kind: 'ssh', name: 'fixture', target: 'fixture' }, { id: 'tcp:fixture', kind: 'tcp', name: 'star', target: 'fixture:1' }],
  services: [{ file: 'status-node-fixture.json', kind: 'node', selector: 'fixture', state: 'revoked', lastUpdated: '2000-01-01', freshness: 'stale', readiness: 'unknown', pause: { state: 'unknown', message: '当前凭证无匹配撤权记录' } }],
  outbox: { threads: 1, items: null }, watchdog: { running: null, evidence: 'unavailable' }, lastDoctor: null,
};
function service(): LocalOverview {
  return { readStatus: vi.fn(async () => status), readDoctor: vi.fn(async () => doctor) };
}

describe('status and doctor resource adapters', () => {
  it('renders six status categories with full detail, read information and navigation while preserving unknown evidence', async () => {
    const { createStatusResource } = await import('../src/tui/resources/overview.js');
    const overview = service();
    const { resource, adapter } = createStatusResource({ overview });
    const signal = new AbortController().signal;
    const page = await adapter.read({ context, signal });
    expect(resource.id).toBe('status');
    expect(resource.actions.find((action) => action.shortcut === 'Enter')).toMatchObject({ kind: 'navigate', mutation: false });
    expect(resource.actions.find((action) => action.shortcut === 'd')).toMatchObject({ kind: 'detail', mutation: false });
    expect(page.rows).toHaveLength(6);
    expect(page).toMatchObject({ completeness: 'partial', sampledAt: observedAt, detailViews: { info: { fields: expect.arrayContaining([{ label: expect.any(String), value: expect.stringContaining('检查来源后刷新') }]) } } });
    const all = JSON.stringify(page);
    expect(all).toContain('future-provider');
    expect(all).toContain('101');
    expect(all).toContain('80');
    expect(all).toContain('未知');
    expect(page.rows.every((row) => row.navigate && row.copyValue && row.detail?.length)).toBe(true);
    expect(overview.readDoctor).not.toHaveBeenCalled();
  });

  it('runs doctor only when its resource is read, keeps original severity and copies the full handling guide', async () => {
    const { createDoctorResource } = await import('../src/tui/resources/overview.js');
    const overview = service();
    const { resource, adapter } = createDoctorResource({ overview });
    const signal = new AbortController().signal;
    expect(overview.readDoctor).not.toHaveBeenCalled();
    const page = await adapter.read({ context, signal });
    expect(resource.id).toBe('doctor');
    expect(resource.actions.every((action) => !action.mutation)).toBe(true);
    expect(page.rows[0]).toMatchObject({ id: doctor.checks[0].id, copyValue: doctor.checks[0].guidance, cells: { state: expect.stringContaining('warn') } });
    expect(JSON.stringify(page.rows[0].detail)).toContain('codex-daemon-missing');
    expect(overview.readDoctor).toHaveBeenCalledWith({ contextId: 'local', signal });
  });

  it('preserves source errors for an empty doctor result and rejects nonlocal contexts before invoking a reader', async () => {
    const { createDoctorResource, createStatusResource } = await import('../src/tui/resources/overview.js');
    const overview = service();
    overview.readDoctor = vi.fn(async () => ({ completeness: 'unavailable', observedAt, errors: [{ source: 'doctor', kind: 'unavailable', message: '无法读取诊断', nextStep: '按 r 重试' }], checks: [], summary: null }));
    const page = await createDoctorResource({ overview }).adapter.read({ context, signal: new AbortController().signal });
    expect(page).toMatchObject({ rows: [], completeness: 'unavailable', detailViews: { info: { fields: expect.any(Array) } } });
    expect(JSON.stringify(page.detailViews)).toContain('按 r 重试');
    const remote = await createStatusResource({ overview }).adapter.read({ context: { id: 'ssh:other', label: 'other', kind: 'ssh' }, signal: new AbortController().signal });
    expect(remote).toMatchObject({ rows: [], completeness: 'unavailable' });
    expect(overview.readStatus).not.toHaveBeenCalled();
  });
});
