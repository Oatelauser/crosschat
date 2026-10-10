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
} as const;

export interface InfoFrame {
  op: 'info';
  proto: number;
  server: string;
  caps: string[];
}
export interface ConnectFrame {
  op: 'connect';
  proto: number;
  role: 'node' | 'sender';
  machineId?: string;
  auth: string;
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
}
export interface DeliverFrame {
  op: 'deliver';
  id: string;
  fromMachine: string;
  payload: string;
}
export interface ResultFrame {
  op: 'result';
  id: string;
  status: 'delivered' | 'queued' | 'parked';
  turn?: string;
  replyRef?: string;
}
export interface FileBeginFrame {
  op: 'file-begin';
  id: string;
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
  | FileResultFrame;

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
