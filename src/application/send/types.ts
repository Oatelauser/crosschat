import type { ClaudeRegistryScan } from '../../claude/registry.js';
import type { CodexThreadSummary } from '../../codex/client.js';
import type { ClaudeDeliveryTarget } from '../../claude/deliver.js';
import type { SendLogEntry } from '../../send-log.js';
import type { SshResult } from '../../federation.js';

export interface SendArgs {
  to?: string;
  conversation?: string;
  /** Body from --body; the alternative is deps.stdinText. */
  bodyArg?: string;
  json?: boolean;
  /** Federation (008/B1): `ssh:<host>` — remote CLI gets full authority; B2 adds `tcp:<机器>`. */
  via?: string;
  /** 票B B2：--file <路径> 文件通道（仅配合 --via tcp:，64MiB 上限分块传输）。 */
  fileArg?: string;
  /** Machine-injected sender identity for ssh shells without agent env (008 D5); hidden flag. */
  origin?: string;
  /** 票A：--max-body-kb 原始值（正整数 KiB）；解析与容错在 limits.ts（非法静默降级）。 */
  maxBodyKb?: string;
  /** 票A：--max-turn 原始值（正整数轮数）；解析与容错在 limits.ts。 */
  maxTurn?: string;
  /**
   * 018 批一：投递管线注入的会话级目标（三段寻址命中星成员时由 broker→聚合器
   * 透传的会话 ID）。命令面不暴露——id 定位绕过名字解析（resolveTargetById），
   * to 值仅作占位（sessionId 在场即被忽略）。
   */
  targetSessionId?: string;
}

export interface SendDeps {
  env: Record<string, string | undefined>;
  /** Stdin content when piped (already normalized: undefined = not given). */
  stdinText?: string;
  listClaudeSessions(): ClaudeRegistryScan;
  listCodexThreads(): Promise<CodexThreadSummary[]>;
  deliverClaude(target: ClaudeDeliveryTarget, content: string): Promise<{ status: 'delivered' }>;
  deliverCodex(threadId: string, content: string): Promise<{ status: 'accepted'; turnId: string; queued?: boolean }>;
  /** Send-log file: the rate limiter counts this pair's tail-window entries (014 evaporation). */
  sendLogFile: string;
  /** Outbox root for parking busy/locked codex deliveries (~/.crosschat/outbox). */
  outboxDir: string;
  now(): number;
  /** Detached retry loop spawner (B12); optional so tests stay process-free. */
  spawnWatchdog?(): void;
  /** Sender-side send log (B14); optional so tests stay file-free. */
  appendLog?(entry: SendLogEntry): void;
  /** Rollout receipt probe for codex deliveries (B14). */
  confirmReceipt?(threadId: string, marker: string): Promise<'confirmed' | 'unconfirmed'>;
  /** Pair-conversation continuity state (B15); absent = always fresh threads. */
  conversationStateFile?: string;
  /** Federation transport executor (008/B1); injectable for tests. */
  sshExec?(argv: readonly string[], input: string, timeoutMs: number): Promise<SshResult>;
  /** Machine name stamped into --origin; default os.hostname(). */
  hostname?(): string;
  /** Stable per-install machine id (B10) for same-machine decisions; default platform read. */
  machineId?(): string | undefined;
  /** 票B B2：tcp 通道根目录（node.json/status/收件箱所在 .crosschat）；缺省真 home。 */
  tcpBaseDir?: string;
  /** B2.1：ssh config 全文（回信自动补全判"对端有无 ssh 别名"用）；缺省=无别名可查。 */
  sshConfigText?: () => string | undefined;
  /** B1 多星：tcp 投递管线传入的本腿 broker 星标识——签发的 ref 盖 starId；单机/ssh 恒缺省。 */
  refStarId?: string;
  /**
   * F1：tcp 投递管线（broker/节点守护 deliverViaRunSend）透传的发送方机器名
   * （星内 roster 真名）——跨机信封 from-machine 属性来源；无名瞬态发送方缺省。
   */
  fromMachine?: string;
  /**
   * 024 方案3：tcp 投递管线传入的本腿星名（broker=注册表星名，node=条目
   * name，无名退 starId 前缀）——与 fromMachine 拼信封正向三段坐标
   * from-addr；单机/ssh 恒缺省（ssh 无星概念）。
   */
  fromStarName?: string;
}


/** The existing JSON/wire receipt. queued=true remains delivered for legacy callers. */
export interface DeliveryReceipt {
  status: 'delivered' | 'queued' | 'parked';
  to: string;
  turn?: number;
  replyRef: string;
  queued?: boolean;
  queue?: number;
  mailbox?: string;
  via?: string;
  file?: string;
  [field: string]: unknown;
}

/** Core evidence, independent of CLI text and JSON serialization. */
export interface SendResult {
  status: 'delivered' | 'queued' | 'parked';
  receipt: DeliveryReceipt;
  handle?: string;
  route?: { kind: 'ssh' | 'tcp'; displayTo: string; machine: string };
  confirmation?: 'confirmed' | 'unconfirmed';
  warning?: string;
  automaticFile?: string;
}
