import { describe, expect, it } from 'vitest';
import { parseFrame } from '../src/serve/protocol.js';

describe('remote discovery protocol', () => {
  it.each([
    { op: 'discover-query', id: 'q1', targetMachine: 'node-a', request: { op: 'list', limit: 25 } },
    { op: 'discover-result', id: 'q1', ok: true, result: { op: 'list', providers: [], page: { items: [], nextCursor: null, completeness: 'complete', errors: [], observedAt: 1 } } },
    { op: 'discover-result', id: 'q1', ok: false, error: 'unavailable' },
    { op: 'discover-cancel', id: 'q1' },
  ])('accepts the new operation $op', (frame) => {
    expect(parseFrame(JSON.stringify(frame))).toEqual(frame);
  });

  it.each([
    { op: 'discover-query', id: '', targetMachine: 'a', request: { op: 'list' } },
    { op: 'discover-query', id: 'q', targetMachine: 2, request: {} },
    { op: 'discover-query', id: 'q', targetMachine: 'a', request: null },
    { op: 'discover-result', id: 'q', ok: 'yes' },
    { op: 'discover-result', id: 'q', ok: true },
    { op: 'discover-cancel', id: null },
  ])('rejects malformed discovery envelopes', (frame) => {
    expect(parseFrame(JSON.stringify(frame))).toBeUndefined();
  });
});
