import { describe, expect, it, vi } from 'vitest';
import type { TuiAction, TuiActionAvailability, TuiOverlay } from '../src/tui/model.js';
import { displayWidth } from '../src/tui/ui/text.js';
import { screenLayout } from '../src/tui/app/layout.js';

function overlay(values: Partial<TuiOverlay> = {}): TuiOverlay {
  return {
    actionId: 'test-action', ownerResourceId: 'sessions', contextId: 'local', targetId: 'opaque/full/target', title: '测试确认',
    fields: [], focusIndex: 0, phase: 'confirming', impact: [], confirmationDefault: 'cancel', ...values,
  };
}

describe('complete form confirmation content', () => {
  it('keeps the complete owner, context, target, impacts and error reachable as bounded visual lines', async () => {
    const { formContentLines } = await import('../src/tui/app/form.js');
    const contextId = 'ssh:完整连接👩‍💻'.repeat(5);
    const targetId = 'opaque/full/完整目标/é/'.repeat(6);
    const impact = '将影响完整目录/very/long/path/与既有连接👩‍💻。'.repeat(9);
    const error = '拒绝执行：请核对当前目标与授权，保留表单后再继续。'.repeat(7);
    const lines = formContentLines(overlay({ contextId, targetId, impact: [impact, '仅修改当前对象'], error }), 24);
    expect(lines.every((line) => displayWidth(line.text) <= 24)).toBe(true);
    const context = lines.filter((line) => line.kind === 'context').map((line) => line.text).join('');
    expect(context).toContain('sessions');
    expect(context).toContain(contextId);
    expect(context).toContain(targetId);
    expect(lines.filter((line) => line.kind === 'impact').map((line) => line.text).join('')).toContain(impact);
    expect(lines.filter((line) => line.kind === 'error').map((line) => line.text).join('')).toBe(error);
    expect(lines.filter((line) => line.kind === 'context').length).toBeGreaterThan(1);
    expect(lines.filter((line) => line.kind === 'impact').length).toBeGreaterThan(9);
  });

  it('keeps fields on one indexed line, masks secrets and sanitizes controls without changing the editable values', async () => {
    const { formContentLines } = await import('../src/tui/app/form.js');
    const input = overlay({
      targetId: 'safe\u001b[2J-target',
      fields: [
        { id: 'name', label: '长显示名', value: '可横向编辑👩‍💻'.repeat(8), cursor: 3 },
        { id: 'secret', label: '秘密', value: 'fixture-secret-value', secret: true, cursor: 0 },
      ],
      impact: ['核对\u001b]0;spoofed\u0007完整影响'], error: '未执行\u001b[31m操作\u001b[0m',
    });
    const lines = formContentLines(input, 20);
    expect(lines.filter((line) => line.kind === 'field').map((line) => line.fieldIndex)).toEqual([0, 1]);
    expect(lines.every((line) => displayWidth(line.text) <= 20)).toBe(true);
    const rendered = lines.map((line) => line.text).join('');
    expect(rendered).toContain('safe-target');
    expect(rendered).toContain('核对完整影响');
    expect(rendered).toContain('未执行操作');
    expect(rendered).not.toContain('\u001b');
    expect(rendered).not.toMatch(/spoofed|fixture-secret-value/);
    expect(lines.find((line) => line.kind === 'field' && line.fieldIndex === 1)?.text).toContain('•');
    expect(input.fields[0].value).toBe('可横向编辑👩‍💻'.repeat(8));
    expect(input.fields[1].value).toBe('fixture-secret-value');
  });

  it('scrolls confirmation text without changing the fixed target or default button and restores field cursor keys', async () => {
    const { createTuiController } = await import('../src/tui/app/controller.js');
    const { createResourceRegistry, defaultResources } = await import('../src/tui/resources/registry.js');
    const { formContentLines } = await import('../src/tui/app/form.js');
    const action: TuiAction = {
      id: 'rename', label: '修改显示名', shortcut: 'e', ownerResourceId: 'sessions', selectionPolicy: 'required', mutation: true,
      kind: 'form', fields: [{ id: 'name', label: '显示名', required: true }], returnPolicy: 'restore',
    };
    const registry = createResourceRegistry(defaultResources.map((resource) => resource.id === 'sessions' ? { ...resource, actions: [action] } : resource));
    const targetId = `opaque/${'very-long-target/'.repeat(12)}`;
    const mutate = vi.fn(async () => ({}));
    const controller = createTuiController({ registry, contexts: [{ id: 'local', label: '本机', kind: 'local' }], adapters: { sessions: {
      read: async () => ({ rows: [{ id: targetId, cells: { name: '初始👩‍💻' } }], completeness: 'complete' }),
      checkAction: async () => ({ enabled: true, impact: ['完整影响👩‍💻'.repeat(50)] }), mutate,
    } } });
    try {
      controller.resize(30, 18); controller.handleKey({ name: ':' }); controller.handleKey({ name: 'text', text: 'sessions' }); controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
      controller.handleKey({ name: 'e' });
      await vi.waitFor(() => expect(controller.getSnapshot().overlay?.impact).toContain('完整影响👩‍💻'.repeat(50)));
      const layout = screenLayout(controller.getSnapshot().viewport, controller.getSnapshot().mode);
      const fieldLine = formContentLines(controller.getSnapshot().overlay!, layout.contentColumns).findIndex((line) => line.kind === 'field');
      expect(controller.getSnapshot().overlay!.scrollOffset).toBeGreaterThan(0);
      expect(fieldLine).toBeGreaterThanOrEqual(controller.getSnapshot().overlay!.scrollOffset!);
      expect(fieldLine).toBeLessThan(controller.getSnapshot().overlay!.scrollOffset! + layout.formRows);
      controller.handleKey({ name: 'enter' });
      const before = controller.getSnapshot().overlay!;
      expect(before).toMatchObject({ phase: 'confirming', focusIndex: 1, targetId });
      controller.handleKey({ name: 'pagedown' });
      expect(controller.getSnapshot().overlay!.scrollOffset).toBeGreaterThan(before.scrollOffset!);
      controller.handleKey({ name: 'end' });
      const end = controller.getSnapshot().overlay!;
      expect(end.scrollOffset).toBe(formContentLines(end, layout.contentColumns).length - layout.formRows);
      expect(end).toMatchObject({ focusIndex: 1, targetId, fields: [{ value: '初始👩‍💻' }] });
      expect(mutate).not.toHaveBeenCalled();
      controller.handleKey({ name: 'home' });
      expect(controller.getSnapshot().overlay?.scrollOffset).toBe(0);
      controller.handleKey({ name: 'tab' }); controller.handleKey({ name: 'tab' });
      expect(controller.getSnapshot().overlay?.focusIndex).toBe(0);
      const fieldOffset = controller.getSnapshot().overlay!.scrollOffset;
      controller.handleKey({ name: 'home' });
      expect(controller.getSnapshot().overlay?.fields[0].cursor).toBe(0);
      controller.handleKey({ name: 'end' });
      expect(controller.getSnapshot().overlay?.fields[0].cursor).toBe(3);
      expect(controller.getSnapshot().overlay?.scrollOffset).toBe(fieldOffset);
    } finally { controller.dispose(); }
  });

  it('focuses a full asynchronous error and allows scrolling to its final guidance', async () => {
    const { createTuiController } = await import('../src/tui/app/controller.js');
    const { createResourceRegistry, defaultResources } = await import('../src/tui/resources/registry.js');
    const { formContentLines } = await import('../src/tui/app/form.js');
    const action: TuiAction = {
      id: 'remove', label: '测试移除', shortcut: 'x', ownerResourceId: 'sessions', selectionPolicy: 'required', mutation: true,
      kind: 'form', returnPolicy: 'restore', fields: [{ id: 'name', label: '显示名', initialValue: '保留输入' }],
    };
    const registry = createResourceRegistry(defaultResources.map((resource) => resource.id === 'sessions' ? { ...resource, actions: [action] } : resource));
    const failure = `未执行操作。${'请核对当前目标和权限。'.repeat(40)}末尾完整指引`;
    const controller = createTuiController({ registry, contexts: [{ id: 'local', label: '本机', kind: 'local' }], adapters: { sessions: {
      read: async () => ({ rows: [{ id: 'fixed-target', cells: { name: '原目标' } }], completeness: 'complete' }),
      checkAction: async () => ({ enabled: true, impact: ['只影响当前目标'] }), mutate: async () => { throw new Error(failure); },
    } } });
    try {
      controller.resize(30, 18); controller.handleKey({ name: ':' }); controller.handleKey({ name: 'text', text: 'sessions' }); controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
      controller.handleKey({ name: 'x' });
      await vi.waitFor(() => expect(controller.getSnapshot().overlay?.impact).toContain('只影响当前目标'));
      controller.handleKey({ name: 'enter' }); controller.handleKey({ name: 'tab' }); controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller.getSnapshot().overlay?.error).toBe(failure));
      const layout = screenLayout(controller.getSnapshot().viewport, controller.getSnapshot().mode);
      const failed = controller.getSnapshot().overlay!;
      const errorLine = formContentLines(failed, layout.contentColumns).findIndex((line) => line.kind === 'error');
      expect(errorLine).toBeGreaterThanOrEqual(failed.scrollOffset!);
      expect(errorLine).toBeLessThan(failed.scrollOffset! + layout.formRows);
      controller.handleKey({ name: 'end' });
      const content = formContentLines(controller.getSnapshot().overlay!, layout.contentColumns);
      const offset = controller.getSnapshot().overlay!.scrollOffset!;
      expect(offset).toBe(content.length - layout.formRows);
      expect(content.slice(offset, offset + layout.formRows).map((line) => line.text).join('')).toContain('末尾完整指引');
      expect(controller.getSnapshot().overlay?.targetId).toBe('fixed-target');
      controller.handleKey({ name: 'tab' });
      const editing = controller.getSnapshot().overlay!;
      const fieldLine = formContentLines(editing, layout.contentColumns).findIndex((line) => line.kind === 'field');
      expect(editing).toMatchObject({ focusIndex: 0, phase: 'editing', fields: [{ value: '保留输入' }] });
      expect(fieldLine).toBeGreaterThanOrEqual(editing.scrollOffset!);
      expect(fieldLine).toBeLessThan(editing.scrollOffset! + layout.formRows);
    } finally { controller.dispose(); }
  });

  it('exposes pending authority checks and cannot issue a write before either check finishes', async () => {
    const { createTuiController } = await import('../src/tui/app/controller.js');
    const { createResourceRegistry, defaultResources } = await import('../src/tui/resources/registry.js');
    const action: TuiAction = {
      id: 'remove', label: '测试移除', shortcut: 'x', ownerResourceId: 'sessions', selectionPolicy: 'required', mutation: true,
      kind: 'form', returnPolicy: 'restore',
    };
    const registry = createResourceRegistry(defaultResources.map((resource) => resource.id === 'sessions' ? { ...resource, actions: [action] } : resource));
    const finishes: Array<(result: TuiActionAvailability) => void> = [];
    const mutate = vi.fn(async () => ({}));
    const controller = createTuiController({ registry, contexts: [{ id: 'local', label: '本机', kind: 'local' }], adapters: { sessions: {
      read: async () => ({ rows: [{ id: 'fixed-target', cells: { name: '原目标' } }], completeness: 'complete' }),
      checkAction: () => new Promise((resolve) => { finishes.push(resolve); }), mutate,
    } } });
    try {
      controller.handleKey({ name: ':' }); controller.handleKey({ name: 'text', text: 'sessions' }); controller.handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
      controller.handleKey({ name: 'x' });
      expect(controller.getSnapshot().overlay?.checking).toBe(true);
      controller.handleKey({ name: 'tab' }); controller.handleKey({ name: 'enter' });
      expect(mutate).not.toHaveBeenCalled();
      finishes[0]({ enabled: true });
      await vi.waitFor(() => expect(controller.getSnapshot().overlay?.checking).toBe(false));
      controller.handleKey({ name: 'enter' });
      expect(controller.getSnapshot().overlay?.checking).toBe(true);
      expect(mutate).not.toHaveBeenCalled();
      finishes[1]({ enabled: true });
      await vi.waitFor(() => expect(controller.getSnapshot().mode).toBe('list'));
      expect(mutate).toHaveBeenCalledOnce();
    } finally { controller.dispose(); }
  });
});
