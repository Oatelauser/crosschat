import { describe, expect, it } from 'vitest';
import { renderToString } from 'ink';
import { TuiScreen } from '../src/tui/ui/app.js';
import { createResourceRegistry } from '../src/tui/resources/registry.js';
import { createTuiController } from '../src/tui/app/controller.js';
import { displayWidth } from '../src/tui/ui/text.js';
import type { TuiSnapshot } from '../src/tui/model.js';

const registry = createResourceRegistry();
const resource = registry.resolve('sessions')!;
function state(): TuiSnapshot {
  const controller = createTuiController({ registry, contexts: [], adapters: {} });
  const snapshot = { ...controller.getSnapshot(), route: { resourceId: 'sessions', contextId: 'local' }, context: { id: 'local', kind: 'local', label: '本机' }, viewport: { columns: 80, rows: 24 } };
  controller.dispose();
  return snapshot;
}
function screen(snapshot: TuiSnapshot) { return renderToString(<TuiScreen snapshot={snapshot} resource={resource} version="fixture" />, { columns: snapshot.viewport.columns }); }

describe('local session controls presentation', () => {
  it('shows active facets and sampling independently of the text filter', () => {
    const snapshot = state();
    snapshot.filters = [{ id: 'provider', label: '工具', mode: 'select', defaultValue: '', options: [{ value: '', label: '全部' }, { value: 'future', label: '未来工具' }] }];
    snapshot.selectedFacets = { provider: 'future' };
    snapshot.sampledAt = 1_000;
    snapshot.filter = '原生ID';
    const output = screen(snapshot);
    expect(output).toContain('未来工具');
    expect(output).toContain('采样');
    expect(output).toContain('原生ID');
  });
  it.each([80, 48, 24])('renders a choice and its disabled reason within %i display cells', (width) => {
    const snapshot = state();
    snapshot.viewport.columns = width;
    snapshot.mode = 'choice';
    snapshot.choice = { filterId: 'provider', title: '选择工具', options: [{ value: '', label: '全部工具' }, { value: 'future', label: '未来工具👩‍💻', enabled: false, reason: '当前来源不支持' }], selectedIndex: 1, scrollOffset: 0 };
    const output = screen(snapshot);
    expect(output).toContain('选择工具');
    expect(output).toContain('未来工具');
    expect(output).toContain('不支持');
    for (const line of output.split('\n')) expect(displayWidth(line)).toBeLessThanOrEqual(width);
  });
  it('shows a human label rather than an opaque value in a selected form option', () => {
    const snapshot = state();
    snapshot.mode = 'form';
    snapshot.overlay = { actionId: 'adopt', ownerResourceId: 'sessions', title: '收编', phase: 'editing', focusIndex: 0, confirmationDefault: 'cancel', impact: [], fields: [{ id: 'star', label: '目标星', value: 'opaque-star-id', options: [{ value: 'opaque-star-id', label: '开发星 (abcdef12)' }] }] };
    expect(screen(snapshot)).toContain('开发星');
    expect(screen(snapshot)).not.toContain('opaque-star-id');
  });
});
