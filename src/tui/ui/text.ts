import stringWidth from 'string-width';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export interface EditorState {
  text: string;
  /** Position between graphemes, rather than UTF-16 code units. */
  cursor: number;
}

export type EditEvent =
  | { type: 'insert'; text: string }
  | { type: 'left' | 'right' | 'home' | 'end' | 'backspace' | 'delete' };

function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), ({ segment }) => segment);
}

function cellLimit(width: number): number {
  return Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
}

function cursorIndex(cursor: number, length: number): number {
  return Number.isFinite(cursor) ? Math.max(0, Math.min(length, Math.floor(cursor))) : 0;
}

function skipControlString(text: string, start: number, osc: boolean): number {
  for (let index = start; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 0x9c || (osc && code === 0x07)) return index + 1;
    if (code === 0x1b && text[index + 1] === '\\') return index + 2;
  }
  return text.length;
}

function skipCsi(text: string, start: number): number {
  for (let index = start; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) return index + 1;
  }
  return text.length;
}

function safeText(input: string, preserveNewlines: boolean): string {
  let output = '';
  for (let index = 0; index < input.length;) {
    const code = input.charCodeAt(index);
    if (code === 0x1b) {
      const next = input[index + 1];
      if (next === '[') {
        index = skipCsi(input, index + 2);
      } else if (next === ']' || next === 'P' || next === 'X' || next === '^' || next === '_') {
        index = skipControlString(input, index + 2, next === ']');
      } else {
        index++;
        // Other ECMA-48 escape functions include character-set selection.
        while (index < input.length && input.charCodeAt(index) >= 0x20 && input.charCodeAt(index) <= 0x2f) index++;
        if (index < input.length && input.charCodeAt(index) >= 0x30 && input.charCodeAt(index) <= 0x7e) index++;
      }
      continue;
    }
    if (code === 0x9b) {
      index = skipCsi(input, index + 1);
      continue;
    }
    if (code === 0x9d || code === 0x90 || code === 0x98 || code === 0x9e || code === 0x9f) {
      index = skipControlString(input, index + 1, code === 0x9d);
      continue;
    }
    if (code === 0x0d || code === 0x0a) {
      if (code === 0x0d && input.charCodeAt(index + 1) === 0x0a) index++;
      output += preserveNewlines ? '\n' : ' ';
    } else if (code === 0x09) {
      output += ' ';
    } else if (code >= 0x20 && !(code >= 0x7f && code <= 0x9f)) {
      output += input[index];
    }
    index++;
  }
  return output;
}

/** Display-only sanitization: callers retain the original value for details/copy. */
export function sanitizeTerminalText(input: string): string {
  return safeText(input, false);
}

export function displayWidth(input: string): number {
  return stringWidth(sanitizeTerminalText(input));
}

function fittingPrefix(parts: readonly string[], width: number): string {
  let output = '';
  let used = 0;
  for (const part of parts) {
    const cells = stringWidth(part);
    if (used + cells > width) break;
    output += part;
    used += cells;
  }
  return output;
}

export function clipText(input: string, maxWidth: number): string {
  const width = cellLimit(maxWidth);
  if (width === 0) return '';
  const text = sanitizeTerminalText(input);
  if (stringWidth(text) <= width) return text;
  return fittingPrefix(graphemes(text), width - 1) + '…';
}

export function padText(input: string, maxWidth: number): string {
  const width = cellLimit(maxWidth);
  const text = clipText(input, width);
  return text + ' '.repeat(width - stringWidth(text));
}

/** Keeps detail paragraphs while ensuring every rendered row fits the terminal. */
export function wrapText(input: string, maxWidth: number): string[] {
  const width = cellLimit(maxWidth);
  if (width === 0) return [''];
  const rows: string[] = [];
  for (const line of safeText(input, true).split('\n')) {
    let row = '';
    let used = 0;
    for (const part of graphemes(line)) {
      const cells = stringWidth(part);
      if (used + cells > width && row !== '') {
        rows.push(row);
        row = '';
        used = 0;
      }
      if (cells > width) {
        rows.push('…');
      } else {
        row += part;
        used += cells;
      }
    }
    if (row !== '' || line === '') rows.push(row);
  }
  return rows;
}

export function editText(state: EditorState, event: EditEvent): EditorState {
  const parts = graphemes(state.text);
  const cursor = cursorIndex(state.cursor, parts.length);
  switch (event.type) {
    case 'left': return { text: state.text, cursor: Math.max(0, cursor - 1) };
    case 'right': return { text: state.text, cursor: Math.min(parts.length, cursor + 1) };
    case 'home': return { text: state.text, cursor: 0 };
    case 'end': return { text: state.text, cursor: parts.length };
    case 'backspace':
      if (cursor === 0) return { text: state.text, cursor };
      return { text: parts.slice(0, cursor - 1).join('') + parts.slice(cursor).join(''), cursor: cursor - 1 };
    case 'delete':
      return { text: parts.slice(0, cursor).join('') + parts.slice(cursor + 1).join(''), cursor };
    case 'insert': {
      const prefix = parts.slice(0, cursor).join('') + sanitizeTerminalText(event.text);
      const text = prefix + parts.slice(cursor).join('');
      // Inserting a combining mark or ZWJ can merge neighboring graphemes.
      let nextCursor = 0;
      for (const part of segmenter.segment(text)) {
        if (part.index >= prefix.length) break;
        nextCursor++;
      }
      return { text, cursor: nextCursor };
    }
  }
}

export function editorViewport(state: EditorState, maxWidth: number): { text: string; cursor: number } {
  const width = cellLimit(maxWidth);
  if (width === 0) return { text: '', cursor: 0 };
  const original = graphemes(state.text);
  const originalCursor = cursorIndex(state.cursor, original.length);
  const parts = graphemes(sanitizeTerminalText(state.text));
  const safePrefix = sanitizeTerminalText(original.slice(0, originalCursor).join(''));
  const cursor = Math.min(parts.length, graphemes(safePrefix).length);
  const widths = parts.map((part) => stringWidth(part));
  let visibleCursor = widths.slice(0, cursor).reduce((sum, cells) => sum + cells, 0);
  let start = 0;
  while (start < cursor && visibleCursor >= width) {
    visibleCursor -= widths[start++];
  }
  return { text: fittingPrefix(parts.slice(start), width), cursor: visibleCursor };
}
