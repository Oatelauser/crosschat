import type { TuiActionEntry } from '../model.js';
import { wrapText } from '../ui/text.js';

/** The complete action text stays reachable after wrapping in a narrow terminal. */
export function helpLines(entries: readonly TuiActionEntry[], width: number): readonly { text: string; entryIndex: number; enabled: boolean }[] {
  return entries.flatMap((entry, entryIndex) => {
    const text = `${entry.shortcut}  ${entry.label}${entry.enabled ? '' : ` · 不可用：${entry.reason ?? '暂不支持'}`}${entry.nextStep ? `；${entry.nextStep}` : ''}`;
    return wrapText(text, width).map((line) => ({ text: line, entryIndex, enabled: entry.enabled }));
  });
}
