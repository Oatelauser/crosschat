import type { TuiField } from '../model.js';
import { wrapText } from '../ui/text.js';

/** Shared visual lines keep scrolling, selected fields and rendering in the same coordinate system. */
export function detailLines(fields: readonly TuiField[], width: number): readonly { text: string; fieldIndex: number }[] {
  return fields.flatMap((field, fieldIndex) => wrapText(`${field.label}: ${field.value}`, width).map((text) => ({ text, fieldIndex })));
}
