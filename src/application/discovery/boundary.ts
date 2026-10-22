import type { Completeness, ProviderCapabilities, ReadResult, SessionRef, SourceError } from '../sessions/model.js';
import { isRecord } from '../sessions/reading.js';
import type { DiscoveryJson, DiscoveryProvider, DiscoveryRequest, DiscoveryResponse, DiscoverySession } from './model.js';
import { isDeliveryMode } from '../../delivery-mode.js';

export const DISCOVERY_MAX_BYTES = 2 * 1024 * 1024;
const MAX_ARRAY_LENGTH = 2000;
const MAX_NODES = 50000;
const MAX_DEPTH = 12;
const MAX_CURSOR_LENGTH = 512 * 1024;
const completenessKinds: readonly Completeness[] = ['complete', 'partial', 'unavailable', 'cancelled'];
const errorKinds: readonly SourceError['kind'][] = ['missing', 'unreadable', 'malformed', 'unavailable', 'legacy-limit', 'cancelled', 'invalid-cursor', 'unsupported'];

function invalid(): never { throw new Error('Malformed discovery JSON.'); }

function text(value: unknown, max = 65536): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) invalid();
  return value;
}

function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid();
}

function referenceKind(value: unknown): 'native' | 'process' | undefined {
  if (value === undefined || value === 'native' || value === 'process') return value;
  return invalid();
}

function boundedRequest(request: DiscoveryRequest): DiscoveryRequest {
  if (Buffer.byteLength(JSON.stringify(request)) > DISCOVERY_MAX_BYTES) invalid();
  return request;
}

export function parseDiscoveryRequest(input: unknown): DiscoveryRequest {
  if (!isRecord(input)) invalid();
  if (input.op === 'detail') {
    keys(input, ['op', 'providerId', 'nativeId', 'referenceKind']);
    const kind = referenceKind(input.referenceKind);
    return boundedRequest({ op: 'detail', providerId: text(input.providerId), nativeId: text(input.nativeId), ...(kind === undefined ? {} : { referenceKind: kind }) });
  }
  if (input.op !== 'list') invalid();
  keys(input, ['op', 'cursor', 'limit', 'filter']);
  if (input.limit !== undefined && (typeof input.limit !== 'number' || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1000)) invalid();
  const cursor = input.cursor === undefined ? undefined : text(input.cursor, MAX_CURSOR_LENGTH);
  let filter: { providerIds?: string[]; text?: string } | undefined;
  if (input.filter !== undefined) {
    if (!isRecord(input.filter)) invalid();
    keys(input.filter, ['providerIds', 'text']);
    const ids = input.filter.providerIds;
    if (ids !== undefined && (!Array.isArray(ids) || ids.length > 100 || ids.some((id) => typeof id !== 'string' || id.length === 0 || id.length > 65536))) invalid();
    if (input.filter.text !== undefined && (typeof input.filter.text !== 'string' || input.filter.text.length > 4096)) invalid();
    filter = {
      ...(Array.isArray(ids) ? { providerIds: ids.map((id: unknown) => text(id)) } : {}),
      ...(typeof input.filter.text === 'string' ? { text: input.filter.text } : {}),
    };
  }
  return boundedRequest({ op: 'list', ...(cursor === undefined ? {} : { cursor }), ...(typeof input.limit === 'number' ? { limit: input.limit } : {}), ...(filter === undefined ? {} : { filter }) });
}

function sensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return ['key', 'adminkey', 'auth', 'authorization', 'proof', 'challenge', 'signature', 'credentials', 'messages', 'message', 'history', 'chat', 'transcript', 'turns', 'prompt', 'content', 'input', 'output', 'prototype', 'constructor', 'proto'].includes(normalized)
    || /key$|token|secret|password|socket|pipepath|auth(?:proof|challenge|response|signature)|credential/.test(normalized);
}

/** Copy only bounded JSON metadata; never invoke toJSON or carry prototype properties. */
function safeJson(input: unknown, budget: { nodes: number; bytes: number }, depth = 0): DiscoveryJson {
  if (depth > MAX_DEPTH || ++budget.nodes > MAX_NODES) invalid();
  if (input === null || typeof input === 'boolean') return input;
  if (typeof input === 'number') { if (!Number.isFinite(input)) invalid(); return input; }
  if (typeof input === 'string') {
    budget.bytes += Buffer.byteLength(input);
    if (budget.bytes > DISCOVERY_MAX_BYTES) invalid();
    return input;
  }
  if (Array.isArray(input)) {
    if (input.length > MAX_ARRAY_LENGTH) invalid();
    return input.map((item) => safeJson(item, budget, depth + 1));
  }
  if (!isRecord(input) || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) invalid();
  const pairs: [string, DiscoveryJson][] = [];
  for (const [key, value] of Object.entries(input)) {
    budget.bytes += Buffer.byteLength(key);
    if (budget.bytes > DISCOVERY_MAX_BYTES) invalid();
    if (value === undefined || sensitiveKey(key)) continue;
    pairs.push([key, safeJson(value, budget, depth + 1)]);
  }
  return Object.fromEntries(pairs);
}

