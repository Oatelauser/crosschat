import { describe, expect, it, vi } from 'vitest';
import type { DiscoveryEndpoint, DiscoveryProvider, DiscoveryResponse, DiscoverySession } from '../src/application/discovery/index.js';
import { sessionKey } from '../src/application/sessions/model.js';
import { createSessionsResource } from '../src/tui/resources/sessions.js';
import { createStatusRegistry } from '../src/tui/resources/status.js';
import { resolveTargetByName } from '../src/resolve.js';

const context = { id: 'local', kind: 'local', label: '本机' };
const capabilities = { discovery: true, delivery: true, launch: false, diagnostics: false };
const providers: DiscoveryProvider[] = ['claude', 'codex', 'future-tool'].map((providerId) => ({ providerId, capabilities }));
function session(providerId: string, nativeId: string, name: string | null = null): DiscoverySession {
  return { ref: { contextId: 'local', providerId, nativeId }, name, rawStatus: 'idle', capabilities, attributes: { cwd: '/完整/目录' } };
}
function response(items: DiscoverySession[], options: { cursor?: string; completeness?: 'complete' | 'partial' | 'unavailable' | 'cancelled'; errors?: Extract<DiscoveryResponse, { op: 'list' }>['page']['errors']; observedAt?: number } = {}): DiscoveryResponse {
  return { op: 'list', providers, page: { items, nextCursor: options.cursor ?? null, completeness: options.completeness ?? (options.cursor ? 'partial' : 'complete'), errors: options.errors ?? [], observedAt: options.observedAt ?? 123 } };
}
function endpoint(responses: DiscoveryResponse[]): DiscoveryEndpoint {
  let index = 0;
  return { execute: vi.fn(async () => responses[index++]) };
}
function read(adapter: ReturnType<typeof createSessionsResource>['adapter'], signal = new AbortController().signal) {
  return adapter.read({ context, signal });
}

