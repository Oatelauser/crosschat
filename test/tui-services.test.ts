import { describe, expect, it, vi } from 'vitest';
import { createServicesResource } from '../src/tui/resources/services.js';
import type { LocalService, LocalServices } from '../src/application/services/managed.js';
import type { TuiActionRequest } from '../src/tui/model.js';

const context = { id: 'local', kind: 'local', label: '本机' };
const enabled = { allowed: true, impact: ['仅当前本机服务；不终止原生会话。'] };
const item: LocalService = { id: 'service:full-target', revision: 'opaque-revision', kind: 'node', label: 'fixture', selector: 'fixture', state: 'not-running', sourceId: 'node:node-fixture.log', target: 'fixture.invalid:7260', start: enabled, stop: { allowed: false, reason: '没有匹配运行进程', impact: [] }, detail: [{ label: '完整星标识', value: 'full-star-id' }] };
function fixture() {
  const read = vi.fn(async () => ({ items: [item], completeness: 'complete' as const, observedAt: 100, errors: [] }));
  const check = vi.fn(async () => enabled);
  const execute = vi.fn(async () => ({ state: 'ready' as const, message: '已实际就绪', id: item.id }));
  const service: LocalServices = { read, check, execute };
  return { ...createServicesResource({ service }), read, check, execute };
}
const request = () => ({ context, signal: new AbortController().signal });
async function mutation(f: ReturnType<typeof fixture>, id = 'start'): Promise<TuiActionRequest> {
  const page = await f.adapter.read(request());
  const action = f.resource.actions.find((action) => action.id === id)!;
  return { ...request(), action, target: page.rows[0], values: {} };
}

describe('TUI service tasks', () => {
  it('declares all service actions once and carries fixed identity, readonly full details and exact log routes', async () => {
    const f = fixture();
    expect(f.resource.actions.map((action) => action.shortcut)).toEqual(['a', 'Ctrl+D', 'l', 'i']);
    expect(f.resource.actions.filter((action) => action.mutation).every((action) => action.ownerResourceId === 'services' && action.kind === 'form')).toBe(true);
    const page = await f.adapter.read(request());
    expect(page.rows[0]).toMatchObject({ id: item.id, copyValue: item.id, cells: { name: 'fixture' }, actionRoutes: { logs: { resourceId: 'logs', contextId: 'local', query: { source: item.sourceId } } } });
    expect(JSON.stringify(page.rows[0].detail)).toContain('full-star-id');
    expect(page.rows[0].actionAvailability?.stop).toMatchObject({ enabled: false });
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('shows process existence and actual connection readiness in separate bounded columns', async () => {
    const f = fixture();
    f.read.mockResolvedValue({ items: [{ ...item, state: 'running', readiness: 'starting' }], completeness: 'complete', observedAt: 100, errors: [] });
    const page = await f.adapter.read(request());
    expect(f.resource.columns.find((column) => column.id === 'readiness')).toMatchObject({ label: '就绪', width: expect.any(Number) });
    expect(page.rows[0].cells).toMatchObject({ state: '进程运行<running>', readiness: '启动中<starting>' });
  });

  it('rechecks the fixed service target and keeps an unconfirmed outcome in the confirmation flow', async () => {
    const f = fixture();
    const selected = await mutation(f);
    expect(await f.adapter.checkAction!(selected)).toMatchObject({ enabled: true, impact: enabled.impact });
    expect(f.check).toHaveBeenCalledWith(expect.objectContaining({ contextId: 'local', id: item.id, revision: item.revision, operation: 'start' }));
    expect(await f.adapter.mutate!(selected)).toMatchObject({ selectedId: item.id, message: '已实际就绪' });
    f.execute.mockResolvedValue({ state: 'unconfirmed', message: '请求已发出，结果待核实', id: item.id });
    await expect(f.adapter.mutate!(selected)).rejects.toThrow('待核实');
  });

  it('refuses nonlocal, mismatched route, forged identity and cancelled work before application execution', async () => {
    const f = fixture();
    expect((await f.adapter.read({ ...request(), context: { ...context, kind: 'ssh' } })).completeness).toBe('unavailable');
    expect((await f.adapter.read({ ...request(), route: { resourceId: 'services', contextId: 'ssh:other' } })).completeness).toBe('unavailable');
    expect(f.read).not.toHaveBeenCalled();
    const selected = await mutation(f);
    expect(await f.adapter.checkAction!({ ...selected, target: { ...selected.target!, id: 'forged-target' } })).toMatchObject({ enabled: false });
    const owner = new AbortController(); owner.abort();
    expect((await f.adapter.read({ context, signal: owner.signal })).completeness).toBe('cancelled');
    expect(f.check).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  });
});
