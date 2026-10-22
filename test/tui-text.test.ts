import { describe, expect, it } from 'vitest';
import {
  clipText,
  displayWidth,
  editText,
  editorViewport,
  padText,
  sanitizeTerminalText,
  wrapText,
} from '../src/tui/ui/text.js';
import type { EditorState } from '../src/tui/ui/text.js';

describe('safe terminal text', () => {
  it('keeps ordinary Unicode and joins list text into one line', () => {
    expect(sanitizeTerminalText('中文 👩🏽‍💻 e\u0301\r\nnext\ttab')).toBe('中文 👩🏽‍💻 e\u0301 next tab');
  });

  it.each([
    ['\u001b[31mred\u001b[0m', 'red'],
    ['a\u001b[2J\u001b[Htext', 'atext'],
    ['\u001b]0;spoofed title\u0007label', 'label'],
    ['\u001b]52;c;c2VjcmV0\u001b\\label', 'label'],
    ['\u001b]8;;https://example.test\u001b\\label\u001b]8;;\u001b\\', 'label'],
    ['\u009b31mred\u009b0m', 'red'],
    ['\u009d52;c;secret\u009clabel', 'label'],
    ['a\u001bPprivate payload\u001b\\b', 'ab'],
    ['a\u001b_private payload\u001b\\b', 'ab'],
    ['a\u001b^private payload\u001b\\b', 'ab'],
    ['a\u0000\u0007\b\u007f\u0085b', 'ab'],
    ['a\u001b]52;c;unfinished', 'a'],
    ['a\u001b[', 'a'],
  ])('removes terminal control sequences from %j', (input, expected) => {
    expect(sanitizeTerminalText(input)).toBe(expected);
  });

  it('does not leave a nested escape after stripping a control string', () => {
    expect(sanitizeTerminalText('safe\u001b]0;title\u001b[2J\u0007end')).toBe('safeend');
  });
});

describe('terminal display cells', () => {
  it.each([
    ['', 0],
    ['ASCII', 5],
    ['中文', 4],
    ['e\u0301', 1],
    ['😀', 2],
    ['👩🏽‍💻', 2],
    ['👨‍👩‍👧‍👦', 2],
    ['🇨🇳', 2],
    ['1️⃣', 2],
    ['\u001b[31m中\u001b[0m', 2],
  ])('measures %j in display cells', (text, width) => {
    expect(displayWidth(text)).toBe(width);
  });

  it('clips whole graphemes with a visible ellipsis', () => {
    expect(clipText('中😀ab', 5)).toBe('中😀…');
    expect(clipText('e\u0301👩🏽‍💻ab', 4)).toBe('e\u0301👩🏽‍💻…');
    expect(clipText('中', 1)).toBe('…');
    expect(clipText('unchanged', 9)).toBe('unchanged');
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])('respects the hard clipping limit of %i cells', (width) => {
    const original = '中👩🏽‍💻e\u0301abcdef';
    expect(displayWidth(clipText(original, width))).toBeLessThanOrEqual(width);
    expect(original).toBe('中👩🏽‍💻e\u0301abcdef');
  });

  it('cleans clipped and padded values before rendering', () => {
    expect(clipText('\u001b[31mhello\u001b[0m\r\nworld', 7)).toBe('hello …');
    expect(padText('\u001b[31m中\u001b[0m', 4)).toBe('中  ');
    expect(padText('abcdef', 3)).toBe('ab…');
    expect(padText('中', 0)).toBe('');
  });

  it('wraps details without splitting graphemes or losing explicit blank lines', () => {
    expect(wrapText('中😀e\u0301ab\r\n\nlast', 4)).toEqual(['中😀', 'e\u0301ab', '', 'last']);
    expect(wrapText('a\n', 4)).toEqual(['a', '']);
    expect(wrapText('', 4)).toEqual(['']);
  });

  it('removes terminal payloads while preserving detail line breaks', () => {
    expect(wrapText('a\n\u001b]52;c;secret\u0007\u001b[31m中\u001b[0m', 4)).toEqual(['a', '中']);
  });

  it('keeps details within zero and one cell columns', () => {
    expect(wrapText('中文😀a', 1)).toEqual(['…', '…', '…', 'a']);
    expect(wrapText('中文', 0)).toEqual(['']);
  });
});

