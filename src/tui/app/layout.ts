import type { TuiFilter, TuiMode } from '../model.js';
import { clipText, wrapText } from '../ui/text.js';

/** Shared terminal cell budgets; scrolling and presentation must use the same geometry. */
export function screenLayout(viewport: { columns: number; rows: number }, mode: TuiMode, filters: readonly TuiFilter[] = [], selected: Readonly<Record<string, string>> = {}) {
  const width = Math.max(1, viewport.columns);
  const height = Math.max(1, viewport.rows);
  const active = mode === 'list' || mode === 'input';
  const facets = active && filters.length ? wrapText(filters.map((filter) => {
    const value = selected[filter.id] ?? filter.defaultValue;
    return `${clipText(filter.label, 12)}:${clipText(filter.options.find((option) => option.value === value)?.label ?? value, 28)}`;
  }).join('  '), width).slice(0, Math.max(0, height - 12)) : [];
  const desired = mode === 'form' || mode === 'prompt' ? 3 : width < 72 ? 7 : 6;
  const headerRows = Math.max(3, Math.min(desired, height - 9 - facets.length));
  const frameRows = Math.max(1, height - headerRows - facets.length - 3);
  const contentRows = Math.max(1, frameRows - 2);
  return { headerRows, facets, frameRows, contentRows, contentColumns: Math.max(1, width - 2), detailColumns: Math.max(1, width - 4), pageRows: Math.max(1, contentRows - 1), formRows: Math.max(1, contentRows - 4) };
}
