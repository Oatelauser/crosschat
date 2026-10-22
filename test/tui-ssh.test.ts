import { describe, expect, it, vi } from 'vitest';
import type { DiscoveryResponse, DiscoverySession } from '../src/application/discovery/index.js';
import { createSshResource, createSshDoctorResource, createSshSessionsResource } from '../src/tui/resources/ssh.js';

const context = { id: 'ssh:fixture', kind: 'ssh', label: 'fixture', target: 'fixture' };
const capabilities = { discovery: true, delivery: true, launch: false, diagnostics: false };
const connection = { id: 'ssh:fixture', kind: 'ssh', name: 'fixture', target: 'fixture', identityHint: '身份尚未核实', attributes: { source: '/isolated/.ssh/config' } };
const signal = () => new AbortController().signal;
function application() {
  return {
    list: vi.fn(async () => ({ items: [connection], errors: [], observedAt: 21 })),
    inspect: vi.fn(async () => ({ contextId: context.id, host: 'fixture', completeness: 'complete' as const, observedAt: 22, errors: [], providers: [{ providerId: 'future-tool', capabilities }], sampleCount: 0 })),
    doctor: vi.fn(async () => ({ contextId: context.id, host: 'fixture', completeness: 'complete' as const, observedAt: 23, errors: [], exitCode: 1,
      result: { groups: [{ context: { kind: 'environment' as const }, checks: [{ code: 'node-unsupported' as const, level: 'error' as const, data: { version: '20.0.0' } }] }], summary: { pass: 0, warn: 0, error: 1, failed: true } } })),
    discovery: { execute: vi.fn(async (): Promise<DiscoveryResponse> => ({ op: 'list', providers: [], page: { items: [], nextCursor: null, completeness: 'complete', errors: [], observedAt: 24 } })) },
  };
}

