import { describe, expect, it, vi } from 'vitest';
import type { TcpConfigurationImport, TcpConfigurationPreview } from '../src/application/tcp/configuration.js';
import type { TuiActionRequest, TuiReadRequest } from '../src/tui/model.js';
import { createConnectionsResource } from '../src/tui/resources/connections.js';

const context = { id: 'tcp:previous-context', kind: 'tcp', label: '原TCP连接' };
const content = '{"brokers":[{"host":"fixture.invalid","port":7260,"starId":"full-import-star","key":"SYNTHETIC-IMPORT-SECRET"}]}';
const target = { contextId: 'tcp:imported-full-context', starId: 'full-import-star', name: '导入星', host: 'fixture.invalid', port: 7260 };
const signal = () => new AbortController().signal;
const route = { resourceId: 'connect', contextId: context.id };
function fixture() {
  const configuration = {
    preview: vi.fn<TcpConfigurationImport['preview']>(async () => ({ enabled: true, revision: 'fixed-file-and-input-revision', targets: [target], message: '可追加一条新星连接。', impact: ['只追加本机当前用户的配置；不启动连接。'] })),
    apply: vi.fn<TcpConfigurationImport['apply']>(async () => ({ status: 'applied', contextId: target.contextId, targets: [target], message: '已追加本机配置。' })),
  };
  return { configuration, binding: createConnectionsResource({ configuration }) };
}
async function actionRequest(f: ReturnType<typeof fixture>, value = content): Promise<TuiActionRequest> {
  const page = await f.binding.adapter.read({ context, route, signal: signal() });
  const action = f.binding.resource.actions.find((entry) => entry.id === 'import-tcp');
  if (!action) throw new Error('Missing import action');
  return { action, target: page.rows.find((row) => row.id === 'import-tcp'), context, route, values: { content: value }, signal: signal() };
}

