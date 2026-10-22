import type { TuiColumn, TuiRow } from '../model.js';
import { padText } from './text.js';

export interface FormattedTable {
  header: string;
  rows: readonly { id: string; text: string }[];
  visibleColumnIds: readonly string[];
}

interface LayoutColumn {
  column: TuiColumn;
  index: number;
  maximum: number;
  width: number;
  priority: number;
}

function cellLimit(width: number): number {
  return Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
}

function totalWidth(columns: readonly LayoutColumn[]): number {
  return columns.reduce((sum, column) => sum + column.width, 0) + Math.max(0, columns.length - 1) * 2;
}

function layoutColumns(columns: readonly TuiColumn[], width: number): LayoutColumn[] {
  if (width === 0) return [];
  const visible = columns.map((column, index) => ({
    column,
    index,
    maximum: cellLimit(column.width),
    width: 0,
    priority: Number.isFinite(column.priority) ? column.priority! : 0,
  })).filter((column) => column.maximum > 0);
  if (visible.length === 0) return [];

  // Keep enough of the name to identify a row before spending cells on secondary fields.
  for (const [index, column] of visible.entries()) column.width = Math.min(column.maximum, index === 0 ? 8 : 4);
  while (visible.length > 1 && totalWidth(visible) > width) {
    const leastImportant = visible.slice(1).sort((a, b) => a.priority - b.priority || b.index - a.index)[0]!;
    visible.splice(visible.indexOf(leastImportant), 1);
  }
  if (visible.length === 1) {
    visible[0]!.width = Math.min(visible[0]!.maximum, width);
    return visible;
  }

  let remaining = width - totalWidth(visible);
  for (const column of [...visible].sort((a, b) => b.priority - a.priority || a.index - b.index)) {
    const additional = Math.min(remaining, column.maximum - column.width);
    column.width += additional;
    remaining -= additional;
  }
  return visible;
}

/** Display-only table formatting; full values and stable row identities remain with the caller. */
export function formatTable(options: { columns: readonly TuiColumn[]; rows: readonly TuiRow[]; width: number }): FormattedTable {
  const visible = layoutColumns(options.columns, cellLimit(options.width));
  return {
    header: visible.map(({ column, width }) => padText(column.label, width)).join('  '),
    rows: options.rows.map((row) => ({
      id: row.id,
      text: visible.map(({ column, width }) => padText(row.cells[column.id] ?? '', width)).join('  '),
    })),
    visibleColumnIds: visible.map(({ column }) => column.id),
  };
}