describe('SSH resource presentation', () => {
  it('lists aliases without probing and declares complete readonly keys and fixed-target routes', async () => {
    const ssh = application();
    const { resource, adapter } = createSshResource({ ssh });
    const page = await adapter.read({ context: { id: 'local', kind: 'local', label: '本机' }, signal: signal() });
    expect(resource.id).toBe('ssh');
    expect(resource.actions.map((action) => action.shortcut)).toEqual(expect.arrayContaining(['Enter', 'd', 'a', 't', 'D', 'g', 'y', 'i']));
    expect(resource.actions.every((action) => !action.mutation)).toBe(true);
    expect(resource.actions.find((action) => action.shortcut === 'a')?.kind).toBe('route-choice');
    expect(resource.columns.every((column) => column.width > 0)).toBe(true);
    expect(page.rows[0]).toMatchObject({ id: 'ssh:fixture', copyValue: 'fixture', actionRoutes: {
      sessions: { resourceId: 'sessions', contextId: 'ssh:fixture' }, check: { resourceId: 'ssh', contextId: 'ssh:fixture', query: { operation: 'check' } }, doctor: { resourceId: 'doctor', contextId: 'ssh:fixture' },
    } });
    expect(JSON.stringify(page.rows[0].detail)).toContain('尚未核实');
    expect(ssh.inspect).not.toHaveBeenCalled();
    expect(ssh.doctor).not.toHaveBeenCalled();
    expect(ssh.discovery.execute).not.toHaveBeenCalled();
    expect(page.routeChoices?.aliases.options).toContainEqual(expect.objectContaining({ value: 'ssh:fixture', route: { resourceId: 'sessions', contextId: 'ssh:fixture' } }));
  });

  it('copies a verified existing SSH addressing command, while ambiguous and shell-sensitive targets remain unavailable', async () => {
    const ssh = application();
    const names = ['safe-name', 'same', 'same', 'name$(unsafe)', 'two words'];
    const items: DiscoverySession[] = names.map((name, index) => ({ ref: { contextId: context.id, providerId: 'claude', nativeId: `full-${index}` }, name, rawStatus: 'idle', capabilities, attributes: {} }));
    ssh.discovery.execute.mockResolvedValueOnce({ op: 'list', providers: [{ providerId: 'claude', capabilities }], page: { items, nextCursor: null, completeness: 'complete', errors: [], observedAt: 0 } });
    const page = await createSshSessionsResource({ ssh }).adapter.read({ context, signal: signal() });
    expect(page.rows[0].copyValue).toBe('crosschat send --via ssh:fixture --to safe-name');
    for (const row of page.rows.slice(1)) {
      expect(row.copyValue).toBeUndefined();
      expect(row.actionAvailability?.copy?.enabled).toBe(false);
    }
  });

  it('checks only the selected SSH context on explicit check route and preserves scoped failure guidance', async () => {
    const ssh = application();
    const { adapter } = createSshResource({ ssh });
    const selectedSignal = signal();
    const page = await adapter.read({ context, route: { resourceId: 'ssh', contextId: context.id, query: { operation: 'check' } }, signal: selectedSignal });
    expect(ssh.inspect).toHaveBeenCalledExactlyOnceWith({ contextId: context.id, signal: selectedSignal });
    expect(JSON.stringify(page)).toMatch(/全量|采样/);
    expect(JSON.stringify(page)).toContain('回程');
    expect(ssh.list).not.toHaveBeenCalled();
    const bad = await adapter.read({ context, route: { resourceId: 'ssh', contextId: 'ssh:other', query: { operation: 'check' } }, signal: signal() });
    expect(bad.completeness).toBe('unavailable');
    expect(ssh.inspect).toHaveBeenCalledTimes(1);
  });

  it('shows typed doctor findings, complete identity and remote-only treatment without a local fallback', async () => {
    const ssh = application();
    const { resource, adapter } = createSshDoctorResource({ ssh });
    const page = await adapter.read({ context, signal: signal() });
    expect(resource.id).toBe('doctor');
    expect(page.completeness).toBe('complete');
    expect(page.rows[0].cells).toMatchObject({ state: expect.stringContaining('<error>') });
    expect(JSON.stringify(page.rows[0].detail)).toContain('node-unsupported');
    expect(JSON.stringify(page)).toContain('fixture');
    expect(page.rows[0].copyValue).toMatch(/SSH|远端/);
    expect(ssh.doctor).toHaveBeenCalledOnce();
    expect((await adapter.read({ context: { id: 'local', kind: 'local', label: '本机' }, signal: signal() })).completeness).toBe('unavailable');
    expect(ssh.doctor).toHaveBeenCalledOnce();
  });

  it('reuses complete discovery, anonymous/provider filtering and full references while disabling local writes and associations', async () => {
    const ssh = application();
    const native: DiscoverySession = { ref: { contextId: context.id, providerId: 'future-tool', nativeId: 'same-full-id' }, name: null, rawStatus: { type: 'future-state' }, capabilities, attributes: { cwd: '/remote/完整/path' } };
    ssh.discovery.execute.mockResolvedValueOnce({ op: 'list', providers: [{ providerId: 'future-tool', capabilities }], page: { items: [native], nextCursor: 'more', completeness: 'partial', errors: [], observedAt: 30 } })
      .mockResolvedValueOnce({ op: 'list', providers: [{ providerId: 'codex', capabilities }], page: { items: [{ ...native, ref: { ...native.ref, providerId: 'codex' }, attributes: { transport: 'desktop' } }], nextCursor: null, completeness: 'complete', errors: [], observedAt: 31 } });
    const { resource, adapter } = createSshSessionsResource({ ssh });
    const page = await adapter.read({ context, signal: signal() });
    expect(page.rows).toHaveLength(2);
    expect(new Set(page.rows.map((row) => row.id)).size).toBe(2);
    expect(page.rows[0].copyValues?.ref).toBe(JSON.stringify(native.ref, null, 2));
    expect(page.filters?.find((filter) => filter.id === 'named')?.defaultValue).toBe('');
    expect(page.actionAvailability?.adopt?.enabled).toBe(false);
    expect(page.actionAvailability?.['remove-member']?.enabled).toBe(false);
    expect(page.rows.every((row) => !row.actionRoutes?.logs && !row.actionRoutes?.deliveries)).toBe(true);
    expect(resource.actions.find((action) => action.id === 'logs')?.enabled).toBe(false);
    expect(JSON.stringify(page.rows[0].detailViews?.['native-guide'])).toContain('fixture');
    expect(JSON.stringify(page.rows[1].detailViews?.['native-guide'])).toContain('原桌面');
    expect(page.rows[0].copyValue).toBeUndefined();
    expect((await adapter.read({ context: { id: 'local', kind: 'local', label: '本机' }, signal: signal() })).completeness).toBe('unavailable');
    expect(ssh.discovery.execute).toHaveBeenCalledTimes(2);
  });
});
