import type { RosterMachine } from '../serve/protocol.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClaudeRegistryScan } from '../claude/registry.js';
import type { CodexThreadWithMeta } from '../codex/discovery.js';
import type { ConversationSummary } from '../conversation-summary.js';
import { MultichatError } from '../errors.js';
import type { NodeStatusFile } from '../serve/node.js';

/**
 * Read-only `status`: claude registry sessions (name/kind/status/pid/dir) plus
 * codex threads (name/dir/created/originator/id/status). A codex discovery
 * failure degrades to an "unavailable" marker instead of failing the whole
 * command — a side being down is a valid status answer. `--conversations`
 * switches to the per-pair conversation overview instead.
 */

export interface StatusDeps {
  listClaudeSessions(): ClaudeRegistryScan;
  listCodexThreads(): Promise<CodexThreadWithMeta[]>;
  /** Per-pair conversation rows for `status --conversations`; omitted → none. */
  listConversations?(): ConversationSummary[];
  /**
   * Live rollout receipt re-probe for `status --conversations` (B22): rows that
   * left the sender "unconfirmed" get one bounded recheck here. Injected with a
   * small poll budget (cli wires 2 tries × 200ms) so status never slows down.
   */
  confirmReceipt?(threadId: string, marker: string): Promise<'confirmed' | 'unconfirmed'>;
  /** Clock for the conversations view's relative times; omitted → Date.now(). */
  now?(): number;
  /**
   * Thread ids whose writer is held by a live TUI (006, thread-writer-locks).
   * Omitted → nothing is marked; output stays byte-identical to before.
   */
  listWriterLocks?(): Set<string>;
  /**
   * 票B B2：tcp 转发器状态目录（status-node.json/status-broker.json 所在）。
   * Omitted → the 转发器 section is skipped entirely (byte-identical to B1);
   * cli wires the real ~/.crosschat/tcp.
   */
  tcpDir?: string;
  /**
   * B2.1：成员机在线表拉取（瞬态连 broker 发 roster 帧，2s 超时）。缺省 →
   * 不拉（本机是 broker 或未入网，输出与 B2 字节一致）。undefined 返回=不可达。
   */
  roster?: () => Promise<RosterMachine[] | undefined>;
}

/** B2 freshness bound: a status file older than this reads as "没在跑". */
export const TCP_STATUS_FRESH_MS = 90_000;

interface BrokerStatusFile {
  state: string;
  port?: number;
  lastUpdated: string;
  onlineNodes?: string[];
}

function readStatusJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

/** 转发器区块（节点行 + broker 行 + 在线机器表）；dir=undefined → 空数组。 */
async function tcpForwarderLines(tcpDir: string | undefined, nowMs: number, roster?: () => Promise<RosterMachine[] | undefined>): Promise<string[]> {
  if (tcpDir === undefined) return [];
  const lines: string[] = [];
  const node = readStatusJson<NodeStatusFile>(join(tcpDir, 'status-node.json'));
  const nodeFresh = node !== undefined && nowMs - Date.parse(node.lastUpdated) < TCP_STATUS_FRESH_MS;
  if (!nodeFresh) {
    lines.push('转发器: 未运行');
  } else if (node!.state === 'online') {
    lines.push(`转发器: online tcp:${node!.brokerAlias} (since ${formatCreatedAt(node!.since)})`);
  } else if (node!.state === 'reconnect-wait') {
    const next = node!.nextAttemptAt === undefined ? '-' : formatHms(node!.nextAttemptAt);
    lines.push(`转发器: 重连等待中，下次尝试 ${next}`);
  } else {
    lines.push(`转发器: 连接中 tcp:${node!.brokerAlias}`);
  }
  const broker = readStatusJson<BrokerStatusFile>(join(tcpDir, 'status-broker.json'));
  if (broker !== undefined && broker.state === 'running' && nowMs - Date.parse(broker.lastUpdated) < TCP_STATUS_FRESH_MS) {
    const nodes = broker.onlineNodes ?? [];
    lines.push(`转发器: 服务端端口 ${broker.port ?? '?'}，${nodes.length} 节点在线`);
    if (nodes.length > 0) lines.push(`在线机器: ${nodes.join('、')}`);
    return lines;
  }
  // B2.1：非 broker 机（本机 status-broker.json 不新鲜）且有 roster 接线 → 瞬态拉在线表；
  // 失败静默降级为一行"不可达"。
  if (roster !== undefined) {
    const machines = await roster();
    if (machines === undefined) {
      lines.push('转发器: 不可达');
    } else {
      const disp = (m: RosterMachine): string => `${m.name ?? '?'} (${m.mid8})`;
      const online = machines.filter((m) => m.online);
      const offline = machines.filter((m) => !m.online);
      lines.push(`转发器: broker 可达，${online.length} 机器在线`);
      if (online.length > 0) lines.push(`在线机器: ${online.map(disp).join('、')}`);
      if (offline.length > 0) lines.push(`离线机器: ${offline.map(disp).join('、')}`);
    }
  }
  return lines;
}

