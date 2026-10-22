import { describe, expect, it } from 'vitest';
import type { TuiColumn, TuiRow } from '../src/tui/model.js';
import { displayWidth } from '../src/tui/ui/text.js';

const columns: readonly TuiColumn[] = [
  { id: 'name', label: '名称', width: 12 },
  { id: 'target', label: '目标', width: 14 },
  { id: 'state', label: '状态', width: 8, priority: 10 },
];
const rows: readonly TuiRow[] = [
  { id: 'one', cells: { name: '研究👩🏽‍💻e\u0301', target: 'broker.example:7260', state: '未核实' }, copyValue: 'untouched full value' },
  { id: 'two', cells: { name: 'second', state: 'unknown' } },
];

describe('terminal table formatting', () => {
  it('uses declared columns and two display cells between them without expanding to terminal width', async () => {
    const { formatTable } = await import('../src/tui/ui/table.js');
    const result = formatTable({ columns: [{ id: 'a', label: '名称', width: 6 }, { id: 'b', label: '状态', width: 4 }], rows: [{ id: 'stable', cells: { a: '中文', b: 'ready' } }], width: 100 });
    expect(result).toEqual({ header: '名称    状态', rows: [{ id: 'stable', text: '中文    rea…' }], visibleColumnIds: ['a', 'b'] });
    expect(displayWidth(result.header)).toBe(12);
    expect(displayWidth(result.rows[0].text)).toBe(12);
  });

  it('keeps every column within its own declared display width', async () => {
    const { formatTable } = await import('../src/tui/ui/table.js');
    const result = formatTable({ columns: [{ id: 'name', label: 'long column name', width: 5 }, { id: 'target', label: '目标字段', width: 3 }], rows, width: 99 });
    expect(result.header).toBe('long…  目…');
    expect(result.rows[0].text).toBe('研究…  br…');
    expect(result.rows[1].text).toBe('seco…     ');
    expect(result.visibleColumnIds).toEqual(['name', 'target']);
  });

  it('hides lower priority secondary columns first and preserves registration order', async () => {
    const { formatTable } = await import('../src/tui/ui/table.js');
    const result = formatTable({ columns, rows, width: 18 });
    expect(result.visibleColumnIds).toEqual(['name', 'state']);
    expect(result.rows[0].text.startsWith('研究👩🏽‍💻e\u0301')).toBe(true);
    expect(result.rows[0].text).toContain('未核实');
    expect(displayWidth(result.header)).toBeLessThanOrEqual(18);
    expect(result.rows.every((row) => displayWidth(row.text) <= 18)).toBe(true);
  });

  it('keeps the first available name column even when secondary columns have greater priority', async () => {
    const { formatTable } = await import('../src/tui/ui/table.js');
    const result = formatTable({ columns: [{ id: 'name', label: '名称', width: 20, priority: -100 }, { id: 'state', label: '状态', width: 20, priority: 100 }], rows: [{ id: 'one', cells: { name: '研究👩🏽‍💻e\u0301 extended', state: '未核实' } }], width: 7 });
    expect(result.visibleColumnIds).toEqual(['name']);
    expect(result.rows[0].text).toBe('研究👩🏽‍💻…');
    expect(displayWidth(result.rows[0].text)).toBe(7);
  });

  it('hides later equal-priority columns before earlier ones', async () => {
    const { formatTable } = await import('../src/tui/ui/table.js');
    const result = formatTable({ columns: [{ id: 'name', label: 'name', width: 8 }, { id: 'one', label: 'one', width: 4 }, { id: 'two', label: 'two', width: 4 }], rows, width: 14 });
    expect(result.visibleColumnIds).toEqual(['name', 'one']);
  });

  it.each([0, 1, 2, 3, 4, 5, 7, 8, 10, 14, 18, 19, 20, 27, 38, 50])('fits all header and row output within %i display cells', async (width) => {
    const { formatTable } = await import('../src/tui/ui/table.js');
    const result = formatTable({ columns, rows, width });
    expect(displayWidth(result.header)).toBeLessThanOrEqual(width);
    expect(result.rows.map((row) => row.id)).toEqual(['one', 'two']);
    for (const row of result.rows) {
      expect(displayWidth(row.text)).toBeLessThanOrEqual(width);
      for (const control of ['\r', '\n', '\u001b']) expect(row.text).not.toContain(control);
      expect(row.text).not.toContain('\ud83d…');
    }
    if (width > 0) expect(result.visibleColumnIds[0]).toBe('name');
  });

  it('sanitizes controls and line breaks in labels and cells without modifying full source values', async () => {
    const { formatTable } = await import('../src/tui/ui/table.js');
    const cell = '\u001b]52;c;secret\u0007\u001b[31m中文\u001b[0m\r\nnext';
    const inputColumns = Object.freeze([Object.freeze({ id: 'name', label: '\u001b[2J标题\nnext', width: 20 })]);
    const inputRows = Object.freeze([Object.freeze({ id: 'id', cells: Object.freeze({ name: cell }), copyValue: cell })]);
    const result = formatTable({ columns: inputColumns, rows: inputRows, width: 20 });
    expect(result.header.trimEnd()).toBe('标题 next');
    expect(result.rows[0].text.trimEnd()).toBe('中文 next');
    expect(result.rows[0].text).not.toContain('secret');
    expect(inputRows[0].cells.name).toBe(cell);
    expect(inputRows[0].copyValue).toBe(cell);
  });

  it('handles empty columns, empty data and zero or invalid widths without spacers', async () => {
    const { formatTable } = await import('../src/tui/ui/table.js');
    for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatTable({ columns, rows, width })).toEqual({ header: '', rows: [{ id: 'one', text: '' }, { id: 'two', text: '' }], visibleColumnIds: [] });
    }
    expect(formatTable({ columns: [], rows, width: 80 })).toEqual({ header: '', rows: [{ id: 'one', text: '' }, { id: 'two', text: '' }], visibleColumnIds: [] });
    expect(formatTable({ columns: [{ id: 'none', label: 'zero', width: 0 }], rows, width: 80 }).visibleColumnIds).toEqual([]);
    expect(formatTable({ columns: [{ id: 'name', label: '名称', width: 4 }], rows: [], width: 8 })).toEqual({ header: '名称', rows: [], visibleColumnIds: ['name'] });
    expect(formatTable({ columns: [{ id: 'none', label: 'zero', width: 0 }, { id: 'name', label: '名称', width: 4 }], rows, width: 4 }).visibleColumnIds).toEqual(['name']);
  });
});