describe('local TUI sessions resource', () => {
  it('reads every page including empty pages, anonymous rows and opaque third-provider identities', async () => {
    const anonymous = Array.from({ length: 121 }, (_, index) => session('claude', `native/${index}`));
    const same = [session('claude', 'opaque/same'), session('future-tool', 'opaque/same')];
    const service = endpoint([response(anonymous.slice(0, 100), { cursor: 'page2' }), response([], { cursor: 'page3' }), response([...anonymous.slice(100), ...same], { observedAt: 456 })]);
    const { resource, adapter } = createSessionsResource({ discovery: service });
    const page = await read(adapter);
    expect(page.completeness).toBe('complete');
    expect(page.sampledAt).toBe(456);
    expect(page.rows).toHaveLength(123);
    expect(new Set(page.rows.map((row) => row.id)).size).toBe(123);
    expect(page.rows.at(-1)).toMatchObject({ id: sessionKey(same[1].ref), cells: { name: '匿名', provider: 'future-tool' }, facets: { named: 'anonymous' } });
    expect(service.execute).toHaveBeenNthCalledWith(2, { op: 'list', cursor: 'page2', limit: 100 }, { contextId: 'local', signal: expect.any(AbortSignal) });
    expect(page.filters?.find((filter) => filter.id === 'named')).toMatchObject({ defaultValue: '' });
    expect(resource.columns.every((column) => column.width > 0)).toBe(true);
  });

  it('keeps stable full native/process keys and refreshes without retaining removed rows', async () => {
    const native = session('claude', '123');
    const process = { ...native, ref: { ...native.ref, referenceKind: 'process' as const } };
    const service = endpoint([response([native, process, native]), response([process])]);
    const { adapter } = createSessionsResource({ discovery: service });
    const first = await read(adapter);
    expect(first.rows).toHaveLength(2);
    expect(first.rows[0].id).not.toBe(first.rows[1].id);
    const second = await read(adapter);
    expect(second.rows.map((row) => row.id)).toEqual([first.rows[1].id]);
  });

  it('builds dynamic tool/raw-state facets from the whole unfiltered result including empty providers', async () => {
    const future = { ...session('future-tool', 'third'), rawStatus: { type: 'pondering', detail: 'new raw payload' } };
    const { adapter } = createSessionsResource({ discovery: endpoint([response([future])]), statusRegistry: createStatusRegistry({ 'future-tool': { pondering: '思考中' } }) });
    const page = await read(adapter);
    expect(page.filters?.find((filter) => filter.id === 'provider')?.options.map((option) => option.value)).toEqual(['', 'claude', 'codex', 'future-tool']);
    expect(page.filters?.find((filter) => filter.id === 'status')?.options).toContainEqual(expect.objectContaining({ value: JSON.stringify(future.rawStatus), label: '思考中<pondering>' }));
    expect(page.rows[0]).toMatchObject({ cells: { status: '思考中<pondering>' }, facets: { provider: 'future-tool', status: JSON.stringify(future.rawStatus), named: 'anonymous' } });
    expect(page.rows[0].detail).toContainEqual({ label: '原生状态', value: JSON.stringify(future.rawStatus, null, 2) });
  });

  it('retains full safe metadata/ref while filtering credentials and terminal sockets at the discovery boundary', async () => {
    const item = { ...session('future-tool', 'opaque/full/id:完整'), rawStatus: { type: 'unrecognized-new-state', reason: '详情保留' }, attributes: { cwd: '/a'.repeat(200), adminKey: 'SECRET', nested: { token: 'SECRET', useful: '保留' }, messagingSocketPath: 'SECRET' } };
    const { adapter } = createSessionsResource({ discovery: endpoint([response([item])]) });
    const page = await read(adapter);
    const row = page.rows[0];
    expect(row.copyValues?.ref).toBe(JSON.stringify(item.ref, null, 2));
    expect(row.detail).toContainEqual({ label: '原生引用', value: JSON.stringify(item.ref, null, 2) });
    expect(row.detail).toContainEqual({ label: '采样时间', value: '1970-01-01T00:00:00.123Z' });
    expect(JSON.stringify(row.detail)).toContain('保留');
    expect(JSON.stringify(page)).not.toContain('SECRET');
    expect(row.searchText).toContain('/a'.repeat(200));
    expect(row.cells.status).toBe('未识别<unrecognized-new-state>');
  });

  it('preserves earlier source failures when later pages finish and exposes full read information even with zero rows', async () => {
    const sourceError = { source: { contextId: 'local', providerId: 'codex', path: 'desktop' }, kind: 'unavailable' as const, message: 'Desktop source unavailable', nextStep: '检查 Codex Desktop 后刷新。' };
    const { adapter } = createSessionsResource({ discovery: endpoint([response([], { cursor: 'tail', errors: [sourceError] }), response([], { observedAt: 500 })]) });
    const page = await read(adapter);
    expect(page.rows).toEqual([]);
    expect(page.completeness).toBe('partial');
    const summary = JSON.stringify(page.detailViews?.['read-summary']);
    expect(summary).toContain('Desktop source unavailable');
    expect(summary).toContain('检查 Codex Desktop 后刷新。');
    expect(summary).toContain('desktop');
    expect(page.actionAvailability?.['read-summary']?.enabled).not.toBe(false);
  });

  it('retains available rows and reports malformed repeated cursors instead of looping', async () => {
    const service = endpoint([response([session('future-tool', 'one')], { cursor: 'repeat' }), response([session('future-tool', 'two')], { cursor: 'repeat' })]);
    const page = await read(createSessionsResource({ discovery: service }).adapter);
    expect(page.rows).toHaveLength(2);
    expect(page.completeness).toBe('partial');
    expect(JSON.stringify(page.detailViews)).toMatch(/游标|cursor/i);
    expect(service.execute).toHaveBeenCalledTimes(2);
  });

  it('keeps earlier pages on cancellation and does not start discovery for a pre-aborted read', async () => {
    const controller = new AbortController();
    let calls = 0;
    const service: DiscoveryEndpoint = { execute: vi.fn(async () => { calls++; controller.abort(); return response([session('claude', 'one')], { cursor: 'tail' }); }) };
    const cancelled = await read(createSessionsResource({ discovery: service }).adapter, controller.signal);
    expect(cancelled.completeness).toBe('cancelled');
    expect(calls).toBe(1);
    const before = new AbortController(); before.abort();
    const untouched = endpoint([response([])]);
    const page = await read(createSessionsResource({ discovery: untouched }).adapter, before.signal);
    expect(page.completeness).toBe('cancelled');
    expect(untouched.execute).not.toHaveBeenCalled();
  });

  it('returns promptly when a discovery endpoint ignores cancellation and keeps completed pages', async () => {
    const controller = new AbortController();
    let calls = 0;
    const service: DiscoveryEndpoint = { execute: vi.fn(async () => {
      calls++;
      if (calls === 1) return response([session('claude', 'one')], { cursor: 'pending' });
      return new Promise<DiscoveryResponse>(() => {});
    }) };
    const pending = read(createSessionsResource({ discovery: service }).adapter, controller.signal);
    await vi.waitFor(() => expect(calls).toBe(2));
    controller.abort();
    const result = await Promise.race([pending, new Promise<undefined>((resolve) => setTimeout(resolve, 100))]);
    expect(result).toMatchObject({ completeness: 'cancelled', rows: [{ id: sessionKey(session('claude', 'one').ref) }] });
  });

  it('retains earlier rows as partial when a later source page is unavailable', async () => {
    const { adapter } = createSessionsResource({ discovery: endpoint([response([session('claude', 'one')], { cursor: 'pending' }), response([], { completeness: 'unavailable' })]) });
    expect(await read(adapter)).toMatchObject({ completeness: 'partial', rows: [{ id: sessionKey(session('claude', 'one').ref) }] });
  });

  it('rejects absent or non-local contexts without silently scanning this machine', async () => {
    const service = endpoint([response([])]);
    const { adapter } = createSessionsResource({ discovery: service });
    const signal = new AbortController().signal;
    expect((await adapter.read({ signal })).completeness).toBe('unavailable');
    expect((await adapter.read({ context: { id: 'remote', kind: 'ssh', label: '远机' }, signal })).completeness).toBe('unavailable');
    expect(service.execute).not.toHaveBeenCalled();
  });

  it('copies only unambiguous supported full addresses and always provides a distinct full reference', async () => {
    const uuid = '12345678-1234-1234-1234-123456789abc';
    const items = [session('claude', 'named', '唯一名称'), session('claude', 'a', '重名'), session('codex', 'b', '重名'), session('claude', 'anonymous'), session('codex', uuid), session('future-tool', 'opaque/123', '未来工具')];
    const { resource, adapter } = createSessionsResource({ discovery: endpoint([response(items)]) });
    const page = await read(adapter);
    expect(page.rows[0].copyValue).toBe('唯一名称');
    expect(page.rows[4].copyValue).toBe(`codex/${uuid}`);
    for (const index of [1, 2, 3, 5]) {
      expect(page.rows[index].copyValue).toBeUndefined();
      expect(page.rows[index].actionAvailability?.copy).toMatchObject({ enabled: false, reason: expect.any(String), nextStep: expect.any(String) });
      expect(page.rows[index].copyValues?.ref).toBe(JSON.stringify(items[index].ref, null, 2));
    }
    expect(resource.actions).toContainEqual(expect.objectContaining({ shortcut: 'Y', kind: 'copy', copyKey: 'ref' }));
  });

  it('does not publish a UUID address shadowed by an exact session name or partial discovery', async () => {
    const uuid = '12345678-1234-1234-1234-123456789abc';
    const { adapter } = createSessionsResource({ discovery: endpoint([response([session('codex', uuid), session('claude', 'other', `codex/${uuid}`)]), response([session('claude', 'named', '可见名字')], { completeness: 'partial' })]) });
    expect((await read(adapter)).rows[0].copyValue).toBeUndefined();
    expect((await read(adapter)).rows[0].copyValue).toBeUndefined();
  });

  it('does not publish a send address when a provider only declares discovery', async () => {
    const item = { ...session('claude', 'id', '只读会话'), capabilities: { ...capabilities, delivery: false } };
    const page = await read(createSessionsResource({ discovery: endpoint([response([item])]) }).adapter);
    expect(page.rows[0].copyValue).toBeUndefined();
    expect(page.rows[0].actionAvailability?.copy).toMatchObject({ enabled: false });
  });

  it('copies reserved-looking exact names only as existing local resolver addresses', async () => {
    const names = ['tcp:star:machine:name', 'ssh:host', 'claude/person', 'codex/person'];
    const items = names.map((name, index) => session('claude', `native-${index}`, name));
    const page = await read(createSessionsResource({ discovery: endpoint([response(items)]) }).adapter);
    for (const [index, row] of page.rows.entries()) {
      expect(row.copyValue).toBe(names[index]);
      expect(resolveTargetByName(row.copyValue ?? '', items.map((item) => ({ sessionId: item.ref.nativeId, name: item.name ?? undefined })), [])).toMatchObject({ side: 'claude', session: { sessionId: items[index].ref.nativeId } });
    }
  });

  it('does not present terminal control characters in names as a pasteable address', async () => {
    const page = await read(createSessionsResource({ discovery: endpoint([response([session('claude', 'id', '名字\n\u001b[2J')])]) }).adapter);
    expect(page.rows[0].copyValue).toBeUndefined();
    expect(page.rows[0].actionAvailability?.copy).toMatchObject({ enabled: false });
    expect(page.rows[0].copyValues?.ref).toContain('"nativeId": "id"');
  });

  it('registers read-only native guidance with future-provider extensions and disables unsupported mutations/scope', async () => {
    const guide = vi.fn(() => ({ title: '原生工具', fields: [{ label: '下一步', value: '请回 future-tool 原生窗口。' }] }));
    const { resource, adapter } = createSessionsResource({ discovery: endpoint([response([session('future-tool', 'opaque')])]), nativeGuides: { 'future-tool': guide } });
    const page = await read(adapter);
    expect(page.rows[0].detailViews?.['native-guide']?.fields).toContainEqual({ label: '下一步', value: '请回 future-tool 原生窗口。' });
    expect(guide).toHaveBeenCalledOnce();
    expect(resource.actions).toContainEqual(expect.objectContaining({ shortcut: 'g', kind: 'detail', viewId: 'native-guide' }));
    expect(resource.actions).toContainEqual(expect.objectContaining({ shortcut: 'i', kind: 'detail', viewId: 'read-summary', selectionPolicy: 'none' }));
    expect(page.actionAvailability?.adopt).toMatchObject({ enabled: false });
    expect(page.actionAvailability?.['remove-member']).toMatchObject({ enabled: false });
    expect(page.actionAvailability?.['filter-scope']).toMatchObject({ enabled: false, nextStep: expect.any(String) });
  });
});

