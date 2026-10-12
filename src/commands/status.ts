import type { RosterMachine } from '../serve/protocol.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ClaudeRegistryScan } from '../claude/registry.js';
import type { CodexThreadWithMeta } from '../codex/discovery.js';
import { pairKeyOf } from '../conversations.js';
import type { ConversationSummary } from '../conversation-summary.js';
import { MultichatError } from '../errors.js';
import { decodeRef } from '../ref.js';
import type { SendLogEntry } from '../send-log.js';
import { readNodeConfig, type BrokerEntry, type NodeStatusFile } from '../serve/node.js';

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
   * B2：可传条目逐星探（多条目时逐条目拉表）；不传=entries[0]（单条目行为不变）。
   */
  roster?(entry?: BrokerEntry): Promise<RosterMachine[] | undefined>;
  /**
   * `--conversations --via` 的传输族判定源（本机 send-log 尾窗）。Omitted →
   * 无跨机痕迹可判，--via 过滤下不显示任何对。cli wires the default log tail.
   */
  sendLogTail?(): SendLogEntry[];
}

/** B2 freshness bound: a status file older than this reads as "没在跑". */
export const TCP_STATUS_FRESH_MS = 90_000;

interface BrokerStatusFile {
  state: string;
  port?: number;
  /** E0 星名（broker 起服务时落定；status 行化妆用）。 */
  name?: string;
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

/** B2：tcp 目录下的节点守护状态文件（默认在前，其余按选择器名排序）。 */
function listNodeStatusFiles(tcpDir: string): string[] {
  try {
    return readdirSync(tcpDir)
      .filter((f) => /^status-node(-.*)?\.json$/.test(f))
      .sort((a, b) => (a === 'status-node.json' ? -1 : b === 'status-node.json' ? 1 : a.localeCompare(b)));
  } catch {
    return [];
  }
}

/** 文件名 → 选择器（status-node.json=''；status-node-work.json='work'）。 */
function nodeStatusSelector(file: string): string {
  return file === 'status-node.json' ? '' : file.replace(/^status-node-/, '').replace(/\.json$/, '');
}

/** status 展示层截短：超过 16 字符的展示串显示 <前14>…（node.json 与 CLI 参数不受影响）。 */
function shortDisplay(s: string): string {
  return s.length > 16 ? `${s.slice(0, 14)}…` : s;
}

/** 单守护状态行（prefix='节点客户端:' 单条目 / '节点客户端[<选择器>]:' 多条目）。 */
function nodeStateLine(prefix: string, st: NodeStatusFile): string {
  if (st.state === 'online') return `${prefix} online ${shortDisplay(`tcp:${st.brokerAlias}`)} (since ${formatCreatedAt(st.since)})`;
  if (st.state === 'reconnect-wait') {
    const next = st.nextAttemptAt === undefined ? '-' : formatHms(st.nextAttemptAt);
    return `${prefix} 重连等待中，下次尝试 ${next}`;
  }
  return `${prefix} 连接中 ${shortDisplay(`tcp:${st.brokerAlias}`)}`;
}

/**
 * 转发器区块（节点行 + broker 行 + 在线机器表）；dir=undefined → 空数组。
 * B2 多守护：逐个 status-node*.json 出行（多条目时带 [选择器] 标签）；
 * 单条目（仅默认文件/无文件）输出与 B2 之前逐字节同形。
 */
async function tcpForwarderLines(tcpDir: string | undefined, nowMs: number, roster?: (entry?: BrokerEntry) => Promise<RosterMachine[] | undefined>): Promise<string[]> {
  if (tcpDir === undefined) return [];
  const lines: string[] = [];
  const files = listNodeStatusFiles(tcpDir);
  const multi = files.length > 1;
  let anyFresh = false;
  for (const file of files) {
    const node = readStatusJson<NodeStatusFile>(join(tcpDir, file));
    const fresh = node !== undefined && nowMs - Date.parse(node.lastUpdated) < TCP_STATUS_FRESH_MS;
    if (multi) {
      const tag = nodeStatusSelector(file) || '默认';
      if (!fresh) {
        lines.push(`节点客户端[${tag}]: 未运行`);
        continue;
      }
      anyFresh = true;
      lines.push(nodeStateLine(`节点客户端[${tag}]:`, node!));
    } else if (fresh) {
      anyFresh = true;
      lines.push(nodeStateLine('节点客户端:', node!));
    }
  }
  if (!multi && !anyFresh) lines.push('节点客户端: 未运行');
  const broker = readStatusJson<BrokerStatusFile>(join(tcpDir, 'status-broker.json'));
  if (broker !== undefined && broker.state === 'running' && nowMs - Date.parse(broker.lastUpdated) < TCP_STATUS_FRESH_MS) {
    const nodes = broker.onlineNodes ?? [];
    const head = broker.name === undefined ? '服务端' : `服务端 ${broker.name} `;
    lines.push(`broker: ${head}端口 ${broker.port ?? '?'}，${nodes.length} 节点在线`);
    if (nodes.length > 0) lines.push(`在线机器: ${nodes.join('、')}`);
    return lines;
  }
  // B2.1：非 broker 机（本机 status-broker.json 不新鲜）且有 roster 接线 → 瞬态拉在线表；
  // 失败静默降级为一行"不可达"。B2：node.json 多条目时逐条目探各自 broker。
  if (roster !== undefined) {
    let entries: BrokerEntry[] | undefined;
    try {
      entries = readNodeConfig(join(tcpDir, 'node.json')).entries;
    } catch {
      // 无 node.json/损坏 → 走单条目路径（roster 自行降级）
    }
    if (entries === undefined || entries.length <= 1) {
      const machines = await roster();
      pushRosterLines(lines, '', machines);
    } else {
      for (const entry of entries) {
        const label = shortDisplay(entry.name ?? `${entry.host}:${entry.port}`);
        const machines = await roster(entry);
        pushRosterLines(lines, label, machines);
      }
    }
  }
  return lines;
}

/** 在线表行（label='' 时与 B2.1 单条目格式逐字节一致）。 */
function pushRosterLines(lines: string[], label: string, machines: RosterMachine[] | undefined): void {
  if (machines === undefined) {
    lines.push(label === '' ? 'broker: 不可达' : `broker: ${label} 不可达`);
    return;
  }
  const disp = (m: RosterMachine): string => `${m.name ?? '?'} (${m.mid8})`;
  const online = machines.filter((m) => m.online);
  const offline = machines.filter((m) => !m.online);
  lines.push(label === '' ? `broker: 可达，${online.length} 机器在线` : `broker: ${label} 可达，${online.length} 机器在线`);
  if (online.length > 0) lines.push(label === '' ? `在线机器: ${online.map(disp).join('、')}` : `在线机器[${label}]: ${online.map(disp).join('、')}`);
  if (offline.length > 0) lines.push(label === '' ? `离线机器: ${offline.map(disp).join('、')}` : `离线机器[${label}]: ${offline.map(disp).join('、')}`);
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

/** status 过滤参数（cli 层已做互斥/组合校验，这里只消费）。 */
export interface StatusFilters {
  /** --claude/--codex：主视图选段。 */
  section?: 'claude' | 'codex';
  /** --name <子串>：按显示名大小写不敏感子串过滤（conversations 侧任一端命中即保留）。 */
  name?: string;
  /** --via tcp|ssh：--conversations 传输族过滤（本机 send-log 无跨机痕迹的对不显示）。 */
  via?: 'tcp' | 'ssh';
  /** --all：主视图带出未命名会话（默认隐藏）。 */
  all?: boolean;
}

/** 显示名子串匹配（大小写不敏感）；未命名行的显示名是 '(unnamed)'。 */
function nameMatcher(needle: string | undefined): (name: string | null | undefined) => boolean {
  if (needle === undefined) return () => true;
  const lower = needle.toLowerCase();
  return (name) => (name ?? '(unnamed)').toLowerCase().includes(lower);
}

export async function runStatus(
  deps: StatusDeps,
  json: boolean,
  conversations = false,
  filters: StatusFilters = {},
): Promise<string> {
  if (conversations) return conversationsView(deps, json, filters);
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
  const matches = nameMatcher(filters.name);

  if (json) {
    // B2：tcp 小节仅在 tcpDir 接线时出现——嵌入方（无该 dep）的 json 键集
    // 保持 {claude, codex} 冻结契约不变。B2 多星新增 tcpProfiles（逐守护
    // status-node*.json）；tcp.node/tcp.broker 既有形状不动。
    // 过滤参数组合 --json：选段省掉另一键、--name 滤行（--all 不影响 json，
    // 未命名行始终在场，契约不变）。
    const nowMs = deps.now?.() ?? Date.now();
    const tcp = deps.tcpDir === undefined ? {} : { tcp: tcpJson(deps.tcpDir, nowMs) };
    const tcpProfiles = deps.tcpDir === undefined ? {} : { tcpProfiles: nodeProfilesJson(deps.tcpDir, nowMs) };
    const out: Record<string, unknown> = { ...tcp, ...tcpProfiles };
    if (filters.section !== 'codex') {
      out.claude = scan.sessions.filter((session) => matches(session.name)).map((session) => ({
        name: session.name ?? null,
        kind: session.kind,
        status: session.status,
        pid: session.pid,
        cwd: session.cwd ?? null,
      }));
    }
    if (filters.section !== 'claude') {
      out.codex =
        threads === undefined
          ? { error: codexError }
          : [
              ...threads.filter((thread) => matches(thread.name)).map((thread) => ({
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
            ];
    }
    return JSON.stringify(out);
  }

  // (unnamed) 默认隐藏（--all 带出）；未列入的 TUI 锁行同属未命名，随 --all。
  const claudeRows = scan.sessions.filter((session) => (filters.all || !!session.name) && matches(session.name));
  const codexRows = (threads ?? []).filter((thread) => (filters.all || !!thread.name) && matches(thread.name));
  const unlisted = filters.all ? unlistedLocks(held, threads) : [];

  const lines: string[] = [];
  if (filters.section !== 'codex') {
    lines.push('claude:');
    if (claudeRows.length === 0) lines.push('  (none)');
    for (const session of claudeRows) {
      lines.push(
        `  ${(session.name ?? '(unnamed)').padEnd(24)} ${session.kind.padEnd(12)} ${session.status.padEnd(16)} pid ${String(session.pid).padEnd(6)} ${formatCwdShort(session.cwd)}`,
      );
    }
  }
  if (filters.section !== 'claude') {
    lines.push('codex:');
    if (codexError !== undefined) lines.push(`  unavailable (${codexError})`);
    else if (codexRows.length === 0 && unlisted.length === 0) lines.push('  (none)');
    else {
      for (const thread of codexRows) {
        const name = (thread.name ?? '(unnamed)').padEnd(24);
        const dir = formatCwdShort(thread.meta?.cwd).padEnd(20);
        const created = formatCreatedAt(thread.meta?.createdAt).padEnd(11);
        const originator = (thread.meta?.originator ?? '-').padEnd(16);
        const marker = held.has(thread.id) ? '  TUI占用' : '';
        lines.push(`  ${name} ${dir} ${created} ${originator} ${thread.id.slice(0, 8)}  ${thread.status}${marker}`);
      }
      // 006: locked but absent from thread/list (fresh TUI tab, no rollout).
      for (const id of unlisted) {
        lines.push(
          `  ${'-'.padEnd(24)} ${'-'.padEnd(20)} ${'-'.padEnd(11)} ${'-'.padEnd(16)} ${id.slice(0, 8)}  未列入  TUI占用`,
        );
      }
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

/** B2：--json 的多守护小节——逐 status-node*.json（选择器 + 新鲜状态，陈旧为 null）。 */
function nodeProfilesJson(tcpDir: string, nowMs: number): Array<{ selector: string; status: NodeStatusFile | null }> {
  return listNodeStatusFiles(tcpDir).map((file) => {
    const st = readStatusJson<NodeStatusFile>(join(tcpDir, file));
    const fresh = st !== undefined && nowMs - Date.parse(st.lastUpdated) < TCP_STATUS_FRESH_MS;
    return { selector: nodeStatusSelector(file), status: fresh ? st! : null };
  });
}

/** Locks whose thread id is not in the thread/list result (empty when listing failed). */function unlistedLocks(held: ReadonlySet<string>, threads: CodexThreadWithMeta[] | undefined): string[] {
  if (threads === undefined) return [];
  const listed = new Set(threads.map((thread) => thread.id));
  return [...held].filter((id) => !listed.has(id));
}

/**
 * 传输族判定（--via）：跨机记账的 send-log 条目 target 是 `via:` 痕迹——ssh 腿
 * 写 `via:<host>`（federation.ts）、tcp 腿写 `via:tcp:<machine>`（via-tcp.ts）。
 * 这类条目的 from/target 不是双身份键，归对靠解码其 replyRef（ref 两端即对键）。
 * 返回 pairKey → 出现过的族；无痕迹的对不在表里（--via 下不显示）。
 */
function viaFamiliesByPair(tail: SendLogEntry[]): Map<string, Set<'tcp' | 'ssh'>> {
  const byPair = new Map<string, Set<'tcp' | 'ssh'>>();
  for (const entry of tail) {
    const family = entry.target.startsWith('via:tcp:') ? 'tcp' : entry.target.startsWith('via:') ? 'ssh' : undefined;
    if (family === undefined || entry.replyRef === undefined || entry.replyRef === '') continue;
    try {
      const ref = decodeRef(entry.replyRef);
      const key = pairKeyOf(ref.f, ref.t);
      const set = byPair.get(key) ?? new Set<'tcp' | 'ssh'>();
      set.add(family);
      byPair.set(key, set);
    } catch {
      // undecodable ref: no attribution
    }
  }
  return byPair;
}

/** `status --conversations`: per-pair rows (direction, freshness, turn, last status, receipt, parked). */
async function conversationsView(deps: StatusDeps, json: boolean, filters: StatusFilters = {}): Promise<string> {
  let rows = deps.listConversations?.() ?? [];
  await recheckReceipts(rows, deps);
  // B23: bare identity-key / id8 pair slots become display names (render-only).
  // Slots already carrying evidence names (to/fromName) never match a table
  // key, so they keep priority; `lastFrom` and `endpoints` stay identity keys.
  const names = rows.length === 0 ? new Map<string, string>() : await endpointDisplayNames(deps);
  for (const row of rows) {
    row.pair = [names.get(row.pair[0]) ?? row.pair[0], names.get(row.pair[1]) ?? row.pair[1]];
  }
  // 过滤（名字翻译后再滤，命中的是显示名；--via 按该对本机 send-log 的跨机痕迹分族）。
  if (filters.via !== undefined) {
    const families = viaFamiliesByPair(deps.sendLogTail?.() ?? []);
    rows = rows.filter((row) => families.get(row.endpoints.join('\n'))?.has(filters.via!));
  }
  if (filters.name !== undefined) {
    const lower = filters.name.toLowerCase();
    rows = rows.filter((row) => row.pair.some((n) => n.toLowerCase().includes(lower)));
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
          `${row.lastStatus === 'queued' ? '（已交对端队列待消费——对方回信即证明已处理）' : ''}` +
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