/** `hh:mm:ss` (local time); `-` when unknown/invalid. */
function formatHms(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Last two segments of a session cwd (`D:\workspace\CC\foo` -> `CC\foo`). */
export function formatCwdShort(cwd: string | undefined): string {
  if (!cwd) return '-';
  const parts = cwd.split(/[\\/]+/).filter((segment) => segment.length > 0);
  if (parts.length === 0) return '-';
  return parts.slice(-2).join(cwd.includes('\\') ? '\\' : '/');
}

/** `MM-DD HH:mm` (local time) from an ISO timestamp; `-` when unknown/invalid. */
export function formatCreatedAt(iso: string | undefined): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export async function runStatus(
  deps: StatusDeps,
  json: boolean,
  conversations = false,
): Promise<string> {
  if (conversations) return conversationsView(deps, json);
  const scan = deps.listClaudeSessions();
  let threads: CodexThreadWithMeta[] | undefined;
  let codexError: string | undefined;
  try {
    threads = await deps.listCodexThreads();
  } catch (err) {
    codexError =
      err instanceof MultichatError
        ? `${err.code}: ${err.message}`
        : `INTERNAL: ${err instanceof Error ? err.message : String(err)}`;
  }
  const held = deps.listWriterLocks?.() ?? new Set<string>();

  if (json) {
    // B2：tcp 小节仅在 tcpDir 接线时出现——嵌入方（无该 dep）的 json 键集
    // 保持 {claude, codex} 冻结契约不变。
    const tcp = deps.tcpDir === undefined ? {} : { tcp: tcpJson(deps.tcpDir, deps.now?.() ?? Date.now()) };
    return JSON.stringify({
      ...tcp,
      claude: scan.sessions.map((session) => ({
        name: session.name ?? null,
        kind: session.kind,
        status: session.status,
        pid: session.pid,
        cwd: session.cwd ?? null,
      })),
      codex:
        threads === undefined
          ? { error: codexError }
          : [
              ...threads.map((thread) => ({
                name: thread.name,
                status: thread.status,
                id: thread.id.slice(0, 8),
                cwd: thread.meta?.cwd ?? null,
                createdAt: thread.meta?.createdAt ?? null,
                originator: thread.meta?.originator ?? null,
                // 006: only present when the writer is held — no locks, no field.
                ...(held.has(thread.id) ? { held: true as const } : {}),
              })),
              // Locked threads that never made it into thread/list (fresh TUI
              // tab, no rollout yet) still deserve a row.
              ...unlistedLocks(held, threads).map((id) => ({
                name: null,
                status: 'not_listed',
                id: id.slice(0, 8),
                cwd: null,
                createdAt: null,
                originator: null,
                held: true as const,
              })),
            ],
    });
  }

  const lines: string[] = ['claude:'];
  if (scan.sessions.length === 0) lines.push('  (none)');
  for (const session of scan.sessions) {
    lines.push(
      `  ${(session.name ?? '(unnamed)').padEnd(24)} ${session.kind.padEnd(12)} ${session.status.padEnd(16)} pid ${String(session.pid).padEnd(6)} ${formatCwdShort(session.cwd)}`,
    );
  }
  lines.push('codex:');
  if (codexError !== undefined) lines.push(`  unavailable (${codexError})`);
  else if ((threads ?? []).length === 0 && held.size === 0) lines.push('  (none)');
  else {
    for (const thread of threads ?? []) {
      const name = (thread.name ?? '(unnamed)').padEnd(24);
      const dir = formatCwdShort(thread.meta?.cwd).padEnd(20);
      const created = formatCreatedAt(thread.meta?.createdAt).padEnd(11);
      const originator = (thread.meta?.originator ?? '-').padEnd(16);
      const marker = held.has(thread.id) ? '  TUI占用' : '';
      lines.push(`  ${name} ${dir} ${created} ${originator} ${thread.id.slice(0, 8)}  ${thread.status}${marker}`);
    }
    // 006: locked but absent from thread/list (fresh TUI tab, no rollout).
    for (const id of unlistedLocks(held, threads)) {
      lines.push(
        `  ${'-'.padEnd(24)} ${'-'.padEnd(20)} ${'-'.padEnd(11)} ${'-'.padEnd(16)} ${id.slice(0, 8)}  未列入  TUI占用`,
      );
    }
  }
  lines.push(...(await tcpForwarderLines(deps.tcpDir, deps.now?.() ?? Date.now(), deps.roster)));
  return lines.join('\n');
}

/** B2：json 模式的转发器小节（dir 缺省 → null 占位，保持键集稳定）。 */
function tcpJson(tcpDir: string | undefined, nowMs: number): { node: unknown; broker: unknown } {
  if (tcpDir === undefined) return { node: null, broker: null };
  const node = readStatusJson<NodeStatusFile>(join(tcpDir, 'status-node.json'));
  const nodeFresh = node !== undefined && nowMs - Date.parse(node.lastUpdated) < TCP_STATUS_FRESH_MS;
  const broker = readStatusJson<BrokerStatusFile>(join(tcpDir, 'status-broker.json'));
  const brokerFresh =
    broker !== undefined && broker.state === 'running' && nowMs - Date.parse(broker.lastUpdated) < TCP_STATUS_FRESH_MS;
  return {
    node: nodeFresh ? node : null,
    broker: brokerFresh ? { port: broker!.port ?? null, onlineNodes: broker!.onlineNodes ?? [] } : null,
  };
}

/** Locks whose thread id is not in the thread/list result (empty when listing failed). */
function unlistedLocks(held: ReadonlySet<string>, threads: CodexThreadWithMeta[] | undefined): string[] {
  if (threads === undefined) return [];
  const listed = new Set(threads.map((thread) => thread.id));
  return [...held].filter((id) => !listed.has(id));
}

/** `status --conversations`: per-pair rows (direction, freshness, turn, last status, receipt, parked). */
async function conversationsView(deps: StatusDeps, json: boolean): Promise<string> {
  const rows = deps.listConversations?.() ?? [];
  await recheckReceipts(rows, deps);
  // B23: bare identity-key / id8 pair slots become display names (render-only).
  // Slots already carrying evidence names (to/fromName) never match a table
  // key, so they keep priority; `lastFrom` and `endpoints` stay identity keys.
  const names = rows.length === 0 ? new Map<string, string>() : await endpointDisplayNames(deps);
  for (const row of rows) {
    row.pair = [names.get(row.pair[0]) ?? row.pair[0], names.get(row.pair[1]) ?? row.pair[1]];
  }
  if (json) {
    // Frozen JSON contract: exactly the eight summary fields (B22 added `receipt`);
    // `endpoints` is render-only.
    return JSON.stringify(rows, (key, value) => (key === 'endpoints' ? undefined : value));
  }
  const now = deps.now?.() ?? Date.now();
  const lines = ['会话:'];
  if (rows.length === 0) lines.push('  (none)');
  for (const row of rows) {
    const receipt = row.receipt === 'confirmed' ? '  已确认' : row.receipt === 'unconfirmed' ? '  回执未确认' : '';
    lines.push(
      `  ${pairArrow(row).padEnd(30)}${formatRelativeTime(row.updatedAt, now).padEnd(12)}` +
        `turn ${String(row.turn ?? '?').padEnd(4)}${row.lastStatus ?? '未知'}` +
        `${row.parked > 0 ? `  滞留 ${row.parked}` : ''}${receipt}`,
    );
  }
  return lines.join('\n');
}

/**
 * Display names keyed by every bare form a pair slot can render (B23): the
 * full identity key (`claude:<id>` / `codex:<id>`) and the id8 descriptor
 * `shortEndpoint` produces (`claude/<id8>`). Same-source on the claude side:
 * identity keys are built from this very registry's sessionId
 * (identity.ts claudeIdentity → identityKey), so the join is exact. A codex
 * listing failure degrades to claude-only names (same stance as the main
 * view); a nameless session/thread is simply not in the table.
 */
async function endpointDisplayNames(deps: StatusDeps): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const add = (prefix: string, id: string, name: string | null | undefined) => {
    if (name === undefined || name === null || name === '') return;
    names.set(`${prefix}:${id}`, name);
    names.set(`${prefix}/${id.slice(0, 8)}`, name);
  };
  for (const session of deps.listClaudeSessions().sessions) {
    if (session.sessionId !== '') add('claude', session.sessionId, session.name);
  }
  try {
    for (const thread of await deps.listCodexThreads()) add('codex', thread.id, thread.name);
  } catch {
    // codex down is a valid status answer — translate the claude side only
  }
  return names;
}