describe('existing connection selection and private TCP configuration import', () => {
  it('reads two safe connection choices without querying configuration or retaining private input', async () => {
    const f = fixture();
    const page = await f.binding.adapter.read({ context, route, signal: signal() });
    expect(page.rows.map((row) => row.id)).toEqual(['existing-ssh', 'import-tcp']);
    expect(page.rows[0].actionRoutes?.open).toEqual({ resourceId: 'ssh', contextId: context.id });
    expect(page.rows[1].actionRoutes?.open).toEqual({ resourceId: 'connect', contextId: context.id, query: { operation: 'import-tcp' } });
    expect(page.rows[0].actionAvailability?.['import-tcp']?.enabled).toBe(false);
    expect(f.binding.resource.actions.find((entry) => entry.id === 'import-tcp')?.fields).toContainEqual(expect.objectContaining({ id: 'content', secret: true, required: true }));
    expect(JSON.stringify(page)).not.toContain('SYNTHETIC-IMPORT-SECRET');
    expect(f.configuration.preview).not.toHaveBeenCalled(); expect(f.configuration.apply).not.toHaveBeenCalled();
  });

  it('uses a second readonly task list whose Enter/a explicitly open the import form', async () => {
    const f = fixture();
    const page = await f.binding.adapter.read({ context, route: { ...route, query: { operation: 'import-tcp' } }, signal: signal() });
    expect(page.rows.map((row) => row.id)).toEqual(['import-tcp']);
    expect(page.presentation?.actions).toContainEqual(expect.objectContaining({ id: 'import-tcp', shortcut: 'Enter / a', kind: 'form', mutation: true, ownerResourceId: 'connect' }));
    expect(page.contextSummary?.label).toContain('本机');
    expect(f.configuration.preview).not.toHaveBeenCalled();
  });

  it('validates route ownership and input bounds before any configuration query or effect', async () => {
    const f = fixture();
    for (const request of [
      { context, route: { ...route, contextId: 'different' }, signal: signal() },
      { context, route: { ...route, query: { operation: 'unknown' } }, signal: signal() },
      { context, route: { resourceId: 'stars', contextId: context.id }, signal: signal() },
    ] satisfies TuiReadRequest[]) expect((await f.binding.adapter.read(request)).completeness).toBe('unavailable');
    const selected = await actionRequest(f, 'x'.repeat(1024 * 1024 + 1));
    expect((await f.binding.adapter.checkAction!(selected)).enabled).toBe(false);
    selected.values = { content, unexpected: 'extra-secret' };
    expect((await f.binding.adapter.checkAction!(selected)).enabled).toBe(false);
    expect(f.configuration.preview).not.toHaveBeenCalled(); expect(f.configuration.apply).not.toHaveBeenCalled();
  });

  it('shows only safe destination metadata in preview and keeps JSON private until explicit apply', async () => {
    const f = fixture();
    const selected = await actionRequest(f);
    const preview = await f.binding.adapter.checkAction!(selected);
    expect(f.configuration.preview).toHaveBeenCalledExactlyOnceWith({ content, signal: selected.signal });
    expect(preview).toMatchObject({ enabled: true, impact: expect.arrayContaining([expect.stringContaining(target.starId), expect.stringContaining(target.host)]) });
    expect(JSON.stringify(preview)).not.toContain(content);
    expect(JSON.stringify(preview)).not.toContain('SYNTHETIC-IMPORT-SECRET');
    expect(preview.fields).toContainEqual(expect.objectContaining({ id: 'content', secret: true }));
    expect(f.configuration.apply).not.toHaveBeenCalled();
  });

  it('consumes the exact preview once and navigates to reloaded ctx selecting the real imported context', async () => {
    const f = fixture();
    const selected = await actionRequest(f);
    await f.binding.adapter.checkAction!(selected);
    const result = await f.binding.adapter.mutate!(selected);
    expect(f.configuration.apply).toHaveBeenCalledExactlyOnceWith({ content, expectedRevision: 'fixed-file-and-input-revision', signal: selected.signal });
    expect(result).toMatchObject({ navigate: { resourceId: 'ctx' }, selectedId: target.contextId });
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC-IMPORT-SECRET');
    await expect(f.binding.adapter.mutate!(selected)).rejects.toThrow(/预览|核验/);
    const ordinaryPage = await f.binding.adapter.read({ context, route, signal: signal() });
    expect(JSON.stringify(ordinaryPage)).not.toContain('SYNTHETIC-IMPORT-SECRET');
    expect(f.configuration.apply).toHaveBeenCalledOnce();
  });

  it('never reuses a preview after input changes, connection refresh, or a late cancelled preview', async () => {
    const f = fixture();
    const selected = await actionRequest(f);
    await f.binding.adapter.checkAction!(selected);
    await expect(f.binding.adapter.mutate!({ ...selected, values: { content: `${content} ` } })).rejects.toThrow(/预览|核验/);
    await f.binding.adapter.checkAction!(selected);
    await f.binding.adapter.read({ context, route, signal: signal() });
    await expect(f.binding.adapter.mutate!(selected)).rejects.toThrow(/预览|核验/);
    let finish: ((value: TcpConfigurationPreview) => void) | undefined;
    f.configuration.preview.mockImplementationOnce(async () => new Promise<TcpConfigurationPreview>((resolve) => { finish = resolve; }));
    const owner = new AbortController();
    const pending = f.binding.adapter.checkAction!({ ...selected, signal: owner.signal });
    owner.abort();
    expect((await pending).enabled).toBe(false);
    finish!({ enabled: true, revision: 'late', targets: [target], impact: [], message: 'late' });
    await Promise.resolve();
    await expect(f.binding.adapter.mutate!(selected)).rejects.toThrow(/预览|核验/);
    expect(f.configuration.apply).not.toHaveBeenCalled();
  });

  it('does not expose private parser errors or report a changed configuration as applied', async () => {
    const f = fixture();
    const selected = await actionRequest(f);
    f.configuration.preview.mockRejectedValueOnce(new Error(`raw JSON secret: ${content}`));
    expect(JSON.stringify(await f.binding.adapter.checkAction!(selected))).not.toContain('SYNTHETIC-IMPORT-SECRET');
    await f.binding.adapter.checkAction!(selected);
    f.configuration.apply.mockResolvedValueOnce({ status: 'changed', targets: [], message: '配置已变化，请重新预览。' });
    await expect(f.binding.adapter.mutate!(selected)).rejects.toThrow('配置已变化');
    expect(f.configuration.apply).toHaveBeenCalledOnce();
  });
});
