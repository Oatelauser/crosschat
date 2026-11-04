import { describe, expect, it } from 'vitest';
import { DiscoveryService, parseDiscoveryRequest, parseDiscoveryResponse } from '../src/application/discovery/index.js';
import type { DiscoveryResponse, DiscoverySession } from '../src/application/discovery/index.js';
import type { SessionReader } from '../src/application/sessions/model.js';
import { sessionKey } from '../src/application/sessions/model.js';
import { createSessionsResource } from '../src/tui/resources/sessions.js';

const capabilities = { discovery: true, delivery: true, launch: false, diagnostics: false };
const id = '11111111-1111-4111-8111-111111111111';
function item(endpointType: string): DiscoverySession {
  return { ref: { contextId: 'local', providerId: 'codex', nativeId: id, endpointType }, name: 'Worker', rawStatus: 'idle', capabilities, attributes: {} };
}
function response(): DiscoveryResponse {
  return { op: 'list', providers: [{ providerId: 'codex', capabilities }], page: {
    items: [item('cli'), item('desktop')], nextCursor: null, completeness: 'complete', errors: [], observedAt: 123,
  } };
}

describe('C14 typed discovery and TUI', () => {
  it('round-trips the delivery type at the JSON boundary', () => {
    expect(parseDiscoveryResponse(response())).toEqual(response());
    expect(parseDiscoveryRequest({ op: 'detail', providerId: 'codex', nativeId: id, endpointType: 'desktop' }))
      .toMatchObject({ endpointType: 'desktop' });
    expect(() => parseDiscoveryRequest({ op: 'detail', providerId: 'codex', nativeId: id, endpointType: 'shared' })).toThrow();
  });
  it('passes the exact requested type through the catalog to the native reader', async () => {
    const reader: SessionReader = { providerId: 'codex', capabilities,
      async list() { throw new Error('unused'); },
      async get(request) {
        return { item: { ...item(request.endpointType ?? 'cli'), key: 'reader-key' }, completeness: 'complete', observedAt: 123, errors: [] };
      },
    };
    const result = await new DiscoveryService([reader]).execute({ op: 'detail', providerId: 'codex', nativeId: id, endpointType: 'desktop' });
    expect(result).toMatchObject({ op: 'detail', detail: { item: { ref: { endpointType: 'desktop' } } } });
  });
  it('keeps both owners visible, independently selectable and copyable', async () => {
    const { adapter } = createSessionsResource({ discovery: { execute: async () => response() } });
    const page = await adapter.read({ context: { id: 'local', kind: 'local', label: '本机' }, signal: new AbortController().signal });
    expect(page.rows).toHaveLength(2);
    expect(page.rows.map((row) => row.id)).toEqual([sessionKey(item('cli').ref), sessionKey(item('desktop').ref)]);
    expect(page.rows.map((row) => row.cells.provider)).toEqual(['codex-cli', 'codex-desktop']);
    expect(page.rows.map((row) => row.copyValue)).toEqual([
      `crosschat send --to ${id} --tool codex-cli --body "<正文>"`,
      `crosschat send --to ${id} --tool codex-desktop --body "<正文>"`,
    ]);
    expect(page.rows.map((row) => row.copyValues?.nativeId)).toEqual([id, id]);
    expect(page.filters?.find((filter) => filter.id === 'provider')?.options.map((option) => option.value)).toEqual(['', 'codex', 'codex-cli', 'codex-desktop']);
  });
});
