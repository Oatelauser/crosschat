import { readFileSync } from 'node:fs';
import { defaultConversationsFile, pairKeyOf } from './conversations.js';
import { defaultOutboxDir, outboxPairCounts } from './outbox.js';
import { type SendLogEntry, defaultSendLogFile, readSendLogTail } from './send-log.js';
import { decodeRef } from './ref.js';

/**
 * Per-pair conversation overview rows for a future `status --conversations`
 * (status batch B0: pure data, no rendering). conversations.json is the
 * existence authority — only pairs recorded there get a row — enriched with
 * the send-log tail (a bounded ~200-line window, never a full scan) and
 * per-pair outbox parked counts.
 *
 * Join: send-log `from` (identity key, B16) and `target` (`claude:<id>` /
 * `codex:<id>`) are both endpoint identity keys, so each entry maps straight
 * onto the pair key. Entries older than B16 (no `from`) fall back to decoding
 * their own embedded replyRef — that ref belongs to the message itself, so
 * the ref-rotation ceiling of a replyRef ↔ conversations.json current-ref
 * join does not apply here.
 */

export interface ConversationSummary {
  /** Display names, in pair-key endpoint order (sorted). */
  pair: [string, string];
  /**
   * Endpoint identity keys (`claude:<id>` / `codex:<id>` / `human`), in the
   * same slots as `pair`. Render support: lets a view map `lastFrom` (an
   * identity key) onto a display-name slot; not part of the JSON contract.
   */
  endpoints: [string, string];
  ref: string;
  updatedAt: number;
  /** Max turn across both directions in the tail window; null when the pair has no tail entries. */
  turn: number | null;
  lastStatus: SendLogEntry['status'] | null;
  lastFrom: string | null;
  parked: number;
}

export interface ConversationSummaryDeps {
  conversationsFile: string;
  sendLogFile: string;
  outboxDir: string;
}

export function defaultConversationSummaryDeps(): ConversationSummaryDeps {
  return {
    conversationsFile: defaultConversationsFile(),
    sendLogFile: defaultSendLogFile(),
    outboxDir: defaultOutboxDir(),
  };
}

export function conversationSummaries(
  deps: ConversationSummaryDeps = defaultConversationSummaryDeps(),
): ConversationSummary[] {
  return aggregateSummaries(
    loadPairs(deps.conversationsFile),
    readSendLogTail(deps.sendLogFile),
    outboxPairCounts(deps.outboxDir),
  );
}

/** Pure three-source merge; rows ordered by updatedAt (newest first). */
export function aggregateSummaries(
  pairs: Record<string, { ref: string; updatedAt: number }>,
  tail: SendLogEntry[],
  parked: Map<string, number>,
): ConversationSummary[] {
  const byPair = new Map<string, SendLogEntry[]>();
  for (const entry of tail) {
    const key = pairKeyOfEntry(entry);
    if (key === undefined) continue;
    const list = byPair.get(key);
    if (list === undefined) byPair.set(key, [entry]);
    else list.push(entry);
  }
  return Object.entries(pairs)
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .map(([key, { ref, updatedAt }]) => {
      const entries = byPair.get(key) ?? [];
      const latest = latestByTs(entries);
      const [a = '', b = ''] = key.split('\n');
      return {
        pair: namesOf(key, entries),
        endpoints: [a, b],
        ref,
        updatedAt,
        turn: maxTurn(entries),
        lastStatus: latest?.status ?? null,
        lastFrom: latest?.from ?? null,
        parked: parked.get(key) ?? 0,
      };
    });
}

/** Pair key of one log entry; undefined when it cannot be attributed. */
function pairKeyOfEntry(entry: SendLogEntry): string | undefined {
  if (entry.from !== undefined && entry.target !== '') {
    return [entry.from, entry.target].sort().join('\n');
  }
  if (entry.replyRef !== undefined) {
    try {
      const ref = decodeRef(entry.replyRef);
      return pairKeyOf(ref.f, ref.t);
    } catch {
      // undecodable ref: no attribution
    }
  }
  return undefined;
}

/** ts-newest entry (not the physical last line); a tie keeps the later line. */
function latestByTs(entries: SendLogEntry[]): SendLogEntry | undefined {
  let latest: SendLogEntry | undefined;
  let latestTs = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    const ts = Date.parse(entry.ts);
    if (Number.isNaN(ts)) continue;
    if (latest === undefined || ts >= latestTs) {
      latest = entry;
      latestTs = ts;
    }
  }
  return latest;
}

function maxTurn(entries: SendLogEntry[]): number | null {
  let max: number | null = null;
  for (const { turn } of entries) {
    if (typeof turn === 'number' && turn > (max ?? Number.NEGATIVE_INFINITY)) max = turn;
  }
  return max;
}

function namesOf(pairKey: string, entries: SendLogEntry[]): [string, string] {
  const [a = '', b = ''] = pairKey.split('\n');
  return [nameOf(a, entries), nameOf(b, entries)];
}

/**
 * Newest evidence wins: an entry addressing the endpoint carries its display
 * name (`to`); otherwise a sending entry supplies its identity key (`from`,
 * raw); no entries at all → shortened descriptor (id8 style, cf. status.ts).
 */
function nameOf(endpoint: string, entries: SendLogEntry[]): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.target === endpoint && entry.to !== '') return entry.to;
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.from === endpoint) return entry.from;
  }
  return shortEndpoint(endpoint);
}

/** `claude:<id>` → `claude/<id8>`; `human` stays `human`. */
function shortEndpoint(endpoint: string): string {
  const sep = endpoint.indexOf(':');
  if (sep === -1) return endpoint;
  return `${endpoint.slice(0, sep)}/${endpoint.slice(sep + 1, sep + 9)}`;
}

function loadPairs(file: string): Record<string, { ref: string; updatedAt: number }> {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      pairs?: Record<string, { ref: string; updatedAt: number }>;
    };
    if (parsed !== null && typeof parsed === 'object' && typeof parsed.pairs === 'object') {
      return parsed.pairs;
    }
  } catch {
    // missing/corrupt: no recorded conversations → no rows
  }
  return {};
}
