import type { RosterMachine, SessionMemberDecl, StatusCodexRow, StatusPayload } from '../serve/protocol.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClaudeRegistryScan } from '../claude/registry.js';
import type { CodexThreadWithMeta } from '../codex/discovery.js';
import { pairKeyOf } from '../conversations.js';
import type { ConversationSummary } from '../conversation-summary.js';
import { MultichatError } from '../errors.js';
import { decodeRef } from '../ref.js';
import { normalizeMid } from '../platform/machine-id.js';
import type { SendLogEntry } from '../send-log.js';
import { readNodeConfig } from '../serve/node-config.js';
import type { BrokerEntry } from '../serve/node-config.js';
import type { NodeStatusFile } from '../serve/node.js';
import { listNodeStatusFiles, nodeStatusSelector, TCP_STATUS_FRESH_MS } from '../application/status/status-files.js';
export { listNodeStatusFiles, nodeStatusSelector, TCP_STATUS_FRESH_MS } from '../application/status/status-files.js';

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
  /**
   * E1 远程枚举传输腿（status --via tcp:<机器>，票012）：瞬态连 broker 发
   * status-query 等回程。Omitted → 远程视图报教学错；cli wires runViaTcpStatus。
   */
  fetchRemoteStatus?(via: string): Promise<{ target: string; payload: StatusPayload }>;
  /**
   * G0 三段式摘要的滞留子句：发件箱看门狗是否在跑（outbox lockfile 心跳）。
   * Omitted → 滞留子句不带看门狗括注。
   */
  watchdogRunning?(): boolean;
}

interface BrokerStatusFile {
  state: string;
  port?: number;
  /** E0 星名（broker 起服务时落定；status 行化妆用）。 */
  name?: string;
  lastUpdated: string;
  onlineNodes?: string[];
  /** 033：托管星清单（writeStatus 落；零星=合法待配——教学行用）。 */
  stars?: unknown[];
}

function readStatusJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

/** status 展示层截短：超过 16 字符的展示串显示 <前14>…（node.json 与 CLI 参数不受影响）。 */
function shortDisplay(s: string): string {
  return s.length > 16 ? `${s.slice(0, 14)}…` : s;
}

/** 单守护状态行（prefix='节点客户端:' 单条目 / '节点客户端[<选择器>]:' 多条目）。 */
function nodeStateLine(prefix: string, st: NodeStatusFile): string {
  if (st.state === 'online') return `${prefix} online ${shortDisplay(`tcp:${st.brokerAlias}`)} (since ${formatCreatedAt(st.since)})`;
  if (st.state === 'revoked') return `${prefix} 凭证已撤销，自动重连已暂停；换钥后显式重新连接`;
  if (st.state === 'reconnect-wait') {
    const next = st.nextAttemptAt === undefined ? '-' : formatHms(st.nextAttemptAt);
    return `${prefix} 重连等待中，下次尝试 ${next}`;
  }
  return `${prefix} 连接中 ${shortDisplay(`tcp:${st.brokerAlias}`)}`;
}

