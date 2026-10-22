import { describe, expect, it, vi } from 'vitest';
import { createFilesResource } from '../src/tui/resources/files.js';
import { createMaintenanceResource } from '../src/tui/resources/maintenance.js';
import type { MaintenancePreview, MaintenanceResult } from '../src/application/maintenance/model.js';
import type { TuiActionRequest } from '../src/tui/model.js';

const context = { id: 'local', kind: 'local', label: '本机' };
const signal = () => new AbortController().signal;
const operation = { id: 'cleanup', label: '按保留规则清理', description: '原有保留规则', guidance: '不会删除outbox' };
const preview: MaintenancePreview = { operationId: 'cleanup', label: operation.label, observedAt: 42, fingerprint: 'fingerprint', enabled: true,
  targets: [{ path: '/isolated/tcp/inbox/old', label: '过期收件', kind: 'file', bytes: 7, modifiedAt: 10 }], effects: ['删除1项', '保留outbox'],
};
const result: MaintenanceResult = { operationId: 'cleanup', status: 'complete', startedAt: 42, finishedAt: 43, npm: 'not-run', message: '已删除1项', items: [{ path: '/isolated/tcp/inbox/old', outcome: 'deleted' }] };

describe('local files resource', () => {
  it('shows metadata only, copies complete paths and opens maintenance even when the file inventory is empty', async () => {
    const read = vi.fn(async () => ({ items: [{ file: '/isolated/完整/路径.json', category: 'outbox' as const, bytes: 20, modifiedAt: '2026-01-01T00:00:00.000Z' }], completeness: 'complete' as const, observedAt: 42, errors: [] }));
    const resource = createFilesResource({ read });
    const page = await resource.adapter.read({ context, signal: signal() });
    expect(page.rows[0].copyValue).toBe('/isolated/完整/路径.json');
    expect(page.rows[0].detail).toContainEqual({ label: '完整路径', value: '/isolated/完整/路径.json' });
    expect(resource.resource.actions.find((action) => action.shortcut === 'm')).toMatchObject({ kind: 'navigate', navigateTo: 'maintenance', selectionPolicy: 'none', mutation: false });
    expect(resource.adapter.mutate).toBeUndefined();
    expect(resource.resource.columns.every((column) => Number.isInteger(column.width) && column.width > 0)).toBe(true);
  });

  it('rejects remote/mismatched contexts and aborted reads before touching the local file source', async () => {
    const read = vi.fn();
    const { adapter } = createFilesResource({ read });
    for (const request of [{ context: { ...context, kind: 'ssh' }, signal: signal() }, { context, route: { resourceId: 'files', contextId: 'other' }, signal: signal() }]) {
      expect((await adapter.read(request)).completeness).toBe('unavailable');
    }
    const cancel = new AbortController(); cancel.abort();
    expect((await adapter.read({ context, signal: cancel.signal })).completeness).toBe('cancelled');
    expect(read).not.toHaveBeenCalled();
  });
});

describe('maintenance resource ownership and result accuracy', () => {
  function fixture() {
    const maintenance = { list: vi.fn(() => [operation]), preview: vi.fn(async () => structuredClone(preview)), execute: vi.fn(async () => structuredClone(result)) };
    const { resource, adapter } = createMaintenanceResource({ maintenance });
    return { maintenance, resource, adapter };
  }
  async function request(f: ReturnType<typeof fixture>, contextValue = context): Promise<TuiActionRequest> {
    const page = await f.adapter.read({ context: contextValue, signal: signal() });
    return { action: f.resource.actions.find((action) => action.id === 'execute')!, target: page.rows[0], context: contextValue, values: {}, signal: signal() };
  }

  it('lists without preview or writes, then re-previews the exact selected task and uses its fingerprint for execution', async () => {
    const f = fixture(); const action = await request(f);
    expect(f.maintenance.preview).not.toHaveBeenCalled();
    expect(f.maintenance.execute).not.toHaveBeenCalled();
    const permission = await f.adapter.checkAction!(action);
    expect(permission.enabled).toBe(true);
    expect(permission.impact?.join('\n')).toContain(preview.targets[0].path);
    expect(f.maintenance.execute).not.toHaveBeenCalled();
    expect(await f.adapter.mutate!(action)).toMatchObject({ selectedId: 'cleanup', message: result.message });
    expect(f.maintenance.execute).toHaveBeenCalledWith({ operationId: 'cleanup', expectedFingerprint: 'fingerprint', signal: action.signal });
    const updated = await f.adapter.read({ context, signal: signal() });
    expect(JSON.stringify(updated.rows[0].detail)).toContain('deleted');
  });

  it('keeps partial failures available to the form and records exact outcomes in readonly detail', async () => {
    const f = fixture(); const action = await request(f);
    await f.adapter.checkAction!(action);
    f.maintenance.execute.mockResolvedValue({ ...result, status: 'partial', message: '删除1项，失败1项', items: [...result.items, { path: '/isolated/denied', outcome: 'failed' }] });
    await expect(f.adapter.mutate!(action)).rejects.toThrow('删除1项，失败1项');
    expect(JSON.stringify((await f.adapter.read({ context, signal: signal() })).rows[0].detail)).toContain('/isolated/denied');
  });

  it('does not reuse another selected task or context preview and never runs without a current preview', async () => {
    const f = fixture(); const action = await request(f);
    await expect(f.adapter.mutate!(action)).rejects.toThrow();
    await f.adapter.checkAction!(action);
    await expect(f.adapter.mutate!({ ...action, target: { ...action.target!, id: 'uninstall-data' } })).rejects.toThrow();
    await expect(f.adapter.mutate!({ ...action, context: { ...context, id: 'other' } })).rejects.toThrow();
    await expect(f.adapter.mutate!({ ...action, context: { ...context, kind: 'ssh' } })).rejects.toThrow();
    expect(f.maintenance.execute).not.toHaveBeenCalled();
  });
});
