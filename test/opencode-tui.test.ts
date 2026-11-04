import { describe, expect, it, vi } from 'vitest';
import type { DiscoveryEndpoint, DiscoveryResponse, DiscoverySession } from '../src/application/discovery/model.js';
import { defaultMembershipProviders } from '../src/application/session-membership/providers.js';
import { createSessionsResource } from '../src/tui/resources/sessions.js';
import { createStatusRegistry } from '../src/tui/resources/status.js';
import { listOpenCodeThreads } from '../src/opencode/client.js';
import { MultichatError } from '../src/errors.js';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const context = { id: 'local', kind: 'local', label: '本机' };
const capabilities = { discovery: true, delivery: true, launch: false, diagnostics: false };
function session(id: string, name: string | null = null, providerId = 'opencode'): DiscoverySession {
  return { ref: { contextId: 'local', providerId, nativeId: id, endpointType: providerId === 'opencode' ? 'shared' : 'cli' }, name, rawStatus: { type: 'inactive' }, capabilities, attributes: { cwd: '/isolated/project' } };
}
function discovery(items: DiscoverySession[], completeness: 'complete' | 'partial' = 'complete'): DiscoveryEndpoint {
  const response: DiscoveryResponse = { op: 'list', providers: [...new Set(items.map((item) => item.ref.providerId))].map((providerId) => ({ providerId, capabilities })), page: { items, completeness, nextCursor: null, errors: [], observedAt: 123 } };
  return { execute: vi.fn(async () => response) };
}

describe('OpenCode TUI provider integration', () => {
  it('copies full send commands with native IDs and explicit tools for named and anonymous sessions', async () => {
    const items = [session('ses_anonymous'), session('ses_named', '共享名'), session('other', '共享名', 'claude')];
    const { adapter } = createSessionsResource({ discovery: discovery(items) });
    const page = await adapter.read({ context, signal: new AbortController().signal });
    expect(page.rows.slice(0, 2).map((row) => row.copyValue)).toEqual([
      'crosschat send --to ses_anonymous --tool opencode --body "<正文>"',
      'crosschat send --to ses_named --tool opencode --body "<正文>"',
    ]);
    expect(page.rows.slice(0, 2).map((row) => row.copyValues?.nativeId)).toEqual(['ses_anonymous', 'ses_named']);
    expect(page.rows[0].copyValues?.ref).toBe(JSON.stringify(items[0].ref, null, 2));
    expect(page.filters?.find((filter) => filter.id === 'provider')?.options).toContainEqual(expect.objectContaining({ value: 'opencode' }));
  });

  it('preserves original OpenCode foreground state without labeling inactivity as idle', () => {
    const registry = createStatusRegistry();
    expect(registry.format('opencode', { type: 'running' })).toBe('运行中<running>');
    expect(registry.format('opencode', { type: 'inactive' })).toBe('无前台执行<inactive>');
    expect(registry.format('opencode', { type: 'future-native-state' })).toBe('未识别<future-native-state>');
  });

  it('keeps full native ID addresses precise when another OpenCode session uses that ID as a name', async () => {
    const { adapter } = createSessionsResource({ discovery: discovery([session('ses_exact'), session('ses_other', 'ses_exact')]) });
    const page = await adapter.read({ context, signal: new AbortController().signal });
    expect(page.rows[0].copyValue).toBe('crosschat send --to ses_exact --tool opencode --body "<正文>"');
    expect(page.rows[1].copyValue).toBe('crosschat send --to ses_other --tool opencode --body "<正文>"');
  });

  it('copies exact IDs without interpreting another session name as a tool qualifier', async () => {
    const uuid = '12345678-1234-1234-1234-123456789abc';
    const items = [session(uuid, null, 'codex'), session('ses_target', `codex/${uuid}`), session('claude-session', 'opencode/ses_target', 'claude')];
    const page = await createSessionsResource({ discovery: discovery(items) }).adapter.read({ context, signal: new AbortController().signal });
    expect(page.rows[0].copyValue).toBe(`crosschat send --to ${uuid} --tool codex-cli --body "<正文>"`);
    expect(page.rows[2].copyValue).toBe('crosschat send --to claude-session --tool claude --body "<正文>"');
    expect(page.rows.map((row) => row.copyValues?.nativeId)).toEqual([uuid, 'ses_target', 'claude-session']);
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

  it('guides desktop and CLI users to the native session while keeping the launcher a CLI command', async () => {
    const page = await createSessionsResource({ discovery: discovery([session('ses_full_native_id')]) }).adapter.read({ context, signal: new AbortController().signal });
    const guide = page.rows[0].detailViews?.['native-guide'];
    expect(guide?.title).toBe('OpenCode 原生操作');
    expect(guide?.fields).toContainEqual({ label: '完整会话 ID', value: 'ses_full_native_id' });
    expect(guide?.fields.find((field) => field.label === '继续聊天')?.value).toContain('桌面');
    const clientGuide = guide?.fields.find((field) => field.label === '客户端指引')?.value;
    expect(clientGuide).toContain('默认本机服务');
    expect(clientGuide).toContain('crosschat opencode');
    expect(clientGuide).toContain('CLI');
    expect(JSON.stringify(guide)).not.toMatch(/codex resume|claude --resume/);
  });

  it('does not tell desktop users to start an extra CLI when the service is absent', async () => {
    const registrationFile = join(tmpdir(), `crosschat-desktop-guide-${randomUUID()}`, 'service.json');
    const error = await listOpenCodeThreads({ env: {}, registrationFile }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(MultichatError);
    if (!(error instanceof MultichatError)) throw new Error('Expected a missing service error.');
    expect(error.code).toBe('OPENCODE_NOT_CONFIGURED');
    expect(error.message).toMatch(/Desktop|桌面/);
    expect(error.message).not.toContain('Start OpenCode CLI,');
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