function membership() {
  return {
    listTargets: vi.fn(async () => ({ stars: [{ id: 'star-full-one', label: '开发星', eligible: true }, { id: 'star-invalid', label: '不可用星', eligible: false, reason: '身份不完整' }], completeness: 'complete' as const, observedAt: 123, errors: [] })),
    check: vi.fn(async () => ({ allowed: true, impact: ['只修改星册位，不终止原生工具。'] })),
    apply: vi.fn(async () => ({ kind: 'applied' as 'applied' | 'rejected' | 'uncertain', message: '已完成' })),
  };
}

describe('TUI session membership actions', () => {
  it('presents configured stars as explicit options without inferring membership or connecting them', async () => {
    const management = membership();
    const { adapter } = createSessionsResource({ discovery: endpoint([response([session('claude', 'native-id')])]), membership: management });
    const page = await read(adapter);
    expect(management.check).not.toHaveBeenCalled();
    expect(management.apply).not.toHaveBeenCalled();
    expect(page.actionAvailability?.adopt).toMatchObject({ enabled: true, fields: [{ id: 'starId', required: true, options: expect.arrayContaining([{ value: 'star-full-one', label: '开发星', enabled: true }, { value: 'star-invalid', label: '不可用星', enabled: false, reason: '身份不完整' }]) }] });
    expect(page.actionAvailability?.['remove-member']?.enabled).toBe(true);
    expect(page.rows[0].cells).not.toHaveProperty('membership');
  });

  it('checks exact selected provider/native identity and star before submitting the same immutable identity', async () => {
    const management = membership();
    const item = session('claude', 'opaque/native/unchanged');
    const { resource, adapter } = createSessionsResource({ discovery: endpoint([response([item])]), membership: management });
    const page = await read(adapter);
    const action = resource.actions.find((candidate) => candidate.id === 'adopt');
    if (!action) throw new Error('Missing adopt action.');
    const signal = new AbortController().signal;
    const request = { action, target: page.rows[0], context, values: { starId: 'star-full-one' }, signal };
    expect(await adapter.checkAction?.(request)).toMatchObject({ enabled: true, impact: expect.arrayContaining(['只修改星册位，不终止原生工具。']) });
    expect(management.check).toHaveBeenCalledWith({ op: 'adopt', ref: item.ref, starId: 'star-full-one', signal });
    expect(await adapter.mutate?.(request)).toMatchObject({ message: '已完成' });
    expect(management.apply).toHaveBeenCalledWith({ op: 'adopt', ref: item.ref, starId: 'star-full-one', signal });
  });

  it('preserves fields on rejection or an uncertain acknowledgement and never reports success', async () => {
    const management = membership();
    management.apply.mockResolvedValueOnce({ kind: 'uncertain', message: '回执未知，请核实册位。' }).mockResolvedValueOnce({ kind: 'rejected', message: '目标已变化，拒绝删除。' });
    const { resource, adapter } = createSessionsResource({ discovery: endpoint([response([session('codex', 'full-native')])]), membership: management });
    const page = await read(adapter);
    const action = resource.actions.find((candidate) => candidate.id === 'remove-member');
    if (!action) throw new Error('Missing remove action.');
    const request = { action, target: page.rows[0], context, values: { starId: 'star-full-one' }, signal: new AbortController().signal };
    await expect(adapter.mutate?.(request)).rejects.toThrow('回执未知');
    await expect(adapter.mutate?.(request)).rejects.toThrow('目标已变化');
    expect(request.values).toEqual({ starId: 'star-full-one' });
    expect(management.apply).toHaveBeenCalledTimes(2);
  });

  it('disables process references and rejects mismatched context/ref and unavailable star choices before mutation', async () => {
    const management = membership();
    const process = session('claude', '321'); process.ref.referenceKind = 'process';
    const { resource, adapter } = createSessionsResource({ discovery: endpoint([response([process])]), membership: management });
    const page = await read(adapter);
    expect(page.rows[0].actionAvailability?.adopt).toMatchObject({ enabled: false });
    expect(page.rows[0].actionAvailability?.['remove-member']).toMatchObject({ enabled: false });
    const action = resource.actions.find((candidate) => candidate.id === 'adopt');
    if (!action) throw new Error('Missing adopt action.');
    const request = { action, target: page.rows[0], context: { ...context, id: 'other-local' }, values: { starId: 'star-full-one' }, signal: new AbortController().signal };
    expect(await adapter.checkAction?.(request)).toMatchObject({ enabled: false });
    await expect(adapter.mutate?.(request)).rejects.toThrow();
    expect(management.check).not.toHaveBeenCalled();
    expect(management.apply).not.toHaveBeenCalled();
  });
});
