import { describe, expect, it, vi } from 'vitest';
import * as connections from '../src/tui/resources/connections.js';
import type { TuiActionRequest } from '../src/tui/model.js';
import type { TcpConfigurationManager } from '../src/application/tcp/configuration.js';

const context = { id: 'local', kind: 'local', label: '本机' };
const route = { resourceId: 'tcp-targets', contextId: 'local' };
const signal = () => new AbortController().signal;
const target = { contextId: 'tcp:full-context', starId: 'full-star', name: 'fixture', host: 'fixture.invalid', port: 7260, revision: 'full-file-revision' };
function fixture() {
  const configuration: TcpConfigurationManager = {
    list: vi.fn(async () => ({ targets: [target], completeness: 'complete', observedAt: 7 })),
    preview: vi.fn(async () => ({ enabled: true, revision: 'import-preview', targets: [target], impact: ['只追加配置'], message: '预览' })),
    apply: vi.fn(async () => ({ status: 'applied', targets: [target], contextId: target.contextId, message: '已追加' })),
    previewChange: vi.fn(async () => ({ enabled: true, revision: 'change-preview', targets: [target], impact: ['不停止服务'], message: '预览' })),
    applyChange: vi.fn(async () => ({ status: 'applied', targets: [target], contextId: target.contextId, message: '已保存' })),
  };
  return { configuration, binding: connections.createTcpTargetsResource({ configuration }) };
}

describe('TCP workspace connection list', () => {
  it('reads safe connection metadata and owns local configuration CRUD without connecting', async () => {
    const f = fixture();
    const page = await f.binding.adapter.read({ context, route, signal: signal() });
    expect(page.rows[0].actionRoutes?.open).toEqual({ resourceId: 'members', contextId: target.contextId, query: { starId: target.starId } });
    expect(f.binding.resource.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'edit-connection', shortcut: 'e', ownerResourceId: 'tcp-targets' }),
      expect.objectContaining({ id: 'remove-connection', shortcut: 'Ctrl+D', ownerResourceId: 'tcp-targets' }),
    ]));
    expect(f.configuration.previewChange).not.toHaveBeenCalled();
    expect(f.configuration.applyChange).not.toHaveBeenCalled();
    const action = f.binding.resource.actions.find((item) => item.id === 'edit-connection')!;
    const request: TuiActionRequest = { action, target: page.rows[0], context, route, values: { host: 'changed.invalid', key: '' }, signal: signal() };
    const preview = await f.binding.adapter.checkAction!(request);
    expect(preview.fields).toContainEqual(expect.objectContaining({ id: 'key', secret: true }));
    expect(f.configuration.previewChange).toHaveBeenCalledWith({ operation: 'edit', contextId: target.contextId, targetRevision: target.revision, values: request.values, signal: request.signal });
    expect(await f.binding.adapter.mutate!(request)).toMatchObject({ selectedId: target.contextId });
    expect(f.configuration.applyChange).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 'change-preview' }));
    await expect(f.binding.adapter.mutate!(request)).rejects.toThrow(/预览|核验/);
  });

  it('does not apply a preview to another original connection or different private input', async () => {
    const f = fixture();
    const page = await f.binding.adapter.read({ context, route, signal: signal() });
    const action = f.binding.resource.actions.find((item) => item.id === 'remove-connection')!;
    const request: TuiActionRequest = { action, target: page.rows[0], context, route, values: {}, signal: signal() };
    await f.binding.adapter.checkAction!(request);
    await expect(f.binding.adapter.mutate!({ ...request, target: { ...page.rows[0], id: 'different-row' } })).rejects.toThrow(/预览|核验|目标/);
    expect(f.configuration.applyChange).not.toHaveBeenCalled();
  });
});
