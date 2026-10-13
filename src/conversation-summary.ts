import { defaultConversationsFile, loadAllPairs, pairKeyOfEntry } from './conversations.js';
import { defaultOutboxDir, outboxPairCounts } from './outbox.js';
import { decodeRef } from './ref.js';
import { type SendLogEntry, defaultSendLogFile, readSendLogTail } from './send-log.js';

/**
 * Per-pair conversation overview rows for a future `status --conversations`
 * (status batch B0: pure data, no rendering). The conversations store
 * (B20: per-pair shards + legacy-file fallback) is the existence
 * authority — only pairs recorded there get a row — enriched with
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
  /**
   * Rollout receipt of the pair's latest entry (B22): 'confirmed'/'unconfirmed'
   * when that entry is a delivered codex send that probed; null = no record or
   * the latest entry is not a delivered codex delivery (claude has no rollout).
   */
  receipt: SendLogEntry['receipt'] | null;
  /**
   * G0 柄列：该对分片最新柄（绑定当前 ref 同 nonce 的 c<数字>）；null = 无柄
   * （显示 -）。Render support like `endpoints` — not part of the JSON contract.
   */
  handle: string | null;
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
    loadAllPairs(deps.conversationsFile),
    readSendLogTail(deps.sendLogFile),
    outboxPairCounts(deps.outboxDir),
  );
}

/** Pure three-source merge; rows ordered by updatedAt (newest first). */
export function aggregateSummaries(
  pairs: Record<string, { ref: string; updatedAt: number; handles?: Record<string, string> }>,
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
    .map(([key, { ref, updatedAt, handles }]) => {
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
        receipt: latest?.status === 'delivered' ? (latest.receipt ?? null) : null,
        handle: handleForRecord(ref, handles),
      };
    });
}

/** 该对分片最新柄：handles 里绑定当前 ref 同 nonce 的 c<数字>；ref 不可解码/无匹配 → null。 */
function handleForRecord(ref: string, handles: Record<string, string> | undefined): string | null {
  if (handles === undefined) return null;
  let nonce: string;
  try {
    nonce = decodeRef(ref).n;
  } catch {
    return null;
  }
  for (const [handle, value] of Object.entries(handles)) {
    try {
      if (decodeRef(value).n === nonce) return handle;
    } catch {
      // undecodable leftover: ignored
    }
  }
  return null;
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
 * name (`to`); otherwise a sending entry carries the sender's display name
 * (`fromName`, B21 — before the peer ever replies); otherwise a sending entry
 * supplies its identity key (`from`, raw — pre-B21 entries); no entries at
 * all → shortened descriptor (id8 style, cf. status.ts).
 */
function nameOf(endpoint: string, entries: SendLogEntry[]): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.target === endpoint && entry.to !== '') return entry.to;
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.from === endpoint && entry.fromName !== undefined && entry.fromName !== '') {
      return entry.fromName;
    }
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
