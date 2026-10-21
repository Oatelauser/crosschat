import { isRecord } from '../sessions/reading.js';
import { parseDiscoveryRequest, parseDiscoveryResponse } from './boundary.js';
import type { DiscoveryRemoteScope, DiscoveryRequest, DiscoveryResponse, DiscoverySession } from './model.js';

function filterKey(request: DiscoveryRequest): string {
  return request.op === 'detail' ? '' : JSON.stringify([request.filter?.providerIds === undefined ? null : [...request.filter.providerIds].sort(), request.filter?.text ?? '']);
}

export function prepareRemoteDiscoveryRequest(input: DiscoveryRequest, scope: DiscoveryRemoteScope): DiscoveryRequest {
  const request = parseDiscoveryRequest(input);
  if (request.op !== 'list' || request.cursor === undefined) return request;
  let value: unknown;
  try { value = JSON.parse(Buffer.from(request.cursor, 'base64url').toString('utf8')); }
  catch { throw new Error('Invalid discovery cursor.'); }
  if (!isRecord(value) || value.target !== scope.target || value.contextId !== scope.contextId || value.filter !== filterKey(request) || typeof value.cursor !== 'string' || value.cursor.length === 0) throw new Error('Invalid discovery cursor.');
  return parseDiscoveryRequest({ ...request, cursor: value.cursor });
}

/** Rebind transport labels and cursor scope without changing native IDs or persisted identity. */
export function completeRemoteDiscoveryResponse(input: unknown, request: DiscoveryRequest, scope: DiscoveryRemoteScope): DiscoveryResponse {
  const response = parseDiscoveryResponse(input);
  if (response.op !== request.op) throw new Error('Discovery response operation does not match its request.');
  const rebind = (item: DiscoverySession) => ({ ...item, ref: { ...item.ref, contextId: scope.contextId } });
  const errors = (response.op === 'list' ? response.page.errors : response.detail.errors).map((error) => ({ ...error, source: { ...error.source, contextId: scope.contextId } }));
  if (response.op === 'list') {
    const nextCursor = response.page.nextCursor === null ? null : Buffer.from(JSON.stringify({ target: scope.target, contextId: scope.contextId, filter: filterKey(request), cursor: response.page.nextCursor })).toString('base64url');
    return parseDiscoveryResponse({ ...response, page: { ...response.page, errors, items: response.page.items.map(rebind), nextCursor } });
  }
  if (request.op !== 'detail') throw new Error('Invalid detail request.');
  const item = response.detail.item;
  if (item !== null && (item.ref.providerId !== request.providerId || item.ref.nativeId !== request.nativeId || (item.ref.referenceKind ?? 'native') !== (request.referenceKind ?? 'native'))) throw new Error('Discovery response returned a different session.');
  return parseDiscoveryResponse({ ...response, detail: { ...response.detail, errors, item: item === null ? null : rebind(item) } });
}
