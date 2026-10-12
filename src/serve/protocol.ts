/**
 * tcp broker 协议层（票B B1）：单文件、客户端服务端共用。JSON 单帧单 ws
 * 文本消息。B2 才有行为实现的帧（file-* 等）类型先定义全。
 */
export const PROTOCOL_VERSION = 1;
export const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

/** 协议错误码（error.code），与各端报错文案共用。 */
export const ERR = {
  BAD_AUTH: 'BAD_AUTH',
  BAD_PROTO: 'BAD_PROTO',
  UNKNOWN_MACHINE: 'UNKNOWN_MACHINE',
  PEER_OFFLINE: 'PEER_OFFLINE',
  MACHINE_NAME_COLLISION: 'MACHINE_NAME_COLLISION',
  NOT_READY: 'NOT_READY',
  /** B2 修订：file-begin 尺寸预拒（>64MiB）。 */
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
} as const;

export interface InfoFrame {
  op: 'info';
  proto: number;
  server: string;
  caps: string[];
  /** B0 多星地基：broker 星标识（注册表缺省则不发该字段——additive）。 */
  starId?: string;
  /** E0 星名：broker 权威星名（注册表缺省则不发——additive，节点据此同步条目 name）。 */
  name?: string;
}
export interface ConnectFrame {
  op: 'connect';
  proto: number;
  role: 'node' | 'sender';
  machineId?: string;
  auth: string;
  /** B2.1 修订：节点自报的人读显示名（≤32 字符、无控制符）。寻址权威是 machine-id 前缀，名字不参与回信路由。 */
  name?: string;
}
export interface ConnectedFrame {
  op: 'connected';
  machineName?: string;
}
export interface ErrorFrame {
  op: 'error';
  code: string;
  message: string;
  id?: string;
}
export interface SendFrame {
  op: 'send';
  id: string;
  targetMachine: string;
  to?: string;
  conversation?: string;
  body: string;
  origin?: string;
}
export interface ReceiptFrame {
  op: 'receipt';
  id: string;
  status: 'delivered' | 'queued' | 'parked';
  turn?: string;
  replyRef?: string;
  /** B2 修订：成功时携带远端 runSend 完整输出（发送方按 ssh 语义展示）。 */
  output?: string;
}
export interface DeliverFrame {
  op: 'deliver';
  id: string;
  fromMachine: string;
  payload: string;
  /** B2 修订：投递目标三件套随帧透传（B1 只转发 body，节点无从得知路由）。 */
  to?: string;
  conversation?: string;
  origin?: string;
}
export interface ResultFrame {
  op: 'result';
  id: string;
  status: 'delivered' | 'queued' | 'parked' | 'error';
  turn?: string;
  replyRef?: string;
  /** B2 修订：status='error' 时的结构化错误（比 ssh 文本重抛更准）。 */
  code?: string;
  message?: string;
  /** B2 修订：成功时携带完整 runSend 输出（发送方逐字对齐 ssh 展示）。 */
  output?: string;
}
export interface FileBeginFrame {
  op: 'file-begin';
  id: string;
  /** B2 修订：broker 按 targetMachine 路由（B1 定义帧型时未含，运行时从未使用）。 */
  targetMachine: string;
  sha256: string;
  name: string;
  size: number;
}
export interface FileChunkFrame {
  op: 'file-chunk';
  id: string;
  seq: number;
  bytes: string;
}
export interface FileEndFrame {
  op: 'file-end';
  id: string;
}
export interface FileResultFrame {
  op: 'file-result';
  id: string;
  ok: boolean;
  path?: string;
  error?: string;
  /** B2 修订：begin 应答携带断点续传锚（0 = 从头传）。 */
  resumeFrom?: number;
  /** B2 修订：秒回去重标记（对端 inbox 已有同 sha 完整文件）。 */
  dedup?: boolean;
}

/** B2.1 修订：成员机向 broker 拉在线机器表（瞬态连接，status 用）。 */
export interface RosterFrame {
  op: 'roster';
}
export interface RosterMachine {
  name?: string;
  mid8: string;
  online: boolean;
}
export interface RosterResultFrame {
  op: 'roster-result';
  machines: RosterMachine[];
}

/** E1 远程枚举：claude 段行（字段镜像本地 status --json 的 claude 行）。 */
export interface StatusClaudeRow {
  name: string | null;
  kind: string;
  status: string;
  pid: number;
  cwd: string | null;
}
/** E1 远程枚举：codex 段行（字段镜像本地 status --json 的 codex 行；id 已截 8 位）。 */
export interface StatusCodexRow {
  name: string | null;
  status: string;
  id: string;
  cwd: string | null;
  createdAt: string | null;
  originator: string | null;
}
/** E1 远程枚举载荷：分段镜像本地语义——codex daemon 没跑时给 unavailable 段而非整体失败。 */
export interface StatusPayload {
  claude: StatusClaudeRow[];
  codex: StatusCodexRow[] | { unavailable: string };
}

/** E1 远程会话枚举（票012）：请求方→broker；目标是节点时 broker 原帧转发。 */
export interface StatusQueryFrame {
  op: 'status-query';
  id: string;
  targetMachine: string;
}
/** E1：目标侧扫描回程（节点→broker，broker 原帧转发回请求方）。 */
export interface StatusResultFrame {
  op: 'status-result';
  id: string;
  ok: boolean;
  payload?: StatusPayload;
  error?: string;
}

export type Frame =
  | InfoFrame
  | ConnectFrame
  | ConnectedFrame
  | ErrorFrame
  | SendFrame
  | ReceiptFrame
  | DeliverFrame
  | ResultFrame
  | FileBeginFrame
  | FileChunkFrame
  | FileEndFrame
  | FileResultFrame
  | RosterFrame
  | RosterResultFrame
  | StatusQueryFrame
  | StatusResultFrame;

const OPS = new Set([
  'info',
  'connect',
  'connected',
  'error',
  'send',
  'receipt',
  'deliver',
  'result',
  'file-begin',
  'file-chunk',
  'file-end',
  'file-result',
  'roster',
  'roster-result',
  'status-query',
  'status-result',
]);

/** 解析一帧 ws 文本消息；JSON 损坏或 op 未知返回 undefined（调用方丢弃）。 */
export function parseFrame(text: string): Frame | undefined {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof obj !== 'object' || obj === null) return undefined;
  const op = (obj as { op?: unknown }).op;
  return typeof op === 'string' && OPS.has(op) ? (obj as Frame) : undefined;
}

export function encodeFrame(frame: Frame): string {
  return JSON.stringify(frame);
}
