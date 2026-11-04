import { describe, expect, it } from 'vitest';
import type { DiscoveryEndpoint, DiscoverySession } from '../src/application/discovery/model.js';
import { createSessionsResource } from '../src/tui/resources/sessions.js';
import { createStatusRegistry } from '../src/tui/resources/status.js';

const context = { id: 'local', kind: 'local', label: '本机' };
const capabilities = { discovery: true, delivery: true, launch: false, diagnostics: false };
function session(id: string, name: string | null = null, providerId = 'dsh'): DiscoverySession {
  return { ref: { contextId: 'local', providerId, nativeId: id, endpointType: providerId === 'dsh' ? 'host' : 'shared' }, name, rawStatus: { type: 'idle' }, capabilities, attributes: {} };
}
function discovery(items: DiscoverySession[]): DiscoveryEndpoint {
  return { execute: async () => ({ op: 'list', providers: [...new Set(items.map((item) => item.ref.providerId))].map((providerId) => ({ providerId, capabilities })),
    page: { items, completeness: 'complete', nextCursor: null, errors: [], observedAt: 1 } }) };
}
describe('Harness native session TUI', () => {
  it('copies full commands with exact IDs and explicit tools even when another tool or name shares the same value', async () => {
    const items = [session('native_full_id'), session('other', 'native_full_id'), session('native_full_id', null, 'opencode')];
    const page = await createSessionsResource({ discovery: discovery(items) }).adapter.read({ context, signal: new AbortController().signal });
    expect(page.rows.map((row) => row.copyValue)).toEqual([
      'crosschat send --to native_full_id --tool dsh --body "<正文>"',
      'crosschat send --to other --tool dsh --body "<正文>"',
      'crosschat send --to native_full_id --tool opencode --body "<正文>"',
    ]);
    expect(page.rows.map((row) => row.copyValues?.nativeId)).toEqual(['native_full_id', 'other', 'native_full_id']);
  });
  it('guides the user to the original Harness UI without offering an unrelated SDK resume', async () => {
    const page = await createSessionsResource({ discovery: discovery([session('native_full_id')]) }).adapter.read({ context, signal: new AbortController().signal });
    const guide = page.rows[0].detailViews?.['native-guide'];
    expect(guide?.title).toBe('DeepSeek Harness 原生操作');
    expect(guide?.fields).toContainEqual({ label: '完整会话 ID', value: 'native_full_id' });
    expect(guide?.fields.map((field) => field.value).join(' ')).toMatch(/原.*窗口|Web|桌面/);
  });
  it('keeps the same native ID independent across Host and Desktop, including anonymous rows and complete details', async () => {
    const id = 'session-11111111-2222-4333-8444-555555555555';
    const host = session(id);
    const desktop = { ...session(id, '桌面标题'), ref: { ...host.ref, endpointType: 'desktop' } };
    const page = await createSessionsResource({ discovery: discovery([host, desktop]) }).adapter.read({ context, signal: new AbortController().signal });
    expect(new Set(page.rows.map((row) => row.id)).size).toBe(2);
    expect(page.rows.map((row) => [row.cells.name, row.cells.provider, row.facets?.provider])).toEqual([
      ['匿名', 'dsh', 'dsh'], ['桌面标题', 'dsh-desktop', 'dsh-desktop'],
    ]);
    expect(page.rows.map((row) => row.copyValue)).toEqual([
      `crosschat send --to ${id} --tool dsh --body "<正文>"`,
      `crosschat send --to ${id} --tool dsh-desktop --body "<正文>"`,
    ]);
    for (const [index, row] of page.rows.entries()) {
      expect(JSON.parse(row.copyValues!.ref)).toEqual([host, desktop][index].ref);
      expect(row.detail).toContainEqual({ label: '原生引用', value: row.copyValues!.ref });
      expect(row.detailViews?.['native-guide']?.fields).toContainEqual({ label: '完整会话 ID', value: id });
    }
  });
  it('withholds a command for an incomplete native snapshot while retaining a complete reference', async () => {
    const source = discovery([session('session-exact')]);
    const page = await createSessionsResource({ discovery: { async execute(request, options) {
      const result = await source.execute(request, options);
      if (result.op !== 'list') throw new Error('Only list is used in this fixture');
      return { ...result, page: { ...result.page, completeness: 'partial' } };
    } } }).adapter.read({ context, signal: new AbortController().signal });
    expect(page.rows).toHaveLength(1);
    for (const row of page.rows) {
      expect(row.copyValue).toBeUndefined();
      expect(row.actionAvailability?.copy?.reason).toMatch(/不完整/);
      expect(JSON.parse(row.copyValues!.ref).nativeId).toBe('session-exact');
    }
  });
  it('preserves the two native states and displays unknown values explicitly', () => {
    const registry = createStatusRegistry();
    expect(registry.format('dsh', { type: 'idle' })).toBe('空闲<idle>');
    expect(registry.format('dsh', { type: 'running' })).toBe('运行中<running>');
    expect(registry.format('dsh', { type: 'future' })).toBe('未识别<future>');
  });
});
