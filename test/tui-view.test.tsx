import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'ink';
import type { TuiResource, TuiSnapshot } from '../src/tui/model.js';
import { TuiApp, TuiScreen } from '../src/tui/ui/app.js';
import { createTuiController } from '../src/tui/app/controller.js';
import { createResourceRegistry } from '../src/tui/resources/registry.js';
import { displayWidth } from '../src/tui/ui/text.js';

const resource: TuiResource = { id: 'ctx', label: '连接上下文', aliases: [], description: '', actions: [],
  columns: [{ id: 'kind', label: '类型', width: 8 }, { id: 'name', label: '名称', width: 24 }, { id: 'target', label: '目标', width: 30 }] };
function snapshot(columns = 80, rows = 24): TuiSnapshot {
  return { route: { resourceId: 'ctx' }, mode: 'list', rows: [{ id: 'local', cells: { kind: '本机', name: '本机 / 👩‍💻开发者'.repeat(8), target: '/very/long/project/path/'.repeat(8) } }],
    selectedId: 'local', selectedIndex: 0, scrollOffset: 0, filter: '', loading: false, completeness: 'complete', viewport: { columns, rows },
    actions: [{ id: 'detail', label: '详情', shortcut: 'd', enabled: true }, { id: 'help', label: '全部按键', shortcut: '?', enabled: true }] };
}
function screen(state: TuiSnapshot) { return renderToString(<TuiScreen snapshot={state} resource={resource} version="test" />, { columns: state.viewport.columns }); }
describe('TUI continuous terminal layout', () => {
  it.each([128, 80, 48, 20, 8])('keeps all rows within %i columns', (width) => {
    const output = screen(snapshot(width));
    expect(output).not.toContain('\u001b]52');
    for (const line of output.split('\n')) expect(displayWidth(line)).toBeLessThanOrEqual(width);
  });
  it('shows command candidates with the current resource table and an explicit Enter hint', () => {
    const state = snapshot();
    state.mode = 'input';
    state.input = { kind: 'command', editor: { text: 's', cursor: 1 }, candidates: [{ id: 'sessions', label: '会话', enabled: true }, { id: 'ssh', label: 'SSH对端', enabled: true }], hint: 'Enter 保留当前资源筛选' };
    const output = screen(state);
    expect(output).toContain('sessions');
    expect(output).toContain('Enter');
    expect(output).toContain('类型');
    expect(output).toContain('本机');
  });
  it('distinguishes configured identity hints from current remote authorization', () => {
    const state = snapshot();
    state.context = { id: 'ssh:build', kind: 'ssh', label: 'build', identityHint: '配置了管理员凭证' };
    expect(screen(state)).toContain('未认证');
    expect(screen(state)).not.toContain('权限：管理员');
  });
  it('keeps secret form values out of the rendered frame and retains the owning list', () => {
    const state = snapshot();
    state.mode = 'form';
    state.overlay = { ownerResourceId: 'ctx', actionId: 'configure', targetId: 'local', title: '配置', fields: [{ id: 'secret', label: '秘密', value: 'never-render-this-value', secret: true }], focusIndex: 0,
      phase: 'editing', impact: ['当前连接'], confirmationDefault: 'cancel' };
    const output = screen(state);
    expect(output).toContain('配置');
    expect(output).toContain('本机');
    expect(output).not.toContain('never-render-this-value');
    expect(output).toContain('取消');
  });
  it('keeps a partial empty result distinct from a complete empty collection', () => {
    const state = snapshot();
    state.rows = [];
    state.completeness = 'partial';
    expect(screen(state)).toContain('部分');
  });
  it('routes rendering failures to the owner without rendering exception contents', () => {
    const registry = createResourceRegistry([resource]);
    const controller = createTuiController({ registry, contexts: [], adapters: {} });
    const failedRegistry = { ...registry, resolve: () => { throw new Error('never-show-render-secret'); } };
    const onError = vi.fn();
    try {
      const output = renderToString(<TuiApp controller={controller} registry={failedRegistry} version="test" onError={onError} />);
      expect(onError).toHaveBeenCalledOnce();
      expect(output).not.toContain('never-show-render-secret');
    } finally { controller.dispose(); }
  });
  it('keeps a secret field caret at its real grapheme cursor', () => {
    const state = snapshot();
    state.mode = 'form';
    state.overlay = { ownerResourceId: 'ctx', actionId: 'configure', title: '配置', fields: [{ id: 'secret', label: '秘密', value: 'abcdef', secret: true, cursor: 2 }], focusIndex: 0, phase: 'editing', impact: [], confirmationDefault: 'cancel' };
    expect(screen(state)).toContain('••▏••••');
  });
  it('shows a resize instruction instead of invisible form editing in a short terminal', () => {
    const state = snapshot(80, 12);
    state.mode = 'form';
    state.overlay = { ownerResourceId: 'ctx', actionId: 'configure', title: '配置', fields: [{ id: 'name', label: '名称', value: 'abc' }], focusIndex: 0, phase: 'editing', impact: [], confirmationDefault: 'cancel' };
    expect(screen(state)).toContain('请放大终端');
  });
  it('reserves visible editing space even when a form label is long', () => {
    const state = snapshot(24);
    state.mode = 'form';
    state.overlay = { ownerResourceId: 'ctx', actionId: 'configure', title: '配置', fields: [{ id: 'name', label: '非常长的配置字段名称', value: 'abc', cursor: 1 }], focusIndex: 0, phase: 'editing', impact: [], confirmationDefault: 'cancel' };
    expect(screen(state)).toContain('a▏bc');
  });
});