/**
 * One live re-probe per row that left the sender unconfirmed (B22): the
 * rollout write often lands after send's own 1.5s budget, so status is the
 * natural second look. Only delivered+unconfirmed rows whose pair has a codex
 * endpoint are probed (claude has no rollout concept); any verdict other than
 * 'confirmed' leaves the row as it was — 'unconfirmed' means "not seen", the
 * row already says so.
 */
async function recheckReceipts(rows: ConversationSummary[], deps: StatusDeps): Promise<void> {
  const confirm = deps.confirmReceipt;
  if (confirm === undefined) return;
  for (const row of rows) {
    if (row.lastStatus !== 'delivered' || row.receipt !== 'unconfirmed') continue;
    const codexId = row.endpoints.find((endpoint) => endpoint.startsWith('codex:'))?.slice('codex:'.length);
    if (codexId === undefined) continue;
    if ((await confirm(codexId, row.ref)) === 'confirmed') row.receipt = 'confirmed';
  }
}

/** `A → B` along the last message's direction (`lastFrom`'s slot first); `↔` when unknown. */
function pairArrow(row: ConversationSummary): string {
  const [a, b] = row.pair;
  if (row.lastFrom === row.endpoints[0]) return `${a} → ${b}`;
  if (row.lastFrom === row.endpoints[1]) return `${b} → ${a}`;
  return `${a} ↔ ${b}`;
}

/** `X 分钟前` / `X 小时前` / `X 天前` (rounded, cf. doctor); absolute `MM-DD HH:mm` past a week. */
export function formatRelativeTime(updatedAtMs: number, nowMs: number): string {
  const minutes = (nowMs - updatedAtMs) / 60_000;
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} 分钟前`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} 小时前`;
  if (minutes < 60 * 24 * 7) return `${Math.round(minutes / 1_440)} 天前`;
  return formatCreatedAt(new Date(updatedAtMs).toISOString());
}
