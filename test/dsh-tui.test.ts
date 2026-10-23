import { describe, expect, it } from 'vitest';
import type { DiscoveryEndpoint, DiscoverySession } from '../src/application/discovery/model.js';
import { createSessionsResource } from '../src/tui/resources/sessions.js';
import { createStatusRegistry } from '../src/tui/resources/status.js';

const context = { id: 'local', kind: 'local', label: '本机' };
const capabilities = { discovery: true, delivery: true, launch: false, diagnostics: false };
function session(id: string, name: string | null = null, providerId = 'dsh'): DiscoverySession {
  return { ref: { contextId: 'local', providerId, nativeId: id }, name, rawStatus: { type: 'idle' }, capabilities, attributes: {} };
}
function discovery(items: DiscoverySession[]): DiscoveryEndpoint {
  return { execute: async () => ({ op: 'list', providers: [...new Set(items.map((item) => item.ref.providerId))].map((providerId) => ({ providerId, capabilities })),
    page: { items, completeness: 'complete', nextCursor: null, errors: [], observedAt: 1 } }) };
}
describe('Harness native session TUI', () => {
  it('copies exact qualified IDs even when another tool or name shares the same value', async () => {
    const items = [session('native_full_id'), session('other', 'native_full_id'), session('native_full_id', null, 'opencode')];
    const page = await createSessionsResource({ discovery: discovery(items) }).adapter.read({ context, signal: new AbortController().signal });
    expect(page.rows.map((row) => row.copyValue)).toEqual(['dsh/native_full_id', 'dsh/other', 'opencode/native_full_id']);
  });
  it('guides the user to the original Harness UI without offering an unrelated SDK resume', async () => {
    const page = await createSessionsResource({ discovery: discovery([session('native_full_id')]) }).adapter.read({ context, signal: new AbortController().signal });
    const guide = page.rows[0].detailViews?.['native-guide'];
    expect(guide?.title).toBe('DeepSeek Harness 原生操作');
    expect(guide?.fields).toContainEqual({ label: '完整会话 ID', value: 'native_full_id' });
    expect(guide?.fields.map((field) => field.value).join(' ')).toMatch(/原.*窗口|Web|桌面/);
  });
  it('preserves the two native states and displays unknown values explicitly', () => {
    const registry = createStatusRegistry();
    expect(registry.format('dsh', { type: 'idle' })).toBe('空闲<idle>');
    expect(registry.format('dsh', { type: 'running' })).toBe('运行中<running>');
    expect(registry.format('dsh', { type: 'future' })).toBe('未识别<future>');
  });
});
