import type { Key } from 'ink';
import type { TuiKey } from '../model.js';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Ordinary input batches can cross modes; bracketed paste uses its own channel. */
export function inputKeys(input: string, key: Key): readonly TuiKey[] {
  if (key.eventType === 'release') return [];
  const names: readonly [boolean, string][] = [
    [key.upArrow, 'up'], [key.downArrow, 'down'], [key.leftArrow, 'left'], [key.rightArrow, 'right'],
    [key.pageUp, 'pageup'], [key.pageDown, 'pagedown'], [key.home, 'home'], [key.end, 'end'],
    [key.return, 'enter'], [key.escape, 'escape'], [key.tab, 'tab'], [key.backspace, 'backspace'], [key.delete, 'delete'],
  ];
  const modifiers = { ctrl: key.ctrl, shift: key.shift, alt: key.meta };
  const special = names.find(([pressed]) => pressed)?.[1];
  if (special) return [{ name: special, ...modifiers }];
  if (input === '') return [];
  if (key.ctrl || key.meta || key.super || key.hyper) return [{ name: input, text: input, ...modifiers }];
  return Array.from(segmenter.segment(input), ({ segment }) => ({ name: segment, text: segment, ...modifiers }));
}