function capabilities(input: unknown): ProviderCapabilities {
  if (!isRecord(input) || typeof input.discovery !== 'boolean' || typeof input.delivery !== 'boolean' || typeof input.launch !== 'boolean' || typeof input.diagnostics !== 'boolean') invalid();
  const modes = input.deliveryModes;
  if (modes !== undefined && (!Array.isArray(modes) || modes.length > 2 || !modes.every(isDeliveryMode) || new Set(modes).size !== modes.length)) invalid();
  return { discovery: input.discovery, delivery: input.delivery, launch: input.launch, diagnostics: input.diagnostics,
    ...(modes === undefined ? {} : { deliveryModes: modes.filter(isDeliveryMode) }) };
}

function ref(input: unknown): SessionRef {
  if (!isRecord(input)) invalid();
  const kind = referenceKind(input.referenceKind);
  return { contextId: text(input.contextId), providerId: text(input.providerId), nativeId: text(input.nativeId), ...(kind === undefined ? {} : { referenceKind: kind }) };
}

function session(input: unknown, budget: { nodes: number; bytes: number }): DiscoverySession {
  if (!isRecord(input) || (input.name !== null && typeof input.name !== 'string') || !isRecord(input.attributes)) invalid();
  const attributes = safeJson(input.attributes, budget);
  if (!isRecord(attributes)) invalid();
  return { ref: ref(input.ref), name: input.name, rawStatus: safeJson(input.rawStatus, budget), capabilities: capabilities(input.capabilities), attributes };
}

function readResult(input: unknown): ReadResult {
  if (!isRecord(input) || !completenessKinds.some((kind) => kind === input.completeness) || typeof input.observedAt !== 'number' || !Number.isFinite(input.observedAt) || input.observedAt < 0 || !Array.isArray(input.errors) || input.errors.length > 1000) invalid();
  const completeness = completenessKinds.find((kind) => kind === input.completeness);
  if (completeness === undefined) invalid();
  const errors = input.errors.map((error: unknown): SourceError => {
    if (!isRecord(error) || !isRecord(error.source)) invalid();
    const kind = errorKinds.find((entry) => entry === error.kind);
    if (kind === undefined || (error.source.path !== undefined && typeof error.source.path !== 'string') || (error.nextStep !== undefined && typeof error.nextStep !== 'string')) invalid();
    return {
      source: { contextId: text(error.source.contextId), providerId: text(error.source.providerId), ...(typeof error.source.path === 'string' ? { path: error.source.path } : {}) },
      kind, message: text(error.message), ...(typeof error.nextStep === 'string' ? { nextStep: error.nextStep } : {}),
    };
  });
  if (completeness === 'complete' && errors.length > 0) invalid();
  return { completeness, observedAt: input.observedAt, errors };
}

/** All file/network/SSH JSON enters as unknown and leaves as a fresh, secret-free DTO. */
export function parseDiscoveryResponse(input: unknown): DiscoveryResponse {
  if (!isRecord(input) || !Array.isArray(input.providers) || input.providers.length > 100) invalid();
  const providers: DiscoveryProvider[] = input.providers.map((provider: unknown) => {
    if (!isRecord(provider)) invalid();
    return { providerId: text(provider.providerId), capabilities: capabilities(provider.capabilities) };
  });
  if (new Set(providers.map((provider) => provider.providerId)).size !== providers.length) invalid();
  const budget = { nodes: 0, bytes: 0 };
  let result: DiscoveryResponse;
  if (input.op === 'list') {
    if (!isRecord(input.page) || !Array.isArray(input.page.items) || input.page.items.length > MAX_ARRAY_LENGTH) invalid();
    const page = input.page;
    const items = input.page.items;
    const base = readResult(page);
    const nextCursor = page.nextCursor === null ? null : text(page.nextCursor, MAX_CURSOR_LENGTH);
    if (base.completeness === 'complete' && nextCursor !== null) invalid();
    result = { op: 'list', providers, page: { ...base, items: items.map((item: unknown) => session(item, budget)), nextCursor } };
  } else if (input.op === 'detail') {
    if (!isRecord(input.detail)) invalid();
    result = { op: 'detail', providers, detail: { ...readResult(input.detail), item: input.detail.item === null ? null : session(input.detail.item, budget) } };
  } else invalid();
  const items = result.op === 'list' ? result.page.items : result.detail.item === null ? [] : [result.detail.item];
  if (items.some((item) => !providers.some((provider) => provider.providerId === item.ref.providerId))) invalid();
  if (Buffer.byteLength(JSON.stringify(result)) > DISCOVERY_MAX_BYTES) invalid();
  return result;
}
