import { describe, expect, it } from 'vitest';
import { renderToString } from 'ink';
import { TuiScreen } from '../src/tui/ui/app.js';
import { createResourceRegistry } from '../src/tui/resources/registry.js';
import type { TuiSnapshot } from '../src/tui/model.js';
import { displayWidth } from '../src/tui/ui/text.js';

describe('workspace resource action layout', () => {
  const registry = createResourceRegistry();
  function state(width = 120): TuiSnapshot {
    return { route: { resourceId: 'stars', contextId: 'local' }, workspaceId: 'tcp', context: { id: 'local', kind: 'local', label: '本机 broker', permissionLabel: 'Broker 管理者' }, authorization: { state: 'verified' },
      rows: [], selectedIndex: -1, scrollOffset: 0, filter: '', mode: 'list', loading: false, completeness: 'complete', viewport: { columns: width, rows: 24 },
      actions: registry.actions('stars', 'list').map((action) => ({ ...action, enabled: true })) };
  }
  function screen(snapshot: TuiSnapshot) { return renderToString(<TuiScreen snapshot={snapshot} resource={registry.resolve('stars')!} version="fixture" />, { columns: snapshot.viewport.columns }); }
  it('puts add, rename and delete above the table while keeping navigation out of the footer', () => {
    const output = screen(state());
    expect(output).toContain('<a>'); expect(output).toContain('<e>'); expect(output).toContain('<Ctrl+D>');
    expect(output.indexOf('<a>')).toBeLessThan(output.indexOf('┌'));
    expect(output).toContain('<stars>'); expect(output).toContain('CC');
    expect(output).not.toContain('PgUp'); expect(output).not.toContain('Home');
  });
  it.each([160, 120, 80, 48, 24])('keeps the resource and role visible at %i columns', (width) => {
    const output = screen(state(width));
    expect(output).toContain('stars'); expect(output).toContain('角色');
    for (const line of output.split('\n')) expect(displayWidth(line)).toBeLessThanOrEqual(width);
  });
  it('shows cached role verification status explicitly', () => {
    const snapshot = state(); snapshot.loading = true; snapshot.authorization = { state: 'checking' };
    expect(screen(snapshot)).toContain('正在核验');
  });
  it('labels the cached role as previous after a failed or cancelled verification', () => {
    const snapshot = state(); snapshot.authorization = { state: 'stale' };
    const output = screen(snapshot);
    expect(output).toContain('角色: 上次 Broker 管理者');
    expect(output).toContain('上次核验');
    expect(output).not.toContain('已核验');
  });
});
