import { describe, expect, it, vi } from 'vitest';
import type { DiscoveryEndpoint, DiscoveryResponse, DiscoverySession } from '../src/application/discovery/model.js';
import { defaultMembershipProviders } from '../src/application/session-membership/providers.js';
import { createSessionsResource } from '../src/tui/resources/sessions.js';
import { createStatusRegistry } from '../src/tui/resources/status.js';

const context = { id: 'local', kind: 'local', label: '本机' };
const capabilities = { discovery: true, delivery: true, launch: false, diagnostics: false };
function session(id: string, name: string | null = null, providerId = 'opencode'): DiscoverySession {
  return { ref: { contextId: 'local', providerId, nativeId: id }, name, rawStatus: { type: 'inactive' }, capabilities, attributes: { cwd: '/isolated/project' } };
}
function discovery(items: DiscoverySession[], completeness: 'complete' | 'partial' = 'complete'): DiscoveryEndpoint {
  const response: DiscoveryResponse = { op: 'list', providers: [...new Set(items.map((item) => item.ref.providerId))].map((providerId) => ({ providerId, capabilities })), page: { items, completeness, nextCursor: null, errors: [], observedAt: 123 } };
  return { execute: vi.fn(async () => response) };
}

describe('OpenCode TUI provider integration', () => {
  it('copies provider-qualified full native IDs for named and anonymous sessions', async () => {
    const items = [session('ses_anonymous'), session('ses_named', '共享名'), session('other', '共享名', 'claude')];
    const { adapter } = createSessionsResource({ discovery: discovery(items) });
    const page = await adapter.read({ context, signal: new AbortController().signal });
    expect(page.rows.slice(0, 2).map((row) => row.copyValue)).toEqual(['opencode/ses_anonymous', 'opencode/ses_named']);
    expect(page.rows[0].copyValues?.ref).toBe(JSON.stringify(items[0].ref, null, 2));
    expect(page.filters?.find((filter) => filter.id === 'provider')?.options).toContainEqual(expect.objectContaining({ value: 'opencode' }));
  });

  it('preserves original OpenCode foreground state without labeling inactivity as idle', () => {
    const registry = createStatusRegistry();
    expect(registry.format('opencode', { type: 'running' })).toBe('运行中<running>');
    expect(registry.format('opencode', { type: 'inactive' })).toBe('无前台执行<inactive>');
    expect(registry.format('opencode', { type: 'future-native-state' })).toBe('未识别<future-native-state>');
  });

  it('does not publish an address when native ID is shadowed by another OpenCode name', async () => {
    const { adapter } = createSessionsResource({ discovery: discovery([session('ses_exact'), session('ses_other', 'ses_exact')]) });
    const page = await adapter.read({ context, signal: new AbortController().signal });
    expect(page.rows[0].copyValue).toBeUndefined();
    expect(page.rows[0].actionAvailability?.copy).toMatchObject({ enabled: false });
    expect(page.rows[1].copyValue).toBe('opencode/ses_other');
  });

  it('does not offer legacy names or UUIDs that now resolve to an OpenCode session', async () => {
    const uuid = '12345678-1234-1234-1234-123456789abc';
    const items = [session(uuid, null, 'codex'), session('ses_target', `codex/${uuid}`), session('claude-session', 'opencode/ses_target', 'claude')];
    const page = await createSessionsResource({ discovery: discovery(items) }).adapter.read({ context, signal: new AbortController().signal });
    expect(page.rows[0].copyValue).toBeUndefined();
    expect(page.rows[2].copyValue).toBeUndefined();
  });

  it('keeps process-only, readonly, partial and terminal-control IDs out of pasteable addresses', async () => {
    const process = session('123'); process.ref.referenceKind = 'process';
    const readonly = { ...session('ses_readonly'), capabilities: { ...capabilities, delivery: false } };
    const bad = session('ses_\n\u001b[2J');
    const page = await createSessionsResource({ discovery: discovery([process, readonly, bad]) }).adapter.read({ context, signal: new AbortController().signal });
    expect(page.rows.every((row) => row.copyValue === undefined)).toBe(true);
    const partial = await createSessionsResource({ discovery: discovery([session('ses_one')], 'partial') }).adapter.read({ context, signal: new AbortController().signal });
    expect(partial.rows[0].copyValue).toBeUndefined();
  });

  it('provides native CLI guidance tied to the exact session rather than a Codex command', async () => {
    const page = await createSessionsResource({ discovery: discovery([session('ses_full_native_id')]) }).adapter.read({ context, signal: new AbortController().signal });
    const guide = page.rows[0].detailViews?.['native-guide'];
    expect(guide?.title).toBe('OpenCode CLI 原生操作');
    expect(guide?.fields).toContainEqual({ label: '完整会话 ID', value: 'ses_full_native_id' });
    expect(JSON.stringify(guide)).not.toMatch(/codex resume|claude --resume/);
  });

  it('delegates adoption using the exact OpenCode reference and explicit star selection', async () => {
    const item = session('ses_full_native_id');
    const membership = {
      listTargets: vi.fn(async () => ({ stars: [{ id: 'star-full', label: '开发星', eligible: true }], completeness: 'complete' as const, observedAt: 123, errors: [] })),
      check: vi.fn(async () => ({ allowed: true })),
      apply: vi.fn(async () => ({ kind: 'applied' as const, message: '完成' })),
    };
    const { resource, adapter } = createSessionsResource({ discovery: discovery([item]), membership });
    const signal = new AbortController().signal;
    const page = await adapter.read({ context, signal });
    const action = resource.actions.find((entry) => entry.id === 'adopt');
    if (!action || !adapter.checkAction || !adapter.mutate) throw new Error('Missing adoption contract.');
    const request = { context, action, target: page.rows[0], values: { starId: 'star-full' }, signal };
    expect(await adapter.checkAction(request)).toMatchObject({ enabled: true });
    await adapter.mutate(request);
    expect(membership.check).toHaveBeenCalledWith({ op: 'adopt', ref: item.ref, starId: 'star-full', signal });
    expect(membership.apply).toHaveBeenCalledWith({ op: 'adopt', ref: item.ref, starId: 'star-full', signal });
  });

  it('registers exact membership for inactive and running native OpenCode sessions', () => {
    const provider = defaultMembershipProviders.find((entry) => entry.providerId === 'opencode');
    expect(provider).toBeDefined();
    expect(provider?.tool).toBe('opencode');
    expect(provider?.canAdopt(session('ses_inactive'))).toMatchObject({ allowed: true });
    expect(provider?.canAdopt({ ...session('ses_running'), rawStatus: { type: 'running' } })).toMatchObject({ allowed: true });
    expect(provider?.canAdopt({ ...session('ses_readonly'), capabilities: { ...capabilities, delivery: false } })).toMatchObject({ allowed: false });
  });
});