describe('grapheme text editor', () => {
  it('moves and deletes complete Unicode graphemes', () => {
    const state: EditorState = { text: '中👩🏽‍💻e\u0301a', cursor: 4 };
    expect(editText(state, { type: 'left' })).toEqual({ text: state.text, cursor: 3 });
    expect(editText(state, { type: 'home' })).toEqual({ text: state.text, cursor: 0 });
    expect(editText({ ...state, cursor: 0 }, { type: 'end' })).toEqual(state);
    expect(editText({ ...state, cursor: 1 }, { type: 'right' })).toEqual({ text: state.text, cursor: 2 });
    expect(editText({ ...state, cursor: 2 }, { type: 'backspace' })).toEqual({ text: '中e\u0301a', cursor: 1 });
    expect(editText({ ...state, cursor: 2 }, { type: 'delete' })).toEqual({ text: '中👩🏽‍💻a', cursor: 2 });
    expect(state).toEqual({ text: '中👩🏽‍💻e\u0301a', cursor: 4 });
  });

  it('keeps empty and boundary edits within the field', () => {
    const empty: EditorState = { text: '', cursor: 0 };
    for (const type of ['left', 'right', 'home', 'end', 'backspace', 'delete'] as const) {
      expect(editText(empty, { type })).toEqual(empty);
    }
    expect(editText({ text: 'a', cursor: 0 }, { type: 'left' })).toEqual({ text: 'a', cursor: 0 });
    expect(editText({ text: 'a', cursor: 1 }, { type: 'right' })).toEqual({ text: 'a', cursor: 1 });
  });

  it('inserts at the cursor and strips controls from pasted input', () => {
    expect(editText({ text: 'ab', cursor: 1 }, { type: 'insert', text: '中👩🏽‍💻' }))
      .toEqual({ text: 'a中👩🏽‍💻b', cursor: 3 });
    expect(editText({ text: 'ab', cursor: 1 }, { type: 'insert', text: '\u001b]52;c;secret\u0007x\n\u001b[2Jy' }))
      .toEqual({ text: 'ax yb', cursor: 4 });
  });

  it('keeps the cursor on a grapheme boundary when an inserted combining mark merges', () => {
    const combined = editText({ text: 'e', cursor: 1 }, { type: 'insert', text: '\u0301' });
    expect(combined).toEqual({ text: 'e\u0301', cursor: 1 });
    expect(editText(combined, { type: 'backspace' })).toEqual({ text: '', cursor: 0 });
  });

  it('normalizes stale cursors to a valid grapheme boundary', () => {
    expect(editText({ text: '中a', cursor: 99 }, { type: 'left' })).toEqual({ text: '中a', cursor: 1 });
    expect(editText({ text: '中a', cursor: -3 }, { type: 'delete' })).toEqual({ text: 'a', cursor: 0 });
  });

  it('scrolls the editor horizontally and restores the full field on wider viewports', () => {
    const state: EditorState = { text: 'abcdef', cursor: 6 };
    expect(editorViewport(state, 4)).toEqual({ text: 'def', cursor: 3 });
    expect(editorViewport({ ...state, cursor: 0 }, 4)).toEqual({ text: 'abcd', cursor: 0 });
    expect(editorViewport(state, 12)).toEqual({ text: state.text, cursor: 6 });
    expect(state).toEqual({ text: 'abcdef', cursor: 6 });
  });

  it('uses display cells for the visual cursor without splitting emoji', () => {
    expect(editorViewport({ text: '中👩🏽‍💻e\u0301', cursor: 2 }, 10))
      .toEqual({ text: '中👩🏽‍💻e\u0301', cursor: 4 });
  });

  it.each([0, 1, 2, 3, 4, 5])('keeps a complete editor field and visible cursor safe at width %i', (width) => {
    const state: EditorState = { text: '中👩🏽‍💻e\u0301abc', cursor: 6 };
    const viewport = editorViewport(state, width);
    expect(displayWidth(viewport.text)).toBeLessThanOrEqual(width);
    expect(viewport.cursor).toBeGreaterThanOrEqual(0);
    expect(viewport.cursor).toBeLessThanOrEqual(Math.max(0, width - 1));
    expect(state.text).toBe('中👩🏽‍💻e\u0301abc');
  });
});
