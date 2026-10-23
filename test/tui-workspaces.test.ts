import { describe, expect, it, vi } from 'vitest';
import { createTuiController } from '../src/tui/app/controller.js';
import { createResourceRegistry, defaultResources } from '../src/tui/resources/registry.js';
import { contextsResource } from '../src/tui/resources/contexts.js';
import type { TuiContext, TuiPage, TuiReadRequest } from '../src/tui/model.js';

const contexts: TuiContext[] = [
  { id: 'local', kind: 'local', label: '本机', target: 'fixture' },
  { id: 'ssh:dev', kind: 'ssh', label: '开发服务器', target: 'dev' },
  { id: 'tcp:star:one', kind: 'tcp', label: '远端星', target: 'server:5210' },
];
const registry = () => createResourceRegistry(defaultResources.map((resource) => resource.id === 'ctx' ? contextsResource : resource));
function command(controller: ReturnType<typeof createTuiController>, text: string) {
  controller.handleKey({ name: ':' }); controller.handleKey({ name: 'text', text }); controller.handleKey({ name: 'enter' });
}

describe('independent TUI workspaces', () => {
  it('keeps ctx read-only and enters each workspace without running connection checks', async () => {
    const read = vi.fn(async (): Promise<TuiPage> => ({ rows: [], completeness: 'complete' }));
    const controller = createTuiController({ registry: registry(), contexts, adapters: { sessions: { read } } });
    try {
      expect(controller.getSnapshot().actions.some((action) => ['choose-connection', 'test-context', 'connection-guide'].includes(action.id))).toBe(false);
      controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
      expect(controller.getSnapshot().route).toEqual({ resourceId: 'local', contextId: 'local' });
      expect(controller.getSnapshot().rows.some((row) => row.id === 'sessions')).toBe(true);
      expect(read).not.toHaveBeenCalled();
      command(controller, 'tcp');
      await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
      expect(controller.getSnapshot().route.resourceId).toBe('tcp');
      expect(controller.getSnapshot().rows.map((row) => row.id)).toEqual(['local', 'tcp:star:one']);
      expect(read).not.toHaveBeenCalled();
    } finally { controller.dispose(); }
  });

  it('includes the broker local channel in TCP without changing it into a TCP key identity', async () => {
    const read = vi.fn(async (_request: TuiReadRequest): Promise<TuiPage> => ({ rows: [], completeness: 'complete', contextSummary: { permissionLabel: 'Broker 管理者' } }));
    const controller = createTuiController({ registry: registry(), contexts, adapters: { stars: { read } } });
    try {
      command(controller, 'tcp');
      await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
      controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(read).toHaveBeenCalled());
      await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
      expect(read.mock.calls[0][0]).toMatchObject({ context: { id: 'local', kind: 'local' }, route: { resourceId: 'stars', contextId: 'local' } });
      expect(controller.getSnapshot().workspaceId).toBe('tcp');
      expect(controller.getSnapshot().context?.permissionLabel).toBe('Broker 管理者');
      controller.handleKey({ name: ':' });
      const ids = controller.getSnapshot().input?.candidates.map((item) => item.id);
      expect(ids).toEqual(expect.arrayContaining(['ctx', 'local', 'ssh', 'tcp', 'stars', 'members', 'machines', 'keys', 'sessions']));
      expect(ids).not.toContain('maintenance');
      expect(ids).not.toContain('files');
    } finally { controller.dispose(); }
  });

  it('switches to the actual local context for a local workspace and restores TCP target on return', async () => {
    const controller = createTuiController({ registry: registry(), contexts, adapters: {} });
    try {
      controller.handleKey({ name: 'end' }); controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
      expect(controller.getSnapshot()).toMatchObject({ workspaceId: 'tcp', route: { resourceId: 'stars', contextId: 'tcp:star:one' } });
      command(controller, 'local');
      expect(controller.getSnapshot()).toMatchObject({ workspaceId: 'local', route: { resourceId: 'local', contextId: 'local' } });
      command(controller, 'tcp');
      expect(controller.getSnapshot()).toMatchObject({ workspaceId: 'tcp', route: { resourceId: 'stars', contextId: 'tcp:star:one' } });
    } finally { controller.dispose(); }
  });

  it('marks a cached role as being rechecked and disables writes until the fresh read completes', async () => {
    let finish: ((page: TuiPage) => void) | undefined;
    let reads = 0;
    const controller = createTuiController({ registry: registry(), contexts, adapters: { stars: { read: async () => {
      reads++; if (reads === 1) return { rows: [], completeness: 'complete', contextSummary: { permissionLabel: '星管理员' } };
      return new Promise<TuiPage>((resolve) => { finish = resolve; });
    } } } });
    try {
      command(controller, 'stars'); await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
      expect(controller.getSnapshot().authorization?.state).toBe('verified');
      const pending = controller.refresh();
      expect(controller.getSnapshot().authorization?.state).toBe('checking');
      finish?.({ rows: [], completeness: 'unavailable' }); await pending;
      expect(controller.getSnapshot().authorization?.state).toBe('unavailable');
      expect(controller.getSnapshot().context?.permissionLabel).toBeUndefined();
    } finally { controller.dispose(); }
  });
});

describe('transient authentication prompts', () => {
  it('masks secret snapshots, blocks list actions and clears the secret after resolving', async () => {
    const exit = vi.fn();
    const controller = createTuiController({ registry: registry(), contexts, adapters: {}, onExit: exit });
    try {
      expect(typeof controller.prompt).toBe('function');
      const pending = controller.prompt({ kind: 'secret', title: 'SSH 密码', fields: [{ label: '目标', value: 'dev' }] }, new AbortController().signal);
      controller.handleKey({ name: 'text', text: 'private-test-password' });
      expect(controller.getSnapshot().mode).toBe('prompt');
      expect(JSON.stringify(controller.getSnapshot())).not.toContain('private-test-password');
      controller.handleKey({ name: 'enter' });
      await expect(pending).resolves.toBe('private-test-password');
      expect(controller.getSnapshot().mode).toBe('list');
      expect(controller.getSnapshot().prompt).toBeUndefined();
      expect(exit).not.toHaveBeenCalled();
    } finally { controller.dispose(); }
  });

  it('defaults host trust to refusal and aborts pending prompts on disposal', async () => {
    const controller = createTuiController({ registry: registry(), contexts, adapters: {} });
    expect(typeof controller.prompt).toBe('function');
    const request = { kind: 'confirm' as const, title: '首次主机指纹', fields: [{ label: '指纹', value: 'SHA256:fixture' }] };
    const first = controller.prompt(request, new AbortController().signal);
    controller.handleKey({ name: 'enter' }); await expect(first).resolves.toBe(false);
    const second = controller.prompt(request, new AbortController().signal);
    controller.dispose(); await expect(second).resolves.toBeNull();
  });
});