/** A revocation pause persists until explicit reconnection replaces this snapshot. */
function nodeStatusCurrent(status: NodeStatusFile | undefined, nowMs: number): status is NodeStatusFile {
  return status !== undefined && (status.state === 'revoked' || nowMs - Date.parse(status.lastUpdated) < TCP_STATUS_FRESH_MS);
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
    const fresh = nodeStatusCurrent(node, nowMs);
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
    // 033：零星=合法待配（serve 永不造星）——教学指 --add-star
    if (Array.isArray(broker.stars) && broker.stars.length === 0) {
      lines.push('零星待配（合法状态）——首星：crosschat serve --add-star <星名>');
    }
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

// ---- G0 星分组（裸跑三段式摘要的 tcp 段 + --stars 星内明细共用） --------------

/** 一颗星的本机守护条目（陈旧/缺文件按 未运行 计）。 */
interface StarDaemon {
  selector: string;
  state: NodeStatusFile['state'] | '未运行';
}

/** 一颗星的分组视图数据：可达性 + 全量机器表 + 连它的守护态。 */
interface StarGroup {
  name: string;
  reachable: boolean;
  online: number;
  machines: Array<{ name?: string; mid8: string; online: boolean; sessions?: SessionMemberDecl[]; offlineSessions?: SessionMemberDecl[] }>;
  daemons: StarDaemon[];
}

/**
 * 星清单：本机 broker（status-broker.json 新鲜且 running，机器表只有名字无
 * mid8）+ node.json 逐条目 roster 探测（可达性权威）。守护态按 status-node*.json
 * 的 brokerAlias 归星。tcpDir 未接线 → 空表。
 */
async function collectStars(deps: StatusDeps, nowMs: number): Promise<StarGroup[]> {
  if (deps.tcpDir === undefined) return [];
  const daemonsByStar = new Map<string, StarDaemon[]>();
  for (const file of listNodeStatusFiles(deps.tcpDir)) {
    const st = readStatusJson<NodeStatusFile>(join(deps.tcpDir, file));
    const fresh = nodeStatusCurrent(st, nowMs);
    const state: StarDaemon['state'] = fresh ? st!.state : '未运行';
    const entry: StarDaemon = { selector: nodeStatusSelector(file) || '默认', state };
    const list = daemonsByStar.get(st?.brokerAlias ?? '');
    if (list === undefined) daemonsByStar.set(st?.brokerAlias ?? '', [entry]);
    else list.push(entry);
  }
  const groups: StarGroup[] = [];
  const seen = new Set<string>();
  const push = (name: string, reachable: boolean, machines: StarGroup['machines']): void => {
    if (name === '' || seen.has(name)) return;
    seen.add(name);
    groups.push({ name, reachable, online: machines.filter((m) => m.online).length, machines, daemons: daemonsByStar.get(name) ?? [] });
  };
  const broker = readStatusJson<BrokerStatusFile>(join(deps.tcpDir, 'status-broker.json'));
  if (broker !== undefined && broker.state === 'running' && nowMs - Date.parse(broker.lastUpdated) < TCP_STATUS_FRESH_MS) {
    push(broker.name ?? '本机服务端', true, (broker.onlineNodes ?? []).map((n) => ({ name: n, mid8: '', online: true })));
  }
  let entries: BrokerEntry[] = [];
  try {
    entries = readNodeConfig(join(deps.tcpDir, 'node.json')).entries;
  } catch {
    // 未入网：只剩上面的本机 broker 星（若有）
  }
  for (const entry of entries) {
    const name = entry.name ?? `${entry.host}:${entry.port}`;
    if (deps.roster === undefined) {
      push(name, false, []);
      continue;
    }
    const machines = await deps.roster(entry);
    // 018：本机 broker 星已从 status 文件入组（仅名字无 mid8）——同星条目的
    // roster 数据更全（mid8/离线机/会话成员），原位升级而非跳过
    if (machines !== undefined && seen.has(name)) {
      const group = groups.find((g) => g.name === name);
      if (group !== undefined) {
        group.reachable = true;
        group.online = machines.filter((m) => m.online).length;
        group.machines = machines;
      }
      continue;
    }
    push(name, machines !== undefined, machines ?? []);
  }
  return groups;
}

const machineDisp = (m: { name?: string; mid8: string }): string => (m.mid8 === '' ? (m.name ?? '?') : `${m.name ?? '?'}(${m.mid8})`);

/** 摘要 tcp 段的星行/机器行（在线优先，封顶 5）。 */
function starSummaryLines(groups: StarGroup[]): string[] {
  const lines: string[] = [];
  for (const g of groups) {
    const client = g.daemons.some((d) => d.state === 'revoked')
      ? '凭证已撤销，自动重连已暂停'
      : g.daemons.some((d) => d.state === 'online') ? 'online' : '未运行';
    const head = g.reachable ? `${g.name} ✓ 可达，${g.online} 机器在线` : `${g.name} ✗ 不可达`;
    lines.push(`  ${head} · 客户端 ${client}`);
    const machines = [...g.machines].sort((a, b) => Number(b.online) - Number(a.online)).slice(0, 5);
    if (machines.length > 0) lines.push(`    ${machines.map(machineDisp).join('、')}`);
  }
  return lines;
}

/**
 * `--stars` 星内明细：每星可达行 + 守护态行 + 全量机器表（含离线星与未跑守护）
 * + 会话成员行（018：`机器:会话名 (extends←旧名)` 精简格式，仅明细视图——
 * 裸跑摘要不炸行）+ adopt 诊断行（本机会话活着但非成员且本机守护在线 →
 * 当场打印完整收编命令，复制即用）。
 */
async function starsText(deps: StatusDeps, nowMs: number, groups: StarGroup[]): Promise<string> {
  if (deps.tcpDir === undefined) return 'tcp: 未入网（本机无 ~/.crosschat/tcp）';
  const localNames = await collectLocalSessionNames(deps);
  const lines = [groups.length === 0 ? 'tcp: 无' : `tcp: 共 ${groups.length} 星`];
  for (const g of groups) {
    lines.push(g.reachable ? `${g.name} ✓ 可达，${g.online} 机器在线` : `${g.name} ✗ 不可达`);
    const daemons = g.daemons.map((d) => `${d.selector}: ${d.state === 'revoked' ? 'revoked（凭证已撤销，自动重连已暂停）' : d.state}`).join('、');
    lines.push(`  守护: ${daemons === '' ? '未运行' : daemons}`);
    const machines = [...g.machines].sort((a, b) => Number(b.online) - Number(a.online));
    for (const m of machines) lines.push(`  ${machineDisp(m)} ${m.online ? '在线' : '离线'}`);
    for (const m of machines) {
      if ((m.sessions?.length ?? 0) === 0) continue;
      const label = m.name ?? (m.mid8 === '' ? '?' : m.mid8);
      const members = m.sessions!.map((s) => {
        const ext =
          s.extends === undefined
            ? ''
            : ` (extends←${typeof s.extends === 'string' ? s.extends : `${s.extends.machine}:${s.extends.name}`})`;
        // 020：成员行带工具限定词（yang:claude/boss）——跨工具同名时认得出谁是谁；老聚合器无 tool 保持旧格式
        return `${label}:${s.tool === undefined ? '' : `${s.tool}/`}${s.name ?? s.sessionId.slice(0, 8)}${ext}`;
      });
      lines.push(`  会话: ${members.join('、')}`);
    }
    // 028 三态之下线：在册未在线（册位保留）——⚪ 标记 + 三条出路诊断
    for (const m of machines) {
      if ((m.offlineSessions?.length ?? 0) === 0) continue;
      const label = m.name ?? (m.mid8 === '' ? '?' : m.mid8);
      const off = m.offlineSessions!.map(
        (s) => `⚪${label}:${s.tool === undefined ? '' : `${s.tool}/`}${s.name ?? s.sessionId.slice(0, 8)}`,
      );
      lines.push(`  下线: ${off.join('、')}（等 resume 复活；接任 --extend-session；删 --member-remove）`);
    }
    // 诊断（场景 E 恢复指路）：会话活着但非成员且该星本机守护在线——收编命令当场打印
    // （下线成员名也算册内名——对账循环数秒内验活复活，不再建议 adopt）
    if (g.reachable && g.daemons.some((d) => d.state === 'online') && localNames.length > 0) {
      const memberNames = new Set<string>();
      for (const m of machines)
        for (const s of [...(m.sessions ?? []), ...(m.offlineSessions ?? [])]) if (s.name !== undefined) memberNames.add(s.name);
      const unmatched = localNames.filter((name) => !memberNames.has(name)).slice(0, 5);
      for (const name of unmatched) {
        lines.push(`  建议: crosschat serve --connect ${g.name} --adopt ${name}（会话活着但非成员——收编活进程入星）`);
      }
    }
  }
  return lines.join('\n');
}

/** 本机活会话的显示名（claude 注册表 + codex 线程表；仅命名会话）。 */
async function collectLocalSessionNames(deps: StatusDeps): Promise<string[]> {
  const names = deps.listClaudeSessions().sessions.flatMap((session) =>
    session.sessionId !== '' && session.name !== undefined ? [session.name] : [],
  );
  try {
    for (const thread of await deps.listCodexThreads()) {
      if (thread.name !== null && thread.name !== '') names.push(thread.name);
    }
  } catch {
    // codex down is a valid status answer——claude 侧照给
  }
  return names;
}

/**
 * G0 传输分类器（status 段落归对与 --conversations --via 共用）：存档 ref 解码
 * 为权威——端点带 m 且无 starId=ssh；带 starId=tcp；无 m=单机。ref 不可解码
 * 回退 send-log via: 痕迹（跨机记账条目的 target 前缀）。
 */
export type ConversationFamily = 'ssh' | 'tcp' | 'local';

export function conversationFamily(ref: string, traces?: ReadonlySet<'tcp' | 'ssh'>): ConversationFamily {
  try {
    const decoded = decodeRef(ref);
    if (decoded.starId !== undefined) return 'tcp';
    const hasM = (ep: typeof decoded.f): boolean => ep.p !== 'human' && ep.m !== undefined;
    return hasM(decoded.f) || hasM(decoded.t) ? 'ssh' : 'local';
  } catch {
    if (traces?.has('tcp')) return 'tcp';
    if (traces?.has('ssh')) return 'ssh';
    return 'local';
  }
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

/** F1 过滤抑制：任一过滤参数在场时，零行的段整段沉默（段头/占位/unavailable 横幅）——过滤语境下空段是噪音；裸输出保持原形（零回归锚点）。 */
function anyFilter(filters: StatusFilters): boolean {
  return filters.name !== undefined || filters.section !== undefined || filters.all === true;
}

export async function runStatus(
  deps: StatusDeps,
  json: boolean,
  conversations = false,
  filters: StatusFilters = {},
  viaTarget?: string,
  stars = false,
): Promise<string> {
  if (viaTarget !== undefined) return remoteStatusView(deps, json, filters, viaTarget);
  if (conversations) return conversationsView(deps, json, filters);
  const nowMs = deps.now?.() ?? Date.now();
  // G0 --stars：tcp 星内明细视图——text 整视图替换；--json 走下方旧键全保留 + stars 新键
  const starGroups = stars ? await collectStars(deps, nowMs) : undefined;
  if (stars && !json) return await starsText(deps, nowMs, starGroups!);
  // G0 裸跑三段式摘要：任何旗标/json 在场 = 现行明细视图逐字节不变（零回归锚）
  if (
    !json &&
    filters.section === undefined &&
    filters.name === undefined &&
    filters.all !== true &&
    filters.via === undefined
  ) {
    return summaryView(deps, nowMs);
  }
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
    // 未命名行始终在场，契约不变）。G0 --stars --json 加 stars 分组键（旧键不动）。
    const tcp = deps.tcpDir === undefined ? {} : { tcp: tcpJson(deps.tcpDir, nowMs) };
    const tcpProfiles = deps.tcpDir === undefined ? {} : { tcpProfiles: nodeProfilesJson(deps.tcpDir, nowMs) };
    const out: Record<string, unknown> = { ...tcp, ...tcpProfiles };
    if (starGroups !== undefined) {
      out.stars = starGroups.map((g) => ({
        name: g.name,
        reachable: g.reachable,
        machinesOnline: g.online,
        machines: g.machines,
        daemons: g.daemons,
      }));
    }
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
  const filtered = anyFilter(filters);
  if (filters.section !== 'codex') {
    if (!(filtered && filters.section === undefined && claudeRows.length === 0)) {
      lines.push('claude:');
      if (claudeRows.length === 0) lines.push('  (none)');
      for (const session of claudeRows) {
        lines.push(
          `  ${(session.name ?? '(unnamed)').padEnd(24)} ${session.kind.padEnd(12)} ${session.status.padEnd(16)} pid ${String(session.pid).padEnd(6)} ${formatCwdShort(session.cwd)}`,
        );
      }
    }
  }
  if (filters.section !== 'claude') {
    const codexVisible = codexError === undefined && (codexRows.length > 0 || unlisted.length > 0);
    if (!(filtered && filters.section === undefined && !codexVisible)) {
      lines.push('codex:');
      if (codexError !== undefined) lines.push(`  unavailable (${codexError})`);
      else if (!codexVisible) lines.push('  (none)');
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
  }
  lines.push(...(await tcpForwarderLines(deps.tcpDir, nowMs, deps.roster)));
  return lines.join('\n');
}

/**
 * G0 裸跑三段式摘要：本机会话（计数 + 滞留 + 最近 5 会话跨侧混排）/ tcp 星
 * （每星一行 + 机器行）/ ssh 对话（最近 5 段）。数据源全是现成注册表、roster
 * 探测与会话分片；明细视图的代码路径一字不动（旗标在场即回退明细）。
 */
async function summaryView(deps: StatusDeps, nowMs: number): Promise<string> {
  const scan = deps.listClaudeSessions();
  let threads: CodexThreadWithMeta[] | undefined;
  try {
    threads = await deps.listCodexThreads();
  } catch {
    threads = undefined; // codex down is a valid status answer
  }
  const rows = deps.listConversations?.() ?? [];
  const lines: string[] = [];
  const parked = rows.reduce((total, row) => total + row.parked, 0);
  const head =
    `本机会话: claude ${scan.sessions.length} · ` +
    (threads === undefined ? 'codex unavailable' : `codex ${threads.length}`) +
    (parked > 0
      ? ` · 滞留 ${parked}${deps.watchdogRunning === undefined ? '' : `（看门狗${deps.watchdogRunning() ? '运行中' : '未运行'}）`}`
      : '');
  lines.push(head);
  const recent = [
    ...scan.sessions.map((session) => ({ side: 'claude', name: session.name, at: session.updatedAt ?? session.startedAt })),
    ...(threads ?? []).map((thread) => ({
      side: 'codex',
      name: thread.name ?? undefined,
      at: thread.meta?.createdAt ? Date.parse(thread.meta.createdAt) : undefined,
    })),
  ]
    .filter((row) => row.name !== undefined) // 未命名默认隐藏，与明细视图同规
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, 5);
  for (const row of recent) {
    const time = row.at === undefined || Number.isNaN(row.at) ? '-' : formatRelativeTime(row.at, nowMs);
    lines.push(`  ${row.side} ${row.name}  ${time}`);
  }
  lines.push('（全量: --claude|--codex|--name）');
  if (deps.tcpDir !== undefined) {
    const groups = await collectStars(deps, nowMs);
    lines.push(groups.length === 0 ? 'tcp: 无' : `tcp: 共 ${groups.length} 星`);
    lines.push(...starSummaryLines(groups));
    if (groups.length > 0) lines.push('（星内明细: --stars）');
  }
  const traces = viaFamiliesByPair(deps.sendLogTail?.() ?? []);
  const sshRows = rows.filter((row) => conversationFamily(row.ref, traces.get(row.endpoints.join('\n'))) === 'ssh');
  lines.push(sshRows.length === 0 ? 'ssh: 无' : `ssh: 共 ${sshRows.length} 段对话`);
  for (const row of sshRows.slice(0, 5)) {
    lines.push(`  ${sshPeerLabel(row)} turn ${row.turn ?? '?'}  ${formatRelativeTime(row.updatedAt, nowMs)}`);
  }
  lines.push('（明细: --conversations --via ssh）');
  return lines.join('\n');
}

/** ssh 段行标：远端端点（ref 里带 m 的一侧）的显示名@机器；ref 不可解码退 ?。016① 机器段补 (mid8)。 */
function sshPeerLabel(row: ConversationSummary): string {
  try {
    const ref = decodeRef(row.ref);
    const remote = [ref.f, ref.t].find(
      (ep): ep is { p: 'claude' | 'codex'; id: string; m?: string; mid?: string } => ep.p !== 'human' && ep.m !== undefined,
    );
    if (remote === undefined) return `${row.pair[1]}@?`;
    const idx = row.endpoints.indexOf(`${remote.p}:${remote.id}`);
    // 016① 显示型机器标识：name(mid8)；旧 ref 无 mid 只显名字。
    const mid8 = remote.mid !== undefined ? normalizeMid(remote.mid).slice(0, 8) : '';
    const machine = `${remote.m}${mid8.length < 8 ? '' : `(${mid8})`}`;
    return `${idx === -1 ? (row.pair[1] ?? '?') : row.pair[idx]}@${machine}`;
  } catch {
    return `${row.pair[1] ?? '?'}@?`;
  }
}

/**
 * 027-E：目标机的星籍键集（在线+下线成员的名/工具限定名/id8），供远程视图
 * 标注"非册(裸起)"。逐 node.json 条目探 roster，找到目标机（名等或 mid 前缀）
 * 即返；全不可达/未入网/机器不在册 → undefined（无从判定，不标）。
 */
async function remoteMemberKeys(deps: StatusDeps, target: string): Promise<Set<string> | undefined> {
  if (deps.roster === undefined || deps.tcpDir === undefined) return undefined;
  let entries: BrokerEntry[];
  try {
    entries = readNodeConfig(join(deps.tcpDir, 'node.json')).entries;
  } catch {
    return undefined;
  }
  const needle = target.toLowerCase().replace(/-/g, '');
  for (const entry of entries) {
    const machines = await deps.roster(entry);
    if (machines === undefined) continue;
    const hit = machines.find((m) => m.name === target || (needle !== '' && m.mid8.toLowerCase().startsWith(needle)));
    if (hit === undefined) continue;
    const keys = new Set<string>();
    for (const s of [...(hit.sessions ?? []), ...(hit.offlineSessions ?? [])]) {
      if (s.name !== undefined) {
        keys.add(s.name);
        if (s.tool !== undefined) keys.add(`${s.tool}/${s.name}`);
      }
      keys.add(s.sessionId.slice(0, 8));
    }
    return keys;
  }
  return undefined;
}

/**
 * E1 远程视图（票012）：`status --via tcp:<机器>`——经 broker 拉对端扫描载荷，
 * 过滤参数在请求方本地套用，分段渲染与本地主视图同构（无 TUI 占用标记——
 * 载荷不含写者锁；无转发器小节——那是本机概念）。codex 不可用降级为
 * unavailable 段（部分应答），与本地语义一致。
 */
async function remoteStatusView(deps: StatusDeps, json: boolean, filters: StatusFilters, via: string): Promise<string> {
  if (deps.fetchRemoteStatus === undefined) {
    throw new MultichatError('USAGE', '远程会话枚举未接线（需要 ~/.crosschat/tcp/node.json，向管理员索取）');
  }
  const { target, payload } = await deps.fetchRemoteStatus(via);
  const matches = nameMatcher(filters.name);
  const codexRows: StatusCodexRow[] | undefined = Array.isArray(payload.codex) ? payload.codex : undefined;
  const codexUnavailable = codexRows === undefined ? (payload.codex as { unavailable: string }).unavailable : undefined;
  // 027-E 移交：远端行标注非册（裸起）——目标机星籍（roster 在线+下线切片）比对扫描行；
  // roster 不可达或机器不在任何星 = 无从判定，静默不标。
  const memberKeys = json ? undefined : await remoteMemberKeys(deps, target);
  const bareMark = (candidates: string[]): string =>
    memberKeys !== undefined && candidates.length > 0 && !candidates.some((k) => memberKeys.has(k)) ? '  非册(裸起)' : '';

  if (json) {
    // 契约同本地 json：--name 滤行、选段省键；未命名行始终在场（--all 不影响 json）
    const out: Record<string, unknown> = { via: `tcp:${target}`, machine: target };
    if (filters.section !== 'codex') {
      out.claude = payload.claude.filter((row) => matches(row.name));
    }
    if (filters.section !== 'claude') {
      out.codex = codexRows === undefined ? payload.codex : codexRows.filter((row) => matches(row.name));
    }
    return JSON.stringify(out);
  }

  const lines: string[] = [`${target} 机会话:`];
  // F1 过滤抑制同本地：过滤后零行的段（含 unavailable 横幅）整段沉默。
  const filtered = anyFilter(filters);
  if (filters.section !== 'codex') {
    const rows = payload.claude.filter((row) => (filters.all || row.name !== null) && matches(row.name));
    if (!(filtered && rows.length === 0)) {
      lines.push('claude:');
      if (rows.length === 0) lines.push('  (none)');
      for (const row of rows) {
        lines.push(
          `  ${(row.name ?? '(unnamed)').padEnd(24)} ${row.kind.padEnd(12)} ${row.status.padEnd(16)} pid ${String(row.pid).padEnd(6)} ${formatCwdShort(row.cwd ?? undefined)}` +
            bareMark(row.name === null ? [] : [row.name, `claude/${row.name}`]),
        );
      }
    }
  }
  if (filters.section !== 'claude') {
    const rows = codexRows === undefined ? undefined : codexRows.filter((row) => (filters.all || row.name !== null) && matches(row.name));
    if (!(filtered && (rows === undefined || rows.length === 0))) {
      lines.push('codex:');
      if (codexUnavailable !== undefined) {
        lines.push(`  unavailable (${codexUnavailable})`);
      } else {
        if (rows!.length === 0) lines.push('  (none)');
        for (const row of rows!) {
          const name = (row.name ?? '(unnamed)').padEnd(24);
          const dir = formatCwdShort(row.cwd ?? undefined).padEnd(20);
          const created = formatCreatedAt(row.createdAt ?? undefined).padEnd(11);
          const originator = (row.originator ?? '-').padEnd(16);
          lines.push(
            `  ${name} ${dir} ${created} ${originator} ${row.id}  ${row.status}` +
              bareMark([...(row.name === null ? [] : [row.name, `codex/${row.name}`]), row.id]),
          );
        }
      }
    }
  }
  return lines.join('\n');
}

/** B2：json 模式的转发器小节（dir 缺省 → null 占位，保持键集稳定）。 */
function tcpJson(tcpDir: string | undefined, nowMs: number): { node: unknown; broker: unknown } {
  if (tcpDir === undefined) return { node: null, broker: null };
  const node = readStatusJson<NodeStatusFile>(join(tcpDir, 'status-node.json'));
  const nodeFresh = nodeStatusCurrent(node, nowMs);
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
    const fresh = nodeStatusCurrent(st, nowMs);
    return { selector: nodeStatusSelector(file), status: fresh ? st! : null };
  });
}

