import type { TuiOverlay } from '../model.js';
import { clipText, displayWidth, sanitizeTerminalText, wrapText } from '../ui/text.js';

export interface FormContentLine {
  text: string;
  kind: 'context' | 'field' | 'impact' | 'error';
  fieldIndex?: number;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Shared lines keep complete confirmation text and keyboard scrolling in the same coordinates. */
export function formContentLines(overlay: TuiOverlay, width: number): readonly FormContentLine[] {
  const lines: FormContentLine[] = wrapText(`资源 ${overlay.ownerResourceId} · 连接 ${overlay.contextId ?? '本机'} · 目标 ${overlay.targetId ?? '新增'}`, width)
    .map((text) => ({ text, kind: 'context' }));
  for (const [fieldIndex, field] of overlay.fields.entries()) {
    const prefix = `${clipText(field.label, Math.max(2, Math.floor(width / 3)))}: `;
    const value = field.secret ? '•'.repeat(Array.from(segmenter.segment(field.value)).length) : sanitizeTerminalText(field.value);
    lines.push({ text: clipText(prefix + clipText(value, Math.max(0, width - displayWidth(prefix))), width), kind: 'field', fieldIndex });
  }
  for (const impact of overlay.impact) {
    lines.push(...wrapText(`影响：${impact}`, width).map((text): FormContentLine => ({ text, kind: 'impact' })));
  }
  if (overlay.error) lines.push(...wrapText(overlay.error, width).map((text): FormContentLine => ({ text, kind: 'error' })));
  return lines;
}
