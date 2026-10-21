import type { SessionDetail, SessionGetRequest, SessionPage, SessionReader, SourceError } from './model.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function abortError(): Error {
  return new DOMException('Session read cancelled.', 'AbortError');
}

/** Stops waiting promptly; the caller still owns cleanup of its underlying read. */
export async function untilAborted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return work;
  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([work, cancelled]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
  }
}

export function cancelledPage(contextId: string, providerId: string, observedAt: number): SessionPage {
  return {
    items: [], nextCursor: null, completeness: 'cancelled', observedAt,
    errors: [{ source: { contextId, providerId }, kind: 'cancelled', message: 'Session read cancelled.' }],
  };
}

export function errorPage(error: SourceError, observedAt: number): SessionPage {
  return { items: [], nextCursor: null, completeness: 'unavailable', observedAt, errors: [error] };
}

/** Detail reads use exactly the same read-only pages and never resume a session. */
export async function findSession(reader: SessionReader, request: SessionGetRequest): Promise<SessionDetail> {
  const errors: SourceError[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await reader.list({ contextId: request.contextId, cursor, signal: request.signal });
    errors.push(...page.errors);
    const item = page.items.find((candidate) => candidate.ref.nativeId === request.nativeId);
    if (item !== undefined || page.nextCursor === null || page.completeness === 'cancelled' || page.completeness === 'unavailable') {
      return { item: item ?? null, completeness: page.completeness, observedAt: page.observedAt, errors };
    }
    if (seen.has(page.nextCursor)) {
      errors.push({ source: { contextId: request.contextId, providerId: reader.providerId }, kind: 'malformed', message: 'Session source repeated its page cursor.', nextStep: 'Refresh the source before reading more pages.' });
      return { item: null, completeness: 'partial', observedAt: page.observedAt, errors };
    }
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}