/** Locks whose thread id is not in the thread/list result (empty when listing failed). */function unlistedLocks(held: ReadonlySet<string>, threads: CodexThreadWithMeta[] | undefined): string[] {
  if (threads === undefined) return [];
  const listed = new Set(threads.map((thread) => thread.id));
  return [...held].filter((id) => !listed.has(id));
}

/**
 * 传输族判定的回退源（G0）：跨机记账的 send-log 条目 target 是 `via:` 痕迹——
 * ssh 腿写 `via:<host>`（federation.ts）、tcp 腿写 `via:tcp:<machine>`（via-tcp.ts）。
 * 这类条目的 from/target 不是双身份键，归对靠解码其 replyRef（ref 两端即对键）。
 * 返回 pairKey → 出现过的族；仅当该对存档 ref 不可解码时被 conversationFamily 采用。
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
  // 过滤（名字翻译后再滤，命中的是显示名；G0 --via 按统一分类器：存档 ref 解码
  // 为权威，不可解码回退 send-log via: 痕迹）。
  if (filters.via !== undefined) {
    const families = viaFamiliesByPair(deps.sendLogTail?.() ?? []);
    rows = rows.filter((row) => conversationFamily(row.ref, families.get(row.endpoints.join('\n'))) === filters.via);
  }
  if (filters.name !== undefined) {
    const lower = filters.name.toLowerCase();
    rows = rows.filter((row) => row.pair.some((n) => n.toLowerCase().includes(lower)));
  }
  if (json) {
    // Frozen JSON contract: exactly the eight summary fields (B22 added `receipt`);
    // `endpoints`/`handle` are render-only (G0 柄列不进 json，完整 ref 字段不动).
    return JSON.stringify(rows, (key, value) => (key === 'endpoints' || key === 'handle' ? undefined : value));
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
        `${row.parked > 0 ? `  滞留 ${row.parked}` : ''}${receipt}` +
        `${row.handle === null ? '  -' : `  ${row.handle}`}`,
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
